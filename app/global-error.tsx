'use client';

/**
 * Última rede de proteção: pega erros do próprio layout raiz, quando nem o
 * error.tsx normal chega a montar. Precisa trazer html e body porque substitui
 * o documento inteiro.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#070f0b',
          color: '#e7f3eb',
          fontFamily: 'ui-sans-serif, system-ui, Segoe UI, sans-serif',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>O site não conseguiu carregar</h1>
          <p style={{ color: '#859e8f', marginTop: '0.75rem', lineHeight: 1.6 }}>
            Nenhum arquivo seu foi enviado a lugar nenhum. Recarregue a página para tentar de novo.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              padding: '0.7rem 1.2rem',
              borderRadius: '0.75rem',
              border: 'none',
              background: 'linear-gradient(120deg, #34d399, #a3e635)',
              color: '#07150b',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Recarregar
          </button>
        </div>
      </body>
    </html>
  );
}
