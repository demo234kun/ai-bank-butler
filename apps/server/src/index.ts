import fs from 'node:fs';
import { BRAND } from '@bank/shared';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config, ensureDirs, integrationConfigErrors } from './config';
import { speechConfigErrors } from './integration/speech';
import { getState } from './core/store';
import { startScheduler } from './core/scheduler';
import { audit } from './security/auditChain';
import { authHook } from './security/auth';
import { authRoutes } from './routes/auth';
import * as hub from './sse/hub';
import { sessionRoutes } from './routes/session';
import { chatRoutes } from './routes/chat';
import { controlRoutes } from './routes/control';
import { auditRoutes } from './routes/audit';
import { demoRoutes } from './routes/demo';
import { securityRoutes } from './routes/security';
import { productRoutes } from './routes/product';
import { riskRoutes } from './routes/risk';
import { transactionRoutes } from './routes/transactions';
import { notificationRoutes } from './routes/notifications';
import { speechRoutes } from './routes/speech';
import { passkeyRoutes } from './routes/passkey';
import { integrationRoutes } from './routes/integration';
import { reviewRoutes } from './routes/review';

async function main(): Promise<void> {
  const configErrors = [...integrationConfigErrors(), ...speechConfigErrors()];
  if (configErrors.length) {
    throw new Error(`接入配置不完整：${configErrors.join('；')}`);
  }
  ensureDirs();
  getState();
  audit.init();
  audit.subscribe((entry) => hub.publishAudit(entry));

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'warn' },
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });

  // 麦克风只允许同源页面使用（语音输入），其余敏感权限一律关闭
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
  });

  app.addHook('onRequest', authHook);

  app.setErrorHandler((error: any, request, reply) => {
    request.log.error(error);
    if (reply.sent) return;
    reply.code(500).send({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: error.message,
    });
  });

  await app.register(authRoutes);
  await app.register(sessionRoutes);
  await app.register(chatRoutes);
  await app.register(controlRoutes);
  await app.register(auditRoutes);
  await app.register(demoRoutes);
  await app.register(securityRoutes);
  await app.register(productRoutes);
  await app.register(riskRoutes);
  await app.register(transactionRoutes);
  await app.register(notificationRoutes);
  await app.register(speechRoutes);
  await app.register(passkeyRoutes);
  await app.register(integrationRoutes);
  await app.register(reviewRoutes);

  const hasWeb = fs.existsSync(config.webDist) && fs.existsSync(`${config.webDist}/index.html`);
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      prefix: '/',
      wildcard: true,
    });
    app.get('/', async (_request, reply) => reply.sendFile('index.html'));
  } else {
    app.get('/', async () => ({
      ok: true,
      service: 'AI Banking Agent API',
      hint: '开发模式请访问 Vite 5173；生产构建先运行 npm run build',
    }));
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ ok: false, code: 'NOT_FOUND', message: '接口不存在' });
    }
    if (hasWeb) return reply.sendFile('index.html');
    return reply.code(404).send({ ok: false, code: 'NOT_FOUND', message: '页面不存在' });
  });

  await app.listen({ port: config.port, host: config.host });
  startScheduler();
  console.log('');
  console.log(`  ${BRAND.name} · AI Banking Agent`);
  console.log(`  API      http://localhost:${config.port}/api/health`);
  console.log(`  Web dev  http://localhost:5173  (Vite)`);
  console.log(`  业务时钟  ${config.businessClock === 'real' ? '真实时间' : `演示时间 ${config.demoNow}`}`);
  console.log(`  LLM      ${config.llm.offline ? 'OFFLINE（规则引擎）' : `${config.llm.model} @ ${config.llm.baseUrl || '未配置'}`}`);
  console.log(`  银行核心  ${config.integration.banking.mode === 'http' ? `HTTP ${config.integration.banking.provider}` : '本地仿真（BANKING_MODE=simulated）'}`);
  console.log(`  核验通道  SMS=${config.integration.sms.mode} FACE=${config.integration.face.mode}${config.auth.webauthnStepUp ? ' + WebAuthn' : ''}`);
  console.log(`  计划调度  ${config.scheduler.tickMs > 0 ? `每 ${config.scheduler.tickMs / 1000}s 扫描到点任务` : '已关闭（SCHEDULER_TICK_MS=0）'}`);
  console.log(`  语音识别  ${config.asr.mode === 'http' ? `HTTP ${config.asr.model}` : '浏览器原生（Web Speech API）'}`);
  console.log('');

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
