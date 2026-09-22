import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY } from '../content/glossary';

/** A glossary term: dotted underline, definition on hover, focus or tap. */
export function Term({ id, children, fresh }: { id: string; children: React.ReactNode; fresh?: boolean }) {
  const entry = GLOSSARY[id];
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const tipId = useId();

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = 300;
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 8;
    const top = below + 120 > window.innerHeight ? r.top - 8 - 110 : below;
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (btn.current && !btn.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  if (!entry) return <>{children}</>;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={'term' + (fresh ? ' is-new' : '')}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children}
      </button>
      {open && pos &&
        createPortal(
          <div role="tooltip" id={tipId} className="popover" style={{ left: pos.left, top: pos.top, width: 300 }}>
            <strong>{entry.term}</strong>
            {entry.def}
          </div>,
          document.body,
        )}
    </>
  );
}

const RE = /\[\[([a-z0-9]+)\|([^\]]+)\]\]/g;

/** Render copy with [[termId|text]] glossary markup. */
export function RichText({ text, fresh = true }: { text: string; fresh?: boolean }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  RE.lastIndex = 0;
  let k = 0;
  while ((m = RE.exec(text))) {
    if (m.index > last) parts.push(<Fragment key={k++}>{text.slice(last, m.index)}</Fragment>);
    parts.push(
      <Term key={k++} id={m[1]} fresh={fresh}>
        {m[2]}
      </Term>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
  return <>{parts}</>;
}

/** Plain text without markup (for aria labels and announcements). */
export function plain(text: string): string {
  return text.replace(RE, (_, __, t) => t);
}
