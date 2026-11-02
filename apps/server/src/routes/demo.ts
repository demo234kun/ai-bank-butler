import type { FastifyInstance } from 'fastify';
import { createSession, listSessions, listSessionsForUser, resetSessionsForUser } from '../agent/session';
import { resetChallengesForSessions } from '../policy/stepup';
import { revokeGrantsForUser } from '../policy/grant';
import { getState, resetUserState } from '../core/store';
import { metrics } from '../metrics';
import { audit } from '../security/auditChain';
import { clock } from '../core/clock';
import { resetSession } from '../sse/hub';
import { buildBootstrap } from './snapshot';
import { banking } from '../integration/banking';

export async function demoRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/demo/reset', async (request, reply) => {
    const user = request.authUser!;
    const oldSessions = listSessionsForUser(user.id).map((session) => session.id);
    resetUserState(user.id);
    if (banking.mode === 'http') {
      try {
        await banking.sync(user.id, { force: true });
      } catch (error) {
        return reply.code(503).send({
          ok: false,
          code: 'BANK_UNAVAILABLE',
          message: `重置后无法从银行核心同步：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    revokeGrantsForUser(user.id);
    resetChallengesForSessions(oldSessions);
    for (const id of oldSessions) resetSession(id);
    resetSessionsForUser(user.id);

    const session = createSession(user.id);
    session.llmMode = metrics.mode;
    audit.append(
      'DEMO_RESET',
      '演示数据已重置（仅当前账号）',
      { demoNow: clock.nowIso() },
      { sessionId: session.id, userId: user.id },
    );
    return buildBootstrap(session);
  });

  app.get('/api/llm/status', async () => ({
    ...metrics.llmStats(),
    mode: metrics.mode,
  }));

  app.post('/api/llm/mode', async (request, reply) => {
    const body = (request.body ?? {}) as { mode?: string };
    if (body.mode !== 'llm' && body.mode !== 'offline') {
      return reply.code(400).send({ ok: false, code: 'INVALID_MODE', message: 'mode 只能是 llm 或 offline' });
    }
    metrics.setMode(body.mode);
    for (const session of listSessions()) session.llmMode = metrics.mode;
    audit.append(
      'LLM_MODE_CHANGED',
      body.mode === 'offline' ? '切换为离线规则引擎' : '切换为在线 LLM 解析',
      { mode: body.mode },
      {},
    );
    return { ok: true, ...metrics.llmStats(), mode: metrics.mode };
  });

  app.get('/api/stats', async (request) => {
    const user = request.authUser!;
    return metrics.stats(getState(user.id), listSessionsForUser(user.id).length);
  });

  app.get('/api/health', async () => ({
    ok: true,
    service: 'ai-banking-agent',
    demoNow: clock.nowIso(),
    llmMode: metrics.mode,
    sessions: listSessions().length,
    auditHead: audit.headHash(),
    uptimeSec: Math.round(process.uptime()),
    banking: {
      mode: banking.mode,
      provider: banking.provider,
    },
  }));
}
