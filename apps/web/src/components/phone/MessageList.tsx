import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { formatClock } from '@bank/shared';
import type { ChatMessage, Dag, DataSourceInfo } from '@bank/shared';
import { CardRenderer } from './cards/CardRenderer';

export function MessageList({
  messages,
  dag,
  busy,
  monogram,
  capabilities,
  dataSource,
  onSend,
  onRollback,
  onOpenPending,
}: {
  messages: ChatMessage[];
  dag: Dag | null;
  busy: boolean;
  monogram: string;
  capabilities?: Array<{ intent: string; label: string; example: string }>;
  dataSource?: DataSourceInfo;
  onSend: (text: string) => void;
  onRollback: () => void;
  onOpenPending: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const container = listRef.current;
      if (!container) return;
      const items = container.querySelectorAll<HTMLElement>('[data-message]');
      const last = items[items.length - 1];
      const cardRoot = last?.querySelector<HTMLElement>('[data-card-root]');
      const hasTallCard = last?.dataset.card === 'true' && last.offsetHeight > 360;
      if (last && hasTallCard) {
        const target = cardRoot ?? last;
        const top =
          target.getBoundingClientRect().top -
          container.getBoundingClientRect().top +
          container.scrollTop -
          8;
        container.scrollTo({ top, behavior: 'smooth' });
      } else {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [messages.length, busy]);

  return (
    <div ref={listRef} className="phone-scroll flex-1 overflow-y-auto px-4 pb-3 pt-3">
      <div className="space-y-3">
        {messages.map((message) => (
          <div
            key={message.id}
            data-message
            data-card={message.card ? 'true' : 'false'}
            className="animate-fade-up"
          >
            {message.role === 'system' ? (
              <div className="mx-auto max-w-[85%] rounded-full border border-black/[0.05] bg-black/[0.025] px-3 py-1.5 text-center text-[9px] text-[#6f7c74]">
                {message.text}
              </div>
            ) : message.role === 'user' ? (
              <div className="flex justify-end">
                <div className="max-w-[82%] rounded-[16px] rounded-br-[4px] bg-[#0F3D33] px-3.5 py-2.5 text-[#F4F1EC] shadow-sm">
                  <p className="message-text whitespace-pre-wrap break-words">{message.text}</p>
                  <div className="mt-1 text-right text-[9px] text-white/60">
                    {formatClock(message.ts)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#c7a667]/35 bg-[#0f3d33] text-[9px] font-medium text-[#e3cfa5]">
                  {monogram}
                </div>
                <div className="min-w-0 flex-1">
                  {message.text ? (
                    <div className="mb-1.5 inline-block max-w-[96%] rounded-[16px] rounded-tl-[4px] border border-black/[0.055] bg-white/70 px-3.5 py-2.5 shadow-sm">
                      <p className="message-text whitespace-pre-wrap break-words text-[#26352e]">
                        {message.text}
                      </p>
                    </div>
                  ) : null}
                  {message.card ? (
                    <div className="mt-0.5" data-card-root>
                      <CardRenderer
                        card={message.card}
                        dag={dag}
                        capabilities={capabilities}
                        dataSource={dataSource}
                        onSend={onSend}
                        onRollback={onRollback}
                        onOpenPending={onOpenPending}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        ))}

        {busy ? (
          <div className="flex items-start gap-2">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#c7a667]/35 bg-[#0f3d33] text-[9px] font-medium text-[#e3cfa5]">
              {monogram}
            </div>
            <div className="flex items-center gap-2 rounded-[16px] rounded-tl-[4px] border border-black/[0.055] bg-white/70 px-3.5 py-3 shadow-sm">
              <div className="flex items-end gap-1">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
              <span className="text-[9px] text-[#6f7c74]">正在解析意图、规划任务…</span>
            </div>
          </div>
        ) : null}
        <div />
      </div>
    </div>
  );
}
