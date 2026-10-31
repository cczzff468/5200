'use client';

/**
 * 思维链卡片（微信 / QQ / 信息三端对方消息气泡上方共用）：
 *
 * - AI 深度思考的思考过程展示（消息 thinking 字段，由 deep-think 流式剥离收集）；
 * - 默认折叠：显示「已深度思考 (点击展开)」+ 向下箭头；点击展开显示思考过程原文 + 向上箭头；
 * - 思考过程样式：字号 12px、灰色（#888）、半透明底（rgba(0,0,0,0.03)）、左侧竖线（border-left），
 *   暗色模式同款透明度适配（white 微透底 + 亮灰文字）；
 * - 卡片只挂在对方（AI）的消息上，紧凑小卡片（宽度自适应内容、限宽 ~260px，不撑满整行），
 *   宿主放在消息行上方且与头像左缘对齐（信息端无头像则左贴边）；
 * 开关关闭时由宿主门控（deep-think 的 useDeepThinkOn）直接不渲染本卡片（思考内容丢弃）。
 */
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export function ThinkCard({ text, testId = 'think-card' }: { text: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const body = text.trim();
  if (!body) return null;
  return (
    <div data-testid={testId} className="mb-[4px] w-fit max-w-[260px]">
      <button
        type="button"
        data-testid={`${testId}-toggle`}
        aria-expanded={open}
        aria-label={open ? '收起思考过程' : '展开思考过程'}
        onClick={() => setOpen((v) => !v)}
        className="flex w-fit max-w-full items-center gap-1 whitespace-nowrap rounded-[6px] bg-black/[0.03] px-2 py-[5px] text-left text-[12px] leading-[1.4] text-[#888] transition-colors active:bg-black/[0.06] dark:bg-white/[0.06] dark:text-white/55 dark:active:bg-white/[0.1]"
      >
        <span className="min-w-0 flex-1 select-none">{open ? '思考过程' : '已深度思考 (点击展开)'}</span>
        {open ? (
          <ChevronUp className="h-[13px] w-[13px] shrink-0" strokeWidth={2} aria-hidden="true" />
        ) : (
          <ChevronDown className="h-[13px] w-[13px] shrink-0" strokeWidth={2} aria-hidden="true" />
        )}
      </button>
      {open ? (
        <div
          data-testid={`${testId}-body`}
          className="mt-[4px] max-h-64 w-fit max-w-full overflow-y-auto whitespace-pre-wrap break-words rounded-[6px] border-l-2 border-black/15 bg-black/[0.03] px-2 py-[6px] text-[12px] leading-[1.55] text-[#888] dark:border-white/20 dark:bg-white/[0.06] dark:text-white/55"
        >
          {body}
        </div>
      ) : null}
    </div>
  );
}
