import type { Metadata } from 'next';
import { SoNoAplicativo } from '@/components/SoNoAplicativo';
import { getTool } from '@/lib/tools';

/*
 * A impressão de gráfica — escala, posição, marcas, papel do driver — é do
 * aplicativo: o navegador não tem como escolher impressora, bandeja nem
 * espessura de papel. No site, esta página leva ao download.
 */
export const metadata: Metadata = {
  title: 'Imprimir PDF, Word e imagem no aplicativo',
  description:
    'Fila de impressão com PDF, foto, Word, Excel e PowerPoint juntos, com escala, posição e marcas de corte. No aplicativo PDF.GreenCodes para Windows.',
  alternates: { canonical: '/imprimir' },
};

export default function ImprimirNoSite() {
  return <SoNoAplicativo tool={getTool('imprimir')!} />;
}
