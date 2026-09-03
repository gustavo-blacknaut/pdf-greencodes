'use strict';

/**
 * Onde os resultados são gravados, e o que se apaga sozinho.
 *
 * Tudo vai para `Downloads/PDF.GreenCodes`. Downloads porque é onde a pessoa
 * já procura arquivo baixado; a subpasta porque a auto-exclusão varre por
 * tempo, e varrer a raiz de Downloads seria apagar coisa que não é nossa.
 *
 * A auto-exclusão é opcional e por arquivo: quem marcou entra num registro
 * com a hora de morrer, e uma varredura periódica apaga o que passou do
 * prazo. O que não foi marcado fica para sempre — é arquivo da pessoa, no
 * computador dela.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

const UM_DIA = 24 * 60 * 60 * 1000;
const INTERVALO_DA_VARREDURA = 60 * 60 * 1000;

class Resultados {
  /**
   * @param {string} pastaDeDownloads onde gravar
   * @param {string} pastaDeDados onde guardar o registro da auto-exclusão
   */
  constructor(pastaDeDownloads, pastaDeDados) {
    this.pasta = path.join(pastaDeDownloads, 'PDF.GreenCodes');
    this.registro = path.join(pastaDeDados, 'auto-exclusao.json');
    this.timer = null;
  }

  async garantirPasta() {
    await fsp.mkdir(this.pasta, { recursive: true });
    return this.pasta;
  }

  /**
   * Grava com o primeiro número livre: 1.pdf, 2.pdf, 3.pdf.
   *
   * Sem diálogo e sem sobrescrever nada. Quem processa vários documentos
   * seguidos não quer decidir nome e pasta a cada um.
   */
  async salvar(nome, bytes, { apagarEm1Dia = false } = {}) {
    await this.garantirPasta();

    const extensao = path.extname(nome) || '.pdf';
    const existentes = new Set(await fsp.readdir(this.pasta));
    let numero = 1;
    while (existentes.has(numero + extensao)) numero += 1;

    const destino = path.join(this.pasta, numero + extensao);
    await fsp.writeFile(destino, Buffer.from(bytes));

    if (apagarEm1Dia) await this.marcarParaApagar(destino);
    return destino;
  }

  async lerRegistro() {
    try {
      const conteudo = JSON.parse(await fsp.readFile(this.registro, 'utf8'));
      return Array.isArray(conteudo) ? conteudo : [];
    } catch {
      // Registro ausente ou corrompido é o mesmo que registro vazio: nada
      // para apagar é sempre a resposta segura.
      return [];
    }
  }

  async gravarRegistro(itens) {
    await fsp.mkdir(path.dirname(this.registro), { recursive: true });
    await fsp.writeFile(this.registro, JSON.stringify(itens, null, 2), 'utf8');
  }

  async marcarParaApagar(caminho, prazoMs = UM_DIA) {
    const itens = (await this.lerRegistro()).filter((item) => item.caminho !== caminho);
    itens.push({ caminho, apagarEm: Date.now() + prazoMs });
    await this.gravarRegistro(itens);
  }

  /** Tira a marca sem apagar o arquivo. */
  async manterParaSempre(caminho) {
    const itens = await this.lerRegistro();
    await this.gravarRegistro(itens.filter((item) => item.caminho !== caminho));
  }

  /**
   * Apaga o que passou do prazo e limpa o registro.
   *
   * Some do registro também o que já não existe — arquivo que a pessoa moveu
   * ou apagou à mão não deveria ficar sendo procurado para sempre.
   */
  async varrer(agora = Date.now()) {
    const itens = await this.lerRegistro();
    if (itens.length === 0) return { apagados: 0, restantes: 0 };

    const ficam = [];
    let apagados = 0;

    for (const item of itens) {
      // Só mexe no que está dentro da nossa pasta: uma entrada estragada não
      // pode virar permissão para apagar arquivo em outro lugar.
      const dentroDaPasta = path.resolve(item.caminho).startsWith(path.resolve(this.pasta) + path.sep);
      if (!dentroDaPasta) continue;

      if (agora < item.apagarEm) {
        // Arquivo que sumiu não precisa continuar no registro.
        try {
          await fsp.access(item.caminho);
          ficam.push(item);
        } catch {
          /* já não existe */
        }
        continue;
      }

      try {
        await fsp.rm(item.caminho, { force: true });
        apagados += 1;
      } catch {
        // Arquivo aberto em outro programa não apaga agora; fica para a
        // próxima varredura em vez de sumir do registro sem ter sido apagado.
        ficam.push(item);
      }
    }

    await this.gravarRegistro(ficam);
    return { apagados, restantes: ficam.length };
  }

  /** Varre agora e de hora em hora enquanto o aplicativo estiver aberto. */
  iniciarVarredura() {
    void this.varrer();
    this.timer = setInterval(() => void this.varrer(), INTERVALO_DA_VARREDURA);
    // Sem isto o intervalo seguraria o processo vivo ao fechar a janela.
    if (this.timer.unref) this.timer.unref();
  }

  pararVarredura() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { Resultados, UM_DIA };
