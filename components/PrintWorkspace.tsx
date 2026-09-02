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
import { FilaDeArquivos } from './impressao/FilaDeArquivos';
import { OpcoesDeImpressao } from './impressao/OpcoesDeImpressao';
import { PreviaDaPagina } from './impressao/PreviaDaPagina';
import { vault } from '@/lib/ephemeral';
import { inspectFile, runOperation, type OperationId } from '@/lib/pdf/engine';
import { loadPdfJs, loadPdfLib } from '@/lib/pdf/lazy';
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

  // 1 = uma página por folha, sem montagem. Acima disso o documento é
  // remontado antes da prévia, para o que aparece ser o que sai impresso.
  const [porFolha, setPorFolha] = useState(1);
  const [montado, setMontado] = useState<{ id: string; porFolha: number; blob: Blob; paginas: number } | null>(null);
  const [montando, setMontando] = useState(false);

  // 0 = manda o arquivo inteiro de uma vez. Acima disso ele é fatiado e vai
  // em lotes, na ordem.
  const [lote, setLote] = useState(0);

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

  /** O que vale para prévia e impressão: o montado, quando há montagem. */
  function paraSaida(alvo: ItemFila | null): { blob: Blob; paginas: number } | null {
    if (!alvo?.blob) return null;
    if (montado && montado.id === alvo.id && montado.porFolha === porFolha) {
      return { blob: montado.blob, paginas: montado.paginas };
    }
    // Enquanto a montagem não termina, não vale desenhar o original: a
    // prévia mostraria uma coisa e a impressora sairia com outra.
    return porFolha > 1 ? null : { blob: alvo.blob, paginas: alvo.paginas };
  }

  /** Abre o documento escolhido uma vez e guarda a referência. */
  useEffect(() => {
    const saida = paraSaida(item);
    if (!saida) {
      void docRef.current?.destroy();
      docRef.current = null;
      return;
    }

    let vivo = true;
    void (async () => {
      const pdfjs = await loadPdfJs();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await saida.blob.arrayBuffer()) }).promise;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.blob, montado, porFolha]);

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

  /**
   * Remonta o arquivo escolhido com N páginas por folha.
   *
   * A prévia tem que mostrar o que sai da impressora, então a montagem
   * acontece antes de desenhar, e não na hora de imprimir.
   */
  useEffect(() => {
    if (!item?.blob || porFolha <= 1) {
      setMontado(null);
      return;
    }
    if (montado?.id === item.id && montado.porFolha === porFolha) return;

    let vivo = true;
    void (async () => {
      setMontando(true);
      try {
        const arquivo = new File([item.blob!], item.nome, { type: 'application/pdf' });
        const carregado = await inspectFile(arquivo, item.id);
        const r = await runOperation('n-up', {
          files: [carregado],
          options: { perSheet: porFolha, espacamentoMm: 2, margemMm: 4, border: false },
          onProgress: () => {},
        });
        if (!vivo) return;
        setMontado({
          id: item.id,
          porFolha,
          blob: r.files[0].blob,
          paginas: r.files[0].pages ?? 1,
        });
      } catch {
        if (vivo) setMontado(null);
      } finally {
        if (vivo) setMontando(false);
      }
    })();

    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.blob, porFolha]);

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
   * Fatia um PDF em blocos de N páginas, na ordem.
   *
   * Documento grande num único trabalho é o que trava fila de impressora em
   * rede de 100 Mbps: o spool recebe dezenas de megabytes de uma vez e a
   * impressora fica sem resposta até digerir tudo. Em blocos, cada um cabe na
   * memória dela e a próxima parte só sai depois que a anterior entrou.
   */
  async function fatiar(blob: Blob, paginas: number, tamanho: number): Promise<Blob[]> {
    if (tamanho <= 0 || paginas <= tamanho) return [blob];

    const { PDFDocument } = await loadPdfLib();
    const origem = await PDFDocument.load(await blob.arrayBuffer());
    const partes: Blob[] = [];

    for (let inicio = 0; inicio < paginas; inicio += tamanho) {
      const indices = Array.from(
        { length: Math.min(tamanho, paginas - inicio) },
        (_, k) => inicio + k,
      );
      const parte = await PDFDocument.create();
      for (const pagina of await parte.copyPages(origem, indices)) parte.addPage(pagina);
      const bytes = await parte.save({ useObjectStreams: true });
      partes.push(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' }));
    }
    return partes;
  }

  /**
   * Manda a fila inteira, um arquivo por vez, e cada arquivo em lotes quando
   * está configurado assim. A ordem é sempre a da fila e a das páginas.
   *
   * Erro num item não derruba o resto: ele fica marcado e a fila segue.
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
    let trabalhos = 0;
    let cancelou = false;

    for (const alvo of prontos) {
      setImprimindo(alvo.id);
      const saida = paraSaida(alvo);
      if (!saida) continue;

      let falhou: string | undefined;
      const partes = await fatiar(saida.blob, saida.paginas, lote);

      for (let n = 0; n < partes.length; n += 1) {
        const nome = partes.length > 1 ? alvo.nome.replace(/.pdf$/i, `-parte${n + 1}.pdf`) : alvo.nome;
        const r = await imprimirArquivo(nome, partes[n], opcoes);

        if (r.cancelado) {
          cancelou = true;
          break;
        }
        if (!r.ok) {
          falhou = r.erro;
          break;
        }
        trabalhos += 1;
      }

      if (cancelou) break;
      if (falhou) {
        setFila((atual) => atual.map((i) => (i.id === alvo.id ? { ...i, estado: 'erro', erro: falhou } : i)));
      } else {
        enviados += 1;
        setFila((atual) => atual.map((i) => (i.id === alvo.id ? { ...i, estado: 'impresso' } : i)));
      }
    }

    setImprimindo(null);
    const emLotes = trabalhos > enviados ? ` em ${trabalhos} lotes` : '';
    setAviso(
      cancelou
        ? `Fila interrompida. ${enviados} de ${prontos.length} foram enviados.`
        : `${enviados} arquivo${enviados === 1 ? '' : 's'} enviado${enviados === 1 ? '' : 's'}${emLotes}.`,
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
            {(() => {
              const saida = paraSaida(item);
              return item?.blob && saida ? (
                <PreviaDaPagina
                  nome={item.nomeOriginal}
                  paginas={saida.paginas}
                  pagina={pagina}
                  zoom={zoom}
                  escalaAtual={escalaAtual}
                  renderizando={renderizando}
                  telaRef={telaRef}
                  molduraRef={molduraRef}
                  onZoom={setZoom}
                  onPagina={setPagina}
                />
              ) : null;
            })()}
            <FilaDeArquivos
              fila={fila}
              selecionado={selecionado}
              imprimindo={imprimindo}
              totalPaginas={totalPaginas}
              preparando={preparando}
              aceita={ACEITA}
              onSelecionar={setSelecionado}
              onRemover={remover}
              onAdicionar={(arquivos) => {
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

          <OpcoesDeImpressao
            opcoes={opcoes}
            impressoras={impressoras}
            noApp={noApp}
            porFolha={porFolha}
            montando={montando}
            lote={lote}
            prontos={prontos.length}
            imprimindo={imprimindo}
            preparando={preparando}
            aviso={aviso}
            onMudar={mudar}
            onPorFolha={setPorFolha}
            onLote={setLote}
            onImprimir={() => void imprimirTudo()}
            onLimpar={() => {
              setFila([]);
              setAviso(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
