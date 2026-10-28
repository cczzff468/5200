'use client';

/**
 * 网易云音乐同款 VIP 歌曲角标（歌曲列表 fee===1 时展示，music-home / music-heart 复用）：
 * 对照网易云 App 歌曲列表的真实 VIP 图标——浅金色渐变小圆角矩形（上浅下深）+ 深金色粗体
 * 「VIP」字样，无描边（原实现是红色描边文字，假）；金色系徽章在浅色列表与心动模式深色
 * 页面上同样成立，无需分主题
 */

/** VIP 角标：高 14px、圆角 3px、字号 9px、左右内边距 3px（真实图标同比例） */
export function VipBadge({ className = '' }: { className?: string }) {
  return (
    <span
      aria-label="VIP 歌曲"
      className={`inline-flex h-[14px] shrink-0 items-center justify-center rounded-[3px] bg-gradient-to-b from-[#F9E7B8] to-[#EFD08E] px-[3px] text-[9px] font-semibold leading-none tracking-[0.2px] text-[#B4770A] ${className}`}
    >
      VIP
    </span>
  );
}
