import Link from 'next/link';
import { ArrowRight, CloudOff, Gauge, Layers, Timer, WifiOff } from 'lucide-react';
import { ToolGrid } from '@/components/ToolGrid';
import { TOOLS } from '@/lib/tools';

export default function HomePage() {
  return (
    <>
      <section className="somente-site mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <span className="chip animate-fade-up border-brand/30 text-brand">
            <CloudOff className="h-3.5 w-3.5" /> Seu PDF nunca sai do seu computador
          </span>

          <h1
            className="mt-6 animate-fade-up text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl"
            style={{ animationDelay: '60ms' }}
          >
            Todas as ferramentas de PDF.
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: 'linear-gradient(100deg, rgb(var(--brand)), rgb(var(--brand2)))' }}
            >
              Zero upload.
            </span>
          </h1>

          <p
            className="mx-auto mt-6 max-w-xl animate-fade-up text-base leading-relaxed text-muted sm:text-lg"
            style={{ animationDelay: '120ms' }}
          >
            Comprimir, juntar, dividir, assinar, editar, converter. Tudo acontece dentro do seu navegador. Sem fila,
            sem conta e sem servidor guardando cópia. Baixou, apagou.
          </p>

          <div
            className="mt-9 flex animate-fade-up flex-wrap items-center justify-center gap-3"
            style={{ animationDelay: '180ms' }}
          >
            <Link href="/comprimir-pdf" className="btn-primary px-6 py-3 text-[15px]">
              Comprimir um PDF <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="#ferramentas" className="btn-ghost px-6 py-3 text-[15px]">
              Ver as {TOOLS.length} ferramentas
            </Link>
          </div>

          <dl
            className="mx-auto mt-14 grid max-w-2xl animate-fade-up grid-cols-2 gap-6 sm:grid-cols-4"
            style={{ animationDelay: '240ms' }}
          >
            {[
              { icon: Gauge, value: '0 ms', label: 'de espera em fila' },
              { icon: Layers, value: String(TOOLS.length), label: 'ferramentas' },
              { icon: Timer, value: '10 min', label: 'de vida do resultado' },
              { icon: WifiOff, value: '0 KB', label: 'enviados à rede' },
            ].map((stat) => (
              <div key={stat.label}>
                <stat.icon className="mx-auto h-4 w-4 text-brand" strokeWidth={1.75} />
                <dt className="mt-2 text-xl font-semibold tabular-nums tracking-tight">{stat.value}</dt>
                <dd className="text-xs text-muted">{stat.label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <ToolGrid />

      <section id="como-funciona" className="somente-site mx-auto mt-28 max-w-6xl scroll-mt-24 px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Como funciona</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">
            A diferença para os sites tradicionais é onde a conta é feita. Aqui o processamento acontece na sua
            máquina. Por isso é mais rápido, e por isso não existe nada para vazar.
          </p>
        </div>

        <ol className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            {
              step: '01',
              title: 'O motor carrega antes de você precisar',
              body: 'Assim que a página abre e o navegador fica ocioso, as bibliotecas de PDF já são baixadas em segundo plano. Quando você escolhe a ferramenta, ela abre instantânea.',
            },
            {
              step: '02',
              title: 'O arquivo é lido, não enviado',
              body: 'Ao soltar o PDF, ele é aberto na memória da aba: contamos as páginas e geramos a miniatura enquanto você ajusta as opções. Nenhum byte vai para a rede.',
            },
            {
              step: '03',
              title: 'Baixou, apagou',
              body: 'O resultado fica na memória por até 10 minutos, com contador visível. Pediu a segunda cópia, saiu da página ou o tempo acabou: ele é descartado na hora.',
            },
          ].map((item) => (
            <li key={item.step} className="card p-6">
              <span className="text-xs font-semibold tabular-nums text-brand">{item.step}</span>
              <h3 className="mt-3 text-[15px] font-semibold tracking-tight">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="somente-site mx-auto mt-28 max-w-6xl px-4 sm:px-6">
        <div
          className="card overflow-hidden p-8 text-center sm:p-14"
          style={{
            backgroundImage:
              'linear-gradient(135deg, rgb(var(--brand) / 0.12), transparent 55%, rgb(var(--brand2) / 0.1))',
          }}
        >
          <h2 className="mx-auto max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">
            Contrato honesto sobre seus documentos
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-muted sm:text-base">
            Não temos servidor de arquivos, não temos banco de dados de uploads e não temos como ler o que você
            processa, mesmo se quiséssemos. É consequência da arquitetura, não uma promessa.
          </p>
          <Link href="/privacidade" className="btn-ghost mt-7">
            Ler os detalhes técnicos <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </>
  );
}
