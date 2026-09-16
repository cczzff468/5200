'use client';

/**
 * 记忆库 App（跨应用记忆互通管理）——「简约水墨 · 档案卡」视觉主题：
 * 全灰白单色（无任何彩色/渐变）+ hairline 与虚线档案分隔 + 克制毛玻璃（顶栏 / 底部悬浮胶囊 Dock）。
 * 记忆卡：头部时钟时间（碎片）/ 纯黑徽章（核心）+ 右上角常驻编辑/删除图标 + 虚线分隔 + 底部来源徽章；
 * 列表页：圆角搜索条 + 统计总览 + 联系人档案卡。
 *
 * 功能结构（逻辑与 src/lib/memory.ts 保持一致，本文件只负责呈现）：
 * - 联系人列表（统计总览条 + 每联系人一张档案卡）→ 记忆详情页（三个 Tab）
 * - Tab1 记忆碎片：每 N 轮对话自动提取（内容/来源时间/所属会话），支持查看/编辑/删除
 * - Tab2 长期记忆（核心记忆）：M 条碎片自动总结（内容/来源碎片数量/生成时间），支持查看/编辑/删除
 * - Tab3 设置：提取频率（10/20/30/40/50 轮）、总结阈值（3/5/7/10 条）、跨 App 互通开关（默认开）、
 *   「立即总结」手动触发（不等 N 轮立刻整理当前对话，区分碎片与长期记忆并提示）
 * - 数据按联系人 ID 隔离（localStorage 持久化，重启保留）；
 *   互通开 = QQ/微信/信息/电话四端共享该联系人记忆；关 = 各端只用自己来源的记忆
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BrainCircuit,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Gem,
  Info,
  Layers,
  Loader2,
  Pencil,
  Search,
  Settings2,
  Share2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { IOSScreen } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';
import { DefaultAvatar } from './default-avatar';
import { LocalToast, useLocalToast } from './page-toast';
import { listContacts } from '@/lib/ios/contacts-store';
import { displayNameOf, type ContactRecord } from '@/lib/contacts';
import { useSettings } from '@/lib/ios/store';
import {
  DEFAULT_MEM_SETTINGS,
  MEM_APP_LABEL,
  MEM_INTERVAL_OPTIONS,
  MEM_THRESHOLD_OPTIONS,
  deleteFragment,
  deleteLongTerm,
  getMemSettings,
  listFragments,
  listLongTerm,
  memMostRecentApp,
  memSummarizeNow,
  pendingFragmentCount,
  saveMemSettings,
  updateFragment,
  updateLongTerm,
  type MemApp,
  type MemFragment,
  type MemLongTerm,
  type MemSettings,
} from '@/lib/memory';

/** 时间戳 → 「9月16日 14:30」 */
function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------------- 主题常量（简约水墨：黑白灰 + hairline） ----------------

/** 页面底色（微暖中性灰，非冷 iOS 灰） */
const PAGE_BG = 'bg-[#f4f3f1] dark:bg-[#141312]';
/** 毛玻璃顶/底栏（与页面底色同源的半透明） */
const TOPBAR_GLASS = 'bg-[#f4f3f1]/80 backdrop-blur-xl dark:bg-[#141312]/75';

/** 白卡片：极淡阴影，浮起但不抢眼 */
const CARD_CLS =
  'bg-white shadow-[0_1px_4px_rgba(20,18,14,0.05)] dark:bg-[#201f1d] dark:shadow-none dark:ring-1 dark:ring-white/[0.06]';

/** 选中/强调态：纯黑（暗色反转纯白） */
const INK = 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900';

/** 每联系人记忆详情（三 Tab） */
type MemTab = 'frag' | 'ltm' | 'set';

export default function MemoryBankApp() {
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [toast, showToast] = useLocalToast();

  // 首次加载联系人
  useEffect(() => {
    void listContacts()
      .then((list) => {
        setContacts(list);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const active = useMemo(() => contacts.find((c) => c.id === activeId) ?? null, [contacts, activeId]);

  // 搜索过滤（按显示名，前端即时过滤，不改数据层）
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => (displayNameOf(c) || c.name).toLowerCase().includes(q));
  }, [contacts, query]);

  const handleDeleteContactGone = useCallback(() => {
    // 联系人被删（其它端删除联系人会级联清记忆）：详情页自动退回列表
    setActiveId(null);
    void listContacts().then(setContacts).catch(() => undefined);
  }, []);

  return (
    <IOSScreen className={`${PAGE_BG}! text-neutral-900 dark:text-neutral-100`}>
      {active ? (
        <MemoryDetail
          contact={active}
          onBack={() => {
            setActiveId(null);
            void listContacts().then(setContacts).catch(() => undefined);
          }}
          onContactGone={handleDeleteContactGone}
          showToast={showToast}
        />
      ) : (
        <div className="relative flex-1 overflow-hidden">
          {/* 毛玻璃顶栏：内容从其下穿过 */}
          <header className={`absolute inset-x-0 top-0 z-20 pt-[54px] ${TOPBAR_GLASS}`}>
            <div className="flex h-11 items-center justify-between px-4">
              <BackToHome className="static!" />
              <span className="text-[17px] font-semibold leading-none tracking-tight">记忆库</span>
              <span aria-hidden className="w-11 shrink-0" />
            </div>
          </header>
          <div className="h-full overflow-y-auto overscroll-contain px-4 pb-8 pt-[112px]">
            {/* 圆角搜索条 */}
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-black/30 dark:text-white/30"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="mem-search"
                aria-label="搜索联系人"
                placeholder="搜索联系人"
                className="h-10 w-full rounded-full bg-black/[0.045] pl-10 pr-4 text-[15px] outline-none ring-1 ring-transparent transition placeholder:text-black/30 focus:bg-white focus:ring-black/[0.08] dark:bg-white/[0.07] dark:placeholder:text-white/30 dark:focus:bg-white/[0.1] dark:focus:ring-white/[0.14]"
              />
            </div>

            <div className="mt-2.5">
              <HeroCard contacts={contacts} loaded={loaded} />
            </div>
            {!loaded ? (
              <div className="grid place-items-center py-14 text-black/35 dark:text-white/35">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : contacts.length === 0 ? (
              <div className="grid place-items-center gap-3 py-14 text-center text-black/40 dark:text-white/40">
                <span className="grid h-16 w-16 place-items-center rounded-full bg-black/[0.05] dark:bg-white/[0.07]">
                  <BrainCircuit className="h-8 w-8" strokeWidth={1.5} />
                </span>
                <p className="text-[14px]">还没有联系人，先去添加一个吧</p>
              </div>
            ) : shown.length === 0 ? (
              <div className="grid place-items-center gap-3 py-14 text-center text-black/40 dark:text-white/40">
                <Search className="h-7 w-7" strokeWidth={1.5} />
                <p className="text-[14px]">没有找到「{query.trim()}」相关的联系人</p>
              </div>
            ) : (
              <div className="mt-2.5 space-y-2.5" role="list" aria-label="联系人记忆档案">
                {shown.map((c) => (
                  <ContactCard key={c.id} contact={c} onOpen={() => setActiveId(c.id)} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <LocalToast msg={toast} />
    </IOSScreen>
  );
}

// ---------------- 列表页：统计总览条 ----------------

function HeroCard({ contacts, loaded }: { contacts: ContactRecord[]; loaded: boolean }) {
  let fragTotal = 0;
  let ltmTotal = 0;
  if (loaded) {
    for (const c of contacts) {
      fragTotal += listFragments(c.id).length;
      ltmTotal += listLongTerm(c.id).length;
    }
  }
  const stats: [string, number][] = [
    ['联系人', contacts.length],
    ['记忆碎片', fragTotal],
    ['核心记忆', ltmTotal],
  ];
  return (
    <section data-testid="mem-hero" className={`flex items-stretch divide-x divide-black/[0.06] rounded-[18px] p-4 dark:divide-white/[0.08] ${CARD_CLS}`}>
      {stats.map(([label, n]) => (
        <div key={label} className="flex-1 px-1 text-center">
          <p className="text-[22px] font-bold leading-none tracking-tight tabular-nums">{loaded ? n : '–'}</p>
          <p className="mt-1.5 text-[11.5px] text-black/40 dark:text-white/40">{label}</p>
        </div>
      ))}
    </section>
  );
}

// ---------------- 列表页：联系人档案卡 ----------------

/** 头像（细描边，无彩色环） */
function Avatar({ src, name, size }: { src?: string | null; name: string; size: number }) {
  return (
    <span
      className="inline-block shrink-0 overflow-hidden rounded-full ring-1 ring-black/[0.08] dark:ring-white/[0.12]"
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full rounded-full object-cover" />
      ) : (
        <DefaultAvatar size={size} />
      )}
    </span>
  );
}

function ContactCard({ contact, onOpen }: { contact: ContactRecord; onOpen: () => void }) {
  // 读取记忆计数（渲染时同步读 localStorage；数据量小无性能问题）
  const fragCount = listFragments(contact.id).length;
  const ltmCount = listLongTerm(contact.id).length;
  const name = displayNameOf(contact) || contact.name;
  return (
    <button
      type="button"
      role="listitem"
      data-testid={`mem-contact-${contact.id}`}
      onClick={onOpen}
      className={`flex w-full items-center gap-3 rounded-[20px] p-3.5 text-left transition-transform active:scale-[0.985] ${CARD_CLS}`}
    >
      <Avatar src={contact.avatar} name={name} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold leading-snug">{name}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {fragCount > 0 || ltmCount > 0 ? (
            <>
              <span className="rounded-full bg-black/[0.05] px-2 py-[2px] text-[11px] font-medium text-black/50 dark:bg-white/[0.08] dark:text-white/50">
                {fragCount} 碎片
              </span>
              {ltmCount > 0 && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-medium ${INK}`}>
                  <Gem className="h-3 w-3" /> {ltmCount} 核心
                </span>
              )}
            </>
          ) : (
            <span className="rounded-full bg-black/[0.05] px-2 py-[2px] text-[11px] text-black/35 dark:bg-white/[0.08] dark:text-white/35">
              暂无记忆
            </span>
          )}
        </span>
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/20 dark:text-white/25" />
    </button>
  );
}

// ---------------- 记忆详情页（毛玻璃顶栏 + 底部悬浮胶囊 Dock） ----------------

function MemoryDetail({
  contact,
  onBack,
  onContactGone,
  showToast,
}: {
  contact: ContactRecord;
  onBack: () => void;
  onContactGone: () => void;
  showToast: (m: string) => void;
}) {
  const [tab, setTab] = useState<MemTab>('frag');
  // 快照号：每次读 localStorage 前自增，保证操作后重读；详情页打开期间定时轻刷（后台自动提取落库后列表自己更新）
  const [rev, setRev] = useState(0);
  const refresh = useCallback(() => setRev((x) => x + 1), []);
  useEffect(() => {
    const t = window.setInterval(() => setRev((x) => x + 1), 5000);
    return () => window.clearInterval(t);
  }, []);

  // 联系人被删除（记忆级联清理）→ 退回列表
  useEffect(() => {
    void listContacts().then((list) => {
      if (!list.some((c) => c.id === contact.id)) onContactGone();
    });
  }, [contact.id, onContactGone]);

  const frags = useMemo(() => (rev >= 0 ? listFragments(contact.id) : []), [contact.id, rev]);
  const ltms = useMemo(() => (rev >= 0 ? listLongTerm(contact.id) : []), [contact.id, rev]);
  const settings = useMemo(
    () => (rev >= 0 ? getMemSettings(contact.id) : DEFAULT_MEM_SETTINGS),
    [contact.id, rev]
  );
  const name = displayNameOf(contact) || contact.name;

  const tabs: [MemTab, typeof Layers, string][] = [
    ['frag', Layers, '记忆碎片'],
    ['ltm', Gem, '核心记忆'],
    ['set', Settings2, '设置'],
  ];

  return (
    <div className="relative flex-1 overflow-hidden">
      {/* 毛玻璃顶栏：返回 + 联系人名 */}
      <header className={`absolute inset-x-0 top-0 z-20 pt-[54px] ${TOPBAR_GLASS}`}>
        <div className="relative flex h-11 items-center px-4">
          <button
            type="button"
            onClick={onBack}
            aria-label="返回记忆库"
            className="-ml-1 flex items-center text-[16px] font-medium active:opacity-50"
          >
            <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.2} />
            记忆库
          </button>
          <span className="pointer-events-none absolute left-1/2 top-1/2 max-w-[45%] -translate-x-1/2 -translate-y-1/2 truncate text-[17px] font-semibold tracking-tight">
            {name}
          </span>
        </div>
      </header>

      <div className="h-full overflow-y-auto overscroll-contain px-4 pb-[108px] pt-[108px]">
        {/* 档案头部：头像 + 统计胶囊 */}
        <div className="flex items-center gap-3">
          <Avatar src={contact.avatar} name={name} size={54} />
          <div className="min-w-0">
            <p className="truncate text-[20px] font-bold leading-tight tracking-tight">{name}</p>
            <p className="mt-0.5 text-[12px] text-black/40 dark:text-white/40">记忆档案 · 按联系人独立保存</p>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5" aria-label="记忆统计">
          <span className="rounded-full bg-white px-2.5 py-[3px] text-[12px] font-medium text-black/55 ring-1 ring-black/[0.07] dark:bg-white/[0.07] dark:text-white/55 dark:ring-white/[0.1]">
            {frags.length} 条碎片
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-[3px] text-[12px] font-medium text-black/55 ring-1 ring-black/[0.07] dark:bg-white/[0.07] dark:text-white/55 dark:ring-white/[0.1]">
            <Gem className="h-3 w-3" /> {ltms.length} 条核心
          </span>
          <span
            data-testid="mem-share-state"
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[12px] font-medium ${
              settings.share
                ? INK
                : 'bg-black/[0.05] text-black/40 dark:bg-white/[0.08] dark:text-white/40'
            }`}
          >
            <Share2 className="h-3 w-3" /> 互通 · {settings.share ? '开' : '关'}
          </span>
        </div>

        <div className="pt-4">
          {tab === 'frag' && <FragTab contactId={contact.id} frags={frags} refresh={refresh} showToast={showToast} />}
          {tab === 'ltm' && <LtmTab contactId={contact.id} ltms={ltms} refresh={refresh} showToast={showToast} />}
          {tab === 'set' && (
            <SetTab
              contactId={contact.id}
              contactName={name}
              refresh={refresh}
              showToast={showToast}
            />
          )}
        </div>
      </div>

      {/* 底部悬浮胶囊 Dock：毛玻璃 + 选中白底浮起；仅图标 + 文字，无数字 */}
      <nav
        className={`absolute inset-x-5 bottom-[calc(12px+env(safe-area-inset-bottom))] z-20 grid grid-cols-3 gap-1 rounded-[26px] p-1.5 shadow-[0_10px_30px_-10px_rgba(20,18,14,0.3)] ring-1 ring-black/[0.05] ${TOPBAR_GLASS} dark:ring-white/[0.08]`}
        role="tablist"
        aria-label="记忆分类"
      >
        {tabs.map(([id, Icon, label]) => {
          const sel = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={sel}
              data-testid={`mem-tab-${id}`}
              onClick={() => setTab(id)}
              className={`flex flex-col items-center gap-[3px] rounded-[20px] py-1.5 transition-colors ${
                sel
                  ? 'bg-white text-neutral-900 shadow-[0_1px_5px_rgba(20,18,14,0.1)] dark:bg-white/[0.14] dark:text-white'
                  : 'text-black/35 active:text-black/60 dark:text-white/35 dark:active:text-white/60'
              }`}
            >
              <Icon className="h-[20px] w-[20px]" strokeWidth={sel ? 2.1 : 1.8} />
              <span className="text-[10px] font-medium leading-none">{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ---------------- Tab 1：记忆碎片 ----------------

/** 来源 App 徽标：小圆点 + 名称 */
function AppBadge({ app }: { app: MemApp }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.045] px-1.5 py-[1px] text-[10.5px] font-medium text-black/50 dark:bg-white/[0.07] dark:text-white/50">
      <i aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-neutral-400 dark:bg-neutral-500" />
      {MEM_APP_LABEL[app]}
    </span>
  );
}

/** 「已入核心」徽标：该碎片已被长期记忆总结消费 */
function ConsumedBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-black/[0.05] px-1.5 py-[1px] text-[10.5px] font-medium text-black/45 dark:bg-white/[0.08] dark:text-white/45">
      <Check className="h-3 w-3" strokeWidth={2.5} />
      已入核心
    </span>
  );
}

function FragTab({
  contactId,
  frags,
  refresh,
  showToast,
}: {
  contactId: string;
  frags: MemFragment[];
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  if (frags.length === 0) {
    return (
      <EmptyState
        icon={<Layers className="h-8 w-8" strokeWidth={1.5} />}
        text="还没有记忆碎片。和TA聊满 N 轮（设置里可调），或在设置里点「立即总结」即可提取。"
      />
    );
  }
  return (
    <div className="space-y-2.5">
      {frags.map((f) => (
        <MemoryCard
          key={f.id}
          testid={`mem-frag-${f.id}`}
          variant="frag"
          consumed={Boolean(f.consumedAt)}
          content={f.content}
          header={
            <span className="flex items-center gap-1.5 text-[12px] font-medium tabular-nums text-black/40 dark:text-white/40">
              <Clock className="h-3.5 w-3.5" strokeWidth={1.8} />
              {fmtTime(f.sourceTime)}
            </span>
          }
          meta={
            <span className="flex flex-wrap items-center gap-1.5">
              <AppBadge app={f.app} />
              {f.consumedAt && <ConsumedBadge />}
            </span>
          }
          onSave={(text) => {
            if (updateFragment(contactId, f.id, text)) {
              refresh();
              showToast('碎片已更新');
            }
          }}
          onDelete={() => {
            deleteFragment(contactId, f.id);
            refresh();
            showToast('碎片已删除');
          }}
        />
      ))}
    </div>
  );
}

// ---------------- Tab 2：长期记忆（核心记忆） ----------------

function LtmTab({
  contactId,
  ltms,
  refresh,
  showToast,
}: {
  contactId: string;
  ltms: MemLongTerm[];
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  if (ltms.length === 0) {
    return (
      <EmptyState
        icon={<Gem className="h-8 w-8" strokeWidth={1.5} />}
        text="还没有核心记忆。积累 M 条记忆碎片后会自动总结（设置里可调），也可点「立即总结」手动触发。"
      />
    );
  }
  return (
    <div className="space-y-2.5">
      {ltms.map((m) => (
        <MemoryCard
          key={m.id}
          testid={`mem-ltm-${m.id}`}
          variant="ltm"
          content={m.content}
          header={
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-semibold ${INK}`}>
              <Gem aria-hidden="true" className="h-3 w-3" />
              核心记忆
            </span>
          }
          meta={
            <span className="flex flex-wrap items-center gap-1.5">
              <span>来自 {m.fragmentCount} 条碎片</span>
              <span>·</span>
              <span>{m.apps.map((a) => MEM_APP_LABEL[a]).join('、') || MEM_APP_LABEL.wx}</span>
              <span>·</span>
              <span className="tabular-nums">{fmtTime(m.createdAt)} 生成</span>
            </span>
          }
          onSave={(text) => {
            if (updateLongTerm(contactId, m.id, text)) {
              refresh();
              showToast('核心记忆已更新');
            }
          }}
          onDelete={() => {
            deleteLongTerm(contactId, m.id);
            refresh();
            showToast('核心记忆已删除');
          }}
        />
      ))}
    </div>
  );
}

// ---------------- Tab 3：设置 ----------------

/** 设置小节标题（纯文字，无图标） */
function SetSectionHead({ title }: { title: string }) {
  return <h3 className="text-[15px] font-semibold">{title}</h3>;
}

function SetTab({
  contactId,
  contactName,
  refresh,
  showToast,
}: {
  contactId: string;
  contactName: string;
  refresh: () => void;
  showToast: (m: string) => void;
}) {
  const apiConfig = useSettings((s) => s.apiConfig);
  const [settings, setSettings] = useState<MemSettings>(() => getMemSettings(contactId));
  const [busy, setBusy] = useState(false);
  const fragCount = listFragments(contactId).length;
  const pending = pendingFragmentCount(contactId);
  const ltmCount = listLongTerm(contactId).length;

  const patch = (p: Partial<MemSettings>) => {
    const next = saveMemSettings(contactId, p);
    setSettings(next);
    refresh();
  };

  /** 立即总结：不等 N 轮，立刻整理当前对话（自动挑该联系人最近活跃的会话） */
  const summarizeNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const recent = memMostRecentApp(contactId);
      if (!recent) {
        showToast('当前没有可总结的对话，先去和TA聊聊吧');
        return;
      }
      const res = await memSummarizeNow(contactId, recent.app, apiConfig, recent.convo);
      showToast(
        res.longTerm > 0
          ? `总结完成：新增 ${res.fragments} 条碎片，并生成 ${res.longTerm} 条长期记忆`
          : `总结完成：新增 ${res.fragments} 条记忆碎片`
      );
      refresh();
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : '总结失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* 对话总结频率 */}
      <section className={`rounded-[18px] p-4 ${CARD_CLS}`} data-testid="mem-set-interval">
        <SetSectionHead title="对话总结频率" />
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-black/40 dark:text-white/40">
          每隔多少轮对话，自动提取一次记忆碎片
        </p>
        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {MEM_INTERVAL_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={settings.interval === n}
              data-testid={`mem-interval-${n}`}
              onClick={() => patch({ interval: n })}
              className={`rounded-full py-2 text-[14px] font-semibold tabular-nums transition-colors ${
                settings.interval === n
                  ? INK
                  : 'bg-black/[0.05] text-black/60 active:bg-black/[0.1] dark:bg-white/[0.08] dark:text-white/60 dark:active:bg-white/[0.14]'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      {/* 长期记忆总结频率 */}
      <section className={`rounded-[18px] p-4 ${CARD_CLS}`} data-testid="mem-set-threshold">
        <SetSectionHead title="长期记忆总结频率" />
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-black/40 dark:text-white/40">
          积累多少条记忆碎片后，自动总结一条核心记忆
        </p>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {MEM_THRESHOLD_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={settings.threshold === n}
              data-testid={`mem-threshold-${n}`}
              onClick={() => patch({ threshold: n })}
              className={`rounded-full py-2 text-[14px] font-semibold tabular-nums transition-colors ${
                settings.threshold === n
                  ? INK
                  : 'bg-black/[0.05] text-black/60 active:bg-black/[0.1] dark:bg-white/[0.08] dark:text-white/60 dark:active:bg-white/[0.14]'
              }`}
            >
              {n} 条
            </button>
          ))}
        </div>
      </section>

      {/* 跨 App 互通开关 */}
      <section className={`rounded-[18px] p-4 ${CARD_CLS}`} data-testid="mem-set-share">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <SetSectionHead title="跨 App 互通记忆" />
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-black/40 dark:text-white/40">
              开启后 QQ、微信、信息、电话共享「{contactName}」的记忆；关闭后各 App 记忆互相隔离。不同联系人之间永远隔离。
            </p>
          </div>
          <MemSwitch
            checked={settings.share}
            testid="mem-share-toggle"
            onChange={(v) => patch({ share: v })}
          />
        </div>
      </section>

      {/* 手动总结 */}
      <section className={`rounded-[18px] p-4 ${CARD_CLS}`} data-testid="mem-set-summary">
        <SetSectionHead title="手动总结" />
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-black/40 dark:text-white/40">
          不用等 N 轮，立刻整理当前对话中的关键信息并一次性存入记忆库（自动区分碎片与长期记忆）。
        </p>
        <button
          type="button"
          data-testid="mem-summarize"
          onClick={() => void summarizeNow()}
          disabled={busy}
          className={`mt-3.5 flex h-12 w-full items-center justify-center gap-2 rounded-full text-[16px] font-semibold transition-opacity active:opacity-80 ${INK} ${
            busy ? 'opacity-50' : ''
          }`}
        >
          {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Sparkles className="h-[18px] w-[18px]" />}
          {busy ? '正在整理记忆…' : '立即总结'}
        </button>
      </section>

      {/* 数据说明 */}
      <section
        className="flex gap-2 rounded-[18px] bg-black/[0.04] p-4 text-[12.5px] leading-relaxed text-black/45 dark:bg-white/[0.06] dark:text-white/45"
        data-testid="mem-set-note"
      >
        <Info aria-hidden="true" className="mt-[1px] h-4 w-4 shrink-0 text-black/30 dark:text-white/30" />
        <div>
          <p>
            当前联系人：{fragCount} 条碎片（{pending} 条待总结）· {ltmCount} 条核心记忆
          </p>
          <p className="mt-1">
            记忆按联系人独立存储、跨重启保留；删除联系人时其全部记忆一并删除。默认设置：每 {DEFAULT_MEM_SETTINGS.interval} 轮提取、{DEFAULT_MEM_SETTINGS.threshold} 条碎片总结一次、互通开启。
          </p>
        </div>
      </section>
    </div>
  );
}

// ---------------- 通用小组件 ----------------

/** iOS 风格开关（水墨单色：on 纯黑 / 暗色纯白反转） */
function MemSwitch({ checked, onChange, testid }: { checked: boolean; onChange: (v: boolean) => void; testid: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testid}
      onClick={() => onChange(!checked)}
      className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 ${
        checked ? 'bg-neutral-900 dark:bg-white' : 'bg-black/15 dark:bg-white/25'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] h-[26px] w-[26px] rounded-full shadow transition-all duration-200 ${
          checked ? 'left-[22px] bg-white dark:bg-neutral-900' : 'left-[2px] bg-white'
        }`}
      />
    </button>
  );
}

/** 空状态（中性圆底徽章） */
function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="grid place-items-center gap-3 px-8 py-14 text-center">
      <span
        aria-hidden="true"
        className="grid h-16 w-16 place-items-center rounded-full bg-black/[0.05] text-black/35 dark:bg-white/[0.08] dark:text-white/35"
      >
        {icon}
      </span>
      <p className="text-[13.5px] leading-relaxed text-black/45 dark:text-white/45">{text}</p>
    </div>
  );
}

/** 记忆卡片（档案风）：头部时间/徽章 + 右上角常驻编辑/删除 + 虚线分隔 + 底部来源徽章。
 * - frag：头部时钟时间；已入核心的碎片淡显
 * - ltm：头部纯黑「核心记忆」徽章
 */
function MemoryCard({
  variant,
  consumed = false,
  content,
  header,
  meta,
  testid,
  onSave,
  onDelete,
}: {
  variant: 'frag' | 'ltm';
  /** 仅 frag：已被长期记忆总结消费 */
  consumed?: boolean;
  content: string;
  /** 头部左侧：碎片=时钟时间，核心=黑徽章 */
  header: React.ReactNode;
  /** 底部来源徽章 / 元信息 */
  meta: React.ReactNode;
  testid: string;
  onSave: (text: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [confirmDel, setConfirmDel] = useState(false);

  return (
    <div
      data-testid={testid}
      className={`rounded-[20px] p-4 ${CARD_CLS} ${variant === 'frag' && consumed ? 'opacity-[0.72]' : ''}`}
    >
      {/* 头部：时间/徽章 + 常驻编辑删除图标 */}
      <div className="flex min-h-8 items-center justify-between gap-2">
        {header}
        {!editing && (
          <div className="-mr-1.5 flex items-center">
            <button
              type="button"
              aria-label="编辑记忆"
              onClick={() => {
                setDraft(content);
                setEditing(true);
              }}
              className="grid h-8 w-8 place-items-center rounded-full text-black/30 transition-colors active:bg-black/[0.06] active:text-black/70 dark:text-white/30 dark:active:bg-white/[0.1] dark:active:text-white/70"
            >
              <Pencil className="h-[15px] w-[15px]" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              aria-label="删除记忆"
              onClick={() => setConfirmDel(true)}
              className="grid h-8 w-8 place-items-center rounded-full text-black/30 transition-colors active:bg-black/[0.06] active:text-black/70 dark:text-white/30 dark:active:bg-white/[0.1] dark:active:text-white/70"
            >
              <Trash2 className="h-[15px] w-[15px]" strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>

      {/* 虚线分隔：档案质感 */}
      <div aria-hidden="true" className="mt-2 border-t border-dashed border-black/[0.12] dark:border-white/[0.14]" />

      {editing ? (
        <div className="pt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={300}
            aria-label="编辑记忆内容"
            className="w-full resize-none rounded-xl bg-black/[0.04] p-2.5 text-[14.5px] leading-relaxed outline-none ring-1 ring-black/[0.08] focus:ring-neutral-900/35 dark:bg-white/[0.06] dark:ring-white/[0.12] dark:focus:ring-white/40"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(content);
              }}
              className="rounded-full px-3.5 py-1.5 text-[13.5px] text-black/50 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10"
            >
              取消
            </button>
            <button
              type="button"
              data-testid={`${testid}-save`}
              onClick={() => {
                const t = draft.trim();
                if (t) onSave(t);
                setEditing(false);
              }}
              className={`flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[13.5px] font-medium active:opacity-80 ${INK}`}
            >
              <Check className="h-[14px] w-[14px]" /> 保存
            </button>
          </div>
        </div>
      ) : confirmDel ? (
        <div className="flex items-center justify-between gap-2 pt-3">
          <span className="text-[12.5px] text-black/55 dark:text-white/55">确定删除这条记忆？</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setConfirmDel(false)}
              className="rounded-full px-3 py-1.5 text-[13.5px] text-black/50 active:bg-black/5 dark:text-white/50 dark:active:bg-white/10"
            >
              取消
            </button>
            <button
              type="button"
              data-testid={`${testid}-del-confirm`}
              onClick={() => onDelete()}
              className={`rounded-full px-3.5 py-1.5 text-[13.5px] font-medium active:opacity-80 ${INK}`}
            >
              删除
            </button>
          </div>
        </div>
      ) : (
        <>
          <p
            className={`whitespace-pre-wrap break-words pt-3 text-[14.5px] leading-relaxed ${
              variant === 'ltm' ? 'font-medium' : ''
            }`}
          >
            {content}
          </p>
          <div className="mt-2.5 text-[11.5px] text-black/40 dark:text-white/40">{meta}</div>
        </>
      )}
    </div>
  );
}
