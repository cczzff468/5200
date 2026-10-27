'use client';

/**
 * 聊天气泡装扮设置页（第十七轮建立 · 第十八轮重构）——微信/QQ 共用、装扮隔离
 * ---------------------------------------------------------------------------
 * 入口：QQ 个人抽屉 › 个性装扮；微信 发现页 › 看一看 › 聊天气泡装扮。
 *
 * 结构（自上而下，第十八轮按用户要求精简）：
 *  1. 实时预览卡片（四条模拟消息，所见即所得：弯钩尾巴 / 胶囊毛玻璃 / 液态高光 / 七彩循环）
 *  2. 气泡样式四格：默认 / 七彩 / 毛玻璃 / 液态 —— 不分 TA/我，样式对两侧同时生效；
 *     微信与 QQ 的装扮完全隔离（本页只改当前 App）
 *  3. 自定义颜色（这里才分侧）：【我的气泡 / TA的气泡】切换 + HSL 三滑条 + 24 色预设
 *  4. 【保存当前设置】→ 命名弹窗 → 存入收藏夹（方案归属当前 App）
 *  5. 「我的气泡」收藏夹：缩略图卡 + App 徽标，点击应用（只覆盖方案归属的 App）
 *
 * 视觉：整页轻毛玻璃风（白卡 + 细描边 + 柔和阴影），去多余层级，简约美观。
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronRight, GlassWater, Palette, RotateCcw, Sparkles, Trash2, Waves } from 'lucide-react';
import { IOSBackButton, IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { BubbleTail } from '@/components/apps/bubble-tail';
import { useSettings } from '@/lib/ios/store';
import {
  BUBBLE_KIND_LABEL,
  NATIVE_BUBBLE,
  PRESET_SWATCHES,
  bubbleVisual,
  hexToHsl,
  hslToHex,
  yiqTextOn,
  type BubbleAppStyle,
  type BubbleScheme,
  type BubbleStyleConfig,
  type BubbleStyleKind,
} from '@/lib/ios/bubble-style';

export interface BubbleStylePageProps {
  /** 宿主 App（装扮完全隔离：本页所有修改只写入 cfg[app]） */
  app: 'wx' | 'qq';
  /** 返回上一级 */
  onBack: () => void;
  /** 弹一条本地提示 */
  onToast: (m: string) => void;
}

const PLATFORM_META: Record<'wx' | 'qq', { name: string; accent: string; accentSoft: string }> = {
  wx: { name: '微信', accent: '#07C160', accentSoft: 'rgba(7, 193, 96, 0.14)' },
  qq: { name: 'QQ', accent: '#0099FF', accentSoft: 'rgba(0, 153, 255, 0.14)' },
};

/** 样式四格的图标 */
const KIND_ICONS: Record<BubbleStyleKind, typeof Palette> = {
  default: Palette,
  rainbow: Sparkles,
  frosted: GlassWater,
  liquid: Waves,
};

// ---------------- 迷你预览气泡（与聊天页同一渲染引擎，所见即所得） ----------------

/** 彩色光斑层：垫在毛玻璃/液态泡下面，让 backdrop-filter 的模糊效果肉眼可见 */
function AuraLayer() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <span className="absolute -left-4 top-2 h-16 w-16 rounded-full bg-[#FF9500]/45 blur-2xl" />
      <span className="absolute right-6 top-6 h-14 w-14 rounded-full bg-[#34C759]/45 blur-2xl" />
      <span className="absolute bottom-0 left-1/3 h-16 w-16 rounded-full bg-[#AF52DE]/40 blur-2xl" />
      <span className="absolute -right-2 bottom-2 h-14 w-14 rounded-full bg-[#3D9BFF]/40 blur-2xl" />
    </div>
  );
}

/** 单条迷你预览气泡：override 时用装扮样式（含弯钩尾巴），否则 App 原生配色 */
function PreviewBubble({
  app,
  cfg,
  side,
  index,
  children,
  className = '',
}: {
  app: 'wx' | 'qq';
  cfg: BubbleStyleConfig;
  side: 'mine' | 'theirs';
  index: number;
  children: React.ReactNode;
  className?: string;
}) {
  const vis = bubbleVisual(side, cfg, index, app);
  const native = side === 'mine' ? NATIVE_BUBBLE[app].mine : NATIVE_BUBBLE[app].theirs;
  const nativeText = side === 'mine' && app === 'qq' ? 'text-white' : 'text-black';
  return (
    <div
      className={`relative w-fit max-w-full whitespace-pre-wrap break-words rounded-[10px] px-2.5 py-[7px] text-[12.5px] leading-[1.45] ${
        vis.override ? vis.className : nativeText
      } ${className}`}
      style={vis.override ? vis.style : { backgroundColor: native }}
    >
      {vis.tail === 'hook' && <BubbleTail side={side} color={vis.tailColor} top={2} />}
      {children}
    </div>
  );
}

/** 预览卡/收藏夹缩略图里的一行消息（带头像圆点） */
function PreviewRow({
  app,
  cfg,
  side,
  index,
  text,
}: {
  app: 'wx' | 'qq';
  cfg: BubbleStyleConfig;
  side: 'mine' | 'theirs';
  index: number;
  text: string;
}) {
  const meta = PLATFORM_META[app];
  return (
    <div className={`flex items-end gap-1.5 ${side === 'mine' ? 'flex-row-reverse' : ''}`}>
      <span
        aria-hidden="true"
        className={`z-[1] flex h-[26px] w-[26px] shrink-0 select-none items-center justify-center rounded-full text-[10px] font-semibold text-white ${
          side === 'mine' ? '' : 'bg-gradient-to-br from-[#F0A0B8] to-[#C86DD7]'
        }`}
        style={side === 'mine' ? { background: `linear-gradient(135deg, ${meta.accent}, ${meta.accent}CC)` } : undefined}
      >
        {side === 'mine' ? '我' : 'TA'}
      </span>
      <PreviewBubble app={app} cfg={cfg} side={side} index={index}>
        {text}
      </PreviewBubble>
    </div>
  );
}

/** 预览消息序列：序号 0-3 递增（七彩样式下能看到 亮黄→青柠→杏色→青色 依次切换） */
const PREVIEW_MESSAGES: { side: 'mine' | 'theirs'; text: string }[] = [
  { side: 'theirs', text: '早安呀，今天也要开心' },
  { side: 'mine', text: '早安！窗外云超好看' },
  { side: 'theirs', text: '哈哈快拍给我看看' },
  { side: 'mine', text: '这就发你，等我' },
];

// ---------------- HSL 滑条（全色彩盘三杆） ----------------

let hslSliderSeq = 0;

function HslSlider({
  value,
  max,
  trackBackground,
  thumbColor,
  label,
  onChange,
}: {
  value: number;
  max: number;
  trackBackground: string;
  thumbColor: string;
  label: string;
  onChange: (v: number) => void;
}) {
  const [id] = useState(() => `hsl-slider-${++hslSliderSeq}`);
  return (
    <div className="relative h-6">
      {/* 滑杆手柄底色随当前色变化：内联样式选不中伪元素，挂一段组件级动态样式 */}
      <style>{`#${id}::-webkit-slider-thumb{background-color:${thumbColor}} #${id}::-moz-range-thumb{background-color:${thumbColor}}`}</style>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.12)] ring-1 ring-white/60 dark:ring-white/15"
        style={{ background: trackBackground }}
      />
      <input
        id={id}
        type="range"
        aria-label={label}
        value={Math.round(value)}
        min={0}
        max={max}
        step={1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 h-6 w-full cursor-pointer appearance-none bg-transparent
          [&::-webkit-slider-thumb]:h-[22px] [&::-webkit-slider-thumb]:w-[22px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-[0_2px_6px_rgba(0,0,0,0.28)]
          [&::-moz-range-thumb]:h-[22px] [&::-moz-range-thumb]:w-[22px] [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-[0_2px_6px_rgba(0,0,0,0.28)]"
      />
    </div>
  );
}

// ---------------- 主设置页 ----------------

export function BubbleStylePage({ app, onBack, onToast }: BubbleStylePageProps) {
  const meta = PLATFORM_META[app];
  const bubbleStyle = useSettings((s) => s.bubbleStyle);
  const schemes = useSettings((s) => s.bubbleSchemes);
  const setBubbleStyle = useSettings((s) => s.setBubbleStyle);
  const setBubbleSchemes = useSettings((s) => s.setBubbleSchemes);

  /** 自定义颜色正在编辑的侧（仅颜色分侧；样式对两侧同时生效） */
  const [side, setSide] = useState<'mine' | 'theirs'>('mine');
  /** 命名弹窗 */
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  /** 当前 App 的装扮（微信/QQ 隔离：只读写 bubbleStyle[app]） */
  const appStyle: BubbleAppStyle = bubbleStyle[app] ?? { kind: 'default' };
  const kindDisabled = appStyle.kind === 'rainbow';
  const currentColor = side === 'mine' ? appStyle.mineColor : appStyle.theirsColor;
  /** 无自定义色时滑条落在 App 原生默认色位置（拖动任意一杆立即生成自定义色落地） */
  const fallbackHex = NATIVE_BUBBLE[app][side];
  const hsl = useMemo(() => hexToHsl(currentColor ?? fallbackHex), [currentColor, fallbackHex]);

  /** 修改当前 App 的装扮（另一个 App 原样保留 —— 装扮隔离） */
  const patchAppStyle = (patch: Partial<BubbleAppStyle>) => {
    setBubbleStyle({
      ...bubbleStyle,
      [app]: { ...appStyle, ...patch },
    });
  };

  /** 滑条拖动：实时合成 hex 写入当前侧（预览卡/聊天页即时跟随） */
  const commitHsl = (h: number, s: number, l: number) => {
    patchAppStyle(side === 'mine' ? { mineColor: hslToHex(h, s, l) } : { theirsColor: hslToHex(h, s, l) });
  };

  const saveScheme = () => {
    const name = nameDraft.trim().slice(0, 16) || `我的气泡 ${schemes.length + 1}`;
    const scheme: BubbleScheme = {
      id: `bs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      app,
      style: { ...appStyle },
      createdAt: Date.now(),
    };
    setBubbleSchemes([scheme, ...schemes]);
    setNaming(false);
    setNameDraft('');
    onToast(`已保存「${name}」到${meta.name}装扮`);
  };

  /** 应用方案：只覆盖方案归属的 App（跨 App 应用时提示归属） */
  const applyScheme = (s: BubbleScheme) => {
    setBubbleStyle({
      ...bubbleStyle,
      [s.app]: { ...s.style },
    });
    const target = PLATFORM_META[s.app].name;
    onToast(s.app === app ? `已应用「${s.name}」` : `已将「${s.name}」应用到${target}`);
  };

  const removeScheme = (s: BubbleScheme) => {
    setBubbleSchemes(schemes.filter((x) => x.id !== s.id));
    onToast(`已删除「${s.name}」`);
  };

  /** 当前 App 下与现有装扮完全一致的方案 = 使用中 */
  const activeSchemeId = useMemo(() => {
    const cur = JSON.stringify(appStyle);
    return schemes.find((s) => s.app === app && JSON.stringify(s.style) === cur)?.id ?? null;
  }, [schemes, appStyle]);

  return (
    <IOSScreen className="bg-gradient-to-b from-[#F5F6FA] via-[#EFF1F7] to-[#EAEDF5] dark:from-[#171920] dark:via-[#141519] dark:to-[#0F1014]">
      <IOSNavBar
        title="气泡样式"
        inline
        left={<IOSBackButton onClick={onBack} />}
        right={
          <span
            className="rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold"
            style={{ backgroundColor: meta.accentSoft, color: meta.accent }}
          >
            {meta.name}
          </span>
        }
        className="!bg-transparent"
      />
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-10">
        {/* ---------- 1. 实时预览卡片 ---------- */}
        <section aria-label="实时预览" className="relative mt-2 overflow-hidden rounded-[22px] shadow-[0_8px_28px_rgba(31,35,41,0.12)] ring-1 ring-white/70 backdrop-blur-xl dark:ring-white/10">
          <div className="absolute inset-0 bg-gradient-to-br from-[#E8ECF5] to-[#DBE2F0] dark:from-[#242833] dark:to-[#1A1D26]" />
          <AuraLayer />
          <div className="relative p-4">
            <div className="mb-3 flex items-center justify-center">
              <span className="rounded-full bg-white/65 px-3 py-[3px] text-[11px] font-medium tracking-wide text-black/55 ring-1 ring-white/70 backdrop-blur-md dark:bg-white/10 dark:text-white/65 dark:ring-white/15">
                实时预览 · 修改立即生效
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {PREVIEW_MESSAGES.map((m, i) => (
                <div key={i} className={m.side === 'mine' ? 'self-end' : 'self-start'}>
                  <PreviewRow app={app} cfg={bubbleStyle} side={m.side} index={i} text={m.text} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- 2. 气泡样式（不分 TA/我 · 微信/QQ 隔离） ---------- */}
        <section aria-label="气泡样式" className="mt-5">
          <div className="mb-2.5 flex items-baseline justify-between px-1">
            <p className="text-[13.5px] font-semibold">气泡样式</p>
            <p className="text-[11px] text-muted-foreground">{meta.name}与{app === 'wx' ? 'QQ' : '微信'}装扮相互独立</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(BUBBLE_KIND_LABEL) as BubbleStyleKind[]).map((kind) => {
              const selected = appStyle.kind === kind;
              const Icon = KIND_ICONS[kind];
              // 每格迷你预览配置：展示「若应用此样式」的效果（样式对两侧同时生效）
              const previewCfg: BubbleStyleConfig = {
                ...bubbleStyle,
                [app]: { kind, mineColor: appStyle.mineColor, theirsColor: appStyle.theirsColor },
              };
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    patchAppStyle({ kind });
                    try {
                      navigator.vibrate?.(6);
                    } catch {
                      /* 震动不可用 */
                    }
                  }}
                  aria-pressed={selected}
                  className={`relative overflow-hidden rounded-[18px] bg-white/70 p-3 text-left ring-1 backdrop-blur-xl transition-all active:scale-[0.97] dark:bg-white/[0.07] ${
                    selected ? 'ring-2' : 'ring-white/70 hover:ring-white dark:ring-white/10'
                  }`}
                  style={selected ? { boxShadow: `0 6px 20px ${meta.accentSoft}`, ['--tw-ring-color' as string]: meta.accent } : undefined}
                >
                  <div className="relative mb-2.5 flex h-[56px] items-center gap-1.5 overflow-hidden rounded-[12px] bg-gradient-to-br from-[#EAEEF7] to-[#DDE4F2] px-2 dark:from-[#272B36] dark:to-[#1D212B]">
                    <AuraLayer />
                    {/* 迷你对话：TA 一条 + 我一条（两侧同享此样式） */}
                    <div className="relative flex w-full items-center justify-between gap-1">
                      <PreviewBubble app={app} cfg={previewCfg} side="theirs" index={0}>
                        哈喽
                      </PreviewBubble>
                      <PreviewBubble app={app} cfg={previewCfg} side="mine" index={1}>
                        {kind === 'rainbow' ? '变色啦' : '你好呀'}
                      </PreviewBubble>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <span className="text-[14.5px] font-semibold leading-tight">{BUBBLE_KIND_LABEL[kind]}</span>
                    {selected && <Check className="ml-auto h-4 w-4" style={{ color: meta.accent }} aria-hidden="true" />}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* ---------- 3. 自定义颜色（分侧：我的 / TA的） ---------- */}
        <section
          aria-label="自定义颜色"
          className={`mt-5 rounded-[20px] bg-white/70 p-4 ring-1 ring-white/70 backdrop-blur-xl transition-opacity dark:bg-white/[0.07] dark:ring-white/10 ${
            kindDisabled ? 'pointer-events-none opacity-45' : ''
          }`}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="shrink-0 text-[14px] font-semibold">自定义颜色</p>
            {/* 侧别切换（仅颜色分侧）：我的气泡 / TA的气泡 */}
            <div className="relative flex rounded-full bg-black/[0.06] p-[3px] dark:bg-white/10">
              {(['mine', 'theirs'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSide(k)}
                  aria-pressed={side === k}
                  className={`relative z-10 rounded-full px-3 py-[5px] text-[12px] font-semibold transition-colors ${
                    side === k ? 'text-white' : 'text-black/50 dark:text-white/55'
                  }`}
                >
                  {side === k && (
                    <motion.span
                      layoutId="bubble-color-side-pill"
                      className="absolute inset-0 rounded-full shadow-[0_2px_8px_rgba(31,35,41,0.18)]"
                      style={{ backgroundColor: meta.accent }}
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative">{k === 'mine' ? '我的' : 'TA的'}</span>
                </button>
              ))}
            </div>
            {currentColor ? (
              <button
                type="button"
                aria-label="恢复默认色"
                onClick={() => patchAppStyle(side === 'mine' ? { mineColor: undefined } : { theirsColor: undefined })}
                className="flex shrink-0 items-center gap-1 rounded-full bg-black/[0.06] px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground transition-colors active:bg-black/10 dark:bg-white/10 dark:active:bg-white/15"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                默认
              </button>
            ) : null}
          </div>

          {/* 当前色大预览 + HSL 三滑条 */}
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold shadow-inner ring-2 ring-white/70"
              style={{
                background: currentColor ?? fallbackHex,
                color:
                  (currentColor ?? fallbackHex).toUpperCase() === '#FFFFFF'
                    ? '#9CA3AF'
                    : yiqTextOn(currentColor ?? fallbackHex),
              }}
            >
              {(currentColor ?? fallbackHex).slice(1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1 space-y-2.5">
              <HslSlider
                label="色相"
                value={hsl.h}
                max={360}
                thumbColor={hslToHex(hsl.h, Math.max(hsl.s, 70), 55)}
                trackBackground="linear-gradient(90deg, #FF0000, #FFFF00 17%, #00FF00 33%, #00FFFF 50%, #0000FF 67%, #FF00FF 83%, #FF0000)"
                onChange={(h) => commitHsl(h, hsl.s, hsl.l)}
              />
              <HslSlider
                label="饱和度"
                value={hsl.s}
                max={100}
                thumbColor={currentColor ?? fallbackHex}
                trackBackground={`linear-gradient(90deg, ${hslToHex(hsl.h, 0, hsl.l)}, ${hslToHex(hsl.h, 100, hsl.l)})`}
                onChange={(s) => commitHsl(hsl.h, s, hsl.l)}
              />
              <HslSlider
                label="明度"
                value={hsl.l}
                max={100}
                thumbColor={currentColor ?? fallbackHex}
                trackBackground={`linear-gradient(90deg, #000000, ${hslToHex(hsl.h, hsl.s, 50)} 50%, #FFFFFF)`}
                onChange={(l) => commitHsl(hsl.h, hsl.s, l)}
              />
            </div>
          </div>

          {/* 预设色板 */}
          <div className="mt-4 grid grid-cols-12 gap-1.5" role="group" aria-label="预设颜色">
            {PRESET_SWATCHES.map((c) => {
              const selected = (currentColor ?? '').toUpperCase() === c;
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={`预设色 ${c}`}
                  aria-pressed={selected}
                  onClick={() => patchAppStyle(side === 'mine' ? { mineColor: c } : { theirsColor: c })}
                  className={`flex aspect-square items-center justify-center rounded-full ring-1 ring-black/10 transition-transform active:scale-90 dark:ring-white/15 ${
                    selected ? 'ring-2' : ''
                  }`}
                  style={{ backgroundColor: c, ...(selected ? { boxShadow: `0 0 0 2px ${meta.accent}` } : {}) }}
                >
                  {selected && <Check className="h-3 w-3" style={{ color: yiqTextOn(c) === '#000000' ? '#111111' : '#FFFFFF' }} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <p className="mt-2.5 px-0.5 text-[11px] text-muted-foreground">
            颜色分「{side === 'mine' ? '我的' : 'TA的'}」独立设置，互不影响
          </p>
          {kindDisabled && (
            <p className="mt-2 rounded-xl bg-black/[0.05] px-3 py-2 text-[12px] text-muted-foreground dark:bg-white/[0.07]">
              七彩气泡按消息顺序自动循环参考图 9 色，无需选色
            </p>
          )}
        </section>

        {/* ---------- 4. 保存当前设置 ---------- */}
        <button
          type="button"
          onClick={() => {
            setNameDraft('');
            setNaming(true);
          }}
          className="mt-5 w-full rounded-full py-3.5 text-[16px] font-semibold text-white shadow-[0_8px_24px_rgba(31,35,41,0.20)] transition-transform active:scale-[0.98]"
          style={{ background: `linear-gradient(135deg, ${meta.accent} 0%, ${meta.accent}D9 100%)` }}
        >
          保存当前设置
        </button>

        {/* ---------- 5. 我的气泡（收藏夹 · 含 App 徽标） ---------- */}
        <section aria-label="我的气泡收藏夹" className="mt-6">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-[13px] font-semibold text-muted-foreground">我的气泡 · {schemes.length} 套</p>
            {schemes.length > 0 && <span className="text-[11.5px] text-muted-foreground">点击卡片即可应用</span>}
          </div>
          {schemes.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-black/15 bg-white/40 p-6 text-center backdrop-blur-xl dark:border-white/15 dark:bg-white/[0.04]">
              <Palette className="mx-auto mb-2 h-6 w-6 text-muted-foreground/70" aria-hidden="true" />
              <p className="text-[13.5px] text-muted-foreground">还没有收藏的气泡方案</p>
              <p className="mt-1 text-[12px] text-muted-foreground/80">选好样式和颜色后，点上方「保存当前设置」命名收藏</p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {schemes.map((s) => {
                const active = s.id === activeSchemeId;
                const sMeta = PLATFORM_META[s.app];
                /** 缩略图预览配置：当前装扮 + 该方案覆盖其归属 App */
                const thumbCfg: BubbleStyleConfig = { ...bubbleStyle, [s.app]: s.style };
                return (
                  <li key={s.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`应用方案 ${s.name}`}
                      onClick={() => applyScheme(s)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          applyScheme(s);
                        }
                      }}
                      className={`relative flex cursor-pointer items-center gap-3 rounded-[16px] bg-white/70 p-3 ring-1 backdrop-blur-xl transition-all active:scale-[0.98] dark:bg-white/[0.07] ${
                        active ? 'ring-2' : 'ring-white/70 dark:ring-white/10'
                      }`}
                      style={active ? { ['--tw-ring-color' as string]: sMeta.accent } : undefined}
                    >
                      {/* 缩略图：迷你双泡（按方案归属 App 渲染） */}
                      <div className="relative flex h-[46px] w-[86px] shrink-0 items-center justify-between gap-1 overflow-hidden rounded-[12px] bg-gradient-to-br from-[#EAEEF7] to-[#DDE4F2] px-2 dark:from-[#272B36] dark:to-[#1D212B]">
                        <AuraLayer />
                        <PreviewBubble app={s.app} cfg={thumbCfg} side="theirs" index={0} className="!text-[10.5px] !px-1.5 !py-[3px]">
                          早
                        </PreviewBubble>
                        <PreviewBubble app={s.app} cfg={thumbCfg} side="mine" index={1} className="!text-[10.5px] !px-1.5 !py-[3px]">
                          呀
                        </PreviewBubble>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-[15px] font-semibold leading-tight">{s.name}</p>
                          {/* App 归属徽标 */}
                          <span
                            className="shrink-0 rounded-full px-1.5 py-[1px] text-[10px] font-semibold"
                            style={{ backgroundColor: sMeta.accentSoft, color: sMeta.accent }}
                          >
                            {sMeta.name}
                          </span>
                          {active && (
                            <span
                              className="shrink-0 rounded-full px-1.5 py-[1px] text-[10px] font-semibold text-white"
                              style={{ backgroundColor: sMeta.accent }}
                            >
                              使用中
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                          {BUBBLE_KIND_LABEL[s.style.kind]}
                          {s.style.mineColor ? ` · 我 ${s.style.mineColor}` : ''}
                          {s.style.theirsColor ? ` · TA ${s.style.theirsColor}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          aria-label={`应用 ${s.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            applyScheme(s);
                          }}
                          className="flex items-center gap-0.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-white transition-transform active:scale-95"
                          style={{ backgroundColor: sMeta.accent }}
                        >
                          应用
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label={`删除 ${s.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeScheme(s);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] text-black/45 transition-colors active:bg-[#FF3B30]/15 active:text-[#FF3B30] dark:bg-white/10 dark:text-white/50 dark:active:text-[#FF6B6B]"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* ---------- 命名弹窗（毛玻璃胶囊卡） ---------- */}
      <AnimatePresence>
        {naming && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm"
            onClick={() => setNaming(false)}
            role="dialog"
            aria-label="命名这套气泡"
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0, y: 8 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="w-full max-w-[300px] rounded-[22px] bg-white/85 p-5 shadow-2xl ring-1 ring-white/70 backdrop-blur-2xl dark:bg-[#26272E]/90 dark:ring-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-center text-[16.5px] font-bold">给这套气泡起个名字</p>
              <p className="mt-1 text-center text-[12px] text-muted-foreground">保存到{meta.name}装扮 · 可随时一键应用</p>
              {/* 迷你效果预览 */}
              <div className="relative mt-3 flex items-center justify-center gap-1.5 overflow-hidden rounded-[12px] bg-gradient-to-br from-[#EAEEF7] to-[#DDE4F2] px-3 py-2.5 dark:from-[#272B36] dark:to-[#1D212B]">
                <AuraLayer />
                <PreviewBubble app={app} cfg={bubbleStyle} side="theirs" index={0}>
                  早安
                </PreviewBubble>
                <PreviewBubble app={app} cfg={bubbleStyle} side="mine" index={1}>
                  你也早安
                </PreviewBubble>
              </div>
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveScheme();
                }}
                maxLength={16}
                placeholder="比如：我的天蓝专属"
                aria-label="方案名称"
                className="mt-3.5 w-full rounded-full bg-black/[0.05] px-4 py-2.5 text-center text-[15px] outline-none ring-1 ring-black/[0.06] transition-shadow placeholder:text-muted-foreground/70 focus:ring-2 dark:bg-white/10 dark:ring-white/10"
                style={{ ['--tw-ring-color' as string]: meta.accent }}
              />
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setNaming(false)}
                  className="flex-1 rounded-full bg-black/[0.06] py-2.5 text-[15px] font-semibold text-black/70 transition-colors active:bg-black/10 dark:bg-white/10 dark:text-white/75 dark:active:bg-white/15"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={saveScheme}
                  className="flex-1 rounded-full py-2.5 text-[15px] font-semibold text-white shadow-md transition-transform active:scale-95"
                  style={{ backgroundColor: meta.accent }}
                >
                  保存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </IOSScreen>
  );
}
