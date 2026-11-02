import type { FastifyInstance } from 'fastify';
import { BRAND } from '@bank/shared';
import { config } from '../config';
import { banking } from '../integration/banking';
import { externalRefFor } from '../integration/ids';
import { faceProvider, otpProvider } from '../integration/verification';

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  // 登录页使用：只暴露“是否已接入”的展示信息，不含任何密钥或上游地址。
  app.get('/api/public/config', async () => ({
    ok: true,
    brand: {
      name: BRAND.name,
      nameEn: BRAND.nameEn,
      product: BRAND.product,
    },
    banking: {
      mode: banking.mode,
      provider: banking.provider,
    },
    verification: {
      smsMode: otpProvider.mode,
      faceMode: faceProvider.mode,
    },
    auth: {
      phoneVerifyRequired: config.auth.requirePhoneVerify,
      loginMfa: config.auth.loginMfa,
    },
    demo: config.isDemo,
  }));

  app.get('/api/integration/status', async (request) => {
    const user = request.authUser!;
    return {
      ok: true,
      banking: banking.status(user.id),
      verification: {
        smsMode: otpProvider.mode,
        faceMode: faceProvider.mode,
        smsConfigured: config.integration.sms.mode === 'http',
        faceConfigured: config.integration.face.mode === 'http',
      },
      customerRef: externalRefFor(user.id),
    };
  });

  // 由用户在界面上重试拉取；失败直接报错，前端可明确展示“银行核心不可用”。
  app.post('/api/integration/refresh', async (request) => {
    const user = request.authUser!;
    const info = await banking.sync(user.id, { force: true });
    return { ok: true, banking: info };
  });
}
