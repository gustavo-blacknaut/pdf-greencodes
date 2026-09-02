'use client';

import { useEffect, useState } from 'react';
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

        <div className="ml-auto">
          <PainelDeAtividade />
        </div>
      </div>
    </header>
  );
}
