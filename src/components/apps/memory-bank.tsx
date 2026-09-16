'use client';

/**
 * 记忆库 App（跨应用记忆互通管理）——「记忆琥珀馆」视觉主题：
 * 暖奶油底 + 琥珀渐变主色 + 档案标签式 Tab（与系统其它 App 的灰白极简风区分）。
 *
 * 功能结构（逻辑与 src/lib/memory.ts 保持一致，本文件只负责呈现）：
 * - 联系人列表（馆藏总览 Hero 卡 + 每联系人一张档案卡）→ 记忆详情页（三个 Tab）
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
  Gem,
  Info,
  Layers,
  Loader2,
  MessageSquareQuote,
  Pencil,
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

// ---------------- 主题常量（记忆琥珀馆） ----------------

/** 白卡片（暖奶油底上浮起） */
const CARD_CLS =
  'bg-white shadow-[0_2px_12px_-3px_rgba(176,122,26,0.16)] dark:bg-[#241c12] dark:shadow-none';

/** 选中态琥珀渐变（Tab / 选项 / 主按钮共用） */
const AMBER_GRAD =
  'bg-gradient-to-b from-amber-500 to-orange-500 dark:from-amber-500 dark:to-orange-600';
const AMBER_BTN_SHADOW = 'shadow-[0_5px_16px_-5px_rgba(234,138,20,0.55)]';

/** 来源 App 小圆点色（微信绿 / QQ 暖橙 / 信息 iOS 绿 / 电话灰） */
const APP_DOT: Record<MemApp, string> = {
  wx: '#0BC15E',
  qq: '#E8930C',
  sms: '#30C46A',
  phone: '#A2A0A5',
};

/** 每联系人记忆详情（三 Tab） */
type MemTab = 'frag' | 'ltm' | 'set';

export default function MemoryBankApp() {
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
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

  const handleDeleteContactGone = useCallback(() => {
    // 联系人被删（其它端删除联系人会级联清记忆）：详情页自动退回列表
    setActiveId(null);
    void listContacts().then(setContacts).catch(() => undefined);
  }, []);

  return (
    <IOSScreen className="bg-[#faf6ee]! text-amber-950 dark:bg-[#161210]! dark:text-amber-50">
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
        <>
          {/* 自绘顶栏：暖底上比通用 IOSNavBar 更协调 */}
          <header className="shrink-0 pt-[54px]">
            <div className="flex h-11 items-center justify-between px-4">
              <BackToHome className="static!" />
              <span className="text-[19px] font-bold leading-none tracking-tight">记忆库</span>
              <span aria-hidden className="w-11 shrink-0" />
            </div>
          </header>
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-8">
            <HeroCard contacts={contacts} loaded={loaded} />
            {!loaded ? (
              <div className="grid place-items-center py-14 text-amber-900/40 dark:text-amber-100/40">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : contacts.length === 0 ? (
              <div className="grid place-items-center gap-3 py-14 text-center text-amber-900/45 dark:text-amber-100/45">
                <span className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-amber-100 to-orange-50 text-amber-600 ring-1 ring-amber-500/20 dark:from-amber-500/15 dark:to-orange-500/10 dark:text-amber-400">
                  <BrainCircuit className="h-8 w-8" strokeWidth={1.5} />
                </span>
                <p className="text-[14px]">还没有联系人，先去添加一个吧</p>
              </div>
            ) : (
              <div className="mt-3 space-y-2.5" role="list" aria-label="联系人记忆档案">
                {contacts.map((c) => (
                  <ContactCard key={c.id} contact={c} onOpen={() => setActiveId(c.id)} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
      <LocalToast msg={toast} />
    </IOSScreen>
  );
}

// ---------------- 列表页：馆藏总览 Hero 卡 ----------------

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
    <section
      data-testid="mem-hero"
      className="relative mt-2 overflow-hidden rounded-[20px] bg-gradient-to-br from-amber-400 via-orange-300 to-amber-300 p-4 text-amber-950 shadow-[0_10px_24px_-10px_rgba(217,119,6,0.55)] dark:from-amber-500/30 dark:via-orange-500/15 dark:to-amber-400/10 dark:text-amber-100 dark:shadow-none"
    >
      <BrainCircuit
        aria-hidden="true"
        className="absolute -right-3 -top-4 h-24 w-24 rotate-12 text-white/30 dark:text-white/[0.08]"
      />
      <p className="text-[17px] font-bold leading-snug tracking-tight">记忆琥珀馆</p>
      <p className="mt-0.5 max-w-[240px] text-[12px] leading-relaxed opacity-80">
        QQ · 微信 · 信息 · 电话四端对话，沉淀为每位联系人专属的记忆收藏
      </p>
      <div className="mt-3.5 flex items-end gap-7">
        {stats.map(([label, n]) => (
          <div key={label}>
            <p className="text-[22px] font-extrabold leading-none tracking-tight tabular-nums">
              {loaded ? n : '–'}
            </p>
            <p className="mt-1 text-[11px] font-medium opacity-75">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------- 列表页：联系人档案卡 ----------------

/** 琥珀渐变环头像（记忆库专属头像框） */
function AvatarRing({ src, name, size }: { src?: string | null; name: string; size: number }) {
  return (
    <span className="inline-grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-300 via-orange-200 to-amber-400 p-[2px] dark:from-amber-400/60 dark:via-orange-300/40 dark:to-amber-500/60">
      <span
        className="overflow-hidden rounded-full ring-2 ring-[#faf6ee] dark:ring-[#161210]"
        style={{ width: size, height: size }}
      >
        {src ? (
          <img src={src} alt={name} className="h-full w-full rounded-full object-cover" />
        ) : (
          <DefaultAvatar size={size} />
        )}
      </span>
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
      className={`flex w-full items-center gap-3 rounded-[18px] p-3 text-left transition-transform active:scale-[0.985] ${CARD_CLS}`}
    >
      <AvatarRing src={contact.avatar} name={name} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold leading-snug">{name}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {fragCount > 0 || ltmCount > 0 ? (
            <>
              <span className="rounded-full bg-amber-500/[0.12] px-2 py-[2px] text-[11px] font-medium text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">
                {fragCount} 碎片
              </span>
              {ltmCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/[0.13] px-2 py-[2px] text-[11px] font-medium text-orange-800 dark:bg-orange-400/15 dark:text-orange-300">
                  <Gem className="h-3 w-3" /> {ltmCount} 核心
                </span>
              )}
            </>
          ) : (
            <span className="rounded-full bg-black/[0.05] px-2 py-[2px] text-[11px] text-black/40 dark:bg-white/[0.07] dark:text-white/40">
              暂无记忆
            </span>
          )}
        </span>
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-amber-900/25 dark:text-amber-100/25" />
    </button>
  );
}

// ---------------- 记忆详情页（琥珀渐变头部 + 档案标签 Tab） ----------------

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

  const tabs: [MemTab, typeof Layers, string, number | null][] = [
    ['frag', Layers, '记忆碎片', frags.length],
    ['ltm', Gem, '核心记忆', ltms.length],
    ['set', Settings2, '设置', null],
  ];

  return (
    <>
      {/* 琥珀渐变头部：返回 + 头像 + 统计胶囊 + 档案标签 Tab */}
      <div className="relative shrink-0 overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-amber-200/70 via-amber-100/40 to-transparent dark:from-amber-500/[0.18] dark:via-amber-500/[0.05]"
        />
        <div className="relative px-4 pb-3 pt-[54px]">
          <div className="flex h-11 items-center">
            <button
              type="button"
              onClick={onBack}
              aria-label="返回记忆库"
              className="-ml-1 flex items-center text-[16px] font-medium text-amber-900/75 active:opacity-60 dark:text-amber-200/75"
            >
              <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.2} />
              记忆库
            </button>
          </div>

          <div className="mt-1 flex items-center gap-3">
            <AvatarRing src={contact.avatar} name={name} size={54} />
            <div className="min-w-0">
              <p className="truncate text-[20px] font-bold leading-tight tracking-tight">{name}</p>
              <p className="mt-0.5 text-[12px] text-amber-900/50 dark:text-amber-100/50">
                记忆档案 · 按联系人独立保存
              </p>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5" aria-label="记忆统计">
            <span className="rounded-full bg-white/75 px-2.5 py-[3px] text-[12px] font-medium text-amber-900/80 ring-1 ring-amber-500/10 dark:bg-white/10 dark:text-amber-100/75 dark:ring-white/10">
              {frags.length} 条碎片
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/[0.16] px-2.5 py-[3px] text-[12px] font-medium text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">
              <Gem className="h-3 w-3" /> {ltms.length} 条核心
            </span>
            <span
              data-testid="mem-share-state"
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[12px] font-medium ${
                settings.share
                  ? 'bg-orange-500/[0.16] text-orange-800 dark:bg-orange-400/15 dark:text-orange-300'
                  : 'bg-black/[0.06] text-black/40 dark:bg-white/[0.08] dark:text-white/40'
              }`}
            >
              <Share2 className="h-3 w-3" /> 互通 · {settings.share ? '开' : '关'}
            </span>
          </div>

          {/* 档案标签式 Tab（图标 + 文字 + 计数徽标） */}
          <div className="mt-3 grid grid-cols-3 gap-2" role="tablist" aria-label="记忆分类">
            {tabs.map(([id, Icon, label, count]) => {
              const sel = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={sel}
                  data-testid={`mem-tab-${id}`}
                  onClick={() => setTab(id)}
                  className={`flex h-11 items-center justify-center gap-1.5 rounded-[14px] text-[13px] font-medium transition-all ${
                    sel
                      ? `${AMBER_GRAD} text-white ${AMBER_BTN_SHADOW}`
                      : 'bg-white/80 text-amber-950/55 ring-1 ring-amber-500/10 active:bg-white dark:bg-white/[0.06] dark:text-amber-100/50 dark:ring-white/10'
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={sel ? 2.2 : 2} />
                  <span>{label}</span>
                  {count !== null && (
                    <span
                      className={`min-w-[18px] rounded-full px-1 text-[10.5px] font-semibold leading-[16px] tabular-nums ${
                        sel
                          ? 'bg-white/25 text-white'
                          : 'bg-amber-500/[0.12] text-amber-800 dark:bg-amber-400/15 dark:text-amber-300'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-8 pt-3">
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
    </>
  );
}

// ---------------- Tab 1：记忆碎片 ----------------

/** 来源 App 徽标：小圆点 + 名称 */
function AppBadge({ app }: { app: MemApp }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.045] px-1.5 py-[1px] text-[10.5px] font-medium text-black/55 dark:bg-white/[0.07] dark:text-white/55">
      <i aria-hidden="true" className="h-[7px] w-[7px] rounded-full" style={{ background: APP_DOT[app] }} />
      {MEM_APP_LABEL[app]}
    </span>
  );
}

/** 「已入核心」徽标：该碎片已被长期记忆总结消费 */
function ConsumedBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/[0.13] px-1.5 py-[1px] text-[10.5px] font-medium text-amber-700 dark:bg-amber-400/15 dark:text-amber-400">
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
          meta={
            <span className="flex flex-wrap items-center gap-1.5">
              <AppBadge app={f.app} />
              <span className="tabular-nums">{fmtTime(f.sourceTime)}</span>
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

/** 设置小节标题（琥珀图标章） */
function SetSectionHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-amber-100 to-orange-50 text-amber-700 ring-1 ring-amber-500/15 dark:from-amber-500/20 dark:to-orange-500/10 dark:text-amber-400 dark:ring-amber-400/20"
      >
        {icon}
      </span>
      <h3 className="text-[15px] font-semibold">{title}</h3>
    </div>
  );
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
        <SetSectionHead icon={<MessageSquareQuote className="h-4 w-4" />} title="对话总结频率" />
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-amber-950/45 dark:text-amber-100/45">
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
              className={`rounded-[12px] py-2 text-[14px] font-semibold tabular-nums transition-all ${
                settings.interval === n
                  ? `${AMBER_GRAD} text-white ${AMBER_BTN_SHADOW}`
                  : 'bg-amber-500/[0.09] text-amber-900/70 active:bg-amber-500/[0.18] dark:bg-amber-400/[0.1] dark:text-amber-100/70 dark:active:bg-amber-400/20'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      {/* 长期记忆总结频率 */}
      <section className={`rounded-[18px] p-4 ${CARD_CLS}`} data-testid="mem-set-threshold">
        <SetSectionHead icon={<Gem className="h-4 w-4" />} title="长期记忆总结频率" />
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-amber-950/45 dark:text-amber-100/45">
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
              className={`rounded-[12px] py-2 text-[14px] font-semibold tabular-nums transition-all ${
                settings.threshold === n
                  ? `${AMBER_GRAD} text-white ${AMBER_BTN_SHADOW}`
                  : 'bg-amber-500/[0.09] text-amber-900/70 active:bg-amber-500/[0.18] dark:bg-amber-400/[0.1] dark:text-amber-100/70 dark:active:bg-amber-400/20'
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
            <SetSectionHead icon={<Share2 className="h-4 w-4" />} title="跨 App 互通记忆" />
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-amber-950/45 dark:text-amber-100/45">
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
        <SetSectionHead icon={<Sparkles className="h-4 w-4" />} title="手动总结" />
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-amber-950/45 dark:text-amber-100/45">
          不用等 N 轮，立刻整理当前对话中的关键信息并一次性存入记忆库（自动区分碎片与长期记忆）。
        </p>
        <button
          type="button"
          data-testid="mem-summarize"
          onClick={() => void summarizeNow()}
          disabled={busy}
          className={`mt-3.5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-amber-500 via-orange-400 to-amber-500 text-[16px] font-semibold text-white shadow-[0_7px_20px_-7px_rgba(234,138,20,0.65)] transition-all active:opacity-90 ${
            busy ? 'opacity-60' : ''
          }`}
        >
          {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Sparkles className="h-[18px] w-[18px]" />}
          {busy ? '正在整理记忆…' : '立即总结'}
        </button>
      </section>

      {/* 数据说明 */}
      <section
        className="flex gap-2 rounded-[18px] bg-amber-500/[0.07] p-4 text-[12.5px] leading-relaxed text-amber-900/60 dark:bg-amber-400/[0.07] dark:text-amber-100/55"
        data-testid="mem-set-note"
      >
        <Info aria-hidden="true" className="mt-[1px] h-4 w-4 shrink-0 text-amber-700/60 dark:text-amber-400/60" />
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

/** iOS 风格开关（琥珀配色） */
function MemSwitch({ checked, onChange, testid }: { checked: boolean; onChange: (v: boolean) => void; testid: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testid}
      onClick={() => onChange(!checked)}
      className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 ${
        checked
          ? 'bg-gradient-to-r from-amber-500 to-orange-400'
          : 'bg-black/15 dark:bg-white/25'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] h-[26px] w-[26px] rounded-full bg-white shadow transition-all duration-200 ${
          checked ? 'left-[22px]' : 'left-[2px]'
        }`}
      />
    </button>
  );
}

/** 空状态（琥珀圆底徽章） */
function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="grid place-items-center gap-3 px-8 py-14 text-center">
      <span
        aria-hidden="true"
        className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-amber-100 to-orange-50 text-amber-600 ring-1 ring-amber-500/20 dark:from-amber-500/15 dark:to-orange-500/10 dark:text-amber-400"
      >
        {icon}
      </span>
      <p className="text-[13.5px] leading-relaxed text-amber-950/50 dark:text-amber-100/50">{text}</p>
    </div>
  );
}

/** 记忆卡片：点开显示编辑/删除操作。
 * - frag：白卡 + 左侧琥珀渐变竖条；已入核心的碎片淡显
 * - ltm：琥珀渐变底 + Gem 徽标，视觉更「厚重」
 */
function MemoryCard({
  variant,
  consumed = false,
  content,
  meta,
  testid,
  onSave,
  onDelete,
}: {
  variant: 'frag' | 'ltm';
  /** 仅 frag：已被长期记忆总结消费 */
  consumed?: boolean;
  content: string;
  meta: React.ReactNode;
  testid: string;
  onSave: (text: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [confirmDel, setConfirmDel] = useState(false);

  const shell =
    variant === 'ltm'
      ? 'rounded-[18px] bg-gradient-to-br from-amber-50 via-white to-orange-100/70 p-3.5 shadow-[0_4px_16px_-5px_rgba(217,119,6,0.28)] ring-1 ring-amber-500/30 dark:from-amber-500/[0.14] dark:via-[#241c12] dark:to-orange-500/[0.08] dark:ring-amber-500/25'
      : `rounded-[18px] p-3.5 ${CARD_CLS} ${consumed ? 'opacity-[0.8]' : ''}`;
  const barCls = consumed
    ? 'from-amber-300 to-amber-200 dark:from-amber-500/30 dark:to-amber-500/20'
    : 'from-amber-400 to-orange-300 dark:from-amber-500/80 dark:to-orange-400/60';

  return (
    <div data-testid={testid} className={shell}>
      {/* 核心记忆卡头部徽标行 */}
      {variant === 'ltm' && !editing && (
        <div className="mb-1.5 flex items-center gap-1.5">
          <Gem aria-hidden="true" className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          <span className="text-[11.5px] font-semibold tracking-wide text-amber-700 dark:text-amber-400">
            核心记忆
          </span>
        </div>
      )}
      <div className="flex gap-2.5">
        {variant === 'frag' && (
          <span
            aria-hidden="true"
            className={`w-[3.5px] shrink-0 self-stretch rounded-full bg-gradient-to-b ${barCls}`}
          />
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                maxLength={300}
                aria-label="编辑记忆内容"
                className="w-full resize-none rounded-xl bg-amber-500/[0.06] p-2.5 text-[14.5px] leading-relaxed outline-none ring-1 ring-amber-500/25 focus:ring-amber-500/60 dark:bg-black/20 dark:ring-amber-400/25 dark:focus:ring-amber-400/60"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setDraft(content);
                  }}
                  className="rounded-full px-3.5 py-1.5 text-[13.5px] text-amber-950/55 active:bg-black/5 dark:text-amber-100/55 dark:active:bg-white/10"
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
                  className={`flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[13.5px] font-medium text-white ${AMBER_GRAD} ${AMBER_BTN_SHADOW}`}
                >
                  <Check className="h-[14px] w-[14px]" /> 保存
                </button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" className="block w-full text-left" onClick={() => setOpen((v) => !v)}>
                <p
                  className={`whitespace-pre-wrap break-words text-[14.5px] leading-relaxed ${
                    variant === 'ltm' ? 'font-medium' : ''
                  }`}
                >
                  {content}
                </p>
                <p className="mt-1.5 text-[11.5px] text-amber-950/45 dark:text-amber-100/45">{meta}</p>
              </button>
              {open && (
                <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-amber-500/[0.14] pt-2.5 dark:border-amber-400/[0.15]">
                  {confirmDel ? (
                    <>
                      <span className="mr-auto text-[12.5px] text-red-600 dark:text-red-400">
                        确定删除这条记忆？
                      </span>
                      <button
                        type="button"
                        onClick={() => setConfirmDel(false)}
                        className="rounded-full px-3 py-1.5 text-[13.5px] text-amber-950/55 active:bg-black/5 dark:text-amber-100/55 dark:active:bg-white/10"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        data-testid={`${testid}-del-confirm`}
                        onClick={() => onDelete()}
                        className="rounded-full bg-red-600 px-3.5 py-1.5 text-[13.5px] font-medium text-white active:brightness-95"
                      >
                        删除
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        aria-label="编辑记忆"
                        onClick={() => {
                          setDraft(content);
                          setEditing(true);
                        }}
                        className="flex items-center gap-1 rounded-full bg-amber-500/[0.13] px-3 py-1.5 text-[13.5px] font-medium text-amber-800 active:bg-amber-500/[0.22] dark:bg-amber-400/15 dark:text-amber-300 dark:active:bg-amber-400/25"
                      >
                        <Pencil className="h-[13px] w-[13px]" /> 编辑
                      </button>
                      <button
                        type="button"
                        aria-label="删除记忆"
                        onClick={() => setConfirmDel(true)}
                        className="flex items-center gap-1 rounded-full bg-red-500/10 px-3 py-1.5 text-[13.5px] font-medium text-red-600 active:bg-red-500/20 dark:text-red-400"
                      >
                        <Trash2 className="h-[13px] w-[13px]" /> 删除
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
