import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { api } from '../api/client';

export interface PasskeyRecord {
  id: string;
  fullId: string;
  label: string;
  registeredAt: string;
  counter: number;
  transports: string[];
}

export function passkeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    Boolean(navigator.credentials)
  );
}

export async function listPasskeys(): Promise<{ enabled: boolean; credentials: PasskeyRecord[] }> {
  const data = await api.get<{ ok: true; enabled: boolean; credentials: PasskeyRecord[] }>('/api/passkey');
  return { enabled: data.enabled, credentials: data.credentials };
}

/** 录入本机指纹/面容（Windows Hello、Touch ID、Face ID）。私钥只留在设备里。 */
export async function enrollPasskey(label: string): Promise<{ ok: boolean; message?: string; count?: number }> {
  if (!passkeySupported()) {
    return { ok: false, message: '当前浏览器不支持通行密钥，请换用 Chrome / Edge / Safari' };
  }
  try {
    const started = await api.post<{ ok: true; options: any }>('/api/passkey/register/start', {});
    const response = await startRegistration({ optionsJSON: started.options });
    const finished = await api.post<{ ok: true; count: number }>('/api/passkey/register/finish', {
      response,
      challenge: started.options.challenge,
      label,
    });
    return { ok: true, count: finished.count };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      return { ok: false, message: '已取消：需要在本机确认可信生物识别' };
    }
    return { ok: false, message: error instanceof Error ? error.message : '通行密钥注册失败' };
  }
}

export async function revokePasskey(fullId: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await api.post('/api/passkey/revoke', { id: fullId });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '删除失败' };
  }
}

/** 强验证：用本机生物识别签名，服务端校验通过后才满足人脸因子。 */
export async function verifyWithPasskey(
  sessionId: string,
  challengeId: string,
): Promise<{ ok: boolean; code?: string; message?: string }> {
  try {
    const started = await api.post<{ ok: true; options: any }>(
      '/api/stepup/bio/start',
      { sessionId, challengeId },
    );
    const response = await startAuthentication({ optionsJSON: started.options });
    await api.post('/api/stepup/bio/finish', { sessionId, challengeId, response });
    return { ok: true };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      return { ok: false, code: 'BIO_CANCELLED', message: '已取消生物识别，可改用短信或人脸通道' };
    }
    const message = error instanceof Error ? error.message : '生物识别校验失败';
    return { ok: false, message };
  }
}
