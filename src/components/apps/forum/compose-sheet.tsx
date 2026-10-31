'use client';

/**
 * X论坛 · 发布弹层（X compose 全屏 sheet，按官方截图 1:1 精修）。
 * 顶行：返回箭头 + 「草稿」蓝字 + 「发布」胶囊（空文浅蓝、可发亮蓝）；
 * 正文区：头像 + 「有什么新鲜事？」；下方蓝字「所有人都可以回复」地球行；
 * 工具行：图片/GIF/投票/表情/定时/位置 蓝色图标（X 官方排布）+ 字数圆环；
 * 底行：灰色媒体方块（加图入口）+ 「发布到·版块」胶囊（点选弹底部 sheet）。
 */

import { useMemo, useState } from 'react';
import { BarChart3, CalendarClock, Globe, Image as ImageIcon, MapPin, Smile } from 'lucide-react';
import { COMMUNITY_DEFS } from '@/lib/forum/core';
import { XAvatar, XIcons, useXTheme } from './shared';
import { useForum } from './ctx';

const LIMIT = 280;
const EMOJIS = ['😄', '🎉', '🔥', '💙', '✨', '😂', '🥰', '👏', '🤔', '😭'];
const SW = 1.9;

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

  const communityName = useMemo(
    () => COMMUNITY_DEFS.find((c) => c.id === communityId)?.name ?? '今日热议',
    [communityId],
  );

  const left = LIMIT - text.length;
  const canPublish = text.trim().length > 0 && left >= 0;

  /** 工具行图标按钮（X 官方 compose 工具条：蓝色线条图标） */
  const toolBtn = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors active:bg-black/5 dark:active:bg-white/10"
      style={{ color: t.blue }}
    >
      {icon}
    </button>
  );

  return (
    <div className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label="发布帖子">
      <div className="flex h-full flex-col animate-[forum-sheet_.26s_ease-out]" style={{ background: t.bg, color: t.text }}>
        {/* 顶行：返回 | 草稿 | 发布胶囊（官方 Post 规格：空文浅蓝、可发亮蓝） */}
        <div className="flex shrink-0 items-center justify-between px-4 pt-[54px]" style={{ height: 100 }}>
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
            className="rounded-full px-5 h-[34px] text-[15px] font-bold text-white transition-opacity active:opacity-70"
            style={{
              background: canPublish ? t.blue : t.dark ? 'rgba(29,155,240,0.45)' : '#a9d4f5',
            }}
            aria-label="发布"
          >
            发布
          </button>
        </div>

        {/* 正文区：头像 + 大号输入 */}
        <div className="flex min-h-0 flex-1 gap-3 px-4 pt-3">
          <XAvatar authorKey="user" size={40} />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, LIMIT + 40))}
            placeholder="有什么新鲜事？"
            autoFocus
            className="min-h-0 flex-1 resize-none bg-transparent text-[20px] leading-[1.4] outline-none placeholder:text-[#9ca3af]"
            style={{ color: t.text, caretColor: t.blue }}
          />
        </div>

        {/* 回复权限行（官方 Earth · Everyone can reply，蓝色） */}
        <button
          type="button"
          onClick={() => f.toast('回复权限：所有人都可以回复')}
          className="flex shrink-0 items-center gap-2 px-4 py-2"
          style={{ color: t.blue }}
          aria-label="回复权限设置"
        >
          <Globe width={16} height={16} strokeWidth={SW} aria-hidden="true" />
          <span className="text-[13px] font-medium">所有人都可以回复</span>
        </button>

        {/* 工具行（官方：图片/GIF/投票/表情/定时/位置，蓝色）+ 字数圆环 */}
        <div
          className="forum-hide-scrollbar flex shrink-0 items-center gap-1 overflow-x-auto border-t px-3 py-1"
          style={{ borderColor: t.border }}
        >
          {toolBtn('添加图片', <ImageIcon width={21} height={21} strokeWidth={SW} />, () =>
            f.toast('图片上传内测中，敬请期待'),
          )}
          {toolBtn(
            'GIF',
            <span
              className="flex h-[15px] w-[26px] items-center justify-center rounded-[4px] border text-[10px] font-extrabold leading-none"
              style={{ borderColor: t.blue, color: t.blue }}
              aria-hidden="true"
            >
              GIF
            </span>,
            () => f.toast('GIF 搜索内测中，敬请期待'),
          )}
          {toolBtn('发起投票', <BarChart3 width={21} height={21} strokeWidth={SW} />, () =>
            f.toast('投票功能内测中，敬请期待'),
          )}
          {toolBtn('插入表情', <Smile width={21} height={21} strokeWidth={SW} />, () => {
            const e = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
            setText((s) => (s.length >= LIMIT ? s : s + e));
          })}
          {toolBtn('定时发布', <CalendarClock width={21} height={21} strokeWidth={SW} />, () =>
            f.toast('定时发布内测中，敬请期待'),
          )}
          {toolBtn('添加位置', <MapPin width={21} height={21} strokeWidth={SW} />, () =>
            f.toast('地理位置功能内测中，敬请期待'),
          )}
          <span className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center">
            <Ring left={left} />
          </span>
        </div>

        {/* 底行：灰色媒体方块 + 发布到·版块 */}
        <div className="flex shrink-0 items-center gap-3 border-t px-4 pb-[20px] pt-3" style={{ borderColor: t.border }}>
          <button
            type="button"
            aria-label="添加图片或视频"
            onClick={() => f.toast('图片上传内测中，敬请期待')}
            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[12px] transition-transform active:scale-95"
            style={{ background: t.dark ? '#202327' : '#eff3f4', color: t.secondary }}
          >
            <ImageIcon width={20} height={20} strokeWidth={SW} />
          </button>
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="flex h-[32px] items-center gap-1 rounded-full px-3 text-[14px] font-medium active:opacity-60"
            style={{ background: t.dark ? 'rgba(29,155,240,0.15)' : 'rgba(29,155,240,0.12)', color: t.blue }}
          >
            发布到 · {communityName}
          </button>
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
            className="forum-hide-scrollbar absolute inset-x-0 bottom-0 max-h-[70%] animate-[forum-sheet_.24s_ease-out] overflow-y-auto rounded-t-2xl pb-[24px]"
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
