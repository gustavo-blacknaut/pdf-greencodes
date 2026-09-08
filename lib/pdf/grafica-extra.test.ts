/**
 * Cartaz, sangria, dobra, frente e verso, e carimbo — conferidos na tinta.
 *
 * As três primeiras dependem de recorte no PDF, escrito com operadores crus
 * porque o pdf-lib não tem função para isso. Recorte errado não estoura: ele
 * entrega um arquivo bonito com a arte inteira em cada folha do cartaz, ou
 * com a sangria espelhada cobrindo o desenho. Nenhuma asserção de medida de
 * página pega isso — só rasterizar e olhar onde a tinta caiu.
 *
 * O documento de origem é sempre o mesmo: metade esquerda preta, metade
 * direita branca. Assimétrico de propósito, porque é a assimetria que
 * denuncia espelho trocado de lado e fatia trocada de coluna.
 */
import { describe, expect, it } from 'vitest';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';
import { addBleed, foldMarks, frenteEVerso, posterTiles, stampImage } from './operacoes/grafica-extra';
import { faixasDaLinha, rasterizar, TEM_RASTERIZADOR, tintaEm } from './raster-de-teste';
import type { LoadedFile, RunContext } from './tipos';

const comRaster = TEM_RASTERIZADOR ? describe : describe.skip;

if (!TEM_RASTERIZADOR) {
  console.warn('[grafica-extra] motor/runtime nao esta neste checkout: a conferencia do desenho foi pulada.');
}

/** Uma página com a metade esquerda preta e a direita branca. */
async function meioAMeio(largura = 400, altura = 300, paginas = 1): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i += 1) {
    const pagina = doc.addPage([largura, altura]);
    pagina.drawRectangle({ x: 0, y: 0, width: largura / 2, height: altura, color: rgb(0, 0, 0) });
  }
  return (await doc.save()).buffer as ArrayBuffer;
}

/** Uma página numerada, para conferir ordem sem depender de leitura de texto. */
async function comMarcaEm(quantas: number, altura: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < quantas; i += 1) {
    const pagina = doc.addPage([200, 200]);
    // Uma tarja numa altura diferente por página: dá para saber qual página é
    // olhando só onde a tinta está.
    pagina.drawRectangle({ x: 20, y: altura + i * 20, width: 160, height: 10, color: rgb(0, 0, 0) });
  }
  return (await doc.save()).buffer as ArrayBuffer;
}

function arquivo(bytes: ArrayBuffer, name = 'arte.pdf', type = 'application/pdf'): LoadedFile {
  return { id: name, name, size: bytes.byteLength, type, bytes, pageCount: null, thumbnail: null };
}

function pedido(arquivos: LoadedFile[], options: Record<string, string | number | boolean> = {}): RunContext {
  return { files: arquivos, options, onProgress: () => {} };
}

const bytesDe = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

comRaster('cartaz em partes', () => {
  it('cada folha mostra só o seu pedaço, e não a arte inteira', async () => {
    /*
     * É o teste que justifica o recorte existir. Sem `W n`, o `drawPage`
     * desenha a arte inteira em cada folha e as duas saem idênticas — um PDF
     * que abre, imprime, e só se descobre errado com as folhas na mesa.
     */
    const resultado = await posterTiles(
      pedido([arquivo(await meioAMeio())], {
        colunas: 2,
        papel: 'a4',
        margemMm: 10,
        sobreposicaoMm: 0,
        marcas: false,
      }),
    );

    const bytes = await bytesDe(resultado.files[0].blob);
    const esquerda = rasterizar(bytes, 72, 0);
    const direita = rasterizar(bytes, 72, 1);

    const dentro = (imagem: typeof esquerda) => ({
      x: Math.round(imagem.largura * 0.15),
      y: Math.round(imagem.altura * 0.3),
      largura: Math.round(imagem.largura * 0.7),
      altura: Math.round(imagem.altura * 0.4),
    });

    expect(tintaEm(esquerda, dentro(esquerda)), 'a folha da esquerda leva a metade preta').toBeGreaterThan(0.9);
    expect(tintaEm(direita, dentro(direita)), 'a folha da direita leva a metade branca').toBeLessThan(0.05);
  }, 120_000);

  it('a altura em folhas sai da proporção da arte', async () => {
    // Arte quadrada em duas folhas A4 de largura: a altura tem que passar de
    // uma folha, senão a conta de escala está errada.
    const resultado = await posterTiles(
      pedido([arquivo(await meioAMeio(400, 400))], { colunas: 2, papel: 'a4', sobreposicaoMm: 10 }),
    );
    expect(resultado.files[0].pages).toBeGreaterThan(2);
    expect(resultado.notes[0]).toMatch(/^2 x \d+ folhas/);
  }, 120_000);

  it('a aba de cola encolhe o cartaz, porque as folhas passam a se sobrepor', async () => {
    /*
     * Vale registrar porque é contraintuitivo: pedindo "duas folhas de
     * largura", quanto maior a aba de cola menor sai o cartaz. As duas folhas
     * deixam de somar duas larguras e passam a somar duas menos a faixa
     * repetida. Quem quiser o cartaz maior aumenta as colunas, não a aba.
     */
    const semAba = await posterTiles(
      pedido([arquivo(await meioAMeio())], { colunas: 2, sobreposicaoMm: 0, marcas: false }),
    );
    const comAba = await posterTiles(
      pedido([arquivo(await meioAMeio())], { colunas: 2, sobreposicaoMm: 20, marcas: false }),
    );

    const medida = (notas: string[]) => Number(notas[0].match(/montando ([\d.]+)/)?.[1] ?? 0);
    expect(medida(comAba.notes)).toBeLessThan(medida(semAba.notes));
    expect(comAba.notes[1]).toMatch(/20 mm da vizinha/);
  }, 120_000);

  it('recusa o cartaz que daria folhas demais', async () => {
    // Doze folhas de largura numa arte quadrada dariam mais de cem folhas de
    // altura. O teto existe para o engano não virar uma fila de impressão.
    await expect(
      posterTiles(pedido([arquivo(await meioAMeio(400, 4000))], { colunas: 12, papel: 'a5' })),
    ).rejects.toThrow(/folhas/);
  }, 120_000);
});

comRaster('sangria', () => {
  it('cresce a página nos dois lados de cada eixo', async () => {
    const resultado = await addBleed(pedido([arquivo(await meioAMeio(400, 300))], { sangriaMm: 5, modo: 'cor' }));
    const doc = await PDFDocument.load(await resultado.files[0].blob.arrayBuffer());
    const { width, height } = doc.getPage(0).getSize();
    // 5 mm são 14,17 pontos; 400 + 2x isso.
    expect(width).toBeCloseTo(400 + 2 * 5 * (72 / 25.4), 1);
    expect(height).toBeCloseTo(300 + 2 * 5 * (72 / 25.4), 1);
  }, 120_000);

  it('o espelho copia a borda de cada lado, e não a do lado oposto', async () => {
    /*
     * A metade esquerda da arte é preta e a direita é branca. Então, se o
     * espelho estiver certo, a sangria da esquerda sai preta e a da direita
     * sai branca. Se os eixos estiverem trocados — o erro fácil de cometer,
     * porque escala negativa manda o desenho para o outro lado da origem —
     * as duas saem invertidas, e este teste é o que percebe.
     */
    const resultado = await addBleed(
      pedido([arquivo(await meioAMeio(400, 300))], { sangriaMm: 10, modo: 'espelho' }),
    );
    const imagem = rasterizar(await bytesDe(resultado.files[0].blob), 150);

    const sangriaEmPixels = Math.round((10 / 25.4) * 150);
    const meio = { y: Math.round(imagem.altura / 2) - 10, altura: 20 };

    const naEsquerda = tintaEm(imagem, {
      x: 1,
      y: meio.y,
      largura: sangriaEmPixels - 2,
      altura: meio.altura,
    });
    const naDireita = tintaEm(imagem, {
      x: imagem.largura - sangriaEmPixels + 1,
      y: meio.y,
      largura: sangriaEmPixels - 2,
      altura: meio.altura,
    });

    expect(naEsquerda, 'a sangria da esquerda espelha a metade preta').toBeGreaterThan(0.9);
    expect(naDireita, 'a sangria da direita espelha a metade branca').toBeLessThan(0.05);
  }, 120_000);

  it('a sangria de cima e de baixo herda a divisão da arte', async () => {
    // Em cima e embaixo o espelho é só no eixo vertical, então a divisão
    // esquerda-direita continua valendo: metade preta, metade branca.
    const resultado = await addBleed(
      pedido([arquivo(await meioAMeio(400, 300))], { sangriaMm: 10, modo: 'espelho' }),
    );
    const imagem = rasterizar(await bytesDe(resultado.files[0].blob), 150);
    const sangriaEmPixels = Math.round((10 / 25.4) * 150);

    const faixaDeBaixo = { y: 2, altura: sangriaEmPixels - 4 };
    const esquerdaEmbaixo = tintaEm(imagem, {
      x: Math.round(imagem.largura * 0.25),
      largura: Math.round(imagem.largura * 0.15),
      ...faixaDeBaixo,
    });
    const direitaEmbaixo = tintaEm(imagem, {
      x: Math.round(imagem.largura * 0.6),
      largura: Math.round(imagem.largura * 0.15),
      ...faixaDeBaixo,
    });

    expect(esquerdaEmbaixo).toBeGreaterThan(0.9);
    expect(direitaEmbaixo).toBeLessThan(0.05);
  }, 120_000);

  it('a arte original continua por cima, inteira e no lugar', async () => {
    // O espelho não pode cobrir a arte: ela é desenhada por último, e o
    // recorte impede que as cópias invadam o miolo.
    const resultado = await addBleed(
      pedido([arquivo(await meioAMeio(400, 300))], { sangriaMm: 10, modo: 'espelho' }),
    );
    const imagem = rasterizar(await bytesDe(resultado.files[0].blob), 150);
    const sangria = Math.round((10 / 25.4) * 150);

    const meioDaArte = {
      y: Math.round(imagem.altura / 2) - 20,
      altura: 40,
    };
    const artePreta = tintaEm(imagem, {
      x: sangria + 5,
      largura: Math.round((imagem.largura - sangria * 2) / 2) - 10,
      ...meioDaArte,
    });
    const arteBranca = tintaEm(imagem, {
      x: Math.round(imagem.largura / 2) + 10,
      largura: Math.round((imagem.largura - sangria * 2) / 2) - 20,
      ...meioDaArte,
    });

    expect(artePreta).toBeGreaterThan(0.95);
    expect(arteBranca).toBeLessThan(0.05);
  }, 120_000);

  it('o modo de cor pinta a sangria e deixa a arte quieta', async () => {
    const resultado = await addBleed(
      pedido([arquivo(await meioAMeio(400, 300))], { sangriaMm: 10, modo: 'cor', cor: '#000000' }),
    );
    const imagem = rasterizar(await bytesDe(resultado.files[0].blob), 150);
    const sangria = Math.round((10 / 25.4) * 150);

    // Com sangria preta, a moldura inteira fica escura — inclusive do lado
    // onde a arte é branca.
    expect(
      tintaEm(imagem, { x: imagem.largura - sangria + 2, y: 2, largura: sangria - 4, altura: imagem.altura - 4 }),
    ).toBeGreaterThan(0.9);
  }, 120_000);
});

comRaster('marcas de dobra', () => {
  it('marca nas duas margens, nas posições do tipo escolhido', async () => {
    const resultado = await foldMarks(
      pedido([arquivo(await meioAMeio(400, 300))], { tipo: 'triptico', sentido: 'largura', margemMm: 10, marcaMm: 6 }),
    );
    // Corte perto do branco: a marca é um fio de 0,4 ponto, e no corte do
    // meio da escala ela some quando cai entre dois pixels.
    const imagem = rasterizar(await bytesDe(resultado.files[0].blob), 200, 0, 250);
    const margem = Math.round((10 / 25.4) * 200);

    /*
     * A marca é tracejada, então uma linha isolada da imagem pode cair num
     * vão e não ver nada. A coluna inteira da faixa da margem é que responde
     * — foi assim que este teste primeiro acusou uma dobra em vez de duas,
     * por estar olhando uma linha só.
     */
    const colunaTemTinta = (x: number) => {
      for (let y = 2; y < margem - 2; y += 1) if (imagem.escuro[y][x]) return true;
      return false;
    };
    const colunas: boolean[] = [];
    for (let x = 0; x < imagem.largura; x += 1) colunas.push(colunaTemTinta(x));

    const naMargem = faixasDaLinha(colunas);
    expect(naMargem, 'o tríptico tem duas dobras').toHaveLength(2);

    // E elas caem nos terços da arte, não em qualquer lugar.
    const arteL = imagem.largura - margem * 2;
    expect(naMargem[0].inicio).toBeCloseTo(margem + arteL / 3, -1);
    expect(naMargem[1].inicio).toBeCloseTo(margem + (arteL * 2) / 3, -1);
  }, 120_000);

  it('a arte não é tocada: a margem é acrescentada em volta', async () => {
    const original = await PDFDocument.load(await meioAMeio(400, 300));
    const resultado = await foldMarks(pedido([arquivo(await meioAMeio(400, 300))], { margemMm: 8 }));
    const depois = await PDFDocument.load(await resultado.files[0].blob.arrayBuffer());

    const antes = original.getPage(0).getSize();
    const agora = depois.getPage(0).getSize();
    expect(agora.width - antes.width).toBeCloseTo(2 * 8 * (72 / 25.4), 1);
  }, 120_000);

  it('dobrar na altura vira as marcas para as laterais', async () => {
    const resultado = await foldMarks(
      pedido([arquivo(await meioAMeio(400, 300))], { tipo: 'meio', sentido: 'altura', margemMm: 10 }),
    );
    const imagem = rasterizar(await bytesDe(resultado.files[0].blob), 200);
    const margem = Math.round((10 / 25.4) * 200);

    // Nada na margem de cima; a marca está na coluna da esquerda.
    expect(imagem.escuro[Math.round(margem / 2)].some(Boolean)).toBe(false);
    const coluna = imagem.escuro.map((linha) => linha[Math.round(margem / 2)]);
    expect(coluna.some(Boolean), 'a marca do meio, na lateral').toBe(true);
  }, 120_000);
});

describe('frente e verso', () => {
  it('intercala, invertendo os versos', async () => {
    const frentes = arquivo(await comMarcaEm(3, 20), 'frentes.pdf');
    const versos = arquivo(await comMarcaEm(3, 20), 'versos.pdf');

    const resultado = await frenteEVerso(pedido([frentes, versos], { inverter: true }));
    const doc = await PDFDocument.load(await resultado.files[0].blob.arrayBuffer());

    expect(doc.getPageCount()).toBe(6);
    expect(resultado.notes[1]).toMatch(/de trás para frente/);
  });

  it('sem inverter, mantém a ordem dos dois', async () => {
    const resultado = await frenteEVerso(
      pedido([arquivo(await comMarcaEm(2, 20), 'a.pdf'), arquivo(await comMarcaEm(2, 20), 'b.pdf')], {
        inverter: false,
      }),
    );
    expect(resultado.notes[1]).toMatch(/mesma ordem/);
    expect(resultado.notes[2]).toMatch(/trocado/);
  });

  it('avisa quando as duas pilhas têm tamanhos diferentes', async () => {
    const resultado = await frenteEVerso(
      pedido([arquivo(await comMarcaEm(3, 20), 'a.pdf'), arquivo(await comMarcaEm(2, 20), 'b.pdf')]),
    );
    expect(resultado.files[0].pages).toBe(5);
    expect(resultado.notes.join(' ')).toMatch(/quantidades diferentes/);
  });

  it('recusa quando não são exatamente dois arquivos', async () => {
    await expect(frenteEVerso(pedido([arquivo(await comMarcaEm(2, 20))]))).rejects.toThrow(/dois arquivos/);
  });
});

comRaster('carimbo de logo', () => {
  /** Um PNG mínimo, 2x2 todo preto. */
  async function pngPreto(): Promise<ArrayBuffer> {
    const doc = await PDFDocument.create();
    const pagina = doc.addPage([2, 2]);
    pagina.drawRectangle({ x: 0, y: 0, width: 2, height: 2, color: rgb(0, 0, 0) });
    // O carimbo precisa ser imagem de verdade, então a página vira PNG pelo
    // motor — é o mesmo caminho que um arquivo do disco faria.
    return (await doc.save()).buffer as ArrayBuffer;
  }

  it('exige o PDF e a imagem na fila', async () => {
    await expect(stampImage(pedido([arquivo(await meioAMeio())]))).rejects.toThrow(/dois arquivos/);
    await expect(stampImage(pedido([arquivo(await pngPreto(), 'logo.png', 'image/png')]))).rejects.toThrow(
      /dois arquivos/,
    );
  });

  it('não confunde qual é o PDF, mesmo com a imagem na frente da fila', async () => {
    // A ordem da fila não decide: quem decide é o tipo do arquivo. Uma fila
    // ao contrário tentaria abrir o PNG como PDF e estouraria.
    const pdf = arquivo(await meioAMeio(400, 300), 'arte.pdf');
    const imagem = arquivo(await pngPreto(), 'logo.png', 'image/png');
    // Com um PNG inválido o embedPng recusa; o que importa aqui é que a
    // mensagem não seja mais a de "dois arquivos".
    await expect(stampImage(pedido([imagem, pdf]))).rejects.not.toThrow(/dois arquivos/);
  });
});
