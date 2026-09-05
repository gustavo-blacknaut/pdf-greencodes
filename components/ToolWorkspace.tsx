'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  Lock,
  Plus,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { Dropzone } from './Dropzone';
import { FilaDeArquivos, type ArquivoNaFila } from './FilaDeArquivos';
import { OptionField } from './OptionField';
import { PageBoard } from './PageBoard';
import { PdfEditor } from './PdfEditor';
import { RegistroDeProgresso, type LinhaDoRegistro } from './RegistroDeProgresso';
import { ResultPanel } from './ResultPanel';
import { ToolIcon } from './ToolIcon';
import { atividade } from '@/lib/atividade';
import { DEFAULT_TTL_MS, SEM_PRAZO, vault } from '@/lib/ephemeral';
import {
  desbloquearArquivo,
  inspectFile,
  runOperation,
  type ElementoEditor,
  type PagePlanItem,
  type RunResult,
} from '@/lib/pdf/engine';
import {
  AVISO_ARQUIVO_GRANDE,
  LIMITES,
  OperacaoCancelada,
  pareceSerImagem,
  usarLimitesDoAplicativo,
  validarFila,
} from '@/lib/pdf/guards';
import { getEngineStatus, subscribeEngineStatus, warmEngine, type EngineStatus } from '@/lib/pdf/lazy';
import { defaultOptions, isFieldVisible, type BoardMode, type Tool } from '@/lib/tools';
import { cx, formatBytes } from '@/lib/utils';
import { aoReceberArquivosDoSistema, estaNoAplicativo, type ArquivoEscolhido } from '@/lib/desktop';

const BOARD_HINTS: Record<BoardMode, string> = {
  organize: 'Arraste as miniaturas para reordenar. Passe o mouse numa página para girar ou excluir.',
  remove: 'Clique nas páginas que devem sair. Clique de novo para desmarcar.',
  keep: 'Clique nas páginas que vão para o novo arquivo.',
  rotate: 'Cada clique numa página gira 90° para a direita.',
};

type Phase = 'idle' | 'running' | 'done';

let counter = 0;
const nextId = () => `f${(counter += 1)}_${Date.now().toString(36)}`;

export function ToolWorkspace({ tool }: { tool: Tool }) {
  const [items, setItems] = useState<ArquivoNaFila[]>([]);
  const [options, setOptions] = useState(() => defaultOptions(tool));
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ fraction: 0, label: '' });
  const [result, setResult] = useState<{ id: string; data: RunResult; elapsed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Separado do erro de propósito: o fluxo normal limpa o erro a cada passo,
  // e o aviso de arquivo grande sumiria antes de alguém ler.
  const [aviso, setAviso] = useState<string | null>(null);
  const [engine, setEngine] = useState<EngineStatus>('cold');

  // O que está sendo feito, linha a linha. Barra parada não diz se está lento
  // ou travado; o registro diz em que arquivo e em que página parou.
  const [registro, setRegistro] = useState<LinhaDoRegistro[]>([]);
  const [registroAberto, setRegistroAberto] = useState(false);
  const inicioRef = useRef(0);

  // A mesma tela serve o site e o aplicativo. No app o cabeçalho é enxuto: a
  // navegação e os selos de confiança ficam de fora.
  const noApp = usePathname().startsWith('/app');

  const resultIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelamentoManualRef = useRef(false);

  /**
   * Nome do arquivo escolhido -> id do marcador que já está na tela.
   *
   * É ref, e não estado, porque quem lê é o callback que o Dropzone guardou
   * antes da leitura começar. Lendo o estado dali vinha a lista de antes do
   * marcador existir, o marcador nunca era reaproveitado, e o arquivo
   * aparecia duas vezes — um preso em "carregando" para sempre.
   */
  const marcadoresRef = useRef(new Map<string, string>());

  useEffect(() => {
    // O app tem a memória da máquina; a aba do navegador, não.
    usarLimitesDoAplicativo(estaNoAplicativo());
    setEngine(getEngineStatus());
    const unsubscribe = subscribeEngineStatus(setEngine);
    void warmEngine({
      raster: tool.operation === 'compress' || tool.operation === 'pdf-to-images' || tool.operation === 'ocr',
    });
    return unsubscribe;
  }, [tool.operation]);

  // Sair da ferramenta apaga qualquer resultado ainda pendente.
  useEffect(
    () => () => {
      if (resultIdRef.current) vault.purge(resultIdRef.current, 'saiu');
    },
    [],
  );

  /**
   * Mostra os arquivos assim que a pessoa escolhe, antes de ler o conteúdo.
   *
   * A validação de tamanho também acontece aqui: um arquivo acima do limite
   * era recusado só depois de ser lido inteiro, o que num arquivo grande
   * significa esperar muito para receber um "não".
   */
  const mostrarEscolhidos = useCallback(
    (escolhidos: ArquivoEscolhido[]) => {
      setError(null);
      setAviso(null);
      try {
        validarFila(
          escolhidos.map((e) => ({ name: e.nome, size: e.tamanho })),
          tool.multiple ? items : [],
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Arquivo recusado.');
        return;
      }

      const grande = escolhidos.find((e) => e.tamanho > AVISO_ARQUIVO_GRANDE);
      if (grande) {
        setAviso(
          `"${grande.nome}" tem ${formatBytes(grande.tamanho)}. Vai demorar, e em máquina com pouca memória pode não terminar.`,
        );
      }

      setItems((atuais) => {
        const novos = escolhidos.map((e) => {
          const id = nextId();
          marcadoresRef.current.set(e.nome, id);
          return { id, name: e.nome, size: e.tamanho, loading: true, etapa: 'Na fila' };
        });
        return tool.multiple ? [...atuais, ...novos] : novos;
      });
    },
    [items, tool.multiple],
  );

  /** Barra de leitura de cada arquivo, vinda do processo principal. */
  /** Tira da tela o marcador de um arquivo que não conseguiu ser lido. */
  const descartarMarcadores = useCallback((nomes: string[], erro: string) => {
    const ids = new Set(nomes.map((n) => marcadoresRef.current.get(n)).filter(Boolean));
    for (const nome of nomes) marcadoresRef.current.delete(nome);
    setItems((atuais) => atuais.filter((item) => !ids.has(item.id)));
    setError(erro);
  }, []);

  const marcarLeitura = useCallback((nome: string, lidos: number, total: number) => {
    const pct = Math.round((lidos / total) * 100);
    setItems((atuais) =>
      atuais.map((item) =>
        item.name === nome && item.loading
          ? { ...item, etapa: `Lendo ${pct}% · ${formatBytes(lidos)} de ${formatBytes(total)}` }
          : item,
      ),
    );
  }, []);

  const addFiles = useCallback(
    (incoming: File[]) => {
      setError(null);
      // Juntar aceita PDF e imagem ao mesmo tempo, então não dá para tratar
      // "aceita PDF" como "só aceita PDF".
      const aceitaPdf = tool.accept.includes('.pdf');
      const aceitaImagem = tool.accept.some((tipo) => tipo.startsWith('image/'));
      const aceitaOffice = tool.accept.some((tipo) => ['.docx', '.xlsx', '.pptx'].includes(tipo));
      const aceitaTxt = tool.accept.includes('.txt');
      const accepted = incoming.filter((file) => {
        const name = file.name.toLowerCase();
        const ehPdf = name.endsWith('.pdf') || file.type === 'application/pdf';
        const ehImagem = pareceSerImagem(name, file.type);
        const ehOffice = /\.(docx|xlsx|pptx)$/.test(name);
        const ehTxt = name.endsWith('.txt');
        return (
          (aceitaPdf && ehPdf) || (aceitaImagem && ehImagem) || (aceitaOffice && ehOffice) || (aceitaTxt && ehTxt)
        );
      });

      if (!accepted.length) {
        setError(`Esta ferramenta aceita apenas ${tool.acceptLabel}.`);
        return;
      }
      if (accepted.length < incoming.length) {
        setError(`${incoming.length - accepted.length} arquivo(s) ignorado(s): formato incompatível.`);
      }

      try {
        validarFila(accepted, tool.multiple ? items : []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Arquivo recusado.');
        return;
      }

      // O marcador criado em mostrarEscolhidos já está na tela com este nome.
      // Reaproveitar o id dele evita o arquivo aparecer duas vezes.
      const marcadores = marcadoresRef.current;

      const batch = (tool.multiple ? accepted : accepted.slice(0, 1)).map((file) => ({
        file,
        item: {
          id: marcadores.get(file.name) ?? nextId(),
          name: file.name,
          size: file.size,
          loading: true,
          etapa: 'Abrindo o documento...',
        } satisfies ArquivoNaFila,
      }));

      for (const { file } of batch) marcadores.delete(file.name);
      setItems((current) => {
        const novos = batch.map((b) => b.item);
        if (!tool.multiple) return novos;

        const substituidos = new Set(novos.map((n) => n.id));
        return [...current.filter((i) => !substituidos.has(i.id)), ...novos];
      });

      // Pré-carregamento: enquanto o usuário ajusta as opções, já lemos o
      // arquivo, contamos as páginas e geramos a miniatura.
      void (async () => {
        for (const { file, item } of batch) {
          try {
            const data = await inspectFile(file, item.id);
            setItems((current) =>
              current.map((existing) =>
                existing.id === item.id ? { ...existing, loading: false, data, error: data.error } : existing,
              ),
            );
          } catch (e) {
            setItems((current) =>
              current.map((existing) =>
                existing.id === item.id
                  ? { ...existing, loading: false, error: e instanceof Error ? e.message : 'Falha ao ler o arquivo.' }
                  : existing,
              ),
            );
          }
        }
      })();
    },
    [tool.accept, tool.acceptLabel, tool.multiple, items],
  );

  // No aplicativo, arquivo aberto pelo Explorador ou pelo menu do botao
  // direito entra direto na ferramenta que estiver na tela.
  useEffect(() => aoReceberArquivosDoSistema(addFiles), [addFiles]);

  /** Destrava um PDF protegido com a senha que a pessoa digitou. */
  async function destravar(id: string, senha: string) {
    const alvo = items.find((item) => item.id === id);
    if (!alvo?.data) return;
    const liberado = await desbloquearArquivo(alvo.data, senha);
    setItems((atuais) =>
      atuais.map((item) => (item.id === id ? { ...item, data: liberado, error: undefined } : item)),
    );
    setError(null);
  }

  /**
   * Repete o arquivo na fila.
   *
   * Serve para juntar o mesmo documento duas vezes, imprimir duas cópias
   * dele no meio de outros, ou comparar dois ajustes lado a lado. O conteúdo
   * é o mesmo objeto: não custa memória nova.
   */
  function duplicarItem(id: string) {
    setItems((atuais) => {
      const posicao = atuais.findIndex((item) => item.id === id);
      if (posicao < 0) return atuais;
      const copia = { ...atuais[posicao], id: nextId() };
      return [...atuais.slice(0, posicao + 1), copia, ...atuais.slice(posicao + 1)];
    });
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  /** "arquivo 2" antes de "arquivo 10": comparação com collation numérica. */
  function sortByName(direction: 'asc' | 'desc') {
    setItems((current) =>
      [...current].sort((a, b) => {
        const compared = a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' });
        return direction === 'asc' ? compared : -compared;
      }),
    );
  }

  function move(from: number, to: number) {
    setItems((current) => {
      if (to < 0 || to >= current.length) return current;
      const copy = [...current];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      return copy;
    });
  }

  // Arquivo travado não conta como pronto: o botão só libera depois que a
  // pessoa informa a senha ali no card. A exceção é a ferramenta de
  // desbloqueio, que recebe a senha pelo próprio formulário.
  const ready = items.filter(
    (item) => item.data && (!item.error || (tool.allowLocked && item.data.locked)),
  );
  const travados = items.filter((item) => item.data?.locked && !tool.allowLocked).length;
  const busy = items.some((item) => item.loading);
  // Ferramenta sem arquivo tira a entrada dos campos, então não faz sentido
  // esperar por uma fila que nunca vai existir.
  const canRun =
    (tool.semArquivo || ready.length > 0) && !busy && travados === 0 && phase !== 'running';
  const totalBytes = ready.reduce((sum, item) => sum + item.size, 0);
  const totalPages = ready.reduce((sum, item) => sum + (item.data?.pageCount ?? 0), 0);

  const visibleFields = useMemo(
    () => tool.fields.filter((field) => isFieldVisible(field, options)),
    [tool.fields, options],
  );

  // Identidade estável: o organizador republica o plano a cada edição e uma
  // função nova a cada render viraria laço infinito.
  const handlePlanChange = useCallback((plan: PagePlanItem[]) => {
    setOptions((current) => ({ ...current, plan: JSON.stringify(plan) }));
  }, []);

  const handleElementosChange = useCallback((elementos: ElementoEditor[]) => {
    setOptions((current) => ({ ...current, elementos: JSON.stringify(elementos) }));
  }, []);

  async function run() {
    if (!canRun) return;
    if (resultIdRef.current) {
      vault.purge(resultIdRef.current, 'manual');
      resultIdRef.current = null;
    }
    setError(null);
    setResult(null);
    setPhase('running');
    setProgress({ fraction: 0, label: 'Preparando...' });
    inicioRef.current = performance.now();
    setRegistro([{ texto: `Lendo ${ready.length} arquivo(s), ${formatBytes(totalBytes)}`, em: performance.now() }]);

    // Um PDF construído para nunca terminar não pode prender a aba para sempre,
    // e o usuário precisa conseguir desistir a qualquer momento.
    const controller = new AbortController();
    abortRef.current = controller;

    // O painel da direita mostra isso, e o cancelar de lá é este mesmo.
    const tarefa = atividade.abrir(tool.name, 'ferramenta', () => cancelar());
    atividade.registrar(tarefa, `Lendo ${ready.length} arquivo(s), ${formatBytes(totalBytes)}`, 0);
    const limite = window.setTimeout(() => controller.abort(), LIMITES.tempoOperacaoMs);

    const startedAt = performance.now();
    try {
      // Ferramenta de página própria nunca chega aqui: a grade leva direto
      // para a rota dela.
      if (!tool.operation) throw new Error('Esta ferramenta tem tela própria.');
      const data = await runOperation(tool.operation, {
        files: ready.map((item) => item.data!),
        options,
        signal: controller.signal,
        onProgress: (fraction, label) => {
          setProgress({ fraction: Math.min(1, Math.max(0, fraction)), label: label ?? '' });
          atividade.registrar(tarefa, label ?? '', fraction);
          if (!label) return;
          setRegistro((atual) => {
            // Repetir a mesma linha não informa nada e enche a lista.
            if (atual[atual.length - 1]?.texto === label) return atual;
            const proximo = [...atual, { texto: label, em: performance.now() }];
            // Um documento de mil páginas geraria mil linhas: guardamos o fim.
            return proximo.length > 400 ? proximo.slice(-400) : proximo;
          });
        },
      });
      // No aplicativo o arquivo e da pessoa e fica no disco; no site o
      // resultado so vive na memoria da aba e precisa sair de la.
      const entry = vault.store(data.files, estaNoAplicativo() ? SEM_PRAZO : DEFAULT_TTL_MS);
      resultIdRef.current = entry.id;
      setResult({ id: entry.id, data, elapsed: performance.now() - startedAt });
      atividade.fechar(tarefa, 'concluida', `${data.files.length} arquivo(s) gerado(s)`);
      setPhase('done');
    } catch (e) {
      const cancelado = e instanceof OperacaoCancelada || (e as Error)?.name === 'OperacaoCancelada';
      const estourouTempo = cancelado && !cancelamentoManualRef.current;
      setError(
        cancelado
          ? estourouTempo
            ? `A operação passou de ${Math.round(LIMITES.tempoOperacaoMs / 60000)} minutos e foi interrompida. O arquivo pode ser grande ou estar corrompido.`
            : 'Operação cancelada.'
          : e instanceof Error
            ? e.message
            : 'Algo deu errado ao processar o arquivo.',
      );
      atividade.fechar(
        tarefa,
        cancelado ? 'cancelada' : 'erro',
        cancelado ? undefined : e instanceof Error ? e.message : undefined,
      );
      setPhase('idle');
    } finally {
      window.clearTimeout(limite);
      abortRef.current = null;
      cancelamentoManualRef.current = false;
    }
  }

  function cancelar() {
    cancelamentoManualRef.current = true;
    abortRef.current?.abort();
  }

  function reset() {
    if (resultIdRef.current) {
      vault.purge(resultIdRef.current, 'manual');
      resultIdRef.current = null;
    }
    setItems([]);
    setResult(null);
    setPhase('idle');
    setProgress({ fraction: 0, label: '' });
    setError(null);
  }

  const actionBlock = (
    <>
      {aviso && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{aviso}</span>
        </div>
      )}

      {error && (
        <div className="flex gap-2.5 rounded-xl border border-rose-500/40 bg-rose-500/5 p-3 text-xs leading-relaxed text-rose-500">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {phase === 'running' ? (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line/60">
            <div
              className="h-full rounded-full transition-[width] duration-200"
              style={{
                width: `${Math.max(4, progress.fraction * 100)}%`,
                backgroundImage: 'linear-gradient(90deg, rgb(var(--brand)), rgb(var(--brand2)))',
              }}
            />
          </div>
          <p className="mt-2.5 flex items-center gap-2 text-xs text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="truncate">{progress.label || 'Processando...'}</span>
            <span className="ml-auto tabular-nums">{Math.round(progress.fraction * 100)}%</span>
          </p>
          <RegistroDeProgresso
            linhas={registro}
            aberto={registroAberto}
            onAlternar={() => setRegistroAberto((v) => !v)}
            inicio={inicioRef.current}
          />
          <button type="button" onClick={cancelar} className="btn-ghost mt-3 w-full py-2 text-xs">
            <X className="h-3.5 w-3.5" /> Cancelar
          </button>
        </div>
      ) : (
        <button type="button" onClick={run} disabled={!canRun} className="btn-primary w-full py-3 text-[15px]">
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Lendo arquivos...
            </>
          ) : travados > 0 ? (
            <>
              <Lock className="h-4 w-4" />
              {travados === 1 ? 'Informe a senha do arquivo' : `Informe a senha de ${travados} arquivos`}
            </>
          ) : (
            tool.cta
          )}
        </button>
      )}

      <p className="text-center text-[11px] leading-relaxed text-muted">
        Seus arquivos não saem deste dispositivo. O resultado é apagado da memória após o download.
      </p>
    </>
  );

  return (
    <div
      className={cx(
        'mx-auto px-4 pb-8 sm:px-6',
        (tool.board || tool.editor) && phase !== 'done' ? 'max-w-6xl' : 'max-w-5xl',
      )}
    >
      <header className={cx('pb-8', noApp ? 'pt-6' : 'pt-10 sm:pt-14')}>
        {!noApp && (
          <Link
            href="/#ferramentas"
            className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" /> Todas as ferramentas
          </Link>
        )}

        <div className={cx('flex items-start gap-4', !noApp && 'mt-5')}>
          <span
            className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-line bg-elevated text-brand"
            style={noApp ? undefined : { background: `rgb(${tool.accent} / 0.12)`, borderColor: `rgb(${tool.accent} / 0.3)` }}
          >
            <ToolIcon name={tool.icon} className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{tool.name}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted sm:text-[15px]">{tool.description}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {!noApp && (
            <>
              <span className="chip">
                <Lock className="h-3.5 w-3.5" /> Roda no seu navegador
              </span>
              <span className="chip">
                <Sparkles className="h-3.5 w-3.5" /> Apaga depois do download
              </span>
            </>
          )}
          <span className={cx('chip', engine === 'ready' && 'border-emerald-500/40 text-emerald-500')}>
            {engine === 'ready' ? (
              <>
                <Zap className="h-3.5 w-3.5" /> Motor pronto
              </>
            ) : (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando motor...
              </>
            )}
          </span>
        </div>
      </header>

      {phase === 'done' && result ? (
        <ResultPanel entryId={result.id} result={result.data} elapsedMs={result.elapsed} onReset={reset} />
      ) : items.length === 0 && !tool.semArquivo ? (
        <Dropzone
          accept={tool.accept}
                  onEscolhidos={mostrarEscolhidos}
                  onLendo={marcarLeitura}
                  onFalha={descartarMarcadores}
          acceptLabel={tool.acceptLabel}
          multiple={tool.multiple}
          onFiles={addFiles}
        />
      ) : tool.editor ? (
        ready[0]?.data ? (
          <div className="space-y-4">
            <PdfEditor
              file={ready[0].data}
              focoAssinatura={tool.editor === 'assinatura'}
              onElementosChange={handleElementosChange}
            />
            <div className="card space-y-4 p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <p className="text-xs leading-relaxed text-muted">
                  Nada é aplicado no arquivo enquanto você edita. Só ao salvar.
                </p>
                <button type="button" onClick={reset} className="btn-ghost ml-auto shrink-0 px-3 py-2 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Trocar arquivo
                </button>
              </div>
              {actionBlock}
            </div>
          </div>
        ) : (
          <div className="card flex items-center justify-center gap-2.5 p-10 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            {items[0]?.error ?? 'Lendo o documento...'}
          </div>
        )
      ) : tool.board ? (
        ready[0]?.data ? (
          <div className="space-y-4">
            <PageBoard file={ready[0].data} mode={tool.board} onPlanChange={handlePlanChange} />
            <div className="card space-y-4 p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <p className="text-xs leading-relaxed text-muted">{BOARD_HINTS[tool.board]}</p>
                <button type="button" onClick={reset} className="btn-ghost ml-auto shrink-0 px-3 py-2 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Trocar arquivo
                </button>
              </div>
              {actionBlock}
            </div>
          </div>
        ) : (
          <div className="card flex items-center justify-center gap-2.5 p-10 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            {items[0]?.error ?? 'Lendo o documento...'}
          </div>
        )
      ) : (
        <div
          className={cx(
            'grid min-w-0 gap-5 lg:items-start',
            // Sem coluna de arquivos, a de opcoes ocupa a largura toda em vez
            // de ficar espremida ao lado de um vazio.
            tool.semArquivo ? 'mx-auto max-w-2xl' : 'lg:grid-cols-[1.15fr_1fr]',
          )}
        >
          {!tool.semArquivo && (
          <FilaDeArquivos
            tool={tool}
            items={items}
            totalBytes={totalBytes}
            totalPages={totalPages}
            onOrdenar={sortByName}
            onMover={move}
            onDuplicar={duplicarItem}
            onRemover={removeItem}
            onDestravar={destravar}
            onTrocarArquivo={reset}
            onFiles={addFiles}
            onEscolhidos={mostrarEscolhidos}
            onLendo={marcarLeitura}
            onFalha={descartarMarcadores}
          />
          )}

          {/* Opções + ação */}
          <div className="card min-w-0 space-y-5 p-4 sm:p-5 lg:sticky lg:top-24">
            {visibleFields.length > 0 ? (
              <>
                <h2 className="text-sm font-semibold tracking-tight">Opções</h2>
                <div className="space-y-5">
                  {visibleFields.map((field) => (
                    <OptionField
                      key={field.key}
                      field={field}
                      value={options[field.key]}
                      onChange={(value) => setOptions((current) => ({ ...current, [field.key]: value }))}
                    />
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm leading-relaxed text-muted">
                Esta ferramenta não precisa de configuração. É só executar.
              </p>
            )}

            {actionBlock}
          </div>
        </div>
      )}
    </div>
  );
}
