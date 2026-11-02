import type { FastifyInstance } from 'fastify';
import { audit } from '../security/auditChain';

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/audit', async (request) => {
    const user = request.authUser!;
    const { limit, runId } = request.query as { limit?: string; runId?: string };
    const n = Math.max(1, Math.min(300, Number(limit ?? 80) || 80));
    const entries = runId
      ? audit.forRun(runId, user.id).slice(-n)
      : audit.recentForUser(user.id, n);
    return {
      entries,
      verification: audit.verify(),
      head: audit.headHash(),
      count: audit.countForUser(user.id),
    };
  });

  app.get('/api/audit/verify', async (request) => ({
    ...audit.verify(),
    head: audit.headHash(),
    userCount: audit.countForUser(request.authUser!.id),
  }));

  app.get('/api/audit/replay/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const entries = audit.forRun(runId, request.authUser!.id);
    if (!entries.length) {
      return reply.code(404).send({ ok: false, code: 'RUN_NOT_FOUND', message: '未找到该任务的审计记录' });
    }
    return {
      runId,
      entries,
      verification: audit.verify(),
    };
  });

  app.post('/api/demo/tamper', async () => {
    const result = audit.tamperDemo();
    const verification = audit.verify();
    audit.append(
      'TAMPER_DRILL',
      '执行审计篡改演练：在副本链上修改并验证检测能力',
      { modifiedSeq: result.modifiedSeq, errors: result.errors },
      {},
    );
    return { ...result, mainChain: verification };
  });
}
