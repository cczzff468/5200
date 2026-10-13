'use client';

/**
 * 网上表情包搜索弹窗（微信 / QQ 表情面板共用，Task 26 / 27 修订）——对照真机微信「表情搜索」弹窗：
 *  - 表情面板右上角搜索图标打开；弹窗从面板顶起、向上铺满手机壳可视区（盖住消息区+导航栏，
 *    输入栏/表情面板保留在下方可见——弹窗高度按「面板顶→手机壳顶」实测，不再用 vh：
 *    手机壳是固定 844px + transform scale 的模拟器，vh 参照的是浏览器视口，两者不相等，
 *    旧版 66vh 会顶出壳外被 overflow-hidden 裁掉标题和搜索框，focus 拉滚动还会把面板顶出屏幕）
 *  - 顶栏：左收起箭头 + 居中「表情搜索」标题；搜索框「搜索或合成表情」回车或 400ms 防抖实时搜
 *  - 「最近在搜」标签（localStorage 按端隔离，无历史时显示真机预设词组；垃圾桶清空）
 *  - 结果 3 列网格（缩略图），点选即发送（临时 Sticker 不入库，sendSticker 自带面板收起）
 *  - 底部「精选表情 >」：随机热词出图
 *
 * 数据源在后端 /api/sticker-search（360 图片 + 发表情兜底 + 24h 缓存）；图片走 /api/sticker-image 防盗链代理。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react';
import { DEFAULT_STICKER_GROUP_ID, type Sticker } from '@/lib/ios/stickers';
import { shellScale } from '@/lib/ios/shell-scale';

/** 真机微信冷启动预设词（无搜索历史时展示） */
const PRESET_TAGS = ['我自己玩', '哈喽哈喽', '救你了', 'mua', '服侍', '抱抱', 'Q', '哭', '不要'];
/** 「精选表情」随机热词池 */
const HOT_WORDS = ['熊猫头', '金馆长', '蘑菇头', '喵内', '小刘鸭', '柴犬', '哈基米', 'loopy', '悲伤蛙', '比心', '旺仔', '抱抱'];

const HIST_KEY = (app: 'wx' | 'qq') => `${app}-sticker-search-hist`;
const HIST_CAP = 12;

interface StickerHit {
  thumb: string;
  image: string;
}

export function StickerSearchSheet({
  app,
  open,
  onClose,
  onSend,
}: {
  app: 'wx' | 'qq';
  open: boolean;
  onClose: () => void;
  /** 点选结果即发送（临时 Sticker；发送链路自带面板收起） */
  onSend: (s: Sticker) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<StickerHit[]>([]);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [hist, setHist] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(HIST_KEY(app));
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, HIST_CAP) : [];
    } catch {
      return [];
    }
  });
  const [errText, setErrText] = useState('搜索失败，换个词试试');
  /** 弹窗高度（壳本地 px）：面板顶 → 手机壳可视顶。0 = 未量出（兜底用 CSS 高度） */
  const [sheetH, setSheetH] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);
  const seqRef = useRef(0);

  /**
   * 弹窗高度实测（Task 27）：手机壳是 844px 固定 + transform: scale(s) 的模拟器，
   * vh 单位参照浏览器视口而非壳——壳内元素的 CSS 像素是「壳本地坐标」。
   * 量法：面板顶与壳顶的视口距离 ÷ scale = 本地可用高度；面板/输入栏保留在弹窗下方可见。
   * useLayoutEffect 在绘制前量完，无闪烁；窗口缩放（resize）时重测。
   */
  useLayoutEffect(() => {
    if (!open) {
      setSheetH(0);
      return;
    }
    const measure = () => {
      const root = rootRef.current;
      const panel = root?.parentElement;
      if (!root || !panel) return;
      const shell = root.closest('[data-phone-shell]') as HTMLElement | null;
      if (!shell) return;
      const pr = panel.getBoundingClientRect();
      const sr = shell.getBoundingClientRect();
      const scale = shellScale.value || 1;
      const h = Math.round((pr.top - sr.top) / scale);
      if (h > 120) setSheetH(h);
    };
    // 挂载即量（面板布局在本次 commit 内已落定，无闪烁）
    measure();
    // resize 时 PhoneShell 会同步写 shellScale 但 transform 要等 React 重渲染才生效——
    // 立刻量会拿到「旧几何 ÷ 新缩放」的错值：双 rAF 等渲染落定后再量，250ms 再兜底量一次
    let raf1 = 0;
    let raf2 = 0;
    let settle = 0;
    const schedule = () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(settle);
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(measure);
      });
      settle = window.setTimeout(measure, 250);
    };
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(settle);
    };
  }, [open]);

  /** 打开时重置搜索态 + 聚焦输入框（preventScroll：绝不因 focus 滚动裁剪容器把面板顶出屏幕） */
  useEffect(() => {
    if (!open) return;
    setQ('');
    setHits([]);
    setPhase('idle');
    setErrText('搜索失败，换个词试试');
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 180);
    return () => window.clearTimeout(t);
  }, [open]);

  /** 卸载/关闭清理防抖 */
  useEffect(() => {
    if (open) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
  }, [open]);
  useEffect(() => () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
  }, []);

  const pushHist = useCallback((word: string) => {
    setHist((prev) => {
      const next = [word, ...prev.filter((x) => x !== word)].slice(0, HIST_CAP);
      try {
        localStorage.setItem(HIST_KEY(app), JSON.stringify(next));
      } catch {
        /* 配额满忽略 */
      }
      return next;
    });
  }, [app]);

  const runSearch = useCallback(async (word: string) => {
    const kw = word.trim().slice(0, 30);
    if (!kw) return;
    const seq = ++seqRef.current;
    setPhase('loading');
    setErrText('搜索失败，换个词试试');
    try {
      const res = await fetch(`/api/sticker-search?q=${encodeURIComponent(kw)}`);
      const data = (await res.json()) as { ok?: boolean; items?: StickerHit[]; error?: string };
      if (seq !== seqRef.current) return; // 已被更新的搜索取代
      if (!res.ok || !data.ok || !Array.isArray(data.items) || data.items.length === 0) {
        setErrText(data.error || '没搜到相关表情，换个词试试');
        setPhase('error');
        return;
      }
      setHits(data.items);
      setPhase('done');
      pushHist(kw);
    } catch {
      if (seq !== seqRef.current) return;
      setErrText('网络不佳，搜索失败');
      setPhase('error');
    }
  }, [pushHist]);

  /** 输入防抖实时搜（400ms；回车立即搜） */
  const onInput = (v: string) => {
    setQ(v);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const kw = v.trim();
    if (!kw) {
      setPhase('idle');
      setHits([]);
      return;
    }
    debounceRef.current = window.setTimeout(() => void runSearch(kw), 400);
  };

  const pick = (h: StickerHit) => {
    onClose();
    // 原图可能已失效（搜索引擎索引滞后，直链 404）：发送前 2s 探活，失败退回网格缩略图
    //（360 结果缩略图固定在 qhimgs CDN，稳定在线；动图原图探活成功仍优先原图，保住 GIF 动画）
    const base = {
      id: `${app}ss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      meaning: q.trim().slice(0, 30),
      groupId: DEFAULT_STICKER_GROUP_ID,
      createdAt: Date.now(),
    };
    const sendFallback = () => onSend({ ...base, url: h.thumb });
    const probe = new Image();
    const timer = window.setTimeout(sendFallback, 2000);
    probe.onload = () => {
      window.clearTimeout(timer);
      onSend({ ...base, url: h.image });
    };
    probe.onerror = () => {
      window.clearTimeout(timer);
      sendFallback();
    };
    probe.src = h.image;
  };

  const clearHist = () => {
    setHist([]);
    try {
      localStorage.removeItem(HIST_KEY(app));
    } catch {
      /* 忽略 */
    }
  };

  const featured = () => {
    const w = HOT_WORDS[Math.floor(Math.random() * HOT_WORDS.length)];
    setQ(w);
    void runSearch(w);
  };

  if (!open) return null;

  return (
    <div
      ref={rootRef}
      className="absolute inset-x-0 bottom-full z-40 flex flex-col overflow-hidden rounded-t-[16px] border border-b-0 border-black/[0.08] bg-[#F7F7F7] shadow-[0_-10px_40px_rgba(0,0,0,0.18)] dark:border-white/[0.08] dark:bg-[#232428]"
      style={{
        height: sheetH > 0 ? sheetH : undefined,
        minHeight: sheetH > 0 ? undefined : 380,
        maxHeight: sheetH > 0 ? undefined : '62vh',
        animation: 'quick-in-up 0.22s ease-out',
      }}
      data-testid={`${app}-sticker-search-sheet`}
    >
      {/* 顶栏：收起箭头 + 居中标题 */}
      <div className="relative flex shrink-0 items-center justify-center px-3 pb-1 pt-3.5">
        <button
          type="button"
          aria-label="收起表情搜索"
          data-testid={`${app}-sticker-search-close`}
          onClick={onClose}
          className="absolute left-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] text-black/55 active:opacity-60 dark:bg-white/10 dark:text-white/60"
        >
          <ChevronDown className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <p className="text-[16px] font-medium text-black/90 dark:text-white/90">表情搜索</p>
      </div>
      {/* 搜索框 */}
      <div className="shrink-0 px-4 pt-2.5">
        <div className="flex h-10 items-center gap-2 rounded-[10px] bg-black/[0.05] px-3 dark:bg-white/10">
          <Search className="h-4 w-4 shrink-0 text-black/35 dark:text-white/40" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (debounceRef.current) window.clearTimeout(debounceRef.current);
                void runSearch(q);
              }
            }}
            placeholder="搜索或合成表情"
            enterKeyHint="search"
            className="w-full bg-transparent text-[15px] text-black/85 outline-none placeholder:text-black/30 dark:text-white/90 dark:placeholder:text-white/30"
            data-testid={`${app}-sticker-search-input`}
          />
        </div>
      </div>
      {/* 主体：最近在搜 / 结果 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2 pt-3.5">
        {phase === 'idle' && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-black/40 dark:text-white/40">最近在搜</p>
              {hist.length > 0 && (
                <button
                  type="button"
                  aria-label="清空搜索历史"
                  data-testid={`${app}-sticker-search-clear`}
                  onClick={clearHist}
                  className="text-black/30 active:opacity-60 dark:text-white/35"
                >
                  <Trash2 className="h-[18px] w-[18px]" />
                </button>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2.5">
              {(hist.length > 0 ? hist : PRESET_TAGS).map((t) => (
                <button
                  key={t}
                  type="button"
                  data-testid={`${app}-sticker-search-tag-${t}`}
                  onClick={() => {
                    setQ(t);
                    void runSearch(t);
                  }}
                  className="rounded-[10px] bg-white px-4 py-2.5 text-[14px] text-black/85 shadow-[0_1px_4px_rgba(0,0,0,0.06)] active:opacity-60 dark:bg-white/10 dark:text-white/90"
                >
                  {t}
                </button>
              ))}
            </div>
          </>
        )}
        {phase === 'loading' && (
          <div className="flex h-40 flex-col items-center justify-center gap-3 text-black/40 dark:text-white/40">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-[13px]">正在搜罗全网表情…</p>
          </div>
        )}
        {phase === 'error' && (
          <div className="flex h-40 flex-col items-center justify-center gap-3">
            <p className="text-[13px] text-black/45 dark:text-white/45">{errText}</p>
            <button
              type="button"
              onClick={() => void runSearch(q)}
              className="flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-[13px] text-black/70 shadow-sm active:opacity-60 dark:bg-white/10 dark:text-white/70"
            >
              <RefreshCw className="h-3.5 w-3.5" /> 重试
            </button>
          </div>
        )}
        {phase === 'done' && (
          <div className="grid grid-cols-3 gap-2">
            {hits.map((h, i) => (
              <button
                key={i}
                type="button"
                data-testid={`${app}-sticker-search-item-${i}`}
                onClick={() => pick(h)}
                className="aspect-square overflow-hidden rounded-[10px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] active:opacity-60 dark:bg-white/10"
              >
                <img src={h.thumb} alt={`表情 ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
      {/* 精选表情 */}
      <button
        type="button"
        data-testid={`${app}-sticker-search-featured`}
        onClick={featured}
        className="mx-auto mb-4 mt-1 flex shrink-0 items-center gap-0.5 text-[15px] text-black/70 active:opacity-60 dark:text-white/70"
      >
        精选表情 <ChevronRight className="h-4 w-4 text-black/35 dark:text-white/35" />
      </button>
    </div>
  );
}
