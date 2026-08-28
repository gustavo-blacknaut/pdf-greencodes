'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Loader2,
  PenLine,
  Square,
  Trash2,
  Type,
} from 'lucide-react';
import { renderPaginaParaEditor, type ElementoEditor, type LoadedFile } from '@/lib/pdf/engine';
import { limitarAPagina } from '@/lib/pdf/layout';
import { SignaturePad } from './SignaturePad';
import { cx } from '@/lib/utils';

type Arraste =
  | { modo: 'mover'; id: string; deslocX: number; deslocY: number }
  | { modo: 'redimensionar'; id: string };

let sequencia = 0;
const novoId = () => `e${(sequencia += 1)}`;

const CORES_TEXTO = ['#111111', '#b91c1c', '#1d4ed8', '#15803d'];

export function PdfEditor({
  file,
  focoAssinatura,
  onElementosChange,
}: {
  file: LoadedFile;
  focoAssinatura?: boolean;
  onElementosChange: (elementos: ElementoEditor[]) => void;
}) {
  const [pagina, setPagina] = useState(0);
  const [preview, setPreview] = useState<{ dataUrl: string; rotacao: number; larguraPt: number } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [elementos, setElementos] = useState<ElementoEditor[]>([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [assinando, setAssinando] = useState(Boolean(focoAssinatura));

  const areaRef = useRef<HTMLDivElement>(null);
  const arrasteRef = useRef<Arraste | null>(null);
  const total = file.pageCount ?? 1;

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    void renderPaginaParaEditor(file.bytes, pagina)
      .then((resultado) => {
        if (cancelado) return;
        setPreview({ dataUrl: resultado.dataUrl, rotacao: resultado.rotacao, larguraPt: resultado.larguraPt });
      })
      .catch(() => {
        if (!cancelado) setPreview(null);
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [file.bytes, pagina]);

  useEffect(() => {
    onElementosChange(elementos);
  }, [elementos, onElementosChange]);

  const daPagina = useMemo(() => elementos.filter((e) => e.pagina === pagina), [elementos, pagina]);
  const atual = elementos.find((e) => e.id === selecionado) ?? null;

  const atualizar = useCallback((id: string, mudanca: Partial<ElementoEditor>) => {
    setElementos((atuais) => atuais.map((e) => (e.id === id ? { ...e, ...mudanca } : e)));
  }, []);

  function adicionar(elemento: Omit<ElementoEditor, 'id' | 'pagina'>) {
    const novo: ElementoEditor = { ...elemento, id: novoId(), pagina };
    setElementos((atuais) => [...atuais, novo]);
    setSelecionado(novo.id);
  }

  function remover(id: string) {
    setElementos((atuais) => atuais.filter((e) => e.id !== id));
    if (selecionado === id) setSelecionado(null);
  }

  /* --- arrastar e redimensionar ------------------------------------------ */

  function fracaoDoPonteiro(evento: PointerEvent | React.PointerEvent) {
    const area = areaRef.current;
    if (!area) return { x: 0, y: 0 };
    const caixa = area.getBoundingClientRect();
    return {
      x: (evento.clientX - caixa.left) / caixa.width,
      y: (evento.clientY - caixa.top) / caixa.height,
    };
  }

  useEffect(() => {
    function mover(evento: PointerEvent) {
      const arraste = arrasteRef.current;
      if (!arraste) return;
      evento.preventDefault();

      const ponto = fracaoDoPonteiro(evento);
      setElementos((atuais) =>
        atuais.map((e) => {
          if (e.id !== arraste.id) return e;
          if (arraste.modo === 'mover') {
            return { ...e, ...limitarAPagina({ ...e, x: ponto.x - arraste.deslocX, y: ponto.y - arraste.deslocY }) };
          }
          return { ...e, ...limitarAPagina({ ...e, largura: ponto.x - e.x, altura: ponto.y - e.y }) };
        }),
      );
    }

    function soltar() {
      arrasteRef.current = null;
    }

    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    return () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
    };
  }, []);

  function iniciarMover(evento: React.PointerEvent, elemento: ElementoEditor) {
    evento.stopPropagation();
    setSelecionado(elemento.id);
    const ponto = fracaoDoPonteiro(evento);
    arrasteRef.current = {
      modo: 'mover',
      id: elemento.id,
      deslocX: ponto.x - elemento.x,
      deslocY: ponto.y - elemento.y,
    };
  }

  function iniciarRedimensionar(evento: React.PointerEvent, elemento: ElementoEditor) {
    evento.stopPropagation();
    setSelecionado(elemento.id);
    arrasteRef.current = { modo: 'redimensionar', id: elemento.id };
  }

  /* --- render ------------------------------------------------------------ */

  if (assinando) {
    return (
      <SignaturePad
        onCancelar={() => setAssinando(false)}
        onPronto={(dataUrl, proporcao) => {
          const largura = 0.28;
          adicionar({
            tipo: 'imagem',
            dataUrl,
            x: 0.12,
            y: 0.72,
            largura,
            // A proporção do traço define a altura, senão a assinatura entra esticada.
            altura: Math.min(0.4, largura / Math.max(proporcao, 0.2) / 1.4142),
          });
          setAssinando(false);
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <button type="button" onClick={() => setAssinando(true)} className="btn-primary px-3 py-2 text-xs">
          <PenLine className="h-3.5 w-3.5" /> Assinatura
        </button>
        <button
          type="button"
          onClick={() =>
            adicionar({ tipo: 'texto', texto: 'Escreva aqui', tamanho: 14, cor: '#111111', x: 0.1, y: 0.1, largura: 0.4, altura: 0.06 })
          }
          className="btn-ghost px-3 py-2 text-xs"
        >
          <Type className="h-3.5 w-3.5" /> Texto
        </button>
        <button
          type="button"
          onClick={() =>
            adicionar({ tipo: 'retangulo', cor: '#ffffff', opacidade: 1, x: 0.1, y: 0.2, largura: 0.35, altura: 0.04 })
          }
          className="btn-ghost px-3 py-2 text-xs"
          title="Cobre o texto original para você escrever por cima"
        >
          <Square className="h-3.5 w-3.5" /> Tapar
        </button>
        <button
          type="button"
          onClick={() =>
            adicionar({ tipo: 'retangulo', cor: '#fde047', opacidade: 0.4, x: 0.1, y: 0.3, largura: 0.35, altura: 0.03 })
          }
          className="btn-ghost px-3 py-2 text-xs"
        >
          <Highlighter className="h-3.5 w-3.5" /> Marca-texto
        </button>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPagina((p) => Math.max(0, p - 1))}
            disabled={pagina === 0}
            className="grid h-8 w-8 place-items-center rounded-lg border text-muted disabled:opacity-30"
            aria-label="Página anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[5rem] text-center text-xs tabular-nums text-muted">
            {pagina + 1} de {total}
          </span>
          <button
            type="button"
            onClick={() => setPagina((p) => Math.min(total - 1, p + 1))}
            disabled={pagina >= total - 1}
            className="grid h-8 w-8 place-items-center rounded-lg border text-muted disabled:opacity-30"
            aria-label="Próxima página"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {preview?.rotacao !== 0 && preview && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
          Esta página tem rotação gravada no arquivo e aparece deitada aqui. O posicionamento continua correto no PDF
          final, mas fica mais fácil endireitar antes com a ferramenta Girar PDF.
        </p>
      )}

      <div className="card overflow-hidden p-4">
        <div
          ref={areaRef}
          onPointerDown={() => setSelecionado(null)}
          className="relative mx-auto w-full max-w-3xl select-none bg-white shadow-sm"
          // Unidade de container: assim o texto do preview acompanha a largura
          // real da página e o tamanho na tela bate com o tamanho no PDF.
          style={{ containerType: 'inline-size' }}
        >
          {carregando && !preview ? (
            <div className="flex aspect-[1/1.414] items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted" />
            </div>
          ) : preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.dataUrl} alt={`Página ${pagina + 1}`} draggable={false} className="block w-full" />
          ) : (
            <div className="flex aspect-[1/1.414] items-center justify-center p-6 text-center text-sm text-muted">
              Não foi possível desenhar esta página.
            </div>
          )}

          {daPagina.map((elemento) => (
            <div
              key={elemento.id}
              onPointerDown={(e) => iniciarMover(e, elemento)}
              className={cx(
                'absolute cursor-move',
                selecionado === elemento.id ? 'outline outline-2 outline-brand' : 'hover:outline hover:outline-1 hover:outline-brand/50',
              )}
              style={{
                left: `${elemento.x * 100}%`,
                top: `${elemento.y * 100}%`,
                width: `${elemento.largura * 100}%`,
                height: `${elemento.altura * 100}%`,
              }}
            >
              {elemento.tipo === 'imagem' && elemento.dataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={elemento.dataUrl} alt="" draggable={false} className="h-full w-full object-contain" />
              )}
              {elemento.tipo === 'retangulo' && (
                <div
                  className="h-full w-full"
                  style={{ background: elemento.cor, opacity: elemento.opacidade ?? 1 }}
                />
              )}
              {elemento.tipo === 'texto' && (
                <span
                  className="block h-full w-full overflow-hidden leading-tight"
                  style={{
                    color: elemento.cor,
                    fontSize: `${((elemento.tamanho ?? 14) / (preview?.larguraPt ?? 595)) * 100}cqw`,
                  }}
                >
                  {elemento.texto}
                </span>
              )}

              {selecionado === elemento.id && (
                <span
                  onPointerDown={(e) => iniciarRedimensionar(e, elemento)}
                  className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-full border-2 border-white bg-brand"
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {atual && (
        <div className="card flex flex-wrap items-center gap-3 p-3">
          {atual.tipo === 'texto' && (
            <>
              <input
                type="text"
                value={atual.texto ?? ''}
                onChange={(e) => atualizar(atual.id, { texto: e.target.value })}
                className="input flex-1 py-2 text-sm"
                placeholder="Digite o texto"
              />
              <label className="flex items-center gap-2 text-xs text-muted">
                Tamanho
                <input
                  type="range"
                  min={6}
                  max={48}
                  value={atual.tamanho ?? 14}
                  onChange={(e) => atualizar(atual.id, { tamanho: Number(e.target.value) })}
                  className="w-24"
                />
                <span className="w-8 tabular-nums">{atual.tamanho ?? 14}</span>
              </label>
              <span className="flex gap-1.5">
                {CORES_TEXTO.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => atualizar(atual.id, { cor: c })}
                    aria-label={`Cor ${c}`}
                    className={cx('h-6 w-6 rounded-full border-2', atual.cor === c ? 'border-brand' : 'border-line')}
                    style={{ background: c }}
                  />
                ))}
              </span>
            </>
          )}

          {atual.tipo === 'retangulo' && (
            <p className="text-xs text-muted">
              Arraste para posicionar e use o ponto do canto para redimensionar.
              {(atual.opacidade ?? 1) < 1 ? ' Marca-texto deixa ler o que está embaixo.' : ' Cobre o conteúdo original.'}
            </p>
          )}

          {atual.tipo === 'imagem' && (
            <p className="text-xs text-muted">Arraste para posicionar. O canto redimensiona sem deformar.</p>
          )}

          <button
            type="button"
            onClick={() => remover(atual.id)}
            className="btn ml-auto px-3 py-2 text-xs text-muted hover:text-rose-500"
          >
            <Trash2 className="h-3.5 w-3.5" /> Remover
          </button>
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted">
        {elementos.length === 0
          ? 'Escolha uma ferramenta acima e clique para adicionar. Depois arraste sobre a página.'
          : `${elementos.length} ${elementos.length === 1 ? 'item' : 'itens'} no documento, em ${new Set(elementos.map((e) => e.pagina)).size} ${new Set(elementos.map((e) => e.pagina)).size === 1 ? 'página' : 'páginas'}.`}
      </p>
    </div>
  );
}
