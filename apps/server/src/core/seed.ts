import type {
  Account,
  BankCard,
  Holding,
  ScheduleItem,
  Subscription,
  Txn,
  UserProfile,
  WealthProduct,
} from '@bank/shared';
import { config } from '../config';
import { createRng } from './rng';
import type { BankState } from './state';

const pad = (n: number) => String(n).padStart(2, '0');
const localIso = (m: number, d: number, h = 9, min = 0) =>
  `2026-${pad(m)}-${pad(d)}T${pad(h)}:${pad(min)}:00+08:00`;

const CATEGORY = {
  coffee: '咖啡茶饮',
  dining: '餐饮',
  grocery: '商超买菜',
  transport: '交通出行',
  shopping: '购物',
  utility: '生活缴费',
  rent: '住房',
  salary: '工资',
  subscription: '订阅服务',
  travel: '旅行',
  medical: '医疗健康',
  entertainment: '休闲娱乐',
  wealth: '投资理财',
  transfer: '转账',
  other: '其他',
} as const;

const COFFEE_SHOPS = ['Manner 咖啡', 'M Stand', 'Seesaw Coffee', '星巴克'] as const;
const DINING = ['甬府小鲜', '山葵家', '老乡鸡', '平成屋', '阿娘面馆', '皮爷咖啡'] as const;
const GROCERY = ['盒马鲜生', '叮咚买菜', '奥乐齐'] as const;
const SHOPPING = ['优衣库', '京东商城', '得物', 'MUJI 无印良品'] as const;

export interface SeedProfile {
  userId?: string;
  name?: string;
  phoneMasked?: string;
  tier?: string;
  spouseName?: string;
  spouseBirthday?: string;
  riskLevel?: UserProfile['riskProfile']['level'];
  seed?: number;
}

const RISK_SCORE: Record<UserProfile['riskProfile']['level'], number> = {
  保守型: 35,
  稳健型: 62,
  平衡型: 70,
  成长型: 80,
  进取型: 88,
};

export function createSeededState(profile: SeedProfile = {}): BankState {
  const userId = profile.userId ?? 'u_chenyu';
  const userName = profile.name ?? '陈屿';
  const phoneMasked = profile.phoneMasked ?? '138****6677';
  const tier = profile.tier ?? '私人银行 · 金桂级';
  const spouseName = profile.spouseName?.trim() || '林晚';
  const spouseBirthday = profile.spouseBirthday?.trim() || '1992-11-02';
  const riskLevel = profile.riskLevel ?? '稳健型';
  const rng = createRng(profile.seed ?? 20261030);
  let txnSeq = 0;
  const txns: Txn[] = [];

  const pushTxn = (
    accountId: string,
    ts: string,
    amountCents: number,
    merchant: string,
    category: string,
    channel = '银联云闪付',
    extra: Partial<Txn> = {},
  ) => {
    txnSeq += 1;
    txns.push({
      id: `txn_${String(txnSeq).padStart(4, '0')}`,
      accountId,
      ts,
      amountCents,
      merchant,
      category,
      channel,
      status: 'posted',
      ...extra,
    });
  };

  const accounts: Account[] = [
    {
      id: 'acc_ys',
      name: '云杉银行 · 储蓄卡',
      bank: '云杉银行',
      type: 'savings',
      last4: '1234',
      balanceCents: 8_642_050,
      lockedCents: 0,
      primary: true,
      color: '#0F3D33',
    },
    {
      id: 'acc_qh',
      name: '青禾银行 · 储蓄卡',
      bank: '青禾银行',
      type: 'savings',
      last4: '8890',
      balanceCents: 2_318_000,
      lockedCents: 0,
      primary: false,
      color: '#1E3A5F',
    },
    {
      id: 'acc_plus',
      name: '云杉银行 · 活期+',
      bank: '云杉银行',
      type: 'current',
      last4: '6601',
      balanceCents: 12_000_000,
      lockedCents: 0,
      primary: false,
      color: '#5A4A2F',
    },
  ];

  const cards: BankCard[] = [
    {
      id: 'card_ys',
      accountId: 'acc_ys',
      type: 'debit',
      network: '银联',
      last4: '1234',
      status: 'active',
      expiry: '08/29',
      color: '#0F3D33',
      virtual: false,
    },
    {
      id: 'card_qh',
      accountId: 'acc_qh',
      type: 'debit',
      network: '银联',
      last4: '8890',
      status: 'active',
      expiry: '03/30',
      color: '#1E3A5F',
      virtual: false,
    },
    {
      id: 'card_credit',
      type: 'credit',
      network: 'Visa',
      last4: '5521',
      status: 'active',
      limitCents: 5_000_000,
      usedCents: 1_760_000,
      expiry: '09/29',
      color: '#2B2B2B',
      virtual: false,
    },
  ];

  const user: UserProfile = {
    id: userId,
    name: userName,
    tier,
    phoneMasked,
    spouse: { name: spouseName, birthday: spouseBirthday },
    contacts: [
      {
        id: 'ct_spouse',
        name: spouseName,
        bank: '云杉银行',
        last4: '6222',
        phoneMasked: '139****2210',
        relation: '配偶',
        color: '#8C5A4A',
      },
      {
        id: 'ct_wanglei_ys',
        name: '王磊',
        bank: '云杉银行',
        last4: '3018',
        phoneMasked: '137****8891',
        relation: '同事',
        color: '#3C6E63',
      },
      {
        id: 'ct_wanglei_qh',
        name: '王磊',
        bank: '青禾银行',
        last4: '7742',
        phoneMasked: '158****3306',
        relation: '房东',
        color: '#5C6B8A',
      },
      {
        id: 'ct_limeng',
        name: '李萌',
        bank: '北岭银行',
        last4: '1188',
        phoneMasked: '136****4402',
        relation: '朋友',
        color: '#9A7A3E',
      },
      {
        id: 'ct_zhangshu',
        name: '张叔',
        bank: '长川银行',
        last4: '6521',
        phoneMasked: '135****9012',
        relation: '家人',
        color: '#6B7A5A',
      },
    ],
    riskProfile: {
      level: riskLevel,
      score: RISK_SCORE[riskLevel],
      assessedAt: '2026-06-18T10:30:00+08:00',
    },
    preferences: {
      defaultAccountId: 'acc_ys',
      coffeeWeekly: 9,
      addressMasked: '上海市徐汇区 **** 路 18 号 1202 室',
    },
  };

  // -------------------------------------------------------------------------
  // 近 6 个月流水（2026-05-01 ~ 2026-10-30）
  // -------------------------------------------------------------------------
  const months = [5, 6, 7, 8, 9, 10];
  for (const m of months) {
    const lastDay = m === 10 ? 30 : new Date(2026, m, 0).getDate();

    pushTxn('acc_ys', localIso(m, 10, 9, 42), 3_200_000, '薪资入账 · 星野科技', CATEGORY.salary, '柜面代发', {
      note: '2026 年 ' + m + ' 月工资',
    });
    pushTxn('acc_ys', localIso(m, 5, 8, 15), -680_000, '房租 · 王磊', CATEGORY.rent, '自动转账', {
      note: '每月租金',
    });
    pushTxn('acc_ys', localIso(m, 8, 10, 5), -(28_000 + rng.int(0, 9) * 1000), '国家电网 · 上海', CATEGORY.utility, '自动扣款');
    pushTxn('acc_ys', localIso(m, 9, 11, 20), -12_800, '中国移动话费', CATEGORY.utility, '自动扣款');

    // 订阅扣费
    if (m >= 6) {
      pushTxn('acc_ys', localIso(m, 1, 8, 0), -29_900, '悦动健身', CATEGORY.subscription, '自动扣款', {
        note: '健身月卡',
      });
    }
    pushTxn('acc_ys', localIso(m, 8, 7, 30), m >= 8 ? -1_500 : -1_100, '声浪音乐', CATEGORY.subscription, '自动扣款', {
      note: m >= 8 ? '会员费由 ¥11 涨至 ¥15' : '音乐会员',
    });
    pushTxn('acc_ys', localIso(m, 12, 12, 0), -2_500, '星幕视频', CATEGORY.subscription, '自动扣款', {
      note: '视频会员',
    });
    pushTxn('acc_ys', localIso(m, 18, 18, 0), -1_800, '云端网盘', CATEGORY.subscription, '自动扣款', {
      note: '2TB 云空间',
    });

    // 日常消费
    for (let d = 1; d <= lastDay; d += 1) {
      const weekday = new Date(Date.UTC(2026, m - 1, d)).getUTCDay();
      if (weekday >= 1 && weekday <= 5) {
        if (rng.chance(0.55)) {
          pushTxn(
            'acc_ys',
            localIso(m, d, 8, rng.int(10, 50)),
            -(2_800 + rng.int(0, 14) * 100),
            rng.pick(COFFEE_SHOPS),
            CATEGORY.coffee,
            '微信支付',
          );
        }
        if (rng.chance(0.8)) {
          pushTxn('acc_ys', localIso(m, d, 18, rng.int(10, 55)), -600, '地铁乘车码', CATEGORY.transport, '银联云闪付');
        }
        if (rng.chance(0.28)) {
          pushTxn('acc_ys', localIso(m, d, 21, rng.int(5, 55)), -(2_400 + rng.int(0, 12) * 100), '滴滴出行', CATEGORY.transport, '微信支付');
        }
      }
      if (rng.chance(0.38)) {
        pushTxn(
          'acc_ys',
          localIso(m, d, 12, rng.int(0, 59)),
          -(4_500 + rng.int(0, 22) * 500),
          rng.pick(DINING),
          CATEGORY.dining,
          rng.pick(['微信支付', '支付宝']),
        );
      }
      if (weekday === 6 && rng.chance(0.9)) {
        pushTxn(
          'acc_ys',
          localIso(m, d, 16, rng.int(0, 59)),
          -(8_000 + rng.int(0, 16) * 1000),
          rng.pick(GROCERY),
          CATEGORY.grocery,
          '支付宝',
        );
      }
      if (rng.chance(0.07)) {
        pushTxn(
          'acc_ys',
          localIso(m, d, 20, rng.int(0, 59)),
          -(15_000 + rng.int(0, 90) * 1_000),
          rng.pick(SHOPPING),
          CATEGORY.shopping,
          '支付宝',
        );
      }
    }
  }

  // 理财动作
  pushTxn('acc_plus', localIso(5, 20, 10, 0), -5_000_000, '现金宝 · 申购', CATEGORY.wealth, '手机银行');
  pushTxn('acc_plus', localIso(6, 15, 10, 0), -3_000_000, '臻选均衡混合 · 申购', CATEGORY.wealth, '手机银行');
  pushTxn('acc_plus', localIso(7, 1, 10, 0), -10_000_000, '招银稳健 180 天 · 申购', CATEGORY.wealth, '手机银行');

  // 旅行与医疗
  pushTxn('acc_qh', localIso(8, 7, 14, 20), -486_000, '携程旅行 · 机票', CATEGORY.travel, '快捷支付');
  pushTxn('acc_qh', localIso(8, 8, 19, 30), -238_000, '亚朵酒店 · 杭州', CATEGORY.travel, '快捷支付');
  pushTxn('acc_qh', localIso(7, 20, 15, 40), -68_000, '瑞尔齿科', CATEGORY.medical, '银联云闪付');
  pushTxn('acc_qh', localIso(9, 5, 20, 10), -38_000, '大麦网 · 音乐会', CATEGORY.entertainment, '支付宝');

  // 异常交易：凌晨境外连续大额
  pushTxn('acc_ys', localIso(9, 14, 2, 13), -388_000, 'LUXE*SG', CATEGORY.shopping, '境外线上', {
    location: '新加坡',
    anomaly: true,
    anomalyReason: '凌晨 02:13 境外大额交易，非本人常用时段与地点',
  });
  pushTxn('acc_ys', localIso(9, 14, 2, 17), -246_000, 'GLOBALPAY', CATEGORY.other, '境外线上', {
    location: '新加坡',
    anomaly: true,
    anomalyReason: '4 分钟内第二笔境外交易，疑似卡片盗刷',
  });
  pushTxn('acc_ys', localIso(9, 14, 2, 21), -120_000, 'LUXE*SG', CATEGORY.shopping, '境外线上', {
    location: '新加坡',
    anomaly: true,
    anomalyReason: '短时连续境外交易',
  });

  // 异常交易：深夜大额娱乐消费
  pushTxn('acc_ys', localIso(10, 21, 23, 48), -268_000, 'NIGHT OWL 酒吧', CATEGORY.entertainment, '微信支付', {
    anomaly: true,
    anomalyReason: '深夜 23:48 大额娱乐消费，偏离日常消费习惯',
  });

  // 异常交易：疑似重复扣费
  pushTxn('acc_ys', localIso(10, 3, 9, 12), -1_800, '云端网盘', CATEGORY.subscription, '自动扣款', {
    note: '本月第二笔',
    anomaly: true,
    anomalyReason: '同日同商户重复扣费，会员周期为月付一次',
  });

  txns.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const subscriptions: Subscription[] = [
    {
      id: 'sub_video',
      merchant: '星幕视频',
      amountCents: 2_500,
      cycle: 'monthly',
      nextChargeAt: '2026-11-12T12:00:00+08:00',
      lastChargedAt: '2026-10-12T12:00:00+08:00',
      status: 'active',
      category: '影音会员',
      color: '#6B4E8C',
    },
    {
      id: 'sub_cloud',
      merchant: '云端网盘',
      amountCents: 1_800,
      cycle: 'monthly',
      nextChargeAt: '2026-11-18T18:00:00+08:00',
      lastChargedAt: '2026-10-18T18:00:00+08:00',
      status: 'active',
      category: '工具云服务',
      color: '#2E6B8A',
    },
    {
      id: 'sub_fitness',
      merchant: '悦动健身',
      amountCents: 29_900,
      cycle: 'monthly',
      nextChargeAt: '2026-11-01T08:00:00+08:00',
      lastChargedAt: '2026-10-01T08:00:00+08:00',
      status: 'active',
      category: '运动健康',
      color: '#B07A2A',
    },
    {
      id: 'sub_music',
      merchant: '声浪音乐',
      amountCents: 1_500,
      previousAmountCents: 1_100,
      cycle: 'monthly',
      nextChargeAt: '2026-11-08T07:30:00+08:00',
      lastChargedAt: '2026-10-08T07:30:00+08:00',
      status: 'active',
      category: '影音会员',
      color: '#A34B3E',
    },
  ];

  const products: WealthProduct[] = [
    {
      id: 'p_cash',
      name: '现金宝',
      issuer: '招银理财',
      type: '货币型',
      riskLevel: 'R1',
      yieldPct: 1.85,
      minAmountCents: 10_000,
      termDays: 0,
      liquidity: '随时申赎 · T+0 到账',
      tags: ['活钱管理', '低波动'],
      description: '主要投向高流动性货币市场工具，适合短期闲置资金。',
      color: '#2F7D5B',
    },
    {
      id: 'p_wenjian180',
      name: '招银稳健 180 天',
      issuer: '招银理财',
      type: '固收+',
      riskLevel: 'R2',
      yieldPct: 3.15,
      minAmountCents: 100_000,
      termDays: 180,
      liquidity: '持有 180 天 · 到期赎回',
      tags: ['稳健', '低波动', '业绩比较基准'],
      description: '以高等级信用债为底仓，辅以少量权益增强，历史波动较低。',
      color: '#0F3D33',
    },
    {
      id: 'p_ruixin90',
      name: '瑞信增强收益 90 天',
      issuer: '瑞信理财',
      type: '债券型',
      riskLevel: 'R2',
      yieldPct: 2.86,
      minAmountCents: 100_000,
      termDays: 90,
      liquidity: '持有 90 天 · 到期赎回',
      tags: ['稳健', '短久期'],
      description: '短久期信用债策略，适合作为稳健配置的补充。',
      color: '#4F6B5E',
    },
    {
      id: 'p_zhenxuan',
      name: '臻选均衡混合',
      issuer: '臻选基金',
      type: '混合型',
      riskLevel: 'R3',
      yieldPct: 5.8,
      minAmountCents: 100_000,
      termDays: 0,
      liquidity: '随时申赎 · T+1 确认',
      tags: ['进阶', '股债均衡', '有波动'],
      description: '股债均衡配置，追求中长期增值，短期净值存在波动。',
      color: '#8A6A2F',
    },
    {
      id: 'p_global',
      name: '环宇科技 QDII',
      issuer: '环宇全球',
      type: '股票型',
      riskLevel: 'R4',
      yieldPct: 8.2,
      minAmountCents: 1_000_000,
      termDays: 0,
      liquidity: '随时申赎 · T+2 确认',
      tags: ['进取', '海外科技', '高波动'],
      description: '投资全球科技龙头，波动显著，仅适合进取型投资者。',
      color: '#3C4F6B',
    },
  ];

  const holdings: Holding[] = [
    {
      id: 'h_cash',
      productId: 'p_cash',
      amountCents: 5_000_000,
      purchasedAt: '2026-05-20T10:00:00+08:00',
      yieldPct: 1.85,
      floatingPct: 0.4,
      status: 'holding',
    },
    {
      id: 'h_wenjian',
      productId: 'p_wenjian180',
      amountCents: 10_000_000,
      purchasedAt: '2026-07-01T10:00:00+08:00',
      yieldPct: 3.15,
      floatingPct: 0.62,
      status: 'holding',
    },
    {
      id: 'h_zhenxuan',
      productId: 'p_zhenxuan',
      amountCents: 3_000_000,
      purchasedAt: '2026-06-15T10:00:00+08:00',
      yieldPct: 5.8,
      floatingPct: -2.3,
      status: 'holding',
    },
  ];

  const schedules: ScheduleItem[] = [
    {
      id: 'sch_rent',
      kind: 'transfer',
      title: '每月房租 · 王磊',
      amountCents: 680_000,
      executeAt: '2026-11-05T08:15:00+08:00',
      status: 'scheduled',
      detail: '云杉银行 尾号 1234 · 每月 5 日自动转出',
    },
  ];

  return {
    seedVersion: config.seedVersion,
    seededAt: config.demoNow,
    demoNow: config.demoNow,
    user,
    accounts,
    cards,
    transactions: txns,
    subscriptions,
    products,
    holdings,
    fundLocks: [],
    giftOrders: [],
    schedules,
    disputes: [],
    notifications: [],
    limits: [],
    security: { failures: 0, injectionHits: 0, lockedUntil: null, lastReason: null },
    idempotency: {},
  };
}
