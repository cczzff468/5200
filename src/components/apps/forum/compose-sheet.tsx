'use client';

/**
 * X论坛 · 发布弹层（X compose 全屏 sheet，按官方截图 1:1 精修 + 全功能开发）。
 *
 * 布局（对照官方参考图）：
 * - 顶行：返回箭头 | 「草稿」蓝字（居中）| 「发布」胶囊（空文浅蓝 #a9d4f5、可发亮蓝）；
 * - 正文区：40px 头像 + 「有什么新鲜事？」20px 大输入；
 * - 媒体预览：2 列网格 + 右上删除角标（相册/GIF，最多 4 张）；
 * - 投票编辑卡：选项 2~4 条，可增删（工具栏投票开关）；
 * - 隐私行：🌍「所有人都可以回复」蓝字 + 右侧「发布到·版块」胶囊；
 * - 工具行（细分隔线上方）：图片 / GIF / 投票 / 表情 / 定时 / 位置 / 旗子(话题)
 *   全部真功能 + 字数圆环；
 * - 底行：左下灰色圆角「全屏」方块（写作模式）+ 定时/位置状态。
 *
 * 数据出参 ComposePayload：media / poll / location / visibleAt（定时帖）。
 */

import { useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  CalendarClock,
  Flag,
  Globe,
  Image as ImageIcon,
  MapPin,
  Maximize2,
  Minimize2,
  Smile,
  X,
} from 'lucide-react';
import { COMMUNITY_DEFS, trendingTopics, forumData } from '@/lib/forum/core';
import { XAvatar, XIcons, useXTheme } from './shared';
import { useForum } from './ctx';

const LIMIT = 280;
const SW = 1.9;
const MAX_MEDIA = 4;

/** 发布扩展内容（forum.tsx publish 回调的第三参） */
export interface ComposePayload {
  media?: string[];
  poll?: { options: string[] };
  location?: string;
  visibleAt?: number;
}

/** emoji 面板内容（常用社交表情，8 列滚区） */
const EMOJI_SET = [
  '😄', '😂', '🥰', '😭', '🤔', '👏', '🙌', '🙏',
  '🔥', '✨', '💙', '❤️', '🎉', '🎊', '💯', '🤝',
  '😅', '😊', '😉', '😴', '🥱', '🤗', '😎', '🫡',
  '🐶', '🐱', '🍜', '🍰', '☕', '🍵', '🍺', '🌈',
];

/** 定时快捷项（相对当前时间计算；X 官方定时发布风格） */
function schedulePresets(): { label: string; at: number }[] {
  const now = new Date();
  const in1h = new Date(now.getTime() + 60 * 60 * 1000);
  const tonight = new Date(now);
  tonight.setHours(20, 0, 0, 0);
  if (tonight.getTime() <= now.getTime()) tonight.setDate(tonight.getDate() + 1);
  const tomorrow9 = new Date(now);
  tomorrow9.setDate(tomorrow9.getDate() + 1);
  tomorrow9.setHours(9, 0, 0, 0);
  return [
    { label: '1 小时后', at: in1h.getTime() },
    { label: '今晚 20:00', at: tonight.getTime() },
    { label: '明天上午 9:00', at: tomorrow9.getTime() },
  ];
}

const fmtSchedule = (at: number) =>
  new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 相册文件 → 压缩 dataURL（长边 1080 / JPEG 0.72；GIF 原样保留动画） */
function fileToPostMedia(file: File): Promise<string> {
  if (file.type === 'image/gif') {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('读取失败'));
      r.readAsDataURL(file);
    });
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const long = 1080;
        const scale = Math.min(1, long / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 不可用');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err instanceof Error ? err : new Error('图片处理失败'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    img.src = url;
  });
}

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

export function ComposeSheet({
  onClose,
  onPublish,
}: {
  onClose: () => void;
  onPublish: (text: string, community: string | null, extras?: ComposePayload) => void;
}) {
  const f = useForum();
  const t = f.t;
  const [text, setText] = useState('');
  const [communityId, setCommunityId] = useState<string>('hot');
  const [media, setMedia] = useState<string[]>([]);
  const [pollOptions, setPollOptions] = useState<string[] | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [visibleAt, setVisibleAt] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sheet, setSheet] = useState<null | 'emoji' | 'schedule' | 'geo' | 'gif' | 'topic'>(null);
  const [gifQuery, setGifQuery] = useState('');
  const [gifResults, setGifResults] = useState<{ url: string; source?: string }[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [geoInput, setGeoInput] = useState('');
  const [customSchedule, setCustomSchedule] = useState('');

  const textRef = useRef<HTMLTextAreaElement | null>(null);

  const communityLabel = useMemo(
    () => COMMUNITY_DEFS.find((c) => c.id === communityId)?.name ?? '今日热议',
    [communityId],
  );

  const left = LIMIT - text.length;
  const validPoll =
    pollOptions !== null && pollOptions.filter((o) => o.trim()).length >= 2 && pollOptions.length <= 4;
  const canPublish = (text.trim().length > 0 || media.length > 0) && left >= 0 && (!pollOptions || validPoll);

  /** 工具行图标按钮（X 官方 compose 工具条：蓝色线条图标） */
  const toolBtn = (label: string, active: boolean, icon: React.ReactNode, onClick: () => void) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors active:bg-black/5 dark:active:bg-white/10"
      style={{ color: active ? '#fff' : t.blue, background: active ? t.blue : 'transparent' }}
    >
      {icon}
    </button>
  );

  /** 追加媒体（超上限给 toast） */
  const addMedia = (items: string[]) => {
    setMedia((cur) => {
      const next = [...cur, ...items].slice(0, MAX_MEDIA);
      if (cur.length + items.length > MAX_MEDIA) f.toast(`最多 ${MAX_MEDIA} 张图片`);
      return next;
    });
  };

  /** 相册选择 */
  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const jobs = Array.from(files)
      .slice(0, MAX_MEDIA)
      .map((file) =>
        fileToPostMedia(file)
          .then((url) => url)
          .catch(() => {
            f.toast('有图片处理失败，换一张试试');
            return null as string | null;
          }),
      );
    void Promise.all(jobs).then((urls) => {
      const ok = urls.filter((u): u is string => Boolean(u));
      if (ok.length) {
        addMedia(ok);
        f.toast('图片已添加');
      }
    });
  };

  /** GIF 搜索（服务端 /api/forum/gif → z-ai images.search） */
  const searchGif = (q: string) => {
    const query = q.trim();
    if (!query) return;
    setGifLoading(true);
    setGifResults([]);
    fetch('/api/forum/gif', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
      .then((r) => r.json())
      .then((data: { success?: boolean; results?: { url: string; source?: string }[] }) => {
        if (data.success && data.results?.length) {
          setGifResults(data.results.slice(0, 12));
        } else {
          f.toast('没搜到相关动图，换个词试试');
        }
      })
      .catch(() => f.toast('GIF 搜索失败，稍后再试'))
      .finally(() => setGifLoading(false));
  };

  /** 插入表情 */
  const insertEmoji = (e: string) => {
    setText((s) => (s.length + e.length > LIMIT ? s : s + e));
  };

  /** 话题（旗子）：文末追加 #话题# */
  const appendTopic = (tag: string) => {
    setText((s) => {
      const piece = `#${tag}#`;
      if (s.includes(piece)) return s;
      const next = (s ? (s.endsWith(' ') || s.endsWith('\n') ? s : `${s} `) : '') + piece;
      return next.length > LIMIT + 40 ? s : next;
    });
    setSheet(null);
    f.toast('已插入话题标签');
  };

  const publish = () => {
    if (!canPublish) {
      if (pollOptions && !validPoll) f.toast('投票至少需要 2 个非空选项');
      return;
    }
    onPublish(text.trim(), communityId, {
      media: media.length ? media : undefined,
      poll: pollOptions && validPoll ? { options: pollOptions.filter((o) => o.trim()) } : undefined,
      location: location ?? undefined,
      visibleAt: visibleAt && visibleAt > Date.now() ? visibleAt : undefined,
    });
    onClose();
  };

  return (
    <div className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label="发布帖子">
      <div className="flex h-full flex-col animate-[forum-sheet_.26s_ease-out]" style={{ background: t.bg, color: t.text }}>
        {/* 顶行：返回 | 草稿（全屏模式换「有什么新鲜事？」）| 发布胶囊（空文浅蓝、可发亮蓝） */}
        <div className="flex shrink-0 items-center justify-between px-4 pt-[54px]" style={{ height: 100 }}>
          {full ? (
            <>
              <span className="text-[17px] font-bold">有什么新鲜事？</span>
              <button
                type="button"
                onClick={() => setFull(false)}
                className="flex h-[32px] items-center rounded-full px-5 text-[14px] font-bold text-white active:opacity-70"
                style={{ background: t.blue }}
              >
                完成
              </button>
            </>
          ) : (
            <>
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
                onClick={() => f.toast(text.trim() || media.length ? '已存草稿，下次继续写' : '草稿箱是空的')}
                className="text-[15px] font-medium"
                style={{ color: t.blue }}
              >
                草稿
              </button>
              <button
                type="button"
                disabled={!canPublish}
                onClick={publish}
                className="rounded-full px-5 h-[34px] text-[15px] font-bold text-white transition-opacity active:opacity-70 disabled:active:opacity-100"
                style={{
                  background: canPublish ? t.blue : t.dark ? 'rgba(29,155,240,0.45)' : '#a9d4f5',
                }}
                aria-label="发布"
              >
                发布
              </button>
            </>
          )}
        </div>

        {/* 正文区：头像 + 大号输入（全屏模式加大书写区） */}
        <div className={`flex gap-3 px-4 pt-3 ${full ? 'min-h-0 flex-1' : ''}`}>
          <XAvatar authorKey="user" size={40} />
          <div className="flex min-h-0 flex-1 flex-col">
            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, LIMIT + 40))}
              placeholder="有什么新鲜事？"
              autoFocus={!full}
              className={`w-full flex-1 resize-none bg-transparent text-[20px] leading-[1.4] outline-none placeholder:text-[#9ca3af] ${full ? 'min-h-[45vh]' : 'min-h-[120px]'}`}
              style={{ color: t.text, caretColor: t.blue }}
              aria-label="帖子正文"
            />
          </div>
        </div>

        {/* 媒体预览（2 列网格 + 删除角标；全屏模式收起） */}
        {!full && media.length > 0 && (
          <div className="grid shrink-0 grid-cols-2 gap-2 px-4 pt-2">
            {media.map((m, i) => (
              <div key={i} className="relative aspect-square overflow-hidden rounded-xl border" style={{ borderColor: 'rgba(137,151,166,0.35)' }}>
                <img src={m} alt={`附图 ${i + 1}`} className="h-full w-full object-cover" draggable={false} />
                <button
                  type="button"
                  aria-label={`移除附图 ${i + 1}`}
                  onClick={() => setMedia((cur) => cur.filter((_, j) => j !== i))}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white active:opacity-70"
                >
                  <X width={13} height={13} strokeWidth={3} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 投票编辑卡（开关激活时；全屏模式收起） */}
        {!full && pollOptions !== null && (
          <div className="mx-4 mt-2 shrink-0 rounded-2xl border p-3" style={{ borderColor: t.border }}>
            <div className="flex items-center justify-between">
              <p className="text-[14px] font-bold">发起投票</p>
              <button
                type="button"
                onClick={() => setPollOptions(null)}
                className="text-[13px] font-medium active:opacity-60"
                style={{ color: t.secondary }}
              >
                移除投票
              </button>
            </div>
            <div className="mt-1 flex flex-col gap-2">
              {pollOptions.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={opt}
                    onChange={(e) => setPollOptions((cur) => (cur ?? []).map((o, j) => (j === i ? e.target.value.slice(0, 25) : o)))}
                    placeholder={`选项 ${i + 1}`}
                    maxLength={25}
                    className="min-w-0 flex-1 rounded-full px-3 py-[7px] text-[15px] outline-none"
                    style={{ background: t.dark ? '#202327' : '#eff3f4', color: t.text, caretColor: t.blue }}
                    aria-label={`投票选项 ${i + 1}`}
                  />
                  {pollOptions.length > 2 && (
                    <button
                      type="button"
                      aria-label={`删除选项 ${i + 1}`}
                      onClick={() => setPollOptions((cur) => (cur ?? []).filter((_, j) => j !== i))}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
                      style={{ color: t.secondary }}
                    >
                      <X width={15} height={15} strokeWidth={2.4} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between">
              {pollOptions.length < 4 ? (
                <button
                  type="button"
                  onClick={() => setPollOptions((cur) => [...(cur ?? []), ''])}
                  className="text-[14px] font-bold active:opacity-60"
                  style={{ color: t.blue }}
                >
                  + 添加选项（{pollOptions.length}/4）
                </button>
              ) : (
                <span className="text-[13px]" style={{ color: t.secondary }}>
                  最多 4 个选项
                </span>
              )}
              <span className="text-[12px]" style={{ color: t.secondary }}>
                至少 2 个非空选项
              </span>
            </div>
          </div>
        )}

        {/* 隐私行（官方 Earth · Everyone can reply 蓝字）+ 右侧版块胶囊 */}
        {!full && (
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
            <button
              type="button"
              onClick={() => f.toast('回复权限：所有人都可以回复')}
              className="flex items-center gap-2"
              style={{ color: t.blue }}
              aria-label="回复权限设置"
            >
              <Globe width={16} height={16} strokeWidth={SW} aria-hidden="true" />
              <span className="text-[13px] font-medium">所有人都可以回复</span>
            </button>
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="flex h-[30px] shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-bold active:opacity-60"
              style={{ background: t.dark ? 'rgba(29,155,240,0.15)' : 'rgba(29,155,240,0.12)', color: t.blue }}
            >
              <MapPin width={13} height={13} strokeWidth={2.2} aria-hidden="true" />
              {communityLabel}
            </button>
          </div>
        )}

        {/* 工具行（官方 7 图标：图片/GIF/投票/表情/定时/位置/旗子）+ 字数圆环 */}
        <div
          className="forum-hide-scrollbar flex shrink-0 items-center gap-1 overflow-x-auto border-t px-3 py-1"
          style={{ borderColor: t.border }}
        >
          {/* 添加图片：label 原生触发文件选择（无需 JS 访问 ref，规避 react-hooks/refs） */}
          <label
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors active:bg-black/5 dark:active:bg-white/10"
            style={{ color: t.blue }}
            aria-label="添加图片"
          >
            <ImageIcon width={21} height={21} strokeWidth={SW} aria-hidden="true" />
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                onFiles(e.target.files);
                e.currentTarget.value = '';
              }}
            />
          </label>
          {toolBtn(
            'GIF',
            false,
            <span
              className="flex h-[15px] w-[26px] items-center justify-center rounded-[4px] border text-[10px] font-extrabold leading-none"
              style={{ borderColor: t.blue, color: t.blue }}
              aria-hidden="true"
            >
              GIF
            </span>,
            () => {
              setSheet('gif');
              setGifResults([]);
              setGifQuery('');
            },
          )}
          {toolBtn('发起投票', pollOptions !== null, <BarChart3 width={21} height={21} strokeWidth={SW} />, () => {
            if (pollOptions === null) setPollOptions(['', '']);
            else setPollOptions(null);
          })}
          {toolBtn('插入表情', sheet === 'emoji', <Smile width={21} height={21} strokeWidth={SW} />, () =>
            setSheet(sheet === 'emoji' ? null : 'emoji'),
          )}
          {toolBtn('定时发布', visibleAt !== null, <CalendarClock width={21} height={21} strokeWidth={SW} />, () => {
            setSheet(sheet === 'schedule' ? null : 'schedule');
          })}
          {toolBtn('添加位置', location !== null, <MapPin width={21} height={21} strokeWidth={SW} />, () => {
            setSheet(sheet === 'geo' ? null : 'geo');
            setGeoInput('');
          })}
          {toolBtn('插入话题', false, <Flag width={21} height={21} strokeWidth={SW} />, () => setSheet('topic'))}
          <span className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center">
            <Ring left={left} />
          </span>
        </div>

        {/* 底行：左下全屏写作方块（官方参考图）+ 定时/位置状态胶囊 */}
        {!full && (
          <div className="flex shrink-0 items-center gap-3 border-t px-4 pb-[20px] pt-2" style={{ borderColor: t.border }}>
            <button
              type="button"
              aria-label="全屏书写模式"
              onClick={() => setFull(true)}
              className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[12px] transition-transform active:scale-95"
              style={{ background: t.dark ? '#202327' : '#eff3f4', color: t.text }}
            >
              <Maximize2 width={19} height={19} strokeWidth={2} aria-hidden="true" />
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto forum-hide-scrollbar">
              {visibleAt !== null && (
                <button
                  type="button"
                  onClick={() => setSheet('schedule')}
                  className="flex h-[28px] shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold active:opacity-60"
                  style={{ background: 'rgba(0,186,124,0.14)', color: t.green }}
                >
                  ⏱ {fmtSchedule(visibleAt)} · 点击修改
                </button>
              )}
              {location !== null && (
                <button
                  type="button"
                  onClick={() => setSheet('geo')}
                  className="flex h-[28px] shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold active:opacity-60"
                  style={{ background: 'rgba(29,155,240,0.14)', color: t.blue }}
                >
                  📍 {location} · 点击修改
                </button>
              )}
              <span className="ml-auto text-[12px]" style={{ color: t.secondary }}>
                {media.length > 0 && `${media.length}/${MAX_MEDIA} 图`}
              </span>
            </div>
          </div>
        )}

        {/* 全屏模式的收起按钮（右下角悬浮） */}
        {full && (
          <div className="flex shrink-0 items-center justify-end px-4 pb-[24px]">
            <button
              type="button"
              aria-label="退出全屏"
              onClick={() => setFull(false)}
              className="flex h-[40px] w-[40px] items-center justify-center rounded-[12px] transition-transform active:scale-95"
              style={{ background: t.dark ? '#202327' : '#eff3f4', color: t.text }}
            >
              <Minimize2 width={19} height={19} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}
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

      {/* emoji / 定时 / 位置 / GIF / 话题 底部弹层（互斥，一次一个） */}
      {sheet && (
        <div className="absolute inset-0 z-10" role="dialog" aria-label="工具面板">
          <button
            type="button"
            aria-label="关闭"
            className="absolute inset-0 animate-[forum-fade_.18s_ease-out]"
            style={{ background: 'rgba(0,0,0,0.4)' }}
            onClick={() => setSheet(null)}
          />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[66%] animate-[forum-sheet_.24s_ease-out] overflow-y-auto rounded-t-2xl pb-[24px]"
            style={{ background: t.bg, color: t.text }}
          >
            {/* --- emoji 面板 --- */}
            {sheet === 'emoji' && (
              <div className="px-4 pt-3">
                <p className="pb-2 text-[15px] font-bold">插入表情</p>
                <div className="grid grid-cols-8 gap-1 pb-2">
                  {EMOJI_SET.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => insertEmoji(e)}
                      className="flex h-11 w-11 items-center justify-center rounded-xl text-[26px] transition-transform active:scale-90"
                      aria-label={`插入表情 ${e}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* --- 定时发布 --- */}
            {sheet === 'schedule' && (
              <div className="px-4 pt-3">
                <p className="pb-1 text-[15px] font-bold">定时发布</p>
                <p className="pb-2 text-[12px]" style={{ color: t.secondary }}>
                  到点后帖子自动出现在你的主页与时间线
                </p>
                {schedulePresets().map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      setVisibleAt(p.at);
                      setSheet(null);
                      f.toast(`已定时 ${fmtSchedule(p.at)} 发布`);
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left transition-colors active:opacity-60"
                    style={{ background: t.hover }}
                  >
                    <span className="text-[15px] font-bold">{p.label}</span>
                    <span className="text-[13px]" style={{ color: t.secondary }}>
                      {fmtSchedule(p.at)}
                    </span>
                  </button>
                ))}
                <div className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: t.hover }}>
                  <input
                    type="datetime-local"
                    value={customSchedule}
                    onChange={(e) => setCustomSchedule(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
                    style={{ color: t.text, caretColor: t.blue }}
                    aria-label="自定义定时时间"
                  />
                  <button
                    type="button"
                    disabled={!customSchedule}
                    onClick={() => {
                      const at = new Date(customSchedule).getTime();
                      if (!Number.isFinite(at) || at <= Date.now()) {
                        f.toast('时间要选在将来');
                        return;
                      }
                      setVisibleAt(at);
                      setSheet(null);
                      f.toast(`已定时 ${fmtSchedule(at)} 发布`);
                    }}
                    className="rounded-full px-4 py-1.5 text-[13px] font-bold text-white disabled:opacity-40"
                    style={{ background: t.blue }}
                  >
                    设为定时
                  </button>
                </div>
                {visibleAt !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setVisibleAt(null);
                      setSheet(null);
                      f.toast('已取消定时，改为立即发布');
                    }}
                    className="mt-2 w-full rounded-xl py-2.5 text-[14px] font-bold active:opacity-60"
                    style={{ background: 'rgba(244,33,46,0.1)', color: '#f4212e' }}
                  >
                    取消定时（改为立即发布）
                  </button>
                )}
              </div>
            )}

            {/* --- 位置 --- */}
            {sheet === 'geo' && (
              <div className="px-4 pt-3">
                <p className="pb-1 text-[15px] font-bold">添加位置</p>
                <div className="mt-1 flex items-center gap-2 rounded-full px-3 py-2" style={{ background: t.dark ? '#202327' : '#eff3f4' }}>
                  <MapPin width={15} height={15} style={{ color: t.secondary }} aria-hidden="true" />
                  <input
                    value={geoInput}
                    onChange={(e) => setGeoInput(e.target.value.slice(0, 20))}
                    placeholder="输入地点，如 北京市·朝阳区"
                    className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                    style={{ color: t.text, caretColor: t.blue }}
                    aria-label="位置名称"
                  />
                  <button
                    type="button"
                    disabled={!geoInput.trim()}
                    onClick={() => {
                      setLocation(geoInput.trim());
                      setSheet(null);
                      f.toast(`已添加位置：${geoInput.trim()}`);
                    }}
                    className="rounded-full px-4 py-1.5 text-[13px] font-bold text-white disabled:opacity-40"
                    style={{ background: t.blue }}
                  >
                    添加
                  </button>
                </div>
                <p className="mt-3 pb-1 text-[13px] font-bold" style={{ color: t.secondary }}>
                  快捷选择
                </p>
                {['北京市·朝阳区', '上海市·徐汇区', '广州市·天河区', '杭州市·西湖区', '成都市·锦江区'].map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      setLocation(name);
                      setSheet(null);
                      f.toast(`已添加位置：${name}`);
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-[10px] text-left transition-colors active:opacity-60"
                    style={{ background: t.hover }}
                  >
                    <MapPin width={15} height={15} style={{ color: t.blue }} aria-hidden="true" />
                    <span className="text-[15px]">{name}</span>
                  </button>
                ))}
                {location !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setLocation(null);
                      setSheet(null);
                      f.toast('已移除位置');
                    }}
                    className="mt-2 w-full rounded-xl py-2.5 text-[14px] font-bold active:opacity-60"
                    style={{ background: 'rgba(244,33,46,0.1)', color: '#f4212e' }}
                  >
                    移除当前位置
                  </button>
                )}
              </div>
            )}

            {/* --- GIF 搜索 --- */}
            {sheet === 'gif' && (
              <div className="px-4 pt-3">
                <p className="pb-1 text-[15px] font-bold">GIF·动图搜索</p>
                <form
                  className="mt-1 flex items-center gap-2 rounded-full px-3 py-2"
                  style={{ background: t.dark ? '#202327' : '#eff3f4' }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    searchGif(gifQuery);
                  }}
                >
                  <input
                    value={gifQuery}
                    onChange={(e) => setGifQuery(e.target.value.slice(0, 30))}
                    placeholder="搜动图，如 开心 猫 打工人"
                    className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                    style={{ color: t.text, caretColor: t.blue }}
                    aria-label="GIF 搜索关键词"
                  />
                  <button
                    type="submit"
                    disabled={!gifQuery.trim() || gifLoading}
                    className="rounded-full px-4 py-1.5 text-[13px] font-bold text-white disabled:opacity-40"
                    style={{ background: t.blue }}
                  >
                    {gifLoading ? '搜索中…' : '搜索'}
                  </button>
                </form>
                {gifLoading && (
                  <p className="py-6 text-center text-[13px]" style={{ color: t.secondary }}>
                    正在全网搜动图…
                  </p>
                )}
                {!gifLoading && gifResults.length === 0 && (
                  <div className="pb-2 pt-3">
                    <p className="pb-2 text-[13px] font-bold" style={{ color: t.secondary }}>
                      热门搜索
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {['开心', '猫猫', '打工人', '干饭', '点赞', '摸鱼', '晚安', '庆祝'].map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => {
                            setGifQuery(k);
                            searchGif(k);
                          }}
                          className="rounded-full px-3 py-1.5 text-[13px] font-medium active:opacity-60"
                          style={{ background: t.dark ? '#202327' : '#eff3f4', color: t.text }}
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {gifResults.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 pt-3">
                    {gifResults.map((g, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          addMedia([g.url]);
                          setSheet(null);
                          f.toast('动图已添加（发布后可看到）');
                        }}
                        className="relative aspect-square overflow-hidden rounded-xl active:opacity-70"
                        aria-label={`添加第 ${i + 1} 张动图`}
                      >
                        <img src={g.url} alt="搜索结果动图" className="h-full w-full object-cover" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* --- 话题（旗子）--- */}
            {sheet === 'topic' && (
              <div className="px-4 pt-3">
                <p className="pb-1 text-[15px] font-bold">插入话题标签</p>
                <p className="pb-2 text-[12px]" style={{ color: t.secondary }}>
                  点击追加到正文末尾，正文里的 #话题# 会染成品牌蓝
                </p>
                {trendingTopics(forumData()).map((tr) => (
                  <button
                    key={tr.tag}
                    type="button"
                    onClick={() => appendTopic(tr.tag)}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-[10px] text-left transition-colors active:opacity-60"
                    style={{ background: t.hover }}
                  >
                    <span className="text-[15px] font-bold" style={{ color: t.blue }}>
                      #{tr.tag}#
                    </span>
                    <span className="text-[13px]" style={{ color: t.secondary }}>
                      {tr.count} 条相关帖子
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
