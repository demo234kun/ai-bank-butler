import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Accessibility,
  ArrowUpRight,
  ChevronRight,
  Database,
  Download,
  Fingerprint,
  Gauge,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { BRAND, formatDateTime, formatMoney } from '@bank/shared';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth, type AuthSessionPublic } from '../auth/AuthContext';
import { useAgent } from './AgentContext';
import { useProductData } from './ProductDataContext';
import { useInstallPrompt } from '../pwa/useInstallPrompt';
import { Badge, ProgressBar } from '../components/ui/primitives';
import { RiskAssessmentSheet } from './RiskAssessmentSheet';
import { DEMO_LABELS, label } from '../lib/disclosure';
import {
  enrollPasskey,
  listPasskeys,
  passkeySupported,
  revokePasskey,
  type PasskeyRecord,
} from '../lib/passkey';

export function ProfilePage() {
  const {
    user,
    refresh: refreshAuth,
    logout,
    sessions: fetchSessions,
    revokeSession,
    revokeOtherSessions,
    changePassword,
  } = useAuth();
  const { overview, refresh, loading } = useProductData();
  const agent = useAgent();
  const navigate = useNavigate();
  const install = useInstallPrompt();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [devices, setDevices] = useState<AuthSessionPublic[]>([]);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const [riskOpen, setRiskOpen] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [passkeyEnabled, setPasskeyEnabled] = useState(true);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [form, setForm] = useState({
    name: user?.name ?? '',
    spouseName: user?.spouseName ?? '',
    spouseBirthday: user?.spouseBirthday ?? '',
  });

  const loadDevices = useCallback(async () => {
    setDeviceLoading(true);
    try {
      setDevices(await fetchSessions());
    } catch {
      setDevices([]);
    } finally {
      setDeviceLoading(false);
    }
  }, [fetchSessions]);

  const loadPasskeys = useCallback(async () => {
    if (!passkeySupported()) return;
    try {
      const data = await listPasskeys();
      setPasskeys(data.credentials);
      setPasskeyEnabled(data.enabled);
    } catch {
      setPasskeys([]);
    }
  }, []);

  useEffect(() => {
    if (user) void loadDevices();
  }, [loadDevices, user]);

  useEffect(() => {
    if (user) void loadPasskeys();
  }, [loadPasskeys, user]);

  if (!user) return null;

  const offline = (agent.state.stats?.llm.mode ?? 'llm') === 'offline';
  const limits = overview?.limits;
  const risk = overview?.risk;
  const riskDetail = risk
    ? `${risk.profile.level} · ${risk.profile.score} 分 · 最高可购 ${risk.maxProductRisk}${
        risk.expired ? ' · 测评已过期' : ''
      }`
    : user.riskLevel;

  const openEdit = () => {
    setForm({
      name: user.name,
      spouseName: user.spouseName,
      spouseBirthday: user.spouseBirthday,
    });
    setEditing(true);
    setMessage(null);
  };

  const saveProfile = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await api.post('/api/profile', {
        name: form.name,
        spouseName: form.spouseName,
        spouseBirthday: form.spouseBirthday,
      });
      await refreshAuth();
      await refresh();
      setEditing(false);
      setMessage('资料已更新');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const resetDemo = async () => {
    const confirmText = label(
      '重置当前账号的演示数据？账户、流水与额度会恢复初始状态。',
      '重置本地数据？账户、流水与额度会恢复初始状态。',
    );
    if (!window.confirm(confirmText)) return;
    await agent.resetDemo();
    await refresh();
    setMessage(label('演示数据已重置', '本地数据已重置'));
  };

  const doLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const revokeDevice = async (sessionId: string) => {
    const result = await revokeSession(sessionId);
    setDevices(result.sessions);
    setMessage(result.signedOut ? '当前设备已退出' : '该设备登录已撤销');
    if (result.signedOut) navigate('/login', { replace: true });
  };

  const revokeOthers = async () => {
    const result = await revokeOtherSessions();
    setDevices(result.sessions);
    setMessage(`已撤销 ${result.revoked} 台其他设备`);
  };

  const submitPassword = async () => {
    if (passwordForm.newPassword.length < 6) return setMessage('新密码至少 6 位');
    if (passwordForm.newPassword !== passwordForm.confirm) return setMessage('两次输入的新密码不一致');
    setPasswordSaving(true);
    try {
      const result = await changePassword(passwordForm.oldPassword, passwordForm.newPassword);
      setPasswordOpen(false);
      setPasswordForm({ oldPassword: '', newPassword: '', confirm: '' });
      setMessage(`密码已修改，${result.revokedSessions} 台其他设备已退出`);
      await loadDevices();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '密码修改失败');
    } finally {
      setPasswordSaving(false);
    }
  };

  const installApp = async () => {
    if (install.canPrompt) {
      const accepted = await install.promptInstall();
      setMessage(accepted ? '已添加到主屏' : '已取消安装');
      return;
    }
    setMessage(
      install.isIOS
        ? '在 Safari 中点击「分享」→「添加到主屏幕」即可安装'
        : '在浏览器菜单中选择「安装应用 / 添加到主屏幕」',
    );
  };

  return (
    <div className="pb-6">
      <section className="home-hero relative overflow-hidden rounded-b-[30px] px-5 pb-10 safe-top">
        <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full border border-[#c7a667]/15" />
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#c7a667]/40 bg-[#c7a667]/12 text-[18px] font-medium text-[#f0dfb8]">
              {user.name.slice(0, 1)}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-[19px] font-semibold text-[#f8f5ee]">{user.name}</h1>
                {user.isGuest ? <Badge tone="gold">体验账户</Badge> : null}
              </div>
              <div className="mt-1 text-[9.5px] text-white/65">
                {user.tier} · {user.phoneMasked}
              </div>
            </div>
          </div>
          <button
            onClick={openEdit}
            className="flex items-center gap-1 rounded-full border border-white/12 bg-white/[0.055] px-2.5 py-1.5 text-[9px] text-white/65"
          >
            <Pencil size={9} /> 编辑
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/8 bg-white/[0.05] px-3 py-2.5">
            <div className="text-[9px] text-white/65">当日小额剩余</div>
            <div className="mt-1 text-[13px] font-semibold tabular text-[#f4f1ec]">
              {formatMoney(limits?.remainingCents ?? 0)}
            </div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.05] px-3 py-2.5">
            <div className="text-[9px] text-white/65">审计链</div>
            <div className="mt-1 flex items-center gap-1 text-[12px] font-semibold text-[#a6e0c5]">
              <ShieldCheck size={11} />
              {overview?.audit.verified ? '完整' : '待校验'}
            </div>
          </div>
        </div>
      </section>

      {message ? (
        <div className="mx-4 mt-3 rounded-lg border border-[#2f7d5b]/20 bg-[#2f7d5b]/[0.06] px-3 py-2 text-[9px] text-[#2f5b4c]">
          {message}
        </div>
      ) : null}

      <section className="mt-3 px-4">
        <div className="overflow-hidden rounded-[18px] border border-black/[0.055] bg-[#FBFAF7] shadow-card">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <Fingerprint size={14} className="text-[#0f3d33]" />
              <div>
                <div className="text-[10.5px] font-medium text-[#23352d]">安全与会话</div>
                <div className="mt-0.5 text-[9px] text-[#6f7c74]">
                  {limits?.dayKey} · 审计 {overview?.audit.count ?? 0} 条
                </div>
              </div>
            </div>
            <button
              onClick={() => navigate('/console')}
              className="flex items-center gap-1 rounded-full bg-[#0F3D33] px-2.5 py-1.5 text-[9.5px] text-[#f4f1ec]"
            >
              评委控制台 <ArrowUpRight size={9} />
            </button>
          </div>
          <div className="border-t border-black/[0.045] px-4 py-2.5">
            <div className="flex items-center justify-between text-[9px] text-[#6f7c74]">
              <span>当日小额转账额度</span>
              <span className="tabular">
                {formatMoney(limits?.usedCents ?? 0)} / {formatMoney(limits?.dailyLimitCents ?? 100000)}
              </span>
            </div>
            <ProgressBar
              value={limits?.usedCents ?? 0}
              max={limits?.dailyLimitCents ?? 100000}
              tone={(limits?.remainingCents ?? 0) <= 0 ? 'red' : 'gold'}
              height={3}
              className="mt-1.5"
            />
          </div>
        </div>
      </section>

      <section className="mt-3 px-4">
        <div className="rounded-[18px] border border-black/[0.055] bg-[#FBFAF7] shadow-card">
          <SectionTitle icon={<MonitorSmartphone size={13} />} title="登录与安全" />
          <SettingRow
            icon={<KeyRound size={13} />}
            label="修改密码"
            detail="修改成功后，其他设备登录状态失效"
            onClick={() => {
              setPasswordOpen(true);
              setMessage(null);
            }}
          />
          <SettingRow
            icon={<Fingerprint size={13} />}
            label="本机生物识别（指纹 / 面容）"
            detail={
              !passkeyEnabled
                ? '服务端未开启'
                : !passkeySupported()
                  ? '当前浏览器不支持通行密钥'
                  : passkeys.length
                    ? `已录入 ${passkeys.length} 个，红色转账可直接用它确认`
                    : label('开启后强验证无需页面人脸模拟', '开启后强验证可直接用指纹 / 面容确认')
            }
            onClick={() => {
              if (!passkeyEnabled || !passkeySupported() || passkeyBusy) return;
              setPasskeyBusy(true);
              void enrollPasskey('本机设备').then((result) => {
                setPasskeyBusy(false);
                setMessage(result.ok ? '生物识别已录入，可直接用于强验证' : result.message ?? '录入失败');
                if (result.ok) void loadPasskeys();
              });
            }}
          />
          {passkeys.length ? (
            <div className="border-t border-black/[0.045] px-4 py-2">
              {passkeys.map((item) => (
                <div key={item.fullId} className="flex items-center justify-between gap-3 py-1.5">
                  <div className="min-w-0">
                    <div className="text-[9px] font-medium text-[#23352d]">
                      {item.label} · {item.id}…
                    </div>
                    <div className="mt-0.5 text-[7.5px] text-[#6f7c74]">
                      {formatDateTime(item.registeredAt)} 录入 ·{' '}
                      {item.transports.length ? item.transports.join('/') : 'internal'}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      void revokePasskey(item.fullId).then((result) => {
                        setMessage(result.ok ? '已删除该通行密钥' : result.message ?? '删除失败');
                        void loadPasskeys();
                      })
                    }
                    aria-label={`删除 ${item.label}`}
                    className="shrink-0 rounded-full p-1.5 text-[#6f7c74] transition hover:bg-[#b3392e]/[0.06] hover:text-[#9e3f35]"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="border-t border-black/[0.045] px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-medium text-[#23352d]">登录设备</div>
                <div className="mt-0.5 text-[9px] text-[#6f7c74]">
                  {deviceLoading ? '正在读取…' : `${devices.length} 个有效会话`}
                </div>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => void loadDevices()}
                  className="rounded-full border border-black/[0.08] px-2 py-1 text-[9px] text-[#7c8b82] hover:bg-black/[0.025]"
                >
                  刷新
                </button>
                <button
                  onClick={() => void revokeOthers()}
                  disabled={devices.filter((item) => !item.current).length === 0}
                  className="rounded-full border border-[#b3392e]/15 px-2 py-1 text-[9px] text-[#9e3f35] disabled:opacity-35"
                >
                  退出其他设备
                </button>
              </div>
            </div>
            <div className="mt-2 divide-y divide-black/[0.04]">
              {devices.map((session) => (
                <div key={session.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[9.5px] font-medium text-[#23352d]">
                      {session.device}
                      {session.current ? <Badge tone="green">当前</Badge> : null}
                    </div>
                    <div className="mt-0.5 truncate text-[8.5px] text-[#6f7c74]">
                      最近 {formatDateTime(session.lastSeenAt)} · IP {maskIp(session.ip)}
                    </div>
                  </div>
                  {!session.current ? (
                    <button
                      onClick={() => void revokeDevice(session.id)}
                      aria-label={`撤销 ${session.device} 登录`}
                      title="撤销此设备"
                      className="shrink-0 rounded-full p-1.5 text-[#6f7c74] transition hover:bg-[#b3392e]/[0.06] hover:text-[#9e3f35]"
                    >
                      <Trash2 size={12} />
                    </button>
                  ) : null}
                </div>
              ))}
              {!deviceLoading && devices.length === 0 ? (
                <div className="py-3 text-center text-[9.5px] text-[#6f7c74]">暂无登录设备记录</div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-3 px-4">
        <div className="rounded-[18px] border border-black/[0.055] bg-[#FBFAF7] shadow-card">
          <SectionTitle icon={<UserRound size={13} />} title="资料与偏好" />
          <SettingRow
            icon={<Sparkles size={13} />}
            label="爱人资料"
            detail={`${user.spouseName || '未设置'} · ${user.spouseBirthday || '未设置生日'}`}
            onClick={openEdit}
          />
          <SettingRow
            icon={<Gauge size={13} />}
            label="风险测评"
            detail={riskDetail}
            onClick={() => {
              setRiskOpen(true);
              setMessage(null);
            }}
          />
          <SettingRow
            icon={<Accessibility size={13} />}
            label="适老模式"
            detail="更大字号，确认前二次核对"
            toggle={agent.state.elderMode}
            onClick={() => agent.setElder(!agent.state.elderMode)}
          />
          <SettingRow
            icon={<ShieldCheck size={13} />}
            label="离线兜底"
            detail={offline ? 'LLM 不可用时由规则引擎接管' : '在线 DeepSeek 解析'}
            toggle={offline}
            onClick={() => void agent.setLlmMode(offline ? 'llm' : 'offline')}
            last
          />
        </div>
      </section>

      <section className="mt-3 px-4">
        <div className="rounded-[18px] border border-black/[0.055] bg-[#FBFAF7] shadow-card">
          <SectionTitle icon={<Smartphone size={13} />} title={label('应用与演示', '应用与数据')} />
          <SettingRow
            icon={<Database size={13} />}
            label="账户数据源"
            detail={
              overview?.dataSource?.mode === 'http'
                ? `${overview.dataSource.provider} · ${overview.dataSource.healthy ? '已同步' : '连接异常，点此重试'}`
                : '本地仿真核心 · 点此刷新'
            }
            onClick={() => void refresh()}
          />
          <SettingRow
            icon={<Download size={13} />}
            label={install.installed ? '已安装到设备' : '添加到主屏幕'}
            detail={install.installed ? '以独立窗口运行' : '像原生 App 一样全屏使用'}
            onClick={() => void installApp()}
          />
          <SettingRow
            icon={<RefreshCw size={13} />}
            label={overview?.dataSource?.mode === 'http' ? '重置本地会话与额度' : label('重置演示数据', '重置本地数据')}
            detail={
              overview?.dataSource?.mode === 'http'
                ? '从银行核心重新同步数据，不修改行方账务'
                : '仅重置当前账号的账户、流水与额度'
            }
            onClick={() => void resetDemo()}
          />
          <SettingRow
            icon={<LogOut size={13} />}
            label="退出登录"
            detail="清除当前浏览器登录态"
            onClick={() => void doLogout()}
            last
          />
        </div>
      </section>

      <section className="mt-4 px-4 text-center">
        <div className="text-[9px] leading-relaxed text-[#6f7c74]">
          {BRAND.name} ·{' '}
          {overview?.dataSource?.mode === 'http'
            ? '合作银行接入'
            : DEMO_LABELS
              ? '演示环境'
              : '安全通道'}
          <br />
          {overview?.dataSource?.mode === 'http'
            ? `${overview.dataSource.provider} · ${overview.dataSource.healthy ? '数据已同步' : '数据源异常'}；核验通道 ${overview.dataSource.mode === 'http' ? '由服务端配置' : DEMO_LABELS ? '演示' : '本机'}}`
            : label(
                '账户、流水、人脸与短信验证均为合成模拟，不连接真实银行核心',
                '数据经加密通道同步 · 资金操作按风险等级分级确认',
              )}
        </div>
      </section>

      {editing ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/35 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-[430px] rounded-t-[26px] bg-[#FBFAF7] p-5 shadow-2xl sm:rounded-[24px]">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[16px] font-semibold text-[#14251f]">编辑资料</div>
                <div className="mt-1 text-[9.5px] leading-relaxed text-[#6f7c74]">
                  爱人资料用于生日联动场景；风险等级需通过「我的 · 风险测评」获得，不支持手动修改
                </div>
              </div>
              <button
                onClick={() => setEditing(false)}
                aria-label="关闭编辑资料"
                className="rounded-full p-1 text-[#6f7c74] transition hover:bg-black/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f3d33]/25"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="auth-label">姓名</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value.slice(0, 20) })}
                  className="auth-input"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="auth-label">爱人昵称</span>
                  <input
                    value={form.spouseName}
                    onChange={(event) => setForm({ ...form, spouseName: event.target.value.slice(0, 20) })}
                    className="auth-input"
                  />
                </label>
                <label className="block">
                  <span className="auth-label">爱人生日</span>
                  <input
                    type="date"
                    value={form.spouseBirthday}
                    onChange={(event) => setForm({ ...form, spouseBirthday: event.target.value })}
                    className="auth-input"
                  />
                </label>
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 rounded-xl border border-black/10 bg-white py-2.5 text-[10px] text-[#7c8b82]"
              >
                取消
              </button>
              <button
                onClick={() => void saveProfile()}
                disabled={saving || loading}
                className="flex flex-[1.5] items-center justify-center gap-1 rounded-xl bg-[#0F3D33] py-2.5 text-[10px] text-[#f4f1ec] disabled:opacity-60"
              >
                {saving ? '保存中…' : '保存资料'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {passwordOpen ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/35 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-[430px] rounded-t-[26px] bg-[#FBFAF7] p-5 shadow-2xl sm:rounded-[24px]">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[16px] font-semibold text-[#14251f]">修改密码</div>
                <div className="mt-1 text-[9.5px] leading-relaxed text-[#6f7c74]">
                  修改成功后，其他设备登录状态会全部失效，当前设备保持登录。
                </div>
              </div>
              <button
                onClick={() => setPasswordOpen(false)}
                aria-label="关闭修改密码"
                className="rounded-full p-1 text-[#6f7c74] transition hover:bg-black/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f3d33]/25"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="auth-label">原密码</span>
                <input
                  type="password"
                  value={passwordForm.oldPassword}
                  onChange={(event) => setPasswordForm({ ...passwordForm, oldPassword: event.target.value })}
                  autoComplete="current-password"
                  className="auth-input"
                />
              </label>
              <label className="block">
                <span className="auth-label">新密码</span>
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })}
                  autoComplete="new-password"
                  className="auth-input"
                />
              </label>
              <label className="block">
                <span className="auth-label">确认新密码</span>
                <input
                  type="password"
                  value={passwordForm.confirm}
                  onChange={(event) => setPasswordForm({ ...passwordForm, confirm: event.target.value })}
                  autoComplete="new-password"
                  className="auth-input"
                />
              </label>
            </div>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setPasswordOpen(false)}
                className="flex-1 rounded-xl border border-black/10 bg-white py-2.5 text-[10px] text-[#7c8b82]"
              >
                取消
              </button>
              <button
                onClick={() => void submitPassword()}
                disabled={passwordSaving}
                className="flex flex-[1.5] items-center justify-center gap-1 rounded-xl bg-[#0F3D33] py-2.5 text-[10px] text-[#f4f1ec] disabled:opacity-60"
              >
                {passwordSaving ? '保存中…' : '确认修改'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <RiskAssessmentSheet
        open={riskOpen}
        onClose={() => setRiskOpen(false)}
        onAssessed={async () => {
          await Promise.all([refresh(), refreshAuth()]);
          setMessage('风险测评已更新');
        }}
      />
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-black/[0.045] px-4 py-2.5">
      <span className="text-[#8c6c2f]">{icon}</span>
      <span className="text-[9.5px] font-medium text-[#7c8b82]">{title}</span>
    </div>
  );
}

function maskIp(ip: string): string {
  if (!ip) return '未知';
  if (ip.includes('.')) {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.*.*`;
  }
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}::***`;
  return `${ip.slice(0, 5)}***`;
}

function SettingRow({
  icon,
  label,
  detail,
  toggle,
  onClick,
  last = false,
}: {
  icon: ReactNode;
  label: string;
  detail?: string;
  toggle?: boolean;
  onClick?: () => void;
  last?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-3 px-4 py-3 text-left transition active:bg-black/[0.025]',
        !last && 'border-b border-black/[0.045]',
      )}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0f3d33]/[0.05] text-[#0f3d33]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10.5px] text-[#23352d]">{label}</span>
        {detail ? <span className="mt-0.5 block truncate text-[9px] text-[#6f7c74]">{detail}</span> : null}
      </span>
      {typeof toggle === 'boolean' ? (
        <span
          className={clsx(
            'h-4 w-7 rounded-full p-0.5 transition',
            toggle ? 'bg-[#0f3d33]' : 'bg-black/15',
          )}
        >
          <span
            className={clsx(
              'block h-3 w-3 rounded-full bg-white transition',
              toggle && 'translate-x-3',
            )}
          />
        </span>
      ) : (
        <ChevronRight size={13} className="shrink-0 text-[#b2bab4]" />
      )}
    </button>
  );
}
