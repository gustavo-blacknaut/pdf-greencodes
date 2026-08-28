/**
 * Barreiras aplicadas antes de qualquer parser tocar no arquivo.
 *
 * Nenhuma delas transforma o pdf.js num parser seguro: ele continua sendo
 * código complexo lendo formato hostil. O que elas fazem é reduzir a superfície
 * (só entra o que tem cara de PDF), limitar o estrago (teto de memória e de
 * tempo) e garantir que o usuário sempre consiga sair da operação.
 */

export const LIMITES = {
  /** Um arquivo sozinho. Acima disso a aba costuma morrer antes de terminar. */
  bytesPorArquivo: 150 * 1024 * 1024,
  /** Soma de todos os arquivos da fila. */
  bytesTotais: 300 * 1024 * 1024,
  arquivos: 30,
  /** Miniaturas na grade. O resto vira placeholder numerado. */
  miniaturas: 300,
  /** Teto de tempo de uma operação inteira. */
  tempoOperacaoMs: 5 * 60 * 1000,
} as const;

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
  const webp = contem(b, [0x52, 0x49, 0x46, 0x46], 0) && contem(b, [0x57, 0x45, 0x42, 0x50], 8);
  return jpeg || png || webp;
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
