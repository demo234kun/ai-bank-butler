import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BRAND } from '@bank/shared';
import clsx from 'clsx';
import { useAuth } from './AuthContext';
import { Badge } from '../components/ui/primitives';
import { usePublicConfig } from '../api/usePublicConfig';
import { DEMO_LABELS, label as demoText } from '../lib/disclosure';

function AuthShell({ children }: { children: ReactNode }) {
  const publicConfig = usePublicConfig();
  const connected = publicConfig?.banking.mode === 'http';
  return (
    <div className="auth-stage flex min-h-[100dvh] flex-col">
      <div className="mx-auto grid w-full max-w-[1120px] flex-1 items-start gap-10 px-5 pb-10 pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-8 lg:py-8">
        <section className="hidden lg:block">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#c7a667]/45 bg-[#0f3d33] text-[16px] text-[#e3cfa5] shadow-inner">
              {BRAND.monogram}
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-[0.32em] text-[#c7a667]">
                {BRAND.nameEn}
              </div>
              <div className="mt-1 text-[18px] font-medium tracking-wide">{BRAND.product}</div>
            </div>
          </div>

          <h1 className="mt-12 max-w-[440px] text-[38px] font-semibold leading-[1.22] tracking-[-0.02em] text-[#f4f1ec]">
            说话，就能办业务。
            <span className="block text-[#c7a667]">但每一步，都可授权、可审计。</span>
          </h1>
          <p className="mt-5 max-w-[430px] text-[12px] leading-7 text-[#aab7ae]">
            一个面向真实手机银行的 AI 智能体原型：自然语言拆解 DAG，绿色自动、黄色确认、红色强验证。
            所有回执由工具结果渲染，模型只负责理解。
          </p>

          <div className="mt-10 grid max-w-[460px] grid-cols-1 gap-2.5">
            {[
              { icon: ShieldCheck, title: '三层权限', desc: '自动 / 确认 / 人脸 + 短信强验证' },
              { icon: Fingerprint, title: '一次性授权', desc: '操作摘要绑定，确认后改单直接拒绝' },
              { icon: LockKeyhole, title: '全链路审计', desc: 'DAG、策略、授权、结果均可回放' },
            ].map((item) => (
              <div
                key={item.title}
                className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.035] px-3.5 py-3"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#c7a667]/10 text-[#e3cfa5]">
                  <item.icon size={14} />
                </div>
                <div>
                  <div className="text-[10.5px] font-medium text-[#e9e2d3]">{item.title}</div>
                  <div className="mt-0.5 text-[9.5px] text-[#7f9087]">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center gap-2 text-[9px] text-[#5f6d65]">
            <Sparkles size={9} className="text-[#c7a667]" />
            {connected
              ? `${publicConfig?.banking.provider ?? '合作银行核心'} · 已接入账户数据通道`
              : demoText('演示环境 · 全部账户、流水与联系人均为合成数据', '')}
            {connected || DEMO_LABELS ? null : <span>{BRAND.slogan}</span>}
          </div>
        </section>

        <section className="mx-auto w-full max-w-[430px]">
          <div className="mb-5 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#c7a667]/45 bg-[#0f3d33] text-[13px] text-[#e3cfa5]">
              {BRAND.monogram}
            </div>
            <div>
              <div className="text-[8.5px] uppercase tracking-[0.28em] text-[#c7a667]">
                {BRAND.nameEn}
              </div>
              <div className="mt-0.5 text-[14px] font-medium">{BRAND.product}</div>
            </div>
          </div>
          {children}
          <div className="mt-5 text-center text-[8.5px] leading-relaxed text-[#5f6d65]">
            {connected
              ? `已接入 ${publicConfig?.banking.provider ?? '合作银行核心'}；短信${
                  publicConfig?.verification.smsMode === 'http' ? '签约通道' : '演示通道'
                }、人脸${
                  publicConfig?.verification.faceMode === 'http' ? '签约通道' : '演示通道'
                }，具体环境以部署配置为准。`
              : demoText(
                  '登录即表示同意演示环境使用合成数据；所有资金操作均为模拟，不连接真实银行核心。',
                  '资金操作按风险等级分级确认，全流程留痕可审计。',
                )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="auth-label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[9px] leading-relaxed text-[#6f7c74]">{hint}</span> : null}
    </label>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="auth-input pr-10"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? '隐藏密码' : '显示密码'}
        aria-pressed={visible}
        title={visible ? '隐藏密码' : '显示密码'}
        className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[#6f7c74] transition hover:bg-black/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f3d33]/30"
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function AuthError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="rounded-lg border border-[#b3392e]/15 bg-[#b3392e]/[0.05] px-2.5 py-2 text-[9px] text-[#9e3f35]">
      {message}
    </div>
  );
}

function OtpField({
  phone,
  scene,
  code,
  onCodeChange,
  sent,
  demoCode,
  cooldown,
  onSent,
  onError,
  label = '短信验证码',
}: {
  phone: string;
  scene: 'register' | 'reset';
  code: string;
  onCodeChange: (value: string) => void;
  sent: boolean;
  demoCode?: string;
  cooldown: number;
  onSent: (result: { demoCode?: string; cooldownSec?: number }) => void;
  onError: (message: string) => void;
  label?: string;
}) {
  const { sendOtp, requestPasswordReset } = useAuth();
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      onError('请先填写正确的 11 位手机号');
      return;
    }
    setSending(true);
    onError('');
    try {
      const result = scene === 'reset'
        ? await requestPasswordReset(phone)
        : await sendOtp({ phone, scene });
      if (!result.ok) {
        onError(result.message ?? '验证码发送失败');
        return;
      }
      onSent({ demoCode: result.demoCode, cooldownSec: result.cooldownSec });
    } catch (error) {
      onError(error instanceof Error ? error.message : '验证码发送失败');
    } finally {
      setSending(false);
    }
  };

  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="6 位验证码"
          inputMode="numeric"
          autoComplete="one-time-code"
          className="auth-input min-w-0 flex-1 tracking-[0.2em]"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || cooldown > 0 || sent}
          className="shrink-0 rounded-xl border border-[#0f3d33]/12 bg-[#0f3d33]/[0.045] px-3 text-[9px] text-[#2f5b4c] disabled:opacity-45"
        >
          {sending ? '发送中…' : cooldown > 0 ? `${cooldown}s` : sent ? '已发送' : '获取验证码'}
        </button>
      </div>
      <span className="mt-1 block text-[9px] text-[#6f7c74]">
        {demoCode
          ? demoText(`演示验证码 ${demoCode}（已自动填入）`, `验证码 ${demoCode} 已自动填入`)
          : '验证码仅用于本次操作，5 分钟内有效'}
      </span>
    </Field>
  );
}

function useCooldown() {
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);
  return { cooldown, setCooldown };
}

function GuestButtons({ mode }: { mode: 'app' | 'console' }) {
  const { guest } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const enter = async () => {
    setLoading(true);
    try {
      await guest();
      window.location.assign(mode === 'console' ? '/console' : '/app');
    } finally {
      setLoading(false);
    }
  };
  if (mode === 'console') {
    return (
      <button
        onClick={enter}
        disabled={loading}
        className="flex w-full items-center justify-center gap-1.5 py-1 text-[9px] text-[#8c6c2f] transition hover:text-[#5e4a20]"
      >
        <ShieldCheck size={10} />
        {loading ? '正在创建体验账号…' : demoText('评委演示入口（独立体验账号 + 安全控制台）', '评委控制台（独立体验账号）')}
      </button>
    );
  }
  return (
    <button
      onClick={enter}
      disabled={loading}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#0f3d33]/15 bg-[#0f3d33]/[0.035] py-2.5 text-[10.5px] font-medium text-[#2f5b4c] transition hover:bg-[#0f3d33]/[0.07]"
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
      {demoText('一键体验（生成独立演示账户）', '一键体验')}
    </button>
  );
}

export function LoginPage() {
  const { login, loginMfa } = useAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfa, setMfa] = useState<{ challengeId?: string; demoCode?: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError('请输入 11 位手机号');
      return;
    }
    if (password.length < 6) {
      setError('密码至少 6 位');
      return;
    }
    setLoading(true);
    try {
      const result = await login(phone, password);
      if (result.mfaRequired) {
        setMfa({ challengeId: result.challengeId, demoCode: result.demoCode });
        if (result.demoCode) setCode(result.demoCode);
        setError('');
        return;
      }
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const submitMfa = async (event: FormEvent) => {
    event.preventDefault();
    if (code.length !== 6) return setError('请输入 6 位验证码');
    setLoading(true);
    try {
      await loginMfa({ phone, code, challengeId: mfa?.challengeId });
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '二次验证失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="auth-card p-5 sm:p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[19px] font-semibold text-[#14251f]">欢迎回来</div>
            <p className="mt-1 text-[9.5px] text-[#7c8b82]">登录你的 AI 银行管家账户</p>
          </div>
          <Badge tone="green">
            <LockKeyhole size={8} /> 安全登录
          </Badge>
        </div>

        <form onSubmit={mfa ? submitMfa : submit} className="mt-5 space-y-3.5">
          <Field label="手机号">
            <input
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value.replace(/\D/g, '').slice(0, 11));
                setMfa(null);
                setCode('');
              }}
              placeholder="请输入 11 位手机号"
              inputMode="numeric"
              autoComplete="tel"
              className="auth-input"
            />
          </Field>
          {!mfa ? (
            <Field label="密码">
              <PasswordInput
                value={password}
                onChange={setPassword}
                placeholder="至少 6 位"
                autoComplete="current-password"
              />
            </Field>
          ) : (
            <Field label="登录二次验证码">
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6 位验证码"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="auth-input tracking-[0.2em]"
              />
              <span className="mt-1 block text-[9px] text-[#6f7c74]">
                {mfa.demoCode
                  ? demoText(`演示验证码 ${mfa.demoCode}（已自动填入）`, `验证码 ${mfa.demoCode} 已自动填入`)
                  : '验证码已发送至预留手机号，5 分钟内有效'}
              </span>
            </Field>
          )}
          <AuthError message={error} />
          <button
            type="submit"
            disabled={loading || (Boolean(mfa) && code.length !== 6)}
            className={clsx(
              'flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-medium text-[#f4f1ec] transition',
              loading || (Boolean(mfa) && code.length !== 6)
                ? 'cursor-wait bg-[#7c8b82]'
                : 'bg-[#0F3D33] hover:bg-[#155246]',
            )}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : null}
            {loading ? '验证中…' : mfa ? '完成二次验证' : '登录'}
            {!loading ? <ArrowRight size={12} /> : null}
          </button>
          {mfa ? (
            <button
              type="button"
              onClick={() => {
                setMfa(null);
                setCode('');
                setError('');
              }}
              className="flex w-full items-center justify-center gap-1 text-[9px] text-[#7c8b82] hover:text-[#2f5b4c]"
            >
              <ArrowLeft size={10} /> 返回密码登录
            </button>
          ) : null}
        </form>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-black/[0.07]" />
          <span className="text-[9px] text-[#a2aaa4]">或</span>
          <div className="h-px flex-1 bg-black/[0.07]" />
        </div>

        <GuestButtons mode="app" />

        <div className="mt-4 flex items-center justify-between text-[9px] text-[#7c8b82]">
          <span>
            还没有账户？
            <button onClick={() => navigate('/register')} className="ml-1 font-medium text-[#8c6c2f] hover:underline">
              创建账户
            </button>
          </span>
          <button onClick={() => navigate('/forgot-password')} className="font-medium text-[#8c6c2f] hover:underline">
            忘记密码？
          </button>
        </div>

        <div className="mt-4 border-t border-black/[0.055] pt-3">
          <GuestButtons mode="console" />
        </div>
      </div>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const publicConfig = usePublicConfig();
  const navigate = useNavigate();
  const requireOtp = publicConfig?.auth?.phoneVerifyRequired !== false;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [demoCode, setDemoCode] = useState<string | undefined>();
  const [spouseName, setSpouseName] = useState('林晚');
  const [spouseBirthday, setSpouseBirthday] = useState('1992-11-02');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { cooldown, setCooldown } = useCooldown();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!name.trim()) return setError('请输入姓名');
    if (!/^1[3-9]\d{9}$/.test(phone)) return setError('请输入 11 位手机号');
    if (password.length < 6) return setError('密码至少 6 位');
    if (password !== confirm) return setError('两次输入的密码不一致');
    if (requireOtp && otpCode.length !== 6) return setError('请填写 6 位短信验证码');
    setLoading(true);
    try {
      await register({
        name: name.trim(),
        phone,
        password,
        otpCode: requireOtp ? otpCode : undefined,
        spouseName: spouseName.trim() || undefined,
        spouseBirthday: spouseBirthday || undefined,
      });
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="auth-card p-5 sm:p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[19px] font-semibold text-[#14251f]">创建账户</div>
            <p className="mt-1 text-[9.5px] text-[#7c8b82]">
              {requireOtp
                ? demoText('手机号验证后生成独立演示账户与 6 个月合成流水', '手机号验证后创建账户，账户数据彼此隔离')
                : demoText('生成一套独立的演示账户与 6 个月合成流水', '创建属于你的独立账户空间，数据彼此隔离')}
            </p>
          </div>
          {DEMO_LABELS ? <Badge tone="gold">演示数据</Badge> : null}
        </div>

        <form onSubmit={submit} className="mt-5 space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="姓名">
              <input
                value={name}
                onChange={(event) => setName(event.target.value.slice(0, 20))}
                placeholder="怎么称呼你"
                autoComplete="name"
                className="auth-input"
              />
            </Field>
            <Field label="手机号">
              <input
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value.replace(/\D/g, '').slice(0, 11));
                  setOtpSent(false);
                  setOtpCode('');
                }}
                placeholder="11 位手机号"
                inputMode="numeric"
                autoComplete="tel"
                className="auth-input"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="密码">
              <PasswordInput
                value={password}
                onChange={setPassword}
                placeholder="至少 6 位"
                autoComplete="new-password"
              />
            </Field>
            <Field label="确认密码">
              <PasswordInput
                value={confirm}
                onChange={setConfirm}
                placeholder="再输入一次"
                autoComplete="new-password"
              />
            </Field>
          </div>

          {requireOtp ? (
            <OtpField
              phone={phone}
              scene="register"
              code={otpCode}
              onCodeChange={setOtpCode}
              sent={otpSent}
              demoCode={demoCode}
              cooldown={cooldown}
              onSent={(result) => {
                setOtpSent(true);
                setCooldown(result.cooldownSec ?? 60);
                setDemoCode(result.demoCode);
                if (result.demoCode) setOtpCode(result.demoCode);
              }}
              onError={setError}
            />
          ) : null}

          <div className="rounded-xl border border-[#c7a667]/20 bg-[#c7a667]/[0.045] p-3">
            <div className="flex items-center gap-1.5 text-[9.5px] font-medium text-[#7d5f27]">
              <Sparkles size={10} /> 生日联动资料
            </div>
            <p className="mt-1 text-[9px] leading-relaxed text-[#9a8460]">
              {demoText('用于“爱人生日”跨场景演示，可稍后在「我的」修改。', '用于“爱人生日”跨场景安排，可稍后在「我的」修改。')}
            </p>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-2">
              <Field label="爱人昵称">
                <input
                  value={spouseName}
                  onChange={(event) => setSpouseName(event.target.value.slice(0, 20))}
                  className="auth-input !py-2 min-w-0"
                />
              </Field>
              <Field label="爱人生日">
                <input
                  type="date"
                  value={spouseBirthday}
                  onChange={(event) => setSpouseBirthday(event.target.value)}
                  className="auth-input !py-2"
                />
              </Field>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-black/[0.06] bg-black/[0.02] px-3 py-2.5 text-[9.5px] leading-relaxed text-[#7c8b82]">
            <ShieldCheck size={12} className="mt-0.5 shrink-0 text-[#0f3d33]" />
            风险等级不在注册时手填：进入 App 后在「我的 · 风险测评」完成测评，测评结果决定可购买的理财产品等级。
          </div>

          <AuthError message={error} />

          <button
            type="submit"
            disabled={loading}
            className={clsx(
              'flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-medium text-[#f4f1ec] transition',
              loading ? 'cursor-wait bg-[#7c8b82]' : 'bg-[#0F3D33] hover:bg-[#155246]',
            )}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <UserRound size={12} />}
            {loading ? '创建中…' : '创建并进入 App'}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-center gap-2 text-[9px] text-[#7c8b82]">
          <span>已有账户？</span>
          <button onClick={() => navigate('/login')} className="font-medium text-[#8c6c2f] hover:underline">
            返回登录
          </button>
        </div>
      </div>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const { requestPasswordReset, verifyPasswordReset, confirmPasswordReset } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<'phone' | 'code' | 'password'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoCode, setDemoCode] = useState<string | undefined>();
  const [sent, setSent] = useState(false);
  const { cooldown, setCooldown } = useCooldown();

  const request = async () => {
    setError('');
    if (!/^1[3-9]\d{9}$/.test(phone)) return setError('请输入 11 位手机号');
    setLoading(true);
    try {
      const result = await requestPasswordReset(phone);
      if (!result.ok) return setError(result.message ?? '验证码发送失败');
      setSent(true);
      setStep('code');
      setCooldown(result.cooldownSec ?? 60);
      setDemoCode(result.demoCode);
      if (result.demoCode) setCode(result.demoCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码发送失败');
    } finally {
      setLoading(false);
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (code.length !== 6) return setError('请输入 6 位验证码');
    setLoading(true);
    try {
      const result = await verifyPasswordReset(phone, code);
      setResetToken(result.resetToken);
      setStep('password');
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码校验失败');
    } finally {
      setLoading(false);
    }
  };

  const finish = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password.length < 6) return setError('新密码至少 6 位');
    if (password !== confirm) return setError('两次输入的密码不一致');
    setLoading(true);
    try {
      await confirmPasswordReset(resetToken, password);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '密码重置失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="auth-card p-5 sm:p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[19px] font-semibold text-[#14251f]">找回密码</div>
            <p className="mt-1 text-[9.5px] text-[#7c8b82]">
              {step === 'phone' ? '验证注册手机号' : step === 'code' ? '输入 6 位短信验证码' : '设置新密码'}
            </p>
          </div>
          <Badge tone="green">
            <KeyRound size={8} /> {step === 'phone' ? '1 / 3' : step === 'code' ? '2 / 3' : '3 / 3'}
          </Badge>
        </div>

        <form onSubmit={step === 'code' ? verify : step === 'password' ? finish : undefined} className="mt-5 space-y-3.5">
          {step === 'phone' ? (
            <>
              <Field label="手机号">
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))}
                  placeholder="请输入 11 位手机号"
                  inputMode="numeric"
                  autoComplete="tel"
                  className="auth-input"
                />
              </Field>
              <button
                type="button"
                onClick={() => void request()}
                disabled={loading}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#0F3D33] py-2.5 text-[11px] font-medium text-[#f4f1ec] hover:bg-[#155246]"
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <Check size={12} />}
                获取验证码
              </button>
            </>
          ) : null}

          {step === 'code' ? (
            <>
              <OtpField
                phone={phone}
                scene="reset"
                code={code}
                onCodeChange={setCode}
                sent={sent}
                demoCode={demoCode}
                cooldown={cooldown}
                onSent={(result) => {
                  setSent(true);
                  setCooldown(result.cooldownSec ?? 60);
                  setDemoCode(result.demoCode);
                  if (result.demoCode) setCode(result.demoCode);
                }}
                onError={setError}
              />
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#0F3D33] py-2.5 text-[11px] font-medium text-[#f4f1ec] disabled:bg-[#7c8b82]"
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : null}
                验证并继续
              </button>
            </>
          ) : null}

          {step === 'password' ? (
            <>
              <Field label="新密码">
                <PasswordInput value={password} onChange={setPassword} placeholder="至少 6 位" autoComplete="new-password" />
              </Field>
              <Field label="确认新密码">
                <PasswordInput value={confirm} onChange={setConfirm} placeholder="再输入一次" autoComplete="new-password" />
              </Field>
              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#0F3D33] py-2.5 text-[11px] font-medium text-[#f4f1ec] disabled:bg-[#7c8b82]"
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <Check size={12} />}
                重置并登录
              </button>
              <p className="text-center text-[9px] text-[#6f7c74]">重置成功后，其他设备登录状态会全部失效。</p>
            </>
          ) : null}

          <AuthError message={error} />
        </form>

        <div className="mt-4 flex items-center justify-between text-[9px] text-[#7c8b82]">
          <button onClick={() => navigate('/login')} className="font-medium text-[#8c6c2f] hover:underline">
            返回登录
          </button>
          <button onClick={() => navigate('/register')} className="font-medium text-[#8c6c2f] hover:underline">
            创建账户
          </button>
        </div>
      </div>
    </AuthShell>
  );
}
