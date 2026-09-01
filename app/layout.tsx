import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { Warmup } from '@/components/Warmup';

export const metadata: Metadata = {
  metadataBase: new URL('https://greencodes.local'),
  title: {
    default: 'PDF GreenCodes: ferramentas de PDF que não guardam nada',
    template: '%s · GreenCodes',
  },
  description:
    'Comprima, junte, divida e converta PDFs direto no navegador. O arquivo nunca é enviado para um servidor e o resultado é apagado da memória assim que você baixa.',
  applicationName: 'GreenCodes',
  keywords: ['comprimir pdf', 'juntar pdf', 'dividir pdf', 'pdf para jpg', 'pdf privado', 'sem upload'],
  openGraph: {
    title: 'PDF GreenCodes: ferramentas de PDF que não guardam nada',
    description: 'Tudo roda no seu navegador. Baixou, apagou.',
    siteName: 'GreenCodes',
    type: 'website',
    locale: 'pt_BR',
  },
  robots: { index: true, follow: true },
  // Sem referrer, sem descoberta automática de endereços dentro do documento.
  referrer: 'no-referrer',
  formatDetection: { telephone: false, email: false, address: false },
  icons: {
    icon: '/logo.ico',
    shortcut: '/logo.ico',
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#070f0b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <head>
        {/*
          Em saída estática o next.config não manda cabeçalhos HTTP, então a
          política vai na própria página e viaja junto com o arquivo. Isso cobre
          o essencial mesmo se o host for esquecido de configurar.
          `frame-ancestors` não funciona em meta: essa precisa vir do host, e
          está pronta em public/_headers e vercel.json.
        */}
        <meta
          httpEquiv="Content-Security-Policy"
          content={[
            "default-src 'self'",
            // `unsafe-eval` só em desenvolvimento: o hot reload do Next depende
            // dele, e sem isso a página nem hidrata. O build estático sai sem.
            `script-src 'self' 'unsafe-inline' blob:${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "worker-src 'self' blob:",
            "connect-src 'self' blob: data:",
            "frame-src 'none'",
            "manifest-src 'self'",
            "media-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'none'",
          ].join('; ')}
        />
      </head>
      <body className="font-sans antialiased">
        <div className="aurora" aria-hidden />
        <Warmup />
        <div className="flex min-h-screen flex-col">
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
