'use client';

/**
 * O que o programa está fazendo agora, num lugar só.
 *
 * Cada trabalho pesado — juntar, converter, imprimir — se anuncia aqui e vai
 * escrevendo o que faz. O painel lê disto, e o botão da barra também.
 *
 * É um registro em memória, e não estado de React, porque quem escreve são as
 * operações (que não são componentes) e quem lê são duas telas diferentes. Sai
 * tudo quando a janela fecha, como o resto do programa.
 */

export type EstadoDaTarefa = 'rodando' | 'concluida' | 'cancelada' | 'erro';

export type LinhaDeLog = { texto: string; em: number };

export type Tarefa = {
  id: string;
  titulo: string;
  /** "Juntar PDF", "Imprimir" — o que agrupa na lista. */
  tipo: 'ferramenta' | 'impressao';
  estado: EstadoDaTarefa;
  fracao: number;
  linhas: LinhaDeLog[];
  inicio: number;
  fim?: number;
  detalhe?: string;
  /** Só existe enquanto está rodando. */
  cancelar?: () => void;
};

type Ouvinte = () => void;

const LIMITE_LINHAS = 400;
const LIMITE_TAREFAS = 30;

class RegistroDeAtividade {
  private tarefas: Tarefa[] = [];
  private ouvintes = new Set<Ouvinte>();
  private contador = 0;

  inscrever(ouvinte: Ouvinte): () => void {
    this.ouvintes.add(ouvinte);
    return () => {
      this.ouvintes.delete(ouvinte);
    };
  }

  /**
   * Troca a referência da lista antes de avisar.
   *
   * O painel lê por useSyncExternalStore, que compara referência: mexer
   * dentro de uma tarefa sem trocar o array faz o React concluir que nada
   * mudou, e o log ficaria parado enquanto o trabalho anda.
   */
  private avisar() {
    this.tarefas = [...this.tarefas];
    this.ouvintes.forEach((o) => o());
  }

  listar(): Tarefa[] {
    return this.tarefas;
  }

  rodando(): Tarefa[] {
    return this.tarefas.filter((t) => t.estado === 'rodando');
  }

  abrir(titulo: string, tipo: Tarefa['tipo'], cancelar?: () => void): string {
    const id = `t${(this.contador += 1)}_${Date.now().toString(36)}`;
    this.tarefas = [
      {
        id,
        titulo,
        tipo,
        estado: 'rodando' as const,
        fracao: 0,
        linhas: [],
        inicio: performance.now(),
        cancelar,
      },
      ...this.tarefas,
    ].slice(0, LIMITE_TAREFAS);
    this.avisar();
    return id;
  }

  /** Uma linha nova no log. Repetida em sequência é ignorada. */
  registrar(id: string, texto: string, fracao?: number) {
    const tarefa = this.tarefas.find((t) => t.id === id);
    if (!tarefa || !texto) return;
    if (typeof fracao === 'number') tarefa.fracao = Math.min(1, Math.max(0, fracao));

    if (tarefa.linhas[tarefa.linhas.length - 1]?.texto === texto) {
      this.avisar();
      return;
    }
    tarefa.linhas.push({ texto, em: performance.now() });
    // Mil páginas gerariam mil linhas; o que interessa é o fim.
    if (tarefa.linhas.length > LIMITE_LINHAS) tarefa.linhas = tarefa.linhas.slice(-LIMITE_LINHAS);
    this.avisar();
  }

  fechar(id: string, estado: Exclude<EstadoDaTarefa, 'rodando'>, detalhe?: string) {
    const tarefa = this.tarefas.find((t) => t.id === id);
    if (!tarefa) return;
    tarefa.estado = estado;
    tarefa.fim = performance.now();
    tarefa.detalhe = detalhe;
    tarefa.cancelar = undefined;
    if (estado === 'concluida') tarefa.fracao = 1;
    this.avisar();
  }

  cancelar(id: string) {
    this.tarefas.find((t) => t.id === id)?.cancelar?.();
  }

  /** Cancela tudo que estiver rodando. */
  cancelarTudo() {
    for (const tarefa of this.rodando()) tarefa.cancelar?.();
  }

  /** Tira da lista o que já terminou. O que está rodando fica. */
  limparConcluidas() {
    this.tarefas = this.tarefas.filter((t) => t.estado === 'rodando');
    this.avisar();
  }
}

export const atividade = new RegistroDeAtividade();
