import type { Tool } from './tipos';

/**
 * Boleto: ler o código e imprimir a folha.
 *
 * As duas fazem coisas bem diferentes, e a distinção importa. **Ler** tira do
 * código o que já está escrito nele — é aritmética, e nada sai da máquina.
 * **Imprimir** monta a folha a partir de um código que o banco já emitiu, que
 * é serviço de gráfica: carnê e boleto de quem tem convênio bancário.
 *
 * O que nenhuma das duas faz é inventar um código de boleto. Um boleto
 * pagável depende de convênio com banco e de registro na CIP — não existe
 * programa de impressão que resolva isso, e prometer o contrário só ia
 * entregar um papel que o caixa recusa.
 */
export const BOLETO: Tool[] = [
  {
    slug: 'ler-boleto',
    operation: 'read-boleto',
    name: 'Ler boleto',
    tagline: 'Banco, valor e vencimento, do próprio código',
    description:
      'Cole o código de barras ou a linha digitável e veja o que está escrito ali: banco, valor, vencimento, e se os dígitos verificadores fecham. Converte um no outro nos dois sentidos. Tudo por conta, sem consultar nada — o número não sai do seu computador.',
    icon: 'Barcode',
    accent: '5 150 105',
    category: 'Boleto',
    accept: [],
    acceptLabel: 'sem arquivo',
    multiple: false,
    semArquivo: true,
    cta: 'Ler o código',
    fields: [
      {
        key: 'codigo',
        type: 'text',
        label: 'Código de barras ou linha digitável',
        default: '',
        placeholder: '34191.09008 61713.957753 71744.640005 1 84410000002000',
        help: 'Aceita os 44 dígitos do código de barras, ou os 47 (banco) e 48 (concessionária) da linha digitável. Ponto e espaço podem ficar.',
      },
    ],
  },
  {
    slug: 'imprimir-boleto',
    operation: 'boleto-pdf',
    name: 'Boleto para impressão',
    tagline: 'Carnê e segunda via, a partir do código do banco',
    description:
      'Monta a folha imprimível de um boleto que o seu banco já emitiu: desenha o código de barras no padrão da FEBRABAN, com a linha digitável e a área de silêncio que o leitor do caixa exige. Vários códigos, um por linha, viram um carnê com três por folha e o pontilhado de corte.',
    icon: 'ReceiptText',
    accent: '13 148 136',
    category: 'Boleto',
    accept: [],
    acceptLabel: 'sem arquivo',
    multiple: false,
    semArquivo: true,
    cta: 'Montar a folha',
    fields: [
      {
        key: 'codigos',
        type: 'texto-longo',
        label: 'Códigos',
        default: '',
        placeholder: 'um código por linha',
        help: 'Um por linha. Cada um vira uma tira, na ordem em que você colar. Estes códigos vêm do seu banco — o programa não cria boleto, só imprime o que já foi emitido.',
      },
      { key: 'beneficiario', type: 'text', label: 'Beneficiário', default: '', placeholder: 'quem recebe' },
      { key: 'pagador', type: 'text', label: 'Pagador', default: '', placeholder: 'quem paga' },
      {
        key: 'porFolha',
        type: 'select',
        label: 'Por folha',
        default: '3',
        options: [
          { value: '3', label: '3 tiras', hint: 'o carnê comum' },
          { value: '2', label: '2 tiras' },
          { value: '1', label: '1 por folha', hint: 'boleto avulso, com mais espaço' },
        ],
      },
    ],
  },
];
