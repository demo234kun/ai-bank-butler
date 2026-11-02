import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import clsx from 'clsx';
import type { ToastState } from '../state/agentReducer';

export function Toast({
  toast,
  onClose,
}: {
  toast: ToastState | null;
  onClose: () => void;
}) {
  if (!toast) return null;
  const Icon =
    toast.tone === 'danger' ? AlertTriangle : toast.tone === 'success' ? CheckCircle2 : Info;
  return (
    <div className="fixed bottom-6 right-6 z-[80] w-[300px] animate-fade-up">
      <div
        className={clsx(
          'flex items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-2xl backdrop-blur-xl',
          toast.tone === 'danger'
            ? 'border-[#b3392e]/40 bg-[#2a1513]/95'
            : toast.tone === 'success'
              ? 'border-[#2f7d5b]/40 bg-[#0f241c]/95'
              : toast.tone === 'warning'
                ? 'border-[#c9791f]/40 bg-[#2a2012]/95'
                : 'border-[#c7a667]/25 bg-[#101c17]/95',
        )}
      >
        <Icon
          size={14}
          className={clsx(
            'mt-0.5 shrink-0',
            toast.tone === 'danger'
              ? 'text-[#eda49b]'
              : toast.tone === 'success'
                ? 'text-[#8fd0b3]'
                : toast.tone === 'warning'
                  ? 'text-[#e0a259]'
                  : 'text-[#e3cfa5]',
          )}
        />
        <div className="flex-1 text-[10px] leading-relaxed text-[#e9e2d3]">{toast.text}</div>
        <button
          onClick={onClose}
          aria-label="关闭提示"
          className="shrink-0 text-[#7f9087] transition hover:text-[#e9e2d3] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
