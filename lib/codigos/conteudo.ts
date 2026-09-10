/**
 * O que vai dentro do QR Code, montado do jeito que o celular entende.
 *
 * Um QR Code guarda texto e mais nada. O que faz o telefone abrir o WhatsApp
 * em vez de mostrar uma linha de letras é o **formato** desse texto, e cada
 * um tem o seu — alguns viraram norma, outros viraram costume.
 *
 * Escrever isso à mão é onde a gráfica erra: um espaço a mais na rede de
 * wi-fi, um `+55` esquecido no telefone, e o código sai bonito e não faz
 * nada. Aqui cada tipo tem a sua função, e o teste prende o formato.
 *
 * O PIX é o único que não é só juntar texto: ele tem norma do Banco Central,
 * campos de tamanho declarado e um verificador no fim. Está mais abaixo.
 */

export type TipoDeConteudo =
  | 'texto'
  | 'link'
  | 'whatsapp'
  | 'pix'
  | 'wifi'
  | 'telefone'
  | 'email'
  | 'sms'
  | 'contato';

export const TIPOS: Record<TipoDeConteudo, { nome: string; sobre: string }> = {
  link: { nome: 'Link', sobre: 'Abre um endereço no navegador do celular.' },
  whatsapp: { nome: 'WhatsApp', sobre: 'Abre a conversa com o número, já com a mensagem digitada.' },
  pix: { nome: 'PIX', sobre: 'O código de pagamento do Banco Central, com valor e nome de quem recebe.' },
  wifi: { nome: 'Wi-Fi', sobre: 'Conecta na rede sem a pessoa digitar a senha.' },
  telefone: { nome: 'Telefone', sobre: 'Abre o discador com o número pronto.' },
  email: { nome: 'E-mail', sobre: 'Abre o aplicativo de e-mail com assunto e mensagem.' },
  sms: { nome: 'SMS', sobre: 'Abre a mensagem de texto com o número e o recado.' },
  contato: { nome: 'Contato', sobre: 'Salva nome, telefone e e-mail na agenda do celular.' },
  texto: { nome: 'Texto', sobre: 'Só o texto, como você escrever.' },
};

/** Tira tudo que não for dígito. Telefone chega escrito de dez jeitos. */
function soDigitos(valor: string): string {
  return String(valor ?? '').replace(/\D+/g, '');
}

/**
 * O número no formato internacional, sem o `+`.
 *
 * O WhatsApp exige país e DDD. Quem digita "99999-8888" está pensando no
 * telefone da loja, e sem o 55 na frente o link abre uma conversa com um
 * número que não existe.
 */
export function telefoneInternacional(numero: string, paisPadrao = '55'): string {
  const digitos = soDigitos(numero);
  if (!digitos) throw new Error('Escreva o número de telefone.');
  // Já veio com país: 12 ou 13 dígitos no Brasil (55 + DDD + 8 ou 9).
  if (digitos.length >= 12) return digitos;
  if (digitos.length >= 10) return paisPadrao + digitos;
  throw new Error(
    `O número "${numero}" está curto. Escreva com DDD — e o país, se não for do Brasil.`,
  );
}

/** Escapa o que tem significado especial na linha do wi-fi. */
function escaparWifi(valor: string): string {
  return String(valor ?? '').replace(/([\\;,:"])/g, '\\$1');
}

// -------------------------------------------------------------- montagem ---

export type Campos = Record<string, string>;

export function montarConteudo(tipo: TipoDeConteudo, campos: Campos): string {
  switch (tipo) {
    case 'link': {
      const endereco = String(campos.url ?? '').trim();
      if (!endereco) throw new Error('Escreva o endereço do site.');
      // Sem o protocolo, muito leitor trata como texto e não abre nada.
      return /^[a-z][a-z0-9+.-]*:/i.test(endereco) ? endereco : `https://${endereco}`;
    }

    case 'whatsapp': {
      const numero = telefoneInternacional(campos.numero ?? '');
      const mensagem = String(campos.mensagem ?? '').trim();
      return mensagem
        ? `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`
        : `https://wa.me/${numero}`;
    }

    case 'wifi': {
      const rede = String(campos.rede ?? '').trim();
      if (!rede) throw new Error('Escreva o nome da rede (SSID).');
      const seguranca = String(campos.seguranca ?? 'WPA').toUpperCase();
      const senha = String(campos.senha ?? '');
      if (seguranca !== 'NOPASS' && !senha) throw new Error('Escreva a senha da rede.');
      const oculta = campos.oculta === 'true' || campos.oculta === '1';

      const partes = [`S:${escaparWifi(rede)}`, `T:${seguranca === 'NOPASS' ? 'nopass' : seguranca}`];
      if (seguranca !== 'NOPASS') partes.push(`P:${escaparWifi(senha)}`);
      if (oculta) partes.push('H:true');
      return `WIFI:${partes.join(';')};;`;
    }

    case 'telefone':
      return `tel:+${telefoneInternacional(campos.numero ?? '')}`;

    case 'email': {
      const para = String(campos.para ?? '').trim();
      if (!para) throw new Error('Escreva o endereço de e-mail.');
      const consulta = new URLSearchParams();
      if (campos.assunto) consulta.set('subject', String(campos.assunto));
      if (campos.mensagem) consulta.set('body', String(campos.mensagem));
      const cauda = consulta.toString();
      return cauda ? `mailto:${para}?${cauda}` : `mailto:${para}`;
    }

    case 'sms': {
      const numero = telefoneInternacional(campos.numero ?? '');
      const mensagem = String(campos.mensagem ?? '').trim();
      return mensagem ? `SMSTO:+${numero}:${mensagem}` : `SMSTO:+${numero}`;
    }

    case 'contato': {
      const nome = String(campos.nome ?? '').trim();
      if (!nome) throw new Error('Escreva o nome do contato.');
      // vCard 3.0: é o que a agenda do Android e do iPhone lê sem reclamar.
      const linhas = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${nome}`, `N:${nome};;;;`];
      if (campos.empresa) linhas.push(`ORG:${campos.empresa}`);
      if (campos.numero) linhas.push(`TEL;TYPE=CELL:+${telefoneInternacional(campos.numero)}`);
      if (campos.email) linhas.push(`EMAIL:${campos.email}`);
      if (campos.site) linhas.push(`URL:${campos.site}`);
      linhas.push('END:VCARD');
      return linhas.join('\n');
    }

    case 'pix':
      return montarPix({
        chave: String(campos.chave ?? ''),
        nome: String(campos.nome ?? ''),
        cidade: String(campos.cidade ?? ''),
        valor: String(campos.valor ?? ''),
        identificador: String(campos.identificador ?? ''),
      });

    default: {
      const texto = String(campos.texto ?? '').trim();
      if (!texto) throw new Error('Escreva o texto do código.');
      return texto;
    }
  }
}

// ------------------------------------------------------------------ PIX ---

/**
 * O código PIX "copia e cola", que é o mesmo do QR.
 *
 * Segue o padrão EMV que o Banco Central adotou: o texto é uma fila de campos
 * `IDTAMANHOVALOR`, onde o ID tem dois dígitos e o tamanho também. Não há
 * separador — quem lê sabe onde cada campo acaba porque o tamanho vem
 * escrito antes dele.
 *
 * O último campo é um verificador de 4 dígitos, e ele é calculado **incluindo
 * o próprio cabeçalho `6304`**. É a parte que quase todo mundo erra ao montar
 * na mão: sem o `6304` na conta, o código sai com verificador errado, o banco
 * recusa, e nada na tela explica por quê.
 */
export function montarPix(dados: {
  chave: string;
  nome: string;
  cidade: string;
  valor?: string;
  identificador?: string;
}): string {
  const chave = String(dados.chave ?? '').trim();
  if (!chave) throw new Error('Escreva a chave PIX de quem recebe.');

  // Nome e cidade têm teto na norma. Cortar aqui é melhor que o banco
  // recusar o código inteiro depois de impresso.
  const nome = semAcento(String(dados.nome ?? '').trim()).slice(0, 25) || 'RECEBEDOR';
  const cidade = semAcento(String(dados.cidade ?? '').trim()).slice(0, 15) || 'BRASIL';

  const campo = (id: string, valor: string) => `${id}${String(valor.length).padStart(2, '0')}${valor}`;

  // Dentro do campo 26 vão dois: o domínio do arranjo e a chave.
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave);

  let payload =
    campo('00', '01') + // versão do formato
    campo('26', conta) +
    campo('52', '0000') + // categoria do estabelecimento: não informada
    campo('53', '986'); // moeda: real

  const valor = normalizarValor(dados.valor);
  if (valor) payload += campo('54', valor);

  payload +=
    campo('58', 'BR') +
    campo('59', nome) +
    campo('60', cidade) +
    campo('62', campo('05', identificadorValido(dados.identificador)));

  // O verificador entra por último, e a conta inclui o "6304".
  const comCabecalho = `${payload}6304`;
  return comCabecalho + crc16(comCabecalho);
}

/**
 * O valor com ponto e duas casas, ou nada.
 *
 * Vazio é permitido de propósito: é o código em que quem paga digita quanto
 * quer — o caso da vaquinha e da caixinha no balcão.
 */
export function normalizarValor(entrada: unknown): string {
  const texto = String(entrada ?? '').trim();
  if (!texto) return '';
  const numero = Number(texto.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(numero) || numero <= 0) return '';
  return numero.toFixed(2);
}

/**
 * O identificador da cobrança, que volta no extrato de quem recebe.
 *
 * A norma aceita até 25 caracteres, só letras e números. `***` é o valor
 * combinado para "não tem identificador", e é o que a maioria dos bancos
 * usa quando o campo fica vazio.
 */
export function identificadorValido(entrada: unknown): string {
  const limpo = String(entrada ?? '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 25);
  return limpo || '***';
}

/** Tira acento e cedilha: o campo do nome não os aceita em muitos bancos. */
function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase();
}

/**
 * CRC-16/CCITT-FALSE, que é o verificador que a norma pede.
 *
 * Polinômio 0x1021, começando em 0xFFFF, sem inverter bit nenhum. Existe
 * meia dúzia de variantes de CRC-16 por aí e todas devolvem quatro dígitos
 * de aparência igual — usar a errada dá um código que parece certo e o banco
 * recusa. O teste prende esta com um valor conhecido.
 */
export function crc16(texto: string): string {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i += 1) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
