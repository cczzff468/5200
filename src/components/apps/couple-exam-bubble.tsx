'use client';

/**
 * 恋爱水平考试卡片气泡（第十五轮）——微信/QQ 聊天共用。
 *
 * 用户规格：我可以喊他来答题（发卡片）；他也可以喊我来答题（他自己弄的试卷，发卡片）；
 * 点击卡片进入试卷页面。仿协议卡（couple-pact-bubble）的白底卡样式。
 */

import type { CoupleExamCardData } from '@/lib/ios/couple-exam-share';
import { navToExam } from '@/lib/ios/couple-exam-share';
import { useUI } from '@/lib/ios/store';

export interface CoupleExamBubbleProps {
  data: CoupleExamCardData;
  /** 消息是否我发的（msg.role === 'me'） */
  mine: boolean;
  testidPrefix?: string; // 'wx' | 'qq'（E2E 用）
}

export default function CoupleExamBubble({ data, testidPrefix = 'wx' }: CoupleExamBubbleProps) {
  void data.from; // from 决定文案（下方已用 fromName/from 分支）

  /** 点击卡片 → 进恋人空间考试页（TA 的卷直达答题；我的卷查看/继续答） */
  const openExam = () => {
    const ui = useUI.getState();
    if (ui.locked) return;
    navToExam(data.from);
    if (ui.activeApp && ui.activeApp !== 'couple') ui.switchToApp('couple');
    else if (!ui.activeApp && ui.phase === 'closed') ui.openApp('couple');
  };

  return (
    <div
      data-testid={`${testidPrefix}-exam-card`}
      className="w-[248px] select-none overflow-hidden rounded-[10px] bg-white shadow-sm dark:bg-[#1E1E1E]"
    >
      {/* 卡片本体：标题 + 试卷信息 + 图标（点击进试卷页面） */}
      <button
        type="button"
        data-testid={`${testidPrefix}-exam-card-body`}
        onClick={(e) => {
          e.stopPropagation();
          openExam();
        }}
        className="flex w-full cursor-pointer items-start gap-2.5 px-3 pb-2.5 pt-3 text-left transition-opacity active:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15.5px] font-semibold leading-[1.35] text-black dark:text-white">
            {data.from === 'ta' ? `${data.fromName}喊你来答题` : `${data.fromName}的考试邀请`}
          </span>
          <span className="mt-0.5 block text-[13px] font-medium text-[#f2536a] dark:text-[#f9a8d4]">《{data.title}》</span>
          <span className="mt-1 block text-[12px] leading-[1.5] text-black/45 dark:text-white/45">
            共 {data.count} 题 · 满分 100 分 · 点卡片进入试卷
          </span>
        </span>
        {/* 恋人空间图标（粉色双心官方原图，圆角方块） */}
        <span aria-hidden="true" className="h-11 w-11 shrink-0 overflow-hidden rounded-[9px] shadow-[0_2px_6px_rgba(0,0,0,0.10)]">
          <img src="/icons/couple.png" alt="恋人空间" className="h-full w-full object-cover" draggable={false} />
        </span>
      </button>

      {/* 底部入口 */}
      <button
        type="button"
        data-testid={`${testidPrefix}-exam-card-go`}
        onClick={(e) => {
          e.stopPropagation();
          openExam();
        }}
        className="w-full border-t border-black/[0.06] py-2 text-[13.5px] font-medium text-[#f2536a] active:bg-black/[0.04] dark:border-white/[0.08] dark:active:bg-white/[0.06]"
      >
        {data.from === 'ta' ? '去答题' : '查看试卷'}
      </button>
    </div>
  );
}
