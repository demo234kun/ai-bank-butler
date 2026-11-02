import type { CSSProperties, ReactNode } from 'react';
import clsx from 'clsx';
import { RISK_META, type Risk } from '@bank/shared';

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'gold' | 'green' | 'amber' | 'red' | 'dark';
  className?: string;
}) {
  const styles: Record<string, string> = {
    neutral: 'border-black/10 bg-black/[0.035] text-[#5b675f]',
    gold: 'border-[#c7a667]/35 bg-[#c7a667]/10 text-[#8c6c2f]',
    green: 'border-[#2f7d5b]/25 bg-[#2f7d5b]/10 text-[#2f7d5b]',
    amber: 'border-[#c9791f]/25 bg-[#c9791f]/10 text-[#a86218]',
    red: 'border-[#b3392e]/25 bg-[#b3392e]/10 text-[#a2342a]',
    dark: 'border-white/10 bg-white/5 text-[#dfe7df]',
  };
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[10px] font-medium leading-none',
        styles[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function RiskBadge({ risk, compact = false }: { risk: Risk; compact?: boolean }) {
  const meta = RISK_META[risk];
  const tone = risk === 'RED' ? 'red' : risk === 'YELLOW' ? 'amber' : 'green';
  return (
    <Badge tone={tone}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {compact ? meta.short : meta.label}
    </Badge>
  );
}

export function ProgressBar({
  value,
  max,
  tone = 'gold',
  className,
  height = 6,
}: {
  value: number;
  max: number;
  tone?: 'gold' | 'green' | 'amber' | 'red';
  className?: string;
  height?: number;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const colors = {
    gold: 'linear-gradient(90deg,#9a7a3e,#e3cfa5)',
    green: 'linear-gradient(90deg,#2f7d5b,#6fbf9b)',
    amber: 'linear-gradient(90deg,#a86218,#e0a259)',
    red: 'linear-gradient(90deg,#8e2c23,#d47a6f)',
  };
  return (
    <div
      className={clsx('w-full overflow-hidden rounded-full bg-black/10', className)}
      style={{ height }}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, background: colors[tone] }}
      />
    </div>
  );
}

export function Donut({
  segments,
  size = 104,
  thickness = 11,
  center,
  sub,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  size?: number;
  thickness?: number;
  center?: ReactNode;
  sub?: ReactNode;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(15,61,51,.08)"
          strokeWidth={thickness}
        />
        {segments.map((segment) => {
          const length = (segment.value / total) * circumference;
          const el = (
            <circle
              key={segment.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${Math.max(0, length - 2)} ${circumference}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
          offset += length;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[15px] font-semibold tabular text-[#12332b]">{center}</div>
        {sub ? <div className="mt-0.5 text-[9px] text-[#7c8b82]">{sub}</div> : null}
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'gold' | 'green' | 'red' | 'amber';
}) {
  const color =
    tone === 'gold'
      ? 'text-[#e3cfa5]'
      : tone === 'green'
        ? 'text-[#8fd0b3]'
        : tone === 'red'
          ? 'text-[#f0a49b]'
          : tone === 'amber'
            ? 'text-[#e0a259]'
            : 'text-[#ece7db]';
  return (
    <div>
      <div className="console-label">{label}</div>
      <div className={clsx('mt-1.5 tabular text-[17px] font-semibold leading-none', color)}>{value}</div>
      {sub ? <div className="mt-1 text-[10px] text-[#7f9087]">{sub}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  eyebrow,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx('console-card overflow-hidden', className)}>
      {(title || action || eyebrow) && (
        <header className="flex items-center justify-between gap-3 border-b hairline px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {eyebrow ? <span className="gold-dot" /> : null}
            <div className="min-w-0">
              {eyebrow ? <div className="console-label">{eyebrow}</div> : null}
              {title ? <div className="truncate text-[12.5px] font-medium text-[#e9e2d3]">{title}</div> : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      )}
      <div className={clsx('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  detail,
  icon,
}: {
  title: string;
  detail?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[150px] flex-col items-center justify-center rounded-xl border border-dashed border-[#c7a667]/15 bg-black/10 px-6 py-8 text-center">
      {icon ? <div className="mb-3 text-[#c7a667]/55">{icon}</div> : null}
      <div className="text-[12px] text-[#b9c2bb]">{title}</div>
      {detail ? <div className="mt-1.5 max-w-[280px] text-[10.5px] leading-relaxed text-[#728078]">{detail}</div> : null}
    </div>
  );
}

export function Hash({ value, className }: { value: string; className?: string }) {
  return (
    <span className={clsx('hash-text text-[#96a89d]', className)} title={value}>
      {!value ? '—' : value === 'GENESIS' || value.length <= 20 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`}
    </span>
  );
}

export function SheetShell({
  children,
  onClose,
  style,
}: {
  children: ReactNode;
  onClose: () => void;
  style?: CSSProperties;
}) {
  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <div
        className="sheet-panel"
        style={style}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex justify-center pt-2.5">
          <div className="h-1 w-9 rounded-full bg-black/15" />
        </div>
        {children}
      </div>
    </div>
  );
}
