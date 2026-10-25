import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import type { Staff } from '../lib/types';

export function Avatar({ person, size = 36 }: { person: Staff; size?: number }) {
  const [failed, setFailed] = useState(false);
  return <span className="avatar" style={{ width: size, height: size, backgroundColor: `${person.color}22`, color: person.color }}>
    {failed ? person.name.split(' ').map(n => n[0]).join('') : <img src={person.image} alt={person.name} onError={() => setFailed(true)} />}
  </span>;
}
export function Badge({ children, tone = 'muted', dot = false }: { children: ReactNode; tone?: string; dot?: boolean }) {
  return <span className={`badge ${tone}`}>{dot && <i />}{children}</span>;
}
export const statusTone = (status: string) => status === 'Authorized' ? 'green' : status === 'Staff assigned' ? 'cyan' : status === 'Not authorized' ? 'rose' : 'amber';

export function Modal({ children, onClose, title, wide = false }: { children: ReactNode; onClose: () => void; title: string; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); }
      if (e.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handle);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', handle); previous?.focus(); };
  }, []);
  return createPortal(<div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
      {children}
    </div>
  </div>, document.body);
}
export function ModalHeader({ eyebrow, title, onClose, children }: { eyebrow?: string; title: string; onClose: () => void; children?: ReactNode }) {
  return <div className="modal-header"><div>{eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}<h2>{title}</h2>{children}</div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div>;
}
export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="empty"><div className="empty-icon"><Check size={22} /></div><h3>{title}</h3><p>{text}</p>{action}</div>;
}
export function Sparkline({ values, color = '#34d399', id }: { values: number[]; color?: string; id: string }) {
  const max = Math.max(...values), min = Math.min(...values) - 2;
  const points = values.map((n, i) => `${i * 104 / (values.length - 1)},${34 - ((n - min) / (max - min || 1)) * 28}`).join(' ');
  return <svg viewBox="0 0 104 40" className="sparkline" aria-hidden="true"><defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".14" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs><polygon points={`0,40 ${points} 104,40`} fill={`url(#${id})`} /><polyline points={points} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
