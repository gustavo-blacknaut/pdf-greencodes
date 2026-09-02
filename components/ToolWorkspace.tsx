'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  ArrowDownAZ,
  ArrowLeft,
  ArrowUpZA,
  FileText,
  GripVertical,
  Loader2,
  Lock,
  Plus,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { DesbloquearArquivo } from './DesbloquearArquivo';
import { Dropzone } from './Dropzone';
import { OptionField } from './OptionField';
import { PageBoard } from './PageBoard';
import { PdfEditor } from './PdfEditor';
import { RegistroDeProgresso, type LinhaDoRegistro } from './RegistroDeProgresso';
import { ResultPanel } from './ResultPanel';
import { ToolIcon } from './ToolIcon';
import { atividade } from '@/lib/atividade';
import { vault } from '@/lib/ephemeral';
import {
  desbloquearArquivo,
  inspectFile,
  runOperation,
  type ElementoEditor,
  type LoadedFile,
  type PagePlanItem,
  type RunResult,
} from '@/lib/pdf/engine';
import { LIMITES, OperacaoCancelada, validarFila } from '@/lib/pdf/guards';
import { getEngineStatus, subscribeEngineStatus, warmEngine, type EngineStatus } from '@/lib/pdf/lazy';
import { defaultOptions, isFieldVisible, type BoardMode, type Tool } from '@/lib/tools';
import { cx, formatBytes } from '@/lib/utils';
import { aoReceberArquivosDoSistema } from '@/lib/desktop';

const BOARD_HINTS: Record<BoardMode, string> = {
  organize: 'Arraste as miniaturas para reordenar. Passe o mouse numa página para girar ou excluir.',
  remove: 'Clique nas páginas que devem sair. Clique de novo para desmarcar.',
  keep: 'Clique nas páginas que vão para o novo arquivo.',
  rotate: 'Cada clique numa página gira 90° para a direita.',
};

type Item = {
  id: string;
  name: string;
  size: number;
  loading: boolean;
  data?: LoadedFile;
  error?: string;
};

type Phase = 'idle' | 'running' | 'done';

let counter = 0;
const nextId = () => `f${(counter += 1)}_${Date.now().toString(36)}`;

export function ToolWorkspace({ tool }: { tool: Tool }) {
  const [items, setItems] = useState<Item[]>([]);
  const [options, setOptions] = useState(() => defaultOptions(tool));
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ fraction: 0, label: '' });
  const [result, setResult] = useState<{ id: string; data: RunResult; elapsed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<EngineStatus>('cold');
  const [dragIndex, setDragIndex] = useState<number | null>(null);

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

  useEffect(() => {
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
        const ehImagem = /\.(jpe?g|png|webp)$/.test(name) || file.type.startsWith('image/');
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

      const batch = (tool.multiple ? accepted : accepted.slice(0, 1)).map((file) => ({
        file,
        item: { id: nextId(), name: file.name, size: file.size, loading: true } satisfies Item,
      }));

      setItems((current) => (tool.multiple ? [...current, ...batch.map((b) => b.item)] : batch.map((b) => b.item)));

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
  const canRun = ready.length > 0 && !busy && travados === 0 && phase !== 'running';
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
      const entry = vault.store(data.files);
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
      ) : items.length === 0 ? (
        <Dropzone
          accept={tool.accept}
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
        <div className="grid min-w-0 gap-5 lg:grid-cols-[1.15fr_1fr] lg:items-start">
          {/* Arquivos */}
          <div className="card min-w-0 p-4 sm:p-5">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-tight">
                {items.length} arquivo{items.length > 1 ? 's' : ''}
              </h2>
              <p className="text-xs tabular-nums text-muted">
                {formatBytes(totalBytes)}
                {totalPages > 0 ? ` · ${totalPages} páginas` : ''}
              </p>
            </div>

            {tool.orderable && items.length > 1 && (
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted">Ordenar:</span>
                <button type="button" onClick={() => sortByName('asc')} className="btn-ghost px-2.5 py-1 text-xs">
                  <ArrowDownAZ className="h-3.5 w-3.5" /> A a Z
                </button>
                <button type="button" onClick={() => sortByName('desc')} className="btn-ghost px-2.5 py-1 text-xs">
                  <ArrowUpZA className="h-3.5 w-3.5" /> Z a A
                </button>
              </div>
            )}

            <ul className="space-y-2">
              {items.map((item, index) => (
                <li
                  key={item.id}
                  draggable={tool.orderable && items.length > 1}
                  onDragStart={() => setDragIndex(index)}
                  onDragEnd={() => setDragIndex(null)}
                  onDragOver={(event) => {
                    if (dragIndex === null || dragIndex === index) return;
                    event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragIndex !== null && dragIndex !== index) move(dragIndex, index);
                    setDragIndex(null);
                  }}
                  className={cx(
                    'rounded-xl border p-2.5 transition',
                    dragIndex === index ? 'opacity-40' : 'hover:border-brand/40',
                    item.error &&
                      (item.data?.locked
                        ? 'border-amber-500/40 bg-amber-500/5'
                        : 'border-rose-500/40 bg-rose-500/5'),
                  )}
                >
                  <div className="flex items-center gap-3">
                  {tool.orderable && items.length > 1 && (
                    <span className="cursor-grab text-muted active:cursor-grabbing" aria-hidden>
                      <GripVertical className="h-4 w-4" />
                    </span>
                  )}

                  <span className="grid h-14 w-11 shrink-0 place-items-center overflow-hidden rounded-lg border bg-elevated">
                    {item.loading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted" />
                    ) : item.data?.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.data.thumbnail} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <FileText className="h-4 w-4 text-muted" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="truncate text-xs text-muted">
                      {item.error
                        ? item.error
                        : item.loading
                          ? 'Lendo...'
                          : `${formatBytes(item.size)}${item.data?.pageCount ? ` · ${item.data.pageCount} páginas` : ''}`}
                    </p>
                  </div>

                  {tool.orderable && items.length > 1 && (
                    <span className="hidden shrink-0 gap-1 sm:flex">
                      <button
                        type="button"
                        onClick={() => move(index, index - 1)}
                        disabled={index === 0}
                        className="rounded-md px-1.5 text-muted transition hover:text-ink disabled:opacity-30"
                        aria-label="Mover para cima"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => move(index, index + 1)}
                        disabled={index === items.length - 1}
                        className="rounded-md px-1.5 text-muted transition hover:text-ink disabled:opacity-30"
                        aria-label="Mover para baixo"
                      >
                        ↓
                      </button>
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-rose-500/10 hover:text-rose-500"
                    aria-label={`Remover ${item.name}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                  </div>

                  {item.data?.locked && (
                    <DesbloquearArquivo
                      nomeDoArquivo={item.name}
                      onDesbloquear={(senha) => destravar(item.id, senha)}
                    />
                  )}
                </li>
              ))}
            </ul>

            {tool.multiple && (
              <div className="mt-3">
                <Dropzone
                  accept={tool.accept}
                  acceptLabel={tool.acceptLabel}
                  multiple
                  compact
                  onFiles={addFiles}
                />
              </div>
            )}

            {!tool.multiple && (
              <button type="button" onClick={reset} className="btn-ghost mt-3 w-full">
                <Plus className="h-4 w-4" /> Trocar arquivo
              </button>
            )}
          </div>

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
