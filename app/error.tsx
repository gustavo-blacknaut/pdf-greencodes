'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Fica no console do usuário e só. Não existe endpoint de erro para onde
    // mandar isso, e o nome do arquivo dele não é assunto nosso.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center sm:px-6">
      <span className="grid h-12 w-12 place-items-center rounded-2xl border bg-elevated text-amber-500">
        <AlertTriangle className="h-5 w-5" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">Alguma coisa quebrou nesta tela</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Seus arquivos continuam apenas no seu computador, e nada foi enviado. Tente de novo; se insistir, recarregue a
        página.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reset} className="btn-primary">
          <RotateCcw className="h-4 w-4" /> Tentar de novo
        </button>
        <Link href="/" className="btn-ghost">
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
