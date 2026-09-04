'use client';

import { ArrowDownAZ, ArrowUpZA, Copy, FileText, GripVertical, Loader2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { DesbloquearArquivo } from './DesbloquearArquivo';
import { Dropzone } from './Dropzone';
import type { LoadedFile } from '@/lib/pdf/engine';
import type { Tool } from '@/lib/tools';
import { cx, formatBytes } from '@/lib/utils';
import type { ArquivoEscolhido } from '@/lib/desktop';

/**
 * Um arquivo na fila, do momento em que entra até estar lido.
 *
 * O nome e o tamanho existem antes do conteúdo: no aplicativo o diálogo do
 * Windows devolve isso de imediato e a leitura vem depois, então a linha
 * aparece na tela com a barra de progresso em vez de a tela ficar parada.
 */
export type ArquivoNaFila = {
  id: string;
  name: string;
  size: number;
  loading: boolean;
  /** "Lendo 42%", "Abrindo o PDF" — o que está acontecendo com este arquivo. */
  etapa?: string;
  data?: LoadedFile;
  error?: string;
};

/**
 * A coluna dos arquivos: o que entrou, em que ordem, e o que fazer com cada um.
 *
 * Fica separada do resto da área de trabalho porque é a única parte que muda
 * conforme a ferramenta aceita um arquivo ou vários, e conforme a ordem das
 * páginas importa ou não.
 */
export function FilaDeArquivos({
  tool,
  items,
  totalBytes,
  totalPages,
  onOrdenar,
  onMover,
  onDuplicar,
  onRemover,
  onDestravar,
  onTrocarArquivo,
  onFiles,
  onEscolhidos,
  onLendo,
  onFalha,
}: {
  tool: Tool;
  items: ArquivoNaFila[];
  totalBytes: number;
  totalPages: number;
  onOrdenar: (direcao: 'asc' | 'desc') => void;
  onMover: (de: number, para: number) => void;
  onDuplicar: (id: string) => void;
  onRemover: (id: string) => void;
  onDestravar: (id: string, senha: string) => Promise<void>;
  onTrocarArquivo: () => void;
  onFiles: (files: File[]) => void;
  onEscolhidos: (escolhidos: ArquivoEscolhido[]) => void;
  onLendo: (nome: string, lidos: number, total: number) => void;
  onFalha: (nomes: string[], erro: string) => void;
}) {
  // Só a linha que está sendo arrastada precisa saber disso, então o estado
  // mora aqui e não sobe para a área de trabalho inteira.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const arrastavel = Boolean(tool.orderable) && items.length > 1;

  return (
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

      {arrastavel && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Ordenar:</span>
          <button type="button" onClick={() => onOrdenar('asc')} className="btn-ghost px-2.5 py-1 text-xs">
            <ArrowDownAZ className="h-3.5 w-3.5" /> A a Z
          </button>
          <button type="button" onClick={() => onOrdenar('desc')} className="btn-ghost px-2.5 py-1 text-xs">
            <ArrowUpZA className="h-3.5 w-3.5" /> Z a A
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {items.map((item, index) => (
          <li
            key={item.id}
            draggable={arrastavel}
            onDragStart={() => setDragIndex(index)}
            onDragEnd={() => setDragIndex(null)}
            onDragOver={(event) => {
              if (dragIndex === null || dragIndex === index) return;
              event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragIndex !== null && dragIndex !== index) onMover(dragIndex, index);
              setDragIndex(null);
            }}
            className={cx(
              'rounded-xl border p-2.5 transition',
              dragIndex === index ? 'opacity-40' : 'hover:border-brand/40',
              item.error &&
                (item.data?.locked ? 'border-amber-500/40 bg-amber-500/5' : 'border-rose-500/40 bg-rose-500/5'),
            )}
          >
            <div className="flex items-center gap-3">
              {arrastavel && (
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
                      ? (item.etapa ?? 'Lendo...')
                      : `${formatBytes(item.size)}${item.data?.pageCount ? ` · ${item.data.pageCount} páginas` : ''}`}
                </p>
              </div>

              {arrastavel && (
                <span className="hidden shrink-0 gap-1 sm:flex">
                  <button
                    type="button"
                    onClick={() => onMover(index, index - 1)}
                    disabled={index === 0}
                    className="rounded-md px-1.5 text-muted transition hover:text-ink disabled:opacity-30"
                    aria-label="Mover para cima"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => onMover(index, index + 1)}
                    disabled={index === items.length - 1}
                    className="rounded-md px-1.5 text-muted transition hover:text-ink disabled:opacity-30"
                    aria-label="Mover para baixo"
                  >
                    ↓
                  </button>
                </span>
              )}

              {tool.multiple && !item.loading && item.data && (
                <button
                  type="button"
                  onClick={() => onDuplicar(item.id)}
                  className="shrink-0 rounded-lg p-1.5 text-muted transition hover:text-ink"
                  title="Repetir este arquivo na fila"
                  aria-label={`Duplicar ${item.name}`}
                >
                  <Copy className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onRemover(item.id)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-rose-500/10 hover:text-rose-500"
                aria-label={`Remover ${item.name}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {item.data?.locked && (
              <DesbloquearArquivo nomeDoArquivo={item.name} onDesbloquear={(senha) => onDestravar(item.id, senha)} />
            )}
          </li>
        ))}
      </ul>

      {tool.multiple ? (
        <div className="mt-3">
          <Dropzone
            accept={tool.accept}
            onEscolhidos={onEscolhidos}
            onLendo={onLendo}
            onFalha={onFalha}
            acceptLabel={tool.acceptLabel}
            multiple
            compact
            onFiles={onFiles}
          />
        </div>
      ) : (
        <button type="button" onClick={onTrocarArquivo} className="btn-ghost mt-3 w-full">
          <Plus className="h-4 w-4" /> Trocar arquivo
        </button>
      )}
    </div>
  );
}
