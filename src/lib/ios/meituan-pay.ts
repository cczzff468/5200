/**
 * 美团支付层：复用现有微信/QQ 钱包的支付逻辑（需求「支付复用现有支付逻辑」）：
 * - 微信支付 → wxExecutePayment（零钱 / 银行卡 / 亲属卡 fcin-*，含跨月重置与多卡分摊）；
 *   亲属卡成功后走 recordFcSpend（账本流水 + 按赠卡人写记忆碎片 channel='美团'）+ 赠卡人聊天通知行
 *   ——AI 下一轮聊天经记忆召回自然知道「用户花钱了」（与微信内商户消费同一套感知管线）；
 * - QQ 支付 → qq.executePayment（QQ钱包余额 / 银行卡，写 QQ 钱包账单）；
 * - 钱包模块较大，全部动态 import（美团 App 是懒加载 chunk，支付只在拉起支付时才拉钱包模块）；
 * - 渠道列表带可用余额与「额度不足」预检（wxCanPay / qq.canPay 同源），亲属卡不足 →
 *   渠道灰显 + 提示切换其他支付方式（需求 6.4）。
 */
import { ownerRealNameFor } from '@/lib/ios/contacts-store';

export interface MtPayChannel {
  /** 列表内唯一键 */
  key: string;
  idp: 'wx' | 'qq';
  /** 传给 wxExecutePayment / qq.executePayment 的 methodId */
  methodId: string;
  label: string;
  sub: string;
  /** 亲属卡渠道 */
  isFc?: boolean;
  /** 余额/额度不足 → 灰显不可选 */
  insufficient: boolean;
}

export interface MtFcPart {
  giverId: string | null;
  giverName: string;
  amount: number;
}

export interface MtPayResult {
  ok: boolean;
  /** 失败提示（余额不足/网络异常） */
  error?: string;
  /** 亲属卡扣款明细（成功时若有） */
  fc?: { total: number; parts: MtFcPart[] };
}

const fmt2 = (n: number): string => {
  const s = n.toFixed(2);
  return s.endsWith('.00') ? String(Math.round(n)) : s;
};

/** 拉取某端的可选支付渠道（带余额/额度预检） */
export async function mtListPayChannels(idp: 'wx' | 'qq', amount: number): Promise<MtPayChannel[]> {
  if (idp === 'wx') {
    const ww = await import('@/components/apps/wechat-wallet');
    const w = await import('@/components/apps/wechat');
    const chans: MtPayChannel[] = [];
    const bal = ww.loadJSON<{ balance?: number }>(ww.LS_WALLET, {}).balance ?? 0;
    chans.push({ key: 'wx:balance', idp: 'wx', methodId: 'balance', label: '微信零钱', sub: `可用 ¥${fmt2(bal)}`, insufficient: !w.wxCanPay('balance', amount) });
    for (const c of ww.loadCards()) {
      chans.push({
        key: `wx:${c.id}`,
        idp: 'wx',
        methodId: c.id,
        label: c.bank || '银行卡',
        sub: `尾号${c.tail} · 可用 ¥${fmt2(c.balance ?? 0)}`,
        insufficient: !w.wxCanPay(c.id, amount),
      });
    }
    // 亲属卡（我收到的）：按赠卡人聚合可用额度（与微信支付方式选择同口径）
    const fcs = ww.resetFamilyCardsInMonth();
    const groups = new Map<string, { cards: typeof fcs; avail: number; name: string }>();
    for (const f of fcs) {
      const k = f.friendId ?? f.id;
      const cur = groups.get(k);
      if (cur) {
        cur.cards.push(f);
        cur.avail = Math.round((cur.avail + Math.max(0, f.monthlyLimit - f.used)) * 100) / 100;
      } else {
        groups.set(k, { cards: [f], avail: Math.max(0, f.monthlyLimit - f.used), name: f.fromName });
      }
    }
    for (const g of groups.values()) {
      const anchor = g.cards[0];
      // 卡 id 本身已带 fcin- 前缀（claimFamily 生成口径）；旧/异构数据无前缀时补一次
      const methodId = anchor.id.startsWith('fcin-') ? anchor.id : `fcin-${anchor.id}`;
      chans.push({
        key: `wx:${methodId}`,
        idp: 'wx',
        methodId,
        label: `${g.name}的亲属卡${g.cards.length > 1 ? `×${g.cards.length}` : ''}`,
        sub: `本月可用 ¥${fmt2(g.avail)}`,
        isFc: true,
        insufficient: g.avail < amount,
      });
    }
    return chans;
  }
  const qq = await import('@/components/apps/qq');
  const chans: MtPayChannel[] = [];
  const bal = qq.loadWallet().balance;
  chans.push({ key: 'qq:balance', idp: 'qq', methodId: 'balance', label: 'QQ钱包余额', sub: `可用 ¥${fmt2(bal)}`, insufficient: !qq.canPay('balance', amount) });
  for (const c of qq.loadBankCards()) {
    chans.push({
      key: `qq:${c.id}`,
      idp: 'qq',
      methodId: c.id,
      label: c.bank || '银行卡',
      sub: `尾号${c.last4} · 可用 ¥${fmt2(c.balance ?? 0)}`,
      insufficient: !qq.canPay(c.id, amount),
    });
  }
  return chans;
}

/**
 * 执行美团支付（复用微信/QQ 扣款）。
 * randomFail = 模拟偶发网络失败（支付失败 → 提示重试；失败发生在扣款前，不产生资金变动）。
 */
export async function mtExecutePay(
  idp: 'wx' | 'qq',
  channel: MtPayChannel,
  amount: number,
  merchantName: string,
  randomFail = false
): Promise<MtPayResult> {
  if (!(amount > 0)) return { ok: false, error: '支付金额异常，请重试' };
  if (randomFail) return { ok: false, error: '网络异常，支付失败，请重试' };
  if (idp === 'wx') {
    const w = await import('@/components/apps/wechat');
    const ww = await import('@/components/apps/wechat-wallet');
    if (!w.wxCanPay(channel.methodId, amount)) {
      return { ok: false, error: channel.isFc ? '亲属卡本月额度不足，请切换其他支付方式' : '余额不足，支付失败，请重试或更换支付方式' };
    }
    const pay = w.wxExecutePayment(channel.methodId, amount, channel.isFc ? '亲属卡付款' : '美团外卖', { peer: merchantName });
    if (!pay) return { ok: false, error: channel.isFc ? '亲属卡本月额度不足，请切换其他支付方式' : '余额不足，支付失败，请重试或更换支付方式' };
    if (pay.fc) {
      // 亲属卡消费感知（与微信内商户消费同一管线）：账本 + 赠卡人记忆（channel='美团'）+ 赠卡人聊天通知行
      const parts: MtFcPart[] = pay.fc.parts.map((p) => ({ giverId: p.giverId, giverName: p.giverName, amount: p.amount }));
      const owner = (await ownerRealNameFor('wx').catch(() => '')) || '机主';
      ww.recordFcSpend({
        total: amount,
        scene: '亲属卡付款',
        where: `在「${merchantName}」的点餐消费`,
        parts: pay.fc.parts,
        ownerName: owner,
        channel: '美团',
      });
      for (const p of pay.fc.parts) {
        if (!p.giverId) continue;
        ww.appendWxChatMsg(p.giverId, {
          id: ww.uid(),
          role: 'peer',
          content: '',
          time: Date.now(),
          kind: 'notice',
          notice: { icon: 'fam', pre: `你用${p.giverName}送的亲属卡在美团消费了`, accent: `¥${fmt2(amount)}` },
        });
      }
      return { ok: true, fc: { total: amount, parts } };
    }
    return { ok: true };
  }
  const qq = await import('@/components/apps/qq');
  if (!qq.canPay(channel.methodId, amount)) return { ok: false, error: '余额不足，支付失败，请重试或更换支付方式' };
  const ok = qq.executePayment(channel.methodId, amount, '美团外卖', { avatar: null });
  return ok ? { ok: true } : { ok: false, error: '余额不足，支付失败，请重试或更换支付方式' };
}
