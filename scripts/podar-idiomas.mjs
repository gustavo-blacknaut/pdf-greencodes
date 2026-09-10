/**
 * Tira do instalador os idiomas do Chromium que ninguém vai ler.
 *
 * O Electron embute 55 arquivos de tradução da interface do Chromium — todos
 * os menus de contexto, diálogos de impressão e mensagens de erro, em 55
 * línguas. São **41 MB**, e o programa é em português.
 *
 * Ficam dois:
 *
 * - `pt-BR`, que é o do programa;
 * - `en-US`, que é o retorno do Chromium quando um texto não existe na
 *   tradução escolhida. Sem ele, uma mensagem sem tradução sai em branco em
 *   vez de sair em inglês — e mensagem em branco num diálogo de impressão é
 *   pior que mensagem em inglês.
 *
 * Medido: 41 MB viram 1 MB.
 *
 * Roda como `afterPack` do electron-builder, depois de a pasta estar montada
 * e antes de o instalador ser fechado.
 */

import { readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

/** As traduções que ficam. */
const FICAM = new Set(['pt-BR.pak', 'en-US.pak']);

export default async function podarIdiomas(contexto) {
  const pasta = path.join(contexto.appOutDir, 'locales');

  let arquivos;
  try {
    arquivos = readdirSync(pasta);
  } catch {
    // Nem toda plataforma tem essa pasta. Não é motivo para o build parar.
    console.log('  [idiomas] não achei a pasta locales; nada a podar');
    return;
  }

  let removidos = 0;
  let bytes = 0;

  for (const nome of arquivos) {
    if (!nome.endsWith('.pak') || FICAM.has(nome)) continue;
    const caminho = path.join(pasta, nome);
    bytes += statSync(caminho).size;
    rmSync(caminho);
    removidos += 1;
  }

  const sobraram = readdirSync(pasta).filter((n) => n.endsWith('.pak'));
  console.log(
    `  [idiomas] ${removidos} traduções removidas (${(bytes / 1048576).toFixed(1)} MB); ` +
      `ficaram: ${sobraram.join(', ')}`,
  );

  // Se a poda comeu o que não devia, o programa sobe com a interface do
  // Chromium em branco. Melhor quebrar o build agora que descobrir depois.
  for (const obrigatorio of FICAM) {
    if (!sobraram.includes(obrigatorio)) {
      throw new Error(`a poda removeu ${obrigatorio}, que precisa ficar`);
    }
  }
}
