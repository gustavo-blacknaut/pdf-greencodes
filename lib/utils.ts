export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'sem info';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

/**
 * Converte "1-3, 5, 8-" em índices 0-based, sem duplicatas e em ordem.
 * Uma entrada vazia significa "todas as páginas".
 */
export function parsePageRange(input: string, pageCount: number): number[] {
  const trimmed = input.trim();
  if (!trimmed) return Array.from({ length: pageCount }, (_, i) => i);

  const picked = new Set<number>();
  for (const chunk of trimmed.split(/[,;\s]+/).filter(Boolean)) {
    const match = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(chunk);
    if (!match) throw new Error(`Trecho inválido: "${chunk}"`);
    const [, rawStart, dash, rawEnd] = match;
    if (!dash) {
      if (!rawStart) throw new Error(`Trecho inválido: "${chunk}"`);
      const page = Number(rawStart);
      if (page < 1 || page > pageCount) throw new Error(`Página ${page} não existe (o arquivo tem ${pageCount}).`);
      picked.add(page - 1);
      continue;
    }
    const start = rawStart ? Number(rawStart) : 1;
    const end = rawEnd ? Number(rawEnd) : pageCount;
    if (start < 1 || end > pageCount || start > end) {
      throw new Error(`Intervalo ${start}-${end} fora do arquivo (1-${pageCount}).`);
    }
    for (let p = start; p <= end; p += 1) picked.add(p - 1);
  }
  return [...picked].sort((a, b) => a - b);
}

/**
 * Devolve o controle ao browser para a UI não travar entre páginas pesadas.
 *
 * Usa MessageChannel de propósito: requestAnimationFrame não dispara em abas
 * ocultas e setTimeout é limitado a 1 s em segundo plano. Os dois fariam o
 * processamento congelar se o usuário trocasse de aba no meio.
 */
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel === 'undefined') {
      setTimeout(resolve, 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

export function replaceExtension(name: string, ext: string): string {
  return `${name.replace(/\.[^.]+$/, '')}.${ext}`;
}

export function suffixName(name: string, suffix: string, ext?: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  const currentExt = ext ?? (name.match(/\.([^.]+)$/)?.[1] ?? 'pdf');
  return `${base}-${suffix}.${currentExt}`;
}
