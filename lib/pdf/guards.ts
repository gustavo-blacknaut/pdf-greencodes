/**
 * Barreiras aplicadas antes de qualquer parser tocar no arquivo.
 *
 * Elas não deixam o pdf.js seguro — continua sendo código complexo lendo
 * formato hostil. O que fazem é reduzir a superfície (só entra o que tem cara
 * de PDF), limitar memória e tempo, e deixar a operação sempre cancelável.
 */

/**
 * Tetos do navegador.
 *
 * Uma aba não tem a memória da máquina inteira: ela tem o que o navegador
 * deixa, e um PDF de 400 MB aberto pelo pdf-lib pede vários múltiplos disso.
 * Passar daqui não trava um arquivo, trava a aba.
 */
const LIMITES_NAVEGADOR = {
  bytesPorArquivo: 150 * 1024 * 1024,
  bytesTotais: 1024 * 1024 * 1024,
  arquivos: 100,
  miniaturas: 300,
  tempoOperacaoMs: 5 * 60 * 1000,
};

/**
 * Tetos do aplicativo.
 *
 * Aqui é um programa instalado, com a memória da máquina à disposição, e o
 * uso real inclui digitalização de centenas de páginas. Acima de 1 GB o
 * trabalho é lento e pode faltar memória — mas isso é problema de quem
 * escolheu o arquivo, não motivo para recusar.
 */
const LIMITES_APLICATIVO = {
  bytesPorArquivo: 2 * 1024 * 1024 * 1024,
  bytesTotais: 4 * 1024 * 1024 * 1024,
  arquivos: 500,
  miniaturas: 300,
  // Documento grande leva mais que cinco minutos, e cortar no meio seria pior.
  tempoOperacaoMs: 30 * 60 * 1000,
};

/** Acima disto o app avisa que vai demorar, mas não impede. */
export const AVISO_ARQUIVO_GRANDE = 300 * 1024 * 1024;

let noAplicativo = false;

/**
 * Liga os tetos do aplicativo.
 *
 * É uma chave e não uma leitura de `window.greenpdf` porque estes limites
 * também são usados em teste, onde não existe ponte nenhuma.
 */
export function usarLimitesDoAplicativo(ligado: boolean): void {
  noAplicativo = ligado;
}

export const LIMITES = new Proxy({} as typeof LIMITES_NAVEGADOR, {
  get: (_alvo, chave: string) =>
    (noAplicativo ? LIMITES_APLICATIVO : LIMITES_NAVEGADOR)[chave as keyof typeof LIMITES_NAVEGADOR],
});

export class ArquivoRejeitado extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArquivoRejeitado';
  }
}

export class OperacaoCancelada extends Error {
  constructor(message = 'Operação cancelada.') {
    super(message);
    this.name = 'OperacaoCancelada';
  }
}

function contem(bytes: Uint8Array, assinatura: number[], inicio: number): boolean {
  for (let i = 0; i < assinatura.length; i += 1) {
    if (bytes[inicio + i] !== assinatura[i]) return false;
  }
  return true;
}

/**
 * A especificação permite lixo antes do cabeçalho, então varremos o primeiro
 * kilobyte atrás de "%PDF-". Um arquivo que não tem isso não é PDF, e não vale
 * entregar ao parser só para descobrir isso lá dentro.
 */
export function pareceMesmoPdf(bytes: ArrayBuffer): boolean {
  const inicio = new Uint8Array(bytes, 0, Math.min(1024, bytes.byteLength));
  const assinatura = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  for (let i = 0; i <= inicio.length - assinatura.length; i += 1) {
    if (contem(inicio, assinatura, i)) return true;
  }
  return false;
}

export function pareceMesmoImagem(bytes: ArrayBuffer): boolean {
  const b = new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength));

  const jpeg = contem(b, [0xff, 0xd8, 0xff], 0);
  const png = contem(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // RIFF....WEBP: o tamanho fica entre a marca e o formato, então são duas
  // conferências em posições diferentes.
  const webp = contem(b, [0x52, 0x49, 0x46, 0x46], 0) && contem(b, [0x57, 0x45, 0x42, 0x50], 8);
  const gif = contem(b, [0x47, 0x49, 0x46, 0x38], 0);
  const bmp = contem(b, [0x42, 0x4d], 0);
  // AVIF e HEIC são o mesmo contêiner ISO-BMFF: "ftyp" na posição 4, e a
  // marca da variante logo depois.
  const ftyp = contem(b, [0x66, 0x74, 0x79, 0x70], 4);
  const avif = ftyp && contem(b, [0x61, 0x76, 0x69], 8);
  const heic = ftyp && (contem(b, [0x68, 0x65, 0x69], 8) || contem(b, [0x6d, 0x69, 0x66], 8));

  return jpeg || png || webp || gif || bmp || avif || heic;
}

/** As extensões de imagem que o programa sabe abrir. */
const EXTENSAO_DE_IMAGEM = /\.(jpe?g|png|webp|avif|gif|bmp|heic|heif)$/i;

/**
 * Se o arquivo é imagem, decidido pelo nome **ou** pelo rótulo do sistema.
 *
 * Só olhar o `type` era o que recusava um PNG com "Formato não suportado":
 * quando o arquivo vem do diálogo do Windows, ou de certos navegadores, o
 * `File.type` chega vazio, e a extensão é a única pista que sobra.
 *
 * Isto é o portão, não a prova: quem passa daqui ainda encara o
 * `pareceMesmoImagem`, que olha os bytes. Nome mente; assinatura não.
 */
export function pareceSerImagem(nome: string, type = ''): boolean {
  return type.startsWith('image/') || EXTENSAO_DE_IMAGEM.test(nome);
}

/**
 * .docx é um zip. A assinatura só garante "é um zip válido"; se o zip não
 * tiver word/document.xml dentro, isso aparece depois, na hora de abrir.
 */
export function pareceMesmoDocx(bytes: ArrayBuffer): boolean {
  const b = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  return contem(b, [0x50, 0x4b, 0x03, 0x04], 0);
}

export function formatarLimite(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Valida a fila inteira antes de aceitar arquivos novos. */
export function validarFila(
  novos: { name: string; size: number }[],
  jaNaFila: { size: number }[],
): void {
  const grande = novos.find((f) => f.size > LIMITES.bytesPorArquivo);
  if (grande) {
    throw new ArquivoRejeitado(
      `"${grande.name}" tem ${formatarLimite(grande.size)} e o limite por arquivo é ${formatarLimite(LIMITES.bytesPorArquivo)}. Acima disso a memória do navegador não dá conta.`,
    );
  }

  if (jaNaFila.length + novos.length > LIMITES.arquivos) {
    throw new ArquivoRejeitado(`Máximo de ${LIMITES.arquivos} arquivos por vez.`);
  }

  const total = [...jaNaFila, ...novos].reduce((soma, f) => soma + f.size, 0);
  if (total > LIMITES.bytesTotais) {
    throw new ArquivoRejeitado(
      `A fila somaria ${formatarLimite(total)} e o limite é ${formatarLimite(LIMITES.bytesTotais)}. Processe em lotes menores.`,
    );
  }
}

/** Interrompe o laço quando o usuário cancela ou o tempo estoura. */
export function abortarSePreciso(signal?: AbortSignal): void {
  if (signal?.aborted) throw new OperacaoCancelada();
}
