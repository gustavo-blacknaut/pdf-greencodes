'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  ACEITA,
  CHAVE_DAS_OPCOES,
  OPCOES_PADRAO,
  conversaoPara,
  lerOpcoesSalvas,
  proximoId,
} from './impressao/fila';
import { OpcoesDeImpressao } from './impressao/OpcoesDeImpressao';
import { PreviaDaPagina, type FolhaNaTela } from './impressao/PreviaDaPagina';
import type { EstadoDoItem, ItemFila } from './impressao/tipos';
import { folhaEmMm, marcasDeCorte, marcasDeRegistro, passaDaFolha, posicionar, sobra } from '@/lib/impressao/layout';
import { atividade } from '@/lib/atividade';
import { vault } from '@/lib/ephemeral';
import { inspectFile, runOperation } from '@/lib/pdf/engine';
import { loadPdfJs, loadPdfLib } from '@/lib/pdf/lazy';
import { validarFila } from '@/lib/pdf/guards';
import {
  aoSoltarArquivos,
  estaNoAplicativo,
  abrirPreferenciasDaImpressora,
  imprimirArquivo,
  lerArquivoEscolhido,
  listarImpressoras,
  materializar,
  registrarUso,
  tamanhoDe,
  type Impressora,
  type OpcoesImpressao,
} from '@/lib/desktop';
import { cx, formatBytes, replaceExtension } from '@/lib/utils';

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
  // A medida da pagina atual em milimetros, que so se sabe depois de abrir.
  const [arteMm, setArteMm] = useState<{ largura: number; altura: number } | null>(null);


  // 1 = uma página por folha, sem montagem. Acima disso o documento é
  // remontado antes da prévia, para o que aparece ser o que sai impresso.
  // Vazio = todas. Aceita "1-5, 8, 11-" como a ferramenta de dividir.
  const [intervalo, setIntervalo] = useState('');
  const [porFolha, setPorFolha] = useState(1);
  const [montado, setMontado] = useState<{
    id: string;
    porFolha: number;
    intervalo: string;
    blob: Blob;
    paginas: number;
  } | null>(null);
  const [montando, setMontando] = useState(false);

  // 0 = manda o arquivo inteiro de uma vez. Acima disso ele é fatiado e vai
  // em lotes, na ordem.
  const [lote, setLote] = useState(0);

  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [noApp, setNoApp] = useState(false);
  const [impressoras, setImpressoras] = useState<Impressora[] | null>(null);
  const [opcoes, setOpcoes] = useState<OpcoesImpressao>(OPCOES_PADRAO);

  /**
   * A folha e a arte em cima dela, em pixels de tela.
   *
   * Antes a prévia mostrava só a página, do tamanho que ela é — quem olhava
   * não tinha como saber onde ela ia cair no papel nem quanto ia sobrar de
   * branco, que é justamente o que se quer conferir antes de uma tiragem.
   *
   * A conta é a mesma que o HTML da impressão usa, em `lib/impressao/layout`.
   * Aqui ela só é convertida de milímetro para pixel.
   */
  const folhaNaTela = useMemo<FolhaNaTela | null>(() => {
    if (!arteMm || !larguraDisponivel) return null;

    const folha = folhaEmMm(String(opcoes.papel ?? 'A4'), Boolean(opcoes.paisagem));
    const ajuste = {
      escala: (opcoes.escala ?? opcoes.ajuste ?? 'pagina') as NonNullable<typeof opcoes.escala>,
      porcento: opcoes.escalaPorcento,
      deslocaX: opcoes.deslocaXmm,
      deslocaY: opcoes.deslocaYmm,
      margemLados: opcoes.margemLadosMm,
      margemCima: opcoes.margemCimaMm,
    };
    const caixa = posicionar(folha, arteMm, ajuste);

    // A folha inteira cabe na largura disponível; o zoom multiplica dali.
    const porMm = (larguraDisponivel / folha.largura) * (zoom > 0 ? zoom : 1);
    const emPx = (valor: number) => valor * porMm;

    const marcas: FolhaNaTela['marcas'] = [];
    if (opcoes.marcasCorte) {
      const espessura = Math.max(1, emPx(0.25));
      for (const traco of marcasDeCorte(caixa)) {
        marcas.push({
          x: emPx(Math.min(traco.x1, traco.x2)),
          y: emPx(Math.min(traco.y1, traco.y2)),
          largura: Math.max(espessura, emPx(Math.abs(traco.x2 - traco.x1))),
          altura: Math.max(espessura, emPx(Math.abs(traco.y2 - traco.y1))),
        });
      }
    }
    if (opcoes.marcasRegistro) {
      const lado = Math.max(3, emPx(3));
      for (const alvo of marcasDeRegistro(caixa)) {
        marcas.push({ x: emPx(alvo.x) - lado / 2, y: emPx(alvo.y) - lado / 2, largura: lado, altura: lado });
      }
    }

    return {
      largura: emPx(folha.largura),
      altura: emPx(folha.altura),
      arte: { x: emPx(caixa.x), y: emPx(caixa.y), largura: emPx(caixa.largura), altura: emPx(caixa.altura) },
      marcas,
      espelho:
        opcoes.espelho === 'horizontal'
          ? 'scaleX(-1)'
          : opcoes.espelho === 'vertical'
            ? 'scaleY(-1)'
            : undefined,
      negativo: Boolean(opcoes.negativo),
    };
  }, [arteMm, larguraDisponivel, zoom, opcoes]);

  /*
   * O desenho da folha, visto de dentro do efeito que renderiza.
   *
   * O efeito não pode depender de `folhaNaTela`: ela muda a cada ajuste, e o
   * documento seria redesenhado a cada clique numa seta de milímetro. A ref
   * dá o valor de agora sem entrar na lista de dependências.
   */
  const desenhaFolhaRef = useRef(false);
  useEffect(() => {
    desenhaFolhaRef.current = Boolean(folhaNaTela);
  }, [folhaNaTela]);

  /** O aviso de que parte da arte não vai sair impressa. */
  const avisoDeSobra = useMemo(() => {
    if (!arteMm) return null;
    const folha = folhaEmMm(String(opcoes.papel ?? 'A4'), Boolean(opcoes.paisagem));
    const caixa = posicionar(folha, arteMm, {
      escala: (opcoes.escala ?? opcoes.ajuste ?? 'pagina') as NonNullable<typeof opcoes.escala>,
      porcento: opcoes.escalaPorcento,
      deslocaX: opcoes.deslocaXmm,
      deslocaY: opcoes.deslocaYmm,
      margemLados: opcoes.margemLadosMm,
      margemCima: opcoes.margemCimaMm,
    });
    if (!passaDaFolha(folha, caixa)) return null;

    const fora = sobra(folha, caixa);
    const maior = Math.max(fora.esquerda, fora.direita, fora.cima, fora.baixo);
    return `A arte passa da folha em até ${maior.toFixed(1)} mm. O que fica de fora não sai impresso.`;
  }, [arteMm, opcoes]);
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
    setOpcoes(lerOpcoesSalvas());
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
          estado: 'esperando' as EstadoDoItem,
        };
      }),
    ]);
  }, []);

  /**
   * O que chega do seletor ou arrastado para a janela.
   *
   * A prévia desenha a página, então precisa dos bytes: o PDF grande que o
   * seletor deixou no disco é lido aqui. A fila é lida por ref porque quem
   * chama pode ser a inscrição no arrastar, montada uma vez só.
   */
  const filaRef = useRef(fila);
  filaRef.current = fila;
  const receberArquivos = useCallback(
    async (arquivos: File[]) => {
      try {
        validarFila(
          arquivos.map((a) => ({ name: a.name, size: tamanhoDe(a) })),
          filaRef.current.map((i) => ({ size: i.origem.size })),
        );
        adicionar(await Promise.all(arquivos.map(materializar)));
      } catch (e) {
        setErroGeral(e instanceof Error ? e.message : 'Arquivos recusados.');
      }
    },
    [adicionar],
  );

  // Soltar na janela do aplicativo: vem o caminho, como no seletor.
  useEffect(
    () =>
      aoSoltarArquivos((lista) => {
        void (async () => {
          try {
            receberArquivos(await Promise.all(lista.map(lerArquivoEscolhido)));
          } catch (e) {
            setErroGeral(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
          }
        })();
      }),
    [receberArquivos],
  );

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
      const tarefaConv = atividade.abrir(`Preparar ${alvo.nomeOriginal}`, 'ferramenta');
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
        atividade.fechar(tarefaConv, 'concluida', `${paginas} página(s)`);
      } catch (e) {
        atualizar({ estado: 'erro', erro: e instanceof Error ? e.message : 'Não foi possível preparar o arquivo.' });
        atividade.fechar(tarefaConv, 'erro', e instanceof Error ? e.message : undefined);
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
    if (
      montado &&
      montado.id === alvo.id &&
      montado.porFolha === porFolha &&
      montado.intervalo === intervalo
    ) {
      return { blob: montado.blob, paginas: montado.paginas };
    }
    // Enquanto a montagem não termina, não vale desenhar o original: a
    // prévia mostraria uma coisa e a impressora sairia com outra.
    // Enquanto o preparo não termina, não vale desenhar o original: a prévia
    // mostraria uma coisa e a impressora sairia com outra.
    return porFolha > 1 || intervalo.trim() ? null : { blob: alvo.blob, paginas: alvo.paginas };
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
        // Escala 1 do pdf.js e ponto tipografico: 72 por polegada.
        setArteMm({ largura: (natural.width / 72) * 25.4, altura: (natural.height / 72) * 25.4 });

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
        /*
         * O canvas é grande por dentro e do tamanho certo por fora: é isso
         * que dá texto nítido em vez de ampliado.
         *
         * Quando a prévia desenha a folha, quem manda no tamanho de fora é o
         * layout — o canvas é esticado para dentro da caixa da arte, na
         * posição e na escala que vão para o papel. Mexer aqui também faria
         * os dois brigarem, e a arte piscaria de tamanho a cada desenho.
         */
        if (!desenhaFolhaRef.current) {
          tela.style.width = `${Math.round(natural.width * escalaCss)}px`;
          tela.style.height = `${Math.round(natural.height * escalaCss)}px`;
        } else {
          tela.style.removeProperty('width');
          tela.style.removeProperty('height');
        }

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
   * Prepara o que vai sair: primeiro escolhe as páginas, depois monta as
   * folhas.
   *
   * Nessa ordem, e não na contrária: escolher "1-4" com 4 por folha tem que
   * dar uma folha com as quatro primeiras páginas, não a primeira folha de um
   * documento já montado.
   *
   * O preparo acontece antes de desenhar, e não na hora de imprimir, para a
   * prévia mostrar o que sai da impressora.
   */
  useEffect(() => {
    const semPreparo = porFolha <= 1 && !intervalo.trim();
    if (!item?.blob || semPreparo) {
      setMontado(null);
      return;
    }
    if (montado?.id === item.id && montado.porFolha === porFolha && montado.intervalo === intervalo) return;

    let vivo = true;
    void (async () => {
      setMontando(true);
      try {
        let blob = item.blob!;

        if (intervalo.trim()) {
          const arquivo = new File([blob], item.nome, { type: 'application/pdf' });
          const carregado = await inspectFile(arquivo, item.id);
          const r = await runOperation('split', {
            files: [carregado],
            options: { mode: 'extract', extractRanges: intervalo },
            onProgress: () => {},
          });
          blob = r.files[0].blob;
        }

        if (porFolha > 1) {
          const arquivo = new File([blob], item.nome, { type: 'application/pdf' });
          const carregado = await inspectFile(arquivo, item.id);
          const r = await runOperation('n-up', {
            files: [carregado],
            options: { perSheet: porFolha, espacamentoMm: 2, margemMm: 4, border: false },
            onProgress: () => {},
          });
          blob = r.files[0].blob;
        }

        const pdfjs = await loadPdfJs();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        const paginas = doc.numPages;
        await doc.destroy();

        if (!vivo) return;
        setMontado({ id: item.id, porFolha, intervalo, blob, paginas });
        setErroGeral(null);
      } catch (e) {
        if (!vivo) return;
        setMontado(null);
        setErroGeral(e instanceof Error ? e.message : 'Não foi possível preparar as páginas.');
      } finally {
        if (vivo) setMontando(false);
      }
    })();

    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.blob, porFolha, intervalo]);

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
      localStorage.setItem(CHAVE_DAS_OPCOES, JSON.stringify(opcoes));
    } catch {
      /* modo anônimo: imprime do mesmo jeito */
    }

    let enviados = 0;
    let trabalhos = 0;
    let cancelou = false;

    for (const alvo of prontos) {
      setImprimindo(alvo.id);
      const tarefa = atividade.abrir(`Imprimir ${alvo.nomeOriginal}`, 'impressao');
      atividade.registrar(
        tarefa,
        `${opcoes.impressora ?? 'impressora padrão'} · ${opcoes.papel} · ${opcoes.dpi} DPI · ${opcoes.colorido === false ? 'preto e branco' : 'colorido'}`,
        0,
      );
      const saida = paraSaida(alvo);
      if (!saida) continue;

      let falhou: string | undefined;
      const partes = await fatiar(saida.blob, saida.paginas, lote);

      for (let n = 0; n < partes.length; n += 1) {
        const nome = partes.length > 1 ? alvo.nome.replace(/.pdf$/i, `-parte${n + 1}.pdf`) : alvo.nome;
        const r = await imprimirArquivo(nome, partes[n], opcoes, (feitas, total) =>
          atividade.registrar(
            tarefa,
            `Desenhando página ${feitas} de ${total}` + (partes.length > 1 ? ` (lote ${n + 1}/${partes.length})` : ''),
            feitas / total,
          ),
        );

        if (r.cancelado) {
          cancelou = true;
          atividade.fechar(tarefa, 'cancelada');
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
        atividade.fechar(tarefa, 'erro', falhou);
      } else {
        enviados += 1;
        // Só a quantidade: folhas e cópias, nunca o nome do arquivo.
        registrarUso({ tipo: 'impressao', folhas: saida.paginas, copias: opcoes.copias ?? 1 });
        setFila((atual) => atual.map((i) => (i.id === alvo.id ? { ...i, estado: 'impresso' } : i)));
        atividade.fechar(tarefa, 'concluida', `${partes.length} trabalho(s) na impressora`);
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
    <div className="mx-auto max-w-[1600px] px-4 pb-12 sm:px-6">
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
            onFiles={(arquivos) => void receberArquivos(arquivos)}
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
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
                  folha={folhaNaTela}
                  aviso={avisoDeSobra}
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
              onAdicionar={(arquivos) => void receberArquivos(arquivos)}
            />

          </div>

          <OpcoesDeImpressao
            opcoes={opcoes}
            impressoras={impressoras}
            noApp={noApp}
            intervalo={intervalo}
            porFolha={porFolha}
            montando={montando}
            lote={lote}
            prontos={prontos.length}
            imprimindo={imprimindo}
            preparando={preparando}
            aviso={aviso}
            onMudar={mudar}
            onIntervalo={setIntervalo}
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
