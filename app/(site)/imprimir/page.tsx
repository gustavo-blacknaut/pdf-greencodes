import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PrintWorkspace } from '@/components/PrintWorkspace';

export const metadata: Metadata = {
  title: 'Imprimir PDF, Word, Excel e imagem',
  description:
    'Solte um PDF, foto, Word, Excel ou PowerPoint, confira a prévia e mande para a impressora. O arquivo não sai do seu computador.',
  alternates: { canonical: '/imprimir' },
};

export default function ImprimirNoSite() {
  return (
    <Suspense>
      <PrintWorkspace />
    </Suspense>
  );
}
