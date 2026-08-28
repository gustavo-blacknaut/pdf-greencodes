'use client';

import { useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';

/**
 * Campo de senha que aparece embaixo de um arquivo protegido.
 *
 * Fica ao lado do arquivo de propósito: com vários arquivos na fila, um diálogo
 * central não deixaria claro de qual deles é a senha pedida. A senha digitada
 * vive só na memória desta aba e nunca é gravada em lugar nenhum.
 */
export function DesbloquearArquivo({
  nomeDoArquivo,
  onDesbloquear,
}: {
  nomeDoArquivo: string;
  onDesbloquear: (senha: string) => Promise<void>;
}) {
  const [senha, setSenha] = useState('');
  const [visivel, setVisivel] = useState(false);
  const [tentando, setTentando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!senha || tentando) return;

    setTentando(true);
    setErro(null);
    try {
      await onDesbloquear(senha);
      setSenha('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir com essa senha.');
    } finally {
      setTentando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="mt-2.5 border-t pt-2.5">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            type={visivel ? 'text' : 'password'}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Senha para abrir este arquivo"
            aria-label={`Senha de ${nomeDoArquivo}`}
            autoComplete="off"
            spellCheck={false}
            className="input py-2 pl-9 pr-9 text-sm"
          />
          <button
            type="button"
            onClick={() => setVisivel((v) => !v)}
            className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-muted transition hover:text-ink"
            aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
          >
            {visivel ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>

        <button type="submit" disabled={!senha || tentando} className="btn-primary shrink-0 px-3 py-2 text-xs">
          {tentando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Destravar
        </button>
      </div>

      {erro ? (
        <p className="mt-1.5 text-xs text-rose-500">{erro}</p>
      ) : (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          A senha não sai desta aba. O arquivo final é entregue sem ela.
        </p>
      )}
    </form>
  );
}
