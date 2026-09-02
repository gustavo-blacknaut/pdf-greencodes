'use client';

import { Loader2, Plus, Printer, SlidersHorizontal } from 'lucide-react';
import { abrirPreferenciasDaImpressora, type Impressora, type OpcoesImpressao } from '@/lib/desktop';
import { cx } from '@/lib/utils';

/**
 * O painel do lado direito: valem para a fila inteira, não por arquivo.
 */
export function OpcoesDeImpressao({
  opcoes,
  impressoras,
  noApp,
  intervalo,
  porFolha,
  montando,
  lote,
  prontos,
  imprimindo,
  preparando,
  aviso,
  onMudar,
  onIntervalo,
  onPorFolha,
  onLote,
  onImprimir,
  onLimpar,
}: {
  opcoes: OpcoesImpressao;
  impressoras: Impressora[] | null;
  noApp: boolean;
  intervalo: string;
  porFolha: number;
  montando: boolean;
  lote: number;
  prontos: number;
  imprimindo: string | null;
  preparando: boolean;
  aviso: string | null;
  onMudar: <K extends keyof OpcoesImpressao>(chave: K, valor: OpcoesImpressao[K]) => void;
  onIntervalo: (valor: string) => void;
  onPorFolha: (valor: number) => void;
  onLote: (valor: number) => void;
  onImprimir: () => void;
  onLimpar: () => void;
}) {
  const campo = 'w-full rounded-xl border bg-bg/60 px-3 py-2.5 text-sm text-ink outline-none transition';

  return (
  <div className="card h-fit p-5">
    <p className="text-sm font-semibold tracking-tight">Opções</p>
    <p className="mt-1 text-xs text-muted">Valem para todos os arquivos da fila.</p>

    <div className="mt-4 space-y-3.5">
      {noApp && (
        <div>
          <label htmlFor="impressora" className="field-label">
            Impressora
          </label>
          {impressoras === null ? (
            <p className="mt-1.5 flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Procurando...
            </p>
          ) : impressoras.length === 0 ? (
            <p className="mt-1.5 text-sm text-muted">Nenhuma impressora instalada no Windows.</p>
          ) : (
            <select
              id="impressora"
              className={cx(campo, 'mt-1.5')}
              value={opcoes.impressora ?? ''}
              onChange={(e) => onMudar('impressora', e.target.value)}
            >
              {impressoras.map((i) => (
                <option key={i.nome} value={i.nome}>
                  {i.apelido}
                  {i.padrao ? ' (padrão)' : ''}
                </option>
              ))}
            </select>
          )}

          {/*
            Tipo e espessura do papel não passam pela API do Windows:
            ficam no driver. Este botão leva direto à janela dele, e o
            que for marcado lá vale para o que enviarmos daqui.
          */}
          <button
            type="button"
            onClick={() => void abrirPreferenciasDaImpressora(opcoes.impressora ?? '')}
            disabled={!opcoes.impressora}
            className="btn-ghost mt-2 w-full justify-start px-3 py-2 text-[13px] disabled:opacity-40"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Tipo e espessura do papel...
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            Papel grosso, fotográfico ou etiqueta ficam na janela do driver. O que você marcar lá vale para as
            impressões feitas aqui.
          </p>

        <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-bg/40 p-3">
          <input
            type="checkbox"
            checked={Boolean(opcoes.usarDialogo)}
            onChange={(e) => onMudar('usarDialogo', e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-current"
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">Escolher os ajustes na hora de imprimir</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
              Abre a janela de impressão do Windows, onde o botão Preferências dá acesso ao tipo de papel, ao padrão
              fino ou grosso e à melhor qualidade de imagem. É o caminho garantido para esses ajustes: mandando
              direto, o sistema monta a configuração por conta própria e pode ignorar o que está salvo no driver.
            </span>
          </span>
        </label>
        </div>
      )}

      <div>
        <label htmlFor="intervalo" className="field-label">
          Páginas
        </label>
        <input
          id="intervalo"
          type="text"
          value={intervalo}
          onChange={(e) => onIntervalo(e.target.value)}
          placeholder="todas"
          className={cx(campo, 'mt-1.5')}
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          Em branco imprime tudo. Aceita <span className="font-mono">1-5</span>,{' '}
          <span className="font-mono">2, 7, 9</span> ou <span className="font-mono">10-</span> para daí até o fim.
        </p>
      </div>

      <div>
        <label htmlFor="porFolha" className="field-label">
          Páginas por folha
        </label>
        <select
          id="porFolha"
          className={cx(campo, 'mt-1.5')}
          value={String(porFolha)}
          onChange={(e) => onPorFolha(Number(e.target.value))}
        >
          <option value="1">1 — uma por folha</option>
          <option value="2">2 — folha deitada</option>
          <option value="4">4 — grade 2 x 2</option>
          <option value="6">6 — grade 2 x 3</option>
          <option value="8">8 — grade 2 x 4</option>
          <option value="9">9 — grade 3 x 3</option>
          <option value="12">12 — grade 3 x 4</option>
          <option value="16">16 — grade 4 x 4</option>
        </select>
        {porFolha > 1 && (
          <p className="mt-1.5 text-[11px] text-muted">
            {montando ? 'Montando a prévia...' : 'A prévia acima já mostra as folhas montadas.'}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="lote" className="field-label">
          Enviar em lotes
        </label>
        <select
          id="lote"
          className={cx(campo, 'mt-1.5')}
          value={String(lote)}
          onChange={(e) => onLote(Number(e.target.value))}
        >
          <option value="0">Arquivo inteiro de uma vez</option>
          <option value="1">Página por página</option>
          <option value="5">A cada 5 páginas</option>
          <option value="10">A cada 10 páginas</option>
          <option value="25">A cada 25 páginas</option>
          <option value="50">A cada 50 páginas</option>
        </select>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          Documento grande num trabalho só costuma travar impressora de rede. Em lotes, cada parte só sai
          depois que a anterior entrou, e a ordem é mantida.
        </p>
      </div>

      <div>
        <label htmlFor="papel" className="field-label">
          Papel
        </label>
        <select
          id="papel"
          className={cx(campo, 'mt-1.5')}
          value={opcoes.papel}
          onChange={(e) => onMudar('papel', e.target.value as OpcoesImpressao['papel'])}
        >
          <option value="A4">A4 · 210 × 297 mm</option>
          <option value="Letter">Carta · 216 × 279 mm</option>
          <option value="Legal">Ofício · 216 × 356 mm</option>
          <option value="A3">A3 · 297 × 420 mm</option>
          <option value="A5">A5 · 148 × 210 mm</option>
          <option value="Tabloid">Tabloide · 279 × 432 mm</option>
        </select>
      </div>

      <div>
        <label htmlFor="ajuste" className="field-label">
          Ajuste na folha
        </label>
        <select
          id="ajuste"
          className={cx(campo, 'mt-1.5')}
          value={opcoes.ajuste ?? 'pagina'}
          onChange={(e) => onMudar('ajuste', e.target.value as OpcoesImpressao['ajuste'])}
        >
          <option value="pagina">Ajustar à página — cabe inteira</option>
          <option value="preencher">Preencher a folha — corta o que sobra</option>
          <option value="original">Tamanho original — sem redimensionar</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="margemLados" className="field-label">
            Borda nos lados
          </label>
          <div className="relative mt-1.5">
            <input
              id="margemLados"
              type="number"
              min={0}
              max={40}
              className={cx(campo, 'pr-10')}
              value={opcoes.margemLadosMm ?? 0}
              onChange={(e) => onMudar('margemLadosMm', Math.max(0, Math.min(40, Number(e.target.value) || 0)))}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
              mm
            </span>
          </div>
        </div>

        <div>
          <label htmlFor="margemCima" className="field-label">
            Em cima e embaixo
          </label>
          <div className="relative mt-1.5">
            <input
              id="margemCima"
              type="number"
              min={0}
              max={40}
              className={cx(campo, 'pr-10')}
              value={opcoes.margemCimaMm ?? 0}
              onChange={(e) => onMudar('margemCimaMm', Math.max(0, Math.min(40, Number(e.target.value) || 0)))}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
              mm
            </span>
          </div>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        Zero imprime até a beirada. A impressora ainda tem a margem física dela, que não dá para vencer por
        software — se cortar, aumente aqui.
      </p>

      <div>
        <label htmlFor="qualidade" className="field-label">
          Qualidade
        </label>
        <select
          id="qualidade"
          className={cx(campo, 'mt-1.5')}
          value={String(opcoes.dpi)}
          onChange={(e) => onMudar('dpi', Number(e.target.value))}
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
          onChange={(e) => onMudar('duplex', e.target.value as OpcoesImpressao['duplex'])}
        >
          <option value="simplex">Só frente</option>
          <option value="longEdge">Virar na borda longa</option>
          <option value="shortEdge">Virar na borda curta</option>
        </select>
      </div>

      <div>
        <label htmlFor="copias" className="field-label">
          Cópias de cada arquivo
        </label>
        <input
          id="copias"
          type="number"
          min={1}
          max={99}
          className={cx(campo, 'mt-1.5')}
          value={opcoes.copias}
          onChange={(e) => onMudar('copias', Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
        />
      </div>

      <div className="flex flex-wrap gap-1.5 pt-1">
        {(
          [
            ['Colorido', true],
            ['Preto e branco', false],
          ] as const
        ).map(([rotulo, valor]) => (
          <button
            key={rotulo}
            type="button"
            onClick={() => onMudar('colorido', valor)}
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
            onClick={() => onMudar('paisagem', valor)}
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
    </div>

    <button
      type="button"
      onClick={onImprimir}
      disabled={!prontos || Boolean(imprimindo) || preparando}
      className="btn-primary mt-5 w-full py-3"
    >
      {imprimindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
      {imprimindo
        ? 'Enviando...'
        : prontos > 1
          ? `Imprimir os ${prontos}`
          : 'Imprimir'}
    </button>

    <button
      type="button"
      onClick={onLimpar}
      className="btn-ghost mt-2 w-full py-2 text-[13px]"
    >
      <Plus className="h-3.5 w-3.5 rotate-45" /> Limpar a fila
    </button>

    {aviso && <p className="mt-3 text-center text-xs text-brand">{aviso}</p>}

    <p className="mt-4 text-xs leading-relaxed text-muted">
      {noApp
        ? 'Cada arquivo da fila vira um trabalho separado na impressora.'
        : 'No navegador cada arquivo abre a caixa de impressão uma vez. No aplicativo a fila inteira vai de uma vez, sem perguntar.'}
    </p>
  </div>
  );
}
