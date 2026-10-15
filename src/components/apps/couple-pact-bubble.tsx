'use client';

/**
 * 恋爱协议卡片气泡（第十二轮）——微信/QQ 聊天共用。
 *
 * 用户规格：分享协议在聊天界面需要发送一个卡片，点击卡片进入签署协议界面。
 * 仿亲密关系卡（couple-rel-bubble）的白底卡样式：
 * - 标题《协议名》+ 条款前 2 条摘要 + 右侧恋人空间图标 + 底部「恋爱协议」小字标签；
 * - TA 分享且 pending → 底部「去签署」按钮；declined → 显示 TA 的婉拒理由；
 * - 点击卡片本体 → 记 pending + 切进恋人空间 App（PactPage 消费后跳对应界面）。
 */

import type { CouplePactCardData } from '@/lib/ios/couple-pact-share';
import { navToPact } from '@/lib/ios/couple-pact-share';
import { useUI } from '@/lib/ios/store';

export interface CouplePactBubbleProps {
  data: CouplePactCardData;
  /** 消息是否我发的（msg.role === 'me'） */
  mine: boolean;
  testidPrefix?: string; // 'wx' | 'qq'（E2E 用）
}

export default function CouplePactBubble({ data, mine, testidPrefix = 'wx' }: CouplePactBubbleProps) {
  const declined = data.status === 'declined';
  const signed = data.status === 'signed';

  /** 点击卡片 → 进恋人空间协议页（对应签署/回看界面） */
  const openPact = () => {
    const ui = useUI.getState();
    if (ui.locked) return;
    navToPact({ pactId: data.pactId, from: data.from });
    if (ui.activeApp && ui.activeApp !== 'couple') ui.switchToApp('couple');
    else if (!ui.activeApp && ui.phase === 'closed') ui.openApp('couple');
  };

  // 状态行文案
  let statusLine: string;
  if (data.from === 'ta') {
    statusLine = declined ? (data.reason ? `TA 想了想：${data.reason}` : 'TA 婉拒了这份协议') : signed ? 'TA 已签署生效' : 'TA 想和你签这份协议';
  } else {
    statusLine = declined ? `对方回复：${data.reason ?? '先不签了'}` : signed ? '对方已签署生效' : `等待${data.toName}签署`;
  }
  void mine;

  return (
    <div
      data-testid={`${testidPrefix}-pact-card`}
      className={`w-[248px] select-none overflow-hidden rounded-[10px] bg-white shadow-sm dark:bg-[#1E1E1E] ${declined ? 'opacity-75' : ''}`}
    >
      {/* 卡片本体：标题 + 条款摘要 + 图标（点击进签署界面） */}
      <button
        type="button"
        data-testid={`${testidPrefix}-pact-card-body`}
        onClick={(e) => {
          e.stopPropagation();
          openPact();
        }}
        className="flex w-full cursor-pointer items-start gap-2.5 px-3 pb-2.5 pt-3 text-left transition-opacity active:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15.5px] font-semibold leading-[1.35] text-black dark:text-white">{data.fromName}的恋爱协议</span>
          <span className="mt-0.5 block text-[13px] font-medium text-[#f2536a] dark:text-[#f9a8d4]">《{data.title}》</span>
          <span className="mt-1 block text-[12px] leading-[1.5] text-black/45 dark:text-white/45">
            {data.clauses.slice(0, 2).map((c, i) => (
              <span key={i} className="block truncate">
                {i + 1}. {c}
              </span>
            ))}
            {data.clauses.length > 2 && <span className="block">…共 {data.clauses.length} 条条款</span>}
          </span>
        </span>
        {/* 恋人空间图标（粉色双心官方原图，圆角方块） */}
        <span aria-hidden="true" className="h-11 w-11 shrink-0 overflow-hidden rounded-[9px] shadow-[0_2px_6px_rgba(0,0,0,0.10)]">
          <img src="/icons/couple.png" alt="恋人空间" className="h-full w-full object-cover" draggable={false} />
        </span>
      </button>

      {/* 底部：TA 的 pending 卡出「去签署」按钮；其余出状态行 */}
      {data.from === 'ta' && data.status === 'pending' ? (
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
