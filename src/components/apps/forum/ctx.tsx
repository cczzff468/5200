'use client';

/** X论坛 · UI 上下文（主框架提供；各页面/卡片消费）。 */

import { createContext, useContext } from 'react';
import type { AuthorKey } from '@/lib/forum/core';
import type { XTheme } from './shared';

export type ViewSpec =
  | { kind: 'thread'; postId: string }
  | { kind: 'profile'; key: AuthorKey }
  | { kind: 'community'; id: string }
  | { kind: 'dm'; peerKey: AuthorKey };

export interface ForumUi {
  t: XTheme;
  push: (v: ViewSpec) => void;
  pop: () => void;
  openThread: (postId: string) => void;
  openProfile: (key: AuthorKey) => void;
  openCommunity: (id: string) => void;
  openDm: (peerKey: AuthorKey) => void;
  toast: (text: string) => void;
  likeToggle: (postId: string) => void;
  repostToggle: (postId: string) => void;
  /** 跳去某个主 tab（0..4 = 主页/搜索/社区/通知/私信） */
  gotoTab: (i: number) => void;
}

export const ForumCtx = createContext<ForumUi | null>(null);

export function useForum(): ForumUi {
  const v = useContext(ForumCtx);
  if (!v) throw new Error('ForumCtx missing');
  return v;
}
