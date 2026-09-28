'use client';

import { useEffect, useState } from 'react';
import {
  Bot,
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
  Dice5,
  Heart,
  Languages,
  MessageCircle,
  PenLine,
  PenSquare,
  Repeat,
  Reply,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import { IOSBackButton, IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import {
  DEFAULT_BILINGUAL_PROMPT,
  getMomentsSettings,
  resetMomentsSettings,
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

// ---------------- 色板（iOS 设置风：渐变圆角方块 + 白色线性图标） ----------------
const TONE_BLUE = '#007AFF';
const TONE_GREEN = '#34C759';
const TONE_ORANGE = '#FF9500';
const TONE_PURPLE = '#AF52FF';
const TONE_PINK = '#FF2D55';
const TONE_INDIGO = '#5856D6';
const TONE_TEAL = '#5AC8FA';
const TONE_RED = '#FF3B30';
const TONE_YELLOW = '#FFCC00';

// ---------------- 通用小组件（本地实现，不 import settings.tsx 内部组件） ----------------

/** 分组标题（iOS 风格：分组上方小字说明） */
function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-7 mb-2 px-4 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

/** iOS 分组卡片 */
function GroupCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] bg-card shadow-sm divide-y divide-border/50">
      {children}
    </div>
  );
}

/** 主列表行图标：简约风格——浅色填充圆角方块 + 主色线性图标（iOS 系统设置同款，无投影无渐变） */
function RowIcon({ color, Icon }: { color: string; Icon: LucideIcon }) {
  return (
    <span
      className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-[7px] bg-muted/60 dark:bg-white/[0.08]"
    >
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
 * - 小时/秒：identity 映射；显示与存储一致。
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

  // 外部值变化时（如恢复默认）同步本地文本
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
        className="w-[64px] rounded-[9px] border border-border/50 bg-background/60 px-2.5 py-1.5 text-right text-[15px] tabular-nums transition-colors focus:border-[#0A84FF] focus:bg-background focus:outline-none focus:ring-2 focus:ring-[#0A84FF]/20"
        inputMode="numeric"
      />
      <span className="w-[28px] text-[14px] text-muted-foreground">{unit}</span>
    </span>
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
        <div className="mt-6 overflow-hidden rounded-[12px] bg-card p-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={DEFAULT_BILINGUAL_PROMPT}
            className="min-h-[200px] w-full resize-none rounded-[10px] bg-background/40 px-3 py-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
          />
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

  /** 局部更新 + 持久化 */
  const update = (patch: Partial<MomentsSettings>) => {
    const next = saveMomentsSettings(patch);
    setSettings(next);
  };

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
  const postNowDesc =
    app === 'wx' ? '选择角色立即发一条朋友圈' : '选择角色立即发一条空间动态';

  return (
    <IOSScreen className="relative">
      <IOSNavBar title={title} large={false} left={<IOSBackButton onClick={onBack} label="" />} />
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-[120px]">
        {/* 分组1：发布频率 */}
        <GroupHeader>一、发布频率</GroupHeader>
        <GroupCard>
          <Row
            icon={<RowIcon color={TONE_BLUE} Icon={Clock} />}
            label="最小发帖间隔"
            description="自动发帖两次之间的最短等待时间"
            right={
              <NumberField
                displayValue={settings.minPostInterval}
                min={1}
                max={24}
                step={1}
                unit="小时"
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
                min={1}
                max={24}
                step={1}
                unit="小时"
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

        {/* 分组2：评论与点赞 */}
        <GroupHeader>二、评论与点赞</GroupHeader>
        <GroupCard>
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
          <Row
            icon={<RowIcon color={TONE_PURPLE} Icon={Dice5} />}
            label="评论概率"
            description="角色看到动态后发表评论的概率"
            right={
              <NumberField
                displayValue={Math.round(settings.commentProbability * 100)}
                min={0}
                max={100}
                step={1}
                unit="%"
                toStored={(n) => n / 100}
                onCommit={(v) => update({ commentProbability: v })}
              />
            }
          />
          <Row
            icon={<RowIcon color={TONE_PINK} Icon={Heart} />}
            label="点赞概率"
            description="角色看到动态后点赞的概率"
            right={
              <NumberField
                displayValue={Math.round(settings.likeProbability * 100)}
                min={0}
                max={100}
                step={1}
                unit="%"
                toStored={(n) => n / 100}
                onCommit={(v) => update({ likeProbability: v })}
              />
            }
          />
        </GroupCard>

        {/* 分组3：NPC 互动 */}
        <GroupHeader>三、NPC 互动</GroupHeader>
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

        {/* 分组4：双语翻译 */}
        <GroupHeader>四、双语翻译</GroupHeader>
        <GroupCard>
          <Row
            icon={<RowIcon color={TONE_TEAL} Icon={Languages} />}
            label="朋友圈双语翻译"
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
            label="朋友圈双语提示词"
            value={settings.bilingualPrompt.trim() ? '自定义' : '默认'}
            onClick={() => setPromptEditing(true)}
          />
        </GroupCard>

        {/* 恢复默认（移到页面底部，单独分组） */}
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
    </IOSScreen>
  );
}

export default MomentsSettingsPage;
