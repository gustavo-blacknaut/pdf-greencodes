'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { versaoDoAplicativo } from '@/lib/desktop';
import { PainelDeAtividade } from './PainelDeAtividade';

export function AppBar() {
  const [versao, setVersao] = useState('');

  useEffect(() => {
    void versaoDoAplicativo().then(setVersao);
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-128.png" alt="" className="h-7 w-7 shrink-0" />
        <span className="text-[15px] font-semibold tracking-tight">PDF.GreenCodes</span>
        {versao && <span className="text-xs tabular-nums text-muted">{versao}</span>}

        <div className="ml-auto flex items-center gap-2">
          <Link href="/app/uso" className="btn-ghost px-3 py-1.5 text-[13px]">
            <BarChart3 className="h-4 w-4" /> Seu uso
          </Link>
          <PainelDeAtividade />
        </div>
      </div>
    </header>
  );
}
