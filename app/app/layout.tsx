import { AppBar } from '@/components/AppBar';
import { Warmup } from '@/components/Warmup';

/**
 * Casca do aplicativo de desktop: barra com a marca e a versão, e as
 * ferramentas. Sem as seções de apresentação do site, sem rodapé e sem as
 * cores decorativas por ferramenta — aqui é uma caixa de ferramentas, não
 * uma página de venda.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell flex min-h-screen flex-col">
      <Warmup />
      <AppBar />
      <main className="flex-1">{children}</main>
    </div>
  );
}
