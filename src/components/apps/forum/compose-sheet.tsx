'use client';

/**
 * X论坛 · 发布弹层（X compose 全屏 sheet，按官方截图精修）。
 * 顶行：返回箭头 + 「草稿」蓝字 + 发布浅蓝胶囊（空文置灰）；
 * 正文区：头像 + 「有什么新鲜事？」；下方「所有人都可以回复」地球行；
 * 底行：发布到·版块（点选弹底部 sheet）+ X 字数圆环（超限变红）。
 */

import { useMemo, useRef, useState } from 'react';
import { Globe } from 'lucide-react';
import { COMMUNITY_DEFS } from '@/lib/forum/core';
import { XAvatar, XIcons, useXTheme } from './shared';
import { useForum } from './ctx';

const LIMIT = 280;

/** X 字数圆环（剩余量；<20 转橙，<0 变红） */
function Ring({ left }: { left: number }) {
  const t = useXTheme();
  if (left >= LIMIT) return null;
  const r = 9;
  const c = 2 * Math.PI * r;
  const ratio = Math.max(0, Math.min(1, left / LIMIT));
  const stroke = left < 0 ? '#f4212e' : left <= 20 ? '#ffa500' : t.blue;
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r={r} fill="none" stroke={t.border} strokeWidth="2" />
      {left > 0 && (
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeDasharray={`${(c * ratio).toFixed(1)} ${c.toFixed(1)}`}
          transform="rotate(-90 12 12)"
          strokeLinecap="round"
        />
      )}
      {left <= 20 && (
        <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="700" fill={left < 0 ? '#f4212e' : stroke}>
          {left < 0 ? '' : left}
        </text>
      )}
    </svg>
  );
}

export function ComposeSheet({ onClose, onPublish }: { onClose: () => void; onPublish: (text: string, community: string | null) => void }) {
  const f = useForum();
  const t = f.t;
  const [text, setText] = useState('');
  const [communityId, setCommunityId] = useState<string>('hot');
  const [picking, setPicking] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const communityName = useMemo(
    () => COMMUNITY_DEFS.find((c) => c.id === communityId)?.name ?? '今日热议',
    [communityId],
  );

  const left = LIMIT - text.length;
  const canPublish = text.trim().length > 0 && left >= 0;

  return (
    <div className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label="发布帖子">
      <div className="flex h-full flex-col animate-[forum-sheet_.26s_ease-out]" style={{ background: t.bg, color: t.text }}>
        {/* 顶行：返回 | 草稿 | 发布胶囊（官方 Post 规格） */}
        <div className="flex shrink-0 items-center justify-between border-b px-4 pt-[54px]" style={{ borderColor: t.border, height: 100 }}>
          <button
            type="button"
            aria-label="关闭并返回"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
            style={{ color: t.text }}
          >
            {XIcons.back(22)}
          </button>
          <button
            type="button"
            onClick={() => f.toast(text.trim() ? '已存草稿，下次继续写' : '草稿箱是空的')}
            className="text-[15px] font-medium"
            style={{ color: t.blue }}
          >
            草稿
          </button>
          <button
            type="button"
            disabled={!canPublish}
            onClick={() => {
              onPublish(text.trim(), communityId);
              onClose();
            }}
            className="rounded-full px-5 h-[34px] text-[15px] font-bold text-white transition-opacity active:opacity-70 disabled:opacity-50"
            style={{ background: t.blue }}
            aria-label="发布"
          >
            发布
          </button>
        </div>

        {/* 正文区 */}
        <div className="flex min-h-0 flex-1 gap-3 px-4 pt-4">
          <XAvatar authorKey="user" size={40} />
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, LIMIT + 40))}
            placeholder="有什么新鲜事？"
            autoFocus
            className="min-h-0 flex-1 resize-none bg-transparent text-[20px] leading-[1.4] outline-none placeholder:text-[#9ca3af]"
            style={{ color: t.text, caretColor: t.blue }}
          />
        </div>

        {/* 回复权限行（官方 Earth · Everyone can reply） */}
        <button
          type="button"
          onClick={() => f.toast('回复权限：所有人都可以回复')}
          className="flex shrink-0 items-center gap-2 px-4 py-2"
          style={{ color: t.secondary }}
          aria-label="回复权限设置"
        >
          <Globe width={16} height={16} strokeWidth={1.9} aria-hidden="true" />
          <span className="text-[13px]">所有人都可以回复</span>
        </button>

        {/* 底行：版块 + 字数环 */}
        <div className="flex shrink-0 items-center justify-between border-t px-4 py-3" style={{ borderColor: t.border }}>
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="flex items-center gap-1 rounded-full px-3 h-[32px] text-[14px] font-medium active:opacity-60"
            style={{ background: t.dark ? 'rgba(29,155,240,0.15)' : 'rgba(29,155,240,0.12)', color: t.blue }}
          >
            发布到 · {communityName}
          </button>
          <Ring left={left} />
        </div>
      </div>

      {/* 版块选择 sheet */}
      {picking && (
        <div className="absolute inset-0 z-10" role="dialog" aria-label="选择版块">
          <button
            type="button"
            aria-label="关闭"
            className="absolute inset-0 animate-[forum-fade_.18s_ease-out]"
            style={{ background: 'rgba(0,0,0,0.4)' }}
            onClick={() => setPicking(false)}
          />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[70%] animate-[forum-sheet_.24s_ease-out] overflow-y-auto rounded-t-2xl pb-[24px]"
            style={{ background: t.bg, color: t.text }}
          >
            <p className="px-5 pb-2 pt-4 text-[17px] font-bold">发布到版块</p>
            {COMMUNITY_DEFS.map((c) => {
              const on = c.id === communityId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCommunityId(c.id);
                    setPicking(false);
                  }}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors active:opacity-60"
                  style={{ background: on ? t.hover : 'transparent' }}
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-[16px] font-bold text-white"
                    style={{ background: c.coverBg }}
                  >
                    {c.name.slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold">{c.name}</span>
                    <span className="block truncate text-[13px]" style={{ color: t.secondary }}>
                      {c.desc}
                    </span>
                  </div>
                  {on && (
                    <span className="text-[13px] font-bold" style={{ color: t.blue }}>
                      已选
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
