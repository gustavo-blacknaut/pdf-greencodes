'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Download, HardDrive, Info, RotateCcw, Save, Timer, Trash2 } from 'lucide-react';
import { vault } from '@/lib/ephemeral';
import { zipFiles, type RunResult } from '@/lib/pdf/engine';
import { cx, formatBytes, formatDuration } from '@/lib/utils';
import { estaNoAplicativo, revelarNoExplorador, salvarArquivo, salvarVarios } from '@/lib/desktop';

export function ResultPanel({
  entryId,
  result,
  elapsedMs,
  onReset,
}: {
  entryId: string;
  result: RunResult;
  elapsedMs: number;
  onReset: () => void;
}) {
  const [, force] = useState(0);
  const [remaining, setRemaining] = useState(() => {
    const entry = vault.get(entryId);
    return entry ? entry.expiresAt - Date.now() : 0;
  });
  const [zipping, setZipping] = useState(false);
  // No aplicativo o resultado vai para o disco, então não há download nem
  // contagem regressiva: o arquivo é seu e fica onde você mandar.
  const [noApp, setNoApp] = useState(false);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  const [bulkDownloaded, setBulkDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => vault.subscribe(() => force((n) => n + 1)), []);

  useEffect(() => setNoApp(estaNoAplicativo()), []);

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

  /** No aplicativo: diálogo nativo de salvar, arquivo direto no disco. */
  async function salvarUm(fileName: string) {
    setError(null);
    const arquivo = entry!.files.find((f) => f.name === fileName);
    if (!arquivo) return;
    const r = await salvarArquivo(arquivo.name, arquivo.blob);
    if (r.ok && r.caminho) setSalvoEm(r.caminho);
    else if (r.erro) setError(r.erro);
  }

  async function salvarTodos() {
    setError(null);
    if (entry!.files.length === 1) return salvarUm(entry!.files[0].name);
    const r = await salvarVarios(entry!.files.map((f) => ({ nome: f.name, blob: f.blob })));
    if (r.ok && r.pasta) setSalvoEm(r.pasta);
    else if (r.erro) setError(r.erro);
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
            <HardDrive className="h-3.5 w-3.5" /> salve onde quiser
          </span>
        ) : (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs tabular-nums text-muted">
            <Timer className="h-3.5 w-3.5" />
            apaga em {formatDuration(remaining)}
          </span>
        )}
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
                  {formatBytes(file.blob.size)}
                  {file.pages ? ` · ${file.pages} página${file.pages > 1 ? 's' : ''}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => (noApp ? salvarUm(file.name) : downloadOne(file.name))}
                className={cx('btn-ghost shrink-0 px-3 py-2', !noApp && done && 'text-brand')}
                title={!noApp && done ? 'Baixa outra cópia e apaga o arquivo da memória' : undefined}
              >
                {noApp ? <Save className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                <span className="hidden sm:inline">
                  {noApp ? 'Salvar como...' : done ? 'Baixar de novo' : 'Baixar'}
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
        <div className="flex flex-wrap items-center gap-2 border-t bg-brand/5 px-5 py-3 text-xs text-brand">
          <Save className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Salvo em {salvoEm}</span>
          <button
            type="button"
            onClick={() => revelarNoExplorador(salvoEm)}
            className="shrink-0 underline underline-offset-2 hover:no-underline"
          >
            Mostrar na pasta
          </button>
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
            {noApp ? <Save className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            {noApp
              ? entry.files.length > 1
                ? 'Salvar todos numa pasta'
                : 'Salvar como...'
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
          {!noApp && (
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
            <>Você escolhe a pasta. O arquivo fica no seu disco, sem prazo para expirar.</>
          ) : (
            <>
          Baixar guarda o arquivo no seu computador e mantém a cópia aqui até o tempo acabar.{' '}
          <strong className="font-medium text-ink">Baixar de novo</strong> entrega mais uma cópia e apaga esta da
          memória na hora.
            </>
          )}
        </p>
      </div>
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
