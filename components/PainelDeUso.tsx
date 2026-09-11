'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, FileStack, HardDrive, Layers, Printer, RotateCcw, ShieldCheck, Sheet, Wrench } from 'lucide-react';
import { lerUso, zerarUso, type Uso } from '@/lib/desktop';
import { getTool } from '@/lib/tools';
import { formatBytes } from '@/lib/utils';

const numero = (n: number) => n.toLocaleString('pt-BR');

/**
 * O que a pessoa já fez no programa, em números.
 *
 * Só quantidade: o registro não tem nome de arquivo nem conteúdo — o lado
 * Rust recusa qualquer coisa que não seja slug de ferramenta — e não sai
 * deste computador.
 */
export function PainelDeUso() {
  const [uso, setUso] = useState<Uso | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    void lerUso().then((dados) => {
      setUso(dados);
      setCarregado(true);
    });
  }, []);

  const ferramentas = Object.entries(uso?.ferramentas ?? {}).sort((a, b) => b[1] - a[1]);
  const totalDeUsos = ferramentas.reduce((soma, [, vezes]) => soma + vezes, 0);
  const maior = ferramentas[0]?.[1] ?? 1;

  async function zerar() {
    if (!confirmando) {
      setConfirmando(true);
      return;
    }
    setUso(await zerarUso());
    setConfirmando(false);
  }

  return (
    <div className="mx-auto max-w-5xl px-5 pb-12 pt-5">
      <Link href="/app" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Ferramentas
      </Link>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Seu uso</h1>
          <p className="mt-1.5 text-sm text-muted">
            {uso?.desde
              ? `Contando desde ${new Date(uso.desde).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}.`
              : carregado
                ? 'Nada contado ainda. Rode uma ferramenta e ela aparece aqui.'
                : 'Lendo...'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void zerar()}
          onBlur={() => setConfirmando(false)}
          className={confirmando ? 'btn border-rose-500/50 text-rose-400' : 'btn-ghost'}
        >
          <RotateCcw className="h-4 w-4" /> {confirmando ? 'Clique de novo para zerar' : 'Zerar a contagem'}
        </button>
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { icone: Wrench, valor: numero(totalDeUsos), rotulo: 'trabalhos feitos' },
          { icone: Printer, valor: numero(uso?.impressoes ?? 0), rotulo: 'impressões mandadas' },
          { icone: Sheet, valor: numero(uso?.folhasImpressas ?? 0), rotulo: 'folhas impressas' },
          { icone: HardDrive, valor: numero(uso?.arquivosSalvos ?? 0), rotulo: 'arquivos salvos' },
          { icone: FileStack, valor: numero(uso?.arquivosProcessados ?? 0), rotulo: 'arquivos processados' },
          { icone: Layers, valor: numero(uso?.paginasProcessadas ?? 0), rotulo: 'páginas processadas' },
          { icone: HardDrive, valor: formatBytes(uso?.bytesProcessados ?? 0), rotulo: 'de arquivos passaram por aqui' },
          { icone: Wrench, valor: numero(ferramentas.length), rotulo: 'ferramentas diferentes' },
        ].map((item) => (
          <div key={item.rotulo} className="card p-4">
            <item.icone className="h-4 w-4 text-brand" strokeWidth={1.75} />
            <dt className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">{item.valor}</dt>
            <dd className="text-xs text-muted">{item.rotulo}</dd>
          </div>
        ))}
      </dl>

      {ferramentas.length > 0 && (
        <section className="card mt-6 p-5">
          <h2 className="text-sm font-semibold tracking-tight">Ferramentas mais usadas</h2>
          <ul className="mt-4 space-y-2.5">
            {ferramentas.map(([slug, vezes]) => (
              <li key={slug} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate">{getTool(slug)?.name ?? slug}</span>
                <span className="h-2 overflow-hidden rounded-full bg-line/60">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.max(3, (vezes / maior) * 100)}%`,
                      backgroundImage: 'linear-gradient(90deg, rgb(var(--brand)), rgb(var(--brand2)))',
                    }}
                  />
                </span>
                <span className="tabular-nums text-muted">{numero(vezes)}×</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        Só números. Nenhum nome de arquivo e nenhum conteúdo é guardado, e a contagem fica só neste computador.
      </p>
    </div>
  );
}
