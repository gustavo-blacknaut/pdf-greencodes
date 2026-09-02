import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PrintWorkspace } from '@/components/PrintWorkspace';

export const metadata: Metadata = { title: 'Imprimir', robots: { index: false, follow: false } };

export default function ImprimirNoApp() {
  return (
    <Suspense>
      <PrintWorkspace />
    </Suspense>
  );
}
