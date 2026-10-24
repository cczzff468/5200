'use client';

/**
 * 气泡内联表情文本（微信 / QQ / 群聊共用）：
 * - 把消息文本里的内置表情代码（[微笑] 等，见 lib/ios/emoji-codes.ts）还原成表情小图
 * - 统一尺寸：混排与纯表情消息都用内联 22px 小图、与文字同流
 *   （Task 25 用户要求：单独发送和带文字发送的大小要一样，去掉旧版纯表情 32px 放大）
 * - 代码名不在内置清单 → 原样文字（AI 输出的 [红包] 等富标记由 chat-rich 解析，不会进到这里）
 */

import { splitEmojiCodes, type EmojiCodeApp } from '@/lib/ios/emoji-codes';

export function InlineEmojiText({ app, text, className }: { app: EmojiCodeApp; text: string; className?: string }) {
  const parts = splitEmojiCodes(app, text);
  // 清单内一个代码都没命中 → 纯文本渲染（保持调用方原样式，零行为变化）
  if (!parts.some((p) => p.type === 'emoji')) return <>{text}</>;

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
