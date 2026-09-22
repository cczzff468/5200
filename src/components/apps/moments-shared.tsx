'use client';

/**
 * 朋友圈 / QQ动态 共享 UI 组件（微信/QQ 两个 App 共用）：
 * - AskPostSheet「让TA发一条」：列出平台好友（CHAR/NPC），点行即让 TA 立即发一条动态（一.2）；
 *   行尾小齿轮进入该好友的自动发布设置（一.3/一.6）；
 * - MomentAutoCfgSheet：每角色×平台自动发动态设置——三种触发（定时 / 频率 / 聊天灵感，一.6）；
 * - EditPostDialog：编辑动态正文（六.4：用户可以编辑动态）。
 *
 * 样式约定：跟随宿主页面（absolute inset-0 的全屏页）内渲染，overlay z-50；
 * 深浅色都适配（与微信/QQ 页面同一套 dark: 前缀）。
 */

import { useState, type ReactNode } from 'react';
import { CalendarClock, ChevronRight, Clock3, Loader2, MessageSquareQuote, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import { displayNameOf, type ContactRecord } from '@/lib/contacts';
import { DefaultAvatar } from './default-avatar';
import {
  MOMENT_INTERVAL_OPTIONS,
  getMomentAutoCfg,
  saveMomentAutoCfg,
  type MomentAutoCfg,
  type MomentPlatform,
} from '@/lib/moments';

/** 平台好友（CHAR/NPC 且已添加为该平台好友） */
export function momentFriendsOf(contacts: ContactRecord[], platform: MomentPlatform): ContactRecord[] {
  return contacts.filter((c) => {
    if (c.kind !== 'char' && c.kind !== 'npc') return false;
    const v = platform === 'wx' ? c.friendWx : c.friendQq;
    return typeof v === 'boolean' ? v : !!c.isFriend;
  });
}

// ---------------- 「让TA发一条」好友选择弹层 ----------------

export function AskPostSheet({
  title,
  friends,
  busyId,
  onClose,
  onAsk,
  onOpenCfg,
  renderAvatar,
}: {
  title: string;
  friends: ContactRecord[];
  /** 正在生成中的联系人 id（行内转圈） */
  busyId: string | null;
  onClose: () => void;
  onAsk: (c: ContactRecord) => void;
  /** 传入 = 行尾显示设置齿轮 */
  onOpenCfg?: (c: ContactRecord) => void;
  /** 宿主 App 的头像组件（微信/QQ 各自的圆角风格） */
  renderAvatar?: (c: ContactRecord, size: number) => ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" role="dialog" aria-label={title} onClick={onClose}>
      <div
        className="max-h-[70%] overflow-y-auto rounded-t-[16px] bg-white pb-6 dark:bg-[#1C1C1E]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between bg-white/95 px-4 py-3 backdrop-blur dark:bg-[#1C1C1E]/95">
          <span className="flex items-center gap-1.5 text-[15px] font-medium">
            <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            {title}
          </span>
          <button type="button" aria-label="关闭" onClick={onClose} className="rounded-full p-1 active:bg-black/5 dark:active:bg-white/10">
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
        {friends.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-black/35 dark:text-white/35">还没有好友，先去添加一个吧</p>
        ) : (
          friends.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 active:bg-black/[0.04] dark:active:bg-white/[0.06]">
              <button
                type="button"
                data-testid={`moments-ask-${c.id}`}
                onClick={() => onAsk(c)}
                disabled={busyId === c.id}
                className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-60"
              >
                {renderAvatar ? renderAvatar(c, 40) : <DefaultAvatar size={40} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{displayNameOf(c)}</span>
                  <span className="block text-[12px] text-black/35 dark:text-white/35">
                    {busyId === c.id ? '正在想发什么…' : '让 TA 现在发一条动态'}
                  </span>
                </span>
                {busyId === c.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-black/40 dark:text-white/40" aria-hidden="true" />}
              </button>
              {onOpenCfg && (
                <button
                  type="button"
                  aria-label={`${displayNameOf(c)}的自动发布设置`}
                  data-testid={`moments-cfg-${c.id}`}
                  onClick={() => onOpenCfg(c)}
                  className="shrink-0 rounded-full p-1.5 text-black/40 active:bg-black/5 dark:text-white/40 dark:active:bg-white/10"
                >
                  <Settings2 className="h-[18px] w-[18px]" strokeWidth={1.9} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------- 自动发布设置弹层（每角色 × 每平台） ----------------

const TRIGGERS: { key: MomentAutoCfg['trigger']; label: string; desc: string; icon: ReactNode }[] = [
  { key: 'schedule', label: '定时发布', desc: '每天到点自动发一条', icon: <Clock3 className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" /> },
  { key: 'interval', label: '按频率发布', desc: '每隔一段时间自动发一条', icon: <CalendarClock className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" /> },
  { key: 'chat', label: '聊天后有感而发', desc: '根据最近聊天和记忆，想发的时候就发', icon: <MessageSquareQuote className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" /> },
];

export function MomentAutoCfgSheet({
  contact,
  platform,
  platformLabel,
  onClose,
  onToast,
}: {
  contact: ContactRecord;
  platform: MomentPlatform;
  platformLabel: string;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [cfg, setCfg] = useState<MomentAutoCfg>(() => getMomentAutoCfg(contact.id, platform));

  const patch = (p: Partial<MomentAutoCfg>) => {
    const next = saveMomentAutoCfg(contact.id, platform, p);
    setCfg({ ...next });
    onToast('已保存');
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" role="dialog" aria-label="自动发动态设置" onClick={onClose}>
      <div className="max-h-[80%] overflow-y-auto rounded-t-[16px] bg-white pb-8 dark:bg-[#1C1C1E]" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between bg-white/95 px-4 py-3 backdrop-blur dark:bg-[#1C1C1E]/95">
          <span className="truncate text-[15px] font-medium">{displayNameOf(contact)} · 自动发{platformLabel}</span>
          <button type="button" aria-label="关闭" onClick={onClose} className="rounded-full p-1 active:bg-black/5 dark:active:bg-white/10">
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>

        {/* 总开关 */}
        <div className="flex items-center justify-between px-4 py-3.5">
          <span className="text-[15px]">自动发动态</span>
          <button
            type="button"
            role="switch"
            aria-checked={cfg.enabled}
            data-testid="moments-cfg-enabled"
            onClick={() => patch({ enabled: !cfg.enabled })}
            className={`relative h-[26px] w-[46px] rounded-full transition-colors ${cfg.enabled ? 'bg-[#07C160]' : 'bg-black/15 dark:bg-white/20'}`}
          >
            <span className={`absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow transition-all ${cfg.enabled ? 'left-[22px]' : 'left-[2px]'}`} />
          </button>
        </div>

        {/* 触发方式（三选一，一.6） */}
        <div className={`px-4 pt-1 pb-2 text-[12.5px] text-black/35 dark:text-white/35 ${cfg.enabled ? '' : 'opacity-40'}`}>触发方式</div>
        <div className={cfg.enabled ? '' : 'pointer-events-none opacity-40'}>
          {TRIGGERS.map((t) => (
            <button
              key={t.key}
              type="button"
              data-testid={`moments-cfg-trigger-${t.key}`}
              onClick={() => patch({ trigger: t.key })}
              className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              <span className="mt-0.5 text-black/50 dark:text-white/50">{t.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px]">{t.label}</span>
                <span className="block text-[12px] text-black/35 dark:text-white/35">{t.desc}</span>
              </span>
              <span
                className={`mt-1 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border ${
                  cfg.trigger === t.key ? 'border-[#07C160]' : 'border-black/20 dark:border-white/30'
                }`}
              >
                {cfg.trigger === t.key && <span className="h-[10px] w-[10px] rounded-full bg-[#07C160]" />}
              </span>
            </button>
          ))}

          {/* 子配置 */}
          {cfg.trigger === 'schedule' && (
            <div className="flex items-center gap-2 px-4 py-3">
              <span className="text-[14px] text-black/60 dark:text-white/60">每天</span>
              <input
                type="time"
                aria-label="每天发布时间"
                data-testid="moments-cfg-time"
                value={`${String(cfg.hh).padStart(2, '0')}:${String(cfg.mm).padStart(2, '0')}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(':').map((x) => Number(x));
                  if (Number.isFinite(h) && Number.isFinite(m)) patch({ hh: h, mm: m });
                }}
                className="rounded-[8px] border border-black/10 bg-white px-2 py-1.5 text-[14px] outline-none dark:border-white/15 dark:bg-[#2A2A2C]"
              />
              <span className="text-[14px] text-black/60 dark:text-white/60">自动发一条（错过时间会在下次打开时补发）</span>
            </div>
          )}
          {cfg.trigger === 'interval' && (
            <div className="flex items-center gap-2 px-4 py-3">
              <span className="text-[14px] text-black/60 dark:text-white/60">每隔</span>
              <select
                aria-label="发布间隔"
                data-testid="moments-cfg-interval"
                value={cfg.intervalHours}
                onChange={(e) => patch({ intervalHours: Number(e.target.value) })}
                className="rounded-[8px] border border-black/10 bg-white px-2 py-1.5 text-[14px] outline-none dark:border-white/15 dark:bg-[#2A2A2C]"
              >
                {MOMENT_INTERVAL_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    {h < 24 ? `${h} 小时` : `${h / 24} 天`}
                  </option>
                ))}
              </select>
              <span className="text-[14px] text-black/60 dark:text-white/60">自动发一条</span>
            </div>
          )}
          {cfg.trigger === 'chat' && (
            <p className="px-4 py-2 text-[12.5px] leading-relaxed text-black/40 dark:text-white/40">
              开启后，TA 会根据你们最近的聊天和 TA 的记忆库，随时心血来潮发一条「有感而发」的动态——不攒轮次、不设时间表，什么时候想发就发。
            </p>
          )}
          <p className="px-4 pt-1 text-[12.5px] leading-relaxed text-black/40 dark:text-white/40">
            动态内容由 AI 根据「{displayNameOf(contact)}」的人设、你们的最近聊天和 TA 的记忆生成，不同角色风格不同。
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------- 编辑动态对话框 ----------------

export function EditPostDialog({
  initial,
  busy,
  onCancel,
  onSave,
}: {
  initial: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (content: string) => void;
}) {
  // initial 变化 = 父级换了一条动态编辑：调用方用 key={postId} 重挂载本组件，无需 effect 同步
  const [text, setText] = useState(initial);
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/40 p-6" role="dialog" aria-label="编辑动态" onClick={busy ? undefined : onCancel}>
      <div className="w-full rounded-[14px] bg-white p-4 dark:bg-[#1C1C1E]" onClick={(e) => e.stopPropagation()}>
        <p className="text-[15px] font-medium">编辑动态</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          autoFocus
          data-testid="moments-edit-input"
          aria-label="动态内容"
          className="mt-3 w-full resize-none rounded-[10px] bg-black/[0.04] p-3 text-[14.5px] leading-relaxed outline-none placeholder:text-black/30 focus:bg-black/[0.06] dark:bg-white/[0.07] dark:placeholder:text-white/30 dark:focus:bg-white/[0.1]"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-[8px] px-3.5 py-1.5 text-[14px] text-black/60 active:bg-black/5 disabled:opacity-50 dark:text-white/60 dark:active:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="moments-edit-save"
            onClick={() => onSave(text)}
            disabled={busy || !text.trim()}
            className="rounded-[8px] bg-[#07C160] px-3.5 py-1.5 text-[14px] font-medium text-white disabled:opacity-40 active:opacity-80"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 删除评论确认弹层（长按评论触发；微信/QQ 共用） ----------------

export function CommentDeleteDialog({
  author,
  onCancel,
  onDelete,
}: {
  /** 被删评论的作者名（提示文案用） */
  author: string;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/40 p-6" role="dialog" aria-label="删除评论" onClick={onCancel}>
      <div className="w-full rounded-[14px] bg-white p-4 dark:bg-[#1C1C1E]" onClick={(e) => e.stopPropagation()}>
        <p className="text-[15px] font-medium">删除评论</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-black/55 dark:text-white/55">
          确定删除「{author}」的这条评论吗？它下面的回复也会一并删除。
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            data-testid="moments-comment-del-cancel"
            onClick={onCancel}
            className="rounded-[8px] px-3.5 py-1.5 text-[14px] text-black/60 active:bg-black/5 dark:text-white/60 dark:active:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="moments-comment-del-confirm"
            onClick={onDelete}
            className="rounded-[8px] bg-[#FA5151] px-3.5 py-1.5 text-[14px] font-medium text-white active:opacity-80"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 单条动态「…」菜单（QQ 空间用；编辑/删除） ----------------

export function PostMoreMenu({
  onEdit,
  onDelete,
  onClose,
}: {
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" role="dialog" aria-label="动态操作" onClick={onClose}>
      <div className="pb-6" onClick={(e) => e.stopPropagation()}>
        <div className="mx-3 overflow-hidden rounded-[12px] bg-white dark:bg-[#1C1C1E]">
          <button type="button" data-testid="moments-post-edit" onClick={onEdit} className="flex h-[48px] w-full items-center gap-2.5 border-b border-black/[0.06] px-4 text-left text-[15px] active:bg-black/[0.04] dark:border-white/10 dark:active:bg-white/[0.06]">
            <Settings2 className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
            编辑动态
          </button>
          <button type="button" data-testid="moments-post-delete" onClick={onDelete} className="flex h-[48px] w-full items-center gap-2.5 px-4 text-left text-[15px] text-[#FA5151] active:bg-black/[0.04] dark:text-[#FF9A97] dark:active:bg-white/[0.06]">
            <Trash2 className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
            删除动态
          </button>
        </div>
        <button type="button" onClick={onClose} className="mx-3 mt-2 flex h-[46px] w-[calc(100%-24px)] items-center justify-center rounded-[12px] bg-white text-[15px] font-medium active:bg-black/[0.04] dark:bg-[#1C1C1E] dark:active:bg-white/[0.06]">
          取消
        </button>
      </div>
    </div>
  );
}

/** 简单头像（无宿主头像组件时的兜底） */
export { ChevronRight };
