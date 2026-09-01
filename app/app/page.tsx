import type { Metadata } from 'next';
import { AppToolGrid } from '@/components/AppToolGrid';

export const metadata: Metadata = {
  title: 'Ferramentas',
  robots: { index: false, follow: false },
};

export default function AppHomePage() {
  return <AppToolGrid />;
}
