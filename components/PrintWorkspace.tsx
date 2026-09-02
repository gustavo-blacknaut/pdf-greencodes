'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Plus,
  Printer,
  X,
  SlidersHorizontal,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Dropzone } from './Dropzone';
import { vault } from '@/lib/ephemeral';
import { inspectFile, runOperation, type OperationId } from '@/lib/pdf/engine';
import { loadPdfJs } from '@/lib/pdf/lazy';
import { validarFila } from '@/lib/pdf/guards';
import {
  estaNoAplicativo,
  abrirPreferenciasDaImpressora,
  imprimirArquivo,
  listarImpressoras,
  type Impressora,
  type OpcoesImpressao,
} from '@/lib/desktop';
import { cx, formatBytes, replaceExtension } from '@/lib/utils';

const CHAVE = 'greencodes:impressao';

const PADRAO: OpcoesImpressao = {
  copias: 1,
  colorido: true,
  paisagem: false,
  duplex: 'simplex',
  papel: 'A4',
  dpi: 300,
};

const ACEITA = [
  'application/pdf',
  '.pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.docx',
  '.xlsx',
  '.pptx',
  '.txt',
];

/** Qual operação transforma cada formato em PDF. PDF já chega pronto. */
function conversaoPara(nome: string): OperationId | null {
  const n = nome.toLowerCase();
  if (n.endsWith('.pdf')) return null;
  if (/\.(jpe?g|png|webp)$/.test(n)) return 'images-to-pdf';
  if (n.endsWith('.docx')) return 'word-to-pdf';
  if (n.endsWith('.xlsx')) return 'excel-to-pdf';
  if (n.endsWith('.pptx')) return 'powerpoint-to-pdf';
  if (n.endsWith('.txt')) return 'text-to-pdf';
  return null;
}

function lerSalvo(): OpcoesImpressao {
  try {
    const bruto = localStorage.getItem(CHAVE);
    return bruto ? { ...PADRAO, ...JSON.parse(bruto) } : PADRAO;
  } catch {
    return PADRAO;
  }
}

type Estado = 'esperando' | 'convertendo' | 'pronto' | 'erro' | 'impresso';

type ItemFila = {
  id: string;
  nome: string;
  origem: File | Blob;
  nomeOriginal: string;
  blob: Blob | null;
  paginas: number;
  estado: Estado;
  erro?: string;
};

let contador = 0;
const proximoId = () => `i${(contador += 1)}_${Date.now().toString(36)}`;

export function PrintWorkspace() {
  const parametros = useSearchParams();
  const noAppPelaRota = usePathname().startsWith('/app');

  const [fila, setFila] = useState<ItemFila[]>([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [renderizando, setRenderizando] = useState(false);
  const [docPronto, setDocPronto] = useState(0);
  // 0 = ajustar à largura disponível; acima disso é zoom fixo (1 = 100%).
  const [zoom, setZoom] = useState(0);
  const [larguraDisponivel, setLarguraDisponivel] = useState(0);
  // Escala que a última renderização usou. O zoom parte dela: sem isso, o
  // primeiro clique em "+" saltava de "ajustado a 188%" para 125%, encolhendo.
  const [escalaAtual, setEscalaAtual] = useState(1);

  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [noApp, setNoApp] = useState(false);
  const [impressoras, setImpressoras] = useState<Impressora[] | null>(null);
  const [opcoes, setOpcoes] = useState<OpcoesImpressao>(PADRAO);
  const [imprimindo, setImprimindo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const telaRef = useRef<HTMLCanvasElement>(null);
  const molduraRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<{ numPages: number; getPage: (n: number) => Promise<any>; destroy: () => Promise<void> } | null>(
    null,
  );
  const tarefaRef = useRef<{ cancel: () => void } | null>(null);
  const convertendoRef = useRef(false);

  useEffect(() => {
    setNoApp(estaNoAplicativo());
    setOpcoes(lerSalvo());
    void listarImpressoras().then((lista) => {
      setImpressoras(lista);
      setOpcoes((atual) => {
        const existe = lista.some((i) => i.nome === atual.impressora);
        return { ...atual, impressora: existe ? atual.impressora : (lista.find((i) => i.padrao) ?? lista[0])?.nome };
      });
    });
  }, []);

  const adicionar = useCallback((arquivos: (File | Blob)[], nomes?: string[]) => {
    setErroGeral(null);
    setFila((atual) => [
      ...atual,
      ...arquivos.map((arquivo, i) => {
        const nomeOriginal = nomes?.[i] ?? (arquivo instanceof File ? arquivo.name : 'documento.pdf');
        return {
          id: proximoId(),
          nome: replaceExtension(nomeOriginal, 'pdf'),
          origem: arquivo,
          nomeOriginal,
          blob: null,
          paginas: 0,
          estado: 'esperando' as Estado,
        };
      }),
    ]);
  }, []);

  /** Arquivos vindos de outra ferramenta, guardados no cofre. */
  useEffect(() => {
    const fonte = parametros.get('fonte');
    if (!fonte) return;
    const entrada = vault.get(fonte);
    if (!entrada?.files.length) {
      setErroGeral('O resultado expirou ou já foi apagado da memória. Escolha os arquivos de novo.');
      return;
    }
    const alvo = parametros.get('arquivo');
    const escolhidos = alvo ? entrada.files.filter((f) => f.name === alvo) : entrada.files;
    const lista = escolhidos.length ? escolhidos : entrada.files;
    adicionar(
      lista.map((f) => f.blob),
      lista.map((f) => f.name),
    );
    // Só na montagem: depois disso quem manda é a fila na tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Converte um item por vez.
   *
   * Em série de propósito: converter cinco Words de uma vez em máquina fraca
   * trava a aba. Cada item vira PDF, conta as páginas e só então o próximo
   * entra.
   */
  useEffect(() => {
    if (convertendoRef.current) return;
    const alvo = fila.find((item) => item.estado === 'esperando');
    if (!alvo) return;

    convertendoRef.current = true;
    const atualizar = (mudanca: Partial<ItemFila>) =>
      setFila((atual) => atual.map((item) => (item.id === alvo.id ? { ...item, ...mudanca } : item)));

    void (async () => {
      atualizar({ estado: 'convertendo' });
      try {
        let pdf = alvo.origem;
        let nomeFinal = alvo.nomeOriginal;

        const operacao = conversaoPara(alvo.nomeOriginal);
        if (operacao) {
          const arquivo =
            alvo.origem instanceof File ? alvo.origem : new File([alvo.origem], alvo.nomeOriginal);
          const carregado = await inspectFile(arquivo, alvo.id);
          if (carregado.error) throw new Error(carregado.error);
          const resultado = await runOperation(operacao, {
            files: [carregado],
            options: {},
            onProgress: () => {},
          });
          pdf = resultado.files[0].blob;
          // O nome da conversão é genérico ("imagens.pdf"): na fila o que
          // importa é reconhecer de qual arquivo veio.
          nomeFinal = replaceExtension(alvo.nomeOriginal, 'pdf');
        }

        const pdfjs = await loadPdfJs();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await pdf.arrayBuffer()) }).promise;
        const paginas = doc.numPages;
        await doc.destroy();

        atualizar({ estado: 'pronto', blob: pdf, paginas, nome: nomeFinal });
      } catch (e) {
        atualizar({ estado: 'erro', erro: e instanceof Error ? e.message : 'Não foi possível preparar o arquivo.' });
      } finally {
        convertendoRef.current = false;
        // Empurra o laço: o próximo "esperando" entra na rodada seguinte.
        setFila((atual) => [...atual]);
      }
    })();
  }, [fila]);

  // O primeiro que ficar pronto vira a prévia, se ainda não há escolhido.
  useEffect(() => {
    if (selecionado && fila.some((i) => i.id === selecionado && i.estado !== 'erro')) return;
    const primeiro = fila.find((i) => i.blob);
    setSelecionado(primeiro?.id ?? null);
  }, [fila, selecionado]);

  const item = fila.find((i) => i.id === selecionado) ?? null;

  /** Abre o documento escolhido uma vez e guarda a referência. */
  useEffect(() => {
    if (!item?.blob) {
      void docRef.current?.destroy();
      docRef.current = null;
      return;
    }

    let vivo = true;
    void (async () => {
      const pdfjs = await loadPdfJs();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await item.blob!.arrayBuffer()) }).promise;
      if (!vivo) {
        await doc.destroy();
        return;
      }
      docRef.current = doc;
      setPagina(1);
      setDocPronto((n) => n + 1);
    })();

    return () => {
      vivo = false;
    };
  }, [item?.id, item?.blob]);

  /**
   * Desenha a página escolhida.
   *
   * A nitidez vem de renderizar na densidade real da tela: antes o canvas
   * saía em 1x e o texto ficava borrado em qualquer monitor moderno. O fator
   * é limitado a 2, e a área total a 6 megapixels, para a conta não explodir
   * em máquina fraca nem em zoom alto.
   */
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !larguraDisponivel) return;
    let vivo = true;

    void (async () => {
      setRenderizando(true);
      try {
        const p = await doc.getPage(Math.min(pagina, doc.numPages));
        const natural = p.getViewport({ scale: 1 });

        // Quanto a página ocupa na tela, em pixels de CSS.
        const ajuste = larguraDisponivel / natural.width;
        const escalaCss = zoom > 0 ? zoom : Math.min(ajuste, 2);
        setEscalaAtual(escalaCss);

        const densidade = Math.min(window.devicePixelRatio || 1, 2);
        let escala = escalaCss * densidade;

        // Teto de área: 6 MP é o suficiente para leitura e não trava a aba.
        const megapixels = (natural.width * escala * natural.height * escala) / 1_000_000;
        if (megapixels > 6) escala *= Math.sqrt(6 / megapixels);

        const viewport = p.getViewport({ scale: escala });
        const tela = telaRef.current;
        if (!tela || !vivo) return;

        tela.width = Math.floor(viewport.width);
        tela.height = Math.floor(viewport.height);
        // O canvas é grande por dentro e do tamanho certo por fora: é isso
        // que dá texto nítido em vez de ampliado.
        tela.style.width = `${Math.round(natural.width * escalaCss)}px`;
        tela.style.height = `${Math.round(natural.height * escalaCss)}px`;

        const contexto = tela.getContext('2d');
        if (contexto) {
          // Clicar rápido em "próxima" empilha desenhos: o anterior é cortado.
          tarefaRef.current?.cancel();
          const tarefa = p.render({ canvasContext: contexto, viewport });
          tarefaRef.current = tarefa;
          await tarefa.promise;
        }
        p.cleanup();
      } catch {
        /* cancelamento de desenho não é erro para mostrar */
      } finally {
        if (vivo) setRenderizando(false);
      }
    })();

    return () => {
      vivo = false;
    };
  }, [pagina, docPronto, zoom, larguraDisponivel]);

  // A prévia acompanha o tamanho da janela: sem isso ela fica pequena no
  // monitor grande e estourada no pequeno.
  useEffect(() => {
    const moldura = molduraRef.current;
    if (!moldura) return;
    const medir = () => setLarguraDisponivel(moldura.clientWidth);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(moldura);
    return () => observador.disconnect();
  }, [item?.id]);

  function mudar<K extends keyof OpcoesImpressao>(chave: K, valor: OpcoesImpressao[K]) {
    setOpcoes((atual) => ({ ...atual, [chave]: valor }));
  }

  function remover(id: string) {
    setFila((atual) => atual.filter((i) => i.id !== id));
  }

  /**
   * Manda a fila inteira, um arquivo por vez.
   *
   * Cada um vira um trabalho próprio na impressora, e é isso que evita ter de
   * juntar tudo num PDF só antes de imprimir. Erro num item não derruba o
   * resto: ele fica marcado e a fila segue.
   */
  async function imprimirTudo() {
    const prontos = fila.filter((i) => i.blob);
    if (!prontos.length) return;

    setAviso(null);
    setErroGeral(null);
    try {
      localStorage.setItem(CHAVE, JSON.stringify(opcoes));
    } catch {
      /* modo anônimo: imprime do mesmo jeito */
    }

    let enviados = 0;
    let cancelou = false;

    for (const alvo of prontos) {
      setImprimindo(alvo.id);
      const r = await imprimirArquivo(alvo.nome, alvo.blob!, opcoes);

      if (r.ok && !r.cancelado) {
        enviados += 1;
        setFila((atual) => atual.map((i) => (i.id === alvo.id ? { ...i, estado: 'impresso' } : i)));
      } else if (r.cancelado) {
        // Cancelou no diálogo: parar a fila é o que a pessoa quis.
        cancelou = true;
        break;
      } else {
        setFila((atual) => atual.map((i) => (i.id === alvo.id ? { ...i, estado: 'erro', erro: r.erro } : i)));
      }
    }

    setImprimindo(null);
    setAviso(
      cancelou
        ? `Fila interrompida. ${enviados} de ${prontos.length} foram enviados.`
        : `${enviados} arquivo${enviados === 1 ? '' : 's'} enviado${enviados === 1 ? '' : 's'} para a impressora.`,
    );
  }

  const campo = 'w-full rounded-xl border bg-bg/60 px-3 py-2.5 text-sm text-ink outline-none transition';
  const raiz = noAppPelaRota ? '/app' : '/';
  const prontos = fila.filter((i) => i.blob);
  const totalPaginas = prontos.reduce((soma, i) => soma + i.paginas, 0);
  const preparando = fila.some((i) => i.estado === 'esperando' || i.estado === 'convertendo');

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
      <header className={cx('pb-6', noAppPelaRota ? 'pt-5' : 'pt-10')}>
        <Link href={raiz} className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Ferramentas
        </Link>
        <div className="mt-4 flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-line bg-elevated text-brand">
            <Printer className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Imprimir</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted sm:text-[15px]">
              Solte fotos, PDFs, Word, Excel e texto de uma vez. Cada arquivo entra na fila, é convertido aqui mesmo e
              sai como um trabalho próprio na impressora — sem precisar juntar tudo num documento antes.
            </p>
          </div>
        </div>
      </header>

      {erroGeral && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erroGeral}</span>
        </div>
      )}

      {fila.length === 0 ? (
        <div className="card p-5">
          <Dropzone
            accept={ACEITA}
            acceptLabel="PDF, JPG, PNG, WebP, DOCX, XLSX, PPTX ou TXT"
            multiple
            onFiles={(arquivos) => {
              try {
                validarFila(arquivos, []);
              } catch (e) {
                setErroGeral(e instanceof Error ? e.message : 'Arquivos recusados.');
                return;
              }
              adicionar(arquivos);
            }}
          />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            {item?.blob && (
              <div className="card overflow-hidden">
                <div className="flex items-center gap-2 border-b px-4 py-2">
                  <p className="min-w-0 flex-1 truncate text-xs text-muted">Prévia · {item.nomeOriginal}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setZoom(Math.max(0.25, escalaAtual - 0.25))}
                      className="btn-ghost px-2 py-1"
                      aria-label="Diminuir zoom"
                    >
                      <ZoomOut className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoom(0)}
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
                      onClick={() => setZoom(Math.min(4, escalaAtual + 0.25))}
                      className="btn-ghost px-2 py-1"
                      aria-label="Aumentar zoom"
                    >
                      <ZoomIn className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div ref={molduraRef} className="max-h-[70vh] overflow-auto bg-bg/40 p-4">
                  <div className="relative mx-auto w-fit">
                    <canvas ref={telaRef} className="block rounded-lg bg-white shadow-lg" />
                    {renderizando && (
                      <span className="absolute inset-0 grid place-items-center rounded-lg bg-bg/50">
                        <Loader2 className="h-5 w-5 animate-spin text-brand" />
                      </span>
                    )}
                  </div>
                </div>
                {item.paginas > 1 && (
                  <div className="flex items-center justify-center gap-3 border-t px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => setPagina((p) => Math.max(1, p - 1))}
                      disabled={pagina <= 1}
                      className="btn-ghost px-2.5 py-1.5 disabled:opacity-40"
                      aria-label="Página anterior"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-sm tabular-nums text-muted">
                      {pagina} de {item.paginas}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPagina((p) => Math.min(item.paginas, p + 1))}
                      disabled={pagina >= item.paginas}
                      className="btn-ghost px-2.5 py-1.5 disabled:opacity-40"
                      aria-label="Próxima página"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

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
                      onClick={() => linha.blob && setSelecionado(linha.id)}
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
                      onClick={() => remover(linha.id)}
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
                  accept={ACEITA}
                  acceptLabel="PDF, imagem, Word, Excel ou texto"
                  multiple
                  compact
                  onFiles={(arquivos) => {
                    try {
                      validarFila(arquivos, fila.map((i) => ({ size: i.origem.size })));
                    } catch (e) {
                      setErroGeral(e instanceof Error ? e.message : 'Arquivos recusados.');
                      return;
                    }
                    adicionar(arquivos);
                  }}
                />
              </div>
            </div>

          </div>

          <div className="card h-fit p-5">
            <p className="text-sm font-semibold tracking-tight">Opções</p>
            <p className="mt-1 text-xs text-muted">Valem para todos os arquivos da fila.</p>

            <div className="mt-4 space-y-3.5">
              {noApp && (
                <div>
                  <label htmlFor="impressora" className="field-label">
                    Impressora
                  </label>
                  {impressoras === null ? (
                    <p className="mt-1.5 flex items-center gap-2 text-sm text-muted">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Procurando...
                    </p>
                  ) : impressoras.length === 0 ? (
                    <p className="mt-1.5 text-sm text-muted">Nenhuma impressora instalada no Windows.</p>
                  ) : (
                    <select
                      id="impressora"
                      className={cx(campo, 'mt-1.5')}
                      value={opcoes.impressora ?? ''}
                      onChange={(e) => mudar('impressora', e.target.value)}
                    >
                      {impressoras.map((i) => (
                        <option key={i.nome} value={i.nome}>
                          {i.apelido}
                          {i.padrao ? ' (padrão)' : ''}
                        </option>
                      ))}
                    </select>
                  )}

                  {/*
                    Tipo e espessura do papel não passam pela API do Windows:
                    ficam no driver. Este botão leva direto à janela dele, e o
                    que for marcado lá vale para o que enviarmos daqui.
                  */}
                  <button
                    type="button"
                    onClick={() => void abrirPreferenciasDaImpressora(opcoes.impressora ?? '')}
                    disabled={!opcoes.impressora}
                    className="btn-ghost mt-2 w-full justify-start px-3 py-2 text-[13px] disabled:opacity-40"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Tipo e espessura do papel...
                  </button>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                    Papel grosso, fotográfico ou etiqueta ficam na janela do driver. O que você marcar lá vale para as
                    impressões feitas aqui.
                  </p>
                </div>
              )}

              <div>
                <label htmlFor="papel" className="field-label">
                  Papel
                </label>
                <select
                  id="papel"
                  className={cx(campo, 'mt-1.5')}
                  value={opcoes.papel}
                  onChange={(e) => mudar('papel', e.target.value as OpcoesImpressao['papel'])}
                >
                  <option value="A4">A4 · 210 × 297 mm</option>
                  <option value="Letter">Carta · 216 × 279 mm</option>
                  <option value="Legal">Ofício · 216 × 356 mm</option>
                  <option value="A3">A3 · 297 × 420 mm</option>
                  <option value="A5">A5 · 148 × 210 mm</option>
                  <option value="Tabloid">Tabloide · 279 × 432 mm</option>
                </select>
              </div>

              <div>
                <label htmlFor="qualidade" className="field-label">
                  Qualidade
                </label>
                <select
                  id="qualidade"
                  className={cx(campo, 'mt-1.5')}
                  value={String(opcoes.dpi)}
                  onChange={(e) => mudar('dpi', Number(e.target.value))}
                >
                  <option value="150">Rascunho · 150 DPI</option>
                  <option value="300">Normal · 300 DPI</option>
                  <option value="600">Alta · 600 DPI</option>
                  <option value="1200">Máxima · 1200 DPI</option>
                </select>
              </div>

              <div>
                <label htmlFor="duplex" className="field-label">
                  Frente e verso
                </label>
                <select
                  id="duplex"
                  className={cx(campo, 'mt-1.5')}
                  value={opcoes.duplex}
                  onChange={(e) => mudar('duplex', e.target.value as OpcoesImpressao['duplex'])}
                >
                  <option value="simplex">Só frente</option>
                  <option value="longEdge">Virar na borda longa</option>
                  <option value="shortEdge">Virar na borda curta</option>
                </select>
              </div>

              <div>
                <label htmlFor="copias" className="field-label">
                  Cópias de cada arquivo
                </label>
                <input
                  id="copias"
                  type="number"
                  min={1}
                  max={99}
                  className={cx(campo, 'mt-1.5')}
                  value={opcoes.copias}
                  onChange={(e) => mudar('copias', Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                />
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {(
                  [
                    ['Colorido', true],
                    ['Preto e branco', false],
                  ] as const
                ).map(([rotulo, valor]) => (
                  <button
                    key={rotulo}
                    type="button"
                    onClick={() => mudar('colorido', valor)}
                    className={cx(
                      'rounded-lg border px-3 py-1.5 text-[13px] font-medium transition',
                      opcoes.colorido === valor ? 'border-transparent bg-ink text-bg' : 'text-muted hover:text-ink',
                    )}
                  >
                    {rotulo}
                  </button>
                ))}
                {(
                  [
                    ['Retrato', false],
                    ['Paisagem', true],
                  ] as const
                ).map(([rotulo, valor]) => (
                  <button
                    key={rotulo}
                    type="button"
                    onClick={() => mudar('paisagem', valor)}
                    className={cx(
                      'rounded-lg border px-3 py-1.5 text-[13px] font-medium transition',
                      Boolean(opcoes.paisagem) === valor
                        ? 'border-transparent bg-ink text-bg'
                        : 'text-muted hover:text-ink',
                    )}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void imprimirTudo()}
              disabled={!prontos.length || Boolean(imprimindo) || preparando}
              className="btn-primary mt-5 w-full py-3"
            >
              {imprimindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              {imprimindo
                ? 'Enviando...'
                : prontos.length > 1
                  ? `Imprimir os ${prontos.length}`
                  : 'Imprimir'}
            </button>

            <button
              type="button"
              onClick={() => {
                setFila([]);
                setAviso(null);
              }}
              className="btn-ghost mt-2 w-full py-2 text-[13px]"
            >
              <Plus className="h-3.5 w-3.5 rotate-45" /> Limpar a fila
            </button>

            {aviso && <p className="mt-3 text-center text-xs text-brand">{aviso}</p>}

            <p className="mt-4 text-xs leading-relaxed text-muted">
              {noApp
                ? 'Cada arquivo da fila vira um trabalho separado na impressora.'
                : 'No navegador cada arquivo abre a caixa de impressão uma vez. No aplicativo a fila inteira vai de uma vez, sem perguntar.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
