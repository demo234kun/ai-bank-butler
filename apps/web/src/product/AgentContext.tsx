import { createContext, useContext, type ReactNode } from 'react';
import { useBankAgent, type BankAgentApi } from '../state/useBankAgent';

const AgentContext = createContext<BankAgentApi | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const agent = useBankAgent({ sessionKey: 'bank.session.id', livePoll: false });
  return <AgentContext.Provider value={agent}>{children}</AgentContext.Provider>;
}

export function useAgent(): BankAgentApi {
  const context = useContext(AgentContext);
  if (!context) throw new Error('useAgent must be used inside AgentProvider');
  return context;
}
