/**
 * Módulo vazio de propósito.
 *
 * O pdfjs-dist tem uma dependência opcional do pacote `canvas`, que só existe
 * no Node. No navegador ela nunca é usada, mas o empacotador tenta resolver
 * assim mesmo. Apontar para cá silencia isso sem incluir nada no pacote.
 */
export default {};
