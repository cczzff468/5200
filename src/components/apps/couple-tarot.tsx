'use client';

/**
 * 恋人空间「爱情塔罗」· 暗黑星空风（第四十五轮重做）。
 *
 * 流程：选主题（预设 + 自定义问题）→ 洗牌（轻触牌堆洗一次 / 长按持续洗牌）→
 * 选牌（78 张牌背扇形牌轮：双指缩放 + 左右滑动 + 点选上浮）→ 自动翻牌 →
 * AI 解读（正/逆位牌意 + 主题 + 人设语气 + 记忆与最近聊天）→ 结果页 → 占卜记录。
 *
 * - 牌库：src/lib/tarot-deck.ts（大阿尔卡那 22 + 小阿尔卡那 56，含正逆位牌意）；
 * - 持久化：state.tarotReadings[contactId]（按恋人联系人 ID 隔离，随 couple-space:state 落 IndexedDB，重启可查）；
 * - 记忆：解读完成后 coupleTarotRemember 写入恋人（AI）记忆（sourceTag='couple-tarot'，标记塔罗事件）；
 * - 动画：globals.css tarot-* keyframes；牌轮用 CSS 变量（--wa 角度 / --ws 缩放）驱动，一次样式写全牌生效。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ChevronRight, History, Sparkles, Star, Trash2 } from 'lucide-react';
import { TAROT_FULL_DECK, tarotCardById, type TarotCardDef, type TarotReading, type TarotTheme } from '@/lib/tarot-deck';
import { aiTarotReading, coupleTarotRemember, type TarotAiCard } from '@/lib/ios/couple-ai';
import { readInviteMeta } from '@/lib/ios/couple-invite';
import type { CoupleState } from './couple-space';

// ---------------- 预设主题 ----------------

const THEMES: TarotTheme[] = [
  { key: 'love', label: '恋爱运势', desc: '过去 · 现在 · 未来', spread: ['过去', '现在', '未来'] },
  { key: 'state', label: '当前状态', desc: '揭示这段关系此刻的能量', spread: ['当前状态'] },
  { key: 'hismind', label: 'TA 的想法', desc: '心意 · 顾虑 · 期待', spread: ['TA 的心意', 'TA 的顾虑', 'TA 的期待'] },
  { key: 'future', label: '关系走向', desc: '现状 · 考验 · 走向', spread: ['现状', '考验', '走向'] },
  { key: 'custom', label: '自定义问题', desc: '写下你最想问的问题', spread: ['答案'], custom: true },
];

// ---------------- 星空背景（确定性随机，避免每次渲染闪烁） ----------------

const STARS = Array.from({ length: 44 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  top: (i * 53 + 7) % 92,
  size: (i % 3) + 1,
  delay: ((i % 7) * 0.55).toFixed(2),
  dur: (2.4 + (i % 5) * 0.5).toFixed(2),
}));

function StarField() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute -left-20 -top-24 h-64 w-64 rounded-full bg-purple-700/25 blur-3xl" />
      <div className="absolute -right-24 top-1/4 h-72 w-72 rounded-full bg-fuchsia-700/[0.16] blur-3xl" />
      <div className="absolute -bottom-16 left-1/4 h-64 w-64 rounded-full bg-violet-800/20 blur-3xl" />
      {STARS.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white"
          style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size, opacity: 0.65, animation: `couple-twinkle ${s.dur}s ease-in-out ${s.delay}s infinite` }}
        />
      ))}
      {/* 一颗缓慢划过的流星 */}
      <span className="absolute left-[8%] top-[6%] h-[2px] w-16 origin-left rotate-[24deg] rounded-full bg-gradient-to-r from-transparent via-purple-100/80 to-transparent" style={{ animation: 'couple-shoot 9s linear 3s infinite' }} />
    </div>
  );
}

// ---------------- 卡背 / 卡面 / 翻牌 ----------------

function CardBack({ w, h }: { w: number; h: number }) {
  return (
    <div
      className="relative overflow-hidden border border-purple-200/25 shadow-[0_4px_18px_rgba(0,0,0,0.45)]"
      style={{ width: w, height: h, borderRadius: Math.max(8, w * 0.11), background: 'linear-gradient(155deg,#3b2364 0%,#5b2f8f 38%,#2a1747 78%,#1c1036 100%)' }}
    >
      <div className="absolute inset-[5px] rounded-[9px] border border-purple-200/20" />
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            'radial-gradient(circle at 22% 30%, rgba(255,255,255,0.9) 0.8px, transparent 1.2px), radial-gradient(circle at 68% 18%, rgba(255,255,255,0.7) 0.7px, transparent 1px), radial-gradient(circle at 42% 66%, rgba(255,255,255,0.65) 0.8px, transparent 1.2px), radial-gradient(circle at 80% 62%, rgba(255,255,255,0.8) 0.9px, transparent 1.3px), radial-gradient(circle at 15% 78%, rgba(255,255,255,0.6) 0.7px, transparent 1px)',
          backgroundSize: '46px 46px, 38px 38px, 52px 52px, 44px 44px, 60px 60px',
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-purple-100/30 bg-purple-950/40 text-[15px]">🌙</div>
      </div>
      <span className="absolute left-2 top-2 text-[8px] text-purple-100/70">✦</span>
      <span className="absolute right-2 bottom-2 text-[8px] text-purple-100/70">✦</span>
    </div>
  );
}

function CardFace({ def, reversed, w, h }: { def: TarotCardDef; reversed: boolean; w: number; h: number }) {
  return (
    <div
      className="relative overflow-hidden border border-amber-100/25 shadow-[0_6px_24px_rgba(0,0,0,0.55)]"
      style={{ width: w, height: h, borderRadius: Math.max(8, w * 0.11), background: 'linear-gradient(165deg,#241539 0%,#37205c 45%,#1d1133 100%)' }}
    >
      <div className="absolute inset-[5px] rounded-[9px] border border-amber-100/20" />
      <div className={`flex h-full flex-col items-center justify-between px-1.5 py-2.5 ${reversed ? 'rotate-180' : ''}`}>
        <div className="text-[10px] font-semibold tracking-[0.2em] text-amber-100/75">{def.numeral}</div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-[26px] drop-shadow">{def.symbol}</span>
          <div className="whitespace-nowrap text-[13px] font-bold text-purple-50">{def.name}</div>
          <div className="whitespace-nowrap text-[7px] uppercase tracking-[0.14em] text-purple-200/60">{def.nameEn}</div>
        </div>
        <div className="text-center text-[8px] leading-snug text-purple-100/70">{reversed ? def.revKeys : def.upKeys}</div>
      </div>
      {reversed && <div className="absolute right-1 top-1 rounded-full bg-fuchsia-400/90 px-1.5 py-[1px] text-[8px] font-bold text-purple-950">逆位</div>}
    </div>
  );
}

/** 3D 翻牌：牌背 → 牌面（flipped 后下方浮现牌位/牌名/正逆位） */
function FlipCard({ def, reversed, flipped, w, h, label }: { def: TarotCardDef; reversed: boolean; flipped: boolean; w: number; h: number; label: string }) {
  return (
    <div className="flex flex-col items-center" style={{ perspective: 900 }}>
      <div
        className="relative transition-transform duration-[550ms] ease-out"
        style={{ width: w, height: h, transformStyle: 'preserve-3d', transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
      >
        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
          <CardBack w={w} h={h} />
        </div>
        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
          <CardFace def={def} reversed={reversed} w={w} h={h} />
        </div>
      </div>
      {flipped ? (
        <div className="mt-2 flex flex-col items-center gap-1" style={{ animation: 'tarot-reveal-in 0.45s ease both' }}>
          <div className="text-[11px] font-medium text-purple-200/80">{label}</div>
          <div className="flex items-center gap-1.5 text-[13px] font-bold text-purple-50">
            {def.name}
            <span className={`rounded-full px-1.5 py-[1px] text-[9px] font-semibold ${reversed ? 'bg-fuchsia-400/20 text-fuchsia-200' : 'bg-purple-200/15 text-purple-100'}`}>
              {reversed ? '逆位' : '正位'}
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-2 text-[11px] font-medium text-purple-200/50">{label}</div>
      )}
    </div>
  );
}

// ---------------- 工具 ----------------

function cutText(s: string, max: number): string {
  const t = (s ?? '').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function fmtTs(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return `${sameYear ? '' : `${d.getFullYear()}年`}${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

/** AI 失败时的本地兜底解读（牌意直出，语气平实） */
function fallbackReading(spread: string[], cards: { def: TarotCardDef; reversed: boolean }[]): { per: string[]; overall: string } {
  const per = cards.map((c, i) => `【${spread[i] ?? '牌面'}】${c.def.name}（${c.reversed ? '逆位' : '正位'}）——${c.reversed ? c.def.reversed : c.def.upright}`);
  const overall = `这副牌的能量围绕「${cards.map((c) => (c.reversed ? c.def.revKeys : c.def.upKeys).split(' · ')[0]).join('、')}」展开。TA 说：牌面只是镜子，真正的心意一直都在你们之间，今晚把看到的话说给我听，好吗。`;
  return { per, overall };
}

// ---------------- 牌堆洗牌布局（确定性随机） ----------------

const PILE = Array.from({ length: 16 }, (_, i) => ({
  x: Math.round(Math.sin(i * 2.7) * 9),
  y: Math.round(Math.cos(i * 1.9) * 7),
  r: ((i * 47) % 22) - 11,
  sx: ((i * 97) % 130) - 65,
  sy: -30 - ((i * 61) % 55),
  sr: ((i * 31) % 56) - 28,
  delay: ((i % 5) * 0.045).toFixed(2),
  dur: (0.72 + (i % 4) * 0.09).toFixed(2),
}));

// ---------------- 主组件 ----------------

type View = 'theme' | 'shuffle' | 'pick' | 'reveal' | 'history' | 'detail';

export default function CoupleTarotPage({ state, patch, showToast, close }: {
  state: CoupleState;
  patch: (p: Partial<CoupleState> | ((prev: CoupleState) => Partial<CoupleState>)) => void;
  showToast: (m: string) => void;
  close: () => void;
}) {
  const meta = readInviteMeta();
  const cid = meta.partnerContactId || 'default';
  const channel = meta.partnerApp ?? 'wx';
  const taName = (state.taName || '').trim() || 'TA';
  const meName = (state.meName || '').trim() || '我';

  const [view, setView] = useState<View>('theme');
  const [theme, setTheme] = useState<TarotTheme | null>(null);
  const [customQ, setCustomQ] = useState('');
  const [shuffleTick, setShuffleTick] = useState(0);
  const [shuffleCount, setShuffleCount] = useState(0);
  const [holding, setHolding] = useState(false);
  const [picks, setPicks] = useState<number[]>([]); // 牌轮（78 张）中选中的下标，按选择顺序
  const revsRef = useRef<boolean[]>([]); // 每张牌的正/逆位（进牌轮时预定，翻牌时揭晓）
  const [flipped, setFlipped] = useState(0);
  const [reading, setReading] = useState<{ per: string[]; overall: string; aiUsed: boolean } | null>(null);
  const [detail, setDetail] = useState<TarotReading | null>(null);

  /** 抽到的牌 = 牌轮里被点选的那几张（点选即抽牌） */
  const drawn = useMemo(
    () => picks.map((i) => ({ def: TAROT_FULL_DECK[i], reversed: revsRef.current[i] ?? false })),
    [picks],
  );

  const readings = state.tarotReadings?.[cid] ?? [];

  // —— 洗牌：轻触一次 / 长按持续 ——
  const pressTimer = useRef<number | null>(null);
  const holdingRef = useRef(false);
  const doShuffle = useCallback(() => {
    setShuffleTick((t) => t + 1);
    setShuffleCount((n) => n + 1);
  }, []);
  const pileDown = useCallback(() => {
    holdingRef.current = false;
    pressTimer.current = window.setTimeout(() => {
      holdingRef.current = true;
      setHolding(true);
      doShuffle();
    }, 380);
  }, [doShuffle]);
  const pileUp = useCallback(() => {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    if (holdingRef.current) {
      holdingRef.current = false;
      setHolding(false);
    } else {
      doShuffle();
    }
  }, [doShuffle]);
  useEffect(() => {
    if (!holding) return;
    const iv = window.setInterval(doShuffle, 1000);
    return () => window.clearInterval(iv);
  }, [holding, doShuffle]);
  useEffect(() => () => {
    if (pressTimer.current != null) window.clearTimeout(pressTimer.current);
  }, []);

  // —— 开始选牌：牌轮展开全部 78 张，点选即抽牌 ——
  const startPick = useCallback(() => {
    if (!theme) return;
    revsRef.current = TAROT_FULL_DECK.map(() => Math.random() < 0.38);
    setPicks([]);
    setFlipped(0);
    setReading(null);
    setView('pick');
  }, [theme]);

  // —— 选满自动进入翻牌 ——
  const pickFull = !!theme && picks.length >= theme.spread.length && picks.length > 0;
  useEffect(() => {
    if (!pickFull) return;
    const t = window.setTimeout(() => setView('reveal'), 750);
    return () => window.clearTimeout(t);
  }, [pickFull]);

  // —— 翻牌序列 + AI 解读 ——
  const readingStarted = useRef(false);
  useEffect(() => {
    if (view !== 'reveal' || drawn.length === 0) return;
    readingStarted.current = false;
    setFlipped(0);
    const timers: number[] = [];
    drawn.forEach((_, i) => {
      timers.push(window.setTimeout(() => setFlipped((f) => Math.max(f, i + 1)), 480 + i * 640));
    });
    timers.push(
      window.setTimeout(() => {
        if (readingStarted.current) return;
        readingStarted.current = true;
        const cards: TarotAiCard[] = drawn.map((c, i) => ({
          pos: theme?.spread[i] ?? '牌面',
          name: c.def.name,
          nameEn: c.def.nameEn,
          reversed: c.reversed,
          meaning: c.reversed ? c.def.reversed : c.def.upright,
          keys: c.reversed ? c.def.revKeys : c.def.upKeys,
        }));
        void (async () => {
          let res: { per: string[]; overall: string } | null = null;
          try {
            res = await aiTarotReading({ themeLabel: theme?.label ?? '', question: theme?.custom ? customQ.trim() : undefined, cards });
          } catch {
            res = null;
          }
          const final = res ?? fallbackReading(theme?.spread ?? [], drawn);
          setReading({ ...final, aiUsed: !!res });
          // 持久化（按联系人隔离）+ 写记忆（塔罗事件）
          const record: TarotReading = {
            id: `tarot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            at: Date.now(),
            themeKey: theme?.key ?? 'custom',
            themeLabel: theme?.label ?? '',
            question: theme?.custom ? customQ.trim() : '',
            spread: theme?.spread ?? [],
            cards: drawn.map((c) => ({ defId: c.def.id, reversed: c.reversed })),
            per: final.per,
            overall: final.overall,
            aiUsed: !!res,
          };
          patch((prev) => ({
            tarotReadings: {
              ...(prev.tarotReadings ?? {}),
              [cid]: [record, ...((prev.tarotReadings ?? {})[cid] ?? [])].slice(0, 60),
            },
          }));
          const cardStr = drawn.map((c) => `${c.def.name}${c.reversed ? '（逆位）' : ''}`).join('、');
          coupleTarotRemember(
            meta.partnerContactId ? cid : '',
            channel,
            `（塔罗事件）${meName}在恋人空间用塔罗牌占卜「${theme?.label ?? ''}」${theme?.custom && customQ.trim() ? `（问题：${cutText(customQ.trim(), 24)}）` : ''}，抽到 ${cardStr}。${cutText(final.overall, 90)}`,
          );
          showToast('占卜完成，已写入你们的记忆 ♡');
        })();
      }, 480 + drawn.length * 640 + 380),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [view]);

  // —— 再来一次 ——
  const restart = useCallback(() => {
    setTheme(null);
    setCustomQ('');
    setPicks([]);
    setFlipped(0);
    setReading(null);
    setShuffleCount(0);
    setShuffleTick(0);
    setView('theme');
  }, []);

  const back = useCallback(() => {
    if (view === 'shuffle') setView('theme');
    else if (view === 'pick') {
      setPicks([]);
      setView('shuffle');
    } else if (view === 'reveal') restart();
    else if (view === 'history' || view === 'detail') setView('theme');
    else close();
  }, [view, close, restart]);

  const step = view === 'shuffle' ? 0 : view === 'pick' ? 1 : view === 'reveal' ? 2 : -1;

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#0b0714] text-purple-50">
      <StarField />

      {/* 顶栏 */}
      <div className="relative z-10 shrink-0 pt-[54px]">
        <div className="relative flex h-11 items-center px-1.5">
          <button type="button" onClick={back} aria-label="返回" className="flex h-9 w-9 items-center justify-center rounded-full text-purple-100 transition-opacity active:opacity-50">
            <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[16px] font-bold tracking-wide">爱情塔罗</div>
          <div className="ml-auto pr-2">{step >= 0 && <StepDots step={step} />}</div>
        </div>
      </div>

      <div className="relative z-10 min-h-0 flex-1">
        {view === 'theme' && (
          <ThemeView
            themes={THEMES}
            customQ={customQ}
            setCustomQ={setCustomQ}
            onPick={(t) => {
              setTheme(t);
              setShuffleCount(0);
              setShuffleTick(0);
              setView('shuffle');
            }}
            historyCount={readings.length}
            onHistory={() => setView('history')}
          />
        )}
        {view === 'shuffle' && theme && (
          <ShuffleView
            theme={theme}
            question={theme.custom ? customQ.trim() : ''}
            tick={shuffleTick}
            count={shuffleCount}
            holding={holding}
            onDown={pileDown}
            onUp={pileUp}
            onStart={startPick}
          />
        )}
        {view === 'pick' && theme && (
          <PickView theme={theme} picks={picks} onPick={handlePickFromWheel} />
        )}
        {view === 'reveal' && theme && drawn.length > 0 && (
          <RevealView
            theme={theme}
            question={theme.custom ? customQ.trim() : ''}
            drawn={drawn}
            flipped={flipped}
            reading={reading}
            taName={taName}
            taAvatar={state.taAvatar}
            onAgain={restart}
            onHistory={() => setView('history')}
          />
        )}
        {view === 'history' && (
          <HistoryView
            readings={readings}
            onBack={back}
            onOpen={(r) => {
              setDetail(r);
              setView('detail');
            }}
          />
        )}
        {view === 'detail' && detail && (
          <DetailView
            reading={detail}
            taName={taName}
            taAvatar={state.taAvatar}
            onBack={() => {
              setDetail(null);
              setView('history');
            }}
            onDelete={() => {
              patch((prev) => ({
                tarotReadings: {
                  ...(prev.tarotReadings ?? {}),
                  [cid]: ((prev.tarotReadings ?? {})[cid] ?? []).filter((r) => r.id !== detail.id),
                },
              }));
              showToast('已删除这条占卜记录');
              setDetail(null);
              setView('history');
            }}
          />
        )}
      </div>
    </div>
  );

  // —— 牌轮点选（点选即抽牌；再点一次可撤销；选满后不可再加） ——
  function handlePickFromWheel(idx: number) {
    if (!theme) return;
    const need = theme.spread.length;
    setPicks((prev) => {
      if (prev.includes(idx)) return prev.filter((p) => p !== idx);
      if (prev.length >= need) {
        showToast(`选满 ${need} 张啦`);
        return prev;
      }
      return [...prev, idx];
    });
  }
}

// ---------------- 步骤指示（洗牌 → 选牌 → 解读） ----------------

function StepDots({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-3.5">
      {['洗牌', '选牌', '解读'].map((s, i) => (
        <div key={s} className={`flex items-center gap-1.5 transition-colors ${i === step ? 'text-purple-100' : 'text-purple-300/35'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${i === step ? 'bg-fuchsia-300' : 'bg-current'}`} />
          <span className="text-[12px] font-medium">{s}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------- 主题选择 ----------------

function ThemeView({ themes, customQ, setCustomQ, onPick, historyCount, onHistory }: {
  themes: TarotTheme[];
  customQ: string;
  setCustomQ: (v: string) => void;
  onPick: (t: TarotTheme) => void;
  historyCount: number;
  onHistory: () => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  return (
    <div className="h-full overflow-y-auto overscroll-contain px-4 pb-6">
      <div className="pt-3 text-center">
        <div className="text-[22px] font-bold tracking-wide">选择占卜主题</div>
        <div className="mt-1 text-[12px] text-purple-200/60">静下心来，在心里默想你要问的事</div>
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        {themes.map((t) =>
          t.custom ? (
            <div
              key={t.key}
              className={`overflow-hidden rounded-2xl border transition-colors ${customOpen ? 'border-fuchsia-300/40 bg-white/[0.09]' : 'border-purple-200/12 bg-white/[0.06]'} backdrop-blur-xl`}
            >
              <button
                type="button"
                onClick={() => setCustomOpen((v) => !v)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-opacity active:opacity-70"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-400/15 text-[17px]">✍️</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{t.label}</span>
                  <span className="mt-0.5 block text-[12px] text-purple-200/60">{t.desc}</span>
                </span>
                <span className="shrink-0 rounded-full bg-purple-200/10 px-2 py-0.5 text-[10px] text-purple-100/80">1 张牌</span>
              </button>
              {customOpen && (
                <div className="px-4 pb-4" style={{ animation: 'tarot-text-in 0.3s ease both' }}>
                  <textarea
                    value={customQ}
                    onChange={(e) => setCustomQ(e.target.value)}
                    maxLength={60}
                    rows={2}
                    placeholder="例如：我们最近的关系会好吗？"
                    className="w-full resize-none rounded-xl border border-purple-200/15 bg-purple-950/40 px-3 py-2.5 text-[13px] text-purple-50 outline-none placeholder:text-purple-200/35 focus:border-fuchsia-300/40"
                    data-testid="tarot-custom-q"
                  />
                  <button
                    type="button"
                    disabled={customQ.trim().length < 2}
                    onClick={() => onPick(t)}
                    className="mt-2 h-10 w-full rounded-xl bg-gradient-to-r from-fuchsia-500 to-violet-500 text-[14px] font-semibold text-white shadow-[0_6px_18px_rgba(168,85,247,0.35)] transition-opacity active:opacity-80 disabled:opacity-40"
                  >
                    带着问题去洗牌
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              key={t.key}
              type="button"
              onClick={() => onPick(t)}
              className="flex items-center gap-3 rounded-2xl border border-purple-200/12 bg-white/[0.06] px-4 py-3.5 text-left backdrop-blur-xl transition-all active:scale-[0.98] active:bg-white/[0.09]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-400/15 text-[17px]">🔮</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{t.label}</span>
                <span className="mt-0.5 block text-[12px] text-purple-200/60">{t.desc}</span>
              </span>
              <span className="shrink-0 rounded-full bg-purple-200/10 px-2 py-0.5 text-[10px] text-purple-100/80">{t.spread.length} 张牌</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-purple-200/40" />
            </button>
          ),
        )}
      </div>

      {historyCount > 0 && (
        <button
          type="button"
          onClick={onHistory}
          data-testid="tarot-history-entry"
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-purple-200/12 bg-white/[0.04] py-3 text-[13px] text-purple-100/85 backdrop-blur-xl transition-opacity active:opacity-60"
        >
          <History className="h-4 w-4" />
          占卜记录（{historyCount}）
        </button>
      )}
    </div>
  );
}

// ---------------- 洗牌 ----------------

function ShuffleView({ theme, question, tick, count, holding, onDown, onUp, onStart }: {
  theme: TarotTheme;
  question: string;
  tick: number;
  count: number;
  holding: boolean;
  onDown: () => void;
  onUp: () => void;
  onStart: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center px-6">
      <div className="mt-2 text-center">
        <div className="text-[26px] font-bold tracking-wide">洗牌</div>
        <div className="mt-1.5 text-[13px] text-purple-200/65">轻触牌堆再洗一次，长按持续洗牌</div>
        {theme.custom && question ? <div className="mt-1 text-[12px] text-fuchsia-200/80">你的问题：{question}</div> : null}
      </div>

      {/* 牌堆（可按压） */}
      <div
        className="relative mt-2 flex flex-1 items-center justify-center self-stretch touch-none select-none"
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onUp}
        data-testid="tarot-pile"
      >
        {/* 呼吸光晕 */}
        <div
          className="absolute h-44 w-44 rounded-full bg-fuchsia-500/20 blur-3xl"
          style={{ animation: 'tarot-pile-glow 2.6s ease-in-out infinite' }}
        />
        <div className="relative h-[176px] w-[112px]">
          {PILE.map((o, i) => (
            <div key={i} className="absolute left-1/2 top-1/2" style={{ transform: `translate(-50%,-50%) translate(${o.x}px,${o.y}px) rotate(${o.r}deg)` }}>
              <div
                key={tick}
                style={
                  {
                    '--sx': `${o.sx}px`,
                    '--sy': `${o.sy}px`,
                    '--sr': `${o.sr}deg`,
                    animation: `tarot-shuffle-card ${o.dur}s ease-in-out ${o.delay}s both`,
                    willChange: 'transform',
                  } as CSSProperties
                }
              >
                <CardBack w={112} h={176} />
              </div>
            </div>
          ))}
        </div>
        {holding && <div className="absolute bottom-2 text-[12px] text-fuchsia-200/90" style={{ animation: 'tarot-star-pulse 1.2s ease-in-out infinite' }}>正在与牌灵连接…</div>}
      </div>

      {/* 开始选牌 */}
      <div className="flex w-full flex-col items-center gap-2 pb-6" style={{ opacity: count > 0 ? 1 : 0.45, transition: 'opacity 0.4s' }}>
        <div className="text-[12px] text-purple-200/55">{count > 0 ? `已洗 ${count} 次 · 牌已经醒了` : '先洗牌，让牌听见你的问题'}</div>
        <button
          type="button"
          onClick={onStart}
          disabled={count === 0}
          data-testid="tarot-start-pick"
          className="h-12 rounded-2xl bg-gradient-to-r from-fuchsia-500 to-violet-500 px-12 text-[15px] font-semibold text-white shadow-[0_8px_22px_rgba(168,85,247,0.4)] transition-all active:scale-[0.97] disabled:opacity-45"
        >
          开始选牌
        </button>
      </div>
    </div>
  );
}

// ---------------- 选牌（扇形牌轮） ----------------

const WHEEL_STEP = 360 / 78;
const WHEEL_R = 430;
const WHEEL_MIN_SCALE = 0.75;
const WHEEL_MAX_SCALE = 1.3;

function PickView({ theme, picks, onPick }: {
  theme: TarotTheme;
  picks: number[];
  onPick: (idx: number) => void;
}) {
  const need = theme.spread.length;
  const deck = TAROT_FULL_DECK;
  const wrapRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef(0);
  const scaleRef = useRef(1);
  const velRef = useRef(0);
  const rafRef = useRef(0);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const modeRef = useRef<'none' | 'drag' | 'pinch'>('none');
  const lastXRef = useRef(0);
  const pinch0Ref = useRef({ dist: 0, scale: 1 });
  const movedRef = useRef(false);
  const downAtRef = useRef(0);

  const applyVars = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.style.setProperty('--wa', `${angleRef.current.toFixed(2)}deg`);
    el.style.setProperty('--ws', scaleRef.current.toFixed(3));
  }, []);

  useEffect(() => {
    applyVars();
    return () => window.cancelAnimationFrame(rafRef.current);
  }, [applyVars]);

  /** 惯性旋转（rAF 逐帧衰减，自引用函数声明无逐笔重建问题） */
  function spin() {
    rafRef.current = requestAnimationFrame(() => {
      angleRef.current += velRef.current;
      velRef.current *= 0.93;
      applyVars();
      if (Math.abs(velRef.current) > 0.04) spin();
    });
  }

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      window.cancelAnimationFrame(rafRef.current);
      ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      downAtRef.current = Date.now();
      movedRef.current = false;
      if (ptrs.current.size === 1) {
        modeRef.current = 'drag';
        lastXRef.current = e.clientX;
        velRef.current = 0;
      } else if (ptrs.current.size === 2) {
        modeRef.current = 'pinch';
        const [a, b] = Array.from(ptrs.current.values());
        pinch0Ref.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: scaleRef.current };
      }
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const prev = ptrs.current.get(e.pointerId);
      if (!prev) return;
      ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (modeRef.current === 'drag' && ptrs.current.size === 1) {
        const dx = e.clientX - lastXRef.current;
        lastXRef.current = e.clientX;
        if (Math.abs(dx) > 2) movedRef.current = true;
        angleRef.current += dx * 0.26;
        velRef.current = velRef.current * 0.7 + dx * 0.26 * 0.3;
        applyVars();
      } else if (modeRef.current === 'pinch' && ptrs.current.size === 2) {
        movedRef.current = true;
        const [a, b] = Array.from(ptrs.current.values());
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        scaleRef.current = Math.min(WHEEL_MAX_SCALE, Math.max(WHEEL_MIN_SCALE, pinch0Ref.current.scale * (dist / pinch0Ref.current.dist)));
        applyVars();
      }
    },
    [applyVars],
  );

  const endPtr = useCallback(
    (e: React.PointerEvent) => {
      ptrs.current.delete(e.pointerId);
      if (modeRef.current === 'pinch' && ptrs.current.size === 1) {
        modeRef.current = 'drag';
        const [a] = Array.from(ptrs.current.values());
        lastXRef.current = a.x;
      }
      if (ptrs.current.size === 0) {
        if (modeRef.current === 'drag' && Math.abs(velRef.current) > 0.35) spin();
        modeRef.current = 'none';
        // 点选（未拖动 + 快速点按）
        if (!movedRef.current && Date.now() - downAtRef.current < 420) {
          const el = e.target as HTMLElement | null;
          const card = el?.closest('[data-card-idx]') as HTMLElement | null;
          if (card) onPick(Number(card.dataset.cardIdx));
        }
      }
    },
    [onPick, spin],
  );

  const nextIdx = picks.length;
  const pickDone = picks.length >= need;

  return (
    <div className="flex h-full flex-col">
      {/* 标题区 */}
      <div className="shrink-0 px-5 pt-1 text-center">
        <div className="text-[12px] font-medium text-purple-200/70">第 {Math.min(nextIdx + 1, need)} 张牌</div>
        <div className="mt-0.5 text-[24px] font-bold tracking-wide">{theme.custom ? '你的问题' : theme.label}</div>
        {theme.custom ? <div className="mt-0.5 text-[12px] text-fuchsia-200/75">顺着问题，凭直觉抽牌</div> : <div className="mt-0.5 text-[12px] text-purple-200/55">双指放大牌轮，滑动牌轮，点选牌</div>}
      </div>

      {/* 牌位槽 */}
      <div className="flex shrink-0 items-start justify-center gap-3 px-5 pt-3">
        {theme.spread.map((label, i) => {
          const filled = i < picks.length;
          const active = i === nextIdx && !pickDone;
          return (
            <div key={i} className="flex w-[74px] flex-col items-center gap-1.5">
              <div
                className={`relative h-[100px] w-[66px] rounded-[10px] border border-dashed transition-colors ${filled ? 'border-transparent' : active ? 'border-fuchsia-300/70' : 'border-purple-200/25'}`}
                style={active ? { boxShadow: '0 0 14px rgba(232,121,249,0.35)', animation: 'tarot-star-pulse 1.6s ease-in-out infinite' } : undefined}
              >
                {filled && (
                  <div className="absolute inset-0" style={{ animation: 'tarot-reveal-in 0.4s ease both' }}>
                    <CardBack w={66} h={100} />
                  </div>
                )}
              </div>
              <div className={`text-[10px] ${filled ? 'text-purple-100' : 'text-purple-200/45'}`}>{label}</div>
            </div>
          );
        })}
      </div>

      {/* 牌轮 */}
      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPtr}
        onPointerCancel={endPtr}
        onPointerLeave={endPtr}
        data-testid="tarot-wheel"
      >
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-purple-200/45">
          已选 {picks.length} / {need} 张{picks.length > 0 && !pickDone ? ' · 点选牌背可撤销' : ''}
        </div>
        {deck.map((_, i) => {
          const picked = picks.includes(i);
          return (
            <div
              key={deck[i].id}
              data-card-idx={i}
              className="absolute left-1/2 top-[132%] cursor-pointer"
              style={{ width: 64, height: 101, marginLeft: -32, marginTop: -50, transform: `rotate(calc(var(--wa, 0deg) + ${i * WHEEL_STEP}deg)) translateY(calc(-430px * var(--ws, 1)))`, willChange: 'transform', zIndex: picked ? 30 : 10 }}
            >
              <div
                className="transition-transform duration-300 ease-out"
                style={{ transform: picked ? 'translateY(-26px)' : 'translateY(0)', filter: picked ? 'brightness(1.18) drop-shadow(0 0 12px rgba(232,121,249,0.65))' : undefined }}
              >
                <CardBack w={64} h={101} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- 解读 / 结果 ----------------

function ResultBody({ theme, question, drawnCards, flippedCount, reading, taName, taAvatar, footer }: {
  theme: TarotTheme;
  question: string;
  drawnCards: { def: TarotCardDef; reversed: boolean }[];
  flippedCount: number;
  reading: { per: string[]; overall: string; aiUsed: boolean } | null;
  taName: string;
  taAvatar: string | null;
  footer?: React.ReactNode;
}) {
  const big = drawnCards.length === 1;
  const cw = big ? 150 : 102;
  const ch = big ? 236 : 162;
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
        {/* 牌阵 */}
        <div className={`mt-1 flex ${big ? 'flex-col' : 'flex-row justify-center'} items-center gap-3`}>
          {drawnCards.map((c, i) => (
            <FlipCard key={`${c.def.id}-${i}`} def={c.def} reversed={c.reversed} flipped={flippedCount > i} w={cw} h={ch} label={theme.spread[i] ?? ''} />
          ))}
        </div>

        {theme.custom && question && (
          <div className="mt-4 rounded-xl border border-fuchsia-300/20 bg-fuchsia-400/[0.07] px-3.5 py-2.5 text-center text-[12.5px] text-fuchsia-100/90 backdrop-blur-xl">
            你问塔罗：「{question}」
          </div>
        )}

        {/* AI 解读 */}
        <div className="mt-4 rounded-2xl border border-purple-200/12 bg-white/[0.05] p-4 backdrop-blur-xl" data-testid="tarot-reading">
          <div className="flex items-center gap-2.5">
            {taAvatar ? (
              <img src={taAvatar} alt={taName} className="h-9 w-9 rounded-full border border-purple-200/25 object-cover" />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-400/20 text-[14px] font-bold text-purple-100">{taName.slice(0, 1)}</span>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold">{taName} 的解读</div>
              <div className="text-[10.5px] text-purple-200/55">结合牌意 · 你们的故事 · 最近的心情</div>
            </div>
            <Sparkles className="h-4 w-4 text-fuchsia-300/80" />
          </div>

          {!reading ? (
            <div className="mt-3.5 flex items-center gap-3 rounded-xl bg-purple-950/30 px-3.5 py-3" data-testid="tarot-reading-loading">
              <span className="relative flex h-6 w-6 items-center justify-center">
                <span className="absolute inset-0 rounded-full border-2 border-fuchsia-300/25 border-t-fuchsia-300" style={{ animation: 'tarot-halo-spin 0.9s linear infinite' }} />
                <Star className="h-2.5 w-2.5 text-fuchsia-200" />
              </span>
              <span className="text-[12.5px] text-purple-100/80">{taName} 正在结合你们的故事解读这副牌…</span>
            </div>
          ) : (
            <div className="mt-3.5 flex flex-col gap-3">
              {reading.per.map((t, i) => {
                const c = drawnCards[i];
                return (
                  <div key={i} className="rounded-xl bg-purple-950/30 px-3.5 py-3" style={{ animation: `tarot-text-in 0.45s ease ${i * 0.12}s both` }}>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[12px] font-semibold text-fuchsia-200/90">{theme.spread[i] ?? ''}</span>
                      {c && <span className="text-[11px] text-purple-200/60">{c.def.name} · {c.reversed ? '逆位' : '正位'}</span>}
                    </div>
                    <p className="mt-1 text-[13.5px] leading-[1.75] text-purple-50/95">{t}</p>
                  </div>
                );
              })}
              {reading.overall && (
                <div className="rounded-xl border border-fuchsia-300/20 bg-fuchsia-400/[0.08] px-3.5 py-3" style={{ animation: 'tarot-text-in 0.45s ease 0.2s both' }}>
                  <p className="text-[13.5px] leading-[1.8] text-purple-50">{reading.overall}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {footer}
      </div>
    </div>
  );
}

function RevealView({ theme, question, drawn, flipped, reading, taName, taAvatar, onAgain, onHistory }: {
  theme: TarotTheme;
  question: string;
  drawn: { def: TarotCardDef; reversed: boolean }[];
  flipped: number;
  reading: { per: string[]; overall: string; aiUsed: boolean } | null;
  taName: string;
  taAvatar: string | null;
  onAgain: () => void;
  onHistory: () => void;
}) {
  return (
    <ResultBody
      theme={theme}
      question={question}
      drawnCards={drawn}
      flippedCount={flipped}
      reading={reading}
      taName={taName}
      taAvatar={taAvatar}
      footer={
        reading ? (
          <div className="mt-4 grid grid-cols-2 gap-2.5 pb-2">
            <button
              type="button"
              onClick={onHistory}
              className="h-11 rounded-xl border border-purple-200/15 bg-white/[0.05] text-[14px] font-medium text-purple-100 backdrop-blur-xl transition-opacity active:opacity-60"
            >
              占卜记录
            </button>
            <button
              type="button"
              onClick={onAgain}
              data-testid="tarot-again"
              className="h-11 rounded-xl bg-gradient-to-r from-fuchsia-500 to-violet-500 text-[14px] font-semibold text-white shadow-[0_6px_18px_rgba(168,85,247,0.35)] transition-opacity active:opacity-80"
            >
              再占一次
            </button>
          </div>
        ) : null
      }
    />
  );
}

// ---------------- 历史记录 ----------------

function HistoryView({ readings, onBack, onOpen }: {
  readings: TarotReading[];
  onBack: () => void;
  onOpen: (r: TarotReading) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-5 pt-2 text-center">
        <div className="text-[20px] font-bold tracking-wide">占卜记录</div>
        <div className="mt-0.5 text-[12px] text-purple-200/55">每一次提问，星星都有回应</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-3">
        {readings.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-purple-200/50">
            <Star className="h-6 w-6" strokeWidth={1.5} />
            <span className="text-[13px]">还没有占卜记录</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {readings.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onOpen(r)}
                data-testid="tarot-history-item"
                className="rounded-2xl border border-purple-200/12 bg-white/[0.05] px-4 py-3.5 text-left backdrop-blur-xl transition-all active:scale-[0.98]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[14.5px] font-bold">{r.themeLabel}</span>
                  {r.question ? <span className="min-w-0 flex-1 truncate text-[11.5px] text-fuchsia-200/75">「{r.question}」</span> : <span className="flex-1" />}
                  <span className="shrink-0 text-[10.5px] text-purple-200/45">{fmtTs(r.at)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.cards.map((c, i) => {
                    const def = tarotCardById(c.defId);
                    return (
                      <span key={i} className="rounded-full bg-purple-200/10 px-2 py-0.5 text-[10.5px] text-purple-100/85">
                        {def?.name ?? '?'} · {c.reversed ? '逆' : '正'}
                      </span>
                    );
                  })}
                </div>
                {r.overall && <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-purple-100/70">{r.overall}</p>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 px-4 pb-5">
        <button type="button" onClick={onBack} className="h-11 w-full rounded-xl border border-purple-200/15 bg-white/[0.05] text-[14px] font-medium text-purple-100 backdrop-blur-xl transition-opacity active:opacity-60">
          返回
        </button>
      </div>
    </div>
  );
}

function DetailView({ reading, taName, taAvatar, onBack, onDelete }: {
  reading: TarotReading;
  taName: string;
  taAvatar: string | null;
  onBack: () => void;
  onDelete: () => void;
}) {
  const cards = reading.cards
    .map((c) => {
      const def = tarotCardById(c.defId);
      return def ? { def, reversed: c.reversed } : null;
    })
    .filter((x): x is { def: TarotCardDef; reversed: boolean } => !!x);
  return (
    <ResultBody
      theme={{ key: reading.themeKey, label: reading.themeLabel, desc: '', spread: reading.spread }}
      question={reading.question}
      drawnCards={cards}
      flippedCount={cards.length}
      reading={reading.per.length > 0 || reading.overall ? { per: reading.per, overall: reading.overall, aiUsed: reading.aiUsed } : null}
      taName={taName}
      taAvatar={taAvatar}
      footer={
        <div className="mt-4 grid grid-cols-2 gap-2.5 pb-2">
          <button
            type="button"
            onClick={onDelete}
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-red-300/25 bg-red-400/[0.08] text-[14px] font-medium text-red-200 transition-opacity active:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            删除
          </button>
          <button type="button" onClick={onBack} className="h-11 rounded-xl border border-purple-200/15 bg-white/[0.05] text-[14px] font-medium text-purple-100 backdrop-blur-xl transition-opacity active:opacity-60">
            返回列表
          </button>
        </div>
      }
    />
  );
}
