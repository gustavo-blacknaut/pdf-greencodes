import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Privacidade',
  description:
    'Como o PDF GreenCodes trata seus arquivos: processamento local no navegador, nenhum upload e descarte do resultado após o download.',
};

const SECTIONS = [
  {
    title: 'Onde o arquivo é processado',
    body: [
      'Ao soltar um PDF, o navegador lê os bytes com a File API e mantém tudo na memória da aba. Nenhuma requisição de rede carrega o conteúdo do arquivo, porque não existe endpoint de upload neste site.',
      'A compressão, a divisão, a assinatura, a conversão e todo o resto rodam com pdf-lib e pdf.js compilados para o navegador. O servidor entrega apenas HTML, CSS e JavaScript.',
    ],
  },
  {
    title: 'Quanto tempo o resultado existe',
    body: [
      'O arquivo gerado vira um Blob guardado num cofre em memória com prazo de 10 minutos, exibido em um contador na tela.',
      'O primeiro download preserva a cópia, porque é comum o navegador perguntar onde salvar ou a pessoa precisar do arquivo de novo. O botão então vira "Baixar de novo": esse segundo download entrega mais uma cópia e apaga a da memória na hora.',
      'O descarte também acontece quando o prazo vence, quando você clica em "Apagar agora", quando troca de ferramenta ou quando fecha a aba. O cofre revoga as URLs e solta a referência dos Blobs, e o coletor de lixo do navegador recolhe os bytes.',
    ],
  },
  {
    title: 'O que fica salvo no seu navegador',
    body: [
      'Apenas a sua preferência de tema (claro ou escuro), em localStorage. Nada de arquivos, nomes de arquivo ou histórico de uso.',
    ],
  },
  {
    title: 'Rastreamento e terceiros',
    body: [
      'Zero. Sem analytics, sem pixels, sem contadores de uso, sem cookies, sem fontes externas e sem CDN. Usamos apenas a fonte que já está instalada no seu sistema, e a telemetria do framework está desligada.',
      'O site não tem servidor de aplicação: são arquivos estáticos. Depois que a página carrega, ela não faz mais nenhuma requisição, e a política de segurança de conteúdo bloqueia conexões para fora da própria origem. Mesmo que um script malicioso conseguisse rodar aqui, não teria para onde enviar o seu documento.',
    ],
  },
  {
    title: 'Senhas',
    body: [
      'A senha digitada em Proteger PDF e Desbloquear PDF fica em memória apenas durante a operação. Ela não vai para o localStorage, não entra em nenhuma URL, não é preenchida automaticamente e não sai da aba.',
      'Como a criptografia acontece aqui, não existe cópia da senha em lugar nenhum: se você esquecê-la, o arquivo é irrecuperável, inclusive para nós.',
    ],
  },
  {
    title: 'Limites contra arquivos hostis',
    body: [
      'Antes de qualquer leitura, conferimos o conteúdo do arquivo e não a extensão: um .pdf que não começa com a assinatura de PDF é recusado sem chegar ao interpretador.',
      'Há teto de tamanho por arquivo e por fila, teto de tempo por operação e um botão de cancelar sempre disponível. O interpretador roda com execução dinâmica de código desativada.',
      'Nada disso torna a leitura de um PDF hostil impossível de explorar. São camadas que reduzem a superfície e limitam o estrago, e vale desconfiar de qualquer site que prometa proteção total nessa área.',
    ],
  },
  {
    title: 'Limites de ser local',
    body: [
      'Arquivos muito grandes dependem da memória disponível do seu dispositivo. Um PDF de centenas de megabytes pode pesar em celulares antigos.',
      'PDFs protegidos por senha de abertura não podem ser lidos sem a senha, e não quebramos proteção.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-8 pt-14 sm:px-6">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>

      <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">Privacidade, em termos técnicos</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-muted">
        A frase &ldquo;não guardamos seus arquivos&rdquo; é fácil de escrever e difícil de verificar. Por isso o PDF
        GreenCodes foi construído de um jeito em que guardar seria impossível: o servidor nunca recebe o documento.
      </p>

      <div className="mt-12 space-y-10">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="text-lg font-semibold tracking-tight">{section.title}</h2>
            <div className="mt-3 space-y-3">
              {section.body.map((paragraph) => (
                <p key={paragraph} className="text-sm leading-relaxed text-muted">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="card mt-14 p-6">
        <p className="text-sm leading-relaxed text-muted">
          Quer conferir? Abra as ferramentas de desenvolvedor do navegador, vá até a aba <strong>Rede</strong> e
          processe um arquivo. Você não verá nenhuma requisição carregando o seu PDF, só os scripts do próprio site.
        </p>
      </div>
    </div>
  );
}
