export interface InjectionResult {
  score: number;
  patterns: string[];
  categories: string[];
  verdict: 'allow' | 'warn' | 'block';
  explanation: string;
}

interface Rule {
  category: string;
  pattern: RegExp;
  weight: number;
  description: string;
}

const RULES: Rule[] = [
  {
    category: '指令覆盖',
    pattern: /(忽略|无视|忘记|跳过|覆盖).{0,10}(以上|之前|所有|上述|前面).{0,10}(指令|规则|提示|要求|限制)/i,
    weight: 60,
    description: '试图覆盖系统指令',
  },
  {
    category: '提示词窃取',
    pattern: /(系统提示词|system\s*prompt|developer\s*mode|开发者模式|越狱|jailbreak|\bDAN\b)/i,
    weight: 55,
    description: '询问或启用内部提示词 / 越狱模式',
  },
  {
    category: '审计破坏',
    pattern:
      /(删除|删掉|清除|清空|篡改|关闭|停用).{0,8}(审计|日志|记录|流水)|(审计|日志|记录|流水).{0,8}(删除|删掉|清除|清空|篡改|关闭|停用)/,
    weight: 60,
    description: '试图删除或篡改审计记录',
  },
  {
    category: '身份伪造',
    pattern: /(我是|作为).{0,8}(行长|管理员|风控|开发人员|客服|内部人员).{0,12}(授权|命令|要求|给我|帮我|解除|放行)/,
    weight: 50,
    description: '以管理者身份声称拥有额外权限',
  },
  {
    category: '跳过验证',
    pattern: /(无需|不用|跳过|绕过|免去).{0,8}(确认|验证|人脸|短信|风控|权限|审批)/,
    weight: 55,
    description: '要求跳过确认或强验证',
  },
  {
    category: '强制转账',
    pattern: /(直接|立刻|马上|现在).{0,8}(转账|打款|汇款|支付).{0,14}(无需|不用|跳过|不要问|别问)/,
    weight: 45,
    description: '强制发起资金操作并规避确认',
  },
  {
    category: '角色扮演',
    pattern: /(现在你是|从现在开始你是|扮演|假装你是).{0,12}(管理员|系统|银行核心|客服|风控|开发)/,
    weight: 45,
    description: '要求模型扮演更高权限角色',
  },
  {
    category: '数据越权',
    pattern: /(查询|导出|列出|查看).{0,8}(全部|所有|其他).{0,8}(客户|用户|账户).{0,8}(余额|信息|手机号|流水)/,
    weight: 60,
    description: '试图遍历其他客户数据',
  },
  {
    category: '工具注入',
    pattern: /(<\|im_start\|>|<\|system\|>|\[INST\]|BEGIN\s+SYSTEM|role\s*:\s*system)/i,
    weight: 50,
    description: '疑似向模型注入特殊控制标记',
  },
];

export function scanInjection(text: string): InjectionResult {
  const hits = RULES.filter((rule) => rule.pattern.test(text));
  const score = Math.min(100, hits.reduce((sum, rule) => sum + rule.weight, 0));
  const verdict: InjectionResult['verdict'] = score >= 45 ? 'block' : score >= 20 ? 'warn' : 'allow';
  return {
    score,
    patterns: hits.map((hit) => hit.description),
    categories: hits.map((hit) => hit.category),
    verdict,
    explanation:
      hits.length === 0
        ? '未发现提示词注入特征'
        : `命中 ${hits.length} 条注入特征：${hits.map((h) => h.description).join('；')}`,
  };
}

export function combineInjection(
  ruleResult: InjectionResult,
  llmSuspicion: number,
): InjectionResult {
  if (llmSuspicion >= 0.75 && ruleResult.verdict !== 'block') {
    return {
      ...ruleResult,
      score: Math.max(ruleResult.score, Math.round(llmSuspicion * 100)),
      patterns: [...ruleResult.patterns, '模型判定存在指令注入嫌疑'],
      categories: [...ruleResult.categories, '模型侧信号'],
      verdict: 'block',
      explanation: `${ruleResult.explanation}；模型侧注入嫌疑 ${Math.round(llmSuspicion * 100)}%`,
    };
  }
  if (ruleResult.verdict === 'block' && llmSuspicion < 0.3) {
    return {
      ...ruleResult,
      explanation: `${ruleResult.explanation}（模型侧未发现额外嫌疑，仍按服务端规则拦截）`,
    };
  }
  return ruleResult;
}
