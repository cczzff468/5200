'use client';

/**
 * 「文字图片」卡片气泡（信息/微信/QQ 三端共用）：一张印着文字的纸面卡片。
 * Task 13 起文字图片不再依赖图像生成——AI 按人设+聊天记录代笔（或用户代写）一段文字，
 * 直接以卡片消息上屏。variant 仅影响圆角与测试 ID（sms 大圆角 / qq 中圆角 / wx 小圆角），
 * 其余视觉统一：暖纸渐变底 + 引号装饰 + 分隔线署名，深浅色模式各自成套。
 */
export function TextCardBubble({
  text,
  signedBy,
  variant,
}: {
  /** 卡片正文（AI 生成或用户代写；可含换行） */
  text: string;
  /** 右下署名（卡片以谁的身份发出） */
  signedBy: string;
  variant: 'sms' | 'wx' | 'qq';
}) {
  const radius = variant === 'sms' ? 'rounded-[16px]' : variant === 'qq' ? 'rounded-[12px]' : 'rounded-[8px]';
  return (
    <div
      data-testid={`textcard-bubble-${variant}`}
      className={`w-[212px] select-none border border-black/[0.07] bg-gradient-to-br from-[#FDFBF5] via-[#F8F2E7] to-[#F0E9D8] shadow-[0_1px_4px_rgba(0,0,0,0.07)] dark:border-white/[0.09] dark:from-[#2C2C30] dark:via-[#29292D] dark:to-[#242428] ${radius}`}
    >
      <div className="px-4 pb-3 pt-2">
        <span aria-hidden="true" className="block font-serif text-[30px] leading-[1] text-black/[0.13] dark:text-white/[0.15]">
          「
        </span>
        <p className="whitespace-pre-wrap break-words text-[14.5px] leading-[1.9] tracking-[0.02em] text-[#4C463A] dark:text-[#D8D2C4]">
          {text}
        </p>
        <p className="mt-2 border-t border-black/[0.07] pt-[7px] text-right text-[11px] text-black/[0.38] dark:border-white/[0.08] dark:text-white/[0.42]">
          —— {signedBy}
        </p>
      </div>
    </div>
  );
}
