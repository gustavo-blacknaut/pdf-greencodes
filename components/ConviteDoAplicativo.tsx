import { Zap } from 'lucide-react';
import { BaixarAplicativo } from './BaixarAplicativo';
import { GANHO_MEDIDO, LIMITE_DO_APLICATIVO } from '@/lib/aplicativo';
import type { OperationId } from '@/lib/pdf/engine';

/**
 * O convite para o aplicativo, embaixo do resultado no site.
 *
 * A velocidade só é prometida onde foi medida: nas operações que o
 * aplicativo manda para o motor Python. Nas outras os dois lados rodam o
 * mesmo código, e o convite fala do que muda de verdade — o tamanho que
 * aceita e o salvar direto no disco.
 */
export function ConviteDoAplicativo({
  operacao,
  segundos,
}: {
  operacao: OperationId | null;
  segundos: number;
}) {
  const ganho = operacao ? GANHO_MEDIDO[operacao] : undefined;
  // Abaixo de meio segundo a diferença não se sente, e anunciar "0,1 s em
  // vez de 0,4 s" soaria como exagero.
  const valeFalarDeTempo = ganho !== undefined && segundos >= 0.5;

  return (
    <div className="flex flex-wrap items-center gap-4 border-t bg-brand/5 px-5 py-4">
      <Zap className="h-5 w-5 shrink-0 text-brand" />
      <p className="min-w-0 flex-1 text-sm leading-relaxed">
        {valeFalarDeTempo ? (
          <>
            Levou {segundos.toFixed(1)} s aqui. No aplicativo, o motor de PDF faz isto até{' '}
            <strong>{String(ganho).replace('.', ',')} vezes mais rápido</strong> — e aceita arquivos de até{' '}
            {LIMITE_DO_APLICATIVO}.
          </>
        ) : (
          <>
            No aplicativo para Windows: arquivos de até {LIMITE_DO_APLICATIVO}, o resultado direto na pasta
            Downloads e mais de 70 ferramentas de gráfica.
          </>
        )}
      </p>
      <BaixarAplicativo className="shrink-0 px-4 py-2 text-sm" />
    </div>
  );
}
