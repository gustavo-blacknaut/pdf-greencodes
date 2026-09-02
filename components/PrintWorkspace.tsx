'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Printer,
  RefreshCw,
} from 'lucide-react';
import { Dropzone } from './Dropzone';
import { vault } from '@/lib/ephemeral';
import { inspectFile, runOperation, type OperationId } from '@/lib/pdf/engine';
import { loadPdfJs } from '@/lib/pdf/lazy';
import { validarFila } from '@/lib/pdf/guards';
import { estaNoAplicativo, imprimirArquivo, listarImpressoras, type Impressora, type OpcoesImpressao } from '@/lib/desktop';
import { cx, formatBytes } from '@/lib/utils';

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

type Documento = { nome: string; blob: Blob; paginas: number };

export function PrintWorkspace() {
  const parametros = useSearchParams();
  const noAppPelaRota = usePathname().startsWith('/app');

  const [documento, setDocumento] = useState<Documento | null>(null);
  const [preparando, setPreparando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [renderizando, setRenderizando] = useState(false);
  // O desenho depende do documento já aberto. Sem este contador, o efeito de
  // render corre antes de docRef existir e não volta mais: nada nas deps muda.
  const [docPronto, setDocPronto] = useState(0);

  const [noApp, setNoApp] = useState(false);
  const [impressoras, setImpressoras] = useState<Impressora[] | null>(null);
  const [opcoes, setOpcoes] = useState<OpcoesImpressao>(PADRAO);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const telaRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<{ numPages: number; getPage: (n: number) => Promise<any>; destroy: () => Promise<void> } | null>(null);
  const tarefaRef = useRef<{ cancel: () => void } | null>(null);

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

  /** Arquivo vindo de outra ferramenta, guardado no cofre. */
  useEffect(() => {
    const fonte = parametros.get('fonte');
    const alvo = parametros.get('arquivo');
    if (!fonte) return;
    const entrada = vault.get(fonte);
    const achado = entrada?.files.find((f) => f.name === alvo) ?? entrada?.files[0];
    if (achado) void receber(achado.blob, achado.name);
    else setErro('O resultado expirou ou já foi apagado da memória. Escolha o arquivo de novo.');
    // Só na montagem: depois disso quem manda é o que está na tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Converte o que não é PDF e conta as páginas. */
  const receber = useCallback(async (blob: Blob, nome: string) => {
    setErro(null);
    setDocumento(null);
    setPagina(1);

    try {
      let pdf = blob;
      let nomeFinal = nome;

      const operacao = conversaoPara(nome);
      if (operacao) {
        setPreparando(`Convertendo ${nome}...`);
        const arquivo = new File([blob], nome);
        const carregado = await inspectFile(arquivo, 'imprimir');
        if (carregado.error) throw new Error(carregado.error);
        const resultado = await runOperation(operacao, {
          files: [carregado],
          options: {},
          onProgress: (_f, rotulo) => rotulo && setPreparando(rotulo),
        });
        pdf = resultado.files[0].blob;
        nomeFinal = resultado.files[0].name;
      }

      setPreparando('Abrindo o documento...');
      const pdfjs = await loadPdfJs();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await pdf.arrayBuffer()) }).promise;
      const paginas = doc.numPages;
      await doc.destroy();

      setDocumento({ nome: nomeFinal, blob: pdf, paginas });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível preparar este arquivo.');
    } finally {
      setPreparando(null);
    }
  }, []);

  /**
   * Abre o documento uma vez e guarda a referência.
   *
   * Reabrir o PDF a cada troca de página faz o pdf.js reparsear o arquivo
   * inteiro: num i3 antigo isso é meio segundo por clique. Aqui só a página
   * pedida é desenhada, e o documento fica aberto entre uma e outra.
   */
  useEffect(() => {
    if (!documento) {
      void docRef.current?.destroy();
      docRef.current = null;
      return;
    }

    let vivo = true;
    void (async () => {
      const pdfjs = await loadPdfJs();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await documento.blob.arrayBuffer()) }).promise;
      if (!vivo) {
        await doc.destroy();
        return;
      }
      docRef.current = doc;
      setDocPronto((n) => n + 1);
      setPagina(1);
    })();

    return () => {
      vivo = false;
    };
  }, [documento]);

  /**
   * Desenha uma página só, na largura da tela e sem passar de 1x.
   *
   * A prévia serve para conferir se é o arquivo certo e se a orientação está
   * boa, não para ler o documento — por isso não vale gastar CPU com mais.
   */
  useEffect(() => {
    const doc = docRef.current;
    if (!documento || !doc) return;
    let vivo = true;

    void (async () => {
      setRenderizando(true);
      try {
        const p = await doc.getPage(Math.min(pagina, doc.numPages));
        const original = p.getViewport({ scale: 1 });
        const escala = Math.min(1, 820 / original.width);
        const viewport = p.getViewport({ scale: escala });

        const tela = telaRef.current;
        if (!tela || !vivo) return;
        tela.width = Math.floor(viewport.width);
        tela.height = Math.floor(viewport.height);

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
  }, [documento, pagina, docPronto]);

  function mudar<K extends keyof OpcoesImpressao>(chave: K, valor: OpcoesImpressao[K]) {
    setOpcoes((atual) => ({ ...atual, [chave]: valor }));
  }

  async function imprimir() {
    if (!documento) return;
    setEnviando(true);
    setAviso(null);
    try {
      localStorage.setItem(CHAVE, JSON.stringify(opcoes));
    } catch {
      /* modo anônimo: imprime do mesmo jeito */
    }
    const r = await imprimirArquivo(documento.nome, documento.blob, opcoes);
    setEnviando(false);
    if (r.ok) setAviso(r.cancelado ? 'Impressão cancelada.' : 'Enviado para a impressora.');
    else setErro(r.erro ?? 'Não foi possível imprimir.');
  }

  const campo = 'w-full rounded-xl border bg-bg/60 px-3 py-2.5 text-sm text-ink outline-none transition';
  const raiz = noAppPelaRota ? '/app' : '/';

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
              Solte um PDF, foto, Word, Excel, PowerPoint ou texto. O que não for PDF é convertido aqui mesmo, você
              confere na prévia e manda para a impressora.
            </p>
          </div>
        </div>
      </header>

      {erro && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {!documento ? (
        <div className="card p-5">
          {preparando ? (
            <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> {preparando}
            </p>
          ) : (
            <Dropzone
              accept={ACEITA}
              acceptLabel="PDF, JPG, PNG, WebP, DOCX, XLSX, PPTX ou TXT"
              multiple={false}
              onFiles={(arquivos) => {
                try {
                  validarFila(arquivos, []);
                } catch (e) {
                  setErro(e instanceof Error ? e.message : 'Arquivo recusado.');
                  return;
                }
                void receber(arquivos[0], arquivos[0].name);
              }}
            />
          )}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="card overflow-hidden">
            <div className="flex items-center gap-3 border-b px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{documento.nome}</p>
                <p className="text-xs text-muted">
                  {formatBytes(documento.blob.size)} · {documento.paginas} página
                  {documento.paginas > 1 ? 's' : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDocumento(null);
                  setAviso(null);
                }}
                className="btn-ghost px-3 py-1.5 text-[13px]"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Trocar
              </button>
            </div>

            <div className="grid min-h-80 place-items-center bg-bg/40 p-4">
              <div className="relative">
                <canvas ref={telaRef} className="max-w-full rounded-lg bg-white shadow-lg" />
                {renderizando && (
                  <span className="absolute inset-0 grid place-items-center rounded-lg bg-bg/50">
                    <Loader2 className="h-5 w-5 animate-spin text-brand" />
                  </span>
                )}
              </div>
            </div>

            {documento.paginas > 1 && (
              <div className="flex items-center justify-center gap-3 border-t px-4 py-3">
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
                  {pagina} de {documento.paginas}
                </span>
                <button
                  type="button"
                  onClick={() => setPagina((p) => Math.min(documento.paginas, p + 1))}
                  disabled={pagina >= documento.paginas}
                  className="btn-ghost px-2.5 py-1.5 disabled:opacity-40"
                  aria-label="Próxima página"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          <div className="card h-fit p-5">
            <p className="text-sm font-semibold tracking-tight">Opções</p>

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
                  Cópias
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
              onClick={() => void imprimir()}
              disabled={enviando}
              className="btn-primary mt-5 w-full py-3"
            >
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              {enviando ? 'Enviando...' : 'Imprimir'}
            </button>

            {aviso && <p className="mt-3 text-center text-xs text-brand">{aviso}</p>}

            <p className="mt-4 text-xs leading-relaxed text-muted">
              {noApp
                ? 'Tipo e espessura do papel (comum, fotográfico, cartão) são do driver da impressora e ficam nas Preferências dela, no Windows.'
                : 'No navegador quem escolhe a impressora é a caixa do próprio navegador. No aplicativo dá para escolher aqui e imprimir direto.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
