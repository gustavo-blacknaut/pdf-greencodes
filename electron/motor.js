'use strict';

/**
 * Conversa com o motor de PDF em Python.
 *
 * Um processo só, vivo enquanto o aplicativo estiver aberto. Abrir um por
 * trabalho custaria uns 300 ms de importação do PyMuPDF toda vez, o que
 * apareceria na tela em qualquer operação curta.
 *
 * O protocolo é uma linha de JSON por mensagem: o pedido entra pelo stdin, a
 * resposta e o andamento saem pelo stdout. Escolhi linha em vez de um servidor
 * HTTP porque o motor morre junto com o aplicativo, sem porta aberta na
 * máquina e sem ninguém de fora conseguindo falar com ele.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

class Motor {
  constructor(raiz) {
    this.raiz = raiz;
    this.processo = null;
    this.pendentes = new Map();
    this.proximoId = 1;
    this.ultimoErro = '';
    this.aoAndar = () => {};
  }

  caminhos() {
    return {
      // pythonw não abre janela de console: python.exe pisca uma janela preta
      // a cada operação.
      python: path.join(this.raiz, 'motor', 'runtime', 'pythonw.exe'),
      script: path.join(this.raiz, 'motor', 'principal.py'),
    };
  }

  ligar() {
    if (this.processo && !this.processo.killed) return;

    const { python, script } = this.caminhos();
    this.processo = spawn(python, [script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

    readline.createInterface({ input: this.processo.stdout }).on('line', (linha) => this.receber(linha));

    this.ultimoErro = '';
    this.processo.stderr.on('data', (dados) => {
      this.ultimoErro = String(dados).slice(-2000);
    });

    this.processo.on('exit', (codigo) => {
      const motivo = this.ultimoErro || `o motor encerrou com codigo ${codigo}`;
      for (const [, pendente] of this.pendentes) pendente.falhar(new Error(motivo));
      this.pendentes.clear();
      this.processo = null;
    });

    this.processo.on('error', (erro) => {
      for (const [, pendente] of this.pendentes) pendente.falhar(erro);
      this.pendentes.clear();
      this.processo = null;
    });
  }

  receber(linha) {
    let mensagem;
    try {
      mensagem = JSON.parse(linha);
    } catch {
      return;
    }

    const pendente = this.pendentes.get(mensagem.id);
    if (!pendente) return;

    if (mensagem.tipo === 'andamento') {
      this.aoAndar({ id: mensagem.id, fracao: mensagem.fracao, mensagem: mensagem.mensagem });
      return;
    }

    this.pendentes.delete(mensagem.id);
    if (mensagem.tipo === 'erro') {
      const erro = new Error(mensagem.erro);
      erro.classe = mensagem.classe;
      pendente.falhar(erro);
      return;
    }
    pendente.cumprir(mensagem.dados || {});
  }

  executar(acao, { arquivos = [], opcoes = {}, senhas = [], saida = '' } = {}) {
    this.ligar();

    const id = String(this.proximoId++);
    const espera = new Promise((cumprir, falhar) => {
      this.pendentes.set(id, { cumprir, falhar });
    });

    this.processo.stdin.write(`${JSON.stringify({ id, acao, arquivos, opcoes, senhas, saida })}\n`);
    return { id, espera };
  }

  /**
   * Derruba o motor no meio do trabalho.
   *
   * Não há como cancelar só um trabalho: o motor atende um de cada vez, e
   * matar o processo é o único jeito de parar um desenho de mil páginas na
   * hora. O próximo pedido sobe outro processo.
   */
  cancelar() {
    if (!this.processo) return false;
    this.processo.kill();
    return true;
  }

  desligar() {
    if (this.processo) this.processo.kill();
    this.processo = null;
  }
}

module.exports = { Motor };
