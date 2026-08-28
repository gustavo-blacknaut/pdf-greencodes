'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Eraser, PenLine, Upload } from 'lucide-react';
import { recortarTransparente } from '@/lib/pdf/layout';
import { cx } from '@/lib/utils';

const CORES = ['#12263a', '#1d4ed8', '#111111'];

export function SignaturePad({
  onPronto,
  onCancelar,
}: {
  onPronto: (dataUrl: string, proporcao: number) => void;
  onCancelar: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const [temTraco, setTemTraco] = useState(false);
  const [cor, setCor] = useState(CORES[0]);
  const [espessura, setEspessura] = useState(3);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Resolução interna maior que a exibida: a assinatura entra no PDF com
    // borda limpa em vez de serrilhada.
    const escala = 3;
    canvas.width = canvas.clientWidth * escala;
    canvas.height = canvas.clientHeight * escala;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(escala, escala);
  }, []);

  function posicao(evento: React.PointerEvent<HTMLCanvasElement>) {
    const caixa = evento.currentTarget.getBoundingClientRect();
    return { x: evento.clientX - caixa.left, y: evento.clientY - caixa.top };
  }

  function comecar(evento: React.PointerEvent<HTMLCanvasElement>) {
    evento.currentTarget.setPointerCapture(evento.pointerId);
    desenhando.current = true;
    ultimo.current = posicao(evento);
  }

  function mover(evento: React.PointerEvent<HTMLCanvasElement>) {
    if (!desenhando.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    const atual = posicao(evento);
    if (!ctx || !ultimo.current) return;

    ctx.strokeStyle = cor;
    ctx.lineWidth = espessura;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(ultimo.current.x, ultimo.current.y);
    ctx.lineTo(atual.x, atual.y);
    ctx.stroke();

    ultimo.current = atual;
    if (!temTraco) setTemTraco(true);
  }

  function terminar() {
    desenhando.current = false;
    ultimo.current = null;
  }

  function limpar() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setTemTraco(false);
  }

  function confirmar() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const recorte = recortarTransparente(canvas);
    if (!recorte) return;
    onPronto(recorte.toDataURL('image/png'), recorte.width / recorte.height);
  }

  async function usarImagem(arquivo: File) {
    const bitmap = await createImageBitmap(arquivo);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    onPronto(canvas.toDataURL('image/png'), canvas.width / canvas.height);
  }

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg border bg-elevated text-brand">
          <PenLine className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold tracking-tight">Desenhe sua assinatura</h3>

        <div className="ml-auto flex items-center gap-1.5">
          {CORES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCor(c)}
              aria-label={`Cor ${c}`}
              className={cx('h-6 w-6 rounded-full border-2', cor === c ? 'border-brand' : 'border-transparent')}
              style={{ background: c }}
            />
          ))}
          <input
            type="range"
            min={1}
            max={8}
            value={espessura}
            onChange={(e) => setEspessura(Number(e.target.value))}
            className="ml-2 w-20"
            aria-label="Espessura do traço"
          />
        </div>
      </div>

      <canvas
        ref={canvasRef}
        onPointerDown={comecar}
        onPointerMove={mover}
        onPointerUp={terminar}
        onPointerLeave={terminar}
        className="mt-3 h-40 w-full cursor-crosshair touch-none rounded-xl border-2 border-dashed bg-white"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={confirmar} disabled={!temTraco} className="btn-primary px-4 py-2 text-sm">
          <Check className="h-4 w-4" /> Usar assinatura
        </button>
        <button type="button" onClick={limpar} disabled={!temTraco} className="btn-ghost px-3 py-2 text-sm">
          <Eraser className="h-4 w-4" /> Limpar
        </button>

        <label className="btn-ghost cursor-pointer px-3 py-2 text-sm">
          <Upload className="h-4 w-4" /> Enviar imagem
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => {
              const arquivo = e.target.files?.[0];
              if (arquivo) void usarImagem(arquivo);
              e.target.value = '';
            }}
          />
        </label>

        <button type="button" onClick={onCancelar} className="btn ml-auto px-3 py-2 text-sm text-muted">
          Cancelar
        </button>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        O traço é recortado no contorno, então a assinatura entra no documento sem moldura branca em volta. A imagem
        enviada também fica só no seu navegador.
      </p>
    </div>
  );
}
