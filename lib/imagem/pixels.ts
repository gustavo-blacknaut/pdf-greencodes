/**
 * Tratamento de pixel: ajuste, cor, giro, fundo e digitalização.
 *
 * Tudo aqui é função pura sobre `Bitmap` — entra um mapa de pixels, sai
 * outro. Nada toca em canvas, em `document` ou em arquivo. É o que permite
 * testar em Node, e é o que separa "a conta está certa" de "o navegador
 * desenhou certo": as duas coisas quebram por motivos diferentes, e depurar
 * junto é o que faz uma tarde virar um dia.
 *
 * O vizinho `lanczos.ts` cuida de tamanho; este cuida de cor.
 */

import type { Bitmap } from './lanczos';

/** Uma cópia do mapa, para não estragar a entrada de quem chamou. */
function copiar(imagem: Bitmap): Bitmap {
  return {
    dados: new Uint8ClampedArray(imagem.dados),
    largura: imagem.largura,
    altura: imagem.altura,
  };
}

/**
 * O brilho percebido de um pixel.
 *
 * Os pesos não são um terço para cada canal: o olho enxerga muito mais o
 * verde que o azul. Dividir igual é o erro que transforma um céu azul em
 * cinza-claro e um gramado em cinza-escuro, quando deveria ser o contrário.
 * Estes são os pesos do sRGB, que é o espaço em que a imagem chega.
 */
export function luminancia(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ------------------------------------------------------------- ajustes ---

export type Ajustes = {
  /** -100 a 100. */
  brilho: number;
  /** -100 a 100. */
  contraste: number;
  /** -100 (cinza) a 100 (berrante). */
  saturacao: number;
  /**
   * 0.2 a 3. Acima de 1 clareia o meio-tom, abaixo escurece.
   *
   * É a convenção do ImageMagick e do `gamma` do PostScript, onde a conta é
   * `saída = entrada ^ (1/gama)`. Existe programa que usa o sentido
   * contrário, então a tela chama isso de "meio-tom" e diz para que lado vai.
   */
  gama: number;
};

export const SEM_AJUSTE: Ajustes = { brilho: 0, contraste: 0, saturacao: 0, gama: 1 };

/**
 * Brilho, contraste, saturação e gama, numa passada só.
 *
 * Fazer os quatro numa varredura não é só velocidade: cada passagem separada
 * arredondaria para inteiro no fim, e quatro arredondamentos em sequência
 * abrem faixas visíveis no céu de uma foto — o que o pessoal chama de
 * "banding". Aqui a conta corre inteira em número quebrado e só arredonda no
 * último passo.
 *
 * A ordem também importa e é a mesma da bancada de laboratório: primeiro o
 * gama, que é a resposta do papel; depois brilho e contraste, que são
 * exposição; e a saturação por último, sobre o resultado.
 */
export function ajustar(imagem: Bitmap, ajustes: Partial<Ajustes> = {}): Bitmap {
  const { brilho, contraste, saturacao, gama } = { ...SEM_AJUSTE, ...ajustes };
  const saida = copiar(imagem);
  const dados = saida.dados;

  // A fórmula clássica do contraste, a mesma que o GIMP usa. Ela satura em
  // -255, não em -100: no mínimo daqui a imagem fica bem lavada, mas ainda
  // com tom. Quem quer chapar tudo num cinza só está querendo outra coisa.
  const forca = Math.max(-100, Math.min(100, contraste));
  const fator = (259 * (forca + 255)) / (255 * (259 - forca));
  const expoente = 1 / Math.max(0.2, Math.min(3, gama));
  const desvio = Math.max(-100, Math.min(100, brilho)) * 2.55;
  const cor = 1 + Math.max(-100, Math.min(100, saturacao)) / 100;

  // Tabela de gama pronta: são 256 valores possíveis, e calcular potência
  // para cada pixel de uma foto de 12 megapixels é trinta e seis milhões de
  // chamadas para achar os mesmos 256 resultados.
  const tabela = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i += 1) {
    tabela[i] = Math.round(255 * (i / 255) ** expoente);
  }

  for (let i = 0; i < dados.length; i += 4) {
    let r = tabela[dados[i]];
    let g = tabela[dados[i + 1]];
    let b = tabela[dados[i + 2]];

    r = fator * (r - 128) + 128 + desvio;
    g = fator * (g - 128) + 128 + desvio;
    b = fator * (b - 128) + 128 + desvio;

    if (cor !== 1) {
      const cinza = luminancia(r, g, b);
      r = cinza + (r - cinza) * cor;
      g = cinza + (g - cinza) * cor;
      b = cinza + (b - cinza) * cor;
    }

    dados[i] = r;
    dados[i + 1] = g;
    dados[i + 2] = b;
  }

  return saida;
}

// ----------------------------------------------------------------- cor ---

export type ModoDeCor = 'cinza' | 'sepia' | 'pb';

/**
 * O limiar que separa preto de branco, escolhido pela própria imagem.
 *
 * É o método do Otsu: ele testa os 256 cortes possíveis e fica com o que
 * deixa os dois grupos — o que vira preto e o que vira branco — mais
 * separados entre si. Um limiar fixo em 128 funciona no papel branco e
 * fracassa em qualquer digitalização puxada para o cinza, que é a maioria.
 *
 * O valor devolvido é o **último** tom do grupo escuro: quem compara usa
 * `brilho > limiar` para decidir branco. Trocar isso por `>=` joga o tom mais
 * escuro da imagem para o branco, que é exatamente o contrário do esperado.
 */
export function limiarDeOtsu(histograma: number[] | Uint32Array): number {
  let total = 0;
  let somaTotal = 0;
  for (let i = 0; i < 256; i += 1) {
    total += histograma[i];
    somaTotal += i * histograma[i];
  }
  if (!total) return 128;

  let somaAbaixo = 0;
  let pesoAbaixo = 0;
  let melhorVariancia = -1;
  let melhorLimiar = 128;

  for (let t = 0; t < 256; t += 1) {
    pesoAbaixo += histograma[t];
    if (!pesoAbaixo) continue;
    const pesoAcima = total - pesoAbaixo;
    if (!pesoAcima) break;

    somaAbaixo += t * histograma[t];
    const mediaAbaixo = somaAbaixo / pesoAbaixo;
    const mediaAcima = (somaTotal - somaAbaixo) / pesoAcima;
    const variancia = pesoAbaixo * pesoAcima * (mediaAbaixo - mediaAcima) ** 2;

    if (variancia > melhorVariancia) {
      melhorVariancia = variancia;
      melhorLimiar = t;
    }
  }

  return melhorLimiar;
}

export function histogramaDeBrilho(imagem: Bitmap): Uint32Array {
  const histograma = new Uint32Array(256);
  for (let i = 0; i < imagem.dados.length; i += 4) {
    histograma[Math.round(luminancia(imagem.dados[i], imagem.dados[i + 1], imagem.dados[i + 2]))] += 1;
  }
  return histograma;
}

/** Cinza, sépia ou preto e branco puro. */
export function trocarCor(imagem: Bitmap, modo: ModoDeCor): Bitmap {
  const saida = copiar(imagem);
  const dados = saida.dados;
  const limiar = modo === 'pb' ? limiarDeOtsu(histogramaDeBrilho(imagem)) : 0;

  for (let i = 0; i < dados.length; i += 4) {
    const cinza = luminancia(dados[i], dados[i + 1], dados[i + 2]);

    if (modo === 'cinza') {
      dados[i] = cinza;
      dados[i + 1] = cinza;
      dados[i + 2] = cinza;
    } else if (modo === 'pb') {
      const valor = cinza > limiar ? 255 : 0;
      dados[i] = valor;
      dados[i + 1] = valor;
      dados[i + 2] = valor;
    } else {
      // Os coeficientes do sépia são os da fórmula que virou padrão de fato
      // desde o Photoshop 5, e reproduzem o virado de tom da foto antiga.
      dados[i] = cinza * 1.07 + 22;
      dados[i + 1] = cinza * 0.96 + 8;
      dados[i + 2] = cinza * 0.76;
    }
  }

  return saida;
}

// ---------------------------------------------------------------- giro ---

export type Giro = 0 | 90 | 180 | 270;

/**
 * Gira em quarto de volta e espelha.
 *
 * Só múltiplo de 90 graus, e de propósito: nesses ângulos cada pixel vai
 * parar exatamente em cima de outro, sem interpolar nada. O resultado é
 * idêntico ao original, pixel por pixel. Girar 3 graus para endireitar uma
 * digitalização torta é outra conta — essa reamostra a imagem inteira e
 * custa nitidez, e não é o que a ferramenta promete.
 */
export function girar(imagem: Bitmap, graus: Giro, espelhar: 'nao' | 'horizontal' | 'vertical' = 'nao'): Bitmap {
  const { largura, altura, dados } = imagem;
  const deitou = graus === 90 || graus === 270;
  const novaLargura = deitou ? altura : largura;
  const novaAltura = deitou ? largura : altura;
  const saida = new Uint8ClampedArray(novaLargura * novaAltura * 4);

  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      let destinoX: number;
      let destinoY: number;

      if (graus === 90) {
        destinoX = altura - 1 - y;
        destinoY = x;
      } else if (graus === 180) {
        destinoX = largura - 1 - x;
        destinoY = altura - 1 - y;
      } else if (graus === 270) {
        destinoX = y;
        destinoY = largura - 1 - x;
      } else {
        destinoX = x;
        destinoY = y;
      }

      if (espelhar === 'horizontal') destinoX = novaLargura - 1 - destinoX;
      if (espelhar === 'vertical') destinoY = novaAltura - 1 - destinoY;

      const origem = (y * largura + x) * 4;
      const destino = (destinoY * novaLargura + destinoX) * 4;
      saida[destino] = dados[origem];
      saida[destino + 1] = dados[origem + 1];
      saida[destino + 2] = dados[origem + 2];
      saida[destino + 3] = dados[origem + 3];
    }
  }

  return { dados: saida, largura: novaLargura, altura: novaAltura };
}

// --------------------------------------------------------------- fundo ---

/**
 * A cor do fundo, tirada da moldura da imagem.
 *
 * Usa a mediana e não a média: um carimbo escuro encostando na borda puxa a
 * média para o cinza e faz a ferramenta apagar de menos. A mediana ignora o
 * intruso enquanto ele for minoria, que é o caso normal.
 */
export function corDaBorda(imagem: Bitmap): [number, number, number] {
  const { largura, altura, dados } = imagem;
  const canais: number[][] = [[], [], []];

  const anotar = (x: number, y: number) => {
    const i = (y * largura + x) * 4;
    canais[0].push(dados[i]);
    canais[1].push(dados[i + 1]);
    canais[2].push(dados[i + 2]);
  };

  for (let x = 0; x < largura; x += 1) {
    anotar(x, 0);
    anotar(x, altura - 1);
  }
  for (let y = 1; y < altura - 1; y += 1) {
    anotar(0, y);
    anotar(largura - 1, y);
  }

  return canais.map((valores) => {
    valores.sort((a, b) => a - b);
    return valores[Math.floor(valores.length / 2)] ?? 255;
  }) as [number, number, number];
}

/**
 * Apaga o fundo que encosta na borda.
 *
 * Não é a mesma coisa que "apagar tudo que for branco": o branco de dentro de
 * uma letra "O", ou o miolo claro de uma logo, tem que ficar. Por isso a
 * varredura começa pelas bordas e só caminha por vizinhos parecidos — o que
 * estiver cercado por desenho nunca é alcançado.
 *
 * A distância é a maior diferença entre canais, e não a soma: com a soma, uma
 * tolerância que cobre um cinza levemente diferente também cobre um azul
 * bem diferente, e a ferramenta come pedaço da logo.
 *
 * O que ela **não** resolve é cabelo, fumaça e vidro, onde o fundo e o
 * assunto ocupam o mesmo pixel. Isso é recorte por modelo de IA, que são
 * dezenas de megabytes a mais no instalador.
 */
export function removerFundo(
  imagem: Bitmap,
  opcoes: { tolerancia?: number; suavizar?: boolean } = {},
): { imagem: Bitmap; apagados: number } {
  const tolerancia = Math.max(0, Math.min(255, opcoes.tolerancia ?? 32));
  const saida = copiar(imagem);
  const { largura, altura, dados } = saida;
  const [fr, fg, fb] = corDaBorda(imagem);

  const parecido = (i: number) =>
    Math.max(Math.abs(dados[i] - fr), Math.abs(dados[i + 1] - fg), Math.abs(dados[i + 2] - fb)) <= tolerancia;

  const visitado = new Uint8Array(largura * altura);
  // Uma fila em array plano: um array de pares alocaria um objeto por pixel,
  // e numa foto de celular isso é milhões de objetos para o coletor de lixo.
  const fila = new Int32Array(largura * altura);
  let inicio = 0;
  let fim = 0;

  const enfileirar = (posicao: number) => {
    if (visitado[posicao]) return;
    if (!parecido(posicao * 4)) return;
    visitado[posicao] = 1;
    fila[fim] = posicao;
    fim += 1;
  };

  for (let x = 0; x < largura; x += 1) {
    enfileirar(x);
    enfileirar((altura - 1) * largura + x);
  }
  for (let y = 0; y < altura; y += 1) {
    enfileirar(y * largura);
    enfileirar(y * largura + largura - 1);
  }

  let apagados = 0;
  while (inicio < fim) {
    const posicao = fila[inicio];
    inicio += 1;
    apagados += 1;

    const x = posicao % largura;
    const y = (posicao - x) / largura;
    if (x > 0) enfileirar(posicao - 1);
    if (x < largura - 1) enfileirar(posicao + 1);
    if (y > 0) enfileirar(posicao - largura);
    if (y < altura - 1) enfileirar(posicao + largura);
  }

  for (let posicao = 0; posicao < visitado.length; posicao += 1) {
    if (visitado[posicao]) dados[posicao * 4 + 3] = 0;
  }

  if (opcoes.suavizar !== false) suavizarBorda(saida);

  return { imagem: saida, apagados };
}

/**
 * Tira a escadinha da borda recortada.
 *
 * Sem isto o contorno fica com o serrilhado de um recorte de tesoura, que
 * salta aos olhos assim que a imagem é colocada sobre um fundo colorido. A
 * média 3x3 só do canal alfa transforma o degrau em meio tom, sem tocar na
 * cor de nenhum pixel.
 */
function suavizarBorda(imagem: Bitmap): void {
  const { largura, altura, dados } = imagem;
  const original = new Uint8ClampedArray(largura * altura);
  for (let posicao = 0; posicao < original.length; posicao += 1) original[posicao] = dados[posicao * 4 + 3];

  for (let y = 1; y < altura - 1; y += 1) {
    for (let x = 1; x < largura - 1; x += 1) {
      const posicao = y * largura + x;
      // Pixel cercado por iguais não é borda, e mexer nele só borraria o
      // interior sólido do desenho.
      const centro = original[posicao];
      let soma = 0;
      let mistura = false;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const vizinho = original[posicao + dy * largura + dx];
          soma += vizinho;
          if (vizinho !== centro) mistura = true;
        }
      }
      if (mistura) dados[posicao * 4 + 3] = soma / 9;
    }
  }
}

// -------------------------------------------------------- digitalizar ---

/**
 * Endireita o tom de uma digitalização.
 *
 * O que sai do scanner quase nunca tem papel branco: tem papel cinza-claro,
 * puxado para o amarelo se a folha for velha, com sombra na dobra. Imprimir
 * isso gasta toner no fundo inteiro e sai sujo.
 *
 * A conta é a mesma de esticar os níveis, com dois cuidados que fazem a
 * diferença. Primeiro, o ponto de branco sai do percentil e não do máximo:
 * um único pixel estourado — o reflexo do plástico do scanner — colocaria o
 * branco lá no alto e não corrigiria nada. Segundo, cada canal recebe o seu
 * próprio ponto de branco, e é isso que tira o amarelado do papel velho: sem
 * isso o fundo só ficaria amarelo mais claro.
 */
export function limparDigitalizacao(imagem: Bitmap, forca = 1): Bitmap {
  const saida = copiar(imagem);
  const dados = saida.dados;
  const peso = Math.max(0, Math.min(1, forca));

  const pontos: { branco: number; preto: number }[] = [];
  for (let canal = 0; canal < 3; canal += 1) {
    const histograma = new Uint32Array(256);
    for (let i = canal; i < dados.length; i += 4) histograma[dados[i]] += 1;
    pontos.push({
      branco: percentil(histograma, 0.97),
      preto: percentil(histograma, 0.02),
    });
  }

  for (let canal = 0; canal < 3; canal += 1) {
    const { branco, preto } = pontos[canal];
    const faixa = branco - preto;
    const tabela = new Uint8ClampedArray(256);

    for (let i = 0; i < 256; i += 1) {
      /*
       * Faixa curta é folha sem nada escrito — ou quase. Esticar dali levaria
       * o próprio tom do papel para o preto: com branco e preto no mesmo
       * valor, a conta manda o pixel do papel para zero e devolve uma página
       * toda preta. Nesse caso o certo é só empurrar o papel para o branco,
       * sem esticar o que não tem o que esticar.
       */
      const corrigido = faixa >= FAIXA_MINIMA ? ((i - preto) / faixa) * 255 : i + (255 - branco);
      tabela[i] = i + (corrigido - i) * peso;
    }

    for (let i = canal; i < dados.length; i += 4) dados[i] = tabela[dados[i]];
  }

  return saida;
}

/**
 * Abaixo desta diferença entre o claro e o escuro não há tom para esticar.
 *
 * Vinte e quatro de 255 é menos de dez por cento da escala: uma página em
 * branco digitalizada, o verso de uma folha, ou a parte de fora de um
 * documento pequeno em cima do vidro.
 */
const FAIXA_MINIMA = 24;

/** O valor em que a contagem acumulada do histograma passa da fração pedida. */
export function percentil(histograma: Uint32Array | number[], fracao: number): number {
  let total = 0;
  for (let i = 0; i < 256; i += 1) total += histograma[i];
  if (!total) return fracao > 0.5 ? 255 : 0;

  const alvo = total * fracao;
  let acumulado = 0;
  for (let i = 0; i < 256; i += 1) {
    acumulado += histograma[i];
    if (acumulado >= alvo) return i;
  }
  return 255;
}

// ------------------------------------------------------------- moldura ---

/** Põe uma borda de cor em volta, sem redimensionar o que estava lá. */
export function emoldurar(imagem: Bitmap, espessura: number, cor: [number, number, number, number]): Bitmap {
  const margem = Math.max(0, Math.round(espessura));
  if (!margem) return copiar(imagem);

  const largura = imagem.largura + margem * 2;
  const altura = imagem.altura + margem * 2;
  const dados = new Uint8ClampedArray(largura * altura * 4);

  for (let i = 0; i < dados.length; i += 4) {
    dados[i] = cor[0];
    dados[i + 1] = cor[1];
    dados[i + 2] = cor[2];
    dados[i + 3] = cor[3];
  }

  for (let y = 0; y < imagem.altura; y += 1) {
    const origem = y * imagem.largura * 4;
    const destino = ((y + margem) * largura + margem) * 4;
    dados.set(imagem.dados.subarray(origem, origem + imagem.largura * 4), destino);
  }

  return { dados, largura, altura };
}

/** Converte "#rrggbb" para os quatro canais. Aceita a cerquilha ou não. */
export function corDoTexto(texto: unknown, padrao: [number, number, number, number] = [255, 255, 255, 255]) {
  const limpo = String(texto ?? '').trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(limpo)) return padrao;
  return [
    parseInt(limpo.slice(0, 2), 16),
    parseInt(limpo.slice(2, 4), 16),
    parseInt(limpo.slice(4, 6), 16),
    255,
  ] as [number, number, number, number];
}
