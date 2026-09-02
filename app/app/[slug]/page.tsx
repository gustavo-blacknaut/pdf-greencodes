import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ToolWorkspace } from '@/components/ToolWorkspace';
import { getTool, TOOLS } from '@/lib/tools';

type Params = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  // A de impressão tem página própria; gerar /imprimir aqui colidiria com ela.
  return TOOLS.filter((tool) => !tool.rota).map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  return { title: getTool(slug)?.name ?? 'Ferramenta', robots: { index: false, follow: false } };
}

export default async function AppToolPage({ params }: Params) {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) notFound();

  return (
    <>
      <div className="mx-auto max-w-6xl px-5 pt-5">
        <Link href="/app" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Ferramentas
        </Link>
      </div>
      <ToolWorkspace tool={tool} />
    </>
  );
}
