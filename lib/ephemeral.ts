'use client';

import type { OutputFile } from './pdf/engine';

/**
 * Cofre efêmero.
 *
 * Os resultados vivem só como Blob na memória da aba. Cada entrada tem um TTL;
 * quando o usuário baixa (ou o tempo acaba, ou ele troca de ferramenta), o
 * ObjectURL é revogado e a referência ao Blob é solta, e o GC recolhe os bytes.
 * Nada é escrito em disco pelo site e nada trafega pela rede.
 */

export const DEFAULT_TTL_MS = 10 * 60 * 1000;

/**
 * Sem prazo, para o aplicativo.
 *
 * O prazo existe por causa do site: ali o resultado só mora na memória da aba,
 * e segurar dezenas de megabytes para sempre acabaria com a memória do
 * navegador. No aplicativo o arquivo é gravado em disco e é da pessoa — apagar
 * da memória depois de dez minutos só fazia os botões de abrir e salvar
 * pararem de funcionar sozinhos, sem motivo nenhum.
 */
export const SEM_PRAZO = Number.POSITIVE_INFINITY;

export type VaultEntry = {
  id: string;
  files: OutputFile[];
  createdAt: number;
  expiresAt: number;
  downloaded: Set<string>;
  purged: boolean;
};

type Listener = () => void;

class EphemeralVault {
  private entries = new Map<string, VaultEntry>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private urls = new Map<string, string>();
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  get(id: string): VaultEntry | undefined {
    return this.entries.get(id);
  }

  store(files: OutputFile[], ttlMs = DEFAULT_TTL_MS): VaultEntry {
    const id = `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const entry: VaultEntry = {
      id,
      files,
      createdAt: now,
      expiresAt: now + ttlMs,
      downloaded: new Set(),
      purged: false,
    };
    this.entries.set(id, entry);
    // `setTimeout` com Infinity dispara na hora (o valor estoura o inteiro de
    // 32 bits e vira zero), então o caso sem prazo não agenda nada.
    if (Number.isFinite(ttlMs)) {
      this.timers.set(
        id,
        setTimeout(() => this.purge(id, 'expirou'), ttlMs),
      );
    }
    this.emit();
    return entry;
  }

  /**
   * Baixa um arquivo. O primeiro download preserva o resultado, porque é comum o
   * navegador perguntar onde salvar, ou a pessoa querer o arquivo de novo. Só
   * quando ela pede a segunda cópia (`purgeAfter`) é que apagamos da memória.
   */
  download(id: string, fileName: string, options: { purgeAfter?: boolean } = {}): void {
    const entry = this.entries.get(id);
    if (!entry || entry.purged) throw new Error('Este resultado já foi apagado. Rode a ferramenta de novo.');
    const file = entry.files.find((f) => f.name === fileName);
    if (!file) throw new Error('Arquivo não encontrado neste resultado.');

    const url = URL.createObjectURL(file.blob);
    this.urls.set(`${id}:${fileName}`, url);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    entry.downloaded.add(fileName);

    // O browser precisa de um instante para começar a leitura do blob antes de
    // revogarmos a URL; 4s é folgado e ainda assim imperceptível.
    setTimeout(() => {
      URL.revokeObjectURL(url);
      this.urls.delete(`${id}:${fileName}`);
      if (options.purgeAfter) this.purge(id, 'baixado');
      else this.emit();
    }, 4000);

    this.emit();
  }

  purge(id: string, _reason: 'baixado' | 'expirou' | 'manual' | 'saiu' = 'manual'): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    for (const key of [...this.urls.keys()]) {
      if (key.startsWith(`${id}:`)) {
        URL.revokeObjectURL(this.urls.get(key)!);
        this.urls.delete(key);
      }
    }
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);

    entry.purged = true;
    entry.files = [];
    this.entries.delete(id);
    this.emit();
  }

  purgeAll(): void {
    [...this.entries.keys()].forEach((id) => this.purge(id, 'saiu'));
  }
}

export const vault = new EphemeralVault();

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => vault.purgeAll());
}
