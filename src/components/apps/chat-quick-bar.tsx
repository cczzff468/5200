'use client';

/**
 * 输入框上方快捷功能条（聊天输入框自定义 › 输入框上方功能）
 * ---------------------------------------------------------------------------
 * 把「+」面板里的功能以小胶囊放到输入框上面（面板本身保持原样不动——用户指定
 * 「加号面板里面的功能不要动，把功能放到输入框上面」）；点一下与点加号面板里
 * 那一项完全等效（同一条 onAction/onClick）。
 * 微信/QQ 单聊与群聊四端共用；信息 App 不接入。
 * 液态玻璃主题（liquid）：每颗胶囊独立乳白玻璃（lg-chip）；默认主题：白底细描边。
 */
import type { ReactNode } from 'react';

export interface QuickBarItem {
  /** 功能 key（与加号面板一致，如 camera / rp） */
  key: string;
  /** 功能名（与加号面板同文案） */
  label: string;
  /** 小图标（任意尺寸 svg，条内统一缩到 13px） */
  icon: ReactNode;
  /** 点击行为（与加号面板点该项完全等效） */
  onClick: () => void;
}

export function ChatQuickBar({
  items,
  liquid,
  testPrefix,
}: {
  items: QuickBarItem[];
  /** 液态玻璃主题：玻璃胶囊 */
  liquid?: boolean;
  /** data-testid 前缀（wx / wxg / qq / qqg） */
  testPrefix: string;
}) {
  if (items.length === 0) return null;
  return (
    <div
      className="no-scrollbar flex items-center gap-1.5 overflow-x-auto"
      data-testid={`${testPrefix}-quick-bar`}
      role="toolbar"
      aria-label="输入框上方功能"
    >
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          data-testid={`${testPrefix}-quick-${it.key}`}
          onClick={it.onClick}
          className={`flex h-[26px] shrink-0 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-medium transition active:scale-95 [&_svg]:h-[13px] [&_svg]:w-[13px] ${
            liquid
              ? /* 液态玻璃：乳白玻璃小胶囊 */ 'lg-chip text-black/70 dark:text-white/75'
              : 'bg-white/90 text-black/60 shadow-[0_1px_4px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.06] dark:bg-white/[0.10] dark:text-white/70 dark:ring-white/[0.10]'
          }`}
        >
          {it.icon}
          <span className="whitespace-nowrap">{it.label}</span>
        </button>
      ))}
    </div>
  );
}
