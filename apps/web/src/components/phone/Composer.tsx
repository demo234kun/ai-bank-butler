import { useState } from 'react';
import { ArrowUp, Loader2, Mic, MicOff, Sparkles, X } from 'lucide-react';
import clsx from 'clsx';
import { QUICK_PROMPTS } from '@bank/shared';
import { useSpeechInput } from '../../lib/useSpeechInput';

export function Composer({
  quickPrompts,
  busy,
  pending,
  offline,
  onSend,
}: {
  quickPrompts: string[];
  busy: boolean;
  pending: boolean;
  offline: boolean;
  onSend: (text: string) => void;
}) {
  const [value, setValue] = useState('');
  const speech = useSpeechInput((text, isFinal) => {
    if (!isFinal) return;
    const clean = text.trim();
    if (!clean) return;
    setValue((current) => (current.trim() ? `${current.trim()} ${clean}` : clean));
  });

  const chips = (quickPrompts.length ? quickPrompts : QUICK_PROMPTS).slice(0, 6);

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    if (busy || pending) return;
    if (speech.listening) speech.stop();
    onSend(text);
    setValue('');
  };

  const voiceTitle = speech.transcribing
    ? '正在识别…'
    : speech.listening
      ? '结束语音输入'
      : speech.mode === 'webspeech'
        ? '语音输入（浏览器识别）'
        : speech.mode === 'server'
          ? '语音输入（录音后由服务端识别）'
          : '当前浏览器不支持语音输入';

  return (
    <div className="border-t border-black/[0.055] bg-[#F4F1EC]/95 px-3 pb-3 pt-2 backdrop-blur">
      {offline ? (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-[#c9791f]/20 bg-[#c9791f]/[0.06] px-2.5 py-1.5 text-[9.5px] text-[#8a5a1f]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#c9791f]" />
          离线安全模式 · 规则引擎接管意图解析，6 个场景仍可办理
        </div>
      ) : null}

      <div className="mb-2 flex gap-1.5 overflow-x-auto no-scrollbar">
        {chips.map((prompt) => (
          <button
            key={prompt}
            onClick={() => !busy && !pending && onSend(prompt)}
            className={clsx(
              'shrink-0 rounded-full border px-2.5 py-1.5 text-[9.5px] transition',
              busy || pending
                ? 'cursor-not-allowed border-black/[0.05] bg-white/40 text-[#a9b1ab]'
                : 'border-[#0f3d33]/10 bg-white/70 text-[#5b675f] hover:border-[#c7a667]/45 hover:text-[#7d5f27]',
            )}
          >
            {prompt}
          </button>
        ))}
      </div>

      {speech.listening || speech.transcribing ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-[#0f3d33]/12 bg-white/80 px-3 py-2">
          {speech.transcribing ? (
            <Loader2 size={13} className="shrink-0 animate-spin text-[#0f3d33]" />
          ) : (
            <div className="flex h-4 shrink-0 items-center gap-[3px]">
              {[0, 1, 2, 3, 4].map((index) => (
                <span
                  key={index}
                  className="wave-bar"
                  style={{ height: `${8 + (index % 3) * 4}px`, animationDelay: `${index * 0.11}s` }}
                />
              ))}
            </div>
          )}
          <span className="min-w-0 flex-1 truncate text-[9.5px] text-[#5b675f]">
            {speech.transcribing
              ? '正在交给语音识别服务…'
              : speech.interim ||
                (speech.mode === 'webspeech'
                  ? '正在聆听，说完自动上屏…'
                  : `录音中 ${speech.elapsed}s（最长 30s），再点一次结束`)}
          </span>
          <button
            onClick={() => (speech.transcribing ? speech.clearError() : speech.stop())}
            className="shrink-0 rounded-full bg-[#0f3d33] px-2 py-0.5 text-[8.5px] text-[#f4f1ec]"
          >
            {speech.transcribing ? '…' : '结束'}
          </button>
        </div>
      ) : null}

      {speech.error ? (
        <div className="mb-2 flex items-start gap-1.5 rounded-lg border border-[#b3392e]/20 bg-[#b3392e]/[0.05] px-2.5 py-1.5 text-[9px] leading-relaxed text-[#9e3f35]">
          <MicOff size={11} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{speech.error}</span>
          <button onClick={speech.clearError} aria-label="关闭语音提示" className="shrink-0">
            <X size={11} />
          </button>
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 rounded-[22px] border border-black/[0.07] bg-white px-1.5 py-1.5 shadow-sm focus-within:border-[#c7a667]/50">
        <button
          onClick={speech.toggle}
          disabled={busy || pending}
          aria-label={voiceTitle}
          aria-pressed={speech.listening}
          title={voiceTitle}
          className={clsx(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition',
            speech.listening
              ? 'bg-[#0F3D33] text-[#F4F1EC]'
              : speech.transcribing
                ? 'bg-[#0f3d33]/15 text-[#0f3d33]'
                : 'text-[#7c8b82] hover:bg-[#0f3d33]/[0.05] hover:text-[#0f3d33]',
            (busy || pending) && 'opacity-40',
          )}
        >
          {speech.transcribing ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
        </button>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          disabled={busy || pending}
          placeholder={
            pending
              ? '请先完成确认单中的操作'
              : busy
                ? 'Agent 正在执行任务…'
                : speech.listening
                  ? '继续说，或点按结束'
                  : '说说你想办理的业务'
          }
          className="min-w-0 flex-1 bg-transparent text-[11.5px] text-[#14251f] outline-none placeholder:text-[#a9b1ab]"
        />
        <button
          onClick={submit}
          disabled={!value.trim() || busy || pending}
          className={clsx(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition',
            value.trim() && !busy && !pending
              ? 'bg-[#0F3D33] text-[#F4F1EC] shadow-sm hover:bg-[#155246]'
              : 'bg-[#0f3d33]/10 text-[#0f3d33]/25',
          )}
          title="发送"
        >
          <ArrowUp size={15} />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-center gap-1 text-[8.5px] text-[#6f7c74]">
        <Sparkles size={8} className="text-[#c7a667]" />
        语音由 {speech.label} 转写 · 资金操作仍需按风险等级确认
      </div>
    </div>
  );
}
