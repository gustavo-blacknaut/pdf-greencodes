/**
 * Reamostragem Lanczos e máscara de nitidez.
 *
 * O `drawImage` do canvas usa interpolação bilinear: rápida, e visivelmente
 * mole quando se amplia. O Lanczos pesa uma janela maior de pixels com uma
 * função que tem lóbulos negativos, e é isso que devolve borda definida em
 * vez de borrão. É o mesmo algoritmo que o Photoshop chama de "bicúbica mais
 * nítida" e que o ImageMagick usa por padrão.
 *
 * Nada aqui toca em canvas nem em DOM: entra e sai `{ dados, largura,
 * altura }`, com os pixels em RGBA. Assim a conta pode ser provada em teste,
 * que é o que importa — reamostragem errada não quebra, entrega uma imagem
 * suave demais ou com serrilha, e ninguém percebe até imprimir.
 */

export type Bitmap = {
  /** RGBA, quatro bytes por pixel. */
  dados: Uint8ClampedArray;
  largura: number;
  altura: number;
};

/**
 * O núcleo de Lanczos.
 *
 * `sinc(x) * sinc(x/a)` dentro da janela, zero fora dela. Os lóbulos
 * negativos são o que dá o realce de borda; é também por isso que a saída
 * precisa ser limitada a 0-255 depois, e o `Uint8ClampedArray` faz isso
 * sozinho.
 */
export function lanczos(x: number, a: number): number {
  if (x === 0) return 1;
  const absoluto = Math.abs(x);
  if (absoluto >= a) return 0;

  const pi = Math.PI * absoluto;
  return (a * Math.sin(pi) * Math.sin(pi / a)) / (pi * pi);
}

/**
 * Os pesos de cada pixel de saída, numa direção só.
 *
 * Calculados uma vez e reaproveitados em todas as linhas: a janela depende da
 * posição na linha, não de qual linha é. Numa foto de 4000x3000 isso é a
 * diferença entre calcular 4000 janelas e calcular 12 milhões.
 */
export function pesosDaLinha(origem: number, destino: number, a = 3) {
  const escala = destino / origem;
  // Ao reduzir, a janela cresce na mesma proporção: pegar só três pixels de
  // uma imagem que vai encolher dez vezes joga fora nove em cada dez.
  const alcance = escala < 1 ? a / escala : a;
  const janelas: { inicio: number; pesos: Float32Array }[] = [];

  for (let i = 0; i < destino; i += 1) {
    // O centro do pixel de saída, projetado na imagem de origem.
    const centro = (i + 0.5) / escala - 0.5;
    const inicio = Math.max(0, Math.ceil(centro - alcance));
    const fim = Math.min(origem - 1, Math.floor(centro + alcance));

    const pesos = new Float32Array(fim - inicio + 1);
    let soma = 0;
    for (let j = inicio; j <= fim; j += 1) {
      const distancia = escala < 1 ? (j - centro) * escala : j - centro;
      const peso = lanczos(distancia, a);
      pesos[j - inicio] = peso;
      soma += peso;
    }

    // Normalizar mantém o brilho: sem isto, a soma dos pesos varia de pixel
    // para pixel e a imagem sai com faixas mais claras e mais escuras.
    if (soma !== 0) for (let k = 0; k < pesos.length; k += 1) pesos[k] /= soma;

    janelas.push({ inicio, pesos });
  }

  return janelas;
}

/**
 * Redimensiona em duas passadas, horizontal e depois vertical.
 *
 * Separar as direções troca um custo de janela ao quadrado por duas vezes o
 * custo linear. Numa ampliação de 2x com janela 3, é a diferença entre 36
 * multiplicações por pixel e 12.
 */
export function redimensionar(origem: Bitmap, largura: number, altura: number, a = 3): Bitmap {
  const alvoL = Math.max(1, Math.round(largura));
  const alvoA = Math.max(1, Math.round(altura));
  if (alvoL === origem.largura && alvoA === origem.altura) return origem;

  const horizontal = pesosDaLinha(origem.largura, alvoL, a);
  const meio = new Float32Array(alvoL * origem.altura * 4);

  for (let y = 0; y < origem.altura; y += 1) {
    const linhaOrigem = y * origem.largura * 4;
    const linhaMeio = y * alvoL * 4;

    for (let x = 0; x < alvoL; x += 1) {
      const { inicio, pesos } = horizontal[x];
      let r = 0;
      let g = 0;
      let b = 0;
      let alfa = 0;

      for (let k = 0; k < pesos.length; k += 1) {
        const peso = pesos[k];
        const p = linhaOrigem + (inicio + k) * 4;
        r += origem.dados[p] * peso;
        g += origem.dados[p + 1] * peso;
        b += origem.dados[p + 2] * peso;
        alfa += origem.dados[p + 3] * peso;
      }

      const d = linhaMeio + x * 4;
      meio[d] = r;
      meio[d + 1] = g;
      meio[d + 2] = b;
      meio[d + 3] = alfa;
    }
  }

  const vertical = pesosDaLinha(origem.altura, alvoA, a);
  const saida = new Uint8ClampedArray(alvoL * alvoA * 4);

  for (let y = 0; y < alvoA; y += 1) {
    const { inicio, pesos } = vertical[y];
    const linhaSaida = y * alvoL * 4;

    for (let x = 0; x < alvoL; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let alfa = 0;

      for (let k = 0; k < pesos.length; k += 1) {
        const peso = pesos[k];
        const p = ((inicio + k) * alvoL + x) * 4;
        r += meio[p] * peso;
        g += meio[p + 1] * peso;
        b += meio[p + 2] * peso;
        alfa += meio[p + 3] * peso;
      }

      const d = linhaSaida + x * 4;
      saida[d] = r;
      saida[d + 1] = g;
      saida[d + 2] = b;
      saida[d + 3] = alfa;
    }
  }

  return { dados: saida, largura: alvoL, altura: alvoA };
}

/**
 * Máscara de nitidez.
 *
 * Ampliar nunca cria detalhe — o detalhe não está no arquivo. O que dá para
 * fazer é realçar o contraste na borda, que é o que o olho lê como "mais
 * nítido". Funciona subtraindo uma cópia borrada da original: o que sobra é
 * exatamente a borda, e ela é somada de volta.
 *
 * `limiar` protege a área lisa: sem ele, o ruído do céu e da pele é realçado
 * junto e a foto fica granulada.
 */
export function realcar(imagem: Bitmap, forca: number, limiar = 3): Bitmap {
  if (forca <= 0) return imagem;

  const { largura, altura, dados } = imagem;
  const saida = new Uint8ClampedArray(dados);
  // Núcleo 3x3 de média: borrão barato, que é tudo o que a máscara precisa.
  const peso = 1 / 9;

  for (let y = 1; y < altura - 1; y += 1) {
    for (let x = 1; x < largura - 1; x += 1) {
      const centro = (y * largura + x) * 4;

      for (let canal = 0; canal < 3; canal += 1) {
        let borrado = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            borrado += dados[((y + dy) * largura + (x + dx)) * 4 + canal] * peso;
          }
        }

        const original = dados[centro + canal];
        const diferenca = original - borrado;
        if (Math.abs(diferenca) < limiar) continue;
        saida[centro + canal] = original + diferenca * forca;
      }
    }
  }

  return { dados: saida, largura, altura };
}

/**
 * Recorta sem tocar em nenhum pixel.
 *
 * Copiar um pedaço é exato: nenhum valor é interpolado, somado ou arredondado.
 * A perda que as pessoas veem ao recortar não vem daqui — vem de gravar de
 * novo em JPEG depois, que recomprime a imagem inteira.
 */
export function recortar(origem: Bitmap, x: number, y: number, largura: number, altura: number): Bitmap {
  const x0 = Math.max(0, Math.min(origem.largura - 1, Math.round(x)));
  const y0 = Math.max(0, Math.min(origem.altura - 1, Math.round(y)));
  const l = Math.max(1, Math.min(origem.largura - x0, Math.round(largura)));
  const a = Math.max(1, Math.min(origem.altura - y0, Math.round(altura)));

  const saida = new Uint8ClampedArray(l * a * 4);
  for (let linha = 0; linha < a; linha += 1) {
    const de = ((y0 + linha) * origem.largura + x0) * 4;
    saida.set(origem.dados.subarray(de, de + l * 4), linha * l * 4);
  }

  return { dados: saida, largura: l, altura: a };
}
