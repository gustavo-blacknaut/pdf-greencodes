'use client';

import { useEffect, useRef, useState } from 'react';
import { CloudOff, FolderOpen, UploadCloud } from 'lucide-react';
import { cx } from '@/lib/utils';
import { aoArrastar, type ArquivoEscolhido } from '@/lib/desktop';
import { useSeletorDeArquivos } from './useSeletorDeArquivos';

export function Dropzone({
  accept,
  acceptLabel,
  multiple,
  compact,
  onFiles,
  onEscolhidos,
  onLendo,
  onFalha,
}: {
  accept: string[];
  acceptLabel: string;
  multiple: boolean;
  compact?: boolean;
  onFiles: (files: File[]) => void;
  /** Avisado assim que a pessoa escolhe, antes de ler o conteúdo. */
  onEscolhidos?: (escolhidos: ArquivoEscolhido[]) => void;
  /** Quanto já foi lido de cada arquivo. */
  onLendo?: (nome: string, lidos: number, total: number) => void;
  /** Chamado quando a leitura não foi até o fim, para tirar o marcador da tela. */
  onFalha?: (nomes: string[], erro: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  // O mesmo caminho que o botao de juntar mais PDFs usa na grade de paginas.
  const { abrir, inputProps, noApp } = useSeletorDeArquivos({
    accept,
    multiple,
    onFiles,
    onEscolhidos,
    onLendo,
    onFalha,
  });

  // Colar um arquivo (Ctrl+V) é o caminho mais rápido depois de um print.
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length) {
        event.preventDefault();
        onFiles(multiple ? files : files.slice(0, 1));
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [multiple, onFiles]);

  // No aplicativo o arrastar chega pelo Tauri, e não pelos eventos da página:
  // é daqui que a zona sabe que tem arquivo por cima. Soltar é com a tela.
  useEffect(() => aoArrastar(setDragging), []);

  // Arrastar em qualquer ponto da página conta como arrastar para a zona.
  useEffect(() => {
    function onEnter(event: DragEvent) {
      if (!event.dataTransfer?.types.includes('Files')) return;
      depth.current += 1;
      setDragging(true);
    }
    function onLeave() {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    }
    function onDrop(event: DragEvent) {
      depth.current = 0;
      setDragging(false);
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length) {
        event.preventDefault();
        onFiles(multiple ? files : files.slice(0, 1));
      }
    }
    function onOver(event: DragEvent) {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    }

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [multiple, onFiles]);

  return (
    <div
      className={cx(
        'relative rounded-2xl border-2 border-dashed transition-all duration-300',
        dragging ? 'scale-[1.01] border-brand bg-brand/10' : 'border-line hover:border-brand/50 hover:bg-elevated/50',
        compact ? 'p-5' : 'p-10 sm:p-14',
      )}
    >
      <input {...inputProps} />

      <button
        type="button"
        onClick={() => void abrir()}
        className="flex w-full flex-col items-center text-center focus:outline-none"
      >
        <span className="relative grid place-items-center">
          {dragging && <span className="absolute h-14 w-14 animate-pulse-ring rounded-2xl bg-brand/30" aria-hidden />}
          <span
            className={cx(
              'relative grid place-items-center rounded-2xl border transition-transform duration-300',
              compact ? 'h-11 w-11' : 'h-14 w-14',
              dragging ? 'scale-110 border-brand bg-brand/15 text-brand' : 'bg-elevated text-muted',
            )}
          >
            <UploadCloud className={compact ? 'h-5 w-5' : 'h-6 w-6'} strokeWidth={1.75} />
          </span>
        </span>

        <span className={cx('font-semibold tracking-tight', compact ? 'mt-3 text-sm' : 'mt-5 text-lg')}>
          {dragging ? 'Solte aqui' : multiple ? 'Solte seus arquivos aqui' : 'Solte seu arquivo aqui'}
        </span>
        <span className="mt-1 text-sm text-muted">
          ou <span className="font-medium text-brand">clique para escolher</span> · {acceptLabel}
          {multiple ? ' · vários de uma vez' : ''}
        </span>

        {!compact && (
          <span className="btn-ghost mt-5 px-4 py-2">
            <FolderOpen className="h-4 w-4" /> Abrir arquivo{multiple ? 's' : ''}
          </span>
        )}

        {!compact && (
          <span className="mt-5 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] text-muted">
            <CloudOff className="h-3.5 w-3.5" />
            Nada é enviado. O processamento acontece nesta aba
          </span>
        )}
      </button>
    </div>
  );
}
