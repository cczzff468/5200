'use client';

import { useState } from 'react';
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
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { IOSBackButton, IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { Switch } from '@/components/ui/switch';
import { IOSActionSheet, type ActionSheetAction } from '@/components/ios/ActionSheet';
import {
  DEFAULT_BILINGUAL_PROMPT,
  DELAY_OPTIONS_SEC,
  MAX_POST_INTERVAL_OPTIONS,
  MIN_POST_INTERVAL_OPTIONS,
  PROBABILITY_OPTIONS,
  formatDelaySec,
  formatProbability,
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

// ---------------- 色板（iOS 设置风：纯色圆角方块 + 白色线性图标） ----------------
const TONE_BLUE = '#007AFF';
const TONE_GREEN = '#34C759';
const TONE_ORANGE = '#FF9500';
const TONE_PURPLE = '#AF52FF';
const TONE_PINK = '#FF2D55';
const TONE_INDIGO = '#5856D6';
const TONE_TEAL = '#5AC8FA';
const TONE_RED = '#FF3B30';

// ---------------- 通用小组件（本地实现，不 import settings.tsx 内部组件） ----------------

/** iOS 分组卡片 */
function GroupCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 overflow-hidden rounded-[12px] bg-card divide-y divide-border/60">
      {children}
    </div>
  );
}

/** 主列表行图标：纯色圆角方块 + 白色线性图标 */
function RowIcon({ color, Icon }: { color: string; Icon: LucideIcon }) {
  return (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px]"
      style={{ backgroundColor: color }}
    >
      <Icon className="h-[17px] w-[17px] text-white" strokeWidth={2} />
    </span>
  );
}

/** 行：左图标 + 标签（可带副标题）/ 右侧值 / ChevronRight / 自定义 right（开关等） */
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
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-muted/40 disabled:opacity-100 ${
        danger ? 'text-[#FF3B30] dark:text-[#FF453A]' : ''
      }`}
    >
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
      {right ?? (onClick && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />)}
    </button>
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
          留空保存即使用默认提示词：{DEFAULT_BILINGUAL_PROMPT}
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

/** 选择器类型：每个数值字段对应一个 picker kind */
type PickerKind =
  | 'minPostInterval'
  | 'maxPostInterval'
  | 'firstCommentDelay'
  | 'followCommentDelay'
  | 'commentProbability'
  | 'likeProbability'
  | 'npcInteractDelay'
  | 'replyNpcCommentDelay';

/** 按 kind 构造 ActionSheet 选项；每分支显式 update({ 字段: 值 })，类型完全静态 */
function buildPickerActions(
  kind: PickerKind,
  settings: MomentsSettings,
  update: (patch: Partial<MomentsSettings>) => void,
): ActionSheetAction[] {
  switch (kind) {
    case 'minPostInterval':
      return MIN_POST_INTERVAL_OPTIONS.map((h) => ({
        label: `${h} 小时${h === settings.minPostInterval ? '（当前）' : ''}`,
        onSelect: () => update({ minPostInterval: h }),
      }));
    case 'maxPostInterval':
      return MAX_POST_INTERVAL_OPTIONS.map((h) => ({
        label: `${h} 小时${h === settings.maxPostInterval ? '（当前）' : ''}`,
        onSelect: () => update({ maxPostInterval: h }),
      }));
    case 'firstCommentDelay':
      return DELAY_OPTIONS_SEC.map((s) => ({
        label: `${formatDelaySec(s)}${s === settings.firstCommentDelay ? '（当前）' : ''}`,
        onSelect: () => update({ firstCommentDelay: s }),
      }));
    case 'followCommentDelay':
      return DELAY_OPTIONS_SEC.map((s) => ({
        label: `${formatDelaySec(s)}${s === settings.followCommentDelay ? '（当前）' : ''}`,
        onSelect: () => update({ followCommentDelay: s }),
      }));
    case 'commentProbability':
      return PROBABILITY_OPTIONS.map((p) => ({
        label: `${formatProbability(p)}${p === settings.commentProbability ? '（当前）' : ''}`,
        onSelect: () => update({ commentProbability: p }),
      }));
    case 'likeProbability':
      return PROBABILITY_OPTIONS.map((p) => ({
        label: `${formatProbability(p)}${p === settings.likeProbability ? '（当前）' : ''}`,
        onSelect: () => update({ likeProbability: p }),
      }));
    case 'npcInteractDelay':
      return DELAY_OPTIONS_SEC.map((s) => ({
        label: `${formatDelaySec(s)}${s === settings.npcInteractDelay ? '（当前）' : ''}`,
        onSelect: () => update({ npcInteractDelay: s }),
      }));
    case 'replyNpcCommentDelay':
      return DELAY_OPTIONS_SEC.map((s) => ({
        label: `${formatDelaySec(s)}${s === settings.replyNpcCommentDelay ? '（当前）' : ''}`,
        onSelect: () => update({ replyNpcCommentDelay: s }),
      }));
  }
}

export function MomentsSettingsPage({
  app,
  onBack,
  onToast,
  onOpenPostNow,
}: MomentsSettingsPageProps) {
  const [settings, setSettings] = useState<MomentsSettings>(() => getMomentsSettings());
  const [picker, setPicker] = useState<PickerKind | null>(null);
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
      <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-[40px]">
        {/* 分组1：发布频率 */}
        <GroupCard>
          <Row
            icon={<RowIcon color={TONE_BLUE} Icon={Clock} />}
            label="最小发帖间隔"
            value={`${settings.minPostInterval} 小时`}
            onClick={() => setPicker('minPostInterval')}
          />
          <Row
            icon={<RowIcon color={TONE_BLUE} Icon={Calendar} />}
            label="最长发帖间隔"
            value={`${settings.maxPostInterval} 小时`}
            onClick={() => setPicker('maxPostInterval')}
          />
          <Row
            icon={<RowIcon color={TONE_ORANGE} Icon={Sparkles} />}
            label="自动发帖角色"
            description="所有好友角色按间隔自动发帖"
          />
          <Row
            icon={<RowIcon color={TONE_GREEN} Icon={PenLine} />}
            label="立即发帖"
            description={postNowDesc}
            onClick={() => onOpenPostNow()}
          />
          <Row
            icon={<RowIcon color={TONE_RED} Icon={RotateCcw} />}
            label="恢复默认"
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

        {/* 分组2：评论与点赞 */}
        <GroupCard>
          <Row
            icon={<RowIcon color={TONE_GREEN} Icon={MessageCircle} />}
            label="首条评论延迟"
            value={formatDelaySec(settings.firstCommentDelay)}
            onClick={() => setPicker('firstCommentDelay')}
          />
          <Row
            icon={<RowIcon color={TONE_GREEN} Icon={Repeat} />}
            label="后续评论间隔"
            value={formatDelaySec(settings.followCommentDelay)}
            onClick={() => setPicker('followCommentDelay')}
          />
          <Row
            icon={<RowIcon color={TONE_PURPLE} Icon={Dice5} />}
            label="评论概率"
            value={formatProbability(settings.commentProbability)}
            onClick={() => setPicker('commentProbability')}
          />
          <Row
            icon={<RowIcon color={TONE_PINK} Icon={Heart} />}
            label="点赞概率"
            value={formatProbability(settings.likeProbability)}
            onClick={() => setPicker('likeProbability')}
          />
        </GroupCard>

        {/* 分组3：NPC 互动 */}
        <GroupCard>
          <Row
            icon={<RowIcon color={TONE_INDIGO} Icon={Bot} />}
            label="NPC 互动延迟"
            value={formatDelaySec(settings.npcInteractDelay)}
            onClick={() => setPicker('npcInteractDelay')}
          />
          <Row
            icon={<RowIcon color={TONE_INDIGO} Icon={Reply} />}
            label="角色回复 NPC 评论延迟"
            value={formatDelaySec(settings.replyNpcCommentDelay)}
            onClick={() => setPicker('replyNpcCommentDelay')}
          />
        </GroupCard>

        {/* 分组4：双语翻译 */}
        <GroupCard>
          <Row
            icon={<RowIcon color={TONE_TEAL} Icon={Languages} />}
            label="朋友圈双语翻译"
            right={
              <Switch
                checked={settings.bilingualEnabled}
                onCheckedChange={(v) => update({ bilingualEnabled: v })}
              />
            }
          />
          <Row
            icon={<RowIcon color={TONE_TEAL} Icon={ChevronDown} />}
            label="折叠中文译文"
            right={
              <Switch
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
      </div>

      {/* 底部动作表：数值选择 */}
      <IOSActionSheet
        open={picker !== null}
        actions={picker ? buildPickerActions(picker, settings, update) : []}
        onCancel={() => setPicker(null)}
      />
    </IOSScreen>
  );
}

export default MomentsSettingsPage;
