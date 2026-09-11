'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  Chrome,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Info,
  MonitorPlay,
  Printer,
  RotateCcw,
  Timer,
  Trash2,
} from 'lucide-react';
import { ConviteDoAplicativo } from './ConviteDoAplicativo';
import { vault } from '@/lib/ephemeral';
import { zipFiles, type OperationId, type RunResult } from '@/lib/pdf/engine';
import { cx, formatBytes, formatDuration } from '@/lib/utils';
import {
  abrirNoAplicativo,
  abrirNoNavegador,
  abrirNoSistema,
  definirAutoExclusao,
  estaNoAplicativo,
  revelarNoExplorador,
  salvarNumerado,
} from '@/lib/desktop';

export function ResultPanel({
  entryId,
  result,
  elapsedMs,
  operacao = null,
  onReset,
}: {
  entryId: string;
  result: RunResult;
  elapsedMs: number;
  /** A operação que gerou o resultado: o convite do site só promete velocidade onde foi medida. */
  operacao?: OperationId | null;
  onReset: () => void;
}) {
  const router = useRouter();
  const [, force] = useState(0);
  const [remaining, setRemaining] = useState(() => {
    const entry = vault.get(entryId);
    return entry ? entry.expiresAt - Date.now() : 0;
  });
  const [zipping, setZipping] = useState(false);
  // No aplicativo o resultado vai para o disco, então não há download nem
  // contagem regressiva: o arquivo é seu e fica onde você mandar.
  //
  // Sabido já no primeiro desenho, e não num efeito depois dele: começando
  // em `false`, a máquina fraca da loja chegava a mostrar por um instante a
  // tela do site — "apaga em Infinity:NaN" e um botão Baixar. Este painel só
  // existe depois de uma ferramenta rodar, nunca na página pré-montada, então
  // não há hidratação para desencontrar.
  const [noApp] = useState(estaNoAplicativo);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  // Auto-exclusão: desligada por padrão, porque o arquivo é da pessoa. Quem
  // só queria imprimir e não quer a pasta entupindo liga aqui, e o que já
  // foi salvo muda de ideia sem precisar salvar de novo.
  const [apagarEm1Dia, setApagarEm1Dia] = useState(false);
  const [salvos, setSalvos] = useState<string[]>([]);
  /**
   * Onde cada arquivo foi parar no disco.
   *
   * Sem isto, abrir um arquivo que já tinha sido gravado gravaria de novo,
   * com o próximo número livre — e a pasta encheria de cópias do mesmo PDF.
   */
  const [caminhoDe, setCaminhoDe] = useState<Record<string, string>>({});
  const [gravando, setGravando] = useState(false);
  const [bulkDownloaded, setBulkDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => vault.subscribe(() => force((n) => n + 1)), []);

  /**
   * No aplicativo, o arquivo vai para o disco assim que fica pronto.
   *
   * Antes ele só era gravado quando alguém clicava em "Abrir" ou "Salvar".
   * Quem processava e fechava a janela perdia o trabalho sem aviso — o
   * resultado vivia só na memória da aba. E quem só queria o arquivo tinha
   * que pedir duas vezes: uma para converter, outra para guardar.
   *
   * No site isto não acontece e não tem como acontecer: o navegador não
   * escreve na pasta de downloads sem a pessoa mandar. Lá o botão continua.
   */
  useEffect(() => {
    const atual = vault.get(entryId);
    if (!noApp || !atual) return;

    let cancelado = false;
    setGravando(true);

    (async () => {
      const caminhos: string[] = [];
      const porNome: Record<string, string> = {};

      for (const arquivo of atual.files) {
        // O arquivo grande já saiu do motor direto para Downloads: gravar de
        // novo seria ler 2 GB para escrever os mesmos 2 GB ao lado.
        if (arquivo.caminho) {
          caminhos.push(arquivo.caminho);
          porNome[arquivo.name] = arquivo.caminho;
          continue;
        }
        const salvo = await salvarNumerado(arquivo.name, arquivo.blob, false);
        if (cancelado) return;
        if (!salvo.ok || !salvo.caminho) {
          setError(salvo.erro ?? 'Não foi possível salvar o arquivo automaticamente.');
          break;
        }
        caminhos.push(salvo.caminho);
        porNome[arquivo.name] = salvo.caminho;
      }

      if (cancelado) return;
      if (caminhos.length) {
        setSalvos(caminhos);
        setCaminhoDe(porNome);
        setSalvoEm(caminhos[caminhos.length - 1]);
      }
      setGravando(false);
    })();

    return () => {
      cancelado = true;
    };
    // De propósito só quando o aplicativo é reconhecido: o resultado desta
    // tela não muda de identidade sem a tela inteira ser remontada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noApp, entryId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const entry = vault.get(entryId);
      setRemaining(entry ? entry.expiresAt - Date.now() : 0);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [entryId]);

  const entry = vault.get(entryId);
  const savedRatio = result.inputBytes > 0 ? 1 - result.outputBytes / result.inputBytes : 0;
  const shrank = Boolean(result.highlightSavings) && savedRatio > 0.005;
  const anyDownloaded = Boolean(entry && entry.downloaded.size > 0);

  if (!entry) {
    return (
      <div className="card animate-fade-up p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border bg-elevated text-muted">
          <Trash2 className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-lg font-semibold tracking-tight">Resultado apagado</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
          Os arquivos foram removidos da memória do navegador, exatamente como combinado. Rode a ferramenta de novo se
          precisar deles.
        </p>
        <button type="button" onClick={onReset} className="btn-primary mx-auto mt-6">
          <RotateCcw className="h-4 w-4" /> Recomeçar
        </button>
      </div>
    );
  }

  function downloadOne(fileName: string) {
    setError(null);
    try {
      // Repetir o download é o sinal de que a pessoa já guardou o arquivo.
      vault.download(entryId, fileName, { purgeAfter: entry!.downloaded.has(fileName) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao baixar.');
    }
  }

  /**
   * A impressão tem tela própria, com prévia e opções. Mandamos o id do cofre
   * na URL em vez do arquivo: o blob continua só na memória desta aba.
   */
  function irParaImpressao(nome: string) {
    const base = window.location.pathname.startsWith('/app') ? '/app/imprimir' : '/imprimir';
    router.push(`${base}?fonte=${encodeURIComponent(entryId)}&arquivo=${encodeURIComponent(nome)}`);
  }

  /**
   * Abre o arquivo, gravando antes só se ainda não estiver no disco.
   *
   * No aplicativo ele já foi gravado assim que ficou pronto, então aqui
   * normalmente só resta abrir. Gravar de novo daria o próximo número livre
   * e deixaria duas cópias do mesmo PDF na pasta.
   */
  async function abrirUm(fileName: string) {
    setError(null);
    const arquivo = entry!.files.find((f) => f.name === fileName);
    if (!arquivo) return;

    // O que ficou no disco tem o caminho desde o começo, e o blob vazio:
    // gravar o blob ali seria gravar um arquivo de zero bytes.
    let caminho = caminhoDe[fileName] ?? arquivo.caminho;
    if (!caminho) {
      const salvo = await salvarNumerado(arquivo.name, arquivo.blob, apagarEm1Dia);
      if (!salvo.ok || !salvo.caminho) {
        setError(salvo.erro ?? 'Não foi possível salvar o arquivo.');
        return;
      }
      caminho = salvo.caminho;
      setCaminhoDe((antigos) => ({ ...antigos, [fileName]: caminho }));
      setSalvos((antigos) => [...antigos, caminho]);
    }

    setSalvoEm(caminho);
    // No próprio programa: é o que evita depender de qual leitor de PDF a
    // máquina tem instalado, e o que a pessoa pediu.
    const aberto = await abrirNoAplicativo(caminho);
    if (!aberto.ok) setError(aberto.erro ?? null);
  }

  /** Vários arquivos: cada um pega o próximo número livre da mesma pasta. */
  async function salvarTodos() {
    setError(null);
    if (entry!.files.length === 1) return abrirUm(entry!.files[0].name);

    const caminhos: string[] = [];
    for (const arquivo of entry!.files) {
      // O que a gravação automática, ou o motor, já pôs no disco não é
      // gravado de novo.
      const noDisco = caminhoDe[arquivo.name] ?? arquivo.caminho;
      if (noDisco) {
        caminhos.push(noDisco);
        continue;
      }
      const r = await salvarNumerado(arquivo.name, arquivo.blob, apagarEm1Dia);
      if (!r.ok || !r.caminho) {
        setError(r.erro ?? 'Não foi possível salvar os arquivos.');
        return;
      }
      caminhos.push(r.caminho);
    }
    if (caminhos.length > 0) {
      setSalvoEm(caminhos[caminhos.length - 1]);
      // `Set` porque a gravação automática já pode ter posto os mesmos
      // caminhos aqui: repetir faria a auto-exclusão passar duas vezes no
      // mesmo arquivo.
      setSalvos((antigos) => [...new Set([...antigos, ...caminhos])]);
      // Já estando tudo no disco, o que resta a fazer é mostrar onde.
      await revelarNoExplorador(caminhos[caminhos.length - 1]);
    }
  }

  /**
   * Muda a marca de auto-exclusão.
   *
   * Vale para o que ainda vai ser salvo e também para o que já foi: marcar
   * depois de salvar é justamente o caso comum — a pessoa imprime, vê que
   * deu certo, e só então decide que não precisa guardar.
   */
  async function trocarAutoExclusao(ligado: boolean) {
    setApagarEm1Dia(ligado);
    setError(null);
    for (const caminho of salvos) {
      if (!(await definirAutoExclusao(caminho, ligado))) {
        setError('Não foi possível mudar a auto-exclusão deste arquivo.');
        return;
      }
    }
  }

  async function downloadAll() {
    setError(null);
    if (entry!.files.length === 1) {
      downloadOne(entry!.files[0].name);
      return;
    }

    const purgeAfter = bulkDownloaded;
    setZipping(true);
    try {
      const blob = await zipFiles(entry!.files.map((f) => ({ name: f.name, blob: f.blob })));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'greencodes-resultado.zip';
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setBulkDownloaded(true);
      setTimeout(() => {
        URL.revokeObjectURL(url);
        if (purgeAfter) vault.purge(entryId, 'baixado');
      }, 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao compactar.');
    } finally {
      setZipping(false);
    }
  }

  return (
    <div className="card animate-fade-up overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b bg-elevated/60 px-5 py-4">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand/15 text-brand">
          <CheckCircle2 className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight">Pronto</p>
          <p className="text-xs text-muted">
            {entry.files.length} arquivo{entry.files.length > 1 ? 's' : ''} · {(elapsedMs / 1000).toFixed(1)}s
          </p>
        </div>

        {noApp ? (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-brand/40 px-3 py-1.5 text-xs text-brand">
            <HardDrive className="h-3.5 w-3.5" />
            {gravando ? 'salvando...' : salvos.length ? 'já salvo em Downloads' : 'salve onde quiser'}
          </span>
        ) : Number.isFinite(remaining) ? (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs tabular-nums text-muted">
            <Timer className="h-3.5 w-3.5" />
            apaga em {formatDuration(remaining)}
          </span>
        ) : null}
      </div>

      {shrank && (
        <div className="grid grid-cols-3 divide-x border-b text-center">
          <Stat label="Antes" value={formatBytes(result.inputBytes)} />
          <Stat label="Depois" value={formatBytes(result.outputBytes)} accent />
          <Stat label="Economia" value={`${Math.round(savedRatio * 100)}%`} accent />
        </div>
      )}

      <ul className="divide-y">
        {entry.files.map((file) => {
          const done = entry.downloaded.has(file.name);
          return (
            <li key={file.name} className="flex items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted">
                  {formatBytes(file.tamanho ?? file.blob.size)}
                  {file.pages ? ` · ${file.pages} página${file.pages > 1 ? 's' : ''}` : ''}
                </p>
              </div>
              {/* A impressão é do aplicativo: no site ela leva a uma página de
                  download. O arquivo que ficou no disco também fica de fora: a
                  prévia teria que carregá-lo inteiro na tela. */}
              {noApp && !file.caminho && file.name.toLowerCase().endsWith('.pdf') && (
                <button
                  type="button"
                  onClick={() => irParaImpressao(file.name)}
                  className="btn-ghost shrink-0 px-3 py-2"
                  title="Abre o diálogo de impressão do sistema"
                >
                  <Printer className="h-4 w-4" />
                  <span className="hidden sm:inline">Imprimir</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => (noApp ? abrirUm(file.name) : downloadOne(file.name))}
                className={cx('btn-ghost shrink-0 px-3 py-2', !noApp && done && 'text-brand')}
                title={!noApp && done ? 'Baixa outra cópia e apaga o arquivo da memória' : undefined}
              >
                {noApp ? <ExternalLink className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                <span className="hidden sm:inline">
                  {noApp ? 'Abrir' : done ? 'Baixar de novo' : 'Baixar'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {result.notes.length > 0 && (
        <div className="flex gap-2.5 border-t bg-elevated/50 px-5 py-3.5 text-xs leading-relaxed text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <ul className="space-y-1">
            {result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {salvoEm && (
        <div className="border-t bg-brand/5 px-5 py-3">
          <p className="flex items-center gap-2 text-xs text-brand">
            <HardDrive className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Salvo em {salvoEm}</span>
          </p>

          {/* Três destinos porque cada um serve a um momento: conferir sem
              sair do programa, abrir num leitor de verdade, ou ir ao arquivo. */}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => void abrirNoAplicativo(salvoEm)}
              className="btn-ghost px-3 py-1.5 text-[12px]"
            >
              <MonitorPlay className="h-3.5 w-3.5" /> Abrir aqui
            </button>
            <button
              type="button"
              onClick={() => void abrirNoNavegador(salvoEm)}
              className="btn-ghost px-3 py-1.5 text-[12px]"
            >
              <Chrome className="h-3.5 w-3.5" /> No navegador
            </button>
            <button
              type="button"
              onClick={() => void abrirNoSistema(salvoEm)}
              className="btn-ghost px-3 py-1.5 text-[12px]"
            >
              <ExternalLink className="h-3.5 w-3.5" /> No programa padrão
            </button>
            <button
              type="button"
              onClick={() => revelarNoExplorador(salvoEm)}
              className="btn-ghost px-3 py-1.5 text-[12px]"
            >
              <FolderOpen className="h-3.5 w-3.5" /> Mostrar na pasta
            </button>
          </div>
        </div>
      )}

      {error && <p className="border-t px-5 py-3 text-xs text-rose-500">{error}</p>}

      <div className="border-t px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={noApp ? salvarTodos : downloadAll}
            disabled={zipping}
            className="btn-primary"
          >
            {noApp ? <ExternalLink className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            {noApp
              ? entry.files.length > 1
                ? salvos.length
                  ? 'Abrir a pasta'
                  : 'Salvar todos'
                : 'Abrir'
              : entry.files.length > 1
                ? zipping
                  ? 'Compactando...'
                  : bulkDownloaded
                    ? 'Baixar tudo de novo (.zip)'
                    : 'Baixar tudo (.zip)'
                : anyDownloaded
                  ? 'Baixar de novo'
                  : 'Baixar'}
          </button>
          <button type="button" onClick={onReset} className="btn-ghost">
            <RotateCcw className="h-4 w-4" /> Novo arquivo
          </button>
          {noApp ? (
            <label className="btn ml-auto cursor-pointer select-none text-muted has-[:checked]:text-brand">
              <input
                type="checkbox"
                checked={apagarEm1Dia}
                onChange={(e) => void trocarAutoExclusao(e.target.checked)}
                className="h-3.5 w-3.5 accent-brand"
              />
              <Timer className="h-4 w-4" /> Apagar sozinho em 1 dia
            </label>
          ) : (
            <button
              type="button"
              onClick={() => vault.purge(entryId, 'manual')}
              className="btn ml-auto text-muted hover:text-rose-500"
            >
              <Trash2 className="h-4 w-4" /> Apagar agora
            </button>
          )}
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          {noApp ? (
            <>
              {salvos.length ? 'O arquivo já está solto na pasta ' : 'O arquivo vai solto para a pasta '}
              <strong className="font-medium text-ink">Downloads</strong>
              {salvos.length ? ', salvo assim que ficou pronto' : ' e fica lá'}, sem prazo, com nome de número — o mais
              novo é sempre o de número maior. Marque{' '}
              <strong className="font-medium text-ink">Apagar sozinho em 1 dia</strong> se for só para imprimir agora —
              vale para os que já foram salvos também.
            </>
          ) : (
            <>
          Baixar guarda o arquivo no seu computador e mantém a cópia aqui até o tempo acabar.{' '}
          <strong className="font-medium text-ink">Baixar de novo</strong> entrega mais uma cópia e apaga esta da
          memória na hora.
            </>
          )}
        </p>
      </div>

      {!noApp && <ConviteDoAplicativo operacao={operacao} segundos={elapsedMs / 1000} />}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="px-3 py-4">
      <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${accent ? 'text-brand' : ''}`}>{value}</p>
    </div>
  );
}
