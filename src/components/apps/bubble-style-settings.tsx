'use client';

/**
 * 聊天气泡装扮设置页（第十七轮建立 · 第二十一轮整页删除重做）——微信 / QQ / 信息 三 App 共用、装扮隔离
 * ---------------------------------------------------------------------------
 * 入口：QQ 个人抽屉 › 个性装扮；微信 发现页 › 看一看 › 聊天气泡装扮；
 *       信息 App › 聊天设置 › 主题（气泡样式与颜色）。
 *
 * 功能（与历轮一致，本轮未动）：
 *  1. 实时预览卡片（四条模拟消息，所见即所得）
 *  2. 气泡样式四格：默认 / 七彩 / 毛玻璃 / 液态 —— 不分 TA/我，样式对两侧同时生效
 *  3. 自定义颜色（这里才分侧）：【一起 / 我的 / TA的】切换 + HSL 三滑条 + 预设色板
 *  4. 【保存当前设置】→ 命名弹窗 → 存入收藏夹（方案归属当前 App）
 *  5. 收藏夹：胶囊行点击应用
 *
 * 排版规范（第二十一轮删除重做 · 第二十二轮删底层光斑）：仅玻璃卡/胶囊/弱标题
 *  三元素，圆角两档（卡 22px / 控件 full）、区块 space-y-7 统一节奏；
 *  - 页面底为纯色（用户指定删除底层柔彩大光斑）：玻璃卡在纯色底上保留半透白 +
 *    模糊 + 发丝描边的克制玻璃质感；
 *  - 预览幕布/示意条内的功能性光斑（AuraLayer）保留——磨砂/液态泡效果必需；
 *  - 选中态只靠 accent 描边 + 勾选符号表达，无阴影无发光。
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronRight, Palette, RotateCcw, Trash2 } from 'lucide-react';
import { IOSBackButton, IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { BubbleTail } from '@/components/apps/bubble-tail';
import { useSettings } from '@/lib/ios/store';
import {
  BUBBLE_KIND_LABEL,
  BUBBLE_THEME_LABEL,
  THEMES_OF_APP,
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
  type BubbleTheme,
} from '@/lib/ios/bubble-style';

export interface BubbleStylePageProps {
  /** 宿主 App（装扮完全隔离：本页所有修改只写入 cfg[app]） */
  app: BubbleAppId;
  /** 返回上一级 */
  onBack: () => void;
  /** 弹一条本地提示 */
  onToast: (m: string) => void;
}

const PLATFORM_META: Record<BubbleAppId, { name: string; accent: string }> = {
  wx: { name: '微信', accent: '#07C160' },
  qq: { name: 'QQ', accent: '#0099FF' },
  sms: { name: '信息', accent: '#007AFF' },
};

/** 样式副标题（简短说明各自质感，帮助区分毛玻璃/液态） */
const KIND_CAPTIONS: Record<BubbleStyleKind, string> = {
  default: '纯色 · 可自选颜色',
  rainbow: '九色 · 按消息循环',
  frosted: '奶白磨砂 · 隐约透底',
  liquid: '清透水膜 · 透底',
};

/** 玻璃卡（统一材质；圆角 22px） */
const GLASS_CARD =
  'rounded-[22px] bg-white/60 backdrop-blur-xl ring-1 ring-white/70 dark:bg-white/[0.06] dark:ring-white/[0.14]';

/** 弱文字小标题（区块标签，非装饰） */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 text-[12.5px] font-semibold tracking-wide text-black/40 dark:text-white/40">{children}</p>
  );
}

// ---------------- 迷你预览气泡（与聊天页同一渲染引擎，所见即所得） ----------------

/** 彩色光斑层：垫在毛玻璃/液态泡下面，让 backdrop-filter 的模糊效果肉眼可见（功能性，非装饰） */
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
 *   底对齐）顶端平行，top = max(0px, calc(100% - 32.5px))；微信/信息 = 原生小方块随色；胶囊无尾巴） */
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

/** 预览卡里的一行消息（带头像圆点） */
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
        className={`z-[1] flex h-[26px] w-[26px] shrink-0 select-none items-center justify-center rounded-full text-[10px] font-semibold text-white ${
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

// ---------------- 主题缩略图（第四十二轮：界面主题两格的迷你拟态图） ----------------

/** 主题缩略图：拟态各主题的页面质感——
 *  默认 = 现状（纯白实心卡 + 全宽贴底 TabBar）；
 *  液态 = 玻璃半透卡 + 悬浮胶囊 TabBar（复用 .lg-* 全局类，与真实主题同材质）；
 *  新版（第五十轮，信息 App）= iMessage 新版聊天界面——白底 + 居中大头像顶栏 +
 *  亮蓝/浅灰迷你气泡 + 白底输入胶囊（用户参考图同款） */
function ThemeThumb({ theme, accent }: { theme: BubbleTheme; accent: string }) {
  const liquid = theme === 'liquid';
  const fresh = theme === 'new';
  if (fresh) {
    /* 新版 iMessage：纯白聊天幕布，居中头像点 + 粗名字条 + iMessage 副标线；
       左右两枚迷你气泡（对方浅灰 / 我方亮蓝 #45B6FC——参考图实测色）；
       底部输入行 = 灰加号圆点 + 白胶囊（占位灰点） */
    return (
      <div className="relative h-[86px] overflow-hidden rounded-[17px] bg-white dark:bg-[#1C1C1E]">
        {/* mini 状态栏 */}
        <div className="flex items-center gap-1 px-2 pt-1.5">
          <span className="h-[3px] w-[8px] rounded-full bg-black/25 dark:bg-white/30" />
          <span className="mx-auto h-[3px] w-[16px] rounded-full bg-black/15 dark:bg-white/20" />
          <span className="h-[3px] w-[8px] rounded-full bg-black/25 dark:bg-white/30" />
        </div>
        {/* mini 居中头像 + 名字 + iMessage 副标 */}
        <div className="mt-[3px] flex flex-col items-center">
          <span className="h-[14px] w-[14px] rounded-full bg-black/20 dark:bg-white/25" />
          <span className="mt-[2px] h-[3px] w-[18px] rounded-full bg-black/70 dark:bg-white/80" />
          <span className="mt-[2px] h-[2px] w-[24px] rounded-full bg-black/20 dark:bg-white/25" />
        </div>
        {/* mini 气泡：对方浅灰（左） / 我方亮蓝（右，参考图实测 #45B6FC） */}
        <span className="absolute left-[10px] top-[46px] h-[7px] w-[30px] rounded-full bg-[#E9E9EB] dark:bg-[#2C2C2E]" />
        <span className="absolute right-[10px] top-[57px] h-[7px] w-[38px] rounded-full" style={{ background: '#45B6FC' }} />
        {/* mini 输入行：灰加号圆 + 白胶囊（占位灰点） */}
        <div className="absolute inset-x-[8px] bottom-[6px] flex h-[11px] items-center gap-[3px]">
          <span className="h-[10px] w-[10px] shrink-0 rounded-full bg-[#E9E9EB] dark:bg-white/15" />
          <span className="flex h-[10px] flex-1 items-center rounded-full bg-white px-[4px] shadow-[0_1px_3px_rgba(0,0,0,0.10)] dark:bg-white/[0.10]">
            <span className="h-[2px] w-[16px] rounded-full bg-black/20 dark:bg-white/25" />
          </span>
        </div>
      </div>
    );
  }
  return (
    <div
      className={`relative h-[86px] overflow-hidden rounded-[17px] ${
        liquid ? 'lg-root' : 'bg-[#EDEDED] dark:bg-[#111111]'
      }`}
    >
      {/* mini 顶栏（标题居中） */}
      <div className="flex items-center gap-1 px-2 pt-2">
        <span className="h-[3px] w-[10px] rounded-full bg-black/20 dark:bg-white/25" />
        <span className="mx-auto h-[3px] w-[22px] rounded-full bg-black/15 dark:bg-white/20" />
        <span className="h-[3px] w-[10px] rounded-full bg-black/20 dark:bg-white/25" />
      </div>
      {/* mini 内容卡：默认 = 纯白实心；液态 = 玻璃半透 + 发丝描边 */}
      <div
        className={`mx-1.5 mt-1.5 flex flex-col gap-[5px] p-[7px] ${
          liquid ? 'lg-card' : 'rounded-[6px] bg-white dark:bg-[#1A1A1A]'
        }`}
      >
        <span className="h-[4px] w-[70%] rounded-full bg-black/25 dark:bg-white/30" />
        <span className="h-[4px] w-[45%] rounded-full bg-black/15 dark:bg-white/20" />
        <span className="h-[4px] w-[58%] rounded-full bg-black/15 dark:bg-white/20" />
      </div>
      {/* mini TabBar：默认 = 全宽贴底+上边框；液态 = 悬浮胶囊（发丝描边 + 高透玻璃） */}
      {liquid ? (
        <div className="lg-tabbar absolute inset-x-[9px] bottom-[7px] flex h-[15px] items-center justify-around">
          {[0, 1, 2].map((d) => (
            <span key={d} className="h-[5px] w-[5px] rounded-full" style={{ background: d === 0 ? accent : 'rgba(0,0,0,0.35)' }} />
          ))}
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 flex h-[17px] items-center justify-around border-t border-black/10 bg-[#F7F7F7] dark:border-white/10 dark:bg-[#1A1A1A]">
          {[0, 1, 2].map((d) => (
            <span key={d} className="h-[5px] w-[5px] rounded-full bg-black/35 dark:bg-white/40" style={d === 0 ? { background: accent } : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- HSL 滑条（胶囊轨道） ----------------

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
      {/* 胶囊轨道：渐变底 + 发丝白描边 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full ring-1 ring-white/60 dark:ring-white/[0.14]"
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
          [&::-webkit-slider-thumb]:h-[22px] [&::-webkit-slider-thumb]:w-[22px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-[0_2px_6px_rgba(0,0,0,0.22)]
          [&::-moz-range-thumb]:h-[22px] [&::-moz-range-thumb]:w-[22px] [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-[0_2px_6px_rgba(0,0,0,0.22)]"
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
  const setBubbleTheme = useSettings((s) => s.setBubbleTheme);

  /** 自定义颜色编辑目标：both=两侧一起改 / mine=我的 / theirs=TA的（仅颜色分侧；样式对两侧同时生效） */
  const [side, setSide] = useState<'both' | 'mine' | 'theirs'>('mine');
  /** 命名弹窗 */
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  /** 当前 App 的装扮（三 App 隔离：只读写 bubbleStyle[app]） */
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
  const hasCustomColor = !!(side === 'both' ? appStyle.mineColor || appStyle.theirsColor : currentColor);

  /** 修改当前 App 的装扮（其他 App 原样保留 —— 装扮隔离） */
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
    <IOSScreen className="bg-[#ECEFF4] dark:bg-[#0D0F13]">
      {/* 顶部玻璃条（同色半透 + blur，滚动时内容从底下晕开）；信息 App 页题与入口「主题」一致 */}
      <IOSNavBar
        title={app === 'sms' ? '主题' : '气泡样式'}
        large={false}
        left={<IOSBackButton onClick={onBack} label="" />}
        className="bg-[#ECEFF4]/75! dark:bg-[#0D0F13]/75!"
      />

      <div className="no-scrollbar relative flex-1 space-y-7 overflow-y-auto px-4 pb-12">
        {/* ---------- 0. 界面主题（第四十二轮：微信/QQ 默认/液态玻璃；第五十轮：信息 默认/新版 iMessage） ---------- */}
        <section aria-label="界面主题">
            <SectionLabel>主题</SectionLabel>
            <div className="mt-2.5 grid grid-cols-2 gap-2.5">
              {THEMES_OF_APP[app].map((theme) => {
                const selected = (appStyle.theme ?? 'default') === theme;
                return (
                  <button
                    key={theme}
                    type="button"
                    data-testid={`bubble-theme-${theme}`}
                    aria-pressed={selected}
                    onClick={() => {
                      if (!selected) {
                        setBubbleTheme(app, theme);
                        onToast(
                          theme === 'liquid'
                            ? '已切换液态玻璃主题，气泡同步换为液态玻璃'
                            : theme === 'new'
                              ? '已切换新版主题，聊天界面换为新版 iMessage'
                              : '已恢复默认主题，气泡同步换为原生默认',
                        );
                      }
                    }}
                    className={`relative flex flex-col items-stretch rounded-[22px] bg-white/60 p-1.5 backdrop-blur-xl transition-transform active:scale-[0.98] dark:bg-white/[0.06] ${
                      selected ? 'ring-2' : 'ring-1 ring-white/70 dark:ring-white/[0.14]'
                    }`}
                    style={selected ? { '--tw-ring-color': meta.accent, boxShadow: `0 0 0 2px ${withAlpha(meta.accent, 0.35)}` } as React.CSSProperties : undefined}
                  >
                    {/* 迷你主题缩略图：拟态对应主题的页面质感 */}
                    <ThemeThumb theme={theme} accent={meta.accent} />
                    <div className="flex items-center justify-between px-2 pb-1 pt-2">
                      <span className="text-[12.5px] font-medium text-black/75 dark:text-white/80">{BUBBLE_THEME_LABEL[theme]}</span>
                      {selected && <Check className="h-[15px] w-[15px]" strokeWidth={2.6} style={{ color: meta.accent }} />}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 px-2 text-[11.5px] leading-relaxed text-black/35 dark:text-white/35">
              {app === 'sms'
                ? '切换主题只改聊天界面（顶栏/气泡/输入栏），会话列表等其他页面不变；之后再单独换气泡样式，主题保持不变'
                : '切换主题时气泡会跟着换（液态玻璃 ↔ 原生默认）；之后再单独换气泡样式，主题保持不变。铭件（导航/TabBar/列表/输入栏）随主题切换，聊天背景不受影响'}
            </p>
          </section>

        {/* ---------- 1. 实时预览：玻璃相框裱着聊天幕布 ---------- */}
        <section aria-label="实时预览" className={`${GLASS_CARD} p-1.5`}>
          <div className="relative overflow-hidden rounded-[17px]">
            <div className="absolute inset-0 bg-gradient-to-b from-[#E6EAF2] to-[#D9E0EB] dark:from-[#232836] dark:to-[#171B25]" />
            <AuraLayer />
            <div className="relative flex flex-col gap-3 px-4 py-6">
              {PREVIEW_MESSAGES.map((m, i) => (
                <div key={i} className={m.side === 'mine' ? 'self-end' : 'self-start'}>
                  <PreviewRow app={app} cfg={bubbleStyle} side={m.side} index={i} text={m.text} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- 2. 气泡样式四格（示意胶囊 + 名称，无多余装饰） ---------- */}
        <section aria-label="气泡样式">
          <SectionLabel>样式</SectionLabel>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            {(Object.keys(BUBBLE_KIND_LABEL) as BubbleStyleKind[]).map((kind) => {
              const selected = appStyle.kind === kind;
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
                  className={`rounded-[22px] bg-white/60 p-2.5 text-left backdrop-blur-xl ring-1 transition-all active:scale-[0.97] dark:bg-white/[0.06] ${
                    selected
                      ? 'ring-2'
                      : 'ring-white/70 hover:ring-white dark:ring-white/[0.14] dark:hover:ring-white/[0.18]'
                  }`}
                  style={selected ? { ['--tw-ring-color' as string]: meta.accent } : undefined}
                >
                  {/* 示意区：胶囊条 + 左右两颗泡（磨砂/液态需要底光斑才可见） */}
                  <div className="relative mb-2.5 flex h-[52px] items-center justify-between gap-1.5 overflow-hidden rounded-full bg-black/[0.04] px-3 dark:bg-white/[0.05]">
                    <AuraLayer />
                    <PreviewBubble app={app} cfg={previewCfg} side="theirs" index={0} className="!text-[11px]">
                      早呀
                    </PreviewBubble>
                    <PreviewBubble app={app} cfg={previewCfg} side="mine" index={1} className="!text-[11px]">
                      {kind === 'rainbow' ? '变啦' : '你好'}
                    </PreviewBubble>
                  </div>
                  <div className="flex items-center justify-between gap-2 px-1.5 pb-1">
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold leading-tight">{BUBBLE_KIND_LABEL[kind]}</span>
                      <span className="mt-[2px] block truncate text-[10.5px] leading-tight text-black/40 dark:text-white/40">
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

        {/* ---------- 3. 颜色（分段胶囊 / 滑条 / 色板，同卡三分区） ---------- */}
        <section aria-label="自定义颜色">
          <SectionLabel>颜色</SectionLabel>
          <div
            className={`mt-2.5 space-y-4 ${GLASS_CARD} p-4 transition-opacity ${
              kindDisabled ? 'pointer-events-none opacity-40' : ''
            }`}
          >
            {/* 分区一：编辑目标分段胶囊 + 恢复默认 */}
            <div className="flex items-center justify-between gap-2">
              <div className="relative flex rounded-full bg-black/[0.05] p-[3px] dark:bg-white/[0.08]">
                {(['both', 'mine', 'theirs'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSide(k)}
                    aria-pressed={side === k}
                    className={`relative z-10 rounded-full px-3.5 py-[5px] text-[12px] font-semibold transition-colors ${
                      side === k ? 'text-black/80 dark:text-white' : 'text-black/45 dark:text-white/50'
                    }`}
                  >
                    {side === k && (
                      <motion.span
                        layoutId="bubble-color-side-pill"
                        className="absolute inset-0 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.12)] dark:bg-white/20 dark:ring-1 dark:ring-white/15"
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className="relative">{k === 'both' ? '一起' : k === 'mine' ? '我的' : 'TA的'}</span>
                  </button>
                ))}
              </div>
              {hasCustomColor && (
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
                  className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-medium text-black/45 transition-colors active:bg-black/[0.06] dark:text-white/50 dark:active:bg-white/10"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  默认
                </button>
              )}
            </div>

            {/* 分区二：当前色珠 + HSL 三滑条 */}
            <div className="flex items-center gap-3.5">
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ring-1 ring-black/[0.06] dark:ring-white/15"
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

            {/* 分区三：预设色板（胶囊色点） */}
            <div className="grid grid-cols-12 gap-[7px]" role="group" aria-label="预设颜色">
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
                    style={{ backgroundColor: c, ...(selected ? { boxShadow: `0 0 0 2px ${meta.accent}` } : {}) }}
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
              <p className="text-[12px] text-black/40 dark:text-white/40">七彩气泡按消息顺序自动循环 9 色，无需选色</p>
            )}
          </div>
        </section>

        {/* ---------- 4. 保存当前设置（accent 胶囊） ---------- */}
        <button
          type="button"
          onClick={() => {
            setNameDraft('');
            setNaming(true);
          }}
          className="w-full rounded-full py-3.5 text-[15.5px] font-semibold text-white transition-transform active:scale-[0.98]"
          style={{ backgroundColor: meta.accent, boxShadow: `0 6px 18px ${withAlpha(meta.accent, 0.28)}` }}
        >
          保存当前设置
        </button>

        {/* ---------- 5. 收藏夹（胶囊行） ---------- */}
        <section aria-label="我的气泡收藏夹">
          <SectionLabel>我的气泡</SectionLabel>
          {schemes.length === 0 ? (
            <div className={`mt-2.5 border border-dashed border-black/[0.14] ${GLASS_CARD} py-6 text-center dark:border-white/[0.14]`}>
              <Palette className="mx-auto mb-1.5 h-5 w-5 text-black/25 dark:text-white/25" aria-hidden="true" />
              <p className="text-[13px] text-black/40 dark:text-white/40">还没有收藏的气泡方案</p>
            </div>
          ) : (
            <ul className="mt-2.5 space-y-2.5">
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
                      className={`flex cursor-pointer items-center gap-3 rounded-full bg-white/60 p-1.5 pr-2 backdrop-blur-xl ring-1 transition-all active:scale-[0.98] dark:bg-white/[0.06] ${
                        active
                          ? 'ring-2'
                          : 'ring-white/70 hover:ring-white dark:ring-white/[0.14] dark:hover:ring-white/[0.18]'
                      }`}
                      style={active ? { ['--tw-ring-color' as string]: sMeta.accent } : undefined}
                    >
                      {/* 缩略图：胶囊幕布 + 迷你双泡 */}
                      <div className="relative flex h-[44px] w-[80px] shrink-0 items-center justify-between gap-1 overflow-hidden rounded-full bg-black/[0.04] px-3 dark:bg-white/[0.05]">
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
                          <p className="truncate text-[14px] font-semibold leading-tight">{s.name}</p>
                          {active && (
                            <span
                              className="shrink-0 rounded-full px-1.5 py-[1px] text-[10px] font-semibold text-white"
                              style={{ backgroundColor: sMeta.accent }}
                            >
                              使用中
                            </span>
                          )}
                        </div>
                        <p className="mt-[2px] truncate text-[11px] text-black/40 dark:text-white/40">
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
                          className="flex items-center gap-0.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white transition-transform active:scale-95"
                          style={{ backgroundColor: sMeta.accent }}
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

      {/* ---------- 命名弹窗（毛玻璃卡 + 胶囊控件） ---------- */}
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
              className="w-full max-w-[300px] rounded-[22px] bg-white/80 p-5 shadow-2xl ring-1 ring-white/70 backdrop-blur-2xl dark:bg-[#1F2126]/85 dark:ring-white/[0.12]"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-center text-[16px] font-bold">给这套气泡起个名字</p>
              {/* 迷你效果预览：胶囊幕布 */}
              <div className="relative mt-3.5 flex items-center justify-center gap-1.5 overflow-hidden rounded-full bg-black/[0.04] px-4 py-2.5 dark:bg-white/[0.05]">
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
                className="mt-3.5 w-full rounded-full bg-black/[0.05] px-4 py-2.5 text-center text-[15px] outline-none transition-shadow placeholder:text-black/30 focus:ring-2 dark:bg-white/[0.08] dark:placeholder:text-white/30"
                style={{ ['--tw-ring-color' as string]: meta.accent }}
              />
              <div className="mt-4 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setNaming(false)}
                  className="flex-1 rounded-full bg-black/[0.05] py-2.5 text-[15px] font-semibold text-black/60 transition-colors active:bg-black/10 dark:bg-white/[0.08] dark:text-white/70 dark:active:bg-white/15"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={saveScheme}
                  className="flex-1 rounded-full py-2.5 text-[15px] font-semibold text-white transition-transform active:scale-95"
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
