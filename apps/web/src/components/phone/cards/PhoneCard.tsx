import type { ReactNode } from 'react';
import clsx from 'clsx';

export function PhoneCard({
  children,
  accent,
  className,
}: {
  children: ReactNode;
  accent?: string;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-[18px] border border-black/[0.065] bg-[#FBFAF7] shadow-card',
        className,
      )}
    >
      {accent ? (
        <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: accent }} />
      ) : null}
      {children}
    </div>
  );
}

export function CardTitle({
  icon,
  title,
  sub,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#0f3d33]/10 bg-[#0f3d33]/[0.055] text-[#0f3d33]">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-[#14251f]">{title}</div>
          {sub ? <div className="mt-0.5 truncate text-[10px] text-[#7c8b82]">{sub}</div> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Rows({
  rows,
}: {
  rows: Array<{ label: string; value: ReactNode; emphasis?: boolean; tone?: string }>;
}) {
  return (
    <div className="divide-y divide-black/[0.045]">
      {rows.map((row, index) => (
        <div key={`${row.label}_${index}`} className="flex items-center justify-between gap-4 py-2.5">
          <span className="shrink-0 text-[10.5px] text-[#839087]">{row.label}</span>
          <span
            className={clsx(
              'text-right text-[11.5px] leading-snug',
              row.emphasis ? 'font-semibold text-[#14251f] tabular' : 'text-[#3f4c45]',
              row.tone === 'risk' && 'text-[#b3392e]',
            )}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CardFooter({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2 border-t border-black/[0.045] pt-2.5 text-[9.5px] text-[#6f7c74]">
      {children}
    </div>
  );
}
