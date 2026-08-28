'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { scheduleWarmup } from '@/lib/pdf/lazy';
import { TOOLS } from '@/lib/tools';

/**
 * Pré-carregamento global: quando a thread principal fica ociosa, buscamos os
 * chunks do motor de PDF e as rotas das ferramentas. Quando o usuário finalmente
 * clica, a tela já está montada e a biblioteca já está em cache.
 */
export function Warmup() {
  const router = useRouter();

  useEffect(() => {
    const cancel = scheduleWarmup();
    const timer = window.setTimeout(() => {
      TOOLS.forEach((tool) => router.prefetch(`/${tool.slug}`));
    }, 900);
    return () => {
      cancel();
      window.clearTimeout(timer);
    };
  }, [router]);

  return null;
}
