'use client';

import { useEffect } from 'react';
import { scheduleWarmup } from '@/lib/pdf/lazy';

/**
 * Pré-carrega o motor de PDF quando a thread principal fica ociosa, para a
 * primeira ferramenta abrir sem espera.
 *
 * Aqui não se busca rota nenhuma. Antes este componente pedia o prefetch das
 * 38 ferramentas de uma vez, 900 ms depois de abrir: em máquina fraca isso
 * eram 38 downloads e 38 parses de JavaScript competindo com a tela que a
 * pessoa está tentando usar. As grades já buscam a rota no hover e no foco,
 * que é quando a intenção existe.
 */
export function Warmup() {
  useEffect(() => scheduleWarmup(), []);
  return null;
}
