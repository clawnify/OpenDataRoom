// The shared vocabulary. Chips are facts; badges are signals — the two are
// deliberately different shapes so a glance tells you which you're reading.

import type { ReactNode } from "react";
import { MobileNav } from "./mobile-nav";

export function Eyebrow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="eyebrow">{children}</span>
      {right ? <span className="data text-[0.6875rem] text-faint">{right}</span> : null}
    </div>
  );
}

/** A card is anatomy, not a padded box: stacked zones split by hairlines. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-border bg-surface ${className}`}>{children}</div>;
}

export function Zone({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`border-b border-border p-4 last:border-b-0 ${className}`}>{children}</div>;
}

/** Enumerable fact — file type, page count, gate settings. Quiet by design. */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-border bg-sunken px-1.5 py-0.5 text-[0.6875rem] text-muted">
      {children}
    </span>
  );
}

type Tone = "success" | "warning" | "danger" | "neutral";

const TONES: Record<Tone, string> = {
  success: "bg-success-tint text-success border-success/25",
  warning: "bg-warning-tint text-warning border-warning/25",
  danger: "bg-danger-tint text-danger border-danger/25",
  neutral: "bg-sunken text-muted border-border",
};

/** Status that wants attention. Pill-shaped, normal weight — quiet, not bold. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-normal ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  type = "button",
  title,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  className?: string;
}) {
  // shrink-0 + whitespace-nowrap: a button label must never wrap — in a fixed
  // height toolbar a wrapped label overflows the row.
  const base =
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-2 h-8 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";
  const variants = {
    // Darkens on hover, never lightens. Exactly one of these per screen.
    primary: "bg-primary text-on-primary hover:bg-primary-hover",
    secondary: "border border-border bg-surface text-foreground hover:bg-sunken",
    ghost: "text-muted hover:bg-sunken hover:text-foreground",
    danger: "border border-border bg-surface text-danger hover:bg-danger-tint",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-9 w-full rounded-sm border border-border bg-surface px-2.5 text-[0.8125rem] text-foreground placeholder:text-faint focus:border-ring focus:outline-none ${props.className ?? ""}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-sm border border-border bg-surface px-2.5 py-2 text-[0.8125rem] text-foreground placeholder:text-faint focus:border-ring focus:outline-none ${props.className ?? ""}`}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold tracking-[0.04em] text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[0.6875rem] text-faint">{hint}</span> : null}
    </label>
  );
}

/** Settings toggle. Labeled for the ON state, never the negative. */
export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-1">
      <span>
        <span className="block text-sm text-foreground">{label}</span>
        {hint ? <span className="block text-[0.6875rem] text-faint">{hint}</span> : null}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="block h-5 w-9 rounded-full bg-sunken border border-border transition-colors peer-checked:bg-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-ring" />
        <span className="absolute left-0.5 top-0.5 size-4 rounded-full bg-surface border border-border transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

/**
 * Borderless by design: an empty bordered box reads as a component that failed
 * to load. The border earns its place once there is something to contain.
 */
export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm text-muted">{title}</p>
      {hint ? <p className="mt-1 text-xs text-faint">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Toolbar({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    // h-14 matches the sidebar brand row so the two bottom borders form one
    // unbroken line. Never height this from padding — it drifts the moment a
    // page has no subtitle.
    <div className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b border-border bg-background px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-1">
        <MobileNav />
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold tracking-[-0.01em]">{title}</h1>
        {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
      </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** View switcher: sunken track, active segment is a RAISED WHITE pill — never an ink fill. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex rounded-lg bg-sunken p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-sm px-3 h-7 text-sm font-medium transition-colors ${
            o.value === value
              ? "bg-surface text-foreground border border-border shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
              : "text-muted hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** KPI: data-lg value + fixed-height meta line so toggling state never shifts layout. */
export function Stat({ label, value, meta }: { label: string; value: ReactNode; meta?: ReactNode }) {
  return (
    <div>
      <span className="eyebrow">{label}</span>
      <div className="data mt-1 text-2xl font-bold leading-tight">{value}</div>
      <div className="data h-4 text-[0.6875rem] text-muted">{meta ?? ""}</div>
    </div>
  );
}

/** Completion ring — the data hue carries the value; the number is ink. */
export function CompletionRing({ fraction }: { fraction: number }) {
  const pct = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <span className="inline-flex items-center gap-1.5" title={`Read ${pct}% of the document`}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r={r} fill="none" stroke="var(--border)" strokeWidth="2.5" />
        <circle
          cx="11"
          cy="11"
          r={r}
          fill="none"
          stroke="var(--chart)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          transform="rotate(-90 11 11)"
        />
      </svg>
      <span className="data text-[0.8125rem]">{pct}%</span>
    </span>
  );
}

/** Destructive confirm. The confirm button repeats the consequence — never "OK". */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="p-5 text-sm text-muted">{body}</div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="danger"
          onClick={async () => {
            await onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    // The OVERLAY is the scroll container. A dialog taller than the viewport
    // must never be hard-centered by the overlay (that clips its top AND
    // bottom with no way to reach either) — `min-h-full` + `items-center`
    // centers short dialogs while a tall one starts at the top and the
    // overlay scrolls.
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/30" onClick={onClose}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="w-full max-w-md rounded-xl border border-border bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
