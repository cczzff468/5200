'use client';

/**
 * 微信「服务」页面栈（钱包体系）：
 * 服务主页 → 钱包 → 零钱 / 零钱明细 / 零钱通 / 银行卡 / 亲属卡（介绍 → 选人 → 设置 → 管理）
 * 数据独立存 localStorage（wx-wallet / wx-wallet-cards / wx-change-bills / wx-lcq / wx-family-cards），与 QQ 钱包互不影响
 * 界面按微信真实截图 1:1 还原：零钱页、零钱通黄色主题、银行卡添加页、亲属卡三页
 */

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  BedDouble,
  Building2,
  CarTaxiFront,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  CreditCard,
  Delete,
  Dices,
  Flower2,
  Gamepad2,
  Gem,
  Heart,
  HeartPulse,
  Navigation,
  Plus,
  ScanLine,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  TrainFront,
  TrendingUp,
  Umbrella,
  Utensils,
  UtensilsCrossed,
  Wallet as WalletIcon,
  X,
} from 'lucide-react';
import type { ContactRecord } from '@/lib/contacts';

// ---------------- 数据层 ----------------

export interface WxCard {
  id: string;
  bank: string;
  /** 完整卡号（生成的 16 位 Luhn 合法卡号；旧数据可能为空） */
  no: string;
  tail: string;
  holder: string;
  balance: number;
  /** 添加时间戳（旧数据可能缺失） */
  createdAt?: number;
}

interface WxBill {
  id: string;
  kind: '充值' | '提现' | '转入零钱通' | '零钱通转出' | '红包' | '转账';
  amount: number; // 正 = 零钱增加
  time: number;
}

interface WxLcq {
  balance: number;
  totalEarn: number;
  yesterdayEarn: number;
  /** 收益已结算到的日期（Y-M-D），同日幂等 */
  lastDate: string;
}

/** 我赠送的亲属卡（钱包管理页列表；赠送时同步向聊天写入卡片消息） */
export interface WxFamilyCard {
  id: string;
  friendId: string;
  friendName: string;
  friendAvatar: string | null;
  relation: string;
  monthlyLimit: number;
  used: number;
  status: 'pending' | 'active';
  message: string;
  createdAt: number;
}

export const LS_WALLET = 'wx-wallet';
export const LS_CARDS = 'wx-wallet-cards';
export const LS_BILLS = 'wx-change-bills';
const LS_LCQ = 'wx-lcq';
const LS_FC = 'wx-family-cards';
/** 零钱通七日年化收益率（易方达易理财货币A） */
const LCQ_RATE = 0.00913;

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 持久化失败忽略
  }
}

function loadWallet(): { balance: number } {
  const w = loadJSON<{ balance?: number }>(LS_WALLET, {});
  return { balance: typeof w.balance === 'number' && w.balance >= 0 ? w.balance : 0 };
}

export function loadCards(): WxCard[] {
  const list = loadJSON<Partial<WxCard>[]>(LS_CARDS, []);
  if (!Array.isArray(list)) return [];
  return list.filter((c) => c && typeof c.tail === 'string').map((c) => ({
    id: typeof c.id === 'string' ? c.id : uid(),
    bank: typeof c.bank === 'string' ? c.bank : '储蓄卡',
    no: typeof c.no === 'string' ? c.no : '',
    tail: c.tail as string,
    holder: typeof c.holder === 'string' ? c.holder : '',
    balance: typeof c.balance === 'number' ? c.balance : 0,
    createdAt: typeof c.createdAt === 'number' ? c.createdAt : undefined,
  }));
}

function loadBills(): WxBill[] {
  const list = loadJSON<Partial<WxBill>[]>(LS_BILLS, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((b) => b && typeof b.kind === 'string' && typeof b.amount === 'number' && typeof b.time === 'number')
    .map((b) => ({ id: typeof b.id === 'string' ? b.id : uid(), kind: b.kind as WxBill['kind'], amount: b.amount as number, time: b.time as number }));
}

function loadLcq(): WxLcq {
  const l = loadJSON<Partial<WxLcq>>(LS_LCQ, {});
  return {
    balance: typeof l.balance === 'number' && l.balance >= 0 ? l.balance : 0,
    totalEarn: typeof l.totalEarn === 'number' ? l.totalEarn : 0,
    yesterdayEarn: typeof l.yesterdayEarn === 'number' ? l.yesterdayEarn : 0,
    lastDate: typeof l.lastDate === 'string' ? l.lastDate : '',
  };
}

/** 我收到的亲属卡（AI 好友赠送，发红包/转账可用它支付——消费由赠卡人买单，不动我的零钱） */
export interface WxFamilyCardIn {
  id: string;
  fromName: string;
  fromAvatar: string | null;
  relation: string;
  monthlyLimit: number;
  used: number;
  createdAt: number;
}

const LS_FC_IN = 'wx-family-cards-in';

export function loadFamilyCardsIn(): WxFamilyCardIn[] {
  const list = loadJSON<Partial<WxFamilyCardIn>[]>(LS_FC_IN, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((f) => f && typeof f.fromName === 'string')
    .map((f) => ({
      id: typeof f.id === 'string' ? f.id : uid(),
      fromName: f.fromName as string,
      fromAvatar: typeof f.fromAvatar === 'string' ? f.fromAvatar : null,
      relation: typeof f.relation === 'string' ? f.relation : '家人',
      monthlyLimit: typeof f.monthlyLimit === 'number' ? f.monthlyLimit : 0,
      used: typeof f.used === 'number' ? f.used : 0,
      createdAt: typeof f.createdAt === 'number' ? f.createdAt : Date.now(),
    }));
}

export function saveFamilyCardsIn(list: WxFamilyCardIn[]): void {
  saveJSON(LS_FC_IN, list);
}

// ---------------- 聊天消息联动（亲属卡赠送/接收 → 写入微信聊天消息流） ----------------

/** 与 wechat.tsx 的 lsMsgsKey 保持一致的消息存储 key 前缀 */
const WX_LS_MSGS_PREFIX = 'wx-chat-msgs:';

/** 向指定联系人的微信聊天消息流末尾追加一条消息（跨模块写入：钱包赠送亲属卡 → 聊天卡片） */
export function appendWxChatMsg(contactId: string, msg: Record<string, unknown>): void {
  try {
    const raw = window.localStorage.getItem(WX_LS_MSGS_PREFIX + contactId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return;
    parsed.push(msg);
    window.localStorage.setItem(WX_LS_MSGS_PREFIX + contactId, JSON.stringify(parsed.slice(-100)));
  } catch {
    // 读写失败忽略
  }
}

export function loadFamilyCards(): WxFamilyCard[] {
  const list = loadJSON<Partial<WxFamilyCard>[]>(LS_FC, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((f) => f && typeof f.friendName === 'string')
    .map((f) => ({
      id: typeof f.id === 'string' ? f.id : uid(),
      friendId: typeof f.friendId === 'string' ? f.friendId : '',
      friendName: f.friendName as string,
      friendAvatar: typeof f.friendAvatar === 'string' ? f.friendAvatar : null,
      relation: typeof f.relation === 'string' ? f.relation : '其他亲人',
      monthlyLimit: typeof f.monthlyLimit === 'number' ? f.monthlyLimit : 0,
      used: typeof f.used === 'number' ? f.used : 0,
      status: f.status === 'active' ? 'active' : 'pending',
      message: typeof f.message === 'string' ? f.message : '我为你准备了亲属卡，你消费我买单',
      createdAt: typeof f.createdAt === 'number' ? f.createdAt : Date.now(),
    }));
}

export function saveFamilyCards(list: WxFamilyCard[]): void {
  saveJSON(LS_FC, list);
}

// ---------------- 日期工具（零钱通每日收益结算） ----------------

function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function parseDayKey(k: string): number {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getTime();
}

function addDaysKey(k: string, n: number): string {
  const t = parseDayKey(k) + n * 86400000;
  return dayKeyOf(new Date(t));
}

/** 最早一笔「转入零钱通」账单的日期（收益从此日起算） */
function earliestBuyDay(bills: WxBill[]): string | null {
  let min: number | null = null;
  for (const b of bills) {
    if (b.kind !== '转入零钱通') continue;
    if (min === null || b.time < min) min = b.time;
  }
  return min === null ? null : dayKeyOf(new Date(min));
}

/** 零钱通收益每日结算：按当前余额 × 七日年化 ÷ 365，同日幂等，今天不计息 */
function settleLcq(base: WxLcq, earliestBuy: string | null): WxLcq {
  const today = dayKeyOf(new Date());
  if (base.lastDate === today) return base;
  let start: string;
  if (base.lastDate) start = addDaysKey(base.lastDate, 1);
  else if (earliestBuy) start = earliestBuy;
  else return { ...base, lastDate: today, yesterdayEarn: 0 };
  let total = base.totalEarn;
  let yesterday = 0;
  let d = start;
  let guard = 0;
  while (parseDayKey(d) < parseDayKey(today) && guard < 400) {
    const earn = Math.round(((base.balance * LCQ_RATE) / 365) * 100) / 100;
    total += earn;
    yesterday = earn;
    d = addDaysKey(d, 1);
    guard += 1;
  }
  return {
    balance: base.balance,
    totalEarn: Math.round(total * 100) / 100,
    yesterdayEarn: yesterday,
    lastDate: today,
  };
}

// ---------------- 金额键盘输入 ----------------

export function pushAmount(cur: string, key: string): string {
  if (key === 'del') return cur.slice(0, -1);
  if (key === '.') return cur.includes('.') ? cur : `${cur === '' ? '0' : cur}.`;
  const [int, dec] = cur.split('.');
  if (dec !== undefined) {
    if (dec.length >= 2) return cur;
    return cur + key;
  }
  if (cur === '0') return key;
  if (int.length >= 6) return cur;
  return cur + key;
}

export function fmtMoney(n: number): string {
  return n.toFixed(2);
}

export function fmtBillTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------------- 通用小组件 ----------------

const BANK_COLORS: Record<string, [string, string]> = {
  工商银行: ['#B3000C', '#E2483F'],
  建设银行: ['#0B62C1', '#3E8EDE'],
  农业银行: ['#008C4A', '#35B478'],
  中国银行: ['#8E0722', '#C43A52'],
  招商银行: ['#D03A2B', '#E8604F'],
  交通银行: ['#073C8C', '#3C6FC4'],
  邮储银行: ['#007A3D', '#37A468'],
};

/** 各银行发卡 BIN 前缀（生成卡号用） */
const BANK_BINS: Record<string, string> = {
  工商银行: '622202',
  建设银行: '621700',
  农业银行: '622848',
  中国银行: '621785',
  招商银行: '622588',
  交通银行: '622260',
  邮储银行: '621758',
};

/** 生成 16 位 Luhn 校验合法的银行卡号（BIN 前缀 + 随机数 + 校验位） */
function genCardNo(bank: string): string {
  let no = BANK_BINS[bank] ?? '622848';
  while (no.length < 15) no += String(Math.floor(Math.random() * 10));
  let sum = 0;
  const rev = no.split('').reverse();
  for (let i = 0; i < rev.length; i++) {
    let d = Number(rev[i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return no + String((10 - (sum % 10)) % 10);
}

/** 卡号展示：4 位一组空格分组；无完整卡号的旧数据兜底为 ****尾号（与 QQ 钱包 formatCardNo 同款） */
function formatWxCardNo(no: string, tail: string): string {
  const src = /^\d{15,19}$/.test(no) ? no : `****${tail}`;
  return src.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** 银行渐变圆标（取银行名首字；支付方式弹层等外部复用） */
export function BankDot({ bank, size = 38 }: { bank: string; size?: number }) {
  const [c1, c2] = BANK_COLORS[bank] ?? ['#5A6068', '#878E96'];
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${c1}, ${c2})`, fontSize: Math.round(size * 0.42) }}
    >
      {bank.charAt(0)}
    </span>
  );
}

/** 方形圆角头像（微信风格，与主文件 WxAvatar 同款） */
function MiniAvatar({ src, alt, size = 40 }: { src: string | null; alt: string; size?: number }) {
  const radius = Math.max(4, Math.round(size * 0.11));
  const style = { width: size, height: size, borderRadius: radius };
  if (src) return <img src={src} alt={alt} className="shrink-0 bg-muted object-cover" style={style} />;
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center bg-[#C9C9CE] text-white dark:bg-[#3C3C42]"
      style={style}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: size * 0.6, height: size * 0.6 }}>
        <circle cx="12" cy="8.2" r="4.3" />
        <path d="M12 14.1c-4.7 0-8.1 2.7-8.1 6.3 0 .9.7 1.6 1.6 1.6h13c.9 0 1.6-.7 1.6-1.6 0-3.6-3.4-6.3-8.1-6.3z" />
      </svg>
    </div>
  );
}

/** 顶部导航：返回 + 居中标题 + 右上角动作 */
function WxNav({
  title,
  onBack,
  right,
  light = false,
  testId,
}: {
  title?: string;
  onBack: () => void;
  right?: React.ReactNode;
  light?: boolean;
  testId?: string;
}) {
  return (
    <div className={`shrink-0 pt-[54px] ${light ? 'text-white' : 'text-black dark:text-white'}`}>
      <div className="relative flex h-11 items-center px-2">
        <button type="button" aria-label="返回" data-testid={testId} onClick={onBack} className="active:opacity-50">
          <ChevronLeft className="h-7 w-7" strokeWidth={2} />
        </button>
        {title !== undefined && <div className="flex-1 pr-8 text-center text-[17px] font-medium">{title}</div>}
        {right && <div className="absolute right-4 top-0 flex h-11 items-center">{right}</div>}
      </div>
    </div>
  );
}

/** 「···」更多 */
function MoreDots() {
  return (
    <span aria-hidden="true" className="flex items-center gap-[3px]">
      <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
      <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
      <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
    </span>
  );
}

/** 自绘数字键盘（微信亲属卡/金额弹层同款：3 列数字 + 右列删除 + 竖跨确认键；红包页用红色确认键） */
export function NumPad({
  onKey,
  onSubmit,
  submitLabel,
  submitTestId,
  submitColor = 'green',
}: {
  onKey: (k: string) => void;
  onSubmit: () => void;
  submitLabel: string;
  submitTestId?: string;
  submitColor?: 'green' | 'red';
}) {
  const keyBtn =
    'flex h-[52px] items-center justify-center rounded-[8px] bg-white text-[22px] text-black active:bg-black/10 dark:bg-[#2C2C30] dark:text-white dark:active:bg-white/10';
  const submitBg = submitColor === 'red' ? 'bg-[#F04A3A]' : 'bg-[#07C160]';
  return (
    <div className="grid shrink-0 grid-cols-4 gap-[6px] bg-[#E9E9E9] p-[6px] pb-[max(6px,env(safe-area-inset-bottom))] dark:bg-[#161616]">
      {['1', '2', '3'].map((k) => (
        <button key={k} type="button" data-testid={`wx-pad-${k}`} onClick={() => onKey(k)} className={keyBtn}>
          {k}
        </button>
      ))}
      <button
        type="button"
        aria-label="删除"
        data-testid="wx-pad-del"
        onClick={() => onKey('del')}
        className="flex h-[52px] items-center justify-center rounded-[8px] bg-white text-black/70 active:bg-black/10 dark:bg-[#2C2C30] dark:text-white/70 dark:active:bg-white/10"
      >
        <Delete className="h-6 w-6" strokeWidth={1.7} />
      </button>
      {['4', '5', '6'].map((k) => (
        <button key={k} type="button" data-testid={`wx-pad-${k}`} onClick={() => onKey(k)} className={keyBtn}>
          {k}
        </button>
      ))}
      <button
        type="button"
        data-testid={submitTestId ?? 'wx-pad-submit'}
        onClick={onSubmit}
        className={`row-span-3 rounded-[8px] text-[17px] font-medium text-white active:brightness-95 ${submitBg}`}
      >
        {submitLabel}
      </button>
      {['7', '8', '9'].map((k) => (
        <button key={k} type="button" data-testid={`wx-pad-${k}`} onClick={() => onKey(k)} className={keyBtn}>
          {k}
        </button>
      ))}
      <button type="button" data-testid="wx-pad-0" onClick={() => onKey('0')} className={keyBtn}>
        0
      </button>
      <button type="button" data-testid="wx-pad-dot" onClick={() => onKey('.')} className={keyBtn}>
        .
      </button>
      <div aria-hidden="true" />
    </div>
  );
}

/** 底部金额弹层：标题 +（可选自定义行）+ 金额大字 + 数字键盘 */
function AmountPadSheet({
  title,
  note,
  submitLabel,
  submitTestId,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  note?: string;
  submitLabel: string;
  submitTestId?: string;
  onSubmit: (amount: number) => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const [val, setVal] = useState('');
  const num = parseFloat(val || '0');
  const ok = num > 0;
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end" data-testid="wx-amount-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] dark:bg-[#1E1E1E]">
        <div className="relative flex h-14 items-center justify-center border-b border-black/5 dark:border-white/10">
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="absolute left-3 flex h-9 w-9 items-center justify-center text-black/60 active:opacity-60 dark:text-white/60"
          >
            <X className="h-6 w-6" strokeWidth={1.8} />
          </button>
          <div className="text-[16px] font-medium text-black dark:text-white">{title}</div>
        </div>
        {children}
        <div className="py-5 text-center" data-testid="wx-amount-value">
          <div className="text-[34px] font-semibold text-black dark:text-white">¥ {val || '0.00'}</div>
          {note && <div className="mt-1 text-[12px] text-black/40 dark:text-white/40">{note}</div>}
        </div>
        <NumPad
          onKey={(k) => setVal((v) => pushAmount(v, k))}
          onSubmit={() => ok && onSubmit(num)}
          submitLabel={submitLabel}
          submitTestId={submitTestId}
        />
      </div>
    </div>
  );
}

/** 底部操作菜单（ActionSheet） */
function ActionSheet({
  actions,
  onClose,
}: {
  actions: Array<{ label: string; danger?: boolean; onClick: () => void }>;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="取消" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative mx-3 mb-6 overflow-hidden rounded-[12px] bg-[#F7F7F7] pb-[max(0px,env(safe-area-inset-bottom))] dark:bg-[#242424]">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.onClick}
            className={`w-full border-b border-black/5 py-[15px] text-center text-[17px] active:bg-black/5 dark:border-white/10 dark:active:bg-white/10 ${
              a.danger ? 'text-[#FA5151]' : 'text-black dark:text-white'
            }`}
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full bg-white py-[15px] text-center text-[17px] text-black active:bg-black/5 dark:bg-[#1A1A1A] dark:text-white dark:active:bg-white/10"
        >
          取消
        </button>
      </div>
    </div>
  );
}

// ---------------- 服务主页（微信官方版式：绿色收付款|钱包大块 + 分类白卡） ----------------

function ServicesHome({
  balance,
  onExit,
  onOpen,
  onToast,
}: {
  balance: number;
  onExit: () => void;
  onOpen: (v: 'wallet' | 'lcq' | 'cards') => void;
  onToast: (m: string) => void;
}) {
  const tile = (label: string, color: string, icon: React.ReactNode, onClick: () => void, testId?: string) => (
    <button
      key={label}
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex flex-col items-center gap-[7px] py-[13px] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
    >
      <span className="flex h-[30px] w-[30px] items-center justify-center" style={{ color }} aria-hidden="true">
        {icon}
      </span>
      <span className="text-[12px] leading-none text-black/85 dark:text-white/85">{label}</span>
    </button>
  );
  const section = (title: string, cols: 3 | 4, children: React.ReactNode) => (
    <div className="mt-3 overflow-hidden rounded-[12px] bg-white px-1 pb-1.5 pt-3 dark:bg-[#1A1A1A]">
      <p className="mb-0.5 px-3 text-[14px] text-black/45 dark:text-white/45">{title}</p>
      <div className={cols === 3 ? 'grid grid-cols-3' : 'grid grid-cols-4'}>{children}</div>
    </div>
  );
  return (
    <div className="relative flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-services-home">
      <WxNav
        title="服务"
        onBack={onExit}
        testId="wx-services-back"
        right={
          <button type="button" aria-label="更多" onClick={() => onToast('更多功能暂未开放')}>
            <MoreDots />
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        {/* 收付款 | 钱包（绿色渐变整块） */}
        <div className="grid grid-cols-2 overflow-hidden rounded-[12px] bg-gradient-to-br from-[#0BC268] to-[#069A4E] shadow-sm">
          <button
            type="button"
            data-testid="wx-services-pay"
            onClick={() => onToast('收付款暂未开放')}
            className="flex flex-col items-center justify-center gap-2 py-[26px] active:bg-white/10"
          >
            <ScanLine className="h-[34px] w-[34px] text-white" strokeWidth={1.5} />
            <span className="text-[16px] font-medium text-white">收付款</span>
          </button>
          <button
            type="button"
            data-testid="wx-services-wallet"
            onClick={() => onOpen('wallet')}
            className="flex flex-col items-center justify-center gap-2 py-[26px] active:bg-white/10"
          >
            <WalletIcon className="h-[34px] w-[34px] text-white" strokeWidth={1.5} />
            <span className="text-[16px] font-medium text-white">钱包</span>
            <span className="-mt-1.5 text-[13px] text-white/75" data-testid="wx-services-balance">
              ¥{fmtMoney(balance)}
            </span>
          </button>
        </div>

        {/* 金融理财 */}
        {section(
          '金融理财',
          3,
          <>
            {tile('信用卡还款', '#07C160', <CreditCard className="h-[25px] w-[25px]" strokeWidth={1.7} />, () => onToast('信用卡还款暂未开放'))}
            {tile('理财通', '#4D9CF8', <TrendingUp className="h-[25px] w-[25px]" strokeWidth={1.7} />, () => onToast('理财通暂未开放'))}
            {tile('保险服务', '#ED6C4E', <Umbrella className="h-[25px] w-[25px]" strokeWidth={1.7} />, () => onToast('保险服务暂未开放'))}
          </>
        )}

        {/* 生活服务 */}
        {section(
          '生活服务',
          4,
          <>
            {tile('手机充值', '#4D9CF8', <Smartphone className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('手机充值暂未开放'))}
            {tile('生活缴费', '#07C160', <CircleCheck className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('生活缴费暂未开放'))}
            {tile('Q币充值', '#4D9CF8', <Gamepad2 className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('Q币充值暂未开放'))}
            {tile('城市服务', '#07C160', <Building2 className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('城市服务暂未开放'))}
            {tile('腾讯公益', '#FA5151', <Flower2 className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('腾讯公益暂未开放'))}
            {tile('医疗健康', '#ED6C4E', <HeartPulse className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('医疗健康暂未开放'))}
          </>
        )}

        {/* 交通出行 */}
        {section(
          '交通出行',
          4,
          <>
            {tile('出行服务', '#4D9CF8', <Navigation className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('出行服务暂未开放'))}
            {tile('火车票机票', '#07C160', <TrainFront className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('火车票机票暂未开放'))}
            {tile('滴滴出行', '#F7A500', <CarTaxiFront className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('滴滴出行暂未开放'))}
            {tile('酒店民宿', '#07C160', <BedDouble className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('酒店民宿暂未开放'))}
          </>
        )}

        {/* 购物消费 */}
        {section(
          '购物消费',
          4,
          <>
            {tile('京东购物', '#ED6C4E', <ShoppingBag className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('京东购物暂未开放'))}
            {tile('拼多多', '#FA5151', <ShoppingBasket className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('拼多多暂未开放'))}
            {tile('美团外卖', '#F7A500', <Utensils className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('美团外卖暂未开放'))}
            {tile('饿了么', '#4D9CF8', <UtensilsCrossed className="h-[24px] w-[24px]" strokeWidth={1.7} />, () => onToast('饿了么暂未开放'))}
          </>
        )}

        <p className="mt-7 text-center text-[12px] text-black/35 dark:text-white/35">微信支付 · 本服务由财付通提供</p>
      </div>
    </div>
  );
}

// ---------------- 钱包页 ----------------

function WalletPage({
  balance,
  cards,
  familyCards,
  onBack,
  onOpen,
  onToast,
}: {
  balance: number;
  cards: WxCard[];
  familyCards: WxFamilyCard[];
  onBack: () => void;
  onOpen: (v: 'change' | 'lcq' | 'cards' | 'fcIntro' | 'fcManage' | 'paySettings') => void;
  onToast: (m: string) => void;
}) {
  const row = (
    label: string,
    icon: React.ReactNode,
    right: React.ReactNode,
    onClick: () => void,
    testId: string,
    first = false
  ) => (
    <button
      key={label}
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="relative flex w-full items-center gap-3 px-4 py-[15px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
    >
      {!first && <span className="absolute left-[62px] right-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />}
      {icon}
      <span className="min-w-0 flex-1 truncate text-[16px]">{label}</span>
      <span className="text-[14px] text-black/45 dark:text-white/45">{right}</span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
    </button>
  );
  return (
    <div className="relative flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-wallet-page">
      <WxNav title="钱包" onBack={onBack} testId="wx-wallet-back" right={<button type="button" aria-label="更多" onClick={() => onToast('更多功能暂未开放')}><MoreDots /></button>} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        <div className="overflow-hidden rounded-[12px] bg-white dark:bg-[#1A1A1A]">
          {row(
            '零钱',
            <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-gradient-to-br from-[#4D9CF8] to-[#2F7FE0] text-[17px] font-semibold text-white" aria-hidden="true">
              ¥
            </span>,
            `¥${fmtMoney(balance)}`,
            () => onOpen('change'),
            'wx-wallet-change',
            true
          )}
          {row(
            '零钱通',
            <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-gradient-to-br from-[#F7B500] to-[#F79C00] text-white" aria-hidden="true">
              <Gem className="h-[17px] w-[17px]" strokeWidth={2} />
            </span>,
            '',
            () => onOpen('lcq'),
            'wx-wallet-lcq'
          )}
          {row(
            '银行卡',
            <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-gradient-to-br from-[#5AA9FA] to-[#3D8BE8] text-white" aria-hidden="true">
              <CreditCard className="h-[17px] w-[17px]" strokeWidth={2} />
            </span>,
            cards.length > 0 ? `${cards.length}张` : '添加',
            () => onOpen('cards'),
            'wx-wallet-cards'
          )}
          {row(
            '亲属卡',
            <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-gradient-to-br from-[#F7B500] to-[#F79C00] text-white" aria-hidden="true">
              <Heart className="h-[17px] w-[17px]" strokeWidth={2} />
            </span>,
            familyCards.length > 0 ? `${familyCards.length}张` : '未开通',
            () => onOpen(familyCards.length > 0 ? 'fcManage' : 'fcIntro'),
            'wx-wallet-fc'
          )}
          {row(
            '支付设置',
            <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-gradient-to-br from-[#6F7B8C] to-[#4E5765] text-white" aria-hidden="true">
              <ShieldCheck className="h-[17px] w-[17px]" strokeWidth={2} />
            </span>,
            wxLoadPayPwd().enabled && wxLoadPayPwd().pwd ? '已开启' : '未开启',
            () => onOpen('paySettings'),
            'wx-wallet-payset'
          )}
        </div>
        <p className="mt-10 text-center text-[12px] text-black/35 dark:text-white/35">本服务由财付通提供</p>
      </div>
    </div>
  );
}

// ---------------- 零钱页 ----------------

function ChangePage({
  balance,
  onBack,
  onOpenDetail,
  onRecharge,
  onWithdraw,
  onToast,
}: {
  balance: number;
  onBack: () => void;
  onOpenDetail: () => void;
  onRecharge: () => void;
  onWithdraw: () => void;
  onToast: (m: string) => void;
}) {
  return (
    <div className="relative flex h-full w-full flex-col bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-change-page">
      <WxNav
        onBack={onBack}
        testId="wx-change-back"
        right={
          <button type="button" data-testid="wx-change-detail-link" onClick={onOpenDetail} className="text-[15px] active:opacity-50">
            零钱明细
          </button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto pt-[7vh]">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#F7B500] text-[30px] font-semibold text-white" aria-hidden="true">
          ¥
        </span>
        <p className="mt-8 text-[16px]">我的零钱</p>
        <p className="mt-3 font-semibold" data-testid="wx-change-balance">
          <span className="text-[24px]">¥</span>
          <span className="ml-1 text-[42px]">{fmtMoney(balance)}</span>
        </p>
        <button type="button" onClick={() => onToast('请在零钱通页转入')} className="mt-5 flex items-center gap-0.5 text-[15px] text-[#FA9D3B] active:opacity-60">
          转入零钱通，能赚又能花
          <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>
      <div className="shrink-0 px-[22%] pb-2">
        <button
          type="button"
          data-testid="wx-change-recharge"
          onClick={onRecharge}
          className="h-12 w-full rounded-[8px] bg-[#07C160] text-[17px] font-medium text-white active:brightness-95"
        >
          充值
        </button>
        <button
          type="button"
          data-testid="wx-change-withdraw"
          onClick={onWithdraw}
          className="mt-4 h-12 w-full rounded-[8px] bg-[#F2F2F2] text-[17px] text-black active:bg-black/5 dark:bg-[#2A2A2A] dark:text-white dark:active:bg-white/10"
        >
          提现
        </button>
      </div>
      <div className="shrink-0 pb-7 pt-5 text-center">
        <button type="button" onClick={() => onToast('常见问题暂未开放')} className="text-[14px] text-[#576B95] active:opacity-60">
          常见问题
        </button>
        <p className="mt-2 text-[12px] text-black/30 dark:text-white/30">本服务由财付通提供</p>
      </div>
    </div>
  );
}

// ---------------- 零钱明细页 ----------------

function BillIcon({ kind }: { kind: WxBill['kind'] }) {
  const map: Record<WxBill['kind'], [string, React.ReactNode]> = {
    充值: ['#07C160', <Plus key="i" className="h-4 w-4" strokeWidth={2.2} />],
    提现: ['#4D9CF8', <WalletIcon key="i" className="h-4 w-4" strokeWidth={2.2} />],
    转入零钱通: ['#F7A500', <Gem key="i" className="h-4 w-4" strokeWidth={2.2} />],
    零钱通转出: ['#8E8E93', <Gem key="i" className="h-4 w-4" strokeWidth={2.2} />],
    红包: ['#F04A3A', <Heart key="i" className="h-4 w-4" strokeWidth={2.2} />],
    转账: ['#F5A63C', <ArrowLeftRight key="i" className="h-4 w-4" strokeWidth={2.2} />],
  };
  const [color, icon] = map[kind];
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${color}1A`, color }} aria-hidden="true">
      {icon}
    </span>
  );
}

function ChangeDetailPage({ bills, onBack }: { bills: WxBill[]; onBack: () => void }) {
  return (
    <div className="relative flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-change-detail-page">
      <WxNav title="零钱明细" onBack={onBack} testId="wx-change-detail-back" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        {bills.length === 0 ? (
          <p className="pt-24 text-center text-[14px] text-black/35 dark:text-white/35">暂无零钱明细</p>
        ) : (
          <div className="overflow-hidden rounded-[12px] bg-white dark:bg-[#1A1A1A]">
            {bills.map((b, i) => (
              <div
                key={b.id}
                data-testid="wx-change-bill-item"
                className={`relative flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.06]' : ''}`}
              >
                <BillIcon kind={b.kind} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15.5px]">{b.kind}</p>
                  <p className="mt-0.5 text-[12px] text-black/40 dark:text-white/40">{fmtBillTime(b.time)}</p>
                </div>
                <p className="text-[16px] font-medium">
                  {b.amount >= 0 ? '+' : '-'}
                  {fmtMoney(Math.abs(b.amount))}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- 零钱通页 ----------------

function ChangePlusPage({
  lcq,
  onBack,
  onOpenDetail,
  onTransferIn,
  onTransferOut,
  onToast,
}: {
  lcq: WxLcq;
  onBack: () => void;
  onOpenDetail: () => void;
  onTransferIn: () => void;
  onTransferOut: () => void;
  onToast: (m: string) => void;
}) {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-gradient-to-b from-[#F7A400] to-[#F8B500] text-white" data-testid="wx-lcq-page">
      {/* 斜向高光装饰 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{ background: 'linear-gradient(115deg, transparent 52%, rgba(255,255,255,0.22) 52.3%, rgba(255,255,255,0.22) 72%, transparent 72.3%)' }}
      />
      <div className="relative">
        <WxNav
          onBack={onBack}
          testId="wx-lcq-back"
          light
          right={
            <button type="button" aria-label="更多" onClick={() => onToast('更多功能暂未开放')}>
              <MoreDots />
            </button>
          }
        />
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto pb-6">
        <div className="flex flex-col items-center pt-2">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20" aria-hidden="true">
            <Gem className="h-7 w-7 text-white" strokeWidth={1.8} />
          </span>
          <p className="mt-2 text-[19px] font-semibold">零钱通</p>
          <button type="button" onClick={() => onToast('资金安全由保险公司保障')} className="mt-1.5 flex items-center gap-1 text-[13px] text-white/90 active:opacity-60">
            <ShieldCheck className="h-4 w-4" strokeWidth={2} />
            资金安全保障中
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        </div>

        {/* 主卡片 */}
        <div className="mx-3 mt-4 rounded-[16px] bg-white px-6 py-6 text-black shadow-sm dark:bg-[#1A1A1A] dark:text-white">
          <p className="text-center text-[15px] text-black/60 dark:text-white/60">账户余额</p>
          <p className="mt-1 text-center font-semibold" data-testid="wx-lcq-balance">
            <span className="text-[22px]">¥</span>
            <span className="ml-1 text-[38px]">{fmtMoney(lcq.balance)}</span>
          </p>
          <div className="mt-1 text-center">
            <button type="button" data-testid="wx-lcq-detail" onClick={onOpenDetail} className="text-[14px] text-[#576B95] active:opacity-60">
              资金明细
            </button>
          </div>

          <div className="mt-7 flex items-stretch">
            <div className="flex-1 text-center">
              <button type="button" onClick={() => onToast('易方达易理财货币A · 七日年化 0.9130%')} className="inline-flex items-center gap-0.5 text-[13px] text-black/45 dark:text-white/45">
                7日年化收益率
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
              <p className="mt-1 text-[23px] font-semibold">0.9130%</p>
              <span className="mt-2 inline-block rounded-full bg-black/[0.05] px-2.5 py-1 text-[11.5px] text-black/50 dark:bg-white/10 dark:text-white/50">
                易方达易理财货币A
              </span>
            </div>
            <div className="w-px bg-black/[0.07] dark:bg-white/[0.1]" aria-hidden="true" />
            <div className="flex-1 text-center">
              <button type="button" className="inline-flex items-center gap-0.5 text-[13px] text-black/45 dark:text-white/45" onClick={() => onToast('收益每日发放')}>
                累计收益
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
              <p className="mt-1 text-[23px] font-semibold" data-testid="wx-lcq-earn-total">
                ¥{fmtMoney(lcq.totalEarn)}
              </p>
              <span className="mt-2 inline-block rounded-full bg-black/[0.05] px-2.5 py-1 text-[11.5px] text-black/50 dark:bg-white/10 dark:text-white/50" data-testid="wx-lcq-earn-yesterday">
                昨日 ¥{fmtMoney(lcq.yesterdayEarn)}
              </span>
            </div>
          </div>

          <div className="mt-8 flex gap-4 px-6">
            <button
              type="button"
              data-testid="wx-lcq-out"
              onClick={onTransferOut}
              className="h-12 flex-1 rounded-[8px] bg-[#F7F7F7] text-[17px] text-black active:bg-black/5 dark:bg-[#2A2A2A] dark:text-white dark:active:bg-white/10"
            >
              转出
            </button>
            <button
              type="button"
              data-testid="wx-lcq-in"
              onClick={onTransferIn}
              className="h-12 flex-1 rounded-[8px] bg-[#F7A500] text-[17px] font-medium text-white active:brightness-95"
            >
              转入
            </button>
          </div>

          <button type="button" onClick={() => onToast('定时转入暂未开放')} className="mx-auto mt-6 flex items-center gap-1.5 text-[14px] text-black/45 dark:text-white/45">
            <Clock className="h-4 w-4" strokeWidth={2} />
            设置定时转入
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        </div>

        {/* 更多产品 */}
        <p className="mb-2 mt-5 px-4 text-[14px] text-white/95">更多产品</p>
        <div className="mx-3 overflow-hidden rounded-[16px] bg-white px-5 py-1 text-black dark:bg-[#1A1A1A] dark:text-white">
          <button type="button" onClick={() => onToast('理财通暂未开放')} className="flex w-full items-center gap-3 py-3.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.06]">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#4D9CF8] to-[#2F6FE0]" aria-hidden="true">
              <TrendingUp className="h-4 w-4 text-white" strokeWidth={2.2} />
            </span>
            <span className="flex-1 text-[17px]">理财通</span>
            <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
          <div className="flex items-center gap-3 border-t border-black/[0.05] py-3.5 dark:border-white/[0.08]">
            <div className="min-w-0 flex-1">
              <p className="text-[15px]">活期理财</p>
              <p className="mt-0.5 text-[13px] text-black/45 dark:text-white/45">转出最快秒到账</p>
            </div>
            <div className="text-right">
              <p className="text-[17px] font-medium text-[#ED6C4E]">1.51%</p>
              <p className="mt-0.5 text-[12px] text-black/45 dark:text-white/45">收益率</p>
            </div>
          </div>
          <div className="flex items-center gap-3 border-t border-black/[0.05] py-3.5 dark:border-white/[0.08]">
            <div className="min-w-0 flex-1">
              <p className="text-[15px]">定期理财</p>
              <p className="mt-0.5 text-[13px] text-black/45 dark:text-white/45">追求更高收益</p>
            </div>
            <div className="text-right">
              <p className="text-[17px] font-medium text-[#ED6C4E]">2.33%</p>
              <p className="mt-0.5 text-[12px] text-black/45 dark:text-white/45">最高收益率</p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-8 text-[14px] text-white/95">
          <button type="button" onClick={() => onToast('了解零钱通暂未开放')}>了解零钱通 ›</button>
          <button type="button" onClick={() => onToast('常见问题暂未开放')}>常见问题 ›</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 银行卡页（QQ 同款卡片视觉 + 详情页：生成卡号 / 自定义金额 / 持卡人真实姓名 / 解绑） ----------------

/** 实体卡视觉（与 QQ 钱包银行卡同款：85.6:54 比例 + 银行品牌渐变 + 圆标 + 金色芯片 + 闪付波纹 + 持卡人/余额） */
function BankCardArt({ card, onClick }: { card: WxCard; onClick: () => void }) {
  const [c1, c2] = BANK_COLORS[card.bank] ?? ['#5A6068', '#878E96'];
  return (
    <button
      type="button"
      data-testid="wx-card-item"
      onClick={onClick}
      className="relative block w-full overflow-hidden rounded-[16px] text-left shadow-lg shadow-black/15 transition-transform active:scale-[0.985]"
      style={{ backgroundImage: `linear-gradient(135deg, ${c1}, ${c2})` }}
    >
      {/* 高光装饰 */}
      <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-white/10" />
      <span aria-hidden="true" className="pointer-events-none absolute -right-20 top-10 h-28 w-28 rounded-full bg-white/[0.07]" />
      <span className="relative flex aspect-[85.6/54] flex-col justify-between p-4">
        {/* 银行圆标 + 名称 + 卡类型 */}
        <span className="flex items-center gap-2.5">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/25 text-[15px] font-semibold text-white backdrop-blur-sm"
            aria-hidden="true"
          >
            {card.bank.slice(0, 1)}
          </span>
          <span className="truncate text-[16px] font-semibold text-white">{card.bank}</span>
          <span className="ml-auto shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] leading-4 text-white/95">储蓄卡</span>
        </span>
        {/* 金色芯片 + 闪付波纹 */}
        <span className="mt-2 flex items-center gap-2.5" aria-hidden="true">
          <span className="relative h-7 w-10 shrink-0 overflow-hidden rounded-[5px] bg-gradient-to-br from-[#F3D47C] to-[#C9962E]">
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/15" />
            <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-black/15" />
          </span>
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-white/80" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M7 9a7.5 7.5 0 0 1 0 6" />
            <path d="M11 6.8a11.5 11.5 0 0 1 0 10.4" />
            <path d="M15 4.6a15.5 15.5 0 0 1 0 14.8" />
          </svg>
        </span>
        {/* 卡号 + 持卡人 + 卡内余额 */}
        <span className="block">
          <span
            className="block text-[17px] font-medium tracking-[0.1em] text-white [font-variant-numeric:tabular-nums]"
            data-testid="wx-card-no"
          >
            {formatWxCardNo(card.no, card.tail)}
          </span>
          <span className="mt-2 flex items-end justify-between gap-2">
            <span className="truncate text-[12px] text-white/85" data-testid="wx-card-holder">
              持卡人 {card.holder || '—'}
            </span>
            <span className="shrink-0 text-[12px] font-medium text-white/95">¥{fmtMoney(card.balance)}</span>
          </span>
        </span>
      </span>
    </button>
  );
}

/** 银行卡详情页（点击卡片进入：大卡视觉 + 卡内余额 + 持卡人/卡号/银行/类型/时间 + 两步确认解绑） */
function WxCardDetailPage({
  card,
  onBack,
  onUnbind,
  onToast,
}: {
  card: WxCard;
  onBack: () => void;
  onUnbind: () => void;
  onToast: (m: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    []
  );
  const tapUnbind = () => {
    if (armed) {
      onUnbind();
      return;
    }
    setArmed(true);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmed(false), 3000);
  };
  const fmtTime = (ts: number): string => new Date(ts).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const rows: Array<{ k: string; v: React.ReactNode }> = [
    { k: '卡类型', v: '储蓄卡' },
    { k: '持卡人', v: card.holder || '—' },
    { k: '所属银行', v: card.bank },
    { k: '银行卡号', v: <span className="tracking-wider">{formatWxCardNo(card.no, card.tail)}</span> },
  ];
  return (
    <div className="relative flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-card-detail">
      <WxNav title="银行卡详情" onBack={onBack} testId="wx-card-detail-back" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        <BankCardArt card={card} onClick={() => {}} />
        <div className="mt-3 overflow-hidden rounded-[12px] bg-white dark:bg-[#1A1A1A]">
          <div className="border-b border-black/[0.04] px-4 pb-4 pt-5 text-center dark:border-white/[0.08]">
            <p className="text-[13px] text-black/45 dark:text-white/45">卡内余额（元）</p>
            <p className="mt-1 font-semibold" data-testid="wx-card-detail-balance">
              <span className="text-[20px]">¥</span>
              <span className="ml-1 text-[34px]">{fmtMoney(card.balance)}</span>
            </p>
          </div>
          {rows.map((r) => (
            <div
              key={r.k}
              className="flex min-h-[50px] items-center justify-between gap-3 border-b border-black/[0.04] px-4 py-2 last:border-b-0 dark:border-white/[0.06]"
            >
              <span className="shrink-0 text-[15px] text-black/45 dark:text-white/45">{r.k}</span>
              <span className="min-w-0 truncate text-right text-[15px]">{r.v}</span>
            </div>
          ))}
          {typeof card.createdAt === 'number' && (
            <div className="flex min-h-[50px] items-center justify-between gap-3 px-4 py-2">
              <span className="shrink-0 text-[15px] text-black/45 dark:text-white/45">添加时间</span>
              <span className="text-right text-[15px]">{fmtTime(card.createdAt)}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          data-testid="wx-card-unbind"
          onClick={tapUnbind}
          className={`mt-5 h-12 w-full rounded-[8px] text-[17px] font-medium text-white active:brightness-95 ${armed ? 'bg-[#D6453C]' : 'bg-[#FA5151]/85'}`}
        >
          {armed ? '再点一次确认解除绑定' : '解除绑定'}
        </button>
        <p className="mt-8 text-center text-[12px] text-black/35 dark:text-white/35">本服务由财付通提供</p>
      </div>
    </div>
  );
}

/** 添加银行卡弹层（每次打开重新挂载：持卡人预填真实姓名、金额默认可改） */
function AddCardSheet({
  myRealName,
  onSubmit,
  onClose,
  onToast,
}: {
  myRealName: string;
  onSubmit: (c: { bank: string; no: string; tail: string; holder: string; balance: number }) => void;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [bank, setBank] = useState('招商银行');
  const [no, setNo] = useState('');
  const [amount, setAmount] = useState('8888.88');
  const [holder, setHolder] = useState(myRealName);
  const digits = no.replace(/\D/g, '');
  const amt = Math.round((parseFloat(amount.replace(/[^\d.]/g, '') || '0') || 0) * 100) / 100;
  const canAdd = digits.length >= 12 && digits.length <= 19 && holder.trim().length > 0 && amt >= 0;

  const field = 'h-11 w-full rounded-[8px] bg-black/[0.04] px-3 text-[16px] text-black outline-none placeholder:text-black/30 dark:bg-white/[0.08] dark:text-white dark:placeholder:text-white/30';

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end" data-testid="wx-add-card-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative max-h-[92%] overflow-y-auto rounded-t-2xl bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 dark:bg-[#1E1E1E]">
        <div className="relative flex h-10 items-center justify-center">
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="absolute left-0 flex h-9 w-9 items-center justify-center text-black/60 active:opacity-60 dark:text-white/60"
          >
            <X className="h-6 w-6" strokeWidth={1.8} />
          </button>
          <div className="text-[16px] font-medium text-black dark:text-white">添加银行卡</div>
        </div>
        <p className="mb-2 mt-4 text-[13px] text-black/45 dark:text-white/45">选择银行</p>
        <div className="flex flex-wrap gap-2">
          {Object.keys(BANK_COLORS).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBank(b)}
              className={`rounded-full border px-3.5 py-1.5 text-[14px] active:opacity-70 ${
                bank === b
                  ? 'border-[#07C160] bg-[#07C160]/10 text-[#07C160]'
                  : 'border-black/10 text-black/70 dark:border-white/15 dark:text-white/70'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
        <p className="mb-1 mt-4 text-[13px] text-black/45 dark:text-white/45">卡号</p>
        <div className="flex gap-2">
          <input
            value={no}
            onChange={(e) => setNo(e.target.value)}
            inputMode="numeric"
            placeholder="手填或点击生成"
            data-testid="wx-add-card-no"
            className={`${field} flex-1 font-mono tracking-wide`}
          />
          <button
            type="button"
            data-testid="wx-add-card-gen"
            onClick={() => setNo(genCardNo(bank))}
            className="flex h-11 shrink-0 items-center gap-1 rounded-[8px] bg-[#07C160]/10 px-3 text-[14px] text-[#07C160] active:bg-[#07C160]/20 dark:bg-[#07C160]/20 dark:text-[#2BD579]"
          >
            <Dices className="h-4 w-4" strokeWidth={2} />
            生成卡号
          </button>
        </div>
        <p className="mb-1 mt-4 text-[13px] text-black/45 dark:text-white/45">卡内金额（元）</p>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="自定义卡内金额"
          data-testid="wx-add-card-amount"
          className={field}
        />
        <div className="mt-2 flex gap-2">
          {[888.88, 10000, 100000, 1000000].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount(String(v))}
              className="rounded-full bg-black/[0.04] px-3 py-1 text-[12.5px] text-black/60 active:bg-black/[0.08] dark:bg-white/[0.08] dark:text-white/60 dark:active:bg-white/[0.15]"
            >
              ¥{v.toLocaleString('en-US')}
            </button>
          ))}
        </div>
        <p className="mb-1 mt-4 text-[13px] text-black/45 dark:text-white/45">持卡人</p>
        <input
          value={holder}
          onChange={(e) => setHolder(e.target.value)}
          placeholder="请输入持卡人姓名"
          data-testid="wx-add-card-holder"
          className={field}
        />
        <p className="mt-2 text-[12px] text-black/35 dark:text-white/35">持卡人须为真实姓名，与银行预留一致</p>
        <button
          type="button"
          data-testid="wx-add-card-confirm"
          onClick={() => {
            if (!canAdd) {
              onToast('请填写正确的卡号、金额和持卡人');
              return;
            }
            onSubmit({ bank, no: digits, tail: digits.slice(-4), holder: holder.trim(), balance: amt });
          }}
          className={`mt-6 h-12 w-full rounded-[8px] text-[17px] font-medium text-white active:brightness-95 ${
            canAdd ? 'bg-[#07C160]' : 'bg-[#07C160]/40'
          }`}
        >
          添加
        </button>
      </div>
    </div>
  );
}

function BankCardsPage({
  cards,
  myRealName,
  onBack,
  onAdd,
  onOpenCard,
  onToast,
}: {
  cards: WxCard[];
  myRealName: string;
  onBack: () => void;
  onAdd: (card: { bank: string; no: string; tail: string; holder: string; balance: number }) => void;
  onOpenCard: (card: WxCard) => void;
  onToast: (m: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="relative flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-cards-page">
      <WxNav
        title="银行卡"
        onBack={onBack}
        testId="wx-cards-back"
        right={
          <button type="button" aria-label="更多" onClick={() => onToast('更多功能暂未开放')}>
            <MoreDots />
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        {cards.length > 0 ? (
          <div className="space-y-3">
            {cards.map((c) => (
              <BankCardArt key={c.id} card={c} onClick={() => onOpenCard(c)} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center pt-16 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/[0.04] dark:bg-white/[0.08]" aria-hidden="true">
              <CreditCard className="h-8 w-8 text-black/30 dark:text-white/30" strokeWidth={1.5} />
            </span>
            <p className="mt-4 text-[15px] text-black/45 dark:text-white/45">还没有绑定银行卡</p>
            <p className="mt-1 text-[13px] text-black/35 dark:text-white/35">绑定后可用于充值、提现</p>
          </div>
        )}
        <button
          type="button"
          data-testid="wx-cards-add"
          onClick={() => setAddOpen(true)}
          className={`flex w-full items-center gap-3 rounded-[12px] bg-white px-4 py-5 text-left active:bg-black/[0.03] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06] ${
            cards.length > 0 ? 'mt-3' : ''
          }`}
        >
          <Plus className="h-6 w-6 shrink-0 text-black/70 dark:text-white/70" strokeWidth={2} />
          <span className="text-[17px]">添加银行卡</span>
          <span className="ml-1 text-[13px] text-[#F7A500]">绑新卡送立减金</span>
        </button>
        <p className="mt-10 text-center text-[12px] text-black/35 dark:text-white/35">本服务由财付通提供</p>
      </div>

      {/* 添加银行卡弹层 */}
      {addOpen && (
        <AddCardSheet
          myRealName={myRealName}
          onClose={() => setAddOpen(false)}
          onSubmit={(c) => {
            onAdd(c);
            setAddOpen(false);
            onToast('添加成功');
          }}
          onToast={onToast}
        />
      )}
    </div>
  );
}

// ---------------- 亲属卡：介绍页 ----------------

const FC_RELATIONS = ['爸爸', '妈妈', '儿子', '女儿', '爷爷', '奶奶', '兄弟姐妹', '其他亲人'];

function FamilyIntroPage({ onBack, onGo, onToast }: { onBack: () => void; onGo: () => void; onToast: (m: string) => void }) {
  const [agree, setAgree] = useState(false);
  return (
    <div className="relative flex h-full w-full flex-col bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-fc-intro">
      <WxNav onBack={onBack} testId="wx-fc-intro-back" />
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto pt-[6vh]">
        {/* 卡片插画（旋转黄卡 + 椭圆轨道） */}
        <div className="relative h-[130px] w-[160px]" aria-hidden="true">
          <div className="absolute left-1/2 top-1/2 h-[78px] w-[108px] -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded-[14px] bg-gradient-to-br from-[#FFE9A8] to-[#FFD44D] shadow-sm" />
          <div className="absolute left-1/2 top-1/2 h-[64px] w-[156px] -translate-x-1/2 -translate-y-1/2 -rotate-[24deg] rounded-[50%] border-2 border-[#F5C63C]" />
        </div>
        <h1 className="mt-8 text-[28px] font-semibold">亲属卡</h1>
        <div className="mt-8 text-center text-[17px] leading-[46px]">
          <p>送家人亲属卡</p>
          <p>对方消费我买单</p>
          <p>让支付更简单</p>
        </div>
      </div>
      <div className="shrink-0 px-10 pb-1">
        <button type="button" data-testid="wx-fc-agree" onClick={() => setAgree((v) => !v)} className="mx-auto flex items-center justify-center gap-1.5 active:opacity-70">
          <span
            aria-hidden="true"
            className={`flex h-[18px] w-[18px] items-center justify-center rounded-full ${
              agree ? 'bg-black/25 dark:bg-white/30' : 'border border-black/25 dark:border-white/35'
            } text-white`}
          >
            {agree && <Check className="h-3 w-3" strokeWidth={3} />}
          </span>
          <span className="text-[14px]">我已阅读并同意</span>
          <span className="text-[14px] text-[#576B95]" onClick={(e) => { e.stopPropagation(); onToast('使用说明暂未开放'); }}>
            使用说明
          </span>
        </button>
        <button
          type="button"
          data-testid="wx-fc-go"
          onClick={() => {
            if (!agree) {
              onToast('请先阅读并同意使用说明');
              return;
            }
            onGo();
          }}
          className="mt-4 h-12 w-full rounded-[8px] bg-[#07C160] text-[17px] font-medium text-white active:brightness-95"
        >
          赠送亲属卡
        </button>
      </div>
      <p className="shrink-0 pb-7 pt-4 text-center text-[12px] text-black/30 dark:text-white/30">本服务由财付通提供</p>
    </div>
  );
}

// ---------------- 亲属卡：选择家人 ----------------

function FamilyPickPage({
  friends,
  onBack,
  onPicked,
}: {
  friends: ContactRecord[];
  onBack: () => void;
  onPicked: (friend: ContactRecord, relation: string) => void;
}) {
  const [pickFriend, setPickFriend] = useState<ContactRecord | null>(null);
  return (
    <div className="relative flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-fc-pick">
      <WxNav title="选择家人" onBack={onBack} testId="wx-fc-pick-back" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        {friends.length === 0 ? (
          <p className="pt-24 text-center text-[14px] text-black/35 dark:text-white/35">还没有好友，先去添加朋友吧</p>
        ) : (
          <div className="overflow-hidden rounded-[12px] bg-white dark:bg-[#1A1A1A]">
            {friends.map((f, i) => (
              <button
                key={f.id}
                type="button"
                data-testid="wx-fc-friend-item"
                onClick={() => setPickFriend(f)}
                className={`relative flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] ${
                  i > 0 ? 'border-t border-black/[0.05] dark:border-white/[0.08]' : ''
                }`}
              >
                <MiniAvatar src={f.avatar} alt={f.name} />
                <span className="min-w-0 flex-1 truncate text-[16px]">{f.name}</span>
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
              </button>
            ))}
          </div>
        )}
      </div>
      {pickFriend && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end">
          <button type="button" aria-label="取消" onClick={() => setPickFriend(null)} className="absolute inset-0 bg-black/40" />
          <div className="relative mx-3 mb-6 rounded-[12px] bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))] dark:bg-[#242424]">
            <div className="flex items-center gap-3 border-b border-black/5 pb-3 dark:border-white/10">
              <MiniAvatar src={pickFriend.avatar} alt={pickFriend.name} size={36} />
              <span className="text-[16px] font-medium">给 {pickFriend.name} 选择关系</span>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {FC_RELATIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  data-testid={`wx-fc-rel-${r}`}
                  onClick={() => onPicked(pickFriend, r)}
                  className="rounded-[8px] bg-black/[0.04] py-2.5 text-[14px] text-black active:bg-black/10 dark:bg-white/[0.08] dark:text-white dark:active:bg-white/15"
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 亲属卡：设置页（额度 + 自绘键盘） ----------------

function FamilySetupPage({
  friend,
  relation,
  onBack,
  onGift,
  onToast,
}: {
  friend: ContactRecord;
  relation: string;
  onBack: () => void;
  onGift: (amount: number, message: string) => void;
  onToast: (m: string) => void;
}) {
  const [val, setVal] = useState('');
  const [message, setMessage] = useState('我为你准备了亲属卡，你消费我买单');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message);
  const num = parseFloat(val || '0');

  const submit = () => {
    if (!(num >= 0.01)) {
      onToast('请设置每月消费上限');
      return;
    }
    if (num > 3000) {
      onToast('每月消费上限不能超过 3000 元');
      return;
    }
    onGift(num, message);
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-[#F7F7F7] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-fc-setup">
      <WxNav title="设置亲属卡" onBack={onBack} testId="wx-fc-setup-back" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
        <div className="flex items-center gap-3">
          <MiniAvatar src={friend.avatar} alt={friend.name} size={42} />
          <span className="text-[17px]" data-testid="wx-fc-setup-name">
            {friend.name}（{relation}）
          </span>
        </div>

        <p className="mt-5 text-[15px] leading-relaxed">
          {message}
          {!editing && (
            <button
              type="button"
              data-testid="wx-fc-edit-msg"
              onClick={() => {
                setDraft(message);
                setEditing(true);
              }}
              className="ml-2 text-[#576B95] active:opacity-60"
            >
              修改留言
            </button>
          )}
        </p>
        {editing && (
          <div className="mt-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={40}
              rows={2}
              className="w-full resize-none rounded-[8px] bg-black/[0.04] p-3 text-[15px] text-black outline-none dark:bg-white/[0.08] dark:text-white"
            />
            <button
              type="button"
              onClick={() => {
                setMessage(draft.trim() || '我为你准备了亲属卡，你消费我买单');
                setEditing(false);
              }}
              className="mt-1.5 text-[14px] text-[#576B95] active:opacity-60"
            >
              完成
            </button>
          </div>
        )}

        {/* 每月消费上限卡片（黄色星球装饰） */}
        <div className="relative mt-4 overflow-hidden rounded-[12px] bg-white px-6 py-7 dark:bg-[#1A1A1A]">
          <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-gradient-to-br from-[#FFF3C4] to-[#FFE79A] opacity-90" />
          <div aria-hidden="true" className="pointer-events-none absolute right-2 top-6 h-16 w-32 rounded-[50%] border-2 border-[#F5C63C] opacity-70" style={{ transform: 'rotate(-18deg)' }} />
          <p className="relative text-[15px]">设置每月消费上限</p>
          <p className="relative mt-2 font-semibold" data-testid="wx-fc-limit">
            <span className="text-[22px]">¥</span>
            <span className="ml-1 text-[38px]">{val || '0.00'}</span>
          </p>
        </div>
      </div>
      <NumPad onKey={(k) => setVal((v) => pushAmount(v, k))} onSubmit={submit} submitLabel="赠送" submitTestId="wx-fc-gift" />
    </div>
  );
}

// ---------------- 亲属卡：管理页 ----------------

function FamilyManagePage({
  cards,
  received,
  onBack,
  onUnbind,
  onSimulateReceive,
  onAdd,
  onToast,
}: {
  cards: WxFamilyCard[];
  received: WxFamilyCardIn[];
  onBack: () => void;
  onUnbind: (id: string) => void;
  onSimulateReceive: () => void;
  onAdd: () => void;
  onToast: (m: string) => void;
}) {
  const [unbind, setUnbind] = useState<WxFamilyCard | null>(null);
  return (
    <div className="relative flex h-full w-full flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-fc-manage">
      <WxNav
        title="亲属卡"
        onBack={onBack}
        testId="wx-fc-manage-back"
        right={
          <button type="button" aria-label="更多" onClick={() => onToast('更多功能暂未开放')}>
            <MoreDots />
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        {cards.length > 0 && (
          <>
            <p className="mb-2 px-1 text-[14px] text-black/45 dark:text-white/45">我赠送的亲属卡</p>
            <div className="space-y-3">
              {cards.map((c) => (
                <div key={c.id} data-testid="wx-fc-card" className="rounded-[12px] bg-white px-4 py-4 dark:bg-[#1A1A1A]">
                  <button type="button" onClick={() => setUnbind(c)} className="flex w-full items-center gap-3 text-left active:opacity-70">
                    <MiniAvatar src={c.friendAvatar} alt={c.friendName} size={38} />
                    <span className="min-w-0 flex-1 truncate text-[17px]">
                      {c.friendName}（{c.relation}）
                    </span>
                    <span className={`shrink-0 text-[15px] ${c.status === 'pending' ? 'text-[#FA9D3B]' : 'text-[#07C160]'}`}>
                      {c.status === 'pending' ? '待对方领取' : '使用中'}
                    </span>
                  </button>
                  <div className="mt-4 flex items-stretch">
                    <div className="flex-1 text-center">
                      <p className="text-[13px] text-black/45 dark:text-white/45">月额度</p>
                      <p className="mt-1 text-[20px] font-semibold">¥ {fmtMoney(c.monthlyLimit)}</p>
                    </div>
                    <div className="w-px bg-black/[0.07] dark:bg-white/[0.1]" aria-hidden="true" />
                    <div className="flex-1 text-center">
                      <p className="text-[13px] text-black/45 dark:text-white/45">已用额度</p>
                      <p className="mt-1 text-[20px] font-semibold">{c.used > 0 ? `¥ ${fmtMoney(c.used)}` : '—'}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {received.length > 0 && (
          <>
            <p className="mb-2 mt-6 px-1 text-[14px] text-black/45 dark:text-white/45">我收到的亲属卡</p>
            <div className="space-y-3">
              {received.map((c) => (
                <div key={c.id} data-testid="wx-fc-in-card" className="rounded-[12px] bg-white px-4 py-4 dark:bg-[#1A1A1A]">
                  <div className="flex items-center gap-3">
                    <MiniAvatar src={c.fromAvatar} alt={c.fromName} size={38} />
                    <span className="min-w-0 flex-1 truncate text-[17px]">
                      {c.fromName}（{c.relation}）
                    </span>
                    <span className="shrink-0 text-[15px] text-[#07C160]">使用中</span>
                  </div>
                  <div className="mt-4 flex items-stretch">
                    <div className="flex-1 text-center">
                      <p className="text-[13px] text-black/45 dark:text-white/45">月额度</p>
                      <p className="mt-1 text-[20px] font-semibold">¥ {fmtMoney(c.monthlyLimit)}</p>
                    </div>
                    <div className="w-px bg-black/[0.07] dark:bg-white/[0.1]" aria-hidden="true" />
                    <div className="flex-1 text-center">
                      <p className="text-[13px] text-black/45 dark:text-white/45">本月剩余</p>
                      <p className="mt-1 text-[20px] font-semibold">¥ {fmtMoney(Math.max(0, c.monthlyLimit - c.used))}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {received.length === 0 && (
          <button
            type="button"
            data-testid="wx-fc-sim-receive"
            onClick={onSimulateReceive}
            className="mt-4 w-full rounded-[12px] border border-dashed border-black/20 px-4 py-3 text-[14px] text-black/45 active:bg-black/[0.03] dark:border-white/20 dark:text-white/45 dark:active:bg-white/[0.06]"
          >
            让好友在聊天中发我一张亲属卡（点卡片领取）
          </button>
        )}
        <button
          type="button"
          data-testid="wx-fc-add-row"
          onClick={onAdd}
          className="mt-3 flex w-full items-center rounded-[12px] bg-white px-4 py-4 text-left text-[17px] active:bg-black/[0.03] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
        >
          <span className="flex-1">赠送亲属卡</span>
          <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
        </button>
        <div className="mt-10 text-center">
          <button type="button" onClick={() => onToast('客服中心暂未开放')} className="text-[14px] text-[#576B95] active:opacity-60">
            客服中心
          </button>
        </div>
      </div>
      {unbind && (
        <ActionSheet
          actions={[
            {
              label: `解除 ${unbind.friendName}（${unbind.relation}）的亲属卡`,
              danger: true,
              onClick: () => {
                onUnbind(unbind.id);
                setUnbind(null);
                onToast('已解除亲属卡');
              },
            },
          ]}
          onClose={() => setUnbind(null)}
        />
      )}
    </div>
  );
}

// ---------------- 页面栈 ----------------

type View = 'home' | 'wallet' | 'change' | 'changeDetail' | 'lcq' | 'cards' | 'cardDetail' | 'fcIntro' | 'fcPick' | 'fcSetup' | 'fcManage' | 'paySettings';

export function WxServices({ friends, myRealName, onExit }: { friends: ContactRecord[]; myRealName: string; onExit: () => void }) {
  const [view, setView] = useState<View>('home');
  const [wallet, setWallet] = useState(() => loadWallet());
  const [cards, setCards] = useState(() => loadCards());
  const [bills, setBills] = useState(() => loadBills());
  const [familyCards, setFamilyCards] = useState(() => loadFamilyCards());
  /** 我收到的亲属卡（可用于发红包/转账支付） */
  const [familyIn, setFamilyIn] = useState(() => loadFamilyCardsIn());
  // 零钱通：挂载时惰性结算每日收益（同日幂等）
  const [lcq, setLcq] = useState(() => {
    const settled = settleLcq(loadLcq(), earliestBuyDay(loadBills()));
    saveJSON(LS_LCQ, settled);
    return settled;
  });
  /** 零钱明细返回目标（从零钱 / 零钱通都可进入） */
  const [detailFrom, setDetailFrom] = useState<View>('change');
  /** 充值 / 提现 / 转入 / 转出弹层 */
  const [moneySheet, setMoneySheet] = useState<'recharge' | 'withdraw' | 'lcqIn' | 'lcqOut' | null>(null);
  /** 充值 / 提现选中的银行卡 */
  const [payCardId, setPayCardId] = useState<string | null>(null);
  const [cardPickOpen, setCardPickOpen] = useState(false);
  /** 亲属卡赠送流程 */
  const [fcFriend, setFcFriend] = useState<ContactRecord | null>(null);
  const [fcRelation, setFcRelation] = useState('');
  /** 银行卡详情页当前卡 */
  const [detailCardId, setDetailCardId] = useState<string | null>(null);

  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1600);
  };

  const commitWallet = (next: { balance: number }) => {
    setWallet(next);
    saveJSON(LS_WALLET, next);
  };
  const commitCards = (next: WxCard[]) => {
    setCards(next);
    saveJSON(LS_CARDS, next);
  };
  const commitBills = (next: WxBill[]) => {
    setBills(next);
    saveJSON(LS_BILLS, next.slice(0, 100));
  };
  const commitLcq = (next: WxLcq) => {
    setLcq(next);
    saveJSON(LS_LCQ, next);
  };
  const commitFamily = (next: WxFamilyCard[]) => {
    setFamilyCards(next);
    saveJSON(LS_FC, next);
  };
  const pushBill = (kind: WxBill['kind'], amount: number) => {
    commitBills([{ id: uid(), kind, amount, time: Date.now() }, ...bills]);
  };

  const payCard = cards.find((c) => c.id === (payCardId ?? cards[0]?.id)) ?? null;
  /** 银行卡详情页当前卡（解绑/返回后 detailCardId 置空避免悬挂） */
  const detailCard = view === 'cardDetail' ? cards.find((c) => c.id === detailCardId) ?? null : null;

  const openMoneySheet = (s: 'recharge' | 'withdraw' | 'lcqIn' | 'lcqOut') => {
    if ((s === 'recharge' || s === 'withdraw') && cards.length === 0) {
      showToast('请先添加银行卡');
      setView('cards');
      return;
    }
    if (s === 'lcqOut' && lcq.balance <= 0) {
      showToast('零钱通余额不足');
      return;
    }
    if (s === 'withdraw' && wallet.balance <= 0) {
      showToast('零钱余额不足');
      return;
    }
    if (s === 'lcqIn' && wallet.balance <= 0) {
      showToast('零钱余额不足，请先充值');
      return;
    }
    setPayCardId(cards[0]?.id ?? null);
    setMoneySheet(s);
  };

  const doRecharge = (amount: number) => {
    if (!payCard) return;
    if (payCard.balance < amount) {
      showToast('银行卡余额不足');
      return;
    }
    commitCards(cards.map((c) => (c.id === payCard.id ? { ...c, balance: Math.round((c.balance - amount) * 100) / 100 } : c)));
    commitWallet({ balance: Math.round((wallet.balance + amount) * 100) / 100 });
    pushBill('充值', amount);
    setMoneySheet(null);
    showToast('充值成功');
  };

  const doWithdraw = (amount: number) => {
    if (!payCard) return;
    if (wallet.balance < amount) {
      showToast('零钱余额不足');
      return;
    }
    commitCards(cards.map((c) => (c.id === payCard.id ? { ...c, balance: Math.round((c.balance + amount) * 100) / 100 } : c)));
    commitWallet({ balance: Math.round((wallet.balance - amount) * 100) / 100 });
    pushBill('提现', -amount);
    setMoneySheet(null);
    showToast('提现成功，已到账银行卡');
  };

  const doLcqIn = (amount: number) => {
    if (wallet.balance < amount) {
      showToast('零钱余额不足');
      return;
    }
    commitLcq({ ...lcq, balance: Math.round((lcq.balance + amount) * 100) / 100 });
    commitWallet({ balance: Math.round((wallet.balance - amount) * 100) / 100 });
    pushBill('转入零钱通', -amount);
    setMoneySheet(null);
    showToast('已转入零钱通');
  };

  const doLcqOut = (amount: number) => {
    if (lcq.balance < amount) {
      showToast('零钱通余额不足');
      return;
    }
    commitLcq({ ...lcq, balance: Math.round((lcq.balance - amount) * 100) / 100 });
    commitWallet({ balance: Math.round((wallet.balance + amount) * 100) / 100 });
    pushBill('零钱通转出', amount);
    setMoneySheet(null);
    showToast('已转出到零钱');
  };

  /** 付款方式行（充值 / 提现弹层用） */
  const payRow = payCard && (
    <button
      type="button"
      data-testid="wx-pay-card-row"
      onClick={() => setCardPickOpen(true)}
      className="mt-3 flex w-full items-center gap-2.5 rounded-[8px] bg-black/[0.03] px-3 py-2.5 text-left active:bg-black/[0.06] dark:bg-white/[0.06] dark:active:bg-white/[0.1]"
    >
      <BankDot bank={payCard.bank} size={26} />
      <span className="flex-1 text-[14px] text-black dark:text-white">
        {payCard.bank}（尾号{payCard.tail}）
      </span>
      <span className="text-[12px] text-black/40 dark:text-white/40">可用 {fmtMoney(payCard.balance)}</span>
      <ChevronRight className="h-4 w-4 text-black/30 dark:text-white/30" strokeWidth={2} />
    </button>
  );

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#EDEDED] dark:bg-[#111111]">
      {view === 'home' && (
        <ServicesHome
          balance={wallet.balance}
          onExit={onExit}
          onOpen={(v) => setView(v)}
          onToast={showToast}
        />
      )}
      {view === 'wallet' && (
        <WalletPage
          balance={wallet.balance}
          cards={cards}
          familyCards={familyCards}
          onBack={() => setView('home')}
          onOpen={(v) => setView(v)}
          onToast={showToast}
        />
      )}
      {view === 'change' && (
        <ChangePage
          balance={wallet.balance}
          onBack={() => setView('wallet')}
          onOpenDetail={() => {
            setDetailFrom('change');
            setView('changeDetail');
          }}
          onRecharge={() => openMoneySheet('recharge')}
          onWithdraw={() => openMoneySheet('withdraw')}
          onToast={showToast}
        />
      )}
      {view === 'changeDetail' && <ChangeDetailPage bills={bills} onBack={() => setView(detailFrom)} />}
      {view === 'lcq' && (
        <ChangePlusPage
          lcq={lcq}
          onBack={() => setView('home')}
          onOpenDetail={() => {
            setDetailFrom('lcq');
            setView('changeDetail');
          }}
          onTransferIn={() => openMoneySheet('lcqIn')}
          onTransferOut={() => openMoneySheet('lcqOut')}
          onToast={showToast}
        />
      )}
      {view === 'cards' && (
        <BankCardsPage
          cards={cards}
          myRealName={myRealName}
          onBack={() => setView('wallet')}
          onAdd={(c) => {
            commitCards([...cards, { id: uid(), bank: c.bank, no: c.no, tail: c.tail, holder: c.holder, balance: c.balance, createdAt: Date.now() }]);
          }}
          onOpenCard={(c) => {
            setDetailCardId(c.id);
            setView('cardDetail');
          }}
          onToast={showToast}
        />
      )}
      {view === 'cardDetail' && detailCard && (
        <WxCardDetailPage
          card={detailCard}
          onBack={() => setView('cards')}
          onUnbind={() => {
            commitCards(cards.filter((c) => c.id !== detailCard.id));
            showToast('已解除绑定');
            setView('cards');
          }}
          onToast={showToast}
        />
      )}
      {view === 'fcIntro' && (
        <FamilyIntroPage
          onBack={() => setView('wallet')}
          onGo={() => {
            if (friends.length === 0) {
              showToast('还没有好友可以赠送');
              return;
            }
            setView('fcPick');
          }}
          onToast={showToast}
        />
      )}
      {view === 'fcPick' && (
        <FamilyPickPage
          friends={friends}
          onBack={() => setView('fcIntro')}
          onPicked={(f, r) => {
            setFcFriend(f);
            setFcRelation(r);
            setView('fcSetup');
          }}
        />
      )}
      {view === 'fcSetup' && fcFriend && (
        <FamilySetupPage
          friend={fcFriend}
          relation={fcRelation}
          onBack={() => setView('fcPick')}
          onGift={(amount, message) => {
            const card: WxFamilyCard = {
              id: uid(),
              friendId: fcFriend.id,
              friendName: fcFriend.name,
              friendAvatar: fcFriend.avatar,
              relation: fcRelation,
              monthlyLimit: amount,
              used: 0,
              status: 'pending',
              message,
              createdAt: Date.now(),
            };
            commitFamily([card, ...familyCards]);
            // 同步向与该好友的微信聊天发送一张亲属卡卡片消息（待对方领取）
            appendWxChatMsg(fcFriend.id, {
              id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
              role: 'me',
              content: '',
              time: Date.now(),
              kind: 'family',
              fam: { monthlyLimit: amount, relation: fcRelation, message, claimed: false, used: 0, method: '零钱' },
            });
            showToast('亲属卡已发送到聊天，等待对方领取');
            setView('fcManage');
          }}
          onToast={showToast}
        />
      )}
      {view === 'fcManage' && (
        <FamilyManagePage
          cards={familyCards}
          received={familyIn}
          onBack={() => setView('wallet')}
          onUnbind={(id) => commitFamily(familyCards.filter((c) => c.id !== id))}
          onSimulateReceive={() => {
            const from = friends.find((f) => f.kind === 'char') ?? friends[0];
            if (!from) {
              showToast('还没有好友可以赠送亲属卡');
              return;
            }
            // 改为聊天链路：好友在聊天中发来一张待领取的亲属卡卡片，点卡片领取后进入「我收到的亲属卡」
            appendWxChatMsg(from.id, {
              id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
              role: 'peer',
              content: '',
              time: Date.now(),
              kind: 'family',
              fam: { monthlyLimit: 3000, relation: '女朋友', message: '我为你准备了亲属卡，你消费我买单', claimed: false, used: 0, method: '零钱' },
            });
            showToast(`${from.name}给你发来一张亲属卡，去聊天中领取`);
          }}
          onAdd={() => {
            if (friends.length === 0) {
              showToast('还没有好友可以赠送');
              return;
            }
            setView('fcPick');
          }}
          onToast={showToast}
        />
      )}

      {view === 'paySettings' && <WxPaySettingsPage onBack={() => setView('wallet')} onToast={showToast} />}

      {/* 金额弹层（充值 / 提现 / 转入 / 转出） */}
      {moneySheet === 'recharge' && (
        <AmountPadSheet title="充值" note="从银行卡转入零钱" submitLabel="充值" submitTestId="wx-recharge-confirm" onSubmit={doRecharge} onClose={() => setMoneySheet(null)}>
          {payRow}
        </AmountPadSheet>
      )}
      {moneySheet === 'withdraw' && (
        <AmountPadSheet title="提现" note="到账银行卡" submitLabel="提现" submitTestId="wx-withdraw-confirm" onSubmit={doWithdraw} onClose={() => setMoneySheet(null)}>
          {payRow}
        </AmountPadSheet>
      )}
      {moneySheet === 'lcqIn' && (
        <AmountPadSheet title="转入" note="从零钱转入零钱通" submitLabel="转入" submitTestId="wx-lcqin-confirm" onSubmit={doLcqIn} onClose={() => setMoneySheet(null)} />
      )}
      {moneySheet === 'lcqOut' && (
        <AmountPadSheet title="转出" note="转出到零钱，秒到账" submitLabel="转出" submitTestId="wx-lcqout-confirm" onSubmit={doLcqOut} onClose={() => setMoneySheet(null)} />
      )}

      {/* 银行卡选择浮层（充值 / 提现） */}
      {cardPickOpen && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end" data-testid="wx-card-pick">
          <button type="button" aria-label="取消" onClick={() => setCardPickOpen(false)} className="absolute inset-0 bg-black/40" />
          <div className="relative mx-3 mb-6 rounded-[12px] bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))] dark:bg-[#242424]">
            <p className="mb-3 text-center text-[15px] font-medium text-black dark:text-white">选择银行卡</p>
            <div className="space-y-1">
              {cards.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setPayCardId(c.id);
                    setCardPickOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-[8px] px-2 py-2.5 text-left active:bg-black/[0.05] dark:active:bg-white/[0.08]"
                >
                  <BankDot bank={c.bank} size={30} />
                  <span className="flex-1 text-[15px] text-black dark:text-white">
                    {c.bank}（尾号{c.tail}）
                  </span>
                  {payCard?.id === c.id && <Check className="h-5 w-5 text-[#07C160]" strokeWidth={2.4} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[60] -translate-x-1/2 -translate-y-1/2 rounded-[8px] bg-black/75 px-4 py-2.5 text-[14px] text-white">
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------- 支付设置 / 支付密码（发红包/转账支付验证；微信风格 6 位自绘键盘） ----------------

interface WxPayPwdData {
  enabled: boolean;
  /** 6 位数字密码（仅本机 localStorage 保存） */
  pwd: string | null;
}

export const WX_LS_PAY_PWD = 'wx-pay-pwd';

export function wxLoadPayPwd(): WxPayPwdData {
  try {
    const raw = window.localStorage.getItem(WX_LS_PAY_PWD);
    const p: unknown = raw ? JSON.parse(raw) : null;
    if (p && typeof p === 'object') {
      const d = p as Partial<WxPayPwdData>;
      const pwd = typeof d.pwd === 'string' && /^\d{6}$/.test(d.pwd) ? d.pwd : null;
      return { enabled: d.enabled === true && pwd !== null, pwd };
    }
  } catch {
    // 忽略
  }
  return { enabled: false, pwd: null };
}

export function wxSavePayPwd(d: WxPayPwdData): void {
  saveJSON(WX_LS_PAY_PWD, d);
}

/** 微信风格 6 位支付密码自绘数字键盘（不唤起系统键盘；校验由父级完成，errorKey 变化时父级重挂载 → 清空并抖动） */
export function WxPwdSheet({
  title,
  sub,
  hint,
  errorKey,
  onComplete,
  onClose,
}: {
  title: string;
  sub?: string;
  hint?: string;
  errorKey: number;
  onComplete: (pwd: string) => void;
  onClose: () => void;
}) {
  const [digits, setDigits] = useState('');
  // 用 ref 累加避免同一 tick 内连点被 React 批处理吞掉（每次 push 都基于最新串）
  const acc = useRef('');
  const push = (d: string) => {
    const next = (acc.current + d).slice(0, 6);
    acc.current = next;
    setDigits(next);
    if (next.length === 6) {
      const done = next;
      acc.current = '';
      window.setTimeout(() => onComplete(done), 150);
    }
  };
  const keyBtn =
    'flex h-[52px] items-center justify-center bg-white text-[22px] font-medium text-black active:bg-black/[0.07] dark:bg-[#1E1E1E] dark:text-white dark:active:bg-white/10';
  return (
    <div className="rounded-t-[18px] bg-[#F7F7F7] pb-7 dark:bg-[#1B1B1B]" onClick={(e) => e.stopPropagation()} data-testid="wx-keypad">
      <style>{'@keyframes wxShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(4px)}}'}</style>
      <div className="relative flex h-12 items-center justify-center border-b border-black/[0.06] dark:border-white/[0.08]">
        <button
          type="button"
          aria-label="关闭"
          data-testid="wx-keypad-close"
          onClick={onClose}
          className="absolute left-3 grid h-8 w-8 place-items-center rounded-full text-black/45 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10"
        >
          <X className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <p className="text-[16px] font-medium text-black dark:text-white">{title}</p>
      </div>
      {sub ? <p className="pb-1 pt-2 text-center text-[13px] text-black/45 dark:text-white/45">{sub}</p> : null}
      <div className="mx-auto mt-2 flex w-fit gap-2.5" style={errorKey > 0 ? { animation: 'wxShake 0.46s' } : undefined}>
        {Array.from({ length: 6 }).map((_, i) => (
          <span
            key={i}
            className="grid h-11 w-10 place-items-center rounded-[6px] border border-black/15 bg-white dark:border-white/20 dark:bg-white/[0.06]"
            aria-hidden="true"
          >
            {i < digits.length ? <span className="h-2.5 w-2.5 rounded-full bg-black dark:bg-white" /> : null}
          </span>
        ))}
      </div>
      <p className="mt-2 h-5 text-center text-[13px] text-[#FA5151]" aria-live="polite">
        {hint ?? ''}
      </p>
      <div className="grid grid-cols-3 gap-[1px] border-t border-black/10 bg-black/10 dark:border-white/10 dark:bg-white/10">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button key={k} type="button" data-testid={`wx-keypad-${k}`} onClick={() => push(k)} className={keyBtn}>
            {k}
          </button>
        ))}
        <span className="bg-white dark:bg-[#1E1E1E]" aria-hidden="true" />
        <button type="button" data-testid="wx-keypad-0" onClick={() => push('0')} className={keyBtn}>
          0
        </button>
        <button type="button" aria-label="删除" data-testid="wx-keypad-del" onClick={() => { acc.current = acc.current.slice(0, -1); setDigits(acc.current); }} className={keyBtn}>
          <Delete className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** 支付密码验证浮层（发红包/转账支付前调用；正确回调 onOk，错误清空重输） */
export function WxPayPwdGate({ label, onOk, onClose }: { label: string; onOk: () => void; onClose: () => void }) {
  const [errKey, setErrKey] = useState(0);
  return (
    <div className="absolute inset-0 z-[60] flex flex-col justify-end bg-black/60" role="dialog" aria-label="验证支付密码" onClick={onClose}>
      <WxPwdSheet
        key={errKey}
        title="请输入支付密码"
        sub={label}
        hint={errKey > 0 ? '密码错误，请重新输入' : undefined}
        errorKey={errKey}
        onClose={onClose}
        onComplete={(pwd) => {
          const d = wxLoadPayPwd();
          if (d.pwd && pwd === d.pwd) onOk();
          else setErrKey((k) => k + 1);
        }}
      />
    </div>
  );
}

/** 支付设置页（支付密码开启/关闭/修改；微信风格自绘 6 位数字键盘） */
function WxPaySettingsPage({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  const [data, setData] = useState(() => wxLoadPayPwd());
  const [flow, setFlow] = useState<null | { mode: 'set' | 'confirm' | 'verify-off' | 'verify-change'; first?: string }>(null);
  const [errKey, setErrKey] = useState(0);
  const enabled = data.enabled && !!data.pwd;
  const meta = flow
    ? flow.mode === 'set'
      ? { title: '设置支付密码', sub: '请输入 6 位数字' }
      : flow.mode === 'confirm'
        ? { title: '确认支付密码', sub: '请再次输入' }
        : flow.mode === 'verify-off'
          ? { title: '关闭支付密码', sub: '验证后即可关闭' }
          : { title: '修改支付密码', sub: '请输入原支付密码' }
    : null;
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-pay-settings">
      <WxNav title="支付设置" onBack={onBack} testId="wx-pay-settings-back" />
      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        <div className="flex items-start gap-3 rounded-[10px] bg-[#FFF7E8] px-4 py-3.5 text-[13px] leading-relaxed text-[#8A6A3F] dark:bg-[#3A3222]/60 dark:text-[#E3C893]">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0" strokeWidth={1.7} aria-hidden="true" />
          开启后，发红包、转账都需要先验证支付密码
        </div>
        <div className="mt-4 overflow-hidden rounded-[10px] bg-white dark:bg-[#1A1A1A]">
          <div className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[16px]">支付密码</span>
              <span className="mt-0.5 block text-[12px] text-black/40 dark:text-white/40">{enabled ? '已开启 · 支付时需验证' : '未开启'}</span>
            </span>
            <button
              type="button"
              data-testid="wx-pay-toggle"
              aria-label={enabled ? '关闭支付密码' : '开启支付密码'}
              aria-pressed={enabled}
              onClick={() => {
                setErrKey(0);
                setFlow(enabled ? { mode: 'verify-off' } : { mode: 'set' });
              }}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${enabled ? 'bg-[#07C160]' : 'bg-black/20 dark:bg-white/25'}`}
            >
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} aria-hidden="true" />
            </button>
          </div>
          {enabled && (
            <button
              type="button"
              data-testid="wx-pay-change"
              onClick={() => {
                setErrKey(0);
                setFlow({ mode: 'verify-change' });
              }}
              className="relative flex min-h-[52px] w-full items-center px-4 py-2.5 text-left active:bg-black/[0.03] dark:active:bg-white/[0.06]"
            >
              <span className="absolute left-4 right-0 top-0 h-px bg-black/[0.05] dark:bg-white/[0.08]" aria-hidden="true" />
              <span className="flex-1 text-[16px]">修改支付密码</span>
              <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
            </button>
          )}
        </div>
        <p className="px-1 pt-4 text-[12px] leading-relaxed text-black/35 dark:text-white/35">支付密码为 6 位数字，仅保存在本机浏览器，用于本机演示支付验证。</p>
      </div>
      {flow && meta ? (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/55" role="dialog" aria-label={meta.title} onClick={() => setFlow(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <WxPwdSheet
              key={`${flow.mode}-${errKey}`}
              title={meta.title}
              sub={meta.sub}
              hint={errKey > 0 ? '密码错误，请重新输入' : undefined}
              errorKey={errKey}
              onClose={() => setFlow(null)}
              onComplete={(pwd) => {
                if (flow.mode === 'set') {
                  setErrKey(0);
                  setFlow({ mode: 'confirm', first: pwd });
                } else if (flow.mode === 'confirm') {
                  if (pwd === flow.first) {
                    wxSavePayPwd({ enabled: true, pwd });
                    setData(wxLoadPayPwd());
                    setFlow(null);
                    onToast('支付密码已开启');
                  } else {
                    onToast('两次输入不一致，请重新设置');
                    setErrKey((k) => k + 1);
                    setFlow({ mode: 'set' });
                  }
                } else if (flow.mode === 'verify-off') {
                  if (pwd === data.pwd) {
                    wxSavePayPwd({ enabled: false, pwd: null });
                    setData(wxLoadPayPwd());
                    setFlow(null);
                    onToast('支付密码已关闭');
                  } else setErrKey((k) => k + 1);
                } else if (pwd === data.pwd) {
                  setErrKey(0);
                  setFlow({ mode: 'set' });
                } else setErrKey((k) => k + 1);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
