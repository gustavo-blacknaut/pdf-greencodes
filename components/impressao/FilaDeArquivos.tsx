'use client';

import { AlertTriangle, Check, FileText, Loader2, X } from 'lucide-react';
import { Dropzone } from '../Dropzone';
import { cx, formatBytes } from '@/lib/utils';
import type { ItemFila } from './tipos';

/**
 * Os arquivos esperando para sair na impressora, com o estado de cada um.
 *
 * Clicar num que já está pronto troca a prévia; o X tira da fila. A área de
 * soltar no rodapé deixa somar mais arquivos sem recomeçar.
 */
export function FilaDeArquivos({
  fila,
  selecionado,
  imprimindo,
  totalPaginas,
  preparando,
  aceita,
  onSelecionar,
  onRemover,
  onAdicionar,
}: {
  fila: ItemFila[];
  selecionado: string | null;
  imprimindo: string | null;
  totalPaginas: number;
  preparando: boolean;
  aceita: string[];
  onSelecionar: (id: string) => void;
  onRemover: (id: string) => void;
  onAdicionar: (arquivos: File[]) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <p className="flex-1 text-sm font-medium">
          Fila · {fila.length} arquivo{fila.length === 1 ? '' : 's'}
          {totalPaginas > 0 && <span className="text-muted"> · {totalPaginas} páginas</span>}
        </p>
        {preparando && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparando...
          </span>
        )}
      </div>

      <ul className="divide-y">
        {fila.map((linha) => (
          <li
            key={linha.id}
            className={cx(
              'flex items-center gap-3 px-4 py-2.5',
              linha.id === selecionado && 'bg-elevated/60',
            )}
          >
            <button
              type="button"
              onClick={() => linha.blob && onSelecionar(linha.id)}
              disabled={!linha.blob}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
            >
              <span className="shrink-0 text-muted">
                {linha.estado === 'convertendo' || imprimindo === linha.id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-brand" />
                ) : linha.estado === 'impresso' ? (
                  <Check className="h-4 w-4 text-brand" />
                ) : linha.estado === 'erro' ? (
                  <AlertTriangle className="h-4 w-4 text-rose-500" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{linha.nomeOriginal}</span>
                <span className="block truncate text-xs text-muted">
                  {linha.estado === 'erro'
                    ? linha.erro
                    : linha.estado === 'convertendo'
                      ? 'Convertendo...'
                      : linha.estado === 'esperando'
                        ? 'Na fila'
                        : linha.estado === 'impresso'
                          ? 'Enviado para a impressora'
                          : `${formatBytes(linha.blob!.size)} · ${linha.paginas} página${linha.paginas === 1 ? '' : 's'}`}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRemover(linha.id)}
              className="shrink-0 text-muted transition hover:text-ink"
              aria-label={`Tirar ${linha.nomeOriginal} da fila`}
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      <div className="border-t p-3">
        <Dropzone
          accept={aceita}
          acceptLabel="PDF, imagem, Word, Excel ou texto"
          multiple
          compact
          onFiles={onAdicionar}
        />
      </div>
    </div>
  );
}
