/** O que a tela de impressão guarda de cada arquivo da fila. */
export type EstadoDoItem = 'esperando' | 'convertendo' | 'pronto' | 'erro' | 'impresso';

export type ItemFila = {
  id: string;
  nome: string;
  origem: File | Blob;
  nomeOriginal: string;
  blob: Blob | null;
  paginas: number;
  estado: EstadoDoItem;
  erro?: string;
};
