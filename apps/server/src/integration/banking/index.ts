import { config } from '../../config';
import { HttpBankingGateway } from './http';
import { SimulatedBankingGateway } from './simulated';
import type { BankingGateway } from './types';

function createGateway(): BankingGateway {
  if (config.integration.banking.mode === 'http') {
    return new HttpBankingGateway({
      baseUrl: config.integration.banking.baseUrl,
      appId: config.integration.banking.appId,
      appSecret: config.integration.banking.appSecret,
      provider: config.integration.banking.provider,
      timeoutMs: config.integration.banking.timeoutMs,
      retries: config.integration.banking.retries,
      syncTtlMs: config.integration.banking.syncTtlMs,
      txnLimit: config.integration.banking.txnLimit,
      circuitFailures: config.integration.banking.circuitFailures,
      circuitCooldownMs: config.integration.banking.circuitCooldownMs,
    });
  }
  return new SimulatedBankingGateway();
}

export const banking = createGateway();

export type {
  BankMode,
  BankSyncInfo,
  BankingGateway,
  SplitRequestInput,
  TransferInput,
} from './types';
