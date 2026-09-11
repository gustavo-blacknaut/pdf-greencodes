/**
 * O aplicativo para Windows, do ponto de vista do site: onde baixar e o que
 * ele tem a mais.
 *
 * O instalador vem da última release do GitHub por um nome fixo. O Tauri
 * põe a versão no nome do arquivo (PDF.GreenCodes_4.0.0_x64-setup.exe), e um
 * link com a versão quebraria a cada release nova; por isso cada release leva
 * também uma cópia com o nome sem versão, que é a que o `latest/download`
 * encontra. Quem publica é o `npm run publicar-app`.
 */

export const REPOSITORIO_DO_APLICATIVO = 'gustavo-blacknaut/pdf-greencodes-app';

export const NOME_DO_INSTALADOR = 'PDF.GreenCodes-Setup.exe';

export const LINK_DO_INSTALADOR = `https://github.com/${REPOSITORIO_DO_APLICATIVO}/releases/latest/download/${NOME_DO_INSTALADOR}`;

export const PAGINA_DAS_VERSOES = `https://github.com/${REPOSITORIO_DO_APLICATIVO}/releases/latest`;

/** Até quanto o aplicativo abre, por arquivo — dito uma vez só para o site inteiro. */
export const LIMITE_DO_APLICATIVO = '2 GB';

/**
 * Quanto o motor do aplicativo ganha do navegador, medido.
 *
 * No mesmo PDF de 300 páginas, serviço completo — abrir, trabalhar e gravar —,
 * na mesma máquina. É o README que conta a medição. Só entram as operações
 * que o aplicativo manda para o motor Python; nas outras os dois lados rodam
 * o mesmo código, e prometer velocidade ali seria mentira.
 */
export const GANHO_MEDIDO: Partial<Record<string, number>> = {
  crop: 16.5,
  split: 13.2,
  'page-numbers': 9.6,
  resize: 9.3,
  reverse: 9.1,
  watermark: 9.0,
  'n-up': 8.2,
  // Rasterizar página: 1189 ms no pdf.js contra 277 ms no PyMuPDF.
  'pdf-to-images': 4.3,
  compress: 4.3,
};
