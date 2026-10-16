'use client';

/**
 * 恋爱水平考试卡片气泡（第十五轮）——微信/QQ 聊天共用。
 *
 * 第二十七轮（用户要求）：邀请卡片和淘宝/美团代付卡片样式一模一样（只换内容）——
 * 结构完全对齐 TbPayBubble/MtPayBubble：白卡 p-2.5 rounded-[14px] + 指向头像侧的小箭头
 * + 头部（logo 22px + 恋人空间 + ShieldCheck 真爱保障）+ 主标题 15px truncate
 * + 粉色横幅(88px)+白色面板拼接圆角块（小字 + 卷名大字 + 粉渐变胶囊按钮）。
 * 上下更矮；已答完卡整体褪灰（同代付完成卡语义）。
 *
 * 用户规格：我可以喊他来答题（发卡片）；他也可以喊我来答题；点击卡片进入试卷页面。
 * 第十七轮·动态状态：答完后卡片自愈显示「已答完」，点卡片直达结果/答卷页。
 */

import type { CoupleExamCardData } from '@/lib/ios/couple-exam-share';
import { navToExam } from '@/lib/ios/couple-exam-share';
import { kvGet } from '@/lib/ios/idb-kv';
import { useUI } from '@/lib/ios/store';
import { ClipboardList, GraduationCap, ShieldCheck } from 'lucide-react';

export interface CoupleExamBubbleProps {
  data: CoupleExamCardData;
  /** 消息是否我发的（msg.role === 'me'） */
  mine: boolean;
  testidPrefix?: string; // 'wx' | 'qq'（E2E 用）
}

export default function CoupleExamBubble({ data, mine, testidPrefix = 'wx' }: CoupleExamBubbleProps) {
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
      onClick={(e) => {
        e.stopPropagation();
        openExam();
      }}
      className="relative block w-[252px] cursor-pointer select-none rounded-[14px] bg-white p-2.5 text-left shadow-[0_5px_16px_rgba(0,0,0,0.10)] transition-all duration-300 active:brightness-95"
      style={{ filter: done ? 'grayscale(0.72) brightness(0.98)' : undefined }}
      role="button"
      aria-label={`恋爱水平考试邀请卡（共 ${data.count} 题，${done ? '已答完' : '待作答'}）`}
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

      {/* 主标题（对齐代付卡文案结构；终态换对应描述） */}
      <span className="relative mt-1.5 block truncate text-[15px] font-semibold leading-snug text-black/90">
        {done ? 'Hi~这场考试已经答完啦~' : data.from === 'ta' ? `Hi~${data.fromName}出了份考卷等你答~` : 'Hi~我出了份恋爱考卷等你答~'}
      </span>

      {/* 粉色横幅 + 白色信息面板：拼接为一个整体圆角块（粉上白下、无缝相连） */}
      <span className="relative mt-2 block overflow-hidden rounded-[10px] ring-1 ring-black/[0.06]">
        <span className="relative block h-[88px] overflow-hidden bg-gradient-to-r from-[#ff7a9c] to-[#f2536a]">
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-25" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.55) 1px, transparent 1.4px)', backgroundSize: '16px 16px' }} />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[15px] font-bold text-white drop-shadow-sm">{done ? '考试已结束啦~' : '来答恋爱考卷吧~'}</span>
          <GraduationCap className="absolute right-3 top-1/2 h-8 w-8 -translate-y-1/2 text-white/35" strokeWidth={1.6} aria-hidden="true" />
        </span>
        {/* 信息面板（白色，与上方粉色横幅拼接成一块） */}
        <span className="relative block bg-white px-3 pb-3 pt-2 text-center">
          {done ? (
            <>
              <span className="mt-0.5 block text-[21px] font-bold leading-tight tracking-tight text-black/90" data-testid={`${testidPrefix}-exam-card-body`}>
                考试已结束
              </span>
              <span className="mt-1 block truncate text-[11.5px] text-black/40">{data.from === 'me' ? `${data.toName}已交卷 · 点击查看TA的答卷` : '点击查看你的成绩单'}</span>
            </>
          ) : (
            <>
              <span className="block text-[11.5px] text-black/40">共 {data.count} 道题 · 满分 100 分</span>
              <span className="mt-0.5 block truncate text-[21px] font-bold leading-tight tracking-tight text-black/90" data-testid={`${testidPrefix}-exam-card-body`}>
                {data.title || '恋爱水平考试'}
              </span>
            </>
          )}
          <span
            data-testid={`${testidPrefix}-exam-card-go`}
            className="mt-2.5 flex h-9 items-center justify-center rounded-full bg-gradient-to-r from-[#ff7a9c] to-[#f2536a] text-[14px] font-bold text-white shadow-[0_3px_10px_rgba(242,83,106,0.28)]"
          >
            {done ? (
              '查看结果'
            ) : (
              <>
                <ClipboardList className="mr-1 h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
                去答题
              </>
            )}
          </span>
        </span>
      </span>
    </div>
  );
}
