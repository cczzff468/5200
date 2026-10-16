'use client';

/**
 * 恋爱协议卡片气泡（第十二轮）——微信/QQ 聊天共用。
 *
 * 第二十七轮（用户要求）：邀请卡片和淘宝/美团代付卡片样式一模一样（只换内容）——
 * 结构完全对齐 TbPayBubble/MtPayBubble：白卡 p-2.5 rounded-[14px] + 指向头像侧的小箭头
 * + 头部（logo 22px + 恋人空间 + ShieldCheck 真爱保障）+ 主标题 15px truncate
 * + 粉色横幅(88px)+白色面板拼接圆角块（小字 + 协议名大字 + 粉渐变胶囊按钮）。
 * 上下更矮、无边框彩条；签署态保持亮色，婉拒态整体褪灰（同代付完成卡语义）。
 *
 * 点击卡片本体 → 记 pending + 切进恋人空间 App（PactPage 消费后跳对应界面）。
 */

import type { CouplePactCardData } from '@/lib/ios/couple-pact-share';
import { navToPact } from '@/lib/ios/couple-pact-share';
import { kvGet } from '@/lib/ios/idb-kv';
import { useUI } from '@/lib/ios/store';
import { Heart, PenLine, ShieldCheck } from 'lucide-react';

export interface CouplePactBubbleProps {
  data: CouplePactCardData;
  /** 消息是否我发的（msg.role === 'me'） */
  mine: boolean;
  testidPrefix?: string; // 'wx' | 'qq'（E2E 用）
}

export default function CouplePactBubble({ data, mine, testidPrefix = 'wx' }: CouplePactBubbleProps) {
  // 第十七轮·动态状态（自愈）：恋人空间里已有同题的「已签署」存档 → 卡片一律按已签署显示，
  // 修复「签完后卡片还显示去签署/点进去还是未签署」——卡片状态永远跟随恋人空间的存档真相
  const live = (() => {
    try {
      const snap = kvGet<{ pacts?: { id?: string; title?: string; status?: string }[] }>('couple-space:state');
      const pacts = Array.isArray(snap?.pacts) ? snap!.pacts! : [];
      if (data.pactId && data.pactId !== 'ai') {
        const byId = pacts.find((p) => p && p.id === data.pactId);
        if (byId) return { signed: byId.status === 'signed', pactId: byId.id };
      }
      const byTitle = pacts.find((p) => p && p.status === 'signed' && p.title === data.title);
      if (byTitle) return { signed: true, pactId: byTitle.id };
    } catch {
      /* 读不到就按卡片自身状态 */
    }
    return { signed: data.status === 'signed', pactId: data.pactId && data.pactId !== 'ai' ? data.pactId : undefined };
  })();
  const declined = data.status === 'declined' && !live.signed;
  const declinedByMe = declined && data.declinedBy === 'me';
  const signed = live.signed;
  const canSign = data.from === 'ta' && data.status === 'pending' && !signed && !declined;

  /** 点击卡片 → 进恋人空间（携带卡片正文/TA 是否已先签名/是否已签署/卡片消息定位，任何状态都直达对应签署/回看界面） */
  const openPact = () => {
    const ui = useUI.getState();
    if (ui.locked) return;
    navToPact({
      pactId: live.pactId,
      from: data.from,
      title: data.title,
      preamble: data.preamble,
      clauses: data.clauses,
      taSigned: data.taSigned,
      signed,
      msgId: data.msgId,
      channel: data.app,
      contactId: data.contactId,
    });
    if (ui.activeApp && ui.activeApp !== 'couple') ui.switchToApp('couple');
    else if (!ui.activeApp && ui.phase === 'closed') ui.openApp('couple');
  };

  // 文案态（对齐代付卡：请求卡恒亮粉引导签署；婉拒卡整体褪灰）
  const banner = signed ? '恋爱协议已生效啦~' : declined ? (declinedByMe ? '这份协议被婉拒啦~' : 'TA婉拒了这份协议~') : '来签恋爱协议吧~';
  const title = data.from === 'ta' ? `Hi~${data.fromName}写了恋爱协议等你签~` : 'Hi~我写了恋爱协议等你签名~';

  return (
    <div
      data-testid={`${testidPrefix}-pact-card`}
      onClick={(e) => {
        e.stopPropagation();
        openPact();
      }}
      className="relative block w-[252px] cursor-pointer select-none rounded-[14px] bg-white p-2.5 text-left shadow-[0_5px_16px_rgba(0,0,0,0.10)] transition-all duration-300 active:brightness-95"
      style={{ filter: declined ? 'grayscale(0.72) brightness(0.98)' : undefined }}
      role="button"
      aria-label={`恋爱协议邀请卡（${signed ? '已签署生效' : declined ? '已婉拒' : '待签署'}）`}
    >
      {/* 箭头指向头像侧：我发出（右）/ TA 发来（左），与代付卡一致 */}
      <span aria-hidden="true" className={`absolute top-[13px] h-[11px] w-[11px] rotate-45 rounded-[2px] bg-white ${mine ? '-right-[4px]' : '-left-[4px]'}`} />

      {/* 头部：恋人空间 logo + 真爱保障 */}
      <span className="relative flex items-center gap-1.5">
        <img src="/icons/couple.png" alt="" aria-hidden="true" className="h-[22px] w-[22px] rounded-full object-cover" draggable={false} />
        <span className="text-[13px] font-semibold text-black/85">恋人空间</span>
        <span className="ml-auto flex items-center gap-[3px] text-[11px] font-medium text-[#f2536a]">
          <ShieldCheck className="h-[13px] w-[13px]" strokeWidth={2.2} />
          真爱保障
        </span>
      </span>

      {/* 主标题（对齐代付卡文案结构） */}
      <span className="relative mt-1.5 block truncate text-[15px] font-semibold leading-snug text-black/90">{title}</span>

      {/* 粉色横幅 + 白色信息面板：拼接为一个整体圆角块（粉上白下、无缝相连） */}
      <span className="relative mt-2 block overflow-hidden rounded-[10px] ring-1 ring-black/[0.06]">
        <span className="relative block h-[88px] overflow-hidden bg-gradient-to-r from-[#ff7a9c] to-[#f2536a]">
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-25" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.55) 1px, transparent 1.4px)', backgroundSize: '16px 16px' }} />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[15px] font-bold text-white drop-shadow-sm">{banner}</span>
          <Heart className="absolute right-3 top-1/2 h-8 w-8 -translate-y-1/2 text-white/35" strokeWidth={1.6} aria-hidden="true" />
        </span>
        {/* 信息面板（白色，与上方粉色横幅拼接成一块） */}
        <span className="relative block bg-white px-3 pb-3 pt-2 text-center">
          {signed ? (
            <>
              <span className="mt-0.5 block text-[21px] font-bold leading-tight tracking-tight text-black/90" data-testid={`${testidPrefix}-pact-card-body`}>
                已签署生效 <span aria-hidden="true">♡</span>
              </span>
              <span className="mt-1 block truncate text-[11.5px] text-black/40">{data.from === 'ta' ? `${data.fromName} · ${data.toName} 的甜蜜约定` : `${data.toName} · ${data.fromName} 的甜蜜约定`}</span>
            </>
          ) : declined ? (
            <>
              <span className="block text-[19px] font-bold leading-tight tracking-tight text-black/70" data-testid={`${testidPrefix}-pact-card-body`}>
                对方婉拒了
              </span>
              <span className="mt-1 block truncate text-[11.5px] text-black/40">{declinedByMe ? '你已经婉拒，TA 已经知道了' : data.reason ? `TA 想了想：${data.reason}` : '可以再沟通，或换个小约定'}</span>
            </>
          ) : (
            <>
              <span className="block text-[11.5px] text-black/40">{data.taSigned ? `${data.fromName}已签名，就等你啦` : `甜蜜约定 · 共 ${data.clauses.length} 条`}</span>
              <span className="mt-0.5 block truncate text-[21px] font-bold leading-tight tracking-tight text-black/90" data-testid={`${testidPrefix}-pact-card-body`}>
                {data.title || '恋爱协议书'}
              </span>
            </>
          )}
          <span
            data-testid={canSign ? `${testidPrefix}-pact-card-sign` : undefined}
            className="mt-2.5 flex h-9 items-center justify-center rounded-full bg-gradient-to-r from-[#ff7a9c] to-[#f2536a] text-[14px] font-bold text-white shadow-[0_3px_10px_rgba(242,83,106,0.28)]"
          >
            {signed ? '查看协议' : declined ? '查看详情' : canSign ? (
              <>
                <PenLine className="mr-1 h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
                去签署
              </>
            ) : '查看详情'}
          </span>
        </span>
      </span>
    </div>
  );
}
