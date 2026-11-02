import { useCallback, useEffect, useReducer, useRef } from 'react';
import type {
  AuditEntry,
  AuditVerification,
  BootstrapPayload,
  SnapshotPayload,
  StatsPayload,
  StreamEvent,
} from '@bank/shared';
import { api, ApiError } from '../api/client';
import { streamEvents } from '../api/sseClient';
import {
  agentReducer,
  initialAgentState,
  makeLocalUserMessage,
  type AgentState,
  type SheetKind,
  type ToastState,
} from './agentReducer';

const DEFAULT_SESSION_KEY = 'bank.session.id';
const ELDER_KEY = 'bank.elder';

export interface BankAgentOptions {
  sessionKey?: string;
  /** 产品端不需要 5 秒级审计/指标轮询；控制台保持实时。 */
  livePoll?: boolean;
}

export const SESSION_KEYS = {
  product: DEFAULT_SESSION_KEY,
  console: 'bank.console.session.id',
};

interface ControlResponse {
  ok: boolean;
  code?: string;
  message?: string;
  resume?: boolean;
  canceled?: boolean;
  locked?: boolean;
  needStepUp?: boolean;
  challenge?: any;
  attemptsLeft?: number;
  accepted?: boolean;
  snapshot?: SnapshotPayload;
}

function init(): AgentState {
  return {
    ...initialAgentState,
    elderMode: typeof window !== 'undefined' && localStorage.getItem(ELDER_KEY) === '1',
  };
}

export interface BankAgentApi {
  state: AgentState;
  send: (text: string) => Promise<void>;
  confirm: (approve?: boolean, payeeEcho?: string) => Promise<void>;
  cancel: () => Promise<void>;
  stepUp: (input: { faceDone: boolean; smsCode?: string }) => Promise<void>;
  sendStepUpCode: () => Promise<{ ok: boolean; demoCode?: string; message?: string; cooldownSec?: number }>;
  startFace: () => Promise<{ ok: boolean; mode?: 'demo' | 'http'; verifyUrl?: string; message?: string }>;
  checkFace: () => Promise<{ ok: boolean; status?: string; message?: string }>;
  interrupt: (mode: 'abort' | 'rollback') => Promise<void>;
  rollback: () => Promise<void>;
  takeover: (action: 'take' | 'release' | 'abort' | 'unlock') => Promise<void>;
  resetDemo: () => Promise<void>;
  setLlmMode: (mode: 'llm' | 'offline') => Promise<void>;
  setElder: (value: boolean) => void;
  setSheet: (value: SheetKind) => void;
  openPending: () => void;
  refreshSession: () => Promise<void>;
  refreshStats: () => Promise<void>;
  refreshAudit: () => Promise<void>;
  clearToast: () => void;
  verifyAudit: () => Promise<AuditVerification | null>;
}

export function useBankAgent(options: BankAgentOptions = {}): BankAgentApi {
  const sessionKey = options.sessionKey ?? DEFAULT_SESSION_KEY;
  const livePoll = options.livePoll !== false;
  const [state, dispatch] = useReducer(agentReducer, initialAgentState, init);
  const sessionIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const lastSeqRef = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    sessionIdRef.current = state.sessionId;
    if (state.sessionId) localStorage.setItem(sessionKey, state.sessionId);
  }, [state.sessionId]);

  useEffect(() => {
    busyRef.current = state.busy;
  }, [state.busy]);

  useEffect(() => {
    localStorage.setItem(ELDER_KEY, state.elderMode ? '1' : '0');
  }, [state.elderMode]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = useCallback((text: string, tone: ToastState['tone'] = 'normal') => {
    dispatch({ type: 'toast', toast: { text, tone } });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => dispatch({ type: 'clear-toast' }), 4200);
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const stats = await api.get<StatsPayload>('/api/stats');
      dispatch({ type: 'stats', stats });
    } catch {
      // 轮询失败不打扰演示
    }
  }, []);

  const refreshAudit = useCallback(async () => {
    try {
      const data = await api.get<{
        entries: AuditEntry[];
        verification: AuditVerification;
      }>('/api/audit?limit=140');
      dispatch({ type: 'audit', entries: data.entries.slice().reverse(), verification: data.verification });
    } catch {
      // ignore
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const snapshot = await api.get<SnapshotPayload>(`/api/session/${sid}`);
      dispatch({ type: 'snapshot', payload: snapshot });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        localStorage.removeItem(sessionKey);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = localStorage.getItem(sessionKey);
      try {
        const payload = await api.get<BootstrapPayload>(
          `/api/bootstrap${stored ? `?sessionId=${encodeURIComponent(stored)}` : ''}`,
        );
        if (cancelled) return;
        dispatch({ type: 'bootstrap', payload });
        if (payload.session.id) localStorage.setItem(sessionKey, payload.session.id);
        sessionIdRef.current = payload.session.id;
        lastSeqRef.current = 0;
        await Promise.allSettled(livePoll ? [refreshStats(), refreshAudit()] : [refreshStats()]);
      } catch (error) {
        if (!cancelled) {
          showToast(error instanceof Error ? error.message : '初始化失败，请确认后端已启动', 'danger');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshStats, refreshAudit, livePoll, showToast]);

  useEffect(() => {
    if (!livePoll) return;
    const timer = setInterval(() => {
      void refreshStats();
      void refreshAudit();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshStats, refreshAudit, livePoll]);

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      lastSeqRef.current = event.seq;
      dispatch({ type: 'event', event });
      if (event.type === 'run.end') {
        setTimeout(() => {
          void refreshSession();
          void refreshStats();
          if (livePoll) void refreshAudit();
        }, 220);
      }
      if (event.type === 'breaker.tripped') {
        void refreshStats();
      }
    },
    [refreshSession, refreshStats, refreshAudit, livePoll],
  );

  const runStream = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      busyRef.current = true;
      dispatch({ type: 'stream-started' });
      try {
        const result = await streamEvents(path, body, handleEvent);
        lastSeqRef.current = result.lastSeq || lastSeqRef.current;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'PENDING_CONFIRMATION') {
          await refreshSession();
        } else {
          showToast(error instanceof Error ? error.message : '流式连接中断', 'danger');
        }
      } finally {
        busyRef.current = false;
        dispatch({ type: 'stream-closed' });
      }
    },
    [handleEvent, refreshSession, showToast],
  );

  const send = useCallback(
    async (text: string) => {
      const sid = sessionIdRef.current;
      const message = text.trim();
      if (!sid || !message) return;
      if (busyRef.current) {
        showToast('上一项任务还在执行，请稍等', 'warning');
        return;
      }
      if (state.pending) {
        dispatch({ type: 'sheet', value: 'confirm' });
        showToast('请先完成待确认的操作', 'warning');
        return;
      }
      dispatch({
        type: 'user',
        message: makeLocalUserMessage(message, state.snapshot?.demoNow),
      });
      await runStream('/api/chat', {
        sessionId: sid,
        message,
        after: lastSeqRef.current || undefined,
      });
    },
    [runStream, showToast, state.pending, state.snapshot?.demoNow],
  );

  const resume = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    await runStream('/api/resume', {
      sessionId: sid,
      after: lastSeqRef.current || undefined,
    });
  }, [runStream]);

  const confirm = useCallback(
    async (approve = true, payeeEcho?: string) => {
      const sid = sessionIdRef.current;
      const pending = state.pending;
      if (!sid || !pending) return;
      try {
        const result = await api.post<ControlResponse>('/api/confirm', {
          sessionId: sid,
          nodeId: pending.nodeId,
          digest: pending.digest,
          approve,
          payeeEcho,
        });
        if (result.snapshot) dispatch({ type: 'snapshot', payload: result.snapshot });
        if (!result.ok) {
          showToast(result.message ?? '确认失败', 'danger');
          return;
        }
        if (result.needStepUp && result.challenge) {
          dispatch({ type: 'challenge', value: result.challenge });
          dispatch({ type: 'sheet', value: 'stepup' });
          return;
        }
        if (result.resume) {
          dispatch({ type: 'sheet', value: null });
          await resume();
        } else if (result.canceled) {
          showToast('已取消本次操作', 'normal');
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : '确认失败', 'danger');
      }
    },
    [resume, showToast, state.pending],
  );

  const cancel = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const result = await api.post<ControlResponse>('/api/cancel', { sessionId: sid });
      if (result.snapshot) dispatch({ type: 'snapshot', payload: result.snapshot });
      dispatch({ type: 'sheet', value: null });
      showToast('已取消，未发生资金变动', 'normal');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '取消失败', 'danger');
    }
  }, [showToast]);

  const stepUp = useCallback(
    async (input: { faceDone: boolean; smsCode?: string }) => {
      const sid = sessionIdRef.current;
      const challenge = state.challenge;
      if (!sid || !challenge) return;
      try {
        const result = await api.post<ControlResponse>('/api/stepup', {
          sessionId: sid,
          challengeId: challenge.id,
          faceDone: input.faceDone,
          smsCode: input.smsCode,
        });
        if (result.snapshot) dispatch({ type: 'snapshot', payload: result.snapshot });
        if (!result.ok) {
          if (result.locked || result.canceled) {
            dispatch({ type: 'sheet', value: null });
            if (result.snapshot) dispatch({ type: 'snapshot', payload: result.snapshot });
          }
          showToast(result.message ?? '强验证未通过', 'danger');
          return;
        }
        if (result.resume) {
          dispatch({ type: 'sheet', value: null });
          dispatch({ type: 'challenge', value: null });
          await resume();
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : '强验证失败', 'danger');
      }
    },
    [resume, showToast, state.challenge],
  );

  const sendStepUpCode = useCallback(async () => {
    const sid = sessionIdRef.current;
    const challenge = state.challenge;
    if (!sid || !challenge) return { ok: false, message: '验证挑战不存在' };
    try {
      const result = await api.post<any>('/api/stepup/send', {
        sessionId: sid,
        challengeId: challenge.id,
      });
      if (result.snapshot) dispatch({ type: 'snapshot', payload: result.snapshot });
      return result;
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '验证码发送失败' };
    }
  }, [state.challenge]);

  const startFace = useCallback(async () => {
    const sid = sessionIdRef.current;
    const challenge = state.challenge;
    if (!sid || !challenge) return { ok: false, message: '验证挑战不存在' };
    try {
      const result = await api.post<any>('/api/stepup/face/start', {
        sessionId: sid,
        challengeId: challenge.id,
      });
      if (result.snapshot) dispatch({ type: 'snapshot', payload: result.snapshot });
      return result;
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '人脸核验启动失败' };
    }
  }, [state.challenge]);

  const checkFace = useCallback(async () => {
    const sid = sessionIdRef.current;
    const challenge = state.challenge;
    if (!sid || !challenge) return { ok: false, message: '验证挑战不存在' };
    try {
      return await api.post<any>('/api/stepup/face/status', {
        sessionId: sid,
        challengeId: challenge.id,
      });
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '查询人脸核验失败' };
    }
  }, [state.challenge]);

  const interrupt = useCallback(
    async (mode: 'abort' | 'rollback') => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        const result = await api.post<ControlResponse>('/api/interrupt', { sessionId: sid, mode });
        if (result.snapshot) dispatch({ type: 'snapshot', payload: result.snapshot });
        if (result.canceled) dispatch({ type: 'sheet', value: null });
        showToast(result.message ?? (result.ok ? '中断请求已发送' : '当前没有可中断的任务'), result.ok ? 'warning' : 'normal');
      } catch (error) {
        showToast(error instanceof Error ? error.message : '中断失败', 'danger');
      }
    },
    [showToast],
  );

  const rollback = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const result = await api.post<ControlResponse>('/api/rollback', { sessionId: sid });
      if (result.snapshot) dispatch({ type: 'snapshot', payload: result.snapshot });
      showToast(result.message ?? (result.ok ? '已执行回退' : '暂无可回退操作'), result.ok ? 'success' : 'warning');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '回退失败', 'danger');
    }
  }, [showToast]);

  const takeover = useCallback(
    async (action: 'take' | 'release' | 'abort' | 'unlock') => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        const result = await api.post<ControlResponse>('/api/takeover', { sessionId: sid, action });
        if (result.snapshot) dispatch({ type: 'snapshot', payload: result.snapshot });
        if (result.resume) {
          await resume();
        }
        const labels: Record<string, string> = {
          take: '已切换人工接管',
          release: '已恢复自动执行',
          abort: '已终止任务',
          unlock: '安全锁定已解除',
        };
        showToast(result.message ?? labels[action], 'normal');
      } catch (error) {
        showToast(error instanceof Error ? error.message : '操作失败', 'danger');
      }
    },
    [resume, showToast],
  );

  const resetDemo = useCallback(async () => {
    try {
      const payload = await api.post<BootstrapPayload>('/api/demo/reset');
      dispatch({ type: 'reset', payload });
      lastSeqRef.current = 0;
      sessionIdRef.current = payload.session.id;
      localStorage.setItem(sessionKey, payload.session.id);
      await Promise.allSettled(livePoll ? [refreshStats(), refreshAudit()] : [refreshStats()]);
      showToast('演示数据已重置', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '重置失败', 'danger');
    }
  }, [refreshAudit, refreshStats, livePoll, showToast]);

  const setLlmMode = useCallback(
    async (mode: 'llm' | 'offline') => {
      try {
        await api.post('/api/llm/mode', { mode });
        await refreshStats();
        showToast(mode === 'offline' ? '已切换离线规则引擎' : '已切换在线 LLM 解析', 'normal');
      } catch (error) {
        showToast(error instanceof Error ? error.message : '切换失败', 'danger');
      }
    },
    [refreshStats, showToast],
  );

  const verifyAudit = useCallback(async (): Promise<AuditVerification | null> => {
    try {
      const verification = await api.get<AuditVerification>('/api/audit/verify');
      await refreshAudit();
      return verification;
    } catch (error) {
      showToast(error instanceof Error ? error.message : '审计校验失败', 'danger');
      return null;
    }
  }, [refreshAudit, showToast]);

  return {
    state,
    send,
    confirm,
    cancel,
    stepUp,
    sendStepUpCode,
    startFace,
    checkFace,
    interrupt,
    rollback,
    takeover,
    resetDemo,
    setLlmMode,
    setElder: (value) => dispatch({ type: 'elder', value }),
    setSheet: (value) => dispatch({ type: 'sheet', value }),
    openPending: () => {
      if (state.pending) dispatch({ type: 'sheet', value: 'confirm' });
    },
    refreshSession,
    refreshStats,
    refreshAudit,
    clearToast: () => dispatch({ type: 'clear-toast' }),
    verifyAudit,
  };
}
