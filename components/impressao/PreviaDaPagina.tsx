'use client';

import type { RefObject } from 'react';
import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { cx } from '@/lib/utils';

/**
 * A folha como ela vai sair da impressora.
 *
 * Não desenha nada sozinha: recebe o canvas já preenchido pelo pai, que é quem
 * fala com o pdf.js. Aqui ficam só a moldura, o zoom e a navegação.
 */
/** A folha desenhada na tela, já com a arte posicionada em cima dela. */
export type FolhaNaTela = {
  /** Medidas da folha, em pixels de tela. */
  largura: number;
  altura: number;
  /** Onde a arte cai dentro dela, em pixels de tela. */
  arte: { x: number; y: number; largura: number; altura: number };
  /** Riscos de corte e alvos de registro, já em pixels. */
  marcas: { x: number; y: number; largura: number; altura: number }[];
  espelho?: string;
  negativo?: boolean;
};

export function PreviaDaPagina({
  nome,
  paginas,
  pagina,
  zoom,
  escalaAtual,
  renderizando,
  telaRef,
  molduraRef,
  folha,
  aviso,
  onZoom,
  onPagina,
}: {
  nome: string;
  paginas: number;
  pagina: number;
  zoom: number;
  escalaAtual: number;
  renderizando: boolean;
  telaRef: RefObject<HTMLCanvasElement | null>;
  molduraRef: RefObject<HTMLDivElement | null>;
  /** Ausente enquanto não se sabe a medida da página: aí mostra só o desenho. */
  folha?: FolhaNaTela | null;
  /** O que dizer quando a arte passa da folha. */
  aviso?: string | null;
  onZoom: (valor: number) => void;
  onPagina: (valor: number) => void;
}) {
  return (
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <p className="min-w-0 flex-1 truncate text-xs text-muted">Prévia · {nome}</p>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onZoom(Math.max(0.25, escalaAtual - 0.25))}
              className="btn-ghost px-2 py-1"
              aria-label="Diminuir zoom"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onZoom(0)}
              className={cx(
                'rounded-lg border px-2.5 py-1 text-[12px] font-medium tabular-nums transition',
                zoom === 0 ? 'border-transparent bg-ink text-bg' : 'text-muted hover:text-ink',
              )}
              title="Ajustar à largura"
            >
              {zoom === 0 ? 'Ajustado' : `${Math.round(zoom * 100)}%`}
            </button>
            <button
              type="button"
              onClick={() => onZoom(Math.min(4, escalaAtual + 0.25))}
              className="btn-ghost px-2 py-1"
              aria-label="Aumentar zoom"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div ref={molduraRef} className="max-h-[70vh] overflow-auto bg-bg/40 p-4">
        {/*
          min-w-fit no filho: centralizar com mx-auto dentro de area rolavel
          esconde a parte esquerda quando o conteudo e maior que a moldura, e
          nao da para rolar ate ela.
        */}
          <div className="relative mx-auto flex min-w-fit justify-center">
            {/*
              A folha, e a arte em cima dela.

              Antes a prévia mostrava só a página, do tamanho que ela é. Quem
              olhava não tinha como saber onde ela ia cair no papel, nem
              quanto ia sobrar de branco — e é justamente isso que se quer
              conferir antes de mandar uma tiragem.

              A moldura branca é a folha; o `arte` posiciona o canvas dentro
              dela com a mesma conta que o HTML da impressão usa.
            */}
            {folha ? (
              <div
                className="relative rounded-lg bg-white shadow-lg"
                style={{ width: `${folha.largura}px`, height: `${folha.altura}px` }}
              >
                <canvas
                  ref={telaRef}
                  className="absolute block"
                  style={{
                    left: `${folha.arte.x}px`,
                    top: `${folha.arte.y}px`,
                    width: `${folha.arte.largura}px`,
                    height: `${folha.arte.altura}px`,
                    transform: folha.espelho,
                    filter: folha.negativo ? 'invert(1)' : undefined,
                  }}
                />
                {/* O que passa da folha não sai impresso, e a prévia diz isso. */}
                {folha.marcas.map((marca, i) => (
                  <span
                    key={i}
                    className="absolute bg-ink/70"
                    style={{
                      left: `${marca.x}px`,
                      top: `${marca.y}px`,
                      width: `${marca.largura}px`,
                      height: `${marca.altura}px`,
                    }}
                  />
                ))}
              </div>
            ) : (
              <canvas ref={telaRef} className="block rounded-lg bg-white shadow-lg" />
            )}
            {renderizando && (
              <span className="absolute inset-0 grid place-items-center rounded-lg bg-bg/50">
                <Loader2 className="h-5 w-5 animate-spin text-brand" />
              </span>
            )}
          </div>
        </div>
        {aviso && (
          <p className="border-t bg-amber-500/10 px-4 py-2 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
            {aviso}
          </p>
        )}
        {paginas > 1 && (
          <div className="flex items-center justify-center gap-3 border-t px-4 py-2.5">
            <button
              type="button"
              onClick={() => onPagina(Math.max(1, pagina - 1))}
              disabled={pagina <= 1}
              className="btn-ghost px-2.5 py-1.5 disabled:opacity-40"
              aria-label="Página anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm tabular-nums text-muted">
              {pagina} de {paginas}
            </span>
            <button
              type="button"
              onClick={() => onPagina(Math.min(paginas, pagina + 1))}
              disabled={pagina >= paginas}
              className="btn-ghost px-2.5 py-1.5 disabled:opacity-40"
              aria-label="Próxima página"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
    </div>
  );
}
