import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { Warmup } from '@/components/Warmup';

/** Casca do site. O aplicativo usa a de `app/app`, que só tem as ferramentas. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="aurora" aria-hidden />
      <Warmup />
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </div>
    </>
  );
}
