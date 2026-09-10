'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  CheckCheck,
  FilePlus2,
  GripVertical,
  Loader2,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { renderPageThumbnails, type LoadedFile, type PagePlanItem } from '@/lib/pdf/engine';
import { LIMITES } from '@/lib/pdf/guards';
import type { BoardMode } from '@/lib/tools';
import { cx } from '@/lib/utils';

/**
 * Uma página na grade.
 *
 * `uid` existe porque a identidade deixou de ser o número da página. Com
 * vários arquivos, a página 1 de dois PDFs diferentes são duas coisas; e uma
 * folha em branco não vem de arquivo nenhum. Marcar, arrastar e desenhar
 * passaram todos a usar o `uid`.
 */
type Page = {
  uid: string;
  /** Índice do arquivo na fila. */
  f: number;
  /** Página dentro do arquivo. Não vale nada quando é folha em branco. */
  index: number;
  rotate: number;
  thumb: string | null;
  branco?: boolean;
};

/** Cores para distinguir de qual arquivo cada página veio. */
const CORES_DE_ORIGEM = [
  'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  'bg-rose-500/15 text-rose-600 dark:text-rose-400',
];

export function PageBoard({
  files,
  mode,
  onPlanChange,
  onPedirArquivos,
}: {
  files: LoadedFile[];
  mode: BoardMode;
  onPlanChange: (plan: PagePlanItem[]) => void;
  /** Abre o seletor de arquivos, para juntar mais PDFs à mesma grade. */
  onPedirArquivos?: () => void;
}) {
  const totalDeCada = useMemo(() => files.map((f) => f.pageCount ?? 0), [files]);
  const total = totalDeCada.reduce((soma, n) => soma + n, 0);
  // Muda quando um arquivo entra ou sai da fila, e é o que remonta a grade.
  const assinatura = files.map((f) => `${f.id}:${f.pageCount ?? 0}`).join('|');

  const [pages, setPages] = useState<Page[]>(() => paginasDe(files));
  const [marked, setMarked] = useState<Set<string>>(() => new Set());
  const [loaded, setLoaded] = useState(0);
  const [falhaMiniaturas, setFalhaMiniaturas] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const comMiniatura = Math.min(total, LIMITES.miniaturas);

  useEffect(() => {
    const token = { cancelled: false };
    setPages(paginasDe(files));
    setMarked(new Set());
    setLoaded(0);
    setFalhaMiniaturas(false);

    /*
     * As miniaturas de cada arquivo, um depois do outro.
     *
     * Em sequência e não em paralelo: cada desenho segura a página inteira
     * na memória, e três PDFs grandes ao mesmo tempo derrubam a aba na
     * máquina fraca da loja.
     */
    void (async () => {
      for (let f = 0; f < files.length; f += 1) {
        if (token.cancelled) return;
        try {
          await renderPageThumbnails(
            files[f].bytes,
            (index, dataUrl) => {
              setPages((atual) =>
                atual.map((page) => (page.f === f && page.index === index ? { ...page, thumb: dataUrl } : page)),
              );
              setLoaded((n) => n + 1);
            },
            token,
          );
        } catch {
          // A grade continua utilizável pelos números, mas quem está olhando
          // precisa saber por que as miniaturas nunca apareceram.
          if (!token.cancelled) setFalhaMiniaturas(true);
        }
      }
    })();

    return () => {
      token.cancelled = true;
    };
    // `assinatura` cobre entrada e saída de arquivo; `files` muda de
    // identidade a cada render e remontaria a grade sem parar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);

  const plan = useMemo<PagePlanItem[]>(() => {
    const daPagina = (page: Page): PagePlanItem =>
      page.branco ? { branco: true, i: 0, r: 0 } : { f: page.f, i: page.index, r: page.rotate };

    if (mode === 'remove') return pages.filter((page) => !marked.has(page.uid)).map(daPagina);
    if (mode === 'keep') return pages.filter((page) => marked.has(page.uid)).map(daPagina);
    return pages.map(daPagina);
  }, [pages, marked, mode]);

  useEffect(() => {
    onPlanChange(plan);
  }, [plan, onPlanChange]);

  const move = useCallback((from: number, to: number) => {
    setPages((current) => {
      if (to < 0 || to >= current.length) return current;
      const copy = [...current];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      return copy;
    });
  }, []);

  function rotatePage(position: number, delta: number) {
    setPages((current) =>
      current.map((page, i) =>
        i === position ? { ...page, rotate: (((page.rotate + delta) % 360) + 360) % 360 } : page,
      ),
    );
  }

  function toggleMark(uid: string) {
    setMarked((current) => {
      const next = new Set(current);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  function removePage(position: number) {
    setPages((current) => (current.length <= 1 ? current : current.filter((_, i) => i !== position)));
  }

  /**
   * Uma folha em branco depois da posição indicada.
   *
   * A medida dela sai da página vizinha na hora de montar o PDF, e não aqui:
   * a grade não sabe o tamanho das páginas, só o desenho delas.
   */
  function inserirBranco(depoisDe: number) {
    setPages((current) => {
      const copy = [...current];
      copy.splice(depoisDe + 1, 0, {
        uid: `branco-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        f: -1,
        index: -1,
        rotate: 0,
        thumb: null,
        branco: true,
      });
      return copy;
    });
  }

  function resetAll() {
    setPages(() => {
      const thumbs = new Map(pages.filter((p) => !p.branco).map((page) => [page.uid, page.thumb]));
      return paginasDe(files).map((page) => ({ ...page, thumb: thumbs.get(page.uid) ?? null }));
    });
    setMarked(new Set());
  }

  const brancas = pages.filter((page) => page.branco).length;
  const touched =
    marked.size > 0 ||
    brancas > 0 ||
    pages.length !== total ||
    pages.some((page, position) => page.uid !== `${page.f}:${position}` || page.rotate !== 0);

  const status =
    mode === 'remove'
      ? marked.size === 0
        ? `${total} páginas · clique nas que devem sair`
        : `${marked.size} de ${total} marcadas para remover`
      : mode === 'keep'
        ? marked.size === 0
          ? `${total} páginas · clique nas que quer guardar`
          : `${marked.size} de ${total} selecionadas`
        : mode === 'rotate'
          ? (() => {
              const n = pages.filter((page) => page.rotate).length;
              return n === 0 ? `${total} páginas · clique para girar` : `${n} de ${total} giradas`;
            })()
          : `${pages.length} páginas${brancas ? `, ${brancas} em branco` : ''}${
              files.length > 1 ? ` · ${files.length} arquivos` : ''
            }`;

  const clickable = mode === 'remove' || mode === 'keep' || mode === 'rotate';
  const titulo = files.length === 1 ? files[0].name : `${files.length} arquivos na mesma grade`;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b bg-elevated/60 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">{titulo}</p>
          <p className="text-xs text-muted">
            {status}
            {falhaMiniaturas
              ? ' · não foi possível desenhar as miniaturas deste PDF'
              : loaded < comMiniatura
                ? ' · carregando miniaturas...'
                : total > comMiniatura
                  ? ` · miniaturas nas ${comMiniatura} primeiras páginas`
                  : ''}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap gap-1.5">
          {mode === 'organize' && onPedirArquivos && (
            <button type="button" onClick={onPedirArquivos} className="btn-ghost px-3 py-1.5 text-xs">
              <FilePlus2 className="h-3.5 w-3.5" /> Adicionar PDF
            </button>
          )}

          {mode === 'organize' && (
            <>
              <button
                type="button"
                onClick={() => inserirBranco(pages.length - 1)}
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                <FilePlus2 className="h-3.5 w-3.5" /> Folha em branco
              </button>
              <button
                type="button"
                onClick={() => setPages((current) => [...current].reverse())}
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" /> Inverter ordem
              </button>
            </>
          )}

          {(mode === 'organize' || mode === 'rotate') && (
            <>
              <button
                type="button"
                onClick={() =>
                  setPages((current) => current.map((page) => ({ ...page, rotate: (page.rotate + 270) % 360 })))
                }
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Todas à esquerda
              </button>
              <button
                type="button"
                onClick={() =>
                  setPages((current) => current.map((page) => ({ ...page, rotate: (page.rotate + 90) % 360 })))
                }
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                <RotateCw className="h-3.5 w-3.5" /> Todas à direita
              </button>
            </>
          )}

          {(mode === 'remove' || mode === 'keep') && (
            <button
              type="button"
              onClick={() =>
                setMarked((current) =>
                  current.size === total ? new Set() : new Set(pages.map((page) => page.uid)),
                )
              }
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {marked.size === total ? 'Limpar seleção' : 'Selecionar todas'}
            </button>
          )}

          <button
            type="button"
            onClick={resetAll}
            disabled={!touched}
            className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5" /> Restaurar
          </button>
        </div>
      </div>

      {loaded < comMiniatura && !falhaMiniaturas && (
        <div className="h-0.5 bg-line/60">
          <div
            className="h-full transition-[width] duration-200"
            style={{
              width: `${comMiniatura ? (loaded / comMiniatura) * 100 : 0}%`,
              backgroundImage: 'linear-gradient(90deg, rgb(var(--brand)), rgb(var(--brand2)))',
            }}
          />
        </div>
      )}

      <ul className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {pages.map((page, position) => {
          const isMarked = marked.has(page.uid);
          const highlight = (mode === 'remove' && isMarked) || (mode === 'keep' && isMarked);
          const rotulo = page.branco ? 'folha em branco' : `página ${page.index + 1}`;

          const tile = (
            <>
              <div
                className={cx(
                  'relative grid aspect-[1/1.35] place-items-center overflow-hidden rounded-lg border bg-white transition',
                  mode === 'remove' && isMarked && 'opacity-45',
                  page.branco && 'border-dashed',
                )}
              >
                {page.branco ? (
                  <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">em branco</span>
                ) : page.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={page.thumb}
                    alt={`Página ${page.index + 1}`}
                    draggable={false}
                    className="max-h-full max-w-full object-contain transition-transform duration-200"
                    style={{ transform: `rotate(${page.rotate}deg)` }}
                  />
                ) : falhaMiniaturas || position >= comMiniatura ? (
                  <span className="text-lg font-semibold tabular-nums text-slate-400">{page.index + 1}</span>
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-muted" />
                )}

                {mode === 'remove' && isMarked && (
                  <span className="absolute inset-0 grid place-items-center bg-rose-500/15">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-rose-500 text-white shadow-lg">
                      <X className="h-5 w-5" strokeWidth={2.5} />
                    </span>
                  </span>
                )}
                {mode === 'keep' && isMarked && (
                  <span className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-brand text-white shadow-lg">
                    <Check className="h-4 w-4" strokeWidth={3} />
                  </span>
                )}
                {mode === 'rotate' && page.rotate !== 0 && (
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white shadow">
                    {page.rotate}°
                  </span>
                )}
              </div>

              <div className="mt-2 flex items-center gap-1">
                <span className="rounded-md bg-elevated px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted">
                  {page.branco ? '—' : page.index + 1}
                </span>
                {/* De qual arquivo veio. Só aparece quando há mais de um. */}
                {files.length > 1 && !page.branco && (
                  <span
                    className={cx(
                      'rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                      CORES_DE_ORIGEM[page.f % CORES_DE_ORIGEM.length],
                    )}
                    title={files[page.f]?.name}
                  >
                    {String.fromCharCode(65 + (page.f % 26))}
                  </span>
                )}
                {mode === 'organize' && page.rotate !== 0 && (
                  <span className="text-[11px] font-medium text-brand">{page.rotate}°</span>
                )}

                {mode === 'organize' && (
                  <span className="ml-auto flex gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                    {!page.branco && (
                      <>
                        <button
                          type="button"
                          onClick={() => rotatePage(position, -90)}
                          className="grid h-6 w-6 place-items-center rounded-md text-muted transition hover:bg-elevated hover:text-ink"
                          aria-label={`Girar ${rotulo} à esquerda`}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => rotatePage(position, 90)}
                          className="grid h-6 w-6 place-items-center rounded-md text-muted transition hover:bg-elevated hover:text-ink"
                          aria-label={`Girar ${rotulo} à direita`}
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => inserirBranco(position)}
                      className="grid h-6 w-6 place-items-center rounded-md text-muted transition hover:bg-elevated hover:text-ink"
                      aria-label={`Inserir folha em branco depois da ${rotulo}`}
                    >
                      <FilePlus2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removePage(position)}
                      disabled={pages.length <= 1}
                      className="grid h-6 w-6 place-items-center rounded-md text-muted transition hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-30"
                      aria-label={`Remover ${rotulo}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}

                {mode === 'organize' && (
                  <GripVertical className="ml-auto h-3.5 w-3.5 shrink-0 text-muted opacity-0 transition group-hover:opacity-60" />
                )}
              </div>
            </>
          );

          return (
            <li
              key={page.uid}
              draggable={mode === 'organize'}
              onDragStart={() => mode === 'organize' && setDragIndex(position)}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragOver={(event) => {
                if (mode !== 'organize' || dragIndex === null || dragIndex === position) return;
                event.preventDefault();
                setOverIndex(position);
              }}
              onDrop={(event) => {
                if (mode !== 'organize') return;
                event.preventDefault();
                if (dragIndex !== null && dragIndex !== position) move(dragIndex, position);
                setDragIndex(null);
                setOverIndex(null);
              }}
              className={cx(
                'group relative rounded-xl border bg-bg/40 p-2 transition',
                mode === 'organize' && 'cursor-grab active:cursor-grabbing',
                dragIndex === position && 'opacity-40',
                overIndex === position && 'border-brand ring-2 ring-brand/30',
                highlight && mode === 'keep' && 'border-brand ring-2 ring-brand/30',
                highlight && mode === 'remove' && 'border-rose-500/60',
              )}
            >
              {clickable ? (
                <button
                  type="button"
                  onClick={() => (mode === 'rotate' ? rotatePage(position, 90) : toggleMark(page.uid))}
                  className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                  aria-pressed={mode === 'rotate' ? undefined : isMarked}
                  aria-label={mode === 'rotate' ? `Girar ${rotulo}` : `${isMarked ? 'Desmarcar' : 'Marcar'} ${rotulo}`}
                >
                  {tile}
                </button>
              ) : (
                tile
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** As páginas de todos os arquivos da fila, na ordem em que eles entraram. */
function paginasDe(files: LoadedFile[]): Page[] {
  const todas: Page[] = [];
  files.forEach((arquivo, f) => {
    for (let index = 0; index < (arquivo.pageCount ?? 0); index += 1) {
      todas.push({ uid: `${f}:${index}`, f, index, rotate: 0, thumb: null });
    }
  });
  return todas;
}
