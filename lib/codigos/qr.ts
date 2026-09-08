/**
 * QR Code: do texto para a matriz de módulos.
 *
 * A geração em si vem do `qrcode-generator`, a implementação do Kazuhiko
 * Arase — Reed-Solomon, escolha de máscara e tabela de versões, no ar desde
 * 2009 e sem uma única dependência. Reescrever isso à mão seria trocar código
 * testado por vinte anos de uso por código testado por mim numa tarde.
 *
 * O que este arquivo acrescenta é o que falta para uso de gráfica:
 *
 *  - texto em UTF-8, senão "Ação" vira caractere trocado;
 *  - a matriz crua, para desenhar em vetor no PDF em vez de esticar um PNG.
 *
 * Essa segunda parte é a que importa na impressão: QR desenhado como quadrado
 * vetorial fica com a borda exata em qualquer tamanho, e o mesmo QR como
 * imagem de 200 px, ampliado para 5 cm, sai com a borda escadinha — que é
 * justamente onde o leitor começa a falhar.
 */

import qrcode from 'qrcode-generator';

/**
 * O pacote converte texto para bytes em Latin-1, e só.
 *
 * Sem trocar isto, "Promoção" sai com o "ç" errado para qualquer leitor que
 * espere UTF-8 — que é o que todo celular espera. A troca é a mesma que o
 * próprio pacote faz no arquivo `qrcode_UTF8`, escrita aqui para não carregar
 * um segundo arquivo só por causa de uma função.
 */
qrcode.stringToBytes = (texto: string) => Array.from(new TextEncoder().encode(texto));

/**
 * Quanto do código pode ser perdido e ainda assim ler.
 *
 * Não é enfeite: cartaz de rua leva chuva, adesivo de vitrine leva sol, e
 * etiqueta de caixa leva fita por cima. Mais correção significa mais módulos
 * no mesmo espaço — ou seja, módulo menor — então subir de M para H sem
 * aumentar o quadrado pode piorar em vez de melhorar.
 */
export const CORRECOES = {
  L: { rotulo: 'Baixa', perda: '7%' },
  M: { rotulo: 'Média', perda: '15%' },
  Q: { rotulo: 'Alta', perda: '25%' },
  H: { rotulo: 'Máxima', perda: '30%' },
} as const;

export type Correcao = keyof typeof CORRECOES;

export type MatrizQr = {
  /** Quantos módulos de lado. Sempre ímpar, de 21 (versão 1) a 177 (versão 40). */
  tamanho: number;
  /** `escuro[linha][coluna]`. */
  escuro: boolean[][];
  /** A versão que o conteúdo exigiu — útil para avisar quando o texto é longo demais. */
  versao: number;
};

export function correcaoValida(valor: unknown): Correcao {
  const texto = String(valor ?? 'M').toUpperCase();
  return texto in CORRECOES ? (texto as Correcao) : 'M';
}

/**
 * Monta a matriz.
 *
 * A versão vai em 0 (automática): o pacote escolhe a menor que couber. Texto
 * grande demais estoura lá dentro, e a mensagem original não ajuda ninguém no
 * balcão — por isso é traduzida.
 */
export function matrizQr(texto: string, correcao: Correcao = 'M'): MatrizQr {
  if (!texto.trim()) throw new Error('Escreva o que vai dentro do QR Code.');

  let codigo;
  try {
    codigo = qrcode(0, correcao);
    codigo.addData(texto);
    codigo.make();
  } catch {
    throw new Error(
      'O texto é longo demais para caber num QR Code. Encurte o conteúdo — ' +
        'ou, se for um endereço, use um encurtador de link.',
    );
  }

  const tamanho = codigo.getModuleCount();
  const escuro: boolean[][] = [];
  for (let linha = 0; linha < tamanho; linha += 1) {
    const atual: boolean[] = [];
    for (let coluna = 0; coluna < tamanho; coluna += 1) atual.push(codigo.isDark(linha, coluna));
    escuro.push(atual);
  }

  // Versão 1 tem 21 módulos, e cada versão seguinte acrescenta 4.
  return { tamanho, escuro, versao: (tamanho - 17) / 4 };
}

/**
 * A borda branca obrigatória, em módulos.
 *
 * A norma pede 4 módulos de cada lado. Não é margem de estética: é o que
 * separa o código do que estiver impresso em volta, e sem ela o leitor não
 * acha onde o código começa. Quem corta essa borda para "economizar espaço"
 * é quem depois reclama que o QR não lê.
 */
export const BORDA_EM_MODULOS = 4;
