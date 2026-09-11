import type { Metadata } from 'next';
import { PainelDeUso } from '@/components/PainelDeUso';

export const metadata: Metadata = { title: 'Seu uso', robots: { index: false, follow: false } };

export default function UsoPage() {
  return <PainelDeUso />;
}
