/**
 * 作品品牌配置：作品名定稿「AI 银行管家」，界面与文案只从这里取。
 * nameEn 是拉丁字标，用于登录页小字标、卡面发行方与 WebAuthn 显示名。
 */
export const BRAND = {
  name: 'AI 银行管家',
  nameEn: 'AI BANK BUTLER',
  product: 'AI 银行管家',
  slogan: '说话，就能办业务',
  monogram: '屿',
  complianceLine: '演示环境 · 全部数据为合成数据 · 不连接真实银行核心',
} as const;

export const DEMO_PERSONA = {
  userId: 'u_chenyu',
  name: '陈屿',
  salutation: '陈先生',
  tier: '私人银行 · 金桂级',
} as const;
