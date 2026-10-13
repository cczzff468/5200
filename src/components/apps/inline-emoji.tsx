'use client';

/**
 * 气泡内联表情文本（微信 / QQ / 群聊共用）：
 * - 把消息文本里的内置表情代码（[微笑] 等，见 lib/ios/emoji-codes.ts）还原成表情小图
 * - 混排（文字+表情）：表情内联 22px，与文字同流（对照真机：内联表情略高于文字一行）
 * - 纯表情消息（只有表情代码，可多个）：表情放大到 32px 居中流式排列（对照用户截图：惊讶大图占气泡）
 * - 代码名不在内置清单 → 原样文字（AI 输出的 [红包] 等富标记由 chat-rich 解析，不会进到这里）
 */

import { splitEmojiCodes, isPureEmojiCodes, type EmojiCodeApp } from '@/lib/ios/emoji-codes';

export function InlineEmojiText({ app, text, className }: { app: EmojiCodeApp; text: string; className?: string }) {
  const parts = splitEmojiCodes(app, text);
  // 清单内一个代码都没命中 → 纯文本渲染（保持调用方原样式，零行为变化）
  if (!parts.some((p) => p.type === 'emoji')) return <>{text}</>;
  const pure = isPureEmojiCodes(app, text);

  if (pure) {
    return (
      <span className={`inline-flex flex-wrap items-center gap-1.5 py-0.5 ${className ?? ''}`}>
        {parts
          .filter((p) => p.type === 'emoji')
          .map((p, i) => (
            <img
              key={`${p.name}-${i}`}
              src={p.url}
              alt={p.name}
              aria-label={p.name}
              className="h-[32px] w-[32px] select-none object-contain"
              draggable={false}
            />
          ))}
      </span>
    );
  }

  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.type === 'emoji' ? (
          <img
            key={`${p.name}-${i}`}
            src={p.url}
            alt={p.name}
            aria-label={p.name}
            className="mx-[1px] inline-block h-[22px] w-[22px] select-none align-[-5px] object-contain"
            draggable={false}
          />
        ) : (
          <span key={`t${i}`}>{p.text}</span>
        ),
      )}
    </span>
  );
}
