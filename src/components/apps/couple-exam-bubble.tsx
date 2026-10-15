'use client';

/**
 * 恋爱水平考试卡片气泡（第十五轮）——微信/QQ 聊天共用。
 *
 * 用户规格：我可以喊他来答题（发卡片）；他也可以喊我来答题（他自己弄的试卷，发卡片）；
 * 点击卡片进入试卷页面。仿协议卡（couple-pact-bubble）的白底卡样式。
 * 第十七轮·动态状态：我答完（TA 出的卷）或 TA 答完（我邀请的卷）后，卡片自愈显示「已答完」，
 * 点卡片直达答完的结果/答卷页，不再是答题页。
 */

import type { CoupleExamCardData } from '@/lib/ios/couple-exam-share';
import { navToExam } from '@/lib/ios/couple-exam-share';
import { kvGet } from '@/lib/ios/idb-kv';
import { useUI } from '@/lib/ios/store';

export interface CoupleExamBubbleProps {
  data: CoupleExamCardData;
  /** 消息是否我发的（msg.role === 'me'） */
  mine: boolean;
  testidPrefix?: string; // 'wx' | 'qq'（E2E 用）
}

export default function CoupleExamBubble({ data, mine, testidPrefix = 'wx' }: CoupleExamBubbleProps) {
  void mine;
  // 动态状态（自愈）：以恋人空间当前状态为准——TA 出的卷我答完 = done；我邀请的卷 TA 交卷 = done
  const done = (() => {
    if (data.status === 'done') return true;
    try {
      const snap = kvGet<{ examTaSheet?: { title?: string } | null; examTaPaper?: { title?: string; answered?: boolean } | null }>('couple-space:state');
      if (data.from === 'me') {
        const sheet = snap?.examTaSheet;
        return !!sheet && (!sheet.title || sheet.title === data.title);
      }
      const paper = snap?.examTaPaper;
      return !!paper?.answered && (!paper.title || paper.title === data.title);
    } catch {
      return false;
    }
  })();

  /** 点击卡片 → 进恋人空间考试页（答完直达结果/答卷页，没答直达答题页；ExamPage 按当前状态自动分流） */
  const openExam = () => {
    const ui = useUI.getState();
    if (ui.locked) return;
    navToExam(data.from, data.title);
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
            {done ? '这场考试已结束 · 点卡片查看结果' : `共 ${data.count} 题 · 满分 100 分 · 点卡片进入试卷`}
          </span>
        </span>
        {/* 恋人空间图标（粉色双心官方原图，圆角方块）；已答完时右上角盖小蓝章 */}
        <span className="relative h-11 w-11 shrink-0">
          <span aria-hidden="true" className="block h-11 w-11 overflow-hidden rounded-[9px] shadow-[0_2px_6px_rgba(0,0,0,0.10)]">
            <img src="/icons/couple.png" alt="恋人空间" className="h-full w-full object-cover" draggable={false} />
          </span>
          {done && (
            <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 rotate-12 rounded-[4px] border border-[#576b95] bg-white/95 px-1 py-px text-[9px] font-bold leading-tight text-[#576b95] shadow-sm">
              已答完
            </span>
          )}
        </span>
      </button>

      {/* 底部入口（动态：答完 → 查看结果/答卷；未答 → 去答题/查看试卷） */}
      <button
        type="button"
        data-testid={`${testidPrefix}-exam-card-go`}
        onClick={(e) => {
          e.stopPropagation();
          openExam();
        }}
        className="w-full border-t border-black/[0.06] py-2 text-[13.5px] font-medium text-[#f2536a] active:bg-black/[0.04] dark:border-white/[0.08] dark:active:bg-white/[0.06]"
      >
        {done ? (data.from === 'ta' ? '已答完 · 查看成绩' : '已交卷 · 查看 TA 的答卷') : data.from === 'ta' ? '去答题' : '查看试卷'}
      </button>
    </div>
  );
}
