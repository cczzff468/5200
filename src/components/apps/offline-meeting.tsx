'use client';

/**
 * 线下模式（约会）—— 全屏见面页（QQ / 微信 / 信息三端共用）。
 *
 * 结构（对照需求与参考截图，整体毛玻璃/胶囊玻璃风格）：
 * - 环境：暖色环境光斑打底（GlassAmbience），所有卡片/按钮均为毛玻璃（backdrop-blur）；
 * - 头部：返回 + 毛玻璃胶囊（只显示头像 + 名字，见面中叠在线绿点）+ 收藏（保存）+ 现场设置（玻璃圆钮）；
 * - 叙事流：角色叙述（玻璃大卡 + 迷你头像名字时间头）+ 用户输入（深色玻璃气泡）；
 * - 底部：继续 / 重Roll / 保存三个玻璃圆钮分列输入框左右两侧，输入框内嵌深色圆形发送钮；
 * - 无见面时：极简开始页（头像 + 名字 + 开始见面）；
 * - 现场设置面板：「从聊天继续」承接最近 N 条（置于最上方）/ 回复字数 / 用户·角色叙述人称 /
 *   回复预设 / 基础设置 / 变量说明 / 角色回复预设模板编辑 / 现场文风（内置+新建）。
 *
 * 数据：进行中的见面按角色 ID 隔离（offline-meet:<contactId>）；生成走 /api/offline；
 * 保存时经 memAddEventFragment 写入记忆库（sourceTag 'offline-meet'），线上聊天可召回。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from 'lucide-react';

import type { ContactRecord } from '@/lib/contacts';
import { getContact, listContacts } from '@/lib/ios/contacts-store';
import { buildNpcPromptExtra } from '@/lib/ios/npc-bond';
import { buildPersonaSystemPrompt, type PersonaSource } from '@/lib/ios/persona';
import { useSettings } from '@/lib/ios/store';
import { getMemSettings, memAddEventFragment, memRecallBlock } from '@/lib/memory';
import {
  collectWbBlocks,
  wbRulesBlock,
  wbScanText,
} from '@/lib/ios/worldbook';
import { buildTimeAwareBlock } from '@/lib/time-aware';
import {
  BUILTIN_STYLES,
  DEFAULT_OFFLINE_SETTINGS,
  OFFLINE_BUILTIN_PRESET_ID,
  OFFLINE_BUILTIN_STYLE_ID,
  OFFLINE_CARRY_OPTIONS,
  OFFLINE_DEFAULT_TEMPLATE,
  OFFLINE_PACE_LABEL,
  OFFLINE_TRI_LABEL,
  OFFLINE_VARIABLES,
  addMeetToHistory,
  buildMeetDigest,
  buildOfflineDirective,
  buildOfflineHistoryText,
  buildOpenInstruction,
  clearMeet,
  effectiveCharPerson,
  effectiveReplyTarget,
  extractSceneHeader,
  loadMeet,
  loadMeetSettings,
  loadPresets,
  loadStyles,
  loadTplOverride,
  loadWbBgCache,
  offlineUid,
  renderTemplate,
  saveCustomPresets,
  saveCustomStyles,
  saveMeet,
  saveMeetSettings,
  saveTplOverride,
  saveWbBgCache,
  type OfflineApp,
  type OfflineMeet,
  type OfflineMeetSettings,
  type OfflineOnlineMsg,
  type OfflinePreset,
  type OfflineStyle,
} from '@/lib/offline-meet';
import { LocalToast, useLocalToast } from '@/components/apps/page-toast';

// ---------------- 对外类型 ----------------

export interface OfflineMeetingPageProps {
  /** 来源 App（决定记忆库的 app 键与文案） */
  app: OfflineApp;
  /** 渠道名（微信 / QQ / 短信，人设注入用） */
  channel: string;
  /** 当前角色（联系人）id —— 线下见面按角色 ID 隔离 */
  contactId: string;
  /** 用户称呼（addressNameOf 解析结果；空 = 回退「我」） */
  userName: string;
  /** 机主真实姓名 / 昵称（人设【用户的称呼】段用） */
  userRealName?: string | null;
  userNickname?: string | null;
  /** 读取最近 n 条线上聊天（宿主按各 App 消息结构映射） */
  loadRecentMsgs: (n: number) => OfflineOnlineMsg[];
  onBack: () => void;
  /** App 级 toast（宿主提供；信息端传自己的 showToast） */
  onToast?: (m: string) => void;
}

// ---------------- 玻璃风格共用件 ----------------

/** 毛玻璃卡（叙事 / 信息卡） */
const GLASS_CARD =
  'border border-white/60 bg-white/55 shadow-[0_8px_28px_rgba(60,50,40,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] dark:shadow-[0_8px_28px_rgba(0,0,0,0.4)]';

/** 毛玻璃胶囊（圆钮 / 小按钮 / 状态条） */
const GLASS_CAPSULE =
  'border border-white/70 bg-white/55 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.08]';

/** 环境光斑：给毛玻璃提供可折射的底色 */
function GlassAmbience() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div className="absolute -right-16 -top-20 h-72 w-72 rounded-full bg-[#FFD9A0]/60 blur-[80px] dark:bg-[#8a5a2b]/25" />
      <div className="absolute -left-20 top-1/3 h-64 w-64 rounded-full bg-[#F5C3CE]/50 blur-[80px] dark:bg-[#7c3d4b]/20" />
      <div className="absolute -bottom-24 right-1/4 h-64 w-64 rounded-full bg-[#CBE6D2]/45 blur-[80px] dark:bg-[#2f5c44]/20" />
    </div>
  );
}

/** HH:MM */
function hhmm(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 多档分段选择（毛玻璃药丸） */
function Seg<T extends string>({ value, options, onChange }: { value: T; options: Array<{ v: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-full bg-black/[0.06] p-1 dark:bg-white/[0.08]">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`h-8 flex-1 rounded-full text-[13px] transition ${
            value === o.v
              ? 'bg-white/90 font-medium text-black shadow-sm backdrop-blur-md dark:bg-white/[0.18] dark:text-white'
              : 'text-black/45 dark:text-white/45'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FieldLabel({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-2">
      <p className="text-[15px] font-medium text-black/85 dark:text-white/90">{title}</p>
      {hint ? <p className="mt-0.5 text-[12px] leading-[1.4] text-black/40 dark:text-white/40">{hint}</p> : null}
    </div>
  );
}

const inputCls =
  'h-11 w-full rounded-[14px] border border-white/70 bg-white/70 px-3 text-[15px] text-black outline-none backdrop-blur-md placeholder:text-black/25 focus:border-black/25 dark:border-white/10 dark:bg-white/[0.08] dark:text-white dark:placeholder:text-white/25 dark:focus:border-white/30';

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[20px] p-4 ${GLASS_CARD} ${className}`}>{children}</div>;
}

/** 头像（联系人头像 dataURL 或首字母圆） */
function MeetAvatar({ contact, size = 44 }: { contact: ContactRecord | null; size?: number }) {
  const name = contact?.nickname?.trim() || contact?.name || '?';
  if (contact?.avatar) {
    return <img src={contact.avatar} alt={name} className="rounded-full object-cover ring-2 ring-white/80 dark:ring-white/15" style={{ width: size, height: size }} />;
  }
  return (
    <div
      className="flex items-center justify-center rounded-full bg-gradient-to-br from-[#FFD54F] to-[#FFB300] font-semibold text-white ring-2 ring-white/80 dark:ring-white/15"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {name.slice(0, 1)}
    </div>
  );
}

// ---------------- 现场设置面板 ----------------

interface SettingsPanelProps {
  initial: OfflineMeetSettings;
  presets: OfflinePreset[];
  styles: OfflineStyle[];
  tpl: string;
  meetActive: boolean;
  /** 可承接的线上聊天条数（提示用） */
  availableCount: number;
  onClose: () => void;
  onCommit: (settings: OfflineMeetSettings, tpl: string) => void;
  onCreatePreset: (name: string, template: string) => string;
  onSavePreset: (id: string, template: string) => void;
  onDeletePreset: (id: string) => void;
  onCreateStyle: (name: string, content: string) => string;
  onDeleteStyle: (id: string) => void;
}

function OfflineSettingsPanel({ initial, presets, styles, tpl, meetActive, availableCount, onClose, onCommit, onCreatePreset, onSavePreset, onDeletePreset, onCreateStyle, onDeleteStyle }: SettingsPanelProps) {
  const [d, setD] = useState<OfflineMeetSettings>({ ...initial });
  const [tplDraft, setTplDraft] = useState(tpl);
  const [carrySel, setCarrySel] = useState<number | 'custom'>(() =>
    (OFFLINE_CARRY_OPTIONS as readonly number[]).includes(initial.carryCount) ? initial.carryCount : 'custom',
  );
  const [carryCustom, setCarryCustom] = useState(String(initial.carryCount));
  const [presetPanel, setPresetPanel] = useState<null | { mode: 'new' | 'save-as'; name: string }>(null);
  const [stylePanel, setStylePanel] = useState<null | { name: string; content: string }>(null);
  const activePreset = presets.find((p) => p.id === d.presetId) ?? presets[0];
  const activeStyle = styles.find((s) => s.id === d.styleId) ?? styles[0];

  const up = (patch: Partial<OfflineMeetSettings>) => setD((prev) => ({ ...prev, ...patch }));

  return (
    <div className="absolute inset-0 z-30 flex flex-col overflow-hidden bg-[#F3F1EE] text-black dark:bg-[#0C0C0E] dark:text-white">
      <GlassAmbience />
      <div className="flex items-start justify-between px-5 pb-3 pt-[58px]">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-black/35 dark:text-white/35">Meeting Preferences</p>
          <h2 className="mt-1 text-[26px] font-bold text-black dark:text-white">现场设置</h2>
          <p className="mt-1 text-[13px] text-black/45 dark:text-white/45">承接条数在下次开始见面时生效；其余只影响{meetActive ? '本次线下见面' : '下次线下见面'}。</p>
        </div>
        <button
          type="button"
          aria-label="关闭现场设置"
          onClick={onClose}
          className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-black/60 active:opacity-60 dark:text-white/70 ${GLASS_CAPSULE}`}
        >
          <X className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4 thin-scrollbar">
        {/* 从聊天继续（承接最近 N 条线上聊天）—— 置于最上方 */}
        <Card>
          <FieldLabel title="从聊天继续" hint="开始见面时承接最近的线上聊天；已开始的见面不受影响" />
          <div className="flex flex-wrap gap-2">
            {OFFLINE_CARRY_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCarrySel(n)}
                className={`h-9 min-w-[52px] rounded-full px-3 text-[14px] transition ${
                  carrySel === n
                    ? 'bg-[#1C1C1E]/90 font-medium text-white shadow-md backdrop-blur-xl dark:bg-white dark:text-black'
                    : 'border border-white/70 bg-white/50 text-black/60 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.08] dark:text-white/60'
                }`}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCarrySel('custom')}
              className={`h-9 rounded-full px-3 text-[14px] transition ${
                carrySel === 'custom'
                  ? 'bg-[#1C1C1E]/90 font-medium text-white shadow-md backdrop-blur-xl dark:bg-white dark:text-black'
                  : 'border border-white/70 bg-white/50 text-black/60 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.08] dark:text-white/60'
              }`}
            >
              自定义
            </button>
          </div>
          {carrySel === 'custom' ? (
            <input
              type="number"
              inputMode="numeric"
              min={5}
              max={200}
              value={carryCustom}
              onChange={(e) => setCarryCustom(e.target.value)}
              onBlur={() => setCarryCustom(String(Math.min(200, Math.max(5, Math.floor(Number(carryCustom) || 20)))))}
              className="mt-3 h-10 w-32 rounded-[14px] border border-white/70 bg-white/70 px-3 text-[15px] text-black outline-none backdrop-blur-md dark:border-white/10 dark:bg-white/[0.08] dark:text-white"
              aria-label="自定义承接条数"
              placeholder="5 ~ 200"
            />
          ) : null}
          <p className="mt-3 text-[12px] text-black/40 dark:text-white/40">
            {availableCount > 0 ? `共找到 ${availableCount} 条线上聊天记录可承接` : '最近没有线上聊天记录，也可以直接见面'}
          </p>
        </Card>

        {/* 回复字数 + 叙述人称 + 预设 */}
        <Card>
          <FieldLabel title="角色回复字数" hint="每次回复按设定字数上下浮动 20%" />
          <input
            type="number"
            inputMode="numeric"
            value={d.replyLength}
            min={100}
            max={8000}
            onChange={(e) => up({ replyLength: Math.min(8000, Math.max(100, Math.floor(Number(e.target.value) || 0))) })}
            onBlur={(e) => {
              const v = Math.floor(Number(e.target.value) || 0);
              up({ replyLength: Math.min(8000, Math.max(100, v || DEFAULT_OFFLINE_SETTINGS.replyLength)) });
            }}
            className={inputCls}
            aria-label="角色回复字数"
          />
          <div className="mt-4">
            <FieldLabel title="用户叙述人称" hint="识别用户动作时使用" />
            <select
              value={d.userPerson}
              onChange={(e) => up({ userPerson: e.target.value === '我' ? '我' : '你' })}
              className={inputCls}
              aria-label="用户叙述人称"
            >
              <option value="你">你</option>
              <option value="我">我</option>
            </select>
          </div>
          <div className="mt-4">
            <FieldLabel title="角色叙述人称" hint="角色描述自己时使用" />
            <select
              value={d.charPerson}
              onChange={(e) => up({ charPerson: e.target.value as OfflineMeetSettings['charPerson'] })}
              className={inputCls}
              aria-label="角色叙述人称"
            >
              <option value="他">他</option>
              <option value="她">她</option>
              <option value="我">我</option>
            </select>
          </div>
          <div className="mt-4">
            <FieldLabel title="选择回复预设" />
            <select
              value={activePreset?.id ?? OFFLINE_BUILTIN_PRESET_ID}
              onChange={(e) => {
                const p = presets.find((x) => x.id === e.target.value);
                if (!p) return;
                up({ presetId: p.id });
                setTplDraft(p.template);
              }}
              className={inputCls}
              aria-label="选择回复预设"
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPresetPanel({ mode: 'new', name: '' })}
                className="flex h-10 items-center justify-center gap-1 rounded-full border border-white/70 bg-white/55 text-[13px] text-black/70 backdrop-blur-md active:opacity-60 dark:border-white/10 dark:bg-white/[0.08] dark:text-white/70"
              >
                <Plus className="h-4 w-4" /> 新建预设
              </button>
              <button
                type="button"
                onClick={() => {
                  if (activePreset && !activePreset.builtin) {
                    onSavePreset(activePreset.id, tplDraft);
                  } else {
                    setPresetPanel({ mode: 'save-as', name: '' });
                  }
                }}
                className="flex h-10 items-center justify-center rounded-full border border-white/70 bg-white/55 text-[13px] text-black/70 backdrop-blur-md active:opacity-60 dark:border-white/10 dark:bg-white/[0.08] dark:text-white/70"
              >
                保存当前预设
              </button>
            </div>
            {activePreset && !activePreset.builtin ? (
              <button
                type="button"
                onClick={() => {
                  const fallback = presets.find((p) => p.builtin);
                  onDeletePreset(activePreset.id);
                  if (fallback) {
                    up({ presetId: fallback.id });
                    setTplDraft(fallback.template);
                  }
                }}
                className="mt-2 flex h-9 w-full items-center justify-center gap-1 rounded-full text-[13px] text-red-500/80 active:opacity-60"
              >
                <Trash2 className="h-4 w-4" /> 删除「{activePreset.name}」
              </button>
            ) : null}
          </div>
        </Card>

        {/* 新建/另存预设 命名面板 */}
        {presetPanel ? (
          <Card className="border-dashed">
            <FieldLabel title={presetPanel.mode === 'new' ? '新建预设' : '保存为新预设'} hint="把当前编辑区里的模板内容保存成一个预设" />
            <input
              value={presetPanel.name}
              onChange={(e) => setPresetPanel({ ...presetPanel, name: e.target.value })}
              placeholder="预设名称，如：慢热型开场"
              maxLength={20}
              className={inputCls}
              aria-label="预设名称"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPresetPanel(null)}
                className="h-10 rounded-full border border-white/70 bg-white/55 text-[13px] text-black/60 backdrop-blur-md active:opacity-60 dark:border-white/10 dark:bg-white/[0.08] dark:text-white/60"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!presetPanel.name.trim()}
                onClick={() => {
                  const id = onCreatePreset(presetPanel.name.trim(), tplDraft);
                  up({ presetId: id });
                  setPresetPanel(null);
                }}
                className="h-10 rounded-full bg-[#1C1C1E]/90 text-[13px] font-medium text-white shadow-md backdrop-blur-xl active:opacity-80 disabled:opacity-40 dark:bg-white dark:text-black"
              >
                保存
              </button>
            </div>
          </Card>
        ) : null}

        {/* 基础设置 */}
        <Card>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-black/35 dark:text-white/35">Basics</p>
          <h3 className="mt-1 text-[16px] font-semibold text-black/85 dark:text-white/90">基础设置</h3>
          <div className="mt-3 space-y-4">
            <div>
              <FieldLabel title="字数区间" hint="回复长度的硬性范围（目标字数会夹进该区间）" />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  value={d.lenMin}
                  min={50}
                  max={8000}
                  onChange={(e) => up({ lenMin: Math.min(8000, Math.max(50, Math.floor(Number(e.target.value) || 0))) })}
                  className={inputCls}
                  aria-label="字数区间下限"
                />
                <span className="text-black/40 dark:text-white/40">~</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={d.lenMax}
                  min={50}
                  max={8000}
                  onChange={(e) => up({ lenMax: Math.min(8000, Math.max(50, Math.floor(Number(e.target.value) || 0))) })}
                  className={inputCls}
                  aria-label="字数区间上限"
                />
              </div>
            </div>
            <div>
              <FieldLabel title="人称" hint="自动 = 按上面两个字段；指定时覆盖角色叙述人称" />
              <Seg
                value={d.person}
                onChange={(v) => up({ person: v })}
                options={[
                  { v: 'auto', label: '自动' },
                  { v: 'first', label: '一人称' },
                  { v: 'second', label: '二人称' },
                  { v: 'third', label: '三人称' },
                ]}
              />
            </div>
            <button type="button" onClick={() => up({ director: !d.director })} className="flex w-full items-center justify-between" aria-pressed={d.director}>
              <span className="text-left">
                <span className="block text-[15px] font-medium text-black/85 dark:text-white/90">导演模式</span>
                <span className="mt-0.5 block text-[12px] text-black/40 dark:text-white/40">开启后 AI 可推进小事件、转换场景、推动时间流动</span>
              </span>
              <span className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition ${d.director ? 'bg-[#34C759]' : 'bg-black/15 dark:bg-white/20'}`}>
                <span className={`absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow transition-all ${d.director ? 'left-[20px]' : 'left-[2px]'}`} />
              </span>
            </button>
            <div>
              <FieldLabel title="自主推进强度" />
              <Seg
                value={d.autonomy}
                onChange={(v) => up({ autonomy: v })}
                options={[
                  { v: 'low', label: OFFLINE_TRI_LABEL.low },
                  { v: 'medium', label: OFFLINE_TRI_LABEL.medium },
                  { v: 'high', label: OFFLINE_TRI_LABEL.high },
                ]}
              />
            </div>
            <div>
              <FieldLabel title="修辞密度" />
              <Seg
                value={d.rhetoric}
                onChange={(v) => up({ rhetoric: v })}
                options={[
                  { v: 'low', label: OFFLINE_TRI_LABEL.low },
                  { v: 'medium', label: OFFLINE_TRI_LABEL.medium },
                  { v: 'high', label: OFFLINE_TRI_LABEL.high },
                ]}
              />
            </div>
            <div>
              <FieldLabel title="描写占比" />
              <Seg
                value={d.description}
                onChange={(v) => up({ description: v })}
                options={[
                  { v: 'low', label: OFFLINE_TRI_LABEL.low },
                  { v: 'medium', label: OFFLINE_TRI_LABEL.medium },
                  { v: 'high', label: OFFLINE_TRI_LABEL.high },
                ]}
              />
            </div>
            <div>
              <FieldLabel title="节奏快慢" />
              <Seg
                value={d.pace}
                onChange={(v) => up({ pace: v })}
                options={[
                  { v: 'slow', label: OFFLINE_PACE_LABEL.slow },
                  { v: 'medium', label: OFFLINE_PACE_LABEL.medium },
                  { v: 'fast', label: OFFLINE_PACE_LABEL.fast },
                ]}
              />
            </div>
          </div>
        </Card>

        {/* 变量说明 */}
        <Card>
          <p className="text-[15px] font-medium text-black/85 dark:text-white/90">变量说明</p>
          <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {OFFLINE_VARIABLES.map((v) => (
              <p key={v.name} className="text-[12px] leading-[1.5] text-black/55 dark:text-white/55">
                <code className="rounded-md bg-white/60 px-1.5 py-0.5 font-mono text-[11px] text-black/75 ring-1 ring-white/70 dark:bg-white/[0.08] dark:text-white/75 dark:ring-white/10">{v.name}</code> {v.desc}
              </p>
            ))}
          </div>
        </Card>

        {/* 角色回复预设模板 */}
        <Card>
          <FieldLabel title="角色回复预设" hint="默认显示完整模板；支持 {{char_name}} 等变量，发送前自动替换" />
          <textarea
            value={tplDraft}
            onChange={(e) => setTplDraft(e.target.value)}
            rows={14}
            className="w-full rounded-[14px] border border-white/70 bg-white/70 p-3 text-[13px] leading-[1.7] text-black outline-none backdrop-blur-md focus:border-black/25 dark:border-white/10 dark:bg-white/[0.08] dark:text-white dark:focus:border-white/30"
            aria-label="角色回复预设模板"
          />
          <p className="mt-1.5 text-[12px] leading-[1.5] text-black/40 dark:text-white/40">
            保存设置后，这里的内容会在每次线下回复前被读取；变量会先替换成当前角色、用户、世界背景和现场记录，再发送给 API。要长期保留请用「保存当前预设」。
          </p>
        </Card>

        {/* 现场文风 */}
        <Card>
          <FieldLabel title="现场文风" hint="沿用内置文风，也可以自己新建" />
          <select
            value={activeStyle?.id ?? OFFLINE_BUILTIN_STYLE_ID}
            onChange={(e) => up({ styleId: e.target.value })}
            className={inputCls}
            aria-label="现场文风"
          >
            {styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {activeStyle ? (
            <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-[14px] border border-white/60 bg-white/50 p-3 text-[12px] leading-[1.7] text-black/60 backdrop-blur-md thin-scrollbar dark:border-white/10 dark:bg-white/[0.06] dark:text-white/60">
              {activeStyle.content}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setStylePanel({ name: '', content: '' })}
            className="mt-2 flex h-10 w-full items-center justify-center gap-1 rounded-full border border-dashed border-black/20 bg-white/40 text-[13px] text-black/60 backdrop-blur-md active:opacity-60 dark:border-white/20 dark:bg-white/[0.05] dark:text-white/60"
          >
            <Plus className="h-4 w-4" /> 新建文风
          </button>
          {activeStyle && !activeStyle.builtin ? (
            <button
              type="button"
              onClick={() => {
                const fallback = styles.find((s) => s.builtin);
                onDeleteStyle(activeStyle.id);
                if (fallback) up({ styleId: fallback.id });
              }}
              className="mt-1 flex h-9 w-full items-center justify-center gap-1 rounded-full text-[13px] text-red-500/80 active:opacity-60"
            >
              <Trash2 className="h-4 w-4" /> 删除「{activeStyle.name}」
            </button>
          ) : null}
        </Card>

        {/* 新建文风面板 */}
        {stylePanel ? (
          <Card className="border-dashed">
            <FieldLabel title="新建文风" hint="文风内容会替换进 {{writing_style}} 变量，写给 AI 的写作指令" />
            <input
              value={stylePanel.name}
              onChange={(e) => setStylePanel({ ...stylePanel, name: e.target.value })}
              placeholder="文风名称，如：港式都市"
              maxLength={20}
              className={inputCls}
              aria-label="文风名称"
            />
            <textarea
              value={stylePanel.content}
              onChange={(e) => setStylePanel({ ...stylePanel, content: e.target.value })}
              rows={6}
              placeholder="描述这种文风的句子节奏、用词、修辞与情绪处理方式…"
              className="mt-2 w-full rounded-[14px] border border-white/70 bg-white/70 p-3 text-[13px] leading-[1.7] text-black outline-none backdrop-blur-md focus:border-black/25 dark:border-white/10 dark:bg-white/[0.08] dark:text-white dark:focus:border-white/30"
              aria-label="文风内容"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setStylePanel(null)}
                className="h-10 rounded-full border border-white/70 bg-white/55 text-[13px] text-black/60 backdrop-blur-md active:opacity-60 dark:border-white/10 dark:bg-white/[0.08] dark:text-white/60"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!stylePanel.name.trim() || !stylePanel.content.trim()}
                onClick={() => {
                  const id = onCreateStyle(stylePanel.name.trim(), stylePanel.content.trim());
                  up({ styleId: id });
                  setStylePanel(null);
                }}
                className="h-10 rounded-full bg-[#1C1C1E]/90 text-[13px] font-medium text-white shadow-md backdrop-blur-xl active:opacity-80 disabled:opacity-40 dark:bg-white dark:text-black"
              >
                保存
              </button>
            </div>
          </Card>
        ) : null}

        {/* 背景读取说明 */}
        <div className="flex items-start gap-2 rounded-[18px] border border-white/50 bg-white/40 px-3.5 py-3 backdrop-blur-lg dark:border-white/[0.08] dark:bg-white/[0.05]">
          <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-black/50 dark:bg-white/50" aria-hidden="true" />
          <p className="text-[12px] leading-[1.6] text-black/50 dark:text-white/50">
            生成前会先读取世界书分析出的世界背景；没有分析结果时，再根据角色设定推断背景。之后才读取人设、字数、人称、文风和现场记录。
          </p>
        </div>
      </div>

      {/* 底部操作 */}
      <div className="flex items-center gap-3 border-t border-white/50 bg-white/40 px-4 pb-[30px] pt-3 backdrop-blur-xl dark:border-white/[0.06] dark:bg-white/[0.04]">
        <button
          type="button"
          onClick={onClose}
          className={`h-12 flex-1 rounded-full text-[15px] font-medium text-black/70 active:opacity-70 dark:text-white/80 ${GLASS_CAPSULE}`}
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => {
            const n = carrySel === 'custom' ? Math.min(200, Math.max(5, Math.floor(Number(carryCustom) || 20))) : carrySel;
            onCommit({ ...d, carryCount: n }, tplDraft);
          }}
          className="h-12 flex-1 rounded-full bg-[#1C1C1E]/90 text-[15px] font-semibold text-white shadow-[0_10px_30px_rgba(28,28,30,0.25)] backdrop-blur-xl active:opacity-80 dark:bg-white dark:text-black"
        >
          保存设置
        </button>
      </div>
    </div>
  );
}

// ---------------- 主页面 ----------------

export default function OfflineMeetingPage({ app, channel, contactId, userName, userRealName, userNickname, loadRecentMsgs, onBack, onToast }: OfflineMeetingPageProps) {
  const [contact, setContact] = useState<ContactRecord | null>(null);
  const [contactsAll, setContactsAll] = useState<ContactRecord[]>([]);
  const [loadErr, setLoadErr] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [meet, setMeet] = useState<OfflineMeet | null>(null);
  const [setupSettings, setSetupSettings] = useState<OfflineMeetSettings>(DEFAULT_OFFLINE_SETTINGS);
  const [presets, setPresets] = useState<OfflinePreset[]>(() => loadPresets());
  const [styles, setStyles] = useState<OfflineStyle[]>(() => loadStyles());
  const [tplOv, setTplOv] = useState<string | null>(null);

  const [carryChoice, setCarryChoice] = useState<number | 'custom'>(20);
  const [customN, setCustomN] = useState('20');
  const [availableCount, setAvailableCount] = useState(0);
  const [starting, setStarting] = useState(false);
  const [gen, setGen] = useState<null | 'open' | 'next' | 'reroll'>(null);
  const genRef = useRef(false);
  const meetRef = useRef<OfflineMeet | null>(null);
  const [input, setInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef(loadRecentMsgs);
  loadRef.current = loadRecentMsgs;
  const [toast, showToast] = useLocalToast();
  const toastFn = onToast ?? showToast;

  const shownName = contact?.nickname?.trim() || contact?.name || '对方';
  const userNameEff = userName.trim() || '我';

  // 挂载：加载联系人 / 全量联系人（NPC 圈）/ 进行中的见面 / 设置
  useEffect(() => {
    let on = true;
    void (async () => {
      try {
        const [c, all] = await Promise.all([getContact(contactId), listContacts().catch(() => [] as ContactRecord[])]);
        if (!on) return;
        if (!c) {
          setLoadErr('找不到这个联系人');
          setLoaded(true);
          return;
        }
        setContact(c);
        setContactsAll(all);
        const m = loadMeet(contactId);
        meetRef.current = m;
        setMeet(m);
        const s = m?.settings ?? loadMeetSettings(contactId);
        setSetupSettings(s);
        setTplOv(loadTplOverride(contactId));
        const isBuiltin = (OFFLINE_CARRY_OPTIONS as readonly number[]).includes(s.carryCount);
        setCarryChoice(isBuiltin ? s.carryCount : 'custom');
        setCustomN(String(s.carryCount));
      } catch {
        if (on) setLoadErr('加载失败');
      } finally {
        if (on) setLoaded(true);
      }
    })();
    return () => {
      on = false;
    };
  }, [contactId]);

  // 可承接条数（宿主映射后的可用聊天条数）
  useEffect(() => {
    if (!loaded) return;
    try {
      setAvailableCount(loadRef.current(500).length);
    } catch {
      setAvailableCount(0);
    }
  }, [loaded, contactId]);

  // 新消息自动滚底
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [meet?.entries.length, gen]);

  const settings = meet?.settings ?? setupSettings;
  const charPersonEff = useMemo(() => effectiveCharPerson(settings, contact?.gender), [settings, contact?.gender]);
  const activePreset = presets.find((p) => p.id === settings.presetId) ?? presets[0] ?? null;
  const activeTpl = meet?.template ?? tplOv ?? activePreset?.template ?? OFFLINE_DEFAULT_TEMPLATE;

  /** system prompt：人设 + 世界书 + 记忆召回 + 时间感知 + 线下总纲 */
  const buildSystemPrompt = useCallback(
    (m: OfflineMeet, target: number): string => {
      if (!contact) return '';
      const npcExtra = buildNpcPromptExtra(contact, contactsAll);
      const persona = buildPersonaSystemPrompt(contact as PersonaSource, {
        channel,
        userName: userNameEff,
        userRealName: userRealName ?? null,
        userNickname: userNickname ?? null,
        multiApp: getMemSettings(contactId).share,
        ...(npcExtra ?? {}),
      });
      const recentText = m.entries
        .slice(-2)
        .map((e) => e.text)
        .join(' ');
      const scanText = wbScanText([contact.persona, contact.background, m.onlineExcerpt, recentText]);
      const wb = collectWbBlocks(contactId, scanText, { charName: shownName, userName: userNameEff });
      const wbText = [wb.beforeSystem, wb.afterSystem, wb.beforeChar, wb.afterChar, wb.beforeUser, wb.afterUser]
        .filter((s) => s && s.trim())
        .join('\n\n');
      const mem = memRecallBlock(contactId, app, scanText);
      const time = buildTimeAwareBlock({ lastMsgTime: m.lastOnlineTime ?? null, regionHint: contact.region || null });
      const directive = buildOfflineDirective({
        settings: m.settings,
        charPersonEff,
        charName: shownName,
        userName: userNameEff,
        channel,
        target,
      });
      return [persona, wbText, wbRulesBlock(wb), mem, time, directive].filter((s) => s && s.trim()).join('\n\n');
    },
    [contact, contactsAll, channel, userNameEff, userRealName, userNickname, contactId, app, shownName, charPersonEff],
  );

  /** 世界背景：世界书分析缓存 → LLM 分析 → 角色资料推断 */
  const ensureWorldBg = useCallback(async (): Promise<string> => {
    const cached = loadWbBgCache(contactId);
    if (cached) return cached;
    const scanText = wbScanText([contact?.persona, contact?.background]);
    const wb = collectWbBlocks(contactId, scanText, { charName: shownName, userName: userNameEff });
    const wbRaw = [wb.beforeSystem, wb.afterSystem, wb.beforeChar, wb.afterChar, wb.beforeUser, wb.afterUser]
      .filter((s) => s && s.trim())
      .join('\n\n');
    const localFallback = wbRaw.trim()
      ? `（世界书设定摘录）\n${wbRaw.slice(0, 2500)}`
      : `（未配置世界书）根据角色资料推断：${shownName}${contact?.occupation ? `，${contact.occupation}` : ''}${
          contact?.region ? `，坐标${contact.region}` : ''
        }。${(contact?.background || contact?.persona || '').slice(0, 500)}。世界观以现代日常为主，除非人设或世界书另有说明。`;
    if (!wbRaw.trim()) {
      saveWbBgCache(contactId, localFallback);
      return localFallback;
    }
    try {
      const cfg = useSettings.getState().apiConfig;
      const res = await fetch('/api/offline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: cfg,
          maxTokens: 900,
          messages: [
            {
              role: 'system',
              content:
                '你是世界观分析助手。把给定的世界书设定与角色资料浓缩成一段 200 字以内的客观世界背景描述：世界观类型、时代、地点、关键规则/组织/关系背景。只输出这段描述本身，不要标题、不要列表、不要评论。',
            },
            {
              role: 'user',
              content: `角色：${shownName}\n用户称呼：${userNameEff}\n角色资料：${(contact?.persona || '').slice(0, 600)}\n\n世界书设定：\n${wbRaw.slice(0, 4000)}`,
            },
          ],
        }),
      });
      const data = (await res.json().catch(() => null)) as { text?: unknown } | null;
      const text = typeof data?.text === 'string' ? data.text.trim() : '';
      if (res.ok && text) {
        saveWbBgCache(contactId, text);
        return text;
      }
    } catch {
      // 兜底走本地推断
    }
    return localFallback;
  }, [contactId, contact, shownName, userNameEff]);

  /** 生成（open=开场 / next=继续或用户输入 / reroll=重Roll） */
  const runGen = useCallback(
    async (kind: 'open' | 'next' | 'reroll', fromInput: string) => {
      const m = meetRef.current;
      if (!m || !contact || genRef.current) return;
      genRef.current = true;
      setGen(kind);
      try {
        const s = m.settings;
        const style = styles.find((x) => x.id === s.styleId);
        const target = effectiveReplyTarget(s);
        const cpe = effectiveCharPerson(s, contact.gender);
        const openMode = kind === 'open' || fromInput === '__open__';
        const vars: Record<string, string> = {
          char_name: shownName,
          user_name: userNameEff,
          reply_length: String(target),
          user_person: s.userPerson,
          char_person: cpe,
          world_background: m.worldBg || '（未提供世界背景，以角色人设与现实日常为准）',
          writing_style: style ? `${style.name}：${style.content}` : `${BUILTIN_STYLES[0].name}：${BUILTIN_STYLES[0].content}`,
          scene: `地点：${m.scene.location || '待定'}；时间：${m.scene.time || '延续当前时间'}；缘由：${m.scene.reason || '延续线上聊天'}；${shownName}的状态：${
            m.scene.charState || '延续刚才的情绪'
          }`,
          user_message: openMode ? '（刚见面：请生成这次见面的开场）' : fromInput.trim() || `（让${shownName}自然继续当前场景，推进一点点）`,
          online_chat: m.onlineExcerpt || '（无最近线上聊天记录）',
          offline_history: buildOfflineHistoryText(m, userNameEff, shownName, kind === 'reroll'),
        };
        let rendered = renderTemplate(activeTpl, vars);
        if (openMode) rendered += `\n\n${buildOpenInstruction(shownName, userNameEff)}`;
        const system = buildSystemPrompt(m, target);
        const cfg = useSettings.getState().apiConfig;
        const res = await fetch('/api/offline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: cfg,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: rendered },
            ],
            maxTokens: Math.min(8000, Math.max(1200, target * 2 + 400)),
          }),
        });
        const data = (await res.json().catch(() => null)) as { text?: unknown; error?: string } | null;
        if (!res.ok) throw new Error(data?.error || `生成失败（HTTP ${res.status}）`);
        let text = typeof data?.text === 'string' ? data.text.trim() : '';
        if (!text) throw new Error('生成内容为空，请重试');
        const next: OfflineMeet = { ...m, entries: kind === 'reroll' ? m.entries.slice(0, -1) : [...m.entries] };
        if (openMode) {
          const { scene, body } = extractSceneHeader(text);
          if (scene) next.scene = scene;
          text = body.trim() || text;
        }
        next.entries = [
          ...next.entries,
          { id: offlineUid(), role: 'char', text, at: Date.now(), fromInput: openMode ? '__open__' : fromInput },
        ];
        saveMeet(next);
        meetRef.current = next;
        setMeet(next);
      } catch (e) {
        toastFn(e instanceof Error ? e.message : '生成失败，请重试');
      } finally {
        genRef.current = false;
        setGen(null);
      }
    },
    [contact, styles, activeTpl, shownName, userNameEff, buildSystemPrompt, toastFn],
  );

  /** 开始见面：承接最近 N 条 → 世界背景 → 建会话 → 开场生成 */
  const startMeeting = useCallback(async () => {
    if (starting || genRef.current || !contact) return;
    const n = carryChoice === 'custom' ? Math.min(200, Math.max(5, Math.floor(Number(customN) || 20))) : carryChoice;
    setStarting(true);
    try {
      const msgs = loadRef.current(n);
      const excerpt = msgs
        .map((m) => `${m.role === 'me' ? userNameEff : shownName}：${m.text.trim()}`)
        .join('\n')
        .slice(0, 8000);
      const lastTime = msgs.length ? msgs[msgs.length - 1].time : null;
      const worldBg = await ensureWorldBg();
      const m: OfflineMeet = {
        id: offlineUid(),
        contactId,
        appId: app,
        startedAt: Date.now(),
        carryN: n,
        onlineExcerpt: excerpt,
        lastOnlineTime: lastTime,
        scene: { location: '', time: '', reason: '', charState: '延续刚才的情绪' },
        entries: [],
        settings: setupSettings,
        worldBg,
      };
      saveMeet(m);
      meetRef.current = m;
      setMeet(m);
      void runGen('open', '');
    } catch (e) {
      toastFn(e instanceof Error ? e.message : '开始失败，请重试');
    } finally {
      setStarting(false);
    }
  }, [starting, contact, carryChoice, customN, userNameEff, shownName, ensureWorldBg, contactId, app, setupSettings, runGen, toastFn]);

  /** 保存这次见面 → 记忆库 + 历史 */
  const saveMeeting = useCallback(() => {
    const m = meetRef.current;
    if (!m) return;
    if (genRef.current) {
      toastFn('正在生成，请稍候再保存');
      return;
    }
    const digest = buildMeetDigest(m, userNameEff, shownName);
    memAddEventFragment(contactId, app, digest, { eventTime: Date.now(), sourceTag: 'offline-meet' });
    addMeetToHistory(contactId, m);
    clearMeet(contactId);
    meetRef.current = null;
    setMeet(null);
    toastFn('已保存这次见面，已写入记忆');
  }, [contactId, app, userNameEff, shownName, toastFn]);

  const sendInput = useCallback(() => {
    const t = input.trim();
    if (!t || genRef.current || !meetRef.current) return;
    const m = meetRef.current;
    const next: OfflineMeet = { ...m, entries: [...m.entries, { id: offlineUid(), role: 'user', text: t, at: Date.now() }] };
    saveMeet(next);
    meetRef.current = next;
    setMeet(next);
    setInput('');
    void runGen('next', t);
  }, [input, runGen]);

  const reroll = useCallback(() => {
    const m = meetRef.current;
    if (!m || genRef.current) return;
    const last = m.entries[m.entries.length - 1];
    if (!last || last.role !== 'char') {
      toastFn('没有可重Roll的回复');
      return;
    }
    const from = last.fromInput === '__open__' ? '__open__' : last.fromInput ?? '';
    void runGen('reroll', from);
  }, [runGen, toastFn]);

  // —— 设置面板回调 ——
  const commitSettings = (s: OfflineMeetSettings, tpl: string) => {
    if (meetRef.current) {
      const next: OfflineMeet = { ...meetRef.current, settings: s, template: tpl };
      saveMeet(next);
      meetRef.current = next;
      setMeet(next);
    } else {
      saveMeetSettings(contactId, s);
      saveTplOverride(contactId, tpl);
      setSetupSettings(s);
      setTplOv(tpl);
      const isBuiltin = (OFFLINE_CARRY_OPTIONS as readonly number[]).includes(s.carryCount);
      setCarryChoice(isBuiltin ? s.carryCount : 'custom');
      setCustomN(String(s.carryCount));
    }
    setSettingsOpen(false);
    toastFn('设置已保存');
  };
  const createPreset = (name: string, template: string): string => {
    const id = `preset-${offlineUid()}`;
    const list = [...presets.filter((p) => !p.builtin), { id, name, template, createdAt: Date.now() }];
    saveCustomPresets(list);
    setPresets(loadPresets());
    return id;
  };
  const savePreset = (id: string, template: string) => {
    const list = presets.filter((p) => !p.builtin).map((p) => (p.id === id ? { ...p, template } : p));
    saveCustomPresets(list);
    setPresets(loadPresets());
    toastFn('预设已保存');
  };
  const deletePreset = (id: string) => {
    saveCustomPresets(presets.filter((p) => !p.builtin && p.id !== id));
    setPresets(loadPresets());
    toastFn('预设已删除');
  };
  const createStyle = (name: string, content: string): string => {
    const id = `style-${offlineUid()}`;
    saveCustomStyles([...styles.filter((s) => !s.builtin), { id, name, content, createdAt: Date.now() }]);
    setStyles(loadStyles());
    return id;
  };
  const deleteStyle = (id: string) => {
    saveCustomStyles(styles.filter((s) => !s.builtin && s.id !== id));
    setStyles(loadStyles());
    toastFn('文风已删除');
  };

  // ---------------- 渲染 ----------------

  if (loadErr) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-[#F3F1EE] px-8 text-center dark:bg-[#0C0C0E]">
        <GlassAmbience />
        <p className="text-[15px] text-black/50 dark:text-white/50">{loadErr}</p>
        <button type="button" onClick={onBack} className="mt-4 rounded-full bg-[#1C1C1E]/90 px-5 py-2 text-[14px] font-medium text-white shadow-md backdrop-blur-xl dark:bg-white dark:text-black">
          返回
        </button>
      </div>
    );
  }
  if (!loaded || !contact) {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden bg-[#F3F1EE] dark:bg-[#0C0C0E]">
        <GlassAmbience />
        <Loader2 className="h-6 w-6 animate-spin text-black/30 dark:text-white/30" />
      </div>
    );
  }

  const lastEntry = meet?.entries[meet.entries.length - 1] ?? null;
  const canReroll = !!lastEntry && lastEntry.role === 'char' && !gen;

  return (
    <div className="absolute inset-0 z-50 flex flex-col overflow-hidden bg-[#F3F1EE] text-black dark:bg-[#0C0C0E] dark:text-white" data-testid={`offline-meet-${app}`}>
      <GlassAmbience />
      <LocalToast msg={onToast ? '' : toast} />

      {/* 头部：返回 + 头像名字毛玻璃胶囊 + 收藏/设置 */}
      <div className="flex items-center gap-2 px-4 pb-1.5 pt-[54px]">
        <button
          type="button"
          aria-label="返回聊天"
          onClick={onBack}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-black/70 active:opacity-60 dark:text-white/80 ${GLASS_CAPSULE}`}
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <div className={`flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-3 ${GLASS_CAPSULE}`}>
          <div className="relative shrink-0">
            <MeetAvatar contact={contact} size={30} />
            {meet ? (
              <span className="absolute bottom-0 right-0 h-[9px] w-[9px] rounded-full border-2 border-white bg-[#34C759] dark:border-[#2a2a2c]" aria-hidden="true" />
            ) : null}
          </div>
          <h1 className="truncate text-[15px] font-semibold text-black dark:text-white">{shownName}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {meet ? (
            <button
              type="button"
              aria-label="保存这次见面"
              data-testid="offline-save-star"
              onClick={saveMeeting}
              disabled={!!gen}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-black/70 active:opacity-60 disabled:opacity-40 dark:text-white/80 ${GLASS_CAPSULE}`}
            >
              <Star className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="现场设置"
            data-testid="offline-settings-entry"
            onClick={() => setSettingsOpen(true)}
            className={`flex h-9 w-9 items-center justify-center rounded-full text-black/70 active:opacity-60 dark:text-white/80 ${GLASS_CAPSULE}`}
          >
            <SlidersHorizontal className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* 主体 */}
      {!meet ? (
        /* —— 极简开始页：头像 + 名字 + 开始见面（承接条数在「现场设置」最上方配置） —— */
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-16">
          <div className="flex flex-col items-center gap-2.5">
            <MeetAvatar contact={contact} size={76} />
            <p className="text-[17px] font-semibold text-black/85 dark:text-white/90">{shownName}</p>
          </div>
          <button
            type="button"
            data-testid="offline-start"
            onClick={() => void startMeeting()}
            disabled={starting}
            className="flex h-[52px] items-center justify-center gap-2 rounded-full bg-[#1C1C1E]/90 px-12 text-[16px] font-semibold text-white shadow-[0_10px_30px_rgba(28,28,30,0.28)] backdrop-blur-xl active:opacity-80 disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {starting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Star className="h-5 w-5" strokeWidth={2} />}
            {starting ? '正在准备见面…' : '开始见面'}
          </button>
        </div>
      ) : (
        /* —— 见面进行中 —— */
        <>
          {/* 叙事流 */}
          <div ref={scrollRef} className="mt-3 flex-1 space-y-4 overflow-y-auto px-4 pb-3 thin-scrollbar">
            {meet.entries.map((e) =>
              e.role === 'char' ? (
                <div key={e.id} className={`rounded-[20px] rounded-tl-[8px] p-4 ${GLASS_CARD}`}>
                  <div className="mb-2 flex items-center gap-2">
                    <MeetAvatar contact={contact} size={20} />
                    <span className="text-[12px] font-semibold text-black/55 dark:text-white/60">{shownName}</span>
                    <span className="ml-auto text-[11px] tabular-nums text-black/30 dark:text-white/30">{hhmm(e.at)}</span>
                  </div>
                  <div className="whitespace-pre-wrap text-[15px] leading-[1.95] text-black/85 dark:text-white/85">{e.text}</div>
                </div>
              ) : (
                <div key={e.id} className="flex justify-end">
                  <div className="max-w-[85%]">
                    <div className="whitespace-pre-wrap rounded-[20px] rounded-br-[8px] border border-black/10 bg-[#1C1C1E]/85 px-4 py-2.5 text-[15px] leading-[1.7] text-white shadow-[0_8px_24px_rgba(0,0,0,0.16)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.14]">
                      {e.text}
                    </div>
                    <p className="mt-1 pr-1 text-right text-[10px] tabular-nums text-black/30 dark:text-white/30">{hhmm(e.at)}</p>
                  </div>
                </div>
              ),
            )}
            {gen ? (
              <div className={`flex items-center gap-2 rounded-[20px] rounded-tl-[8px] p-4 text-[14px] text-black/45 dark:text-white/45 ${GLASS_CARD}`}>
                <Loader2 className="h-4 w-4 animate-spin" />
                {gen === 'reroll' ? '重新书写中…' : '正在书写…'}
              </div>
            ) : null}
          </div>

          {/* 底部：操作圆钮分列输入框左右两侧 + 内嵌发送 */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendInput();
            }}
            className="flex items-center gap-1.5 px-3 pb-[30px] pt-1"
          >
            <button
              type="button"
              data-testid="offline-continue"
              aria-label={`让 ${shownName} 继续`}
              title={`让 ${shownName} 继续`}
              onClick={() => void runGen('next', '')}
              disabled={!!gen}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-black/75 active:scale-95 active:opacity-60 disabled:opacity-40 dark:text-white/80 ${GLASS_CAPSULE}`}
            >
              <RotateCcw className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
            <button
              type="button"
              data-testid="offline-reroll"
              aria-label="重 Roll"
              title="重 Roll"
              onClick={reroll}
              disabled={!canReroll}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-black/75 active:scale-95 active:opacity-60 disabled:opacity-40 dark:text-white/80 ${GLASS_CAPSULE}`}
            >
              <RefreshCw className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
            <div className="relative min-w-0 flex-1">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`说点什么，或描述你的动作…`}
                aria-label="线下输入"
                data-testid="offline-input"
                className="h-10 w-full rounded-full border border-white/70 bg-white/60 pl-4 pr-11 text-[14px] text-black shadow-sm outline-none backdrop-blur-xl placeholder:text-black/30 dark:border-white/10 dark:bg-white/[0.08] dark:text-white dark:placeholder:text-white/30"
              />
              <button
                type="submit"
                data-testid="offline-send"
                aria-label="发送"
                title="发送"
                disabled={!input.trim() || !!gen}
                className="absolute inset-y-0 right-[3px] my-auto flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#1C1C1E]/90 text-white shadow-md backdrop-blur-xl active:scale-95 active:opacity-80 disabled:opacity-40 dark:bg-white dark:text-black"
              >
                <Send className="h-4 w-4 -translate-x-px" strokeWidth={2} />
              </button>
            </div>
            <button
              type="button"
              data-testid="offline-save"
              aria-label="保存这次见面"
              title="保存这次见面"
              onClick={saveMeeting}
              disabled={!!gen}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-black/75 active:scale-95 active:opacity-60 disabled:opacity-40 dark:text-white/80 ${GLASS_CAPSULE}`}
            >
              <BookOpen className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          </form>
        </>
      )}

      {/* 现场设置面板 */}
      {settingsOpen ? (
        <OfflineSettingsPanel
          initial={settings}
          presets={presets}
          styles={styles}
          tpl={activeTpl}
          meetActive={!!meet}
          availableCount={availableCount}
          onClose={() => setSettingsOpen(false)}
          onCommit={commitSettings}
          onCreatePreset={createPreset}
          onSavePreset={savePreset}
          onDeletePreset={deletePreset}
          onCreateStyle={createStyle}
          onDeleteStyle={deleteStyle}
        />
      ) : null}
    </div>
  );
}
