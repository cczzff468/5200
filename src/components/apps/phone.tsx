'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock as ClockIcon,
  Delete,
  Info,
  Loader2,
  Mail,
  Mic,
  MicOff,
  Minus,
  MessageSquare,
  Pause,
  Phone as PhoneIcon,
  PhoneOff,
  Play,
  Plus,
  Search,
  Star,
  Trash2,
  UserPlus,
  UserRound,
  Users as UsersIcon,
  Video,
  Voicemail as VoicemailIcon,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';
import { DefaultAvatar } from '@/components/apps/default-avatar';
import { IOSActionSheet } from '@/components/ios/ActionSheet';
import { useSettings, useUI } from '@/lib/ios/store';
import { phoneBadge } from '@/lib/unread-store';
import { directChatStream } from '@/lib/ios/direct-api';
import { localDB, genId, formatDuration, type CallLogRecord, type VoicemailRecord } from '@/lib/ios/db';
import { createContact, deleteContact as deleteContactLocal, listContacts, updateContact } from '@/lib/ios/contacts-store';
import { buildNpcPromptExtra } from '@/lib/ios/npc-bond';
import { memAfterAiTurn, memConvoFromRaw, memLastMsgId, memRecallBlock } from '@/lib/memory';
import { getTimeAware, buildTimeAwareBlock } from '@/lib/time-aware';
import type { ContactRecord } from '@/lib/contacts';

/**
 * 电话 App（iOS 电话风格）：
 * - 五个底部 tab（iOS 18 悬浮胶囊样式）：个人收藏 / 通话记录 / 通讯录 / 键盘 / 语音留言
 * - 导航栏：紧凑居中小标题与左侧「返回主屏幕」键同行对齐；键盘 tab 左上「主号」徽章 + 右上新建联系人钮
 * - 通讯录：右上「+」新建联系人（iOS 新建联系人界面：X/✓/大头像/添加照片/姓·名字·公司/手机，保存后自动加为好友）；
 *   点行进「联系人详情页」（大头像 + 信息/视频/电话/邮件操作钮 + 详细信息/语音留言胶囊分段 + 通话记录卡片 + 快捷编辑）；
 *   点「信息」跨 App 跳转到信息 App 对应会话（相当于添加好友，经 useUI.pendingChatContact）
 * - 拨号键盘：大圆键 + DTMF 按键音 + 号码分组显示 + 按号码匹配联系人；退格在呼叫钮右侧
 * - 陌生号码拨打：运营商播报「您拨打的号码是空号」后自动挂断，只留一条「空号」通话记录（无留言）
 * - 语音留言：列表只显示联系人/类型/时长（不剧透内容），点行进详情页回看完整谈话内容；
 *   拨号中挂断（对方未接听）自动生成对端留言；已接通挂断自动存档整通对话内容（kind='call'，永久保存），
 *   TTS 播报 / 已读未读 / 删除，未读数红点角标
 * - 通话全屏层：深色渐变 + 大头像 + 状态 + 逐句字幕气泡 + 六宫格控制（静音/键盘/扬声器…，打字输入时自动收起）+ 红色挂断
 * - AI 语音通话：点按说话 → 录音 → /api/phone/asr 识别 → /api/phone/turn（统一使用设置 App
 *   「API 设置」里配置的模型，按联系人人设回应；公网由服务器转发、内网自动浏览器直连，无内置模型）
 *   → /api/phone/tts 合成语音播放；麦克风不可用/识别失败可切换键盘文字输入
 * - 音效：呼叫等待回铃音（450Hz 中国铃流节奏）、接通提示音、挂断提示音，全部 WebAudio 合成
 * - 通话记录持久化 IndexedDB call-logs（DB v3），语音留言持久化 voicemails（DB v4），个人收藏持久化 settings key=phoneFavorites
 */

type PhoneTab = 'favorites' | 'recents' | 'contacts' | 'keypad' | 'voicemail';

interface CallTarget {
  number: string;
  contact: ContactRecord | null;
}

interface CallBubble {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** 字幕产生时间（epoch ms）—— 时间感知用它计算通话内的说话间隔 */
  t: number;
}

const KEYS: { digit: string; letters: string }[] = [
  { digit: '1', letters: '' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*', letters: '' },
  { digit: '0', letters: '+' },
  { digit: '#', letters: '' },
];

/** DTMF 双音频频率表（ITU-T Q.23） */
const DTMF_FREQ: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
};

const FAV_KEY = 'phoneFavorites';

function stripDigits(s: string): string {
  return s.replace(/\D/g, '');
}

/** 号码显示分组：11 位手机号 3-4-4，其余原样 */
function formatNumber(raw: string): string {
  const d = stripDigits(raw);
  if (raw.startsWith('+') || raw.includes('+')) return raw;
  if (d.length === 11) return `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`;
  if (d.length === 8) return `${d.slice(0, 4)} ${d.slice(4)}`;
  return raw;
}

/** 通话时长（秒）→ "1:23" / "0:05"（沿用全局 m:ss） */
function callDurationText(seconds: number): string {
  if (seconds <= 0) return '';
  return formatDuration(seconds);
}

/** 日志时间：今天 HH:mm / 昨天 / 一周内周X / 跨年 YYYY/M/d / M月d日 */
function formatLogTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (days === 1) return '昨天';
  if (days < 7) return `周${'日一二三四五六'[d.getDay()]}`;
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 列表副标题：联系人/个人收藏等列表不显示类型（只显示关系/职业） */
function listSubtitle(c: ContactRecord): string {
  return c.relation?.trim() || c.occupation?.trim() || '';
}

/** 详情页副标题：只显示关系/职业（不显示 char/npc/user 类型字样） */
function detailSubtitle(c: ContactRecord): string {
  return listSubtitle(c);
}

/** 联系人性别 → TTS 声线（男 / 非男 / 未知） */
function contactGender(c: ContactRecord | null): 'male' | 'female' | null {
  if (!c?.gender) return null;
  return c.gender.includes('男') ? 'male' : 'female';
}

/** 未接通时对端转接语音信箱的留言内容（贴近联系人人设的口语化模板） */
function buildVoicemailText(c: ContactRecord | null): string {
  if (!c || c.kind === 'user') return '您好，您拨打的用户暂时无法接听，请在滴声后留言，再见。';
  const rel = c.relation?.trim() || c.occupation?.trim() || '';
  const who = rel || c.name;
  return `喂，是我呀，${who}。刚才没接到你电话，不好意思哈。有什么事就留言吧，我看到马上回你。`;
}

function AvatarBubble({ contact, size, className = '' }: { contact: ContactRecord | null; size: number; className?: string }) {
  if (contact?.avatar) {
    return (
      <span className={`inline-flex shrink-0 overflow-hidden rounded-full ${className}`} style={{ width: size, height: size }}>
        <img src={contact.avatar} alt={contact.name ? `${contact.name}的头像` : '头像'} className="h-full w-full object-cover" />
      </span>
    );
  }
  return <DefaultAvatar size={size} className={className} />;
}

// ---------------- 号码匹配（电话 ↔ 联系人联动） ----------------

/** 号码归一化：去非数字；13 位 86 开头去国码；12 位 0 开头去长途前缀（+86/空格/横线均可对上） */
function phoneKey(raw: string): string {
  let d = stripDigits(raw);
  if (d.length === 13 && d.startsWith('86')) d = d.slice(2);
  if (d.length === 12 && d.startsWith('0')) d = d.slice(1);
  return d;
}

/** 按「联系人里填的电话」匹配出对应人 */
function findContactByNumber(contacts: ContactRecord[], raw: string): ContactRecord | null {
  const key = phoneKey(raw);
  if (!key) return null;
  return contacts.find((c) => c.phone && phoneKey(c.phone) === key) ?? null;
}

// ---------------- 拼音首字母分组（通讯录 A-Z 索引） ----------------

const PINYIN_COLLATOR = new Intl.Collator('zh-Hans-CN');
let pinyinSupported: boolean | null = null;

/**
 * 运行时探测 zh 排序是否按拼音（「一yī」应排在「起qǐ」之后；笔画排序则相反）。
 * 注意：部分 ICU 构建中汉字整体排在拉丁字母之前（compare('啊','z')<0），
 * 因此不能用「与字母比较」定位分组，须用下面一组汉字锚点两两比较。
 */
function chinesePinyinOK(): boolean {
  if (pinyinSupported === null) {
    try {
      pinyinSupported = PINYIN_COLLATOR.compare('啊', '八') < 0 && PINYIN_COLLATOR.compare('一', '起') > 0;
    } catch {
      pinyinSupported = false;
    }
  }
  return pinyinSupported;
}

/** 各字母的拼音锚点字（每个字读音唯一；跳过 I/U/V，与 iOS 中文索引一致） */
const LETTER_ANCHORS: [letter: string, anchor: string][] = [
  ['A', '啊'], ['B', '八'], ['C', '擦'], ['D', '搭'], ['E', '蛾'], ['F', '发'], ['G', '噶'],
  ['H', '哈'], ['J', '击'], ['K', '喀'], ['L', '垃'], ['M', '妈'], ['N', '拿'], ['O', '哦'],
  ['P', '啪'], ['Q', '期'], ['R', '然'], ['S', '撒'], ['T', '塌'], ['W', '挖'], ['X', '昔'],
  ['Y', '压'], ['Z', '匝'],
];

function sectionLetter(name: string): string {
  const c = (name || '?').trim().charAt(0);
  const up = c.toUpperCase();
  if (up >= 'A' && up <= 'Z') return up;
  if (!c || c.charCodeAt(0) < 0x2e80 || !chinesePinyinOK()) return '#';
  let letter = '#';
  for (const [l, anchor] of LETTER_ANCHORS) {
    if (PINYIN_COLLATOR.compare(name, anchor) >= 0) letter = l;
    else break;
  }
  return letter;
}

// ---------------- iOS 通用小组件（搜索框 / 分段控件 / 拨号键盘图标） ----------------

function IOSSearch({ value, onChange, placeholder = '搜索' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex h-[36px] items-center gap-1.5 rounded-[10px] bg-muted px-2.5">
      <Search className="h-[16px] w-[16px] shrink-0 text-muted-foreground/70" strokeWidth={2.2} aria-hidden="true" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground/70"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="清空搜索"
          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-muted-foreground/40 text-background"
        >
          <X className="h-3 w-3" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

function IOSSegmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex h-[32px] w-full rounded-[9px] bg-muted p-[2px]">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={`flex-1 rounded-[7px] text-[13px] font-medium leading-none transition-colors ${
            value === o.key
              ? 'bg-background text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.12)]'
              : 'text-muted-foreground active:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** iOS 拨号键盘图标（3×3 圆点，与系统电话一致） */
function DialpadIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      {[5, 12, 19].map((y) =>
        [5, 12, 19].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={2.1} />)
      )}
    </svg>
  );
}

// ---------------- WebAudio 音效（回铃音 / DTMF / 提示音） ----------------

let audioCtxSingleton: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    if (typeof window === 'undefined') return null;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtxSingleton) audioCtxSingleton = new Ctx();
    if (audioCtxSingleton.state === 'suspended') void audioCtxSingleton.resume();
    return audioCtxSingleton;
  } catch {
    return null;
  }
}

/** 播放一段单频正弦音（gain 包络防爆音） */
function playTone(freq: number, durationMs: number, volume = 0.05, delayMs = 0, freq2?: number): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime + delayMs / 1000;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.02);
  gain.gain.setValueAtTime(volume, t0 + durationMs / 1000 - 0.03);
  gain.gain.linearRampToValueAtTime(0, t0 + durationMs / 1000);
  gain.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.connect(gain);
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000 + 0.05);
  if (freq2) {
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq2;
    osc2.connect(gain);
    osc2.start(t0);
    osc2.stop(t0 + durationMs / 1000 + 0.05);
  }
}

function playDtmf(key: string): void {
  const f = DTMF_FREQ[key];
  if (f) playTone(f[0], 140, 0.06, 0, f[1]);
}

/**
 * 呼叫等待回铃音：450Hz，响 1s 停 4s（中国铃流节奏），循环直到 stop。
 * 用 setInterval 每轮触发 1s 的 tone。
 */
class RingbackTone {
  private timer: number | null = null;
  start(): void {
    this.stop();
    playTone(450, 1000, 0.045);
    this.timer = window.setInterval(() => playTone(450, 1000, 0.045), 5000);
  }
  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/** 接通提示音（短双音上扬） */
function playConnectBlip(): void {
  playTone(600, 120, 0.05);
  playTone(900, 160, 0.05, 130);
}

/** 挂断提示音（短促降调） */
function playHangupBlip(): void {
  playTone(600, 180, 0.05);
  playTone(380, 240, 0.05, 190);
}

// ---------------- 录音 → 16kHz 单声道 WAV base64 ----------------

/** 本机选图 → canvas 居中裁剪压缩成 240px JPEG dataURL（与联系人 App 同款，控制入库体积） */
function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload = () => {
        const SIZE = 240;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('画布不可用'));
          return;
        }
        const scale = Math.max(SIZE / img.width, SIZE / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

async function blobToWavBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error('浏览器不支持音频解码');
  const ctx = new Ctx();
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(buf);
  } finally {
    void ctx.close();
  }
  const srcRate = audio.sampleRate;
  const dstRate = 16000;
  const len = Math.max(1, Math.ceil((audio.length * dstRate) / srcRate));
  const out = new Float32Array(len);
  const chans: Float32Array[] = [];
  for (let i = 0; i < audio.numberOfChannels; i++) chans.push(audio.getChannelData(i));
  for (let i = 0; i < len; i++) {
    const srcIdx = (i * srcRate) / dstRate;
    const i0 = Math.floor(srcIdx);
    const frac = srcIdx - i0;
    let s = 0;
    for (const ch of chans) {
      const a = ch[i0] ?? 0;
      const b = ch[i0 + 1] ?? a;
      s += a + (b - a) * frac;
    }
    out[i] = s / chans.length;
  }
  const wavBuf = new ArrayBuffer(44 + len * 2);
  const v = new DataView(wavBuf);
  const writeStr = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + len * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, dstRate, true);
  v.setUint32(28, dstRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  writeStr(36, 'data');
  v.setUint32(40, len * 2, true);
  let off = 44;
  for (let i = 0; i < len; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, out[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(wavBuf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

// ---------------- 通话全屏层 ----------------

type CallPhase = 'dialing' | 'connected' | 'ended';
type PeerStatus = 'ringing' | 'thinking' | 'speaking' | 'listening';

function CallScreen({
  target,
  onEnd,
  onVoicemail,
  onClose,
}: {
  target: CallTarget;
  onEnd: (log: CallLogRecord) => void;
  onVoicemail: (vm: VoicemailRecord) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<CallPhase>('dialing');
  const [seconds, setSeconds] = useState(0);
  const [bubbles, setBubbles] = useState<CallBubble[]>([]);
  const [peerStatus, setPeerStatus] = useState<PeerStatus>('ringing');
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [dtmf, setDtmf] = useState('');
  const [textMode, setTextMode] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false); // ASR/LLM/TTS 链路进行中
  const [error, setError] = useState('');
  /** 空号：拨打的号码不在联系人里，运营商播报「空号」后自动挂断 */
  const [emptyNumber, setEmptyNumber] = useState(false);

  const endedRef = useRef(false);
  const emptyRef = useRef(false);
  const ringRef = useRef<RingbackTone | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const secondsRef = useRef(0);
  const phaseRef = useRef<CallPhase>('dialing');
  const bubblesRef = useRef<CallBubble[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const setCallActive = useUI((s) => s.setCallActive);
  // 设置 App「API 设置」里的 OpenAI 兼容接口配置（通话 AI 对话走该配置）
  const apiConfig = useSettings((s) => s.apiConfig);

  phaseRef.current = phase;
  bubblesRef.current = bubbles;

  const contact = target.contact;
  const gender = useMemo(() => contactGender(contact), [contact]);

  /** TTS 播放一句（失败静默降级：字幕仍在） */
  const speak = useCallback(
    async (text: string) => {
      setPeerStatus('speaking');
      try {
        const res = await fetch('/api/phone/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, gender }),
        });
        if (!res.ok) throw new Error('tts failed');
        const blob = await res.blob();
        if (endedRef.current) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume = speaker ? 1 : 0.45;
        audioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (audioRef.current === audio) audioRef.current = null;
          if (!endedRef.current) setPeerStatus('listening');
        };
        await audio.play().catch(() => {
          URL.revokeObjectURL(url);
          if (audioRef.current === audio) audioRef.current = null;
          if (!endedRef.current) setPeerStatus('listening');
        });
      } catch {
        if (!endedRef.current) setPeerStatus('listening');
      }
    },
    [gender, speaker]
  );

  /** 发起一轮 AI 对话（userText = 用户刚说的话；greeting = 接通问候） */
  const runTurn = useCallback(
    async (userText: string | null) => {
      setError('');
      // 自己的号码（user）：对方不说话、也不用回复 —— 发出去的话只留字幕
      if (contact?.kind === 'user') {
        if (userText) {
          setBubbles((b) => [...b, { id: genId(), role: 'user' as const, text: userText, t: Date.now() }]);
        }
        setPeerStatus('listening');
        return;
      }
      setPeerStatus('thinking');
      const historyBefore: CallBubble[] = userText
        ? [...bubblesRef.current, { id: genId(), role: 'user' as const, text: userText, t: Date.now() }]
        : bubblesRef.current;
      if (userText) {
        setBubbles((b) => [...b, historyBefore[historyBefore.length - 1]]);
      }
      setBusy(true);
      // 记忆库：本轮对话结束后的轮次计数与自动提取（后台异步，失败静默）；
      // 请求前先召回该联系人（互通开关范围）的记忆注入 system（服务端拼到人设后）
      const memoryBlock = contact?.id ? memRecallBlock(contact.id, 'phone', userText ?? '') : undefined;
      // 时间感知（按联系人独立开关，发送时现场读取；关闭时不注入）：
      // 上次聊天间隔 = 通话内上一条字幕时间戳；本轮是通话第一句时退回最近一次接通的通话记录时间
      const priorBubbles = bubblesRef.current;
      let lastChatTime: number | null = priorBubbles.length > 0 ? priorBubbles[priorBubbles.length - 1].t : null;
      if (!lastChatTime && contact?.id) {
        try {
          const logs = await localDB.getAll('call-logs');
          const last = logs
            .filter((l) => l.contactId === contact.id && l.duration > 0)
            .sort((a, b) => b.createdAt - a.createdAt)[0];
          lastChatTime = last?.createdAt ?? null;
        } catch {
          lastChatTime = null;
        }
      }
      const timeBlock =
        contact?.id && getTimeAware(`phone:${contact.id}`)
          ? buildTimeAwareBlock({ lastMsgTime: lastChatTime, regionHint: contact.region || null })
          : '';
      const memorizeTurn = (reply: string) => {
        if (!contact?.id) return;
        const turns = memConvoFromRaw(
          historyBefore.map((m) => ({ role: m.role, text: m.text })),
          ''
        );
        turns.push({ role: 'peer', text: reply });
        memAfterAiTurn(contact.id, 'phone', apiConfig, () => turns, () => {
          const last = historyBefore[historyBefore.length - 1];
          return last ? String(last.id) : undefined;
        });
      };
      try {
        // 配角圈注入（CHAR=认识的配角，NPC=归属者资料卡；需要全部联系人现场查一次，失败回退无注入）
        const npcExtra = contact
          ? await listContacts()
              .then((all) => buildNpcPromptExtra(contact, all))
              .catch(() => null)
          : null;
        const res = await fetch('/api/phone/turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // 联系人资料由前端直传（本地 IndexedDB，服务端不查库）
            contact: contact
              ? {
                  name: contact.name,
                  kind: contact.kind,
                  gender: contact.gender,
                  age: contact.age,
                  occupation: contact.occupation,
                  region: contact.region,
                  relation: contact.relation,
                  relationToUser: contact.relationToUser ?? null,
                  birthday: contact.birthday ?? null,
                  persona: contact.persona,
                  background: contact.background,
                  ...(npcExtra ?? {}),
                }
              : undefined,
            number: target.number,
            greeting: userText === null,
            history: historyBefore.map((m) => ({ role: m.role, content: m.text })),
            memoryBlock,
            // 时间感知块（前端按联系人开关现场构建；服务端拼到人设+记忆之后）
            timeBlock,
            // 设置 App「API 设置」的配置：服务端优先用它调用户自己的 API
            config: apiConfig,
          }),
        });
        const data = (await res.json()) as {
          reply?: string;
          error?: string;
          directOnly?: boolean;
          messages?: { role: 'system' | 'user' | 'assistant'; content: string }[];
        };
        if (endedRef.current) return;
        // 内网 / 本机 API：云端服务器不可达 → 浏览器直连（与信息 App 一致），
        // 字幕随流式增量逐字上屏，完成后 TTS 播报
        if (res.ok && data.directOnly && Array.isArray(data.messages) && data.messages.length > 0) {
          const bubbleId = genId();
          setBubbles((b) => [...b, { id: bubbleId, role: 'assistant' as const, text: '', t: Date.now() }]);
          try {
            const full = await directChatStream(apiConfig, data.messages, (delta) => {
              setBubbles((b) =>
                b.map((x) => (x.id === bubbleId ? { ...x, text: x.text + delta } : x))
              );
            });
            if (endedRef.current) return;
            const reply = full
              .replace(/[*_`#>~[\]]/g, '')
              .replace(/^["'「『]+|["'」』]+$/g, '')
              .trim();
            if (!reply) {
              setBubbles((b) => b.filter((x) => x.id !== bubbleId));
              setError('对方没有回应，请稍后再试');
              setPeerStatus('listening');
              return;
            }
            setBubbles((b) => b.map((x) => (x.id === bubbleId ? { ...x, text: reply } : x)));
            memorizeTurn(reply);
            await speak(reply);
          } catch (err) {
            if (endedRef.current) return;
            setBubbles((b) => b.filter((x) => x.id !== bubbleId));
            setError(err instanceof Error && err.message ? err.message : '对方信号不好，稍后再试');
            setPeerStatus('listening');
          }
          return;
        }
        if (!res.ok || !data.reply) {
          setError(data.error || '对方信号不好，稍后再试');
          setPeerStatus('listening');
          return;
        }
        const reply = data.reply;
        setBubbles((b) => [...b, { id: genId(), role: 'assistant', text: reply, t: Date.now() }]);
        memorizeTurn(reply);
        await speak(reply);
      } catch (err) {
        if (!endedRef.current) {
          const msg = err instanceof Error && err.message ? err.message : '';
          setError(
            /failed to fetch|networkerror|load failed/i.test(msg)
              ? '通话网络异常，请稍后再试'
              : msg || '通话网络异常，请稍后再试'
          );
          setPeerStatus('listening');
        }
      } finally {
        if (!endedRef.current) setBusy(false);
      }
    },
    [contact, target.number, speak, apiConfig]
  );

  // 挂断（保存记录 → ended → 回调关闭）
  const hangup = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    ringRef.current?.stop();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    try {
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.stop();
      }
    } catch {
      // 已停止
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    playHangupBlip();
    const phaseAtEnd = phaseRef.current;
    const wasConnected = phaseAtEnd === 'connected';
    // 空号（号码不在联系人里）：只记一条「空号」记录，不产生任何语音留言；
    // 拨号中挂断 = 对方未接听 → 对端「转接语音信箱」，自动生成一条语音留言；
    // 已接通挂断 → 把整通电话的对话内容存进语音留言（永久保存，可随时回听回看）
    const isEmpty = emptyRef.current;
    const unanswered = phaseAtEnd === 'dialing' && !isEmpty;
    const vmText = unanswered ? buildVoicemailText(contact) : '';
    const transcript =
      !unanswered && bubblesRef.current.length > 0
        ? bubblesRef.current
            .map((b) => `${b.role === 'user' ? '我' : contact?.name || '对方'}：${b.text}`)
            .join('\n')
        : '';
    setPhase('ended');
    setPeerStatus('listening');
    setRecording(false);
    onEnd({
      id: genId(),
      number: target.number,
      contactId: contact?.id ?? null,
      displayName: isEmpty ? '空号' : (contact?.name ?? '陌生号码'),
      peerKind: contact ? (contact.kind as CallLogRecord['peerKind']) : 'unknown',
      avatar: contact?.avatar ?? null,
      direction: 'out',
      duration: wasConnected ? secondsRef.current : 0,
      createdAt: Date.now(),
    });
    if (unanswered) {
      onVoicemail({
        id: genId(),
        number: target.number,
        contactId: contact?.id ?? null,
        displayName: contact?.name ?? '陌生号码',
        peerKind: contact ? (contact.kind as VoicemailRecord['peerKind']) : 'unknown',
        avatar: contact?.avatar ?? null,
        text: vmText,
        duration: Math.max(3, Math.ceil(vmText.length / 3.2)),
        read: false,
        createdAt: Date.now(),
      });
    } else if (transcript) {
      onVoicemail({
        id: genId(),
        number: target.number,
        contactId: contact?.id ?? null,
        displayName: contact?.name ?? '陌生号码',
        peerKind: contact ? (contact.kind as VoicemailRecord['peerKind']) : 'unknown',
        avatar: contact?.avatar ?? null,
        text: transcript,
        duration: secondsRef.current,
        read: true,
        createdAt: Date.now(),
        kind: 'call',
      });
    }
    window.setTimeout(onClose, 1100);
  }, [contact, target.number, onEnd, onVoicemail, onClose]);
  /** 空号播报结束后的自动挂断要走最新的 hangup（mount effect 里引用） */
  const hangupRef = useRef<() => void>(() => {});
  hangupRef.current = hangup;

  // 挂载：白前景标记 + 回铃音；联系人 → 随机 1.4~2.6s 接通问候；陌生号码 → 运营商播报「空号」后自动挂断
  useEffect(() => {
    setCallActive(true);
    endedRef.current = false;
    emptyRef.current = false;
    const ring = new RingbackTone();
    ring.start();
    ringRef.current = ring;
    let fallbackTimer: number | undefined;
    // 空号：响铃约 2.4~3.2s → TTS 播报「您拨打的号码是空号」→ 播完自动挂断
    const emptyTimer = contact
      ? undefined
      : window.setTimeout(
          () => {
            if (endedRef.current) return;
            ring.stop();
            emptyRef.current = true;
            setEmptyNumber(true);
            void (async () => {
              try {
                const res = await fetch('/api/phone/tts', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ text: '您好，您拨打的号码是空号，请查证后再拨。', gender: null }),
                });
                if (!res.ok || endedRef.current) throw new Error('tts failed');
                const blob = await res.blob();
                if (endedRef.current) return;
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                audioRef.current = audio;
                audio.onended = () => {
                  URL.revokeObjectURL(url);
                  if (audioRef.current === audio) audioRef.current = null;
                  if (!endedRef.current) hangupRef.current();
                };
                await audio.play().catch(() => {
                  URL.revokeObjectURL(url);
                  if (!endedRef.current) hangupRef.current();
                });
              } catch {
                if (!endedRef.current) fallbackTimer = window.setTimeout(() => hangupRef.current(), 2400);
              }
            })();
          },
          2300 + Math.random() * 900
        );
    // 联系人：响铃后接通 → AI 问候（自己的号码 user 接通但不说话、不回复）
    const timer = contact
      ? window.setTimeout(() => {
          if (endedRef.current) return;
          ring.stop();
          playConnectBlip();
          setPhase('connected');
          secondsRef.current = 0;
          setSeconds(0);
          if (contact.kind !== 'user') void runTurn(null);
          else setPeerStatus('listening');
        }, 1400 + Math.random() * 1200)
      : undefined;
    return () => {
      endedRef.current = true;
      window.clearTimeout(timer);
      window.clearTimeout(emptyTimer);
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
      ring.stop();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setCallActive(false);
    };
  }, []);

  // 接通后计时
  useEffect(() => {
    if (phase !== 'connected') return;
    const timer = window.setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  // 字幕自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bubbles, phase]);

  // 开始/停止录音
  const toggleRecording = useCallback(async () => {
    if (phase !== 'connected' || busy) return;
    if (recording) {
      try {
        recorderRef.current?.stop();
      } catch {
        // 忽略
      }
      return;
    }
    setError('');
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        setRecording(false);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (endedRef.current) return;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (blob.size < 1200) {
          setError('没听到声音，请再试一次');
          return;
        }
        setBusy(true);
        setPeerStatus('thinking');
        try {
          const b64 = await blobToWavBase64(blob);
          const res = await fetch('/api/phone/asr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioBase64: b64 }),
          });
          const data = (await res.json()) as { text?: string; error?: string };
          if (endedRef.current) return;
          if (!res.ok || !data.text) {
            setError(data.error || '没有听清，请用键盘输入');
            setTextMode(true);
            setPeerStatus('listening');
            return;
          }
          setBusy(false);
          await runTurn(data.text);
        } catch {
          if (!endedRef.current) {
            setError('语音识别失败，请用键盘输入');
            setTextMode(true);
            setPeerStatus('listening');
          }
        } finally {
          if (!endedRef.current) setBusy(false);
        }
      };
      recorder.start();
      setRecording(true);
    } catch {
      setError('麦克风不可用，请用键盘输入文字');
      setTextMode(true);
    }
  }, [phase, busy, recording, runTurn]);

  const sendText = useCallback(() => {
    const text = draft.trim();
    if (!text || phase !== 'connected' || busy) return;
    setDraft('');
    void runTurn(text);
  }, [draft, phase, busy, runTurn]);

  const statusText = (): string => {
    if (emptyNumber) return '您拨打的号码是空号';
    if (phase === 'dialing') return '正在呼叫…';
    if (phase === 'ended') return '通话结束';
    if (peerStatus === 'speaking') return '正在说话…';
    if (peerStatus === 'thinking' || busy) return '…';
    if (recording) return '正在聆听，再点一下发送';
    return callDurationText(seconds);
  };

  // 陌生号码：标题直接显示拨打的号码（iOS 一致）；空号后状态行提示
  const name = contact?.name || formatNumber(target.number);
  /** 正在打字输入：静音/键盘/扬声器等六宫格按钮自动消失，给软键盘腾地方 */
  const typing = textMode && (inputFocused || draft.trim().length > 0);
  const controlBtn = (icon: React.ReactNode, label: string, active: boolean, onClick: () => void, disabled = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || phase !== 'connected'}
      className="flex flex-col items-center gap-1.5 transition-opacity active:opacity-60 disabled:opacity-40"
      aria-pressed={active}
    >
      <span
        className={`flex h-[64px] w-[64px] items-center justify-center rounded-full backdrop-blur-md transition-colors ${
          active ? 'bg-white text-black' : 'bg-white/15 text-white'
        }`}
      >
        {icon}
      </span>
      <span className="text-[12px] text-white/85">{label}</span>
    </button>
  );

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col overflow-hidden bg-gradient-to-b from-[#3a3a41] via-[#232327] to-[#0b0b0d] text-white"
      role="dialog"
      aria-label={`与${name}的通话界面`}
      data-testid="call-screen"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.08),transparent_55%)]" />

      {/* 顶部：头像 + 名字 + 状态 */}
      <div className="relative z-10 flex flex-col items-center px-6 pb-2 pt-[74px]">
        <div className="relative">
          {phase === 'dialing' && !emptyNumber && (
            <span className="absolute inset-0 animate-ping rounded-full bg-white/20" aria-hidden="true" />
          )}
          <AvatarBubble contact={contact} size={92} className="relative shadow-2xl ring-2 ring-white/25" />
          {peerStatus === 'speaking' && (
            <span className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-end gap-[3px] rounded-full bg-black/50 px-2.5 py-1.5 backdrop-blur-md" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="w-[3px] animate-pulse rounded-full bg-[#34C759]"
                  style={{ height: 6 + (i % 3) * 4, animationDelay: `${i * 140}ms`, animationDuration: '700ms' }}
                />
              ))}
            </span>
          )}
        </div>
        <h2 className="mt-3 max-w-[300px] truncate text-[26px] font-semibold leading-tight">{name}</h2>
        <p className="mt-0.5 flex items-center gap-1.5 text-[14px] text-white/70 tabular-nums" aria-live="polite" data-testid="call-status">
          {phase === 'ended' ? (
            '通话结束'
          ) : emptyNumber ? (
            <PhoneOff className="h-4 w-4 text-[#FF453A]" aria-hidden="true" />
          ) : peerStatus === 'speaking' ? (
            <AudioLines className="h-4 w-4 animate-pulse text-[#34C759]" aria-hidden="true" />
          ) : null}
          {statusText()}
        </p>
        {error && (
          <p className="mt-2 max-w-[320px] rounded-full bg-red-500/20 px-3.5 py-1 text-center text-[12.5px] text-red-200" role="alert">
            {error}
          </p>
        )}
      </div>

      {/* 字幕区 */}
      <div ref={scrollRef} className="relative z-10 flex-1 space-y-2 overflow-y-auto no-scrollbar px-5 py-3" aria-label="通话字幕">
        {bubbles.length === 0 && phase === 'dialing' && !emptyNumber && (
          <p className="mt-6 text-center text-[13px] text-white/40">等待对方接听…</p>
        )}
        {bubbles.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <p
              className={`max-w-[78%] rounded-[18px] px-3.5 py-2 text-[14.5px] leading-snug ${
                m.role === 'user' ? 'rounded-br-[6px] bg-[#34C759]/25 text-white' : 'rounded-bl-[6px] bg-white/12 text-white/95'
              }`}
            >
              {m.text}
            </p>
          </div>
        ))}
      </div>

      {/* 通话中 DTMF 键盘浮层 */}
      {keypadOpen && (
        <div className="absolute inset-0 z-20 flex flex-col bg-black/70 pt-[80px] backdrop-blur-xl">
          <p className="min-h-[36px] px-6 text-center text-[24px] font-light tracking-[0.3em] text-white/90 tabular-nums">{dtmf}</p>
          <div className="mx-auto mt-4 grid w-[280px] grid-cols-3 gap-x-6 gap-y-4">
            {KEYS.map((k) => (
              <button
                key={k.digit}
                type="button"
                onClick={() => {
                  playDtmf(k.digit);
                  setDtmf((s) => (s.length > 20 ? s : s + k.digit));
                }}
                className="mx-auto flex h-[72px] w-[72px] flex-col items-center justify-center rounded-full bg-white/15 backdrop-blur-md transition-colors active:bg-white/35"
              >
                <span className="text-[28px] font-light leading-none">{k.digit}</span>
                {k.letters && <span className="mt-0.5 text-[9px] tracking-[0.18em] text-white/70">{k.letters}</span>}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setKeypadOpen(false)}
            className="mx-auto mt-6 rounded-full bg-white/15 px-6 py-2 text-[15px] text-white backdrop-blur-md active:bg-white/30"
          >
            隐藏
          </button>
          <div className="flex-1" />
        </div>
      )}

      {/* 控制区（打字输入时自动收起，六宫格按钮消失） */}
      <div
        className={`relative z-10 shrink-0 overflow-hidden px-8 transition-all duration-300 ease-out ${
          typing
            ? 'pointer-events-none max-h-0 -translate-y-2 scale-[0.98] opacity-0'
            : 'max-h-[240px] translate-y-0 scale-100 opacity-100'
        }`}
        aria-hidden={typing}
      >
        {phase !== 'ended' && (
          <div className="grid grid-cols-3 gap-y-5 pb-1">
            {controlBtn(muted ? <MicOff className="h-[22px] w-[22px]" /> : <Mic className="h-[22px] w-[22px]" />, '静音', muted, () => setMuted((v) => !v))}
            {controlBtn(<DialpadIcon className="h-[22px] w-[22px]" />, '键盘', keypadOpen, () => setKeypadOpen((v) => !v))}
            {controlBtn(speaker ? <Volume2 className="h-[22px] w-[22px]" /> : <VolumeX className="h-[22px] w-[22px]" />, '扬声器', speaker, () => setSpeaker((v) => !v))}
            {controlBtn(<UserPlus className="h-[22px] w-[22px]" />, '添加', false, () => setError('模拟通话暂不支持添加通话'))}
            {controlBtn(<Video className="h-[22px] w-[22px]" />, '视频', false, () => setError('对方不支持视频通话'))}
            {controlBtn(<UserRound className="h-[22px] w-[22px]" />, '联系人', false, () => setError('通话中不可查看联系人'))}
          </div>
        )}
      </div>

      {/* 说话/文字输入 + 挂断 */}
      <div className="relative z-10 shrink-0 px-5 pb-[30px] pt-2">
        {phase === 'connected' && textMode && (
          <div className="mb-2.5 flex items-center gap-2">
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendText()}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="输入要说的话…"
              maxLength={200}
              className="h-[42px] flex-1 rounded-full border border-white/20 bg-white/10 px-4 text-[15px] text-white outline-none placeholder:text-white/40 focus:border-white/45"
            />
            <button
              type="button"
              onClick={sendText}
              disabled={!draft.trim() || busy}
              aria-label="发送"
              className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-white text-black transition-opacity active:opacity-60 disabled:opacity-40"
            >
              <ArrowUpRight className="h-5 w-5" />
            </button>
          </div>
        )}

        {phase === 'connected' && (
          <div className="mb-2.5 flex items-center justify-center gap-5">
            <button
              type="button"
              onClick={() => {
                setTextMode((v) => !v);
                if (!textMode) setTimeout(() => inputRef.current?.focus(), 60);
              }}
              aria-label={textMode ? '切换到语音' : '切换到键盘输入'}
              aria-pressed={textMode}
              className={`flex h-[44px] w-[44px] items-center justify-center rounded-full backdrop-blur-md transition-colors ${
                textMode ? 'bg-white text-black' : 'bg-white/15 text-white'
              }`}
            >
              <MessageSquare className="h-[20px] w-[20px]" />
            </button>
            <button
              type="button"
              onClick={() => void toggleRecording()}
              disabled={busy && !recording}
              data-testid="talk-button"
              className={`flex h-[68px] w-[68px] items-center justify-center rounded-full transition-all active:scale-95 disabled:opacity-50 ${
                recording ? 'animate-pulse bg-[#FF453A] text-white' : 'bg-white/15 text-white backdrop-blur-md'
              }`}
            >
              {busy && !recording ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <Mic className="h-[26px] w-[26px]" />
              )}
            </button>
            <span aria-hidden="true" className="h-[44px] w-[44px]" />
          </div>
        )}

        <div className="flex justify-center">
          <button
            type="button"
            onClick={hangup}
            data-testid="call-end"
            aria-label="挂断"
            className="flex h-[66px] w-[66px] items-center justify-center rounded-full bg-[#FF3B30] text-white shadow-[0_8px_24px_rgba(255,59,48,0.4)] transition-transform active:scale-95"
          >
            <PhoneOff className="h-[27px] w-[27px]" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 语音留言行（列表只显示联系人与时长，点行进详情页看内容） ----------------

function VoicemailRow({
  vm,
  contact,
  active,
  loading,
  onOpen,
  onTogglePlay,
  onLongPress,
}: {
  vm: VoicemailRecord;
  contact: ContactRecord | null;
  active: boolean;
  loading: boolean;
  onOpen: () => void;
  onTogglePlay: () => void;
  onLongPress: () => void;
}) {
  const pressTimer = useRef<number | null>(null);
  const longFired = useRef(false);

  const cancelPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  useEffect(() => cancelPress, []);

  return (
    <div
      onPointerDown={() => {
        cancelPress();
        longFired.current = false;
        pressTimer.current = window.setTimeout(() => {
          longFired.current = true;
          onLongPress();
        }, 480);
      }}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onContextMenu={(e) => e.preventDefault()}
      className="flex items-center gap-3 py-2.5 pl-3.5 pr-2 transition-colors active:bg-muted/60"
    >
      <AvatarBubble contact={contact} size={44} className={contact ? '' : 'opacity-80'} />
      <button
        type="button"
        onClick={() => {
          // 长按刚触发过动作菜单时，忽略随后的 click（避免误进详情）
          if (longFired.current) {
            longFired.current = false;
            return;
          }
          onOpen();
        }}
        className="min-w-0 flex-1 text-left"
        aria-label={`查看${vm.displayName}的${vm.kind === 'call' ? '通话内容' : '留言'}`}
        data-testid={`vm-open-${vm.id}`}
      >
        <span className="flex items-center gap-1.5">
          {!vm.read && <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#0A84FF]" aria-label="未读" />}
          <span className={`min-w-0 flex-1 truncate text-[16px] leading-snug ${vm.read ? 'font-medium' : 'font-semibold'}`}>
            {vm.displayName}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          {active ? (
            <span className="flex items-end gap-[2px]" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-[3px] animate-pulse rounded-full bg-[#34C759]"
                  style={{ height: 5 + (i % 2) * 3, animationDelay: `${i * 140}ms`, animationDuration: '700ms' }}
                />
              ))}
            </span>
          ) : vm.kind === 'call' ? (
            <PhoneIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
          ) : (
            <VoicemailIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate tabular-nums">{vm.kind === 'call' ? '通话内容' : '留言'}</span>
          <span className="shrink-0 tabular-nums">· {formatDuration(vm.duration)}</span>
        </span>
      </button>
      <span className="shrink-0 text-[12.5px] text-muted-foreground tabular-nums">{formatLogTime(vm.createdAt)}</span>
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={active ? '暂停播放' : '播放'}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] transition-all active:scale-90"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : active ? (
          <Pause className="h-4 w-4" fill="currentColor" strokeWidth={0} />
        ) : (
          <Play className="h-4 w-4 translate-x-[1px]" fill="currentColor" strokeWidth={0} />
        )}
      </button>
    </div>
  );
}

// ---------------- 五个 Tab ----------------

function RecentsTab({
  logs,
  contacts,
  onCall,
  onDelete,
}: {
  logs: CallLogRecord[] | null;
  contacts: ContactRecord[];
  onCall: (number: string, contact: ContactRecord | null) => void;
  onDelete: (log: CallLogRecord) => void;
}) {
  const [sheet, setSheet] = useState<CallLogRecord | null>(null);
  const [filter, setFilter] = useState<'all' | 'missed'>('all');
  const [query, setQuery] = useState('');
  const pressTimer = useRef<number | null>(null);
  const cancelPress = useCallback(() => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);
  useEffect(() => cancelPress, [cancelPress]);

  /** 日志 → 联系人回链：优先 contactId，其次按「联系人里填的电话」匹配（改号/换设备后仍能对上人） */
  const resolve = useCallback(
    (log: CallLogRecord): ContactRecord | null => {
      const live = log.contactId ? contacts.find((c) => c.id === log.contactId) : undefined;
      return live ?? findContactByNumber(contacts, log.number);
    },
    [contacts]
  );

  const shown = useMemo(() => {
    let list = logs ?? [];
    if (filter === 'missed') list = list.filter((l) => l.duration === 0);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((l) => {
        const c = resolve(l);
        return `${c?.name ?? ''} ${l.displayName} ${l.number}`.toLowerCase().includes(q);
      });
    }
    return list;
  }, [logs, filter, query, resolve]);

  if (logs === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const emptyTip =
    filter === 'missed'
      ? { title: '无未接来电', desc: '没有拨出后未接通的通话' }
      : { title: '还没有通话记录', desc: '去「通讯录」或「拨号键盘」拨出第一通电话吧' };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {logs.length > 0 && (
        <div className="shrink-0">
          <div className="px-4 pb-2">
            <IOSSegmented
              ariaLabel="筛选通话记录"
              value={filter}
              onChange={setFilter}
              options={[
                { key: 'all', label: '所有' },
                { key: 'missed', label: '未接来电' },
              ]}
            />
          </div>
          <div className="px-4 pb-2">
            <IOSSearch value={query} onChange={setQuery} placeholder="搜索" />
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <ClockIcon className="h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
          <p className="text-[15px] font-medium">{emptyTip.title}</p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{emptyTip.desc}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pb-2">
          <ul className="mx-4 overflow-hidden rounded-[14px] bg-card" data-testid="recents-list">
            {shown.map((log, idx) => {
              const live = resolve(log);
              const name = live?.name || log.displayName || log.number;
              const unanswered = log.duration === 0;
              const region = live?.region?.trim();
              return (
                <li key={log.id} className={idx > 0 ? 'border-t border-border/50' : ''}>
                  <div className="flex items-center gap-1.5 pl-3.5 pr-2 transition-colors active:bg-muted/60">
                    <button
                      type="button"
                      onClick={() => onCall(log.number, live)}
                      onPointerDown={() => {
                        cancelPress();
                        pressTimer.current = window.setTimeout(() => setSheet(log), 480);
                      }}
                      onPointerUp={cancelPress}
                      onPointerLeave={cancelPress}
                      onContextMenu={(e) => e.preventDefault()}
                      className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left"
                      aria-label={`呼叫${name}`}
                    >
                      <AvatarBubble contact={live} size={44} className={live ? '' : 'opacity-80'} />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[16px] font-semibold leading-snug ${
                            unanswered ? 'text-[#FF3B30] dark:text-[#FF453A]' : ''
                          }`}
                        >
                          {name}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-[12.5px] text-muted-foreground">
                          <ArrowUpRight
                            className={`h-[13px] w-[13px] shrink-0 ${
                              unanswered ? 'text-[#FF3B30] dark:text-[#FF453A]' : 'text-[#34C759]'
                            }`}
                            aria-hidden="true"
                          />
                          <span className="truncate tabular-nums">
                            {unanswered ? '未接通' : `呼出 · ${callDurationText(log.duration)}`}
                            {region ? ` · ${region}` : ''}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-[13.5px] text-muted-foreground tabular-nums">{formatLogTime(log.createdAt)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSheet(log)}
                      aria-label={`${name}的通话详情`}
                      data-testid={`log-info-${log.id}`}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors active:bg-muted"
                    >
                      <Info className="h-[21px] w-[21px] text-[#0A84FF]" strokeWidth={1.8} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 单条记录详情：呼叫 / 删除 */}
      <IOSActionSheet
        open={!!sheet}
        actions={
          sheet
            ? [
                {
                  label: `呼叫 ${sheet.displayName || sheet.number}`,
                  onSelect: () => {
                    const t = sheet;
                    setSheet(null);
                    onCall(t.number, resolve(t));
                  },
                },
                {
                  label: '删除该条记录',
                  destructive: true,
                  onSelect: () => {
                    onDelete(sheet);
                    setSheet(null);
                  },
                },
              ]
            : []
        }
        onCancel={() => setSheet(null)}
      />
    </div>
  );
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function ContactsTab({
  contacts,
  favorites,
  onOpenDetail,
  onToggleFavorite,
  onAddFriend,
  loading,
}: {
  contacts: ContactRecord[];
  favorites: string[];
  onOpenDetail: (c: ContactRecord) => void;
  onToggleFavorite: (id: string) => void;
  onAddFriend: () => void;
  loading: boolean;
}) {
  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const secRefs = useRef<Record<string, HTMLElement | null>>({});

  /** 按拼音首字母分组（Intl zh 排序；汉字归 A-Z，其余归 #） */
  const sections = useMemo(() => {
    const sorted = [...contacts].sort((a, b) => PINYIN_COLLATOR.compare(a.name, b.name));
    const map = new Map<string, ContactRecord[]>();
    for (const c of sorted) {
      const letter = sectionLetter(c.name);
      const bucket = map.get(letter);
      if (bucket) bucket.push(c);
      else map.set(letter, [c]);
    }
    const letters = ALPHABET.filter((l) => map.has(l));
    if (map.has('#')) letters.push('#');
    return letters.map((letter) => ({ letter, items: map.get(letter)! }));
  }, [contacts]);

  const searching = query.trim().length > 0;
  const results = useMemo(() => {
    if (!searching) return [];
    const q = query.trim().toLowerCase();
    return contacts.filter((c) =>
      [c.name, c.phone, c.relation, c.occupation, c.region].some((f) => (f ?? '').toLowerCase().includes(q))
    );
  }, [contacts, searching, query]);

  const jump = useCallback((letter: string) => {
    const el = secRefs.current[letter];
    const sc = scrollRef.current;
    if (el && sc) sc.scrollTo({ top: Math.max(0, el.offsetTop), behavior: 'smooth' });
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const row = (c: ContactRecord) => {
    const fav = favorites.includes(c.id);
    return (
      <div className="flex items-center gap-1.5 pl-3.5 pr-2 transition-colors active:bg-muted/60">
        <button
          type="button"
          onClick={() => onOpenDetail(c)}
          className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left"
          aria-label={`查看${c.name}的联系人详情`}
        >
          <AvatarBubble contact={c} size={44} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-semibold leading-snug">{c.name}</span>
            <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground tabular-nums">
              {c.phone || '无号码'}
              {listSubtitle(c) ? ` · ${listSubtitle(c)}` : ''}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onToggleFavorite(c.id)}
          aria-label={fav ? '从个人收藏移除' : '添加到个人收藏'}
          aria-pressed={fav}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors active:bg-muted"
        >
          <Star className={`h-[19px] w-[19px] ${fav ? 'fill-[#F5B800] text-[#F5B800]' : 'text-muted-foreground/50'}`} />
        </button>
      </div>
    );
  };

  if (contacts.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <UsersIcon className="h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-[15px] font-medium">还没有联系人</p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          点右上角「+」新建联系人并填写电话，添加后即可拨打和发信息
        </p>
        <button
          type="button"
          onClick={() => onAddFriend()}
          data-testid="empty-add-contact"
          className="mt-2 rounded-full bg-[#0A84FF] px-5 py-2 text-[14.5px] font-medium text-white transition-all active:scale-95"
        >
          新建联系人
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden" data-testid="contacts-list">
      <div className="shrink-0 px-4 pb-2">
        <IOSSearch value={query} onChange={setQuery} placeholder="搜索" />
      </div>

      <div ref={scrollRef} className="relative flex-1 overflow-y-auto px-4 pb-2">
        {searching ? (
          results.length > 0 ? (
            <ul className="overflow-hidden rounded-[14px] bg-card">
              {results.map((c, i) => (
                <li key={c.id} className={i > 0 ? 'border-t border-border/50' : ''}>
                  {row(c)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-10 text-center text-[14px] text-muted-foreground">没有找到「{query.trim()}」相关联系人</p>
          )
        ) : (
          sections.map((sec) => (
            <section
              key={sec.letter}
              ref={(el) => {
                secRefs.current[sec.letter] = el;
              }}
              className="pb-3"
            >
              <h3 className="sticky top-0 z-10 -mx-4 bg-background/95 px-5 py-[3px] text-[13px] font-semibold text-muted-foreground backdrop-blur-sm">
                {sec.letter}
              </h3>
              <ul className="overflow-hidden rounded-[14px] bg-card">
                {sec.items.map((c, i) => (
                  <li key={c.id} className={i > 0 ? 'border-t border-border/50' : ''}>
                    {row(c)}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {/* 右侧字母索引（A-Z / #，点按跳组） */}
      {!searching && sections.length > 1 && (
        <nav
          aria-label="字母索引"
          className="absolute bottom-4 right-0 top-24 z-20 flex flex-col justify-center gap-[1px] px-[3px]"
        >
          {sections.map((sec) => (
            <button
              key={sec.letter}
              type="button"
              onClick={() => jump(sec.letter)}
              aria-label={`跳转到${sec.letter}分组`}
              className="flex h-[13px] w-[15px] items-center justify-center rounded text-[9.5px] font-semibold leading-none text-[#0A84FF] transition-colors active:bg-[#0A84FF]/15"
            >
              {sec.letter}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

function FavoritesTab({
  contacts,
  favorites,
  onCall,
  onToggleFavorite,
}: {
  contacts: ContactRecord[];
  favorites: string[];
  onCall: (number: string, contact: ContactRecord | null) => void;
  onToggleFavorite: (id: string) => void;
}) {
  const favContacts = favorites
    .map((id) => contacts.find((c) => c.id === id))
    .filter((c): c is ContactRecord => !!c);
  if (favContacts.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <Star className="h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-[15px] font-medium">没有个人收藏</p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">在「通讯录」里点星标，把常联系人放这里快速拨打</p>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto pb-2" data-testid="favorites-list">
      <ul className="mx-4 overflow-hidden rounded-[14px] bg-card">
        {favContacts.map((c, i) => (
          <li key={c.id} className={i > 0 ? 'border-t border-border/50' : ''}>
            <div className="flex items-center gap-1.5 pl-3.5 pr-2 transition-colors active:bg-muted/60">
              <button
                type="button"
                onClick={() => onCall(c.phone || '', c)}
                className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left"
                aria-label={`呼叫${c.name}`}
              >
                <AvatarBubble contact={c} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold leading-snug">{c.name}</span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">{listSubtitle(c)}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onToggleFavorite(c.id)}
                aria-label="从个人收藏移除"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors active:bg-muted"
              >
                <Star className="h-[19px] w-[19px] fill-[#F5B800] text-[#F5B800]" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function KeypadTab({
  contacts,
  onCall,
  onNewContact,
}: {
  contacts: ContactRecord[];
  onCall: (number: string, contact: ContactRecord | null) => void;
  /** 右上角 ⊕：用当前输入的号码（可空）新建联系人（添加好友） */
  onNewContact: (prefilledPhone: string) => void;
}) {
  const [digits, setDigits] = useState('');

  const press = useCallback((key: string) => {
    playDtmf(key);
    setDigits((d) => (d.length >= 20 ? d : d + key));
  }, []);

  const matched = useMemo(() => {
    if (stripDigits(digits).length < 3) return null;
    return findContactByNumber(contacts, digits);
  }, [digits, contacts]);

  return (
    <div className="flex flex-1 select-none flex-col items-center overflow-y-auto px-6 pb-2" data-testid="keypad-tab">
      {/* 顶部行：主号徽章（缩小并与返回键左对齐） + 新建联系人（对照 iOS 键盘右上角 ⊕） */}
      <div className="-mx-2 flex w-full items-center justify-between pt-1">
        <span
          className="rounded-[6px] bg-[#0A84FF] px-2 py-[3px] text-[11px] font-medium leading-none text-white shadow-[0_1px_3px_rgba(10,132,255,0.35)]"
          data-testid="sim-badge"
        >
          主号
        </span>
        <button
          type="button"
          onClick={() => onNewContact(stripDigits(digits))}
          aria-label="把当前号码新建为联系人"
          data-testid="keypad-new-contact"
          className="flex h-9 w-9 items-center justify-center rounded-full text-[#0A84FF] transition-colors active:bg-[#0A84FF]/10"
        >
          <UserPlus className="h-[22px] w-[22px]" strokeWidth={1.9} />
        </button>
      </div>

      {/* 号码显示区 */}
      <div className="flex min-h-[86px] w-full items-center justify-center px-1">
        <p
          className="truncate text-[40px] font-light leading-none tracking-wide text-foreground tabular-nums transition-[font-size] duration-150"
          data-testid="dial-number"
        >
          {formatNumber(digits)}
        </p>
      </div>
      <p className="mb-1 flex h-[22px] items-center gap-1 text-[15px] text-[#0A84FF]" aria-live="polite" data-testid="keypad-match">
        {matched ? (
          <span className="inline-flex items-center gap-[1px]">
            呼叫 {matched.name}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        ) : digits.length >= 3 ? (
          '陌生号码'
        ) : (
          ''
        )}
      </p>

      {/* 12 键拨号盘（小一号圆键 + 加粗数字/字母双层，深按压反馈） */}
      <div className="mt-1 grid w-[272px] grid-cols-3 gap-x-[28px] gap-y-[12px]">
        {KEYS.map((k) => (
          <button
            key={k.digit}
            type="button"
            onClick={() => press(k.digit)}
            data-key={k.digit}
            aria-label={`按键${k.digit}${k.letters || ''}`}
            className="mx-auto flex h-[72px] w-[72px] flex-col items-center justify-center rounded-full bg-foreground/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)] transition-all duration-100 ease-out hover:bg-foreground/[0.11] active:scale-[0.9] active:bg-foreground/[0.17] dark:bg-white/[0.11] dark:shadow-none dark:hover:bg-white/[0.15] dark:active:bg-white/[0.23]"
          >
            <span className="text-[29px] font-medium leading-none tracking-tight">{k.digit}</span>
            {k.letters && (
              <span className="mt-[3px] text-[10px] font-medium leading-none tracking-[0.22em] text-muted-foreground/90">
                {k.letters}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 底行：绿色呼叫钮（中，同步缩小一号）· 退格（右，iOS 18 布局） */}
      <div className="mt-[16px] grid w-[272px] grid-cols-3 items-center">
        <span />
        <button
          type="button"
          onClick={() => digits.length > 0 && onCall(digits, matched)}
          disabled={digits.length === 0}
          data-testid="call-start"
          aria-label="呼叫"
          className="mx-auto flex h-[70px] w-[70px] items-center justify-center rounded-full bg-gradient-to-b from-[#3FD860] to-[#2BBF4C] text-white shadow-[0_10px_28px_rgba(52,199,89,0.5),inset_0_1px_0_rgba(255,255,255,0.35)] transition-all duration-100 active:scale-[0.93] disabled:opacity-40"
        >
          <PhoneIcon className="h-[30px] w-[30px]" fill="currentColor" strokeWidth={0} />
        </button>
        <span className="flex justify-center">
          {digits.length > 0 && (
            <button
              type="button"
              onClick={() => setDigits((d) => d.slice(0, -1))}
              aria-label="退格"
              data-testid="keypad-backspace"
              className="flex h-[40px] w-[58px] items-center justify-center rounded-[13px] bg-foreground/[0.07] text-foreground transition-all duration-100 active:scale-90 active:bg-foreground/[0.15] dark:bg-white/[0.11]"
            >
              <Delete className="h-[24px] w-[24px]" strokeWidth={1.8} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

// ---------------- 语音留言 Tab ----------------

function VoicemailTab({
  voicemails,
  contacts,
  playingId,
  loadingId,
  onOpen,
  onTogglePlay,
  onDelete,
  onToggleRead,
}: {
  voicemails: VoicemailRecord[] | null;
  contacts: ContactRecord[];
  playingId: string | null;
  loadingId: string | null;
  onOpen: (vm: VoicemailRecord) => void;
  onTogglePlay: (vm: VoicemailRecord) => void;
  onDelete: (vm: VoicemailRecord) => void;
  onToggleRead: (vm: VoicemailRecord) => void;
}) {
  const [sheet, setSheet] = useState<VoicemailRecord | null>(null);
  const pressTimer = useRef<number | null>(null);
  const cancelPress = useCallback(() => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);
  useEffect(() => cancelPress, [cancelPress]);

  if (voicemails === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (voicemails.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <VoicemailIcon className="h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-[15px] font-medium">无语音留言</p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          通话结束后，说了什么会自动存档在这里（永久保存）；对方未接听时的留言也会出现在这里。点按留言可回看完整内容。仅长按删除才丢。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto pb-2">
        <ul className="mx-4 overflow-hidden rounded-[14px] bg-card" data-testid="voicemail-list">
          {voicemails.map((vm, idx) => (
            <li key={vm.id} className={idx > 0 ? 'border-t border-border/50' : ''}>
              <VoicemailRow
                vm={vm}
                contact={contacts.find((c) => c.id === vm.contactId) ?? null}
                active={playingId === vm.id}
                loading={loadingId === vm.id}
                onOpen={() => onOpen(vm)}
                onTogglePlay={() => onTogglePlay(vm)}
                onLongPress={() => setSheet(vm)}
              />
            </li>
          ))}
        </ul>
      </div>

      <IOSActionSheet
        open={!!sheet}
        actions={
          sheet
            ? [
                {
                  label: '播放留言',
                  onSelect: () => {
                    const vm = sheet;
                    setSheet(null);
                    onTogglePlay(vm);
                  },
                },
                {
                  label: sheet.read ? '标为未读' : '标为已读',
                  onSelect: () => {
                    onToggleRead(sheet);
                    setSheet(null);
                  },
                },
                {
                  label: '删除留言',
                  destructive: true,
                  onSelect: () => {
                    onDelete(sheet);
                    setSheet(null);
                  },
                },
              ]
            : []
        }
        onCancel={() => setSheet(null)}
      />
    </div>
  );
}

// ---------------- 语音留言详情页（列表点行进入：完整谈话内容 + 播放 + 删除） ----------------

function formatFullTime(ts: number): string {
  const d = new Date(ts);
  const week = '日一二三四五六'[d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${week} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`;
}

function VoicemailDetail({
  vm,
  contact,
  active,
  loading,
  onBack,
  onTogglePlay,
  onDelete,
}: {
  vm: VoicemailRecord;
  contact: ContactRecord | null;
  active: boolean;
  loading: boolean;
  onBack: () => void;
  onTogglePlay: () => void;
  onDelete: () => void;
}) {
  const isCall = vm.kind === 'call';
  /** kind='call' 的转写是「我：…/对方名：…」逐行对话 → 解析成气泡；普通留言整段展示 */
  const dialogue = useMemo(
    () =>
      isCall
        ? vm.text.split('\n').map((line) => {
            const i = line.indexOf('：');
            const speaker = i > 0 ? line.slice(0, i) : '';
            return { speaker, mine: speaker === '我', text: i > 0 ? line.slice(i + 1) : line };
          })
        : [],
    [isCall, vm.text]
  );

  return (
    <div
      className="absolute inset-0 z-[35] flex flex-col overflow-hidden bg-background"
      role="dialog"
      aria-label={`${vm.displayName}的${isCall ? '通话内容' : '语音留言'}详情`}
      data-testid="voicemail-detail"
    >
      {/* 顶栏：圆形返回 + 删除 */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-[54px]">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回"
          data-testid="vm-detail-back"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/[0.08] text-foreground transition-all active:scale-90 active:bg-foreground/[0.16]"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="删除该条留言"
          data-testid="vm-detail-delete"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/[0.08] text-[#FF3B30] transition-all active:scale-90 active:bg-foreground/[0.16]"
        >
          <Trash2 className="h-[18px] w-[18px]" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-10">
        {/* 头像 + 名字 + 号码 */}
        <div className="flex flex-col items-center pt-3">
          <AvatarBubble contact={contact} size={96} className="shadow-xl ring-1 ring-border/60" />
          <h2 className="mt-3.5 max-w-[280px] truncate text-[24px] font-bold leading-tight">{vm.displayName}</h2>
          <p className="mt-0.5 text-[14px] text-[#0A84FF] tabular-nums">{formatNumber(vm.number)}</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground tabular-nums">
            {formatFullTime(vm.createdAt)} · {isCall ? '通话内容' : '语音留言'} · {formatDuration(vm.duration)}
          </p>
        </div>

        {/* 播放钮（TTS 回听） */}
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={onTogglePlay}
            data-testid="vm-detail-play"
            className="flex h-[52px] items-center gap-2.5 rounded-full bg-[#0A84FF] px-7 text-[16px] font-medium text-white shadow-[0_6px_20px_rgba(10,132,255,0.4)] transition-all active:scale-95"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : active ? (
              <span className="flex h-[18px] items-end gap-[3px]" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className="w-[3px] animate-pulse rounded-full bg-white"
                    style={{ height: 7 + (i % 2) * 6, animationDelay: `${i * 130}ms`, animationDuration: '700ms' }}
                  />
                ))}
              </span>
            ) : (
              <Play className="h-5 w-5" fill="currentColor" strokeWidth={0} />
            )}
            {active ? '正在播放' : `播放${isCall ? '通话内容' : '留言'}`}
          </button>
        </div>

        {/* 完整内容卡片 */}
        <section className="mt-6 overflow-hidden rounded-[14px] bg-card" data-testid="vm-detail-text">
          <header className="border-b border-border/50 px-4 py-3 text-[15px] font-semibold">
            {isCall ? '这通电话说了什么' : '留言内容'}
          </header>
          {isCall ? (
            <div className="space-y-2.5 px-4 py-4">
              {dialogue.map((d, i) => (
                <div key={i} className={`flex ${d.mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[82%] ${d.mine ? 'items-end' : 'items-start'}`}>
                    {!d.mine && d.speaker && <p className="mb-0.5 px-1 text-[11.5px] text-muted-foreground">{d.speaker}</p>}
                    <p
                      className={`rounded-[16px] px-3.5 py-2 text-[14.5px] leading-snug ${
                        d.mine
                          ? 'rounded-br-[6px] bg-[#34C759]/20 text-foreground'
                          : 'rounded-bl-[6px] bg-foreground/[0.07] text-foreground'
                      }`}
                    >
                      {d.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 py-4 text-[15px] leading-relaxed text-foreground">{vm.text}</p>
          )}
        </section>
        <p className="mt-3 text-center text-[12px] text-muted-foreground">内容永久保存在本机，仅可手动删除</p>
      </div>
    </div>
  );
}

// ---------------- 联系人详情页（对照 iOS 18 电话联系人界面） ----------------

type DetailSegment = 'info' | 'voicemail';

function DetailSegmented({ value, onChange }: { value: DetailSegment; onChange: (v: DetailSegment) => void }) {
  const options: { key: DetailSegment; label: string }[] = [
    { key: 'info', label: '详细信息' },
    { key: 'voicemail', label: '语音留言' },
  ];
  return (
    <div role="radiogroup" aria-label="联系人详情分区" className="mx-auto flex w-fit rounded-full border border-border/50 bg-foreground/[0.04] p-[3px]">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-full px-5 py-[7px] text-[14px] font-medium leading-none transition-colors ${
            value === o.key
              ? 'bg-foreground/[0.10] text-foreground shadow-[0_1px_4px_rgba(0,0,0,0.08)]'
              : 'text-muted-foreground active:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ContactDetail({
  contact,
  logs,
  voicemails,
  playingId,
  loadingId,
  onBack,
  onCall,
  onMessage,
  onEdit,
  showToast,
  onOpenVoicemail,
  onTogglePlay,
  onDeleteVoicemail,
  onDeleteContact,
}: {
  contact: ContactRecord;
  logs: CallLogRecord[] | null;
  voicemails: VoicemailRecord[];
  playingId: string | null;
  loadingId: string | null;
  onBack: () => void;
  onCall: (number: string, contact: ContactRecord | null) => void;
  /** 点「信息」：跨 App 跳到信息 App 与该联系人的会话（相当于添加好友直达聊天） */
  onMessage: (c: ContactRecord) => void;
  onEdit: () => void;
  showToast: (msg: string) => void;
  onOpenVoicemail: (vm: VoicemailRecord) => void;
  onTogglePlay: (vm: VoicemailRecord) => void;
  onDeleteVoicemail: (vm: VoicemailRecord) => void;
  /** 删除联系人（底部红色按钮 → 确认菜单）；user 自己的号码不展示入口 */
  onDeleteContact: (c: ContactRecord) => void;
}) {
  const [segment, setSegment] = useState<DetailSegment>('info');
  const [vmSheet, setVmSheet] = useState<VoicemailRecord | null>(null);
  /** 删除联系人确认菜单 */
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);

  /** 与该联系人相关的通话记录：contactId 优先，号码归一化兜底 */
  const contactLogs = useMemo(() => {
    const key = phoneKey(contact.phone || '');
    return (logs ?? [])
      .filter((l) => (l.contactId && l.contactId === contact.id) || (!!key && phoneKey(l.number) === key))
      .slice(0, 4);
  }, [logs, contact]);

  /** 与该联系人相关的语音留言 */
  const vmList = useMemo(() => {
    const key = phoneKey(contact.phone || '');
    return voicemails.filter((v) => (v.contactId && v.contactId === contact.id) || (!!key && phoneKey(v.number) === key));
  }, [voicemails, contact]);

  const infoRows = useMemo(
    () =>
      [
        { label: '公司', value: contact.company?.trim() || '' },
        { label: '关系', value: contact.relation?.trim() || '' },
        { label: '职业', value: contact.occupation?.trim() || '' },
        { label: '地区', value: contact.region?.trim() || '' },
      ].filter((r) => r.value),
    [contact]
  );

  const actionBtn = (icon: React.ReactNode, label: string, onClick: () => void, testId?: string) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid={testId}
      className="flex flex-col items-center gap-1.5 transition-opacity active:opacity-50"
    >
      <span className="flex h-[54px] w-[54px] items-center justify-center rounded-full bg-foreground/[0.08] text-foreground transition-colors active:bg-foreground/[0.16]">
        {icon}
      </span>
    </button>
  );

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col overflow-hidden bg-background"
      role="dialog"
      aria-label={`${contact.name}的联系人详情`}
      data-testid="contact-detail"
    >
      {/* 顶栏：圆形返回 + 胶囊编辑 */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-[54px]">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回"
          data-testid="detail-back"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/[0.08] text-foreground transition-all active:scale-90 active:bg-foreground/[0.16]"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={onEdit}
          data-testid="detail-edit"
          className="rounded-full bg-foreground/[0.08] px-4 py-[7px] text-[15px] font-medium leading-none text-foreground transition-all active:scale-95 active:bg-foreground/[0.16]"
        >
          编辑
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10">
        {/* 大头像 + 名字 */}
        <div className="flex flex-col items-center pt-2">
          <AvatarBubble contact={contact} size={132} className="shadow-xl ring-1 ring-border/60" />
          <h2 className="mt-4 max-w-[300px] truncate text-[30px] font-bold leading-tight">{contact.name}</h2>
          <p className="mt-0.5 text-[13.5px] text-muted-foreground">{detailSubtitle(contact)}</p>
        </div>

        {/* 操作行：信息 / 电话 / 视频 / 邮件 */}
        <div className="mt-4 flex items-center justify-center gap-[18px]">
          {actionBtn(<MessageSquare className="h-[22px] w-[22px]" />, '发送信息', () => onMessage(contact), 'detail-message')}
          {actionBtn(<PhoneIcon className="h-[22px] w-[22px]" fill="currentColor" strokeWidth={0} />, '拨打电话', () => onCall(contact.phone || '', contact), 'detail-call-avatar')}
          {actionBtn(<Video className="h-[22px] w-[22px]" />, '视频通话', () => showToast('对方不支持视频通话'))}
          {actionBtn(<Mail className="h-[22px] w-[22px]" />, '发送邮件', () => showToast('请在「邮件」App 中发送邮件'))}
        </div>

        {/* 详细信息 / 语音留言 胶囊分段 */}
        <div className="mt-5">
          <DetailSegmented value={segment} onChange={setSegment} />
        </div>

        {segment === 'info' ? (
          <div className="mt-4 space-y-3">
            {/* 通话记录卡片 */}
            {contactLogs.length > 0 && (
              <section className="overflow-hidden rounded-[14px] bg-card" data-testid="detail-calllogs">
                <header className="flex items-center justify-between px-4 py-3">
                  <span className="text-[15px] font-semibold">通话记录</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </header>
                <ul className="border-t border-border/50">
                  {contactLogs.map((log, idx) => {
                    const unanswered = log.duration === 0;
                    return (
                      <li key={log.id} className={idx > 0 ? 'border-t border-border/50' : ''}>
                        <button
                          type="button"
                          onClick={() => onCall(log.number, contact)}
                          className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors active:bg-muted/60"
                          aria-label={`重新呼叫${contact.name}`}
                        >
                          <span className={`text-[14.5px] ${unanswered ? 'text-[#FF3B30] dark:text-[#FF453A]' : ''}`}>
                            {unanswered ? '未接来电' : '呼出'}
                          </span>
                          <span className="text-[13px] text-muted-foreground tabular-nums">
                            {formatLogTime(log.createdAt)}
                            {!unanswered && log.duration > 0 ? ` · ${callDurationText(log.duration)}` : ''}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* 联系人照片与海报 */}
            <button
              type="button"
              onClick={() => showToast('联系人照片与海报即将上线')}
              className="flex w-full items-center gap-3 rounded-[14px] bg-card px-4 py-3 text-left transition-colors active:bg-muted/60"
            >
              <AvatarBubble contact={contact} size={30} />
              <span className="flex-1 text-[15px] font-semibold">联系人照片与海报</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </button>

            {/* 手机号码 */}
            {contact.phone && (
              <section className="overflow-hidden rounded-[14px] bg-card">
                <button
                  type="button"
                  onClick={() => onCall(contact.phone || '', contact)}
                  className="w-full px-4 py-3 text-left transition-colors active:bg-muted/60"
                  aria-label={`呼叫${contact.phone}`}
                >
                  <span className="block text-[13px] text-muted-foreground">手机</span>
                  <span className="mt-0.5 block text-[16px] text-[#0A84FF] tabular-nums">{contact.phone}</span>
                </button>
              </section>
            )}

            {/* 其他信息 */}
            {infoRows.length > 0 && (
              <section className="rounded-[14px] bg-card px-4">
                {infoRows.map((r, idx) => (
                  <div key={r.label} className={`flex items-center justify-between py-2.5 ${idx > 0 ? 'border-t border-border/50' : ''}`}>
                    <span className="text-[13.5px] text-muted-foreground">{r.label}</span>
                    <span className="max-w-[62%] truncate text-[14.5px]">{r.value}</span>
                  </div>
                ))}
              </section>
            )}
          </div>
        ) : (
          <div className="mt-4" data-testid="detail-voicemails">
            {vmList.length === 0 ? (
              <p className="pt-8 text-center text-[14px] text-muted-foreground">暂无语音留言</p>
            ) : (
              <ul className="overflow-hidden rounded-[14px] bg-card">
                {vmList.map((vm, idx) => (
                  <li key={vm.id} className={idx > 0 ? 'border-t border-border/50' : ''}>
                    <VoicemailRow
                      vm={vm}
                      contact={contact}
                      active={playingId === vm.id}
                      loading={loadingId === vm.id}
                      onOpen={() => onOpenVoicemail(vm)}
                      onTogglePlay={() => onTogglePlay(vm)}
                      onLongPress={() => setVmSheet(vm)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 删除联系人（底部红色整行卡片，user 自己的号码不提供删除） */}
        {contact.kind !== 'user' && (
          <button
            type="button"
            onClick={() => setDeleteSheetOpen(true)}
            data-testid="detail-delete"
            className="mt-6 flex w-full items-center justify-center rounded-[14px] bg-card px-4 py-3.5 text-[15.5px] font-medium text-[#FF3B30] transition-colors active:bg-muted/60 dark:text-[#FF453A]"
          >
            删除联系人
          </button>
        )}
      </div>

      {/* 详情内留言长按菜单 */}
      <IOSActionSheet
        open={!!vmSheet}
        actions={
          vmSheet
            ? [
                {
                  label: '播放留言',
                  onSelect: () => {
                    const vm = vmSheet;
                    setVmSheet(null);
                    onTogglePlay(vm);
                  },
                },
                {
                  label: '删除留言',
                  destructive: true,
                  onSelect: () => {
                    onDeleteVoicemail(vmSheet);
                    setVmSheet(null);
                  },
                },
              ]
            : []
        }
        onCancel={() => setVmSheet(null)}
      />

      {/* 删除联系人确认菜单（iOS 风格：红色破坏性动作 + 取消） */}
      <IOSActionSheet
        open={deleteSheetOpen}
        actions={[
          {
            label: '删除联系人',
            destructive: true,
            onSelect: () => {
              setDeleteSheetOpen(false);
              onDeleteContact(contact);
            },
          },
        ]}
        onCancel={() => setDeleteSheetOpen(false)}
      />
    </div>
  );
}

// ---------------- 编辑联系人（详情页「编辑」胶囊；与新建联系人同款全屏样式） ----------------

function QuickEditSheet({
  contact,
  onClose,
  onSaved,
}: {
  contact: ContactRecord;
  onClose: () => void;
  onSaved: (c: ContactRecord) => void;
}) {
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [relation, setRelation] = useState(contact.relation ?? '');
  const [occupation, setOccupation] = useState(contact.occupation ?? '');
  const [region, setRegion] = useState(contact.region ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      const updated = await updateContact(contact.id, {
        phone: phone.trim(),
        relation: relation.trim(),
        occupation: occupation.trim(),
        region: region.trim(),
      });
      if (!updated) throw new Error('联系人不存在');
      onSaved(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-[60] flex flex-col overflow-hidden bg-background"
      role="dialog"
      aria-modal="true"
      aria-label="编辑联系人"
      data-testid="edit-contact-sheet"
    >
      {/* 顶栏：X 关闭 / 标题 / ✓ 保存（与新建联系人同款样式） */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-[54px]">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          data-testid="edit-close"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/[0.08] text-foreground transition-all active:scale-90 active:bg-foreground/[0.16]"
        >
          <X className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <span className="text-[17px] font-semibold">编辑联系人</span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          aria-label="保存联系人"
          data-testid="edit-save"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-[0_2px_10px_rgba(10,132,255,0.4)] transition-all active:scale-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-5 w-5" strokeWidth={3} />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-12">
        {/* 大头像（与新建联系人同款尺寸） */}
        <div className="flex flex-col items-center pt-1">
          <AvatarBubble contact={contact} size={122} className="shadow-[0_6px_20px_rgba(0,0,0,0.18)] ring-1 ring-border/60" />
        </div>

        {err && (
          <p className="mt-3 rounded-[10px] bg-red-500/10 px-3 py-2 text-center text-[13px] text-[#FF3B30]" role="alert">
            {err}
          </p>
        )}

        {/* 手机（带清除钮，样式同新建联系人的电话行） */}
        <section className="mt-4 overflow-hidden rounded-[14px] bg-card">
          <div className="flex items-center gap-2.5 border-b border-border/50 px-3.5 py-2">
            <button
              type="button"
              onClick={() => setPhone('')}
              aria-label="清除电话号码"
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#FF3B30] text-white transition-opacity active:opacity-60"
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={3.5} />
            </button>
            <span className="shrink-0 text-[15.5px] text-[#0A84FF]">手机</span>
            <ChevronRight className="-ml-1.5 h-3.5 w-3.5 shrink-0 text-[#0A84FF]/70" aria-hidden="true" />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="电话"
              aria-label="电话号码"
              inputMode="tel"
              maxLength={20}
              data-testid="edit-phone"
              className="h-[38px] min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted-foreground/70"
            />
          </div>
        </section>

        {/* 关系 / 职业 / 地区（行式输入，样式同新建联系人的姓·名·公司行） */}
        <section className="mt-4 overflow-hidden rounded-[14px] bg-card">
          <input
            value={relation}
            onChange={(e) => setRelation(e.target.value)}
            placeholder="关系（如 老朋友）"
            aria-label="关系"
            data-testid="edit-relation"
            className={ncRowInputCls}
            maxLength={60}
          />
          <input
            value={occupation}
            onChange={(e) => setOccupation(e.target.value)}
            placeholder="职业（如 司机）"
            aria-label="职业"
            data-testid="edit-occupation"
            className={ncRowInputCls}
            maxLength={40}
          />
          <input
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="地区（如 广东 广州）"
            aria-label="地区"
            data-testid="edit-region"
            className={ncRowInputCls}
            maxLength={40}
          />
        </section>
      </div>
    </div>
  );
}

// ---------------- 新建联系人（通讯录右上「+」/ 键盘右上角；保存后自动加为好友） ----------------

const ncRowInputCls =
  'h-[46px] w-full border-b border-border/50 bg-transparent px-4 text-[16px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:bg-foreground/[0.03] last:border-b-0';

function NewContactSheet({
  initialPhone = '',
  onClose,
  onSaved,
}: {
  initialPhone?: string;
  onClose: () => void;
  /** 保存成功：返回已自动加为好友的新联系人 */
  onSaved: (c: ContactRecord) => void;
}) {
  const [surname, setSurname] = useState('');
  const [given, setGiven] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState(initialPhone);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [hint, setHint] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const fullName = `${surname.trim()}${given.trim()}`;
  const avatarChar = fullName ? fullName.charAt(0).toUpperCase() : '';

  const pickAvatar = (file: File | undefined) => {
    if (!file) return;
    setHint('');
    fileToAvatarDataUrl(file)
      .then(setAvatar)
      .catch(() => setErr('图片处理失败，请换一张试试'));
  };

  const save = async () => {
    setHint('');
    if (!fullName) {
      setErr('请填写联系人的姓名');
      return;
    }
    if (!stripDigits(phone)) {
      setErr('请填写电话号码，否则无法拨打');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const created = await createContact({
        kind: 'char',
        name: fullName,
        phone: phone.trim(),
        company: company.trim() || undefined,
        avatar: avatar ?? undefined,
      });
      // 创建后立即加为好友（进电话通讯录 / 信息 App）
      const friended = (await updateContact(created.id, { isFriend: true }).catch(() => null)) ?? created;
      onSaved(friended);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败，请再试一次');
      setSaving(false);
    }
  };

  const plusRow = (label: string, tip: string, testId?: string) => (
    <button
      type="button"
      onClick={() => {
        setErr('');
        setHint(tip);
      }}
      data-testid={testId}
      className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left transition-colors active:bg-muted/60"
    >
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#34C759] text-white">
        <Plus className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
      <span className="text-[15.5px]">{label}</span>
    </button>
  );

  const ringRow = (label: string) => (
    <button
      type="button"
      onClick={() => {
        setErr('');
        setHint(`${label}使用默认铃声`);
      }}
      className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors active:bg-muted/60"
    >
      <span className="text-[15.5px]">{label}</span>
      <span className="flex items-center gap-0.5 text-[15.5px] text-[#0A84FF]">
        默认
        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </span>
    </button>
  );

  return (
    <div
      className="absolute inset-0 z-[60] flex flex-col overflow-hidden bg-background"
      role="dialog"
      aria-modal="true"
      aria-label="新建联系人"
      data-testid="new-contact-sheet"
    >
      {/* 顶栏：X 关闭 / 标题 / ✓ 保存 */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-[54px]">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          data-testid="new-contact-close"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/[0.08] text-foreground transition-all active:scale-90 active:bg-foreground/[0.16]"
        >
          <X className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <span className="text-[17px] font-semibold">新建联系人</span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          aria-label="保存联系人"
          data-testid="new-contact-save"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-[0_2px_10px_rgba(10,132,255,0.4)] transition-all active:scale-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-5 w-5" strokeWidth={3} />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-12">
        {/* 大头像（姓氏首字 / 照片）+ 添加照片 */}
        <div className="flex flex-col items-center pt-1">
          <div className="flex h-[122px] w-[122px] items-center justify-center overflow-hidden rounded-full bg-gradient-to-b from-[#8b8ff0] to-[#5b5fd6] text-[52px] font-medium text-white shadow-[0_6px_20px_rgba(91,95,214,0.35)]">
            {avatar ? (
              <img src={avatar} alt="联系人头像预览" className="h-full w-full object-cover" />
            ) : avatarChar ? (
              <span>{avatarChar}</span>
            ) : (
              <UserRound className="h-14 w-14 text-white/85" aria-hidden="true" />
            )}
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-3 rounded-full bg-foreground/[0.08] px-5 py-[7px] text-[15px] font-medium leading-none transition-all active:scale-95 active:bg-foreground/[0.16]"
          >
            添加照片
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              pickAvatar(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        {err && (
          <p className="mt-3 rounded-[10px] bg-red-500/10 px-3 py-2 text-center text-[13px] text-[#FF3B30]" role="alert">
            {err}
          </p>
        )}
        {hint && !err && <p className="mt-3 text-center text-[13px] text-muted-foreground">{hint}</p>}

        {/* 姓 / 名字 / 公司 */}
        <section className="mt-4 overflow-hidden rounded-[14px] bg-card">
          <input value={surname} onChange={(e) => setSurname(e.target.value)} placeholder="姓（如 李）" aria-label="姓" data-testid="new-surname" className={ncRowInputCls} maxLength={20} />
          <input value={given} onChange={(e) => setGiven(e.target.value)} placeholder="名字" aria-label="名字" data-testid="new-given" className={ncRowInputCls} maxLength={40} />
          <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="公司" aria-label="公司" data-testid="new-company" className={ncRowInputCls} maxLength={60} />
        </section>

        {/* 电话 */}
        <section className="mt-4 overflow-hidden rounded-[14px] bg-card">
          <div className="flex items-center gap-2.5 border-b border-border/50 px-3.5 py-2">
            <button
              type="button"
              onClick={() => setPhone('')}
              aria-label="清除电话号码"
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#FF3B30] text-white transition-opacity active:opacity-60"
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={3.5} />
            </button>
            <span className="shrink-0 text-[15.5px] text-[#0A84FF]">手机</span>
            <ChevronRight className="-ml-1.5 h-3.5 w-3.5 shrink-0 text-[#0A84FF]/70" aria-hidden="true" />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="电话"
              aria-label="电话号码"
              inputMode="tel"
              maxLength={20}
              data-testid="new-phone"
              className="h-[38px] min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted-foreground/70"
            />
          </div>
          {plusRow('添加电话', '暂时只支持保存一个电话号码', 'new-add-phone')}
        </section>

        {/* 邮箱 / 称呼代词 */}
        <section className="mt-4 overflow-hidden rounded-[14px] bg-card">{plusRow('添加电子邮件', '电子邮件暂时不支持，先填电话吧')}</section>
        <section className="mt-4 overflow-hidden rounded-[14px] bg-card">{plusRow('添加称呼代词', '称呼代词暂时不支持')}</section>

        {/* 铃声 */}
        <section className="mt-4 overflow-hidden rounded-[14px] bg-card">{ringRow('电话铃声')}</section>
        <section className="mt-3 overflow-hidden rounded-[14px] bg-card">{ringRow('短信铃声')}</section>
      </div>
    </div>
  );
}

// ---------------- App 主组件 ----------------

const TAB_META: { key: PhoneTab; label: string; icon: (active: boolean) => React.ReactNode }[] = [
  { key: 'favorites', label: '个人收藏', icon: (a) => <Star className="h-[23px] w-[23px]" strokeWidth={a ? 1.5 : 1.9} fill={a ? 'currentColor' : 'none'} /> },
  { key: 'recents', label: '最近通话', icon: (a) => <ClockIcon className="h-[23px] w-[23px]" strokeWidth={a ? 2.5 : 1.9} /> },
  { key: 'contacts', label: '通讯录', icon: (a) => <UserRound className="h-[23px] w-[23px]" strokeWidth={a ? 2.5 : 1.9} /> },
  { key: 'keypad', label: '拨号键盘', icon: () => <DialpadIcon className="h-[23px] w-[23px]" /> },
  { key: 'voicemail', label: '语音留言', icon: (a) => <VoicemailIcon className="h-[23px] w-[23px]" strokeWidth={a ? 2.3 : 1.9} /> },
];

export default function PhoneApp() {
  const [tab, setTab] = useState<PhoneTab>(() => {
    try {
      const saved = window.localStorage.getItem('ios-phone-tab');
      if (
        saved === 'favorites' ||
        saved === 'recents' ||
        saved === 'contacts' ||
        saved === 'keypad' ||
        saved === 'voicemail'
      )
        return saved;
    } catch {
      // 忽略
    }
    return 'keypad';
  });
  const [contacts, setContacts] = useState<ContactRecord[] | null>(null);
  const [logs, setLogs] = useState<CallLogRecord[] | null>(null);
  const [voicemails, setVoicemails] = useState<VoicemailRecord[] | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [callTarget, setCallTarget] = useState<CallTarget | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  /** 语音留言详情页（列表/联系人详情里点行进入） */
  const [vmDetailId, setVmDetailId] = useState<string | null>(null);
  /** 新建联系人（通讯录右上「+」/ 键盘右上角，可预填号码） */
  const [newContact, setNewContact] = useState<{ open: boolean; phone: string }>({ open: false, phone: '' });
  const [playingVmId, setPlayingVmId] = useState<string | null>(null);
  const [loadingVmId, setLoadingVmId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | null>(null);
  const vmAudioRef = useRef<HTMLAudioElement | null>(null);
  const switchToApp = useUI((s) => s.switchToApp);
  const setPendingChatContact = useUI((s) => s.setPendingChatContact);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2200);
  }, []);

  // 初始加载：联系人（本地 IndexedDB）+ 通话记录 / 语音留言 / 收藏（IndexedDB）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const all = await listContacts();
        if (alive) {
          setContacts(all.filter((c) => c.kind === 'user' || c.isFriend));
        }
      } catch {
        if (alive) setContacts([]);
      }
      try {
        const all = await localDB.getAll('call-logs');
        if (alive) setLogs(all.sort((a, b) => b.createdAt - a.createdAt));
      } catch {
        if (alive) setLogs([]);
      }
      try {
        const vms = await localDB.getAll('voicemails');
        if (alive) setVoicemails(vms.sort((a, b) => b.createdAt - a.createdAt));
      } catch {
        if (alive) setVoicemails([]);
      }
      try {
        const rec = await localDB.get('settings', FAV_KEY);
        if (alive && rec && Array.isArray(rec.value)) setFavorites(rec.value as string[]);
      } catch {
        // 忽略
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 卸载时停掉留言播放
  useEffect(
    () => () => {
      if (vmAudioRef.current) {
        vmAudioRef.current.pause();
        vmAudioRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    try {
      window.localStorage.setItem('ios-phone-tab', tab);
    } catch {
      // 忽略
    }
  }, [tab]);

  const persistFavorites = useCallback((ids: string[]) => {
    setFavorites(ids);
    void localDB.put('settings', { key: FAV_KEY, value: ids });
  }, []);

  const toggleFavorite = useCallback(
    (id: string) => {
      const next = favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id];
      persistFavorites(next);
      const c = contacts?.find((x) => x.id === id);
      showToast(favorites.includes(id) ? `已从个人收藏移除${c ? `「${c.name}」` : ''}` : `已收藏${c ? `「${c.name}」` : ''}`);
    },
    [favorites, contacts, persistFavorites, showToast]
  );

  const startCall = useCallback(
    (number: string, contact: ContactRecord | null) => {
      const digits = stripDigits(number);
      if (!digits) {
        showToast('这个联系人没有电话号码');
        return;
      }
      if (callTarget) return;
      // 电话 ↔ 联系人联动：未显式指定联系人时，按「联系人里填的电话」匹配出对应人
      const resolved = contact ?? findContactByNumber(contacts ?? [], digits);
      // 自己的号码（user）也允许拨打：接通后对方不说话、说的话不需要回复（见 CallScreen）
      setCallTarget({ number: digits, contact: resolved });
    },
    [callTarget, contacts, showToast]
  );

  /** 通话结束：写日志 + 刷新列表 */
  const handleCallEnd = useCallback((log: CallLogRecord) => {
    setLogs((prev) => {
      const base = prev ?? [];
      return [log, ...base].sort((a, b) => b.createdAt - a.createdAt);
    });
    void localDB.put('call-logs', log);
  }, []);

  /** 通话结束落一条语音留言：kind='call'（对话内容存档）不弹「发来留言」提示；未接通留言才提示 */
  const handleVoicemail = useCallback(
    (vm: VoicemailRecord) => {
      setVoicemails((prev) => {
        const base = prev ?? [];
        return [vm, ...base].sort((a, b) => b.createdAt - a.createdAt);
      });
      void localDB.put('voicemails', vm);
      showToast(
        vm.kind === 'call'
          ? `与「${vm.displayName}」的通话内容已永久保存到语音留言`
          : `「${vm.displayName}」给你发来一条语音留言`
      );
    },
    [showToast]
  );

  const stopVmAudio = useCallback(() => {
    if (vmAudioRef.current) {
      vmAudioRef.current.pause();
      vmAudioRef.current = null;
    }
    setPlayingVmId(null);
  }, []);

  /** 播放/暂停一条语音留言（TTS 按文本合成；播放即标为已读） */
  const toggleVmPlay = useCallback(
    async (vm: VoicemailRecord) => {
      if (playingVmId === vm.id) {
        stopVmAudio();
        return;
      }
      stopVmAudio();
      setLoadingVmId(vm.id);
      try {
        const contact = contacts?.find((c) => c.id === vm.contactId) ?? null;
        const res = await fetch('/api/phone/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: vm.text, gender: contactGender(contact) }),
        });
        if (!res.ok) throw new Error('tts failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        vmAudioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (vmAudioRef.current === audio) vmAudioRef.current = null;
          setPlayingVmId(null);
        };
        setPlayingVmId(vm.id);
        await audio.play().catch(() => {
          URL.revokeObjectURL(url);
          if (vmAudioRef.current === audio) vmAudioRef.current = null;
          setPlayingVmId(null);
          showToast('留言播放失败，请再试一次');
        });
      } catch {
        showToast('留言播放失败，请再试一次');
      } finally {
        setLoadingVmId(null);
      }
      if (!vm.read) {
        const next = { ...vm, read: true };
        setVoicemails((prev) => (prev ? prev.map((v) => (v.id === vm.id ? next : v)) : prev));
        void localDB.put('voicemails', next);
      }
    },
    [playingVmId, stopVmAudio, contacts, showToast]
  );

  const deleteVoicemail = useCallback(
    (vm: VoicemailRecord) => {
      if (playingVmId === vm.id) stopVmAudio();
      void localDB.delete('voicemails', vm.id);
      setVoicemails((prev) => (prev ? prev.filter((v) => v.id !== vm.id) : prev));
      showToast('已删除留言');
    },
    [playingVmId, stopVmAudio, showToast]
  );

  const toggleVmRead = useCallback((vm: VoicemailRecord) => {
    const next = { ...vm, read: !vm.read };
    setVoicemails((prev) => (prev ? prev.map((v) => (v.id === vm.id ? next : v)) : prev));
    void localDB.put('voicemails', next);
  }, []);

  /** 打开留言详情页：顺便标为已读 */
  const openVmDetail = useCallback(
    (vm: VoicemailRecord) => {
      setVmDetailId(vm.id);
      if (!vm.read) {
        const next = { ...vm, read: true };
        setVoicemails((prev) => (prev ? prev.map((v) => (v.id === vm.id ? next : v)) : prev));
        void localDB.put('voicemails', next);
      }
    },
    []
  );

  const clearLogs = useCallback(() => {
    void localDB.clear('call-logs');
    setLogs([]);
    showToast('已清除全部通话记录');
  }, [showToast]);

  const deleteLog = useCallback((log: CallLogRecord) => {
    void localDB.delete('call-logs', log.id);
    setLogs((prev) => (prev ? prev.filter((l) => l.id !== log.id) : prev));
    showToast('已删除该条记录');
  }, [showToast]);

  /** 联系人详情页「删除联系人」：本地删除（NPC 名下级联删）→ 同步移除 → 清理收藏 → 关闭详情 */
  const deleteContact = useCallback(
    async (c: ContactRecord) => {
      try {
        const removed = await deleteContactLocal(c.id);
        if (!removed) throw new Error('联系人不存在');
        // 本地同步移除：主体 + 被级联删除的 NPC（ownerId 指向被删者）
        setContacts((prev) => (prev ? prev.filter((x) => x.id !== c.id && x.ownerId !== c.id) : prev));
        // 从个人收藏里清理
        if (favorites.includes(c.id)) persistFavorites(favorites.filter((f) => f !== c.id));
        setDetailId(null);
        setEditSheetOpen(false);
        showToast(`已删除联系人「${c.name}」`);
      } catch (e) {
        showToast(e instanceof Error ? e.message : '删除失败，请再试一次');
      }
    },
    [favorites, persistFavorites, showToast]
  );

  /** 详情页「信息」：跨 App 跳到信息 App 与该联系人的会话（相当于添加好友直达聊天）；
   *  通话中/已在前台的 App 间切换用 switchToApp（openApp 只在无前台 App 时生效） */
  const messageContact = useCallback(
    (c: ContactRecord) => {
      if (c.kind === 'user') {
        showToast('不能给自己发信息');
        return;
      }
      setPendingChatContact(c.id);
      switchToApp('chat');
    },
    [setPendingChatContact, switchToApp, showToast]
  );

  const detailContact = useMemo(() => contacts?.find((c) => c.id === detailId) ?? null, [contacts, detailId]);
  const vmDetail = useMemo(() => (voicemails ?? []).find((v) => v.id === vmDetailId) ?? null, [voicemails, vmDetailId]);
  const vmDetailContact = useMemo(
    () => (vmDetail ? contacts?.find((c) => c.id === vmDetail.contactId) ?? null : null),
    [vmDetail, contacts]
  );
  const loading = contacts === null;
  const unreadVmCount = (voicemails ?? []).filter((v) => !v.read).length;

  // 主屏电话图标红点同步：未读语音留言数 → unread-store 总线（与微信/QQ 同款；留言载入/已读/删除都会重算）
  useEffect(() => {
    if (voicemails === null) return; // 等 IndexedDB 载入后再同步，避免载入前把已有角标误清成 0
    phoneBadge.set(unreadVmCount);
  }, [voicemails, unreadVmCount]);

  return (
    <IOSScreen>
      <div className="relative flex h-full w-full flex-col overflow-hidden">
        {/* 紧凑标题：小字号居中，与左侧返回键同一行对齐（用户要求标签小一点、和返回键对齐） */}
        <IOSNavBar
          title={TAB_META.find((t) => t.key === tab)?.label ?? '电话'}
          large={false}
          left={
            <>
              {/* 返回主屏幕键（所有 tab 常驻左上） */}
              <BackToHome className="static!" />
            </>
          }
          right={
            tab === 'contacts' ? (
              <button
                type="button"
                onClick={() => setNewContact({ open: true, phone: '' })}
                aria-label="新建联系人（添加好友）"
                data-testid="add-contact"
                className="flex h-9 w-9 items-center justify-center rounded-full text-[#0A84FF] transition-colors active:bg-[#0A84FF]/10"
              >
                <Plus className="h-[24px] w-[24px]" strokeWidth={2} />
              </button>
            ) : tab === 'recents' && logs && logs.length > 0 ? (
              /* 最近通话的「编辑」：右上角（用户要求从左侧移过来） */
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="rounded-full bg-foreground/[0.08] px-4 py-[7px] text-[15px] font-medium leading-none text-foreground transition-all active:scale-95 active:bg-foreground/[0.16]"
                data-testid="edit-logs"
              >
                编辑
              </button>
            ) : undefined
          }
        />

        {toast && (
          <div className="pointer-events-none absolute left-1/2 top-[104px] z-40 -translate-x-1/2" role="status">
            <p className="rounded-full bg-foreground/85 px-4 py-1.5 text-[13px] text-background shadow-lg">{toast}</p>
          </div>
        )}

        {tab === 'favorites' && (
          <FavoritesTab contacts={contacts ?? []} favorites={favorites} onCall={startCall} onToggleFavorite={toggleFavorite} />
        )}
        {tab === 'recents' && (
          <RecentsTab logs={logs} contacts={contacts ?? []} onCall={startCall} onDelete={deleteLog} />
        )}
        {tab === 'contacts' && (
          <ContactsTab
            contacts={contacts ?? []}
            favorites={favorites}
            onOpenDetail={(c) => setDetailId(c.id)}
            onToggleFavorite={toggleFavorite}
            onAddFriend={() => setNewContact({ open: true, phone: '' })}
            loading={loading}
          />
        )}
        {tab === 'keypad' && (
          <KeypadTab
            contacts={contacts ?? []}
            onCall={startCall}
            onNewContact={(phone) => setNewContact({ open: true, phone })}
          />
        )}
        {tab === 'voicemail' && (
          <VoicemailTab
            voicemails={voicemails}
            contacts={contacts ?? []}
            playingId={playingVmId}
            loadingId={loadingVmId}
            onOpen={openVmDetail}
            onTogglePlay={(vm) => void toggleVmPlay(vm)}
            onDelete={deleteVoicemail}
            onToggleRead={toggleVmRead}
          />
        )}

        {/* 底部五段 tab（iOS 18 悬浮胶囊样式） */}
        <nav
          role="tablist"
          aria-label="电话分区"
          className="z-20 shrink-0 bg-background/85 px-3 pb-[calc(20px+env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl"
        >
          <div className="mx-auto flex items-stretch justify-between gap-[2px] rounded-full border border-border/50 bg-muted/70 p-1 shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
            {TAB_META.map((t) => {
              const active = tab === t.key;
              const badge = t.key === 'voicemail' ? unreadVmCount : 0;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  data-testid={`tab-${t.key}`}
                  className={`relative flex flex-1 flex-col items-center gap-[2px] rounded-full py-[7px] transition-colors ${
                    active ? 'bg-foreground/[0.08] text-[#0A84FF]' : 'text-muted-foreground/75 active:text-foreground'
                  }`}
                >
                  <span className="relative">
                    {t.icon(active)}
                    {badge > 0 && (
                      <span
                        className="absolute -right-2.5 -top-1.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#FF3B30] px-1 text-[9.5px] font-semibold leading-none text-white"
                        aria-label={`${badge}条未读留言`}
                      >
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] font-medium leading-none">{t.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* 联系人详情页（覆盖 tab 区，通话层 z-50 在其上） */}
        {detailId && detailContact && (
          <ContactDetail
            contact={detailContact}
            logs={logs}
            voicemails={voicemails ?? []}
            playingId={playingVmId}
            loadingId={loadingVmId}
            onBack={() => setDetailId(null)}
            onCall={startCall}
            onMessage={messageContact}
            onEdit={() => setEditSheetOpen(true)}
            showToast={showToast}
            onOpenVoicemail={openVmDetail}
            onTogglePlay={(vm) => void toggleVmPlay(vm)}
            onDeleteVoicemail={deleteVoicemail}
            onDeleteContact={(c) => void deleteContact(c)}
          />
        )}

        {/* 语音留言详情页（在联系人详情之上） */}
        {vmDetail && (
          <VoicemailDetail
            vm={vmDetail}
            contact={vmDetailContact}
            active={playingVmId === vmDetail.id}
            loading={loadingVmId === vmDetail.id}
            onBack={() => setVmDetailId(null)}
            onTogglePlay={() => void toggleVmPlay(vmDetail)}
            onDelete={() => {
              deleteVoicemail(vmDetail);
              setVmDetailId(null);
            }}
          />
        )}

        {/* 新建联系人（通讯录「+」/ 键盘右上角；保存后自动加为好友） */}
        {newContact.open && (
          <NewContactSheet
            initialPhone={newContact.phone}
            onClose={() => setNewContact({ open: false, phone: '' })}
            onSaved={(c) => {
              setContacts((prev) => {
                const base = prev ?? [];
                return [c, ...base];
              });
              setNewContact({ open: false, phone: '' });
              showToast(`已添加「${c.name}」为好友`);
            }}
          />
        )}

        {/* 详情页快捷编辑（手机号/关系/职业/地区 → 本地 updateContact） */}
        {detailContact && editSheetOpen && (
          <QuickEditSheet
            contact={detailContact}
            onClose={() => setEditSheetOpen(false)}
            onSaved={(c) => {
              setContacts((prev) => (prev ? prev.map((x) => (x.id === c.id ? c : x)) : prev));
              setEditSheetOpen(false);
              showToast('已保存');
            }}
          />
        )}

        {/* 编辑通话记录（清除全部） */}
        <IOSActionSheet
          open={editOpen}
          actions={[
            {
              label: '清除全部通话记录',
              destructive: true,
              onSelect: () => {
                setEditOpen(false);
                clearLogs();
              },
            },
          ]}
          onCancel={() => setEditOpen(false)}
        />

        {/* 通话全屏层 */}
        {callTarget && (
          <CallScreen
            target={callTarget}
            onEnd={handleCallEnd}
            onVoicemail={handleVoicemail}
            onClose={() => setCallTarget(null)}
          />
        )}
      </div>
    </IOSScreen>
  );
}
