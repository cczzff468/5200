'use client';

/**
 * 聊天气泡装扮设置页（第十七轮建立 · 第十八轮重构 · 第二十轮毛玻璃胶囊化）——微信 / QQ / 信息 三 App 共用、装扮隔离
 * ---------------------------------------------------------------------------
 * 入口：QQ 个人抽屉 › 个性装扮；微信 发现页 › 看一看 › 聊天气泡装扮；
 *       信息 App › 聊天设置 › 主题（气泡样式与颜色）。
 *
 * 结构：
 *  1. 实时预览卡片（四条模拟消息，所见即所得）
 *  2. 气泡样式四格：默认 / 七彩 / 毛玻璃 / 液态 —— 不分 TA/我，样式对两侧同时生效
 *  3. 自定义颜色（这里才分侧）：【一起 / 我的 / TA的】切换 + HSL 三滑条 + 预设色板
 *  4. 【保存当前设置】→ 命名弹窗 → 存入收藏夹（方案归属当前 App）
 *  5. 收藏夹：缩略卡点击应用
 *
 * 视觉（第二十轮 · 用户指定「简约 + 毛玻璃胶囊」）：
 *  - 页面铺低饱和柔彩光斑（AmbientBackdrop，blur-3xl），给毛玻璃提供可模糊的底色；
 *  - 所有卡片 / 分段切换 / 收藏夹行 / 弹窗 = 半透明白 + backdrop-blur + 发丝白描边
 *    （深色模式白 7% + 白 12% 描边），导航栏透明化只留 blur —— 整页玻璃材质；
 *  - 胶囊语言：小标题玻璃 chip、分段切换胶囊、保存/应用/取消/输入框胶囊、
 *    收藏夹整行大胶囊（rounded-full）、命名弹窗预览幕布胶囊；
 *  - 克制：无重阴影无花哨渐变，选中态仅 accent 描边 + 一抹柔光。
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
  withAlpha,
  yiqTextOn,
  type BubbleAppId,
  type BubbleAppStyle,
  type BubbleScheme,
  type BubbleStyleConfig,
  type BubbleStyleKind,
} from '@/lib/ios/bubble-style';

export interface BubbleStylePageProps {
  /** 宿主 App（装扮完全隔离：本页所有修改只写入 cfg[app]） */
  app: BubbleAppId;
  /** 返回上一级 */
  onBack: () => void;
  /** 弹一条本地提示 */
  onToast: (m: string) => void;
}

const PLATFORM_META: Record<BubbleAppId, { name: string; accent: string; accentSoft: string }> = {
  wx: { name: '微信', accent: '#07C160', accentSoft: 'rgba(7, 193, 96, 0.14)' },
  qq: { name: 'QQ', accent: '#0099FF', accentSoft: 'rgba(0, 153, 255, 0.14)' },
  sms: { name: '信息', accent: '#007AFF', accentSoft: 'rgba(0, 122, 255, 0.14)' },
};

/** 样式四格的图标 */
const KIND_ICONS: Record<BubbleStyleKind, typeof Palette> = {
  default: Palette,
  rainbow: Sparkles,
  frosted: GlassWater,
  liquid: Waves,
};

/** 样式副标题（简短说明各自质感，帮助区分毛玻璃/液态） */
const KIND_CAPTIONS: Record<BubbleStyleKind, string> = {
  default: '纯色 · 可自选颜色',
  rainbow: '九色 · 按消息循环',
  frosted: '奶白磨砂 · 隐约透底',
  liquid: '清透水膜 · 透底',
};

/** 毛玻璃卡公共材质（圆角/描边由各处按形状自行叠加） */
const GLASS = 'bg-white/55 backdrop-blur-xl dark:bg-white/[0.07]';

// ---------------- 页面级柔彩光斑（毛玻璃的「底」，滚动时卡片将其晕开） ----------------

/** 低饱和大光斑四枚：淡青 / 淡粉紫 / 淡绿 / 淡黄，铺在页面最底层 */
function AmbientBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <span className="absolute -left-24 -top-20 h-72 w-72 rounded-full bg-[#9BC8FF]/35 blur-3xl dark:bg-[#5B8DEF]/20" />
      <span className="absolute -right-28 top-1/4 h-80 w-80 rounded-full bg-[#F5B8E4]/28 blur-3xl dark:bg-[#B46BD1]/15" />
      <span className="absolute -left-20 top-[52%] h-64 w-64 rounded-full bg-[#A7F3D0]/25 blur-3xl dark:bg-[#4FC08D]/12" />
      <span className="absolute -bottom-24 left-1/3 h-72 w-72 rounded-full bg-[#FDE68A]/25 blur-3xl dark:bg-[#E8C46B]/12" />
    </div>
  );
}

// ---------------- 迷你预览气泡（与聊天页同一渲染引擎，所见即所得） ----------------

/** 彩色光斑层：垫在毛玻璃/液态泡下面，让 backdrop-filter 的模糊效果肉眼可见（轻量淡彩） */
function AuraLayer() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <span className="absolute -left-4 top-2 h-16 w-16 rounded-full bg-[#FF9500]/35 blur-2xl" />
      <span className="absolute right-6 top-6 h-14 w-14 rounded-full bg-[#34C759]/35 blur-2xl" />
      <span className="absolute bottom-0 left-1/3 h-16 w-16 rounded-full bg-[#AF52DE]/30 blur-2xl" />
      <span className="absolute -right-2 bottom-2 h-14 w-14 rounded-full bg-[#3D9BFF]/30 blur-2xl" />
    </div>
  );
}

/** 单条迷你预览气泡：override 时用装扮样式，否则 App 原生配色
 *  （尾巴跟随 bubbleVisual：QQ 纯色/七彩 = 弯钩——与预览行头像圆点（26px，items-end
 *   底对齐）顶端平行，top = max(0px, calc(100% - 32.5px)) → 尾巴中心 = 头像点顶端线上
 *   （26 + 6.5 = 32.5）；微信/信息 = 原生小方块随色；胶囊无尾巴） */
function PreviewBubble({
  app,
  cfg,
  side,
  index,
  children,
  className = '',
}: {
  app: BubbleAppId;
  cfg: BubbleStyleConfig;
  side: 'mine' | 'theirs';
  index: number;
  children: React.ReactNode;
  className?: string;
}) {
  const vis = bubbleVisual(side, cfg, index, app);
  const native = side === 'mine' ? NATIVE_BUBBLE[app].mine : NATIVE_BUBBLE[app].theirs;
  const nativeText = side === 'mine' && app !== 'wx' ? 'text-white' : 'text-black';
  // 原生圆角与各端文本气泡同规格：微信 5px / QQ 10px / 信息 18px（iMessage 大圆角）
  const nativeRadius = app === 'sms' ? 'rounded-[18px]' : app === 'qq' ? 'rounded-[10px]' : 'rounded-[5px]';
  return (
    <div
      className={`relative w-fit max-w-full whitespace-pre-wrap break-words ${nativeRadius} px-2.5 py-[7px] text-[12.5px] leading-[1.45] ${
        vis.override ? vis.className : nativeText
      } ${className}`}
      style={vis.override ? vis.style : { backgroundColor: native }}
    >
      {vis.tail === 'hook' && <BubbleTail side={side} color={vis.tailColor} top="max(0px, calc(100% - 32.5px))" />}
      {vis.tail === 'native' && app !== 'qq' && (
        <span
          aria-hidden="true"
          className={`absolute top-[7px] h-[6px] w-[6px] rotate-45 ${side === 'mine' ? '-right-[2px]' : '-left-[2px]'}`}
          style={{ backgroundColor: vis.tailColor || native }}
        />
      )}
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
  app: BubbleAppId;
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
        className={`z-[1] flex h-[26px] w-[26px] shrink-0 select-none items-center justify-center rounded-full text-[10px] font-semibold text-white ring-1 ring-white/40 ${
          side === 'mine' ? '' : 'bg-gradient-to-br from-[#F0A0B8] to-[#C86DD7]'
        }`}
        style={side === 'mine' ? { background: meta.accent } : undefined}
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

// ---------------- HSL 滑条（全色彩盘三杆 · 玻璃轨道胶囊） ----------------

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
      {/* 玻璃轨道胶囊：渐变底 + 白发丝描边 + 顶部内高光（糖珠质感） */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 h-3.5 -translate-y-1/2 rounded-full ring-1 ring-white/55 shadow-[inset_0_1px_1px_rgba(255,255,255,0.45),inset_0_-1px_2px_rgba(0,0,0,0.10)] dark:ring-white/[0.14]"
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
          [&::-webkit-slider-thumb]:h-[22px] [&::-webkit-slider-thumb]:w-[22px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-[0_2px_6px_rgba(0,0,0,0.24)]
          [&::-moz-range-thumb]:h-[22px] [&::-moz-range-thumb]:w-[22px] [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-[0_2px_6px_rgba(0,0,0,0.24)]"
      />
    </div>
  );
}

// ---------------- 玻璃小 chip（区块标题胶囊） ----------------

function GlassChip({ icon: Icon, children }: { icon: typeof Palette; children: React.ReactNode }) {
  return (
    <p className="mb-2.5 flex w-fit items-center gap-1.5 rounded-full bg-white/50 px-3 py-1 text-[11.5px] font-semibold text-black/50 ring-1 ring-white/60 backdrop-blur-md dark:bg-white/[0.08] dark:text-white/55 dark:ring-white/[0.12]">
      <Icon className="h-3 w-3" aria-hidden="true" />
      {children}
    </p>
  );
}

// ---------------- 主设置页 ----------------

export function BubbleStylePage({ app, onBack, onToast }: BubbleStylePageProps) {
  const meta = PLATFORM_META[app];
  const bubbleStyle = useSettings((s) => s.bubbleStyle);
  const schemes = useSettings((s) => s.bubbleSchemes);
  const setBubbleStyle = useSettings((s) => s.setBubbleStyle);
  const setBubbleSchemes = useSettings((s) => s.setBubbleSchemes);

  /** 自定义颜色编辑目标：both=两侧一起改 / mine=我的 / theirs=TA的（仅颜色分侧；样式对两侧同时生效） */
  const [side, setSide] = useState<'both' | 'mine' | 'theirs'>('mine');
  /** 命名弹窗 */
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  /** 当前 App 的装扮（微信/QQ 隔离：只读写 bubbleStyle[app]） */
  const appStyle: BubbleAppStyle = bubbleStyle[app] ?? { kind: 'default' };
  const kindDisabled = appStyle.kind === 'rainbow';
  /** 当前编辑目标展示色：both 优先取我的（未设时回退 TA 的） */
  const currentColor =
    side === 'both'
      ? appStyle.mineColor ?? appStyle.theirsColor
      : side === 'mine'
        ? appStyle.mineColor
        : appStyle.theirsColor;
  /** 无自定义色时滑条落在 App 原生默认色位置（拖动任意一杆立即生成自定义色落地） */
  const fallbackHex = NATIVE_BUBBLE[app][side === 'theirs' ? 'theirs' : 'mine'];
  const hsl = useMemo(() => hexToHsl(currentColor ?? fallbackHex), [currentColor, fallbackHex]);

  /** 修改当前 App 的装扮（另一个 App 原样保留 —— 装扮隔离） */
  const patchAppStyle = (patch: Partial<BubbleAppStyle>) => {
    setBubbleStyle({
      ...bubbleStyle,
      [app]: { ...appStyle, ...patch },
    });
  };

  /** 写入颜色到编辑目标（both = 两侧同步写） */
  const commitColor = (hex: string) => {
    if (side === 'both') patchAppStyle({ mineColor: hex, theirsColor: hex });
    else if (side === 'mine') patchAppStyle({ mineColor: hex });
    else patchAppStyle({ theirsColor: hex });
  };

  /** 滑条拖动：实时合成 hex 写入编辑目标（预览卡/聊天页即时跟随） */
  const commitHsl = (h: number, s: number, l: number) => {
    commitColor(hslToHex(h, s, l));
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
    onToast(`已保存「${name}」`);
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
    <IOSScreen className="bg-[#EDF0F6] dark:bg-[#0E1013]">
      {/* 页面底光斑：半透明导航栏与所有毛玻璃卡都把它晕成柔彩 */}
      <AmbientBackdrop />
      {/* 标题居中（用户指定）；导航栏去底色只留 blur = 顶部玻璃条。
          信息 App 入口名为「主题」，页题与入口一致；微信/QQ 保持「气泡样式」 */}
      <IOSNavBar
        title={app === 'sms' ? '主题' : '气泡样式'}
        large={false}
        left={<IOSBackButton onClick={onBack} label="" />}
        className="bg-transparent! dark:bg-transparent!"
      />
      <div className="no-scrollbar relative flex-1 overflow-y-auto px-4 pb-12">
        {/* ---------- 1. 实时预览（玻璃外壳 + 内嵌聊天幕布） ---------- */}
        <section
          aria-label="实时预览"
          className={`relative mt-2 rounded-[26px] ${GLASS} ring-1 ring-white/60 dark:ring-white/[0.12]`}
        >
          <div className="relative m-2 overflow-hidden rounded-[20px] ring-1 ring-black/[0.04] dark:ring-white/[0.05]">
            <div className="absolute inset-0 bg-gradient-to-b from-[#E5EAF3] to-[#D8DFEB] dark:from-[#252A38] dark:to-[#191D28]" />
            <AuraLayer />
            <div className="relative flex flex-col gap-2.5 px-4 py-5">
              {PREVIEW_MESSAGES.map((m, i) => (
                <div key={i} className={m.side === 'mine' ? 'self-end' : 'self-start'}>
                  <PreviewRow app={app} cfg={bubbleStyle} side={m.side} index={i} text={m.text} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- 2. 气泡样式四格（不分 TA/我） ---------- */}
        <section aria-label="气泡样式" className="mt-6">
          <GlassChip icon={Palette}>样式</GlassChip>
          <div className="grid grid-cols-2 gap-2.5">
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
                  className={`rounded-[24px] ${GLASS} p-2.5 text-left ring-1 transition-all active:scale-[0.97] ${
                    selected
                      ? 'ring-2'
                      : 'ring-white/55 hover:ring-white/80 dark:ring-white/[0.10] dark:hover:ring-white/[0.16]'
                  }`}
                  style={
                    selected
                      ? {
                          ['--tw-ring-color' as string]: meta.accent,
                          boxShadow: `0 10px 28px ${withAlpha(meta.accent, 0.22)}`,
                        }
                      : undefined
                  }
                >
                  <div className="relative mb-2 flex h-[54px] items-center gap-1.5 overflow-hidden rounded-[18px] bg-gradient-to-br from-[#E9EDF5] to-[#DFE5F0] px-2 ring-1 ring-white/40 dark:from-[#272C3A] dark:to-[#1D2230] dark:ring-white/[0.06]">
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
                  <div className="flex items-center gap-2 px-0.5">
                    {/* 图标：小圆玻璃底；选中 = accent 柔光玻璃 */}
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full backdrop-blur-md ${
                        selected ? '' : 'bg-white/55 ring-1 ring-white/60 dark:bg-white/[0.09] dark:ring-white/[0.12]'
                      }`}
                      style={selected ? { backgroundColor: withAlpha(meta.accent, 0.16) } : undefined}
                    >
                      <Icon
                        className={`h-[15px] w-[15px] ${selected ? '' : 'text-black/40 dark:text-white/40'}`}
                        style={selected ? { color: meta.accent } : undefined}
                        aria-hidden="true"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold leading-tight">{BUBBLE_KIND_LABEL[kind]}</span>
                      <span className="mt-[1px] block truncate text-[10.5px] leading-tight text-black/40 dark:text-white/40">
                        {KIND_CAPTIONS[kind]}
                      </span>
                    </span>
                    {selected && <Check className="h-4 w-4 shrink-0" style={{ color: meta.accent }} aria-hidden="true" />}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* ---------- 3. 自定义颜色（仅颜色分侧：一起 / 我的 / TA的） ---------- */}
        <section
          aria-label="自定义颜色"
          className={`mt-4 rounded-[24px] ${GLASS} p-4 ring-1 transition-opacity ${
            kindDisabled ? 'pointer-events-none opacity-40 ring-white/55 dark:ring-white/[0.10]' : 'ring-white/60 dark:ring-white/[0.12]'
          }`}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="shrink-0 text-[13px] font-semibold text-black/80 dark:text-white/80">颜色</p>
            {/* 编辑目标三段切换：玻璃胶囊壳 + 白玻璃选中 pill（iOS 分段风） */}
            <div className="relative flex rounded-full bg-white/40 p-[3px] ring-1 ring-white/60 backdrop-blur-md dark:bg-white/[0.08] dark:ring-white/[0.12]">
              {(['both', 'mine', 'theirs'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSide(k)}
                  aria-pressed={side === k}
                  className={`relative z-10 rounded-full px-3 py-[5px] text-[12px] font-semibold transition-colors ${
                    side === k
                      ? 'text-black/80 shadow-[0_2px_8px_rgba(0,0,0,0.10)] dark:text-white'
                      : 'text-black/45 dark:text-white/50'
                  }`}
                >
                  {side === k && (
                    <motion.span
                      layoutId="bubble-color-side-pill"
                      className="absolute inset-0 rounded-full bg-white/90 ring-1 ring-black/[0.03] dark:bg-white/20 dark:ring-white/10"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative">{k === 'both' ? '一起' : k === 'mine' ? '我的' : 'TA的'}</span>
                </button>
              ))}
            </div>
            {(side === 'both' ? appStyle.mineColor || appStyle.theirsColor : currentColor) ? (
              <button
                type="button"
                aria-label="恢复默认色"
                onClick={() =>
                  patchAppStyle(
                    side === 'both'
                      ? { mineColor: undefined, theirsColor: undefined }
                      : side === 'mine'
                        ? { mineColor: undefined }
                        : { theirsColor: undefined },
                  )
                }
                className="flex shrink-0 items-center gap-1 rounded-full bg-white/45 px-2.5 py-1 text-[11.5px] font-medium text-black/50 ring-1 ring-white/60 backdrop-blur-md transition-colors active:bg-white/70 dark:bg-white/[0.08] dark:text-white/55 dark:ring-white/[0.12] dark:active:bg-white/15"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                默认
              </button>
            ) : null}
          </div>

          {/* 当前色预览（糖珠高光） + HSL 三滑条 */}
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ring-1 ring-white/45 shadow-[inset_0_1px_2px_rgba(255,255,255,0.40),0_4px_12px_rgba(20,24,34,0.12)] dark:ring-white/20"
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

          {/* 预设色板（糖珠色点） */}
          <div className="mt-3.5 grid grid-cols-12 gap-1.5" role="group" aria-label="预设颜色">
            {PRESET_SWATCHES.map((c) => {
              const selected = (currentColor ?? '').toUpperCase() === c;
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={`预设色 ${c}`}
                  aria-pressed={selected}
                  onClick={() => commitColor(c)}
                  className={`flex aspect-square items-center justify-center rounded-full transition-transform active:scale-90 ${
                    selected ? 'ring-2 ring-white/90 dark:ring-white/80' : 'ring-1 ring-black/10 dark:ring-white/15'
                  }`}
                  style={{
                    backgroundColor: c,
                    boxShadow: selected
                      ? `0 0 0 2px ${meta.accent}, inset 0 1px 1px rgba(255,255,255,0.40)`
                      : 'inset 0 1px 1px rgba(255,255,255,0.40)',
                  }}
                >
                  {selected && (
                    <Check
                      className="h-3 w-3"
                      style={{ color: yiqTextOn(c) === '#000000' ? '#111111' : '#FFFFFF' }}
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
          {kindDisabled && (
            <p className="mt-3 text-[12px] text-black/40 dark:text-white/40">
              七彩气泡按消息顺序自动循环 9 色，无需选色
            </p>
          )}
        </section>

        {/* ---------- 4. 保存当前设置（accent 玻璃糖果胶囊） ---------- */}
        <button
          type="button"
          onClick={() => {
            setNameDraft('');
            setNaming(true);
          }}
          className="mt-5 w-full rounded-full py-3 text-[15.5px] font-semibold text-white ring-1 ring-white/35 transition-transform active:scale-[0.98]"
          style={{
            backgroundColor: meta.accent,
            boxShadow: `0 8px 22px ${withAlpha(meta.accent, 0.35)}, inset 0 1px 0 rgba(255,255,255,0.28)`,
          }}
        >
          保存当前设置
        </button>

        {/* ---------- 5. 收藏夹（整行大胶囊） ---------- */}
        <section aria-label="我的气泡收藏夹" className="mt-6">
          <GlassChip icon={Sparkles}>我的气泡</GlassChip>
          {schemes.length === 0 ? (
            <div
              className={`rounded-full border border-dashed border-black/15 ${GLASS} px-8 py-5 text-center dark:border-white/15`}
            >
              <Palette className="mx-auto mb-1.5 h-5 w-5 text-black/25 dark:text-white/25" aria-hidden="true" />
              <p className="text-[13px] text-black/40 dark:text-white/40">还没有收藏的气泡方案</p>
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
                      className={`flex cursor-pointer items-center gap-3 rounded-full ${GLASS} p-2 pl-2 ring-1 transition-all active:scale-[0.98] ${
                        active
                          ? 'ring-2'
                          : 'ring-white/55 hover:ring-white/80 dark:ring-white/[0.10] dark:hover:ring-white/[0.16]'
                      }`}
                      style={
                        active
                          ? {
                              ['--tw-ring-color' as string]: sMeta.accent,
                              boxShadow: `0 8px 24px ${withAlpha(sMeta.accent, 0.20)}`,
                            }
                          : undefined
                      }
                    >
                      {/* 缩略图：胶囊幕布 + 迷你双泡（按方案归属 App 渲染） */}
                      <div className="relative flex h-[44px] w-[84px] shrink-0 items-center justify-between gap-1 overflow-hidden rounded-full bg-gradient-to-br from-[#E9EDF4] to-[#DCE3EF] px-2.5 ring-1 ring-white/40 dark:from-[#272C3A] dark:to-[#1D2230] dark:ring-white/[0.06]">
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
                          <p className="truncate text-[14.5px] font-semibold leading-tight">{s.name}</p>
                          {active && (
                            <span
                              className="shrink-0 rounded-full px-1.5 py-[1px] text-[10px] font-semibold text-white ring-1 ring-white/35"
                              style={{ backgroundColor: sMeta.accent }}
                            >
                              使用中
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[11.5px] text-black/40 dark:text-white/40">
                          {BUBBLE_KIND_LABEL[s.style.kind]}
                          {s.style.mineColor ? ` · 我 ${s.style.mineColor}` : ''}
                          {s.style.theirsColor ? ` · TA ${s.style.theirsColor}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 pr-1">
                        <button
                          type="button"
                          aria-label={`应用 ${s.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            applyScheme(s);
                          }}
                          className="flex items-center gap-0.5 rounded-full px-2.5 py-1.5 text-[12px] font-semibold text-white ring-1 ring-white/35 transition-transform active:scale-95"
                          style={{
                            backgroundColor: sMeta.accent,
                            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25)`,
                          }}
                        >
                          应用
                          <ChevronRight className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label={`删除 ${s.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeScheme(s);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-full text-black/35 transition-colors active:bg-[#FF3B30]/12 active:text-[#FF3B30] dark:text-white/40 dark:active:text-[#FF6B6B]"
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

      {/* ---------- 命名弹窗（毛玻璃卡 + 玻璃胶囊控件） ---------- */}
      <AnimatePresence>
        {naming && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6 backdrop-blur-sm"
            onClick={() => setNaming(false)}
            role="dialog"
            aria-label="命名这套气泡"
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 6 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="w-full max-w-[300px] rounded-[26px] bg-white/75 p-5 shadow-2xl ring-1 ring-white/60 backdrop-blur-2xl dark:bg-[#1F2126]/80 dark:ring-white/[0.12]"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-center text-[16px] font-bold">给这套气泡起个名字</p>
              {/* 迷你效果预览：胶囊幕布 */}
              <div className="relative mt-3 flex items-center justify-center gap-1.5 overflow-hidden rounded-full bg-[#E9EDF4] px-4 py-2.5 ring-1 ring-white/40 dark:bg-[#252932] dark:ring-white/[0.08]">
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
                className="mt-3 w-full rounded-full bg-white/55 px-4 py-2.5 text-center text-[15px] outline-none ring-1 ring-white/70 transition-shadow placeholder:text-black/30 focus:ring-2 dark:bg-white/[0.08] dark:ring-white/[0.12] dark:placeholder:text-white/30"
                style={{ ['--tw-ring-color' as string]: meta.accent }}
              />
              <div className="mt-4 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setNaming(false)}
                  className="flex-1 rounded-full bg-white/55 py-2.5 text-[15px] font-semibold text-black/60 ring-1 ring-white/60 backdrop-blur-md transition-colors active:bg-white/75 dark:bg-white/[0.08] dark:text-white/70 dark:ring-white/[0.12] dark:active:bg-white/15"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={saveScheme}
                  className="flex-1 rounded-full py-2.5 text-[15px] font-semibold text-white ring-1 ring-white/35 transition-transform active:scale-95"
                  style={{
                    backgroundColor: meta.accent,
                    boxShadow: `0 6px 16px ${withAlpha(meta.accent, 0.30)}, inset 0 1px 0 rgba(255,255,255,0.28)`,
                  }}
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
