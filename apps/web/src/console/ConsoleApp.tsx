import { BRAND } from '@bank/shared';
import { SESSION_KEYS, useBankAgent } from '../state/useBankAgent';
import { Header } from '../components/Header';
import { PhoneFrame } from '../components/phone/PhoneFrame';
import { Console } from '../components/console/Console';
import { Toast } from '../components/Toast';

export default function ConsoleApp() {
  const agent = useBankAgent({ sessionKey: SESSION_KEYS.console });

  return (
    <div className="stage-bg min-h-screen text-[#f4f1ec]">
      <Header agent={agent} />
      <main className="relative mx-auto max-w-[1480px] px-4 pb-8 pt-5">
        <div className="flex flex-col items-center gap-6 xl:flex-row xl:items-start xl:justify-center">
          <div className="shrink-0 xl:sticky xl:top-[84px]">
            <PhoneFrame agent={agent} />
            <div className="mt-3 text-center text-[9.5px] tracking-[0.18em] text-[#93a49a]">
              评委模式 · 独立演示会话 · 与产品端共享同一账号数据
            </div>
          </div>
          <div className="w-full min-w-0 flex-1">
            <Console agent={agent} />
          </div>
        </div>
      </main>
      <footer className="relative mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-2 px-5 pb-6 text-[9.5px] text-[#93a49a]">
        <span>{BRAND.complianceLine}</span>
        <span>绿色自动 · 黄色确认 · 红色强验证 · 一次性授权 · 全链路审计</span>
      </footer>
      <Toast toast={agent.state.toast} onClose={agent.clearToast} />
    </div>
  );
}
