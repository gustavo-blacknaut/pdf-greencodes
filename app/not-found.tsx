import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-28 text-center sm:px-6">
      <p className="text-6xl font-semibold tracking-tight text-brand">404</p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Essa ferramenta não existe</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        O endereço pode ter mudado. Veja a lista completa na página inicial.
      </p>
      <Link href="/" className="btn-primary mt-8">
        <ArrowLeft className="h-4 w-4" /> Voltar para o início
      </Link>
    </div>
  );
}
