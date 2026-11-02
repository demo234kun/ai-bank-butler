import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Check, Loader2, ShieldCheck, X } from 'lucide-react';
import { formatDateTime, type UserProfile } from '@bank/shared';
import { api } from '../api/client';

interface RiskQuestion {
  id: string;
  label: string;
  options: { label: string; score: number }[];
}

interface AssessmentView {
  questions: RiskQuestion[];
  profile: UserProfile['riskProfile'];
  maxProductRisk: string;
  expired: boolean;
  validDays: number;
  businessNow: string;
}
const LEVEL_HINT: Record<string, string> = {
  保守型: '以本金安全为先，适合存款、货基与 R1 产品',
  稳健型: '可承受小幅波动，适合 R1–R2 固收类产品',
  平衡型: '追求稳健增值，适合 R1–R3 混合类产品',
  成长型: '可承受较大波动，适合 R1–R4 权益偏好的产品',
  进取型: '以长期增值为目标，可投资 R1–R5 全等级产品',
};

export function RiskAssessmentSheet({
  open,
  onClose,
  onAssessed,
}: {
  open: boolean;
  onClose: () => void;
  onAssessed: () => Promise<void> | void;
}) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState<AssessmentView | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ profile: UserProfile['riskProfile']; maxProductRisk: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<AssessmentView>('/api/risk/assessment');
      setView(data);
      setAnswers({});
      setStep(0);
      setResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法读取风险测评问卷');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  if (!open) return null;

  const questions = view?.questions ?? [];
  const total = questions.length || 1;
  const current = questions[step];
  const picked = current ? answers[current.id] : undefined;
  const finished = step >= total - 1 && picked !== undefined;

  const next = () => {
    if (!current) return;
    if (step < total - 1) {
      setStep(step + 1);
      return;
    }
    void submit();
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await api.post<{
        profile: UserProfile['riskProfile'];
        maxProductRisk: string;
      }>('/api/risk/assessment', { answers });
      setResult({ profile: response.profile, maxProductRisk: response.maxProductRisk });
      await onAssessed();
    } catch (err) {
      setError(err instanceof Error ? err.message : '测评提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-[430px] flex-col rounded-t-[26px] bg-[#FBFAF7] shadow-2xl sm:rounded-[24px]">
        <header className="flex items-start justify-between border-b border-black/[0.05] px-5 py-4">
          <div>
            <div className="flex items-center gap-1.5 text-[16px] font-semibold text-[#14251f]">
              <ShieldCheck size={16} className="text-[#0f3d33]" />
              风险承受能力测评
            </div>
            <div className="mt-1 text-[9.5px] leading-relaxed text-[#6f7c74]">
              共 {total} 题，结果决定你可购买的产品风险等级，{view?.validDays ?? 365} 天内有效
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭风险测评"
            className="rounded-full p-1.5 text-[#6f7c74] transition hover:bg-black/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f3d33]/25"
          >
            <X size={16} />
          </button>
        </header>

        <div className="h-1 bg-black/[0.06]">
          <div
            className="h-full bg-[#0f3d33] transition-all"
            style={{ width: `${result ? 100 : Math.min(100, ((step + (picked !== undefined ? 1 : 0)) / total) * 100)}%` }}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[10px] text-[#7c8b82]">
              <Loader2 size={14} className="animate-spin" /> 正在读取问卷…
            </div>
          ) : result ? (
            <div className="text-center">
              <div className="text-[9px] tracking-[0.2em] text-[#8c6c2f]">测评结果</div>
              <div className="mt-2 text-[30px] font-semibold text-[#0f3d33]">{result.profile.level}</div>
              <div className="mt-1 text-[10px] text-[#7c8b82] tabular">{result.profile.score} 分</div>
              <div className="mt-4 rounded-xl border border-[#0f3d33]/10 bg-[#0f3d33]/[0.04] px-4 py-3 text-left">
                <div className="text-[9.5px] leading-relaxed text-[#23352d]">
                  {LEVEL_HINT[result.profile.level] ?? '按测评结果匹配产品风险等级'}
                </div>
                <div className="mt-2 flex items-center justify-between text-[9.5px] text-[#7c8b82]">
                  <span>可适当性购买</span>
                  <span className="font-medium text-[#0f3d33]">R1 – {result.maxProductRisk}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[9.5px] text-[#7c8b82]">
                  <span>测评时间</span>
                  <span>{formatDateTime(result.profile.assessedAt)}</span>
                </div>
              </div>
              <div className="mt-3 text-[9px] leading-relaxed text-[#6f7c74]">
                测评结果已写入审计链；理财产品申购会自动校验适当性，超出等级将被拒绝。
              </div>
              <button
                onClick={onClose}
                className="mt-5 w-full rounded-xl bg-[#0F3D33] py-3 text-[11px] text-[#f4f1ec]"
              >
                完成
              </button>
            </div>
          ) : current ? (
            <div>
              <div className="text-[9.5px] text-[#6f7c74]">
                第 {step + 1} / {total} 题
              </div>
              <div className="mt-1.5 text-[13px] font-medium leading-relaxed text-[#23352d]">
                {current.label}
              </div>
              <div className="mt-3 space-y-2">
                {current.options.map((option, index) => (
                  <button
                    key={option.label}
                    onClick={() => setAnswers({ ...answers, [current.id]: index })}
                    aria-pressed={picked === index}
                    className={clsx(
                      'flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left text-[10.5px] transition',
                      picked === index
                        ? 'border-[#0f3d33] bg-[#0f3d33]/[0.06] text-[#14251f]'
                        : 'border-black/[0.08] bg-white text-[#4b5b52] hover:border-black/[0.16]',
                    )}
                  >
                    <span
                      className={clsx(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                        picked === index ? 'border-[#0f3d33] bg-[#0f3d33]' : 'border-black/20',
                      )}
                    >
                      {picked === index ? <Check size={10} className="text-[#f4f1ec]" /> : null}
                    </span>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-[10px] text-[#6f7c74]">暂无可用的测评问卷</div>
          )}

          {error ? (
            <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-[#b3392e]/20 bg-[#b3392e]/[0.05] px-3 py-2 text-[9px] leading-relaxed text-[#9e3f35]">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              {error}
            </div>
          ) : null}
        </div>

        {!loading && !result && current ? (
          <footer className="border-t border-black/[0.05] px-5 py-4">
            <div className="flex gap-2">
              <button
                onClick={() => setStep(Math.max(0, step - 1))}
                disabled={step === 0}
                className="flex-1 rounded-xl border border-black/10 bg-white py-2.5 text-[10px] text-[#7c8b82] disabled:opacity-35"
              >
                上一题
              </button>
              <button
                onClick={next}
                disabled={picked === undefined || submitting}
                className="flex flex-[1.6] items-center justify-center gap-1.5 rounded-xl bg-[#0F3D33] py-2.5 text-[10px] text-[#f4f1ec] disabled:opacity-40"
              >
                {submitting ? (
                  <>
                    <Loader2 size={12} className="animate-spin" /> 提交中…
                  </>
                ) : finished ? (
                  '提交测评'
                ) : (
                  '下一题'
                )}
              </button>
            </div>
            {view ? (
              <div className="mt-2.5 text-center text-[9px] leading-relaxed text-[#6f7c74]">
                当前等级：{view.profile.level} · 上次测评 {formatDateTime(view.profile.assessedAt)}
                {view.expired ? ' · 已过期，请重新测评' : ''}
              </div>
            ) : null}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
