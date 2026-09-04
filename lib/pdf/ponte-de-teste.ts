/**
 * Uma ponte para o motor Python que funciona fora do Electron.
 *
 * Existe para o teste poder rodar os dois motores no mesmo arquivo e comparar
 * a saída. Sem isto, `temMotorPython` é sempre falso em Node e o caminho do
 * Python nunca seria exercitado antes de chegar na máquina de alguém.
 *
 * Fala o mesmo protocolo de linhas JSON que o processo principal fala, e usa
 * o mesmo `motor/principal.py`: o que o teste mede é o caminho de verdade,
 * não uma imitação dele.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

type Passo = { fracao: number; mensagem: string };

export class PonteDeTeste {
  private motor: ChildProcessWithoutNullStreams;
  private pendente = '';
  private aguardando: ((linha: Record<string, unknown>) => void)[] = [];
  private ouvintes = new Set<(passo: Passo) => void>();
  private pastas: string[] = [];

  constructor(raiz: string) {
    this.motor = spawn(path.join(raiz, 'motor', 'runtime', 'python.exe'), [path.join(raiz, 'motor', 'principal.py')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.motor.stdout.setEncoding('utf8');
    this.motor.stdout.on('data', (pedaco: string) => this.receber(pedaco));
  }

  private receber(pedaco: string) {
    this.pendente += pedaco;
    let quebra = this.pendente.indexOf('\n');
    while (quebra >= 0) {
      const linha = this.pendente.slice(0, quebra).trim();
      this.pendente = this.pendente.slice(quebra + 1);
      if (linha) {
        const dados = JSON.parse(linha) as Record<string, unknown>;
        if (dados.tipo === 'andamento') {
          const passo = { fracao: Number(dados.fracao ?? 0), mensagem: String(dados.mensagem ?? '') };
          this.ouvintes.forEach((f) => f(passo));
        } else {
          this.aguardando.shift()?.(dados);
        }
      }
      quebra = this.pendente.indexOf('\n');
    }
  }

  /** O objeto que a interface espera encontrar em `window.greenpdf.motor`. */
  get api() {
    return {
      executar: (acao: string, pedido: Record<string, unknown>) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          this.aguardando.push((resposta) => {
            if (resposta.tipo === 'erro') reject(new Error(String(resposta.erro)));
            else resolve(resposta.dados as Record<string, unknown>);
          });
          this.motor.stdin.write(JSON.stringify({ id: 't', acao, ...pedido }) + '\n');
        }),
      cancelar: async () => true,
      pastaTemporaria: async () => {
        const pasta = mkdtempSync(path.join(tmpdir(), 'pdf-greencodes-'));
        this.pastas.push(pasta);
        return pasta;
      },
      gravarEntrada: async (pasta: string, nome: string, bytes: ArrayBuffer) => {
        const destino = path.join(pasta, path.basename(nome));
        writeFileSync(destino, Buffer.from(bytes));
        return destino;
      },
      lerSaida: async (caminho: string) => {
        const bytes = readFileSync(caminho);
        return {
          nome: path.basename(caminho),
          bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        };
      },
      limpar: async (pasta: string) => {
        rmSync(pasta, { recursive: true, force: true });
      },
      aoAndar: (callback: (passo: Passo) => void) => {
        this.ouvintes.add(callback);
        return () => this.ouvintes.delete(callback);
      },
    };
  }

  /** Liga a ponte, roda o que foi pedido, e desliga — mesmo se estourar. */
  static async com<T>(raiz: string, trabalho: (ponte: PonteDeTeste) => Promise<T>): Promise<T> {
    const ponte = new PonteDeTeste(raiz);
    const janelaAntes = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { greenpdf: { ehAplicativo: true, motor: ponte.api } };
    try {
      return await trabalho(ponte);
    } finally {
      (globalThis as { window?: unknown }).window = janelaAntes;
      ponte.desligar();
    }
  }

  desligar() {
    this.motor.stdin.end();
    this.motor.kill();
    for (const pasta of this.pastas) rmSync(pasta, { recursive: true, force: true });
  }
}
