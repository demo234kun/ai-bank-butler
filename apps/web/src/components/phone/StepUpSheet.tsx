import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ExternalLink,
  Fingerprint,
  KeyRound,
  ScanFace,
  ShieldCheck,
  X,
} from 'lucide-react';
import { RISK_META, formatMoney, type PendingAction, type StepUpChallenge } from '@bank/shared';
import clsx from 'clsx';
import { SheetShell } from '../ui/primitives';
import type { BankAgentApi } from '../../state/useBankAgent';
import { listPasskeys, passkeySupported, verifyWithPasskey } from '../../lib/passkey';
import { DEMO_LABELS, label } from '../../lib/disclosure';

function useRemaining(expiresAt: string) {
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(expiresAt).getTime() - Date.now()));
  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  return remaining;
}

type FaceStatus = 'idle' | 'starting' | 'pending' | 'passed' | 'failed' | 'error';

export function StepUpSheet({
  pending,
  challenge,
  agent,
}: {
  pending: PendingAction;
  challenge: StepUpChallenge;
  agent: BankAgentApi;
}) {
  const remaining = useRemaining(challenge.expiresAt);
  const requiresFace = challenge.methods.includes('FACE');
  const requiresSms = challenge.methods.includes('SMS');
  const faceMode = challenge.faceMode ?? 'demo';
  const smsMode = challenge.smsMode ?? 'demo';
  const providerFace = requiresFace && faceMode === 'http';

  const [progress, setProgress] = useState(requiresFace && !providerFace ? 0 : 100);
  const [demoFaceDone, setDemoFaceDone] = useState(!requiresFace);
  const [faceStatus, setFaceStatus] = useState<FaceStatus>(providerFace ? 'idle' : 'passed');
  const [faceLink, setFaceLink] = useState<string | undefined>(challenge.faceVerifyUrl);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(Boolean(challenge.smsSent));
  const [demoCode, setDemoCode] = useState<string | undefined>();
  const [smsNotice, setSmsNotice] = useState<string | undefined>();
  const [cooldown, setCooldown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [bioVerified, setBioVerified] = useState(Boolean(challenge.bioVerified));
  const [passkeyCount, setPasskeyCount] = useState(0);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioNotice, setBioNotice] = useState<string | undefined>();
  const [demoFaceRequested, setDemoFaceRequested] = useState(false);
  const autoSentRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expired = remaining <= 0;

  const faceDone = bioVerified || (providerFace ? faceStatus === 'passed' : demoFaceDone);

  useEffect(() => {
    if (!challenge.bioAvailable || !passkeySupported()) return;
    let cancelled = false;
    listPasskeys()
      .then((data) => {
        if (!cancelled) setPasskeyCount(data.credentials.length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [challenge.bioAvailable, challenge.id]);

  const runBio = async () => {
    if (bioBusy) return;
    setBioBusy(true);
    setBioNotice(undefined);
    const result = await verifyWithPasskey(agent.state.sessionId ?? '', challenge.id);
    setBioBusy(false);
    if (!result.ok) {
      setBioNotice(result.message ?? '生物识别未完成');
      return;
    }
    setBioVerified(true);
  };

  useEffect(() => {
    if (!requiresFace) return;
    // 已录入通行密钥时不再自动跑演示动画：真实生物识别优先，演示通道需手动选择
    if (providerFace || (challenge.bioAvailable && passkeyCount > 0 && !demoFaceRequested)) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const p = Math.min(100, ((Date.now() - started) / 2600) * 100);
      setProgress(p);
      if (p >= 100) {
        clearInterval(timer);
        setDemoFaceDone(true);
      }
    }, 70);
    return () => clearInterval(timer);
  }, [requiresFace, providerFace, challenge.bioAvailable, challenge.id, passkeyCount, demoFaceRequested]);

  useEffect(() => {
    setCode('');
  }, [challenge.attemptsLeft]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const requestCode = useCallback(async () => {
    if (sending || cooldown > 0) return;
    setSending(true);
    setSmsNotice(undefined);
    const result = await agent.sendStepUpCode();
    setSending(false);
    if (!result.ok) {
      setSmsNotice(result.message ?? '验证码发送失败');
      if (result.cooldownSec) setCooldown(result.cooldownSec);
      return;
    }
    setSent(true);
    if (result.demoCode) {
      setDemoCode(result.demoCode);
      setCode((current) => current || result.demoCode || '');
    }
    if (result.cooldownSec) setCooldown(result.cooldownSec);
    setSmsNotice(
      smsMode === 'http'
        ? '验证码已通过银行短信通道发送'
        : DEMO_LABELS
          ? '演示验证码已填入'
          : '验证码已填入本设备',
    );
  }, [agent, sending, cooldown, smsMode]);

  useEffect(() => {
    if (!requiresSms || expired) return;
    if (autoSentRef.current === challenge.id) return;
    autoSentRef.current = challenge.id;
    void requestCode();
    // 只在首次打开挑战时自动发送一次；重发由按钮触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge.id, requiresSms, expired]);

  const startFace = async () => {
    if (faceStatus === 'starting') return;
    setFaceStatus('starting');
    const result = await agent.startFace();
    if (!result.ok) {
      setFaceStatus('error');
      setSmsNotice(result.message ?? '人脸核验启动失败');
      return;
    }
    if (result.mode === 'demo') {
      setFaceStatus('passed');
      setDemoFaceDone(true);
      return;
    }
    setFaceLink(result.verifyUrl);
    setFaceStatus('pending');
    stopPolling();
    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > 120_000) {
        stopPolling();
        setFaceStatus('failed');
        return;
      }
      const status = await agent.checkFace();
      if (status.ok && status.status === 'passed') {
        stopPolling();
        setFaceStatus('passed');
      } else if (status.ok && (status.status === 'failed' || status.status === 'expired')) {
        stopPolling();
        setFaceStatus('failed');
      } else if (!status.ok && status.message) {
        stopPolling();
        setFaceStatus('error');
        setSmsNotice(status.message);
      }
    }, 2000);
  };

  const amount = pending.summary.amountCents;
  const timerLabel = useMemo(() => {
    const sec = Math.ceil(remaining / 1000);
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  }, [remaining]);

  const canSubmit =
    !expired &&
    faceDone &&
    (!requiresSms || code.replace(/\D/g, '').length === 6) &&
    !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await agent.stepUp({ faceDone: faceDone || !requiresFace, smsCode: requiresSms ? code : undefined });
    } finally {
      setSubmitting(false);
    }
  };

  const faceLabel = providerFace
    ? faceStatus === 'passed'
      ? '人脸核验通过'
      : faceStatus === 'pending'
        ? '等待合作方核验结果'
        : faceStatus === 'starting'
          ? '正在创建核验会话…'
          : faceStatus === 'failed'
            ? '核验未通过，可重新发起'
            : faceStatus === 'error'
              ? '核验服务异常'
              : '需要合作方完成活体核验'
    : faceDone
      ? '人脸比对通过'
      : `正在比对 · ${Math.round(progress)}%`;

  return (
    <SheetShell onClose={() => agent.setSheet(null)}>
      <div className="flex min-h-0 flex-col">
        <div className="flex items-start justify-between px-5 pb-1 pt-2">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[#b3392e]/[0.08] px-2.5 py-1 text-[9px] font-medium text-[#a2342a]">
              <span className="h-1.5 w-1.5 animate-soft-pulse rounded-full bg-[#b3392e]" />
              红色 · 强验证
            </div>
            <h3 className="mt-2.5 text-[17px] font-semibold text-[#14251f]">身份核验</h3>
            <p className="mt-1 text-[9.5px] leading-relaxed text-[#7c8b82]">
              操作详情已确认，请完成{requiresSms ? '人脸识别与短信验证码' : '人脸识别'}后继续
            </p>
          </div>
          <button
            onClick={() => agent.setSheet(null)}
            aria-label="关闭核验"
            className="rounded-full p-1.5 text-[#6f7c74] transition hover:bg-black/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f3d33]/25"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2">
          {amount && amount > 0 ? (
            <div className="mt-2 flex items-center justify-between rounded-xl border border-[#b3392e]/15 bg-[#b3392e]/[0.035] px-3 py-2.5">
              <div>
                <div className="text-[9.5px] text-[#a2342a]/75">本次操作金额</div>
                <div className="mt-0.5 text-[18px] font-semibold tabular text-[#7b2a22]">
                  {formatMoney(amount)}
                </div>
              </div>
              <div className="text-right text-[9.5px] text-[#9a7f7b]">
                {pending.summary.title}
                <div className="mt-0.5">操作摘要已校验</div>
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-col items-center">
            <div className="relative flex h-[92px] w-[92px] items-center justify-center">
              <svg className="absolute inset-0 -rotate-90" width="92" height="92" viewBox="0 0 92 92">
                <circle cx="46" cy="46" r="42" fill="none" stroke="rgba(15,61,51,.08)" strokeWidth="3" />
                <circle
                  cx="46"
                  cy="46"
                  r="42"
                  fill="none"
                  stroke={faceDone ? '#2F7D5B' : '#C7A667'}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={`${(providerFace ? (faceStatus === 'pending' ? 55 : 100) : progress / 100) * 2 * Math.PI * 42} ${2 * Math.PI * 42}`}
                  style={{ transition: 'stroke-dasharray .2s linear' }}
                />
              </svg>
              <div
                className={clsx(
                  'flex h-[66px] w-[66px] items-center justify-center rounded-full border',
                  faceDone
                    ? 'border-[#2f7d5b]/30 bg-[#2f7d5b]/10 text-[#2f7d5b]'
                    : 'border-[#c7a667]/35 bg-[#c7a667]/10 text-[#9a7a3e]',
                )}
              >
                {faceDone ? <Check size={26} /> : <ScanFace size={26} />}
              </div>
              {!faceDone ? (
                <span className="scan-ring absolute inset-1 rounded-full border border-dashed border-[#c7a667]/45" />
              ) : null}
            </div>
            <div className="mt-2 text-[10px] font-medium text-[#2f3d36]">{faceLabel}</div>
            <div className="mt-0.5 text-[9.5px] text-[#6f7c74]">
              {bioVerified
                ? '已通过本机生物识别，签名由服务端校验，未采集人脸图像'
                : providerFace
                  ? '由签约的活体核验服务完成，结果由服务端确认'
                  : challenge.bioAvailable
                    ? '可用本机指纹 / 面容直接确认，无需页面人脸'
                  : faceDone
                    ? label('演示通道：页面模拟通过，未采集真实人脸', '本页不采集人脸图像，仅确认操作意愿')
                    : '请正对屏幕并保持面部在框内'}
            </div>

            {challenge.bioAvailable && !bioVerified ? (
              <div className="mt-3 flex flex-col items-center gap-1.5">
                <button
                  onClick={() => void runBio()}
                  disabled={bioBusy || passkeyCount === 0}
                  className="flex items-center gap-1.5 rounded-full bg-[#0F3D33] px-4 py-1.5 text-[9.5px] text-[#f4f1ec] disabled:opacity-45"
                >
                  <Fingerprint size={12} />
                  {bioBusy ? '等待系统生物识别…' : '用本机指纹 / 面容确认'}
                </button>
                <div className="text-[8.5px] text-[#95a099]">
                  {passkeyCount === 0
                    ? '尚未录入通行密钥，可在「我的 · 登录与安全」开启'
                    : `已录入 ${passkeyCount} 个通行密钥 · Windows Hello / Touch ID / Face ID`}
                </div>
                {bioNotice ? <div className="text-[8.5px] text-[#9e3f35]">{bioNotice}</div> : null}
                {passkeyCount > 0 && !demoFaceRequested ? (
                  <button
                    onClick={() => setDemoFaceRequested(true)}
                    className="text-[8.5px] text-[#95a099] underline underline-offset-2"
                  >
                    {label('本机识别不可用？改用演示人脸通道', '本机识别不可用？改用其他验证方式')}
                  </button>
                ) : null}
              </div>
            ) : null}

            {providerFace && faceStatus !== 'passed' ? (
              <div className="mt-3 flex flex-col items-center gap-2">
                <button
                  onClick={() => void startFace()}
                  disabled={faceStatus === 'starting' || faceStatus === 'pending'}
                  className="rounded-full border border-[#c7a667]/40 bg-[#c7a667]/10 px-4 py-1.5 text-[9.5px] text-[#8c6c2f] disabled:opacity-50"
                >
                  {faceStatus === 'idle' || faceStatus === 'failed' || faceStatus === 'error'
                    ? '开始人脸核验'
                    : faceStatus === 'starting'
                      ? '创建核验会话…'
                      : '核验进行中'}
                </button>
                {faceLink ? (
                  <a
                    href={faceLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[9.5px] text-[#2f7d5b] underline underline-offset-2"
                  >
                    打开核验页面 <ExternalLink size={9} />
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>

          {requiresSms ? (
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[9.5px] font-medium text-[#2f3d36]">
                  <KeyRound size={11} className="text-[#9a7a3e]" />
                  短信验证码
                </div>
                <button
                  onClick={() => void requestCode()}
                  disabled={sending || cooldown > 0 || expired}
                  className="rounded-full border border-[#c7a667]/30 bg-[#c7a667]/[0.07] px-2 py-0.5 text-[9px] text-[#8c6c2f] disabled:opacity-50"
                >
                  {sending ? '发送中…' : cooldown > 0 ? `${cooldown}s 后重发` : sent ? '重新发送' : '获取验证码'}
                </button>
              </div>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="• • • • • •"
                className="mt-2 w-full rounded-xl border border-black/[0.08] bg-white px-4 py-3 text-center text-[18px] tracking-[0.5em] text-[#14251f] outline-none focus:border-[#c7a667]/50"
              />
              <div className="mt-1 flex items-center justify-between text-[9px] text-[#6f7c74]">
                <span>
                  {smsNotice ??
                    (smsMode === 'http'
                      ? sent
                        ? '验证码已发送至预留手机号'
                        : '需先获取短信验证码'
                      : demoCode
                        ? label(`演示验证码 ${demoCode}（已自动填入）`, `验证码 ${demoCode} 已自动填入`)
                        : label('演示环境验证码由服务端下发', '验证码由服务端下发，5 分钟内有效'))}
                </span>
                <span className={challenge.attemptsLeft < 3 ? 'text-[#b3392e]' : ''}>
                  剩余尝试 {challenge.attemptsLeft}
                </span>
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex items-center justify-between rounded-lg bg-black/[0.022] px-2.5 py-2 text-[9.5px] text-[#6f7c74]">
            <span className="flex items-center gap-1">
              <ShieldCheck size={9} className="text-[#2f7d5b]" /> 验证令牌与操作摘要绑定
            </span>
            <span className={expired ? 'text-[#b3392e]' : ''}>
              {expired ? '已超时' : `剩余 ${timerLabel}`}
            </span>
          </div>
        </div>

        <div className="border-t border-black/[0.055] px-5 pb-5 pt-3">
          <div className="flex gap-2">
            <button
              onClick={() => agent.cancel()}
              className="flex-1 rounded-xl border border-black/10 bg-white py-2.5 text-[11px] text-[#7c8b82] transition hover:bg-black/[0.02]"
            >
              取消
            </button>
            <button
              onClick={() => void submit()}
              disabled={!canSubmit}
              className={clsx(
                'flex flex-[1.55] items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-medium text-white transition',
                canSubmit ? 'bg-[#8e2c23] hover:bg-[#a2342a]' : 'cursor-not-allowed bg-[#9aa39d]',
              )}
            >
              <Fingerprint size={13} />
              {submitting ? '验证中…' : '完成验证并执行'}
            </button>
          </div>
          <div className="mt-2 text-center text-[8.5px] text-[#a2aaa4]">
            {smsMode === 'http' || faceMode === 'http'
              ? '核验由签约服务完成，结果由服务端校验；本页不采集人脸图像'
              : label(
                  '演示环境不采集真实人脸 · 验证码仅用于流程演示',
                  '本页不采集人脸图像 · 验证码仅用于本次确认',
                )}
          </div>
        </div>
      </div>
    </SheetShell>
  );
}
