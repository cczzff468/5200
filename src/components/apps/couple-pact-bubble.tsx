'use client';

/**
 * 恋爱协议卡片气泡（第十二轮；第二十三轮按参考截图整体美化）——微信/QQ 聊天共用。
 *
 * 第二十三轮卡片视觉（对照用户参考图「恋人空间分享卡 · 恋爱协议书」）：
 * - 顶部：粉色双心圆 logo +「恋人空间」灰色小字；
 * - 大标题：「我写的恋爱协议，等你来签名」（我发的）/「{TA}写的恋爱协议，等你来签名」（TA 发的）；
 * - 文档预览区：白纸 + 居中「恋爱协议书」标题 + 分隔横线 + 前言段落 + 虚线 + 编号条款列表
 *   （仿真协议书排版）；
 * - 状态：已签署盖红章「已签署生效」；我拒绝的盖灰章「已拒绝」（第二十三轮 declinedBy）；
 * - 底部：未签署的 TA 卡出「去签署」按钮；其余出状态行。
 *
 * 点击卡片本体 → 记 pending + 切进恋人空间 App（PactPage 消费后跳对应界面）。
 */

import type { CouplePactCardData } from '@/lib/ios/couple-pact-share';
import { navToPact } from '@/lib/ios/couple-pact-share';
import { kvGet } from '@/lib/ios/idb-kv';
import { useUI } from '@/lib/ios/store';

export interface CouplePactBubbleProps {
  data: CouplePactCardData;
  /** 消息是否我发的（msg.role === 'me'） */
  mine: boolean;
  testidPrefix?: string; // 'wx' | 'qq'（E2E 用）
}

/** 恋人空间圆 logo（粉色双心官方原图裁圆） */
function AppLogo() {
  return <img src="/icons/couple.png" alt="" aria-hidden="true" className="h-[27px] w-[27px] rounded-[7px] object-cover shadow-[0_1px_3px_rgba(0,0,0,0.14)]" draggable={false} />;
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

  // 状态行文案（TA 已先签名的 pending 卡显示「已签名，等你签署」；已签署统一「已签署生效」；
  // 第二十三轮：我拒绝的显示「你已拒绝这份协议，TA 已经知道了」）
  let statusLine: string;
  if (declinedByMe) {
    statusLine = '你已拒绝这份协议 · TA 已经知道了';
  } else if (data.from === 'ta') {
    statusLine = declined
      ? data.reason
        ? `TA 想了想：${data.reason}`
        : 'TA 婉拒了这份协议'
      : signed
        ? '已签署生效'
        : data.taSigned
          ? `${data.fromName}已签名，等你签署`
          : 'TA 想和你签这份协议';
  } else {
    statusLine = declined ? `对方回复：${data.reason ?? '先不签了'}` : signed ? '已签署生效' : `等待${data.toName}签署`;
  }
  void mine;

  return (
    <div
      data-testid={`${testidPrefix}-pact-card`}
      className={`w-[248px] select-none overflow-hidden rounded-[10px] bg-white shadow-sm dark:bg-[#1E1E1E] ${declined ? 'opacity-80' : ''} ${signed ? 'ring-1 ring-[#f2536a]/25' : ''}`}
    >
      {/* 卡片本体（点击进签署/回看界面）：logo 头 + 大标题 + 协议书文档预览 */}
      <button
        type="button"
        data-testid={`${testidPrefix}-pact-card-body`}
        onClick={(e) => {
          e.stopPropagation();
          openPact();
        }}
        className="relative block w-full cursor-pointer px-3.5 pb-3 pt-3 text-left transition-opacity active:opacity-[0.92]"
      >
        {/* 顶部：App logo + 名称 */}
        <span className="flex items-center gap-2">
          <AppLogo />
          <span className="text-[15px] font-semibold text-[#3c3c42]">恋人空间</span>
        </span>
        {/* 大标题 */}
        <span className="mt-2 block text-[19px] font-bold leading-[1.42] tracking-[0.01em] text-[#111114]">
          {data.from === 'ta' ? `${data.fromName}写的恋爱协议，等你来签名` : '我写的恋爱协议，等你来签名'}
        </span>

        {/* —— 协议书文档预览（仿真排版；第二十六轮：与截图一致的白纸无边框样式） —— */}
        <span className={`relative mt-2.5 block bg-white px-3 pb-4 pt-3 ${declined ? 'bg-[#fafafa]' : ''}`}>
          <span className="block text-center text-[17px] font-extrabold tracking-[3px] text-[#26262b]" style={{ fontFamily: "'Songti SC','STSong','SimSun',serif" }}>
            恋爱协议书
          </span>
          <span aria-hidden="true" className="mt-2 block border-t-[1.5px] border-[#3a3a40]" />
          <span className="mt-3 block text-justify text-[10.5px] leading-[1.95] text-[#3a3a40]">
            {data.preamble?.trim() || '为维护双方的感情与信任，促进彼此理解与成长，建立健康、稳定、真诚的亲密关系，双方经友好协商，达成如下协议，共同遵守：'}
          </span>
          <span aria-hidden="true" className="mt-3 block border-t border-dashed border-[#d9d9de]" />
          <span className="mt-2.5 block space-y-[6px]">
            {data.clauses.slice(0, 5).map((c, i) => (
              <span key={i} className="flex gap-[5px] text-[10.5px] leading-[1.7] text-[#3a3a40]">
                <span className="w-[15px] shrink-0 text-right tabular-nums">{i + 1}.</span>
                <span className="min-w-0">{c}</span>
              </span>
            ))}
            {data.clauses.length > 5 && <span className="block pl-[20px] text-[10px] text-[#9a9aa2]">……共 {data.clauses.length} 条</span>}
          </span>
          {/* 签名栏（淡淡的，像还没签的空栏） */}
          {!signed && !declined && (
            <span aria-hidden="true" className="mt-3 flex justify-between text-[8.5px] text-[#b6b6bd]">
              <span>{data.from === 'ta' && data.taSigned ? `签名：${data.fromName}` : '签名：＿＿＿＿＿'}</span>
              <span>日期：＿＿＿＿年＿＿月＿＿日</span>
            </span>
          )}
          {signed && (
            <span aria-hidden="true" className="mt-3 flex justify-between text-[8.5px] text-[#9a9aa2]">
              <span>签名：{data.from === 'ta' ? `${data.fromName} · ${data.toName}` : `${data.toName} · ${data.fromName}`}</span>
              <span className="font-semibold text-[#e0607e]">已生效 ♡</span>
            </span>
          )}

          {/* 状态大印章（盖在文档右下） */}
          {signed && (
            <span aria-hidden="true" className="absolute bottom-[14px] right-[8px] grid h-[46px] w-[46px] rotate-[-14deg] place-items-center rounded-full border-2 border-[#e0607e]/80 bg-white/70 text-center text-[9px] font-bold leading-[1.25] text-[#e0607e]">
              恋人空间<br />已签署
            </span>
          )}
          {declinedByMe && (
            <span aria-hidden="true" className="absolute bottom-[14px] right-[8px] grid h-[46px] w-[46px] rotate-[-14deg] place-items-center rounded-full border-2 border-[#8e8e96]/70 bg-white/70 text-center text-[9px] font-bold leading-[1.25] text-[#8e8e96]">
              已拒绝
            </span>
          )}
          {declined && !declinedByMe && (
            <span aria-hidden="true" className="absolute bottom-[14px] right-[8px] grid h-[46px] w-[46px] rotate-[-14deg] place-items-center rounded-full border-2 border-[#8e8e96]/70 bg-white/70 text-center text-[9px] font-bold leading-[1.25] text-[#8e8e96]">
              已婉拒
            </span>
          )}
        </span>
      </button>

      {/* 底部：未签署的 TA 卡出「去签署」按钮；其余出状态行（保留原 E2E testid） */}
      {data.from === 'ta' && data.status === 'pending' && !signed && !declined ? (
        <button
          type="button"
          data-testid={`${testidPrefix}-pact-card-sign`}
          onClick={(e) => {
            e.stopPropagation();
            openPact();
          }}
          className="w-full border-t border-black/[0.06] py-2 text-[13.5px] font-medium text-[#f2536a] active:bg-black/[0.04] dark:border-white/[0.08] dark:active:bg-white/[0.06]"
        >
          去签署
        </button>
      ) : (
        <div className="border-t border-black/[0.06] px-3 py-1.5 text-[12px] text-black/40 dark:border-white/[0.08] dark:text-white/40">
          {statusLine} · 恋爱协议
        </div>
      )}
    </div>
  );
}
