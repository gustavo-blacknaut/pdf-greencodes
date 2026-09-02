'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Activity, Check, Loader2, Printer, Trash2, Wrench, X } from 'lucide-react';
import { atividade, type Tarefa } from '@/lib/atividade';
import { cx, formatDuration } from '@/lib/utils';

/**
 * No servidor não há atividade nenhuma, e o React exige que esse retorno
 * seja sempre o mesmo objeto: devolver [] novo a cada chamada faz ele
 * entender que mudou e redesenhar sem parar.
 */
const VAZIO: Tarefa[] = [];

/** Assina o registro e redesenha quando ele muda. */
function useAtividade(): Tarefa[] {
  return useSyncExternalStore(
    (ouvinte) => atividade.inscrever(ouvinte),
    () => atividade.listar(),
    () => VAZIO,
  );
}

function Cronometro({ tarefa }: { tarefa: Tarefa }) {
  const [, redesenhar] = useState(0);

  // Enquanto roda, o tempo tem que andar sozinho.
  useEffect(() => {
    if (tarefa.estado !== 'rodando') return;
    const id = window.setInterval(() => redesenhar((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [tarefa.estado]);

  return <>{formatDuration((tarefa.fim ?? performance.now()) - tarefa.inicio)}</>;
}

function CartaoDaTarefa({ tarefa }: { tarefa: Tarefa }) {
  const [aberta, setAberta] = useState(tarefa.estado === 'rodando');
  const ultima = tarefa.linhas[tarefa.linhas.length - 1];

  const icone =
    tarefa.estado === 'rodando' ? (
      <Loader2 className="h-4 w-4 animate-spin text-brand" />
    ) : tarefa.estado === 'concluida' ? (
      <Check className="h-4 w-4 text-brand" />
    ) : (
      <X className={cx('h-4 w-4', tarefa.estado === 'erro' ? 'text-rose-500' : 'text-muted')} />
    );

  return (
    <li className="rounded-xl border border-line bg-surface">
      <div className="flex items-start gap-2.5 p-3">
        <span className="mt-0.5 shrink-0">{icone}</span>

        <button type="button" onClick={() => setAberta((v) => !v)} className="min-w-0 flex-1 text-left">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{tarefa.titulo}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted">
              <Cronometro tarefa={tarefa} />
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted">
            {tarefa.detalhe ?? ultima?.texto ?? 'Começando...'}
          </span>
        </button>

        {tarefa.estado === 'rodando' && (
          <button
            type="button"
            onClick={() => atividade.cancelar(tarefa.id)}
            className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] text-muted transition hover:border-rose-500/50 hover:text-rose-400"
          >
            Cancelar
          </button>
        )}
      </div>

      {tarefa.estado === 'rodando' && (
        <div className="mx-3 mb-2 h-1 overflow-hidden rounded-full bg-line/60">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-200"
            style={{ width: `${Math.max(3, tarefa.fracao * 100)}%` }}
          />
        </div>
      )}

      {aberta && tarefa.linhas.length > 0 && (
        <ol className="max-h-40 space-y-0.5 overflow-y-auto border-t border-line px-3 py-2 font-mono text-[10px] leading-relaxed">
          {tarefa.linhas.map((linha, i) => (
            <li key={`${linha.em}-${i}`} className="flex gap-2">
              <span className="shrink-0 tabular-nums text-muted/50">{formatDuration(linha.em - tarefa.inicio)}</span>
              <span className={cx('min-w-0 flex-1', i === tarefa.linhas.length - 1 ? 'text-ink' : 'text-muted')}>
                {linha.texto}
              </span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

/**
 * O painel da direita: o que está rodando, o que já rodou, e o que foi para a
 * impressora.
 *
 * Barra de progresso sozinha não distingue "está lento" de "travou": nos dois
 * casos ela fica parada. Aqui aparece o passo, o tempo desde que começou, e o
 * botão de desistir — inclusive quando a tela da ferramenta já foi trocada.
 */
export function PainelDeAtividade() {
  const tarefas = useAtividade();
  const [aberto, setAberto] = useState(false);

  const rodando = tarefas.filter((t) => t.estado === 'rodando');
  const impressoes = tarefas.filter((t) => t.tipo === 'impressao');
  const ferramentas = tarefas.filter((t) => t.tipo === 'ferramenta');

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className={cx(
          'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition',
          rodando.length ? 'border-brand/50 text-brand' : 'border-line text-muted hover:text-ink',
        )}
        title="O que o programa está fazendo"
      >
        {rodando.length ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{rodando.length ? `${rodando.length} em curso` : 'Atividade'}</span>
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setAberto(false)}>
          <aside
            className="flex h-full w-full max-w-md flex-col border-l border-line bg-bg"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Atividade"
          >
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <Activity className="h-4 w-4 text-brand" />
              <p className="flex-1 text-sm font-semibold tracking-tight">Atividade</p>
              {rodando.length > 0 && (
                <button
                  type="button"
                  onClick={() => atividade.cancelarTudo()}
                  className="rounded-lg border border-line px-2 py-1 text-[11px] text-muted transition hover:border-rose-500/50 hover:text-rose-400"
                >
                  Cancelar tudo
                </button>
              )}
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="text-muted transition hover:text-ink"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
              <Secao
                titulo="Impressão"
                icone={<Printer className="h-3.5 w-3.5" />}
                tarefas={impressoes}
                vazio="Nada foi mandado para a impressora ainda."
              />
              <Secao
                titulo="Ferramentas"
                icone={<Wrench className="h-3.5 w-3.5" />}
                tarefas={ferramentas}
                vazio="Nenhuma ferramenta rodou ainda."
              />
            </div>

            {tarefas.some((t) => t.estado !== 'rodando') && (
              <div className="border-t border-line p-3">
                <button
                  type="button"
                  onClick={() => atividade.limparConcluidas()}
                  className="btn-ghost w-full py-2 text-[13px]"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Limpar o que já terminou
                </button>
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

function Secao({
  titulo,
  icone,
  tarefas,
  vazio,
}: {
  titulo: string;
  icone: React.ReactNode;
  tarefas: Tarefa[];
  vazio: string;
}) {
  return (
    <section>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {icone} {titulo}
        {tarefas.length > 0 && <span className="tabular-nums">· {tarefas.length}</span>}
      </p>
      {tarefas.length === 0 ? (
        <p className="text-xs text-muted/70">{vazio}</p>
      ) : (
        <ul className="space-y-2">
          {tarefas.map((tarefa) => (
            <CartaoDaTarefa key={tarefa.id} tarefa={tarefa} />
          ))}
        </ul>
      )}
    </section>
  );
}
