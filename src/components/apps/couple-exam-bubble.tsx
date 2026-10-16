'use client';

/**
 * 恋爱水平考试卡片气泡（第十五轮；第二十三轮按参考截图整体美化）——微信/QQ 聊天共用。
 *
 * 第二十三轮卡片视觉（对照用户参考图「恋人空间分享卡」）：
 * - 顶部：粉色双心圆 logo +「恋人空间」灰色小字；
 * - 大标题：「恋爱水平考试已开始，请考生作答」（黑体加粗，两行）；
 * - 海报区（纯 CSS/SVG 复刻复古试卷海报）：米黄纸底+藏蓝描边，左列「你有一份/恋爱水平考试卷/待作答」
 *   + 认真作答小字 + 藏蓝「点击进入作答」按钮；右侧斜贴一张迷你试卷（绝密章/考生须知/Q1-Q3 选项框/
 *   100分恋人红章）；底部牛皮纸「机密文件」+ 拍立得合影 + 条码；
 * - 底部灰条：来源与状态（未答=共N题·满分100分；已答完=查看结果）。
 *
 * 用户规格：我可以喊他来答题（发卡片）；他也可以喊我来答题；点击卡片进入试卷页面。
 * 第十七轮·动态状态：答完后卡片自愈显示「已答完」，点卡片直达结果/答卷页。
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

/** 恋人空间圆角方形 logo（官方原图自带圆角，与恋人空间截图一致） */
function AppLogo() {
  return <img src="/icons/couple.png" alt="" aria-hidden="true" className="h-[27px] w-[27px] rounded-[7px] object-cover shadow-[0_1px_3px_rgba(0,0,0,0.14)]" draggable={false} />;
}

/** 小对勾方块（迷你试卷选项前） */
function CheckBox({ tick }: { tick?: boolean }) {
  return (
    <span aria-hidden="true" className={`inline-block h-[6px] w-[6px] shrink-0 border ${tick ? 'border-[#c23b3b] bg-[#c23b3b]' : 'border-[#8a8f9c] bg-white'} leading-none`}>
      {tick && <svg viewBox="0 0 8 8" className="h-full w-full"><path d="M1.6 4.2 3.3 5.8 6.4 2.2" fill="none" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" /></svg>}
    </span>
  );
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
      {/* 卡片本体（点击进试卷页面）：logo 头 + 大标题 + 复古试卷海报 */}
      <button
        type="button"
        data-testid={`${testidPrefix}-exam-card-body`}
        onClick={(e) => {
          e.stopPropagation();
          openExam();
        }}
        className="relative block w-full cursor-pointer px-3.5 pb-3 pt-3 text-left transition-opacity active:opacity-[0.92]"
      >
        {/* 顶部：App logo + 名称（对照参考图「♡ 恋人空间」） */}
        <span className="flex items-center gap-2">
          <AppLogo />
          <span className="text-[14.5px] font-semibold text-[#4a4a52]">恋人空间</span>
        </span>
        {/* 大标题 */}
        <span className="mt-2 block text-[19px] font-bold leading-[1.42] tracking-[0.01em] text-[#111114]">
          {data.from === 'ta' ? `${data.fromName}的考试已开始，请考生作答` : '恋爱水平考试已开始，请考生作答'}
        </span>

        {/* —— 复古试卷海报（纯 CSS/SVG） —— */}
        <span className="relative mt-2.5 block overflow-hidden rounded-[3px] border-[1.5px] border-[#2d3a5c] bg-[#f3ecd8] p-[7px] shadow-[inset_0_0_0_1px_rgba(45,58,92,0.25)]">
          {/* 纸张噪点（细点阵） */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.35]" style={{ backgroundImage: 'radial-gradient(rgba(45,58,92,0.10) 0.5px, transparent 0.6px)', backgroundSize: '7px 7px' }} />

          <span className="relative flex gap-[7px]">
            {/* 左列：主文案 */}
            <span className="w-[45%] shrink-0">
              {/* 徽章行：夹板 + 考试名 */}
              <span className="flex items-center gap-1">
                <svg viewBox="0 0 12 14" className="h-[11px] w-[9px] shrink-0" aria-hidden="true">
                  <rect x="1" y="2" width="10" height="11" rx="1" fill="none" stroke="#2d3a5c" strokeWidth="1.1" />
                  <rect x="3.6" y="0.6" width="4.8" height="2.6" rx="0.8" fill="#2d3a5c" />
                  <path d="M3 6h6M3 8.4h6M3 10.8h4" stroke="#2d3a5c" strokeWidth="0.9" strokeLinecap="round" />
                </svg>
                <span className="text-[9.5px] font-extrabold tracking-[1px] text-[#2d3a5c]">恋爱水平考试</span>
              </span>
              <span className="mt-[1px] block text-[6px] tracking-[1.5px] text-[#2d3a5c]/70">LOVE LEVEL EXAMINATION</span>
              <span className="mt-2 block text-[15.5px] font-black leading-[1.32] text-[#2d3a5c]">你有一份</span>
              <span className="block text-[15.5px] font-black leading-[1.32] text-[#c23b3b]">恋爱水平考试卷</span>
              <span className="block text-[15.5px] font-black leading-[1.32] text-[#2d3a5c]">待作答</span>
              {/* 分隔小字 */}
              <span className="mt-1.5 flex items-center gap-1" aria-hidden="true">
                <span className="h-px flex-1 bg-[#2d3a5c]/30" />
                <span className="text-[5.5px] text-[#c23b3b]">★</span>
                <span className="h-px flex-1 bg-[#2d3a5c]/30" />
              </span>
              <span className="mt-1 block text-center text-[7px] font-semibold tracking-wide text-[#2d3a5c]">认真作答，测出你们的恋爱真实水平</span>
              {/* 藏蓝按钮 */}
              <span className="mt-2.5 flex h-[24px] items-center justify-center gap-1 rounded-[3px] bg-[#2d3a5c] text-white shadow-[0_1.5px_3px_rgba(45,58,92,0.4)]">
                <svg viewBox="0 0 12 14" className="h-[9px] w-[8px]" aria-hidden="true">
                  <rect x="1" y="2" width="10" height="11" rx="1" fill="none" stroke="#fff" strokeWidth="1.1" />
                  <rect x="3.6" y="0.6" width="4.8" height="2.6" rx="0.8" fill="#fff" />
                </svg>
                <span className="text-[8.5px] font-bold tracking-wide">点击进入作答</span>
                <svg viewBox="0 0 8 8" className="h-[8px] w-[8px]" aria-hidden="true">
                  <circle cx="4" cy="4" r="3.6" fill="rgba(255,255,255,0.25)" />
                  <path d="M3.1 2.4 5.3 4 3.1 5.6Z" fill="#fff" />
                </svg>
              </span>
            </span>

            {/* 右列：斜贴的迷你试卷 */}
            <span className="relative min-w-0 flex-1">
              <span className="relative block rotate-[2deg] border border-[#d8d2c0] bg-white p-[6px] shadow-[1px_2px_4px_rgba(0,0,0,0.14)]">
                {/* 卷头 */}
                <span className="relative block text-center">
                  <span className="text-[8px] font-extrabold tracking-[0.5px] text-[#1d2540]">恋爱水平考试</span>
                  <span className="absolute -right-[2px] -top-[3px] rotate-[14deg] rounded-[2px] border border-[#c23b3b] px-[2px] text-[5.5px] font-bold leading-[1.4] text-[#c23b3b]">绝密</span>
                </span>
                <span aria-hidden="true" className="mt-[2px] block text-center text-[5px] tracking-[2px] text-[#c23b3b]">★ ★ ★</span>
                <span className="mt-[3px] flex justify-between border-y border-dashed border-[#c9c4b2] py-[2px] text-[4.6px] leading-[1.5] text-[#6e6e76]">
                  <span>考试时间：随时不限时</span>
                  <span>出题单位：恋人空间</span>
                </span>
                {/* Q1 */}
                <span className="mt-[4px] block text-[6.2px] font-bold text-[#1d2540]">Q1. 她生气时，你的第一反应是？</span>
                <span className="mt-[1.5px] block space-y-[1px]">
                  <span className="flex items-center gap-[2.5px] text-[5.6px] text-[#4a4a52]"><CheckBox /> A. 立刻哄她</span>
                  <span className="flex items-center gap-[2.5px] text-[5.6px] text-[#4a4a52]"><CheckBox /> B. 等她气消再说</span>
                  <span className="flex items-center gap-[2.5px] text-[5.6px] text-[#4a4a52]"><CheckBox /> C. 和她讲道理</span>
                </span>
                {/* Q2 */}
                <span className="mt-[4px] block text-[6.2px] font-bold text-[#1d2540]">Q2. 纪念日常备？</span>
                <span className="mt-[1.5px] block space-y-[1px]">
                  <span className="flex items-center gap-[2.5px] text-[5.6px] text-[#4a4a52]"><CheckBox /> A. 提前很久准备</span>
                  <span className="flex items-center gap-[2.5px] text-[5.6px] text-[#4a4a52]"><CheckBox tick /> B. 你说想要的我记着</span>
                  <span className="flex items-center gap-[2.5px] text-[5.6px] text-[#4a4a52]"><CheckBox /> C. 总是忘了</span>
                </span>
                {/* Q3 */}
                <span className="mt-[4px] block text-[6.2px] font-bold text-[#1d2540]">Q3. 她「随便」，你会？</span>
                <span className="mt-[1.5px] block space-y-[1px]">
                  <span className="flex items-center gap-[2.5px] text-[5.6px] text-[#4a4a52]"><CheckBox /> A. 那就随便</span>
                  <span className="flex items-center gap-[2.5px] text-[5.6px] text-[#4a4a52]"><CheckBox /> B. 选她想要的</span>
                </span>
                {/* 手写 100 + 红章 */}
                <span aria-hidden="true" className="absolute bottom-[16px] right-[2px] select-none text-[13px] font-black italic leading-none text-[#c23b3b] opacity-80" style={{ transform: 'rotate(-8deg)' }}>
                  100
                </span>
                <span aria-hidden="true" className="absolute right-[1px] top-[30px] grid h-[30px] w-[30px] rotate-[16deg] place-items-center rounded-full border-[1.5px] border-[#c23b3b]/75 text-center text-[5px] font-bold leading-[1.3] text-[#c23b3b]/85">
                  认真作答<br />100分恋人
                </span>
              </span>
            </span>
          </span>

          {/* 底部：牛皮纸机密 + 拍立得 + 条码 */}
          <span className="relative mt-[7px] flex items-end gap-[6px] px-[2px] pb-[2px]">
            <span className="relative h-[40px] w-[24%] shrink-0 rounded-[2px] border border-[#a9855c] bg-[linear-gradient(160deg,#d9b98c,#c9a470)]">
              <span aria-hidden="true" className="absolute left-[4px] top-[4px] h-[5px] w-[5px] rounded-full border border-[#7a5a34] bg-[#e8d3ae]" />
              <span aria-hidden="true" className="absolute bottom-[4px] right-[4px] h-[5px] w-[5px] rounded-full border border-[#7a5a34] bg-[#e8d3ae]" />
              <span aria-hidden="true" className="absolute left-[4px] top-[7px] h-[24px] w-px rotate-[55deg] bg-[#7a5a34]/60" />
              <span className="absolute inset-0 grid place-items-center">
                <span className="text-center text-[5.6px] font-bold leading-[1.5] text-[#8c2f2f]">
                  机密文件<br />
                  <span className="text-[4.6px] font-semibold text-[#8c2f2f]/80">仅限情侣作答</span>
                </span>
              </span>
            </span>
            {/* 拍立得（粉调剪影合影） */}
            <span className="flex-1 rounded-[2px] bg-white p-[3px] pb-[8px] shadow-[1px_2px_3px_rgba(0,0,0,0.14)]">
              <span className="relative block h-[30px] overflow-hidden rounded-[1px] bg-[linear-gradient(160deg,#fbd3de,#f6b8c9)]">
                <svg viewBox="0 0 60 30" className="h-full w-full" aria-hidden="true">
                  <circle cx="24" cy="11" r="5" fill="#5b4a4e" />
                  <path d="M16 28c0-6 3.6-9.5 8-9.5s8 3.5 8 9.5Z" fill="#5b4a4e" />
                  <circle cx="37" cy="12" r="4.4" fill="#7a5f63" />
                  <path d="M30 28c0-5.4 3.2-8.6 7-8.6s7 3.2 7 8.6Z" fill="#7a5f63" />
                  <path d="M28.6 6.2c.9-1.8 3-1.8 3.9-.4.9-1.4 3-1.4 3.9.4.7 1.5-.9 3.2-3.9 5-3-1.8-4.6-3.5-3.9-5Z" fill="#e0567a" />
                </svg>
                <span aria-hidden="true" className="absolute right-[3px] top-[2px] text-[5px] text-[#e0567a]">♥</span>
              </span>
            </span>
            {/* 条码 */}
            <span aria-hidden="true" className="h-[30px] w-[12%] shrink-0" style={{ backgroundImage: 'repeating-linear-gradient(90deg,#2d3a5c 0 1px,transparent 1px 2.5px,#2d3a5c 2.5px 3.5px,transparent 3.5px 5.5px)' }} />
          </span>

          {/* 已答完：盖蓝章 */}
          {done && (
            <span aria-hidden="true" className="absolute right-[10px] top-[10px] grid h-[42px] w-[42px] rotate-[14deg] place-items-center rounded-full border-2 border-[#576b95] bg-white/85 text-[9px] font-bold leading-[1.2] text-[#576b95] shadow-sm">
              已<br />答<br />完
            </span>
          )}
        </span>
      </button>

      {/* 底部来源条（对照微信卡片底部灰字；保留原 E2E testid） */}
      <button
        type="button"
        data-testid={`${testidPrefix}-exam-card-go`}
        onClick={(e) => {
          e.stopPropagation();
          openExam();
        }}
        className="w-full border-t border-black/[0.06] px-3 py-[7px] text-left text-[11px] text-black/40 active:bg-black/[0.03] dark:border-white/[0.08] dark:text-white/40"
      >
        {done ? '这场考试已结束 · 点击查看结果' : `恋人空间 · 共 ${data.count} 题 · 满分 100 分`}
      </button>
    </div>
  );
}
