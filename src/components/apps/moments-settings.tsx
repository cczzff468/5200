'use client';

import { useEffect, useState } from 'react';
import {
  Bot,
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
  Heart,
  Languages,
  MessageCircle,
  PenLine,
  PenSquare,
  Repeat,
  Reply,
  RotateCcw,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { IOSBackButton, IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { isFriendIn } from '@/lib/contacts';
import { listContacts } from '@/lib/ios/contacts-store';
import { getMomentAutoCfg } from '@/lib/moments';
import {
  DEFAULT_BILINGUAL_PROMPT,
  formatIntervalRange,
  getMomentsSettings,
  MAX_POST_INTERVAL_MIN,
  MIN_POST_INTERVAL_MIN,
  MOMENT_RHYTHM_PRESETS,
  resetMomentsSettings,
  rhythmLabelOf,
  saveMomentsSettings,
  type MomentsSettings,
} from '@/lib/ios/moments-settings';

export interface MomentsSettingsPageProps {
  /** 平台：wx=朋友圈设置 / qq=空间动态设置 */
  app: 'wx' | 'qq';
  /** 返回上一级 */
  onBack: () => void;
  /** 弹一条本地提示 */
  onToast: (m: string) => void;
  /** 立即发帖入口（父级打开 AskPostSheet title="立即发帖"） */
  onOpenPostNow: () => void;
}

// ---------------- 色板（iOS 设置风：浅底圆角方块 + 彩色线性图标） ----------------
const TONE_BLUE = '#007AFF';
const TONE_GREEN = '#34C759';
const TONE_PURPLE = '#AF52FF';
const TONE_PINK = '#FF2D55';
const TONE_INDIGO = '#5856D6';
const TONE_TEAL = '#5AC8FA';
const TONE_RED = '#FF3B30';

/** 平台主色：wx 微信绿 / qq QQ 蓝（与各自 App 品牌色一致） */
const PLATFORM_ACCENT: Record<'wx' | 'qq', { main: string; deep: string }> = {
  wx: { main: '#07C160', deep: '#059A4C' },
  qq: { main: '#0099FF', deep: '#0079CC' },
};

// ---------------- 通用小组件（本地实现，不 import settings.tsx 内部组件） ----------------

/** 分组上方小字标签（简约：仅一行浅灰文字，无图标） */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 mt-6 px-1 text-[12.5px] font-medium text-muted-foreground">{children}</p>;
}

/** iOS 分组卡片 */
function GroupCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] bg-card shadow-sm ring-1 ring-black/[0.03] divide-y divide-border/50 dark:ring-white/[0.06]">
      {children}
    </div>
  );
}

/** 主列表行图标：浅色填充圆角方块 + 主色线性图标（iOS 系统设置同款） */
function RowIcon({ color, Icon }: { color: string; Icon: LucideIcon }) {
  return (
    <span className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-[7px] bg-muted/60 dark:bg-white/[0.08]">
      <Icon className="h-[17px] w-[17px]" strokeWidth={2} style={{ color }} />
    </span>
  );
}

/** 行：左图标 + 标签（可带副标题）/ 右侧值 / ChevronRight / 自定义 right（开关、输入框等）。
 *  无 onClick 时渲染为 div（避免 input/switch 嵌在 disabled button 中导致不可交互）。 */
function Row({
  icon,
  label,
  value,
  description,
  onClick,
  right,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  /** 副标题：长说明文字（说明项 / 立即发帖行使用） */
  description?: string;
  onClick?: () => void;
  right?: React.ReactNode;
  /** 红色文字（恢复默认等破坏性动作） */
  danger?: boolean;
}) {
  const className = `flex min-h-[54px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-muted/50 ${
    danger ? 'text-[#FF3B30] dark:text-[#FF453A]' : ''
  }`;
  const inner = (
    <>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] leading-tight">{label}</span>
        {description && (
          <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      {value && (
        <span className="shrink-0 text-[15px] text-muted-foreground">{value}</span>
      )}
      {onClick
        ? right ?? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        : right}
    </>
  );
  if (!onClick) {
    return <div className={className}>{inner}</div>;
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  );
}

/** 大号绿色开关（iOS 风格自绘，比 shadcn Switch 默认更大 + 微信/iOS 绿 #34C759） */
function BigGreenSwitch({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={`relative h-[30px] w-[52px] shrink-0 rounded-full transition-colors duration-200 active:scale-95 ${
        checked
          ? 'bg-[#34C759] shadow-[0_2px_8px_rgba(52,199,89,0.4)]'
          : 'bg-black/15 dark:bg-white/25'
      }`}
    >
      <span
        className={`absolute top-[2px] h-[26px] w-[26px] rounded-full bg-white shadow-md transition-transform duration-200 ${
          checked ? 'left-[24px]' : 'left-[2px]'
        }`}
      />
    </button>
  );
}

/**
 * 通用数值输入框：本地维护输入文本，失焦/回车时按 [min,max] 范围 clamp 后调 onCommit。
 * displayValue 是“显示空间”的当前值；toStored 把显示空间的整数映射回存储空间。
 * - 分钟/秒：identity 映射；显示与存储一致。
 * - 概率：存储 0-1，显示 0-100，toStored = n => n / 100。
 */
function NumberField({
  displayValue,
  min,
  max,
  step,
  unit,
  toStored,
  onCommit,
}: {
  displayValue: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  toStored: (n: number) => number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(displayValue));

  // 外部值变化时（如点节奏预设/恢复默认）同步本地文本
  useEffect(() => {
    setText(String(displayValue));
  }, [displayValue]);

  const commit = () => {
    if (text.trim() === '') {
      setText(String(displayValue));
      return;
    }
    const n = Number(text);
    if (Number.isNaN(n)) {
      setText(String(displayValue));
      return;
    }
    const clamped = Math.max(min, Math.min(max, Math.round(n)));
    onCommit(toStored(clamped));
    setText(String(clamped));
  };

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="w-[64px] rounded-[9px] border border-border/50 bg-muted/40 px-2.5 py-1.5 text-right text-[15px] tabular-nums transition-colors focus:border-[#0A84FF] focus:bg-background focus:outline-none focus:ring-2 focus:ring-[#0A84FF]/20"
        inputMode="numeric"
      />
      <span className="w-[28px] text-[14px] text-muted-foreground">{unit}</span>
    </span>
  );
}

/** 概率滑杆行（iOS 风格自绘轨道 + 白色圆钮，绿色填充；0-100% 即时生效） */
function SliderRow({
  icon,
  label,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  /** 存储值 0-1 */
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = Math.min(100, Math.max(0, Math.round(value * 100)));
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 text-[16px] leading-tight">{label}</span>
        <span className="shrink-0 text-[15px] tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      <div className="relative h-[28px]">
        {/* 自绘轨道：左右各缩进拇指半径（11px），让填充末端与拇指圆心严格对齐 */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-[51px] right-[11px] top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-black/[0.08] dark:bg-white/[0.16]"
        >
          <div className="h-full rounded-full bg-[#34C759]" style={{ width: `${pct}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          className="absolute inset-y-0 left-[40px] right-0 cursor-pointer appearance-none bg-transparent focus:outline-none [&::-moz-range-thumb]:h-[22px] [&::-moz-range-thumb]:w-[22px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.35)] [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-[4px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:mt-[-9px] [&::-webkit-slider-thumb]:h-[22px] [&::-webkit-slider-thumb]:w-[22px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-black/5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.35)]"
        />
      </div>
    </div>
  );
}

// ---------------- 双语提示词二级编辑页 ----------------

function PromptEditPage({
  initial,
  onBack,
  onSave,
}: {
  initial: string;
  onBack: () => void;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <IOSScreen className="relative">
      <IOSNavBar
        title="双语提示词"
        large={false}
        left={<IOSBackButton onClick={onBack} label="" />}
        right={
          <button
            type="button"
            onClick={() => onSave(text)}
            className="text-[17px] font-medium text-[#007AFF] transition-opacity active:opacity-50 dark:text-[#0A84FF]"
          >
            保存
          </button>
        }
      />
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-[40px]">
        <div className="mt-6 overflow-hidden rounded-[12px] bg-card p-3 ring-1 ring-black/[0.03] dark:ring-white/[0.06]">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={DEFAULT_BILINGUAL_PROMPT}
            className="min-h-[200px] w-full resize-none rounded-[10px] bg-background/40 px-3 py-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
          />
          <p className="mt-1 px-1 text-right text-[11px] tabular-nums text-muted-foreground/70">
            {text.length} 字
          </p>
        </div>
        <p className="mt-2 px-1 text-[13px] leading-snug text-muted-foreground">
          留空保存即使用默认双语规则（上方占位文为本规则全文，可参考编辑自定义）。
        </p>
        <div className="mt-6 overflow-hidden rounded-[12px] bg-card divide-y divide-border/60">
          <button
            type="button"
            onClick={() => setText('')}
            className="flex min-h-[52px] w-full items-center justify-center text-[16px] text-[#007AFF] transition-colors active:bg-muted/40 dark:text-[#0A84FF]"
          >
            清空（恢复默认提示词）
          </button>
        </div>
      </div>
    </IOSScreen>
  );
}

// ---------------- 主页面 ----------------

export function MomentsSettingsPage({
  app,
  onBack,
  onToast,
  onOpenPostNow,
}: MomentsSettingsPageProps) {
  const [settings, setSettings] = useState<MomentsSettings>(() => getMomentsSettings());
  const [promptEditing, setPromptEditing] = useState(false);
  /** 将主动发动态的好友数（当前平台；null = 还在统计） */
  const [activeFriends, setActiveFriends] = useState<number | null>(null);

  /** 局部更新 + 持久化 */
  const update = (patch: Partial<MomentsSettings>) => {
    const next = saveMomentsSettings(patch);
    setSettings(next);
  };

  // 统计当前平台「会主动发动态」的好友数（好友标记 × 每好友自动发开关）
  useEffect(() => {
    let alive = true;
    listContacts()
      .then((cs) => {
        if (!alive) return;
        const n = cs.filter(
          (c) => (c.kind === 'char' || c.kind === 'npc') && isFriendIn(c, app) && getMomentAutoCfg(c.id, app).enabled,
        ).length;
        setActiveFriends(n);
      })
      .catch(() => {
        // 统计失败不打扰用户
      });
    return () => {
      alive = false;
    };
  }, [app]);

  // ---------- 二级提示词编辑页 ----------
  if (promptEditing) {
    return (
      <PromptEditPage
        initial={settings.bilingualPrompt || DEFAULT_BILINGUAL_PROMPT}
        onBack={() => setPromptEditing(false)}
        onSave={(text) => {
          update({ bilingualPrompt: text.trim() });
          setPromptEditing(false);
          onToast('已保存双语提示词');
        }}
      />
    );
  }

  const title = app === 'wx' ? '朋友圈设置' : '空间动态设置';
  const noun = app === 'wx' ? '朋友圈' : '空间动态';
  const postNowDesc = app === 'wx' ? '选择角色立即发一条朋友圈' : '选择角色立即发一条空间动态';
  const accent = PLATFORM_ACCENT[app];

  const matchedPreset = MOMENT_RHYTHM_PRESETS.find(
    (p) => p.min === settings.minPostInterval && p.max === settings.maxPostInterval,
  );
  const rhythm = rhythmLabelOf(settings.minPostInterval, settings.maxPostInterval);
  const statusLine = !settings.autoPostEnabled
    ? `已关闭 · 好友不会主动发${noun}`
    : activeFriends === null
      ? '正在统计好友…'
      : activeFriends === 0
        ? '还没有好友会主动发动态'
        : `${activeFriends} 位好友将一直主动发${noun} · ${rhythm}节奏`;

  return (
    <IOSScreen className="relative">
      <IOSNavBar title={title} large={false} left={<IOSBackButton onClick={onBack} label="" />} />
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-[120px]">
        {/* 卡1：自动发动态总开关 + 发布节奏（活跃 30分钟-2小时 / 自然 2-4小时 / 安静 6-12小时） */}
        <div className="mt-5">
          <GroupCard>
            <Row
              icon={<RowIcon color={accent.main} Icon={Sparkles} />}
              label="自动发动态"
              description={statusLine}
              right={<BigGreenSwitch checked={settings.autoPostEnabled} onCheckedChange={(v) => update({ autoPostEnabled: v })} />}
            />
            <div className="px-4 pb-4 pt-2.5">
              <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="发布节奏预设">
                {MOMENT_RHYTHM_PRESETS.map((p) => {
                  const active = settings.minPostInterval === p.min && settings.maxPostInterval === p.max;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => update({ minPostInterval: p.min, maxPostInterval: p.max })}
                      className={`rounded-[10px] border px-2 py-2 text-center transition-all active:scale-[0.97] ${
                        active
                          ? 'border-transparent text-white shadow-sm'
                          : 'border-border/60 bg-background/40 text-foreground'
                      }`}
                      style={active ? { background: `linear-gradient(135deg, ${accent.main}, ${accent.deep})` } : undefined}
                    >
                      <span className="block text-[14px] font-medium leading-tight">{p.label}</span>
                      <span className={`mt-0.5 block text-[11px] leading-tight ${active ? 'text-white/85' : 'text-muted-foreground'}`}>
                        {formatIntervalRange(p.min, p.max)}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2.5 px-0.5 text-[12px] leading-snug text-muted-foreground">
                {matchedPreset
                  ? `${matchedPreset.desc} · 每隔约 ${formatIntervalRange(settings.minPostInterval, settings.maxPostInterval)}发一条`
                  : `自定义节奏 · 每隔约 ${formatIntervalRange(settings.minPostInterval, settings.maxPostInterval)}发一条`}
              </p>
            </div>
            <Row
              icon={<RowIcon color={TONE_BLUE} Icon={Clock} />}
              label="最短发帖间隔"
              description="两次发动态之间的最短等待时间"
              right={
                <NumberField
                  displayValue={settings.minPostInterval}
                  min={MIN_POST_INTERVAL_MIN}
                  max={MAX_POST_INTERVAL_MIN}
                  step={5}
                  unit="分钟"
                  toStored={(n) => n}
                  onCommit={(v) => update({ minPostInterval: v })}
                />
              }
            />
            <Row
              icon={<RowIcon color={TONE_BLUE} Icon={Calendar} />}
              label="最长发帖间隔"
              description="超过此时间未发帖将强制触发一次"
              right={
                <NumberField
                  displayValue={settings.maxPostInterval}
                  min={MIN_POST_INTERVAL_MIN}
                  max={MAX_POST_INTERVAL_MIN}
                  step={5}
                  unit="分钟"
                  toStored={(n) => n}
                  onCommit={(v) => update({ maxPostInterval: v })}
                />
              }
            />
            <Row
              icon={<RowIcon color={TONE_GREEN} Icon={PenLine} />}
              label="立即发帖"
              description={postNowDesc}
              onClick={() => onOpenPostNow()}
            />
          </GroupCard>
        </div>

        {/* 卡2：评论与点赞 */}
        <GroupLabel>评论与点赞</GroupLabel>
        <GroupCard>
          <SliderRow
            icon={<RowIcon color={TONE_PINK} Icon={Heart} />}
            label="点赞概率"
            value={settings.likeProbability}
            onChange={(v) => update({ likeProbability: v })}
          />
          <SliderRow
            icon={<RowIcon color={TONE_PURPLE} Icon={MessageCircle} />}
            label="评论概率"
            value={settings.commentProbability}
            onChange={(v) => update({ commentProbability: v })}
          />
          <Row
            icon={<RowIcon color={TONE_GREEN} Icon={MessageCircle} />}
            label="首条评论延迟"
            description="动态发布后第一条评论的等待时间"
            right={
              <NumberField
                displayValue={settings.firstCommentDelay}
                min={1}
                max={3600}
                step={1}
                unit="秒"
                toStored={(n) => n}
                onCommit={(v) => update({ firstCommentDelay: v })}
              />
            }
          />
          <Row
            icon={<RowIcon color={TONE_GREEN} Icon={Repeat} />}
            label="后续评论间隔"
            description="连续评论之间的等待时间"
            right={
              <NumberField
                displayValue={settings.followCommentDelay}
                min={1}
                max={3600}
                step={1}
                unit="秒"
                toStored={(n) => n}
                onCommit={(v) => update({ followCommentDelay: v })}
              />
            }
          />
        </GroupCard>

        {/* 卡3：NPC 互动 */}
        <GroupLabel>NPC 互动</GroupLabel>
        <GroupCard>
          <Row
            icon={<RowIcon color={TONE_INDIGO} Icon={Bot} />}
            label="NPC 互动延迟"
            description="NPC 对动态产生互动的等待时间"
            right={
              <NumberField
                displayValue={settings.npcInteractDelay}
                min={1}
                max={3600}
                step={1}
                unit="秒"
                toStored={(n) => n}
                onCommit={(v) => update({ npcInteractDelay: v })}
              />
            }
          />
          <Row
            icon={<RowIcon color={TONE_INDIGO} Icon={Reply} />}
            label="角色回复 NPC 评论延迟"
            description="角色回复 NPC 评论前的等待时间"
            right={
              <NumberField
                displayValue={settings.replyNpcCommentDelay}
                min={1}
                max={3600}
                step={1}
                unit="秒"
                toStored={(n) => n}
                onCommit={(v) => update({ replyNpcCommentDelay: v })}
              />
            }
          />
        </GroupCard>

        {/* 卡4：双语翻译 */}
        <GroupLabel>双语翻译</GroupLabel>
        <GroupCard>
          <Row
            icon={<RowIcon color={TONE_TEAL} Icon={Languages} />}
            label="双语翻译"
            description="外语帖子、评论和回复自动附中文译文"
            right={
              <BigGreenSwitch
                checked={settings.bilingualEnabled}
                onCheckedChange={(v) => update({ bilingualEnabled: v })}
              />
            }
          />
          <Row
            icon={<RowIcon color={TONE_TEAL} Icon={ChevronDown} />}
            label="折叠中文译文"
            description="关闭后默认直接展开中文"
            right={
              <BigGreenSwitch
                checked={settings.foldChineseTranslation}
                onCheckedChange={(v) => update({ foldChineseTranslation: v })}
              />
            }
          />
          <Row
            icon={<RowIcon color={TONE_BLUE} Icon={PenSquare} />}
            label="双语提示词"
            value={settings.bilingualPrompt.trim() ? '自定义' : '默认'}
            onClick={() => setPromptEditing(true)}
          />
        </GroupCard>

        {/* 恢复默认（页面底部，单独分组） */}
        <div className="mt-6">
          <GroupCard>
            <Row
              icon={<RowIcon color={TONE_RED} Icon={RotateCcw} />}
              label="恢复默认"
              description="将所有设置恢复为默认值"
              danger
              onClick={() => {
                if (window.confirm('确定恢复所有朋友圈设置为默认值？')) {
                  const next = resetMomentsSettings();
                  setSettings(next);
                  onToast('已恢复默认设置');
                }
              }}
            />
          </GroupCard>
        </div>

        {/* 底部提示：每好友单独设置入口 */}
        <p className="mt-6 mb-2 px-1 text-[12.5px] leading-relaxed text-muted-foreground">
          想单独控制某位好友？点「立即发帖」打开好友列表，再点好友右侧的设置图标，可为
          TA 单独选择发布方式或关闭自动发动态。
        </p>
      </div>
    </IOSScreen>
  );
}

export default MomentsSettingsPage;
