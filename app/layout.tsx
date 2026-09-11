import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://pdf.greencodes.com.br'),
  title: {
    default: 'PDF.GreenCodes: ferramentas de PDF sem upload',
    template: '%s · PDF.GreenCodes',
  },
  description:
    'Comprima, junte, divida e converta PDFs direto no navegador. O arquivo nunca é enviado para um servidor e o resultado é apagado da memória assim que você baixa.',
  applicationName: 'PDF.GreenCodes',
  keywords: ['comprimir pdf', 'juntar pdf', 'dividir pdf', 'pdf para word', 'pdf para jpg', 'pdf sem upload'],
  openGraph: {
    title: 'PDF.GreenCodes: ferramentas de PDF sem upload',
    description: 'Tudo roda no seu navegador. Baixou, apagou.',
    siteName: 'PDF.GreenCodes',
    type: 'website',
    locale: 'pt_BR',
  },
  robots: { index: true, follow: true },
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

/**
 * O canal do aplicativo com o Rust, que só entra no build do Tauri.
 *
 * Sem ele na política, o Tauri não consegue usar o canal de bytes crus e cai
 * no reserva, que passa tudo por JSON: um PDF chegava na tela como a lista de
 * números "37,80,68,70..." e toda ferramenta dizia que aquilo não era PDF. O
 * Tauri define TAURI_ENV_PLATFORM para o build que ele mesmo dispara; o site
 * sai sem isto e continua sem ter para onde mandar um documento.
 */
const CANAL_DO_APLICATIVO = process.env.TAURI_ENV_PLATFORM ? ' ipc: http://ipc.localhost' : '';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <head>
        {/*
          Em saída estática o next.config não manda cabeçalhos HTTP, então a
          política vai na própria página. `frame-ancestors` não vale em meta:
          essa precisa vir do host, e está em public/_headers e vercel.json.
        */}
        <meta
          httpEquiv="Content-Security-Policy"
          content={[
            "default-src 'self'",
            // `unsafe-eval` só em desenvolvimento: sem ele o hot reload não hidrata.
            `script-src 'self' 'unsafe-inline' blob:${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "worker-src 'self' blob:",
            `connect-src 'self' blob: data:${CANAL_DO_APLICATIVO}`,
            // blob: é o PDF que a própria página acabou de gerar, posto num
            // iframe escondido só para chamar a impressão. Nada externo entra.
            "frame-src blob:",
            "manifest-src 'self'",
            "media-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'none'",
          ].join('; ')}
        />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
