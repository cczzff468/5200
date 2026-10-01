'use client';

import { Copy, ImageIcon, Loader2, Sparkle } from 'lucide-react';
import { useState } from 'react';

/**
 * 「文字图片」卡片气泡（信息/微信/QQ 三端共用）：一张印着文字的纸面卡片。
 * 文字图片是「我」发给 TA 的卡片（AI 按人设+聊天记录代笔，或用户代写），点击可转成真图。
 * 视觉：暖纸渐变底 + 顶部和纸胶带 + 「文字图片」小标签 + 内虚线相框 + 宋体正文 + 右下署名，
 * 深浅色模式各自成套；variant 仅影响圆角与测试 ID（sms 大圆角 / qq 中圆角 / wx 小圆角）。
 */
export function TextCardBubble({
  text,
  signedBy,
  variant,
  onClick,
}: {
  /** 卡片正文（AI 代笔/用户代写；可含换行） */
  text: string;
  /** 右下署名（卡片以谁的身份发出） */
  signedBy: string;
  variant: 'sms' | 'wx' | 'qq';
  /** 点击卡片（弹出「生成图片/复制文字」操作面板；信息/微信/QQ 三端接线） */
  onClick?: () => void;
}) {
  const radius = variant === 'sms' ? 'rounded-[16px]' : variant === 'qq' ? 'rounded-[12px]' : 'rounded-[8px]';
  const inner =
    'relative w-[212px] select-none overflow-hidden border border-black/[0.08] bg-gradient-to-br from-[#FDFBF4] via-[#F8F2E5] to-[#EFE7D2] shadow-[0_2px_10px_rgba(88,74,44,0.13),0_1px_2px_rgba(0,0,0,0.05)] transition-transform active:scale-[0.985] dark:border-white/[0.10] dark:from-[#2C2C31] dark:via-[#29292E] dark:to-[#242429] dark:shadow-[0_2px_10px_rgba(0,0,0,0.35)]';
  return onClick ? (
    <button
      type="button"
      data-testid={`textcard-bubble-${variant}`}
      aria-label={`文字图片卡片：${text.slice(0, 24)}`}
      onClick={onClick}
      className={`${radius} ${inner} block text-left`}
    >
      <CardFace text={text} signedBy={signedBy} />
    </button>
  ) : (
    <div data-testid={`textcard-bubble-${variant}`} className={`${radius} ${inner}`}>
      <CardFace text={text} signedBy={signedBy} />
    </div>
  );
}

/** 卡片面（正文 + 装饰）：带/不带点击的两种外壳共用 */
function CardFace({ text, signedBy }: { text: string; signedBy: string }) {
  return (
    <div className="px-[14px] pb-[10px] pt-[14px]">
      {/* 顶部和纸胶带：贴在卡片上沿的小胶条，手账质感 */}
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-0 h-[15px] w-[58px] -translate-x-1/2 -translate-y-[5px] rotate-[-2deg] rounded-[2px] bg-[#CBB98F]/40 shadow-[0_1px_2px_rgba(0,0,0,0.06)] dark:bg-white/[0.10]"
      />
      {/* 标签行：左「✦ 文字图片」，右小相片图标（点击卡片可把它生成真图） */}
      <div className="mb-[6px] flex items-center justify-between">
        <span className="flex items-center gap-[4px] text-[9.5px] font-medium tracking-[0.22em] text-[#8A7B58] dark:text-[#B7A87F]">
          <Sparkle className="h-[9px] w-[9px]" strokeWidth={2.2} aria-hidden="true" />
          文字图片
        </span>
        <ImageIcon className="h-[11px] w-[11px] text-black/[0.20] dark:text-white/[0.24]" aria-hidden="true" />
      </div>
      {/* 内虚线相框：像贴纸相册里压出的一格 */}
      <div className="rounded-[9px] border border-dashed border-[#B7A87F]/45 px-[11px] pb-[8px] pt-[2px] dark:border-white/[0.14]">
        <span
          aria-hidden="true"
          className="block font-serif text-[26px] leading-[1] text-[#B7A87F]/55 dark:text-white/[0.16]"
        >
          「
        </span>
        <p className="whitespace-pre-wrap break-words font-serif text-[14.5px] leading-[1.85] tracking-[0.03em] text-[#4A4335] dark:text-[#DCD5C5]">
          {text}
        </p>
        <p className="mt-[7px] border-t border-dashed border-[#B7A87F]/35 pt-[6px] text-right font-serif text-[11px] tracking-[0.06em] text-black/[0.40] dark:border-white/[0.10] dark:text-white/[0.42]">
          —— {signedBy}
        </p>
      </div>
    </div>
  );
}

/**
 * 「文字图片」卡片操作面板（信息/微信/QQ 点击卡片弹出，共用）：
 * 顶部卡片文字预览 + 「用图像生成生成图片」（走 设置 › 图像生成 的配置；busy 转圈）
 * + 「复制文字」（内部处理剪贴板与降级，结果经 onToast 反馈）。
 */
export function TextCardActionSheet({
  text,
  busy,
  accent,
  onGenerate,
  onToast,
  onClose,
}: {
  /** 卡片文字（预览 + 生成图片提示词 + 复制内容） */
  text: string;
  /** 正在生成图片（生成行转圈，面板不可关闭） */
  busy: boolean;
  /** 各端主题色（信息 #007AFF / 微信 #07C160 / QQ #0099FF） */
  accent: string;
  onGenerate: () => void;
  onToast: (m: string) => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  /** 复制卡片文字：clipboard API 失败（非安全上下文等）降级 execCommand */
  const doCopy = async () => {
    if (copied) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onToast('已复制卡片文字');
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true);
        onToast('已复制卡片文字');
        window.setTimeout(() => setCopied(false), 1600);
      } catch {
        onToast('复制失败，请长按卡片文字手动复制');
      }
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 px-3 pb-[max(14px,env(safe-area-inset-bottom))]" data-testid="textcard-actions-sheet">
      <div className="w-full max-w-[340px]">
        <div className="overflow-hidden rounded-[14px] bg-white/95 pb-1 backdrop-blur-xl dark:bg-[#252528]/95">
          {/* 预览头：要处理的卡片文字 */}
          <div className="border-b border-black/[0.06] px-4 pb-2.5 pt-3 dark:border-white/[0.08]">
            <p className="text-[11px] tracking-[0.08em] text-black/40 dark:text-white/40">文字图片</p>
            <p className="mt-0.5 line-clamp-2 break-all text-[13px] leading-[1.5] text-black/65 dark:text-white/70">{text}</p>
          </div>
          <button
            type="button"
            data-testid="textcard-gen"
            onClick={onGenerate}
            disabled={busy}
            className="flex min-h-[50px] w-full items-center justify-center gap-2 text-[16px] font-medium active:bg-black/[0.05] disabled:opacity-60 dark:active:bg-white/[0.06]"
            style={{ color: accent }}
          >
            {busy ? (
              <>
                <Loader2 className="h-[17px] w-[17px] animate-spin" strokeWidth={2.4} aria-hidden="true" />
                正在生成图片…
              </>
            ) : (
              <>
                <ImageIcon className="h-[17px] w-[17px]" strokeWidth={2} aria-hidden="true" />
                用图像生成生成图片
              </>
            )}
          </button>
          <div className="mx-4 h-px bg-black/[0.05] dark:bg-white/[0.07]" />
          <button
            type="button"
            data-testid="textcard-copy"
            onClick={() => void doCopy()}
            className="flex min-h-[50px] w-full items-center justify-center gap-2 text-[16px] font-medium text-black/80 active:bg-black/[0.05] dark:text-white/80 dark:active:bg-white/[0.06]"
          >
            <Copy className="h-[16px] w-[16px]" strokeWidth={2} aria-hidden="true" />
            {copied ? '已复制' : '复制文字'}
          </button>
        </div>
        <button
          type="button"
          data-testid="textcard-cancel"
          onClick={onClose}
          disabled={busy}
          className="mt-2 flex min-h-[50px] w-full items-center justify-center rounded-[14px] bg-white/95 text-[16px] font-semibold text-black/80 backdrop-blur-xl active:bg-black/[0.05] disabled:opacity-60 dark:bg-[#252528]/95 dark:text-white/80 dark:active:bg-white/[0.06]"
        >
          取消
        </button>
      </div>
    </div>
  );
}
