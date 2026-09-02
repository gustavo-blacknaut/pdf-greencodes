'use client';

import { useEffect, useState } from 'react';
import { Loader2, Printer, X } from 'lucide-react';
import { listarImpressoras, type Impressora, type OpcoesImpressao } from '@/lib/desktop';
import { cx } from '@/lib/utils';

const CHAVE = 'greencodes:impressao';

const PADRAO: OpcoesImpressao = {
  copias: 1,
  colorido: true,
  paisagem: false,
  duplex: 'simplex',
  papel: 'A4',
  dpi: 300,
};

/**
 * A escolha da vez anterior é quase sempre a certa: quem imprime etiqueta em
 * Carta não quer voltar para A4 toda vez. Fica no navegador, nada sai daqui.
 */
function lerSalvo(): OpcoesImpressao {
  try {
    const bruto = localStorage.getItem(CHAVE);
    return bruto ? { ...PADRAO, ...JSON.parse(bruto) } : PADRAO;
  } catch {
    return PADRAO;
  }
}

export function PrintDialog({
  nomeArquivo,
  onImprimir,
  onFechar,
}: {
  nomeArquivo: string;
  onImprimir: (opcoes: OpcoesImpressao) => Promise<void>;
  onFechar: () => void;
}) {
  const [impressoras, setImpressoras] = useState<Impressora[] | null>(null);
  const [opcoes, setOpcoes] = useState<OpcoesImpressao>(PADRAO);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const salvo = lerSalvo();
    void listarImpressoras().then((lista) => {
      setImpressoras(lista);
      // A escolhida antes pode ter sido desligada ou removida da rede.
      const aindaExiste = lista.some((i) => i.nome === salvo.impressora);
      setOpcoes({
        ...salvo,
        impressora: aindaExiste ? salvo.impressora : (lista.find((i) => i.padrao) ?? lista[0])?.nome,
      });
    });
  }, []);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  function mudar<K extends keyof OpcoesImpressao>(chave: K, valor: OpcoesImpressao[K]) {
    setOpcoes((atual) => ({ ...atual, [chave]: valor }));
  }

  async function confirmar() {
    setEnviando(true);
    try {
      localStorage.setItem(CHAVE, JSON.stringify(opcoes));
    } catch {
      /* modo anônimo ou armazenamento cheio: imprime do mesmo jeito */
    }
    await onImprimir(opcoes);
    setEnviando(false);
    onFechar();
  }

  const campo = 'w-full rounded-xl border bg-bg/60 px-3 py-2 text-sm text-ink outline-none transition';

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Opções de impressão"
      onClick={(e) => e.target === e.currentTarget && onFechar()}
    >
      <div className="card flex max-h-full w-full max-w-lg flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-3 border-b px-5 py-4">
          <Printer className="h-4 w-4 text-brand" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold tracking-tight">Imprimir</p>
            <p className="truncate text-xs text-muted">{nomeArquivo}</p>
          </div>
          <button type="button" onClick={onFechar} className="text-muted transition hover:text-ink" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div>
            <label htmlFor="impressora" className="field-label">
              Impressora
            </label>
            {impressoras === null ? (
              <p className="mt-1.5 flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Procurando impressoras...
              </p>
            ) : impressoras.length === 0 ? (
              <p className="mt-1.5 text-sm text-muted">
                Nenhuma impressora instalada. O Windows lista aqui as locais e as da rede.
              </p>
            ) : (
              <select
                id="impressora"
                className={cx(campo, 'mt-1.5')}
                value={opcoes.impressora ?? ''}
                onChange={(e) => mudar('impressora', e.target.value)}
              >
                {impressoras.map((impressora) => (
                  <option key={impressora.nome} value={impressora.nome}>
                    {impressora.apelido}
                    {impressora.padrao ? ' (padrão)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="papel" className="field-label">
                Papel
              </label>
              <select
                id="papel"
                className={cx(campo, 'mt-1.5')}
                value={opcoes.papel}
                onChange={(e) => mudar('papel', e.target.value as OpcoesImpressao['papel'])}
              >
                <option value="A4">A4 (210 × 297 mm)</option>
                <option value="Letter">Carta (216 × 279 mm)</option>
                <option value="Legal">Ofício (216 × 356 mm)</option>
                <option value="A3">A3 (297 × 420 mm)</option>
                <option value="A5">A5 (148 × 210 mm)</option>
                <option value="Tabloid">Tabloide (279 × 432 mm)</option>
              </select>
            </div>

            <div>
              <label htmlFor="qualidade" className="field-label">
                Qualidade
              </label>
              <select
                id="qualidade"
                className={cx(campo, 'mt-1.5')}
                value={String(opcoes.dpi)}
                onChange={(e) => mudar('dpi', Number(e.target.value))}
              >
                <option value="150">Rascunho · 150 DPI</option>
                <option value="300">Normal · 300 DPI</option>
                <option value="600">Alta · 600 DPI</option>
                <option value="1200">Máxima · 1200 DPI</option>
              </select>
            </div>

            <div>
              <label htmlFor="duplex" className="field-label">
                Frente e verso
              </label>
              <select
                id="duplex"
                className={cx(campo, 'mt-1.5')}
                value={opcoes.duplex}
                onChange={(e) => mudar('duplex', e.target.value as OpcoesImpressao['duplex'])}
              >
                <option value="simplex">Só frente</option>
                <option value="longEdge">Virar na borda longa</option>
                <option value="shortEdge">Virar na borda curta</option>
              </select>
            </div>

            <div>
              <label htmlFor="copias" className="field-label">
                Cópias
              </label>
              <input
                id="copias"
                type="number"
                min={1}
                max={99}
                className={cx(campo, 'mt-1.5')}
                value={opcoes.copias}
                onChange={(e) => mudar('copias', Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                ['Colorido', 'colorido', true],
                ['Preto e branco', 'colorido', false],
              ] as const
            ).map(([rotulo, chave, valor]) => (
              <button
                key={rotulo}
                type="button"
                onClick={() => mudar(chave, valor)}
                className={cx(
                  'rounded-lg border px-3 py-1.5 text-[13px] font-medium transition',
                  opcoes.colorido === valor ? 'border-transparent bg-ink text-bg' : 'text-muted hover:text-ink',
                )}
              >
                {rotulo}
              </button>
            ))}

            {(
              [
                ['Retrato', false],
                ['Paisagem', true],
              ] as const
            ).map(([rotulo, valor]) => (
              <button
                key={rotulo}
                type="button"
                onClick={() => mudar('paisagem', valor)}
                className={cx(
                  'rounded-lg border px-3 py-1.5 text-[13px] font-medium transition',
                  Boolean(opcoes.paisagem) === valor
                    ? 'border-transparent bg-ink text-bg'
                    : 'text-muted hover:text-ink',
                )}
              >
                {rotulo}
              </button>
            ))}
          </div>

          <p className="text-xs leading-relaxed text-muted">
            Tipo e espessura do papel (comum, fotográfico, cartão) não aparecem aqui: essa escolha é do driver da
            impressora e só existe nas Preferências dela, no Windows.
          </p>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t px-5 py-4">
          <button type="button" onClick={onFechar} className="btn-ghost">
            Cancelar
          </button>
          <button type="button" onClick={() => void confirmar()} disabled={enviando} className="btn-primary">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            {enviando ? 'Enviando...' : 'Imprimir'}
          </button>
        </div>
      </div>
    </div>
  );
}
