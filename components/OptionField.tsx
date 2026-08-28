'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { Field } from '@/lib/tools';
import { cx } from '@/lib/utils';

type Value = string | number | boolean;

function PasswordField({
  field,
  value,
  onChange,
}: {
  field: Extract<Field, { type: 'password' }>;
  value: string;
  onChange: (value: Value) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label className="field-label" htmlFor={`f-${field.key}`}>
        {field.label}
      </label>
      <div className="relative mt-2">
        <input
          id={`f-${field.key}`}
          type={visible ? 'text' : 'password'}
          className="input pr-11"
          autoComplete="off"
          spellCheck={false}
          placeholder={field.placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted transition hover:text-ink"
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {field.help && <p className="mt-2 text-xs leading-relaxed text-muted">{field.help}</p>}
    </div>
  );
}

export function OptionField({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: Value;
  onChange: (value: Value) => void;
}) {
  if (field.type === 'select') {
    return (
      <div>
        <span className="field-label">{field.label}</span>
        <div className="mt-2 grid gap-1.5">
          {field.options.map((option) => {
            const active = String(value) === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange(option.value)}
                className={cx(
                  'flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition',
                  active ? 'border-brand bg-brand/10' : 'hover:border-brand/40 hover:bg-elevated',
                )}
              >
                <span
                  className={cx(
                    'grid h-4 w-4 shrink-0 place-items-center rounded-full border transition',
                    active ? 'border-brand' : 'border-line',
                  )}
                >
                  {active && <span className="h-2 w-2 rounded-full bg-brand" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{option.label}</span>
                  {option.hint && <span className="block text-xs text-muted">{option.hint}</span>}
                </span>
              </button>
            );
          })}
        </div>
        {field.help && <p className="mt-2 text-xs leading-relaxed text-muted">{field.help}</p>}
      </div>
    );
  }

  if (field.type === 'toggle') {
    const active = value === true || value === 'true';
    return (
      // O botão inteiro é o controle, texto incluído. Nada de <label> por fora:
      // o label reemite o clique no botão e o toggle alterna duas vezes.
      <button
        type="button"
        role="switch"
        aria-checked={active}
        onClick={() => onChange(!active)}
        className="flex w-full items-start justify-between gap-4 text-left"
      >
        <span>
          <span className="field-label">{field.label}</span>
          {field.help && <span className="mt-1 block text-xs text-muted">{field.help}</span>}
        </span>

        <span
          className={cx(
            'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-150',
            active ? 'bg-brand' : 'bg-line',
          )}
        >
          {/* A bolinha muda de lugar sem transição de propósito. Transições de
              posição ficam presas no meio quando o navegador para de compor
              frames (aba em segundo plano), e aí o toggle mostra um estado que
              não é o real. Posição instantânea nunca mente. */}
          <span
            className={cx(
              'absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm',
              active ? 'left-6' : 'left-1',
            )}
          />
        </span>
      </button>
    );
  }

  if (field.type === 'range') {
    const numeric = Number(value);
    const display = field.step && field.step < 1 ? `${Math.round(numeric * 100)}%` : `${numeric}${field.unit ?? ''}`;
    return (
      <div>
        <div className="flex items-baseline justify-between">
          <span className="field-label">{field.label}</span>
          <span className="text-xs font-medium tabular-nums text-brand">{display}</span>
        </div>
        <input
          type="range"
          className="mt-3"
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          value={numeric}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {field.help && <p className="mt-2 text-xs text-muted">{field.help}</p>}
      </div>
    );
  }

  if (field.type === 'number') {
    return (
      <div>
        <label className="field-label" htmlFor={`f-${field.key}`}>
          {field.label}
        </label>
        <input
          id={`f-${field.key}`}
          type="number"
          className="input mt-2"
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          value={String(value)}
          onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        />
        {field.help && <p className="mt-2 text-xs text-muted">{field.help}</p>}
      </div>
    );
  }

  if (field.type === 'password') {
    return <PasswordField field={field} value={String(value)} onChange={onChange} />;
  }

  return (
    <div>
      <label className="field-label" htmlFor={`f-${field.key}`}>
        {field.label}
      </label>
      <input
        id={`f-${field.key}`}
        type="text"
        className="input mt-2"
        placeholder={field.placeholder}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
      />
      {field.help && <p className="mt-2 text-xs leading-relaxed text-muted">{field.help}</p>}
    </div>
  );
}
