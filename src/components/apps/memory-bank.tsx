'use client';

/**
 * 记忆库 App（跨应用记忆互通管理）：
 * - 联系人列表 → 某联系人的记忆详情页（三个 Tab：记忆碎片 / 长期记忆 / 设置）
 * - 记忆碎片：每 N 轮对话自动提取（内容/来源时间/所属会话），支持查看/编辑/删除
 * - 长期记忆：M 条碎片自动总结的核心记忆（内容/来源碎片数量/生成时间），支持查看/编辑/删除
 * - 设置：提取频率（10/20/30/40/50 轮）、总结阈值（3/5/7/10 条）、跨 App 互通开关（默认开）、
 *   「立即总结」手动触发（不等 N 轮立刻整理当前对话，区分碎片与长期记忆并提示）
 * - 数据按联系人 ID 隔离（src/lib/memory.ts，localStorage 持久化，重启保留）；
 *   互通开 = QQ/微信/信息/电话四端共享该联系人记忆；关 = 各端只用自己来源的记忆
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BrainCircuit,
  Check,
  ChevronLeft,
  ChevronRight,
  Layers,
  Loader2,
  Pencil,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
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

/** 来源 App 徽标配色（记忆碎片右上角小字） */
function appBadgeCls(app: MemApp): string {
  switch (app) {
    case 'wx':
      return 'bg-[#07C160]/12 text-[#079A4E] dark:text-[#3ED879]';
    case 'qq':
      return 'bg-[#F6AC3D]/15 text-[#B97B14] dark:text-[#F2B95C]';
    case 'sms':
      return 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400';
    case 'phone':
      return 'bg-neutral-500/12 text-neutral-600 dark:text-neutral-300';
  }
}

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
    <IOSScreen>
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
          <IOSNavBar inline title="记忆库" left={<BackToHome className="static!" />} />
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
            <p className="px-1 pb-2 pt-1 text-[12.5px] leading-relaxed text-black/45 dark:text-white/45">
              按「每 N 轮对话」自动提取记忆碎片，积累后总结成核心记忆；QQ / 微信 / 信息 / 电话四端按联系人的互通开关共享。
            </p>
            {!loaded ? (
              <div className="grid place-items-center py-16 text-black/35 dark:text-white/35">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : contacts.length === 0 ? (
              <div className="grid place-items-center gap-2 py-16 text-center text-black/40 dark:text-white/40">
                <BrainCircuit className="h-8 w-8" strokeWidth={1.5} />
                <p className="text-[14px]">还没有联系人，先去添加一个吧</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-[14px] bg-card" role="list">
                {contacts.map((c, i) => (
                  <ContactRow
                    key={c.id}
                    contact={c}
                    last={i === contacts.length - 1}
                    onOpen={() => setActiveId(c.id)}
                  />
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

// ---------------- 联系人列表行 ----------------

function ContactRow({ contact, last, onOpen }: { contact: ContactRecord; last: boolean; onOpen: () => void }) {
  // 读取记忆计数（渲染时同步读 localStorage；数据量小无性能问题）
  const fragCount = listFragments(contact.id).length;
  const ltmCount = listLongTerm(contact.id).length;
  return (
    <button
      type="button"
      role="listitem"
      data-testid={`mem-contact-${contact.id}`}
      onClick={onOpen}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] ${last ? '' : 'border-b border-black/[0.06] dark:border-white/[0.08]'}`}
    >
      {contact.avatar ? (
        <img src={contact.avatar} alt={contact.name} className="h-[44px] w-[44px] shrink-0 rounded-full object-cover" />
      ) : (
        <DefaultAvatar size={44} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] leading-snug">{displayNameOf(contact) || contact.name}</span>
        <span className="mt-0.5 block text-[12.5px] text-black/45 dark:text-white/45">
          {fragCount > 0 || ltmCount > 0 ? `${fragCount} 条碎片 · ${ltmCount} 条核心记忆` : '暂无记忆'}
        </span>
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" />
    </button>
  );
}

// ---------------- 记忆详情页（三 Tab） ----------------

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

  return (
    <>
      <IOSNavBar
        inline
        title={displayNameOf(contact) || contact.name}
        left={
          <button
            type="button"
            onClick={onBack}
            aria-label="返回记忆库"
            className="flex items-center text-[16px] text-emerald-700 active:opacity-60 dark:text-emerald-400"
          >
            <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.2} />
            记忆库
          </button>
        }
      />
      {/* 三 Tab 分段控制器 */}
      <div className="px-4 pb-1" role="tablist" aria-label="记忆分类">
        <div className="grid grid-cols-3 gap-1 rounded-[10px] bg-black/[0.05] p-[3px] dark:bg-white/[0.08]">
          {(
            [
              ['frag', `记忆碎片 ${frags.length}`],
              ['ltm', `长期记忆 ${ltms.length}`],
              ['set', '设置'],
            ] as [MemTab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              data-testid={`mem-tab-${id}`}
              onClick={() => setTab(id)}
              className={`rounded-[8px] py-[7px] text-[13.5px] font-medium transition-colors ${
                tab === id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-black/50 dark:text-white/50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-8">
        {tab === 'frag' && <FragTab contactId={contact.id} frags={frags} refresh={refresh} showToast={showToast} />}
        {tab === 'ltm' && <LtmTab contactId={contact.id} ltms={ltms} refresh={refresh} showToast={showToast} />}
        {tab === 'set' && (
          <SetTab
            contactId={contact.id}
            contactName={displayNameOf(contact) || contact.name}
            refresh={refresh}
            showToast={showToast}
          />
        )}
      </div>
    </>
  );
}

// ---------------- Tab 1：记忆碎片 ----------------

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
    <div className="space-y-2 pt-2">
      {frags.map((f) => (
        <MemoryCard
          key={f.id}
          testid={`mem-frag-${f.id}`}
          content={f.content}
          meta={
            <span className="flex items-center gap-1.5">
              <span className={`rounded-full px-1.5 py-[1px] text-[10.5px] font-medium ${appBadgeCls(f.app)}`}>
                {MEM_APP_LABEL[f.app]}
              </span>
              <span>{fmtTime(f.sourceTime)}</span>
              {f.consumedAt && <span className="text-black/30 dark:text-white/30">· 已总结</span>}
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

// ---------------- Tab 2：长期记忆 ----------------

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
        icon={<Sparkles className="h-8 w-8" strokeWidth={1.5} />}
        text="还没有核心记忆。积累 M 条记忆碎片后会自动总结（设置里可调），也可点「立即总结」手动触发。"
      />
    );
  }
  return (
    <div className="space-y-2 pt-2">
      {ltms.map((m) => (
        <MemoryCard
          key={m.id}
          testid={`mem-ltm-${m.id}`}
          content={m.content}
          accent
          meta={
            <span className="flex flex-wrap items-center gap-1.5">
              <span>来自 {m.fragmentCount} 条碎片</span>
              <span>·</span>
              <span>{m.apps.map((a) => MEM_APP_LABEL[a]).join('、') || MEM_APP_LABEL.wx}</span>
              <span>·</span>
              <span>{fmtTime(m.createdAt)}生成</span>
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
    <div className="space-y-3 pt-3">
      {/* 对话总结频率 */}
      <section className="rounded-[14px] bg-card p-4" data-testid="mem-set-interval">
        <h3 className="text-[15px] font-medium">对话总结频率</h3>
        <p className="mt-0.5 text-[12.5px] text-black/45 dark:text-white/45">每隔多少轮对话，自动提取一次记忆碎片</p>
        <div className="mt-2.5 grid grid-cols-5 gap-1.5">
          {MEM_INTERVAL_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={settings.interval === n}
              data-testid={`mem-interval-${n}`}
              onClick={() => patch({ interval: n })}
              className={`rounded-[8px] py-2 text-[14px] font-medium transition-colors ${
                settings.interval === n
                  ? 'bg-emerald-600 text-white'
                  : 'bg-black/[0.05] text-black/70 active:bg-black/10 dark:bg-white/[0.08] dark:text-white/70'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      {/* 长期记忆总结频率 */}
      <section className="rounded-[14px] bg-card p-4" data-testid="mem-set-threshold">
        <h3 className="text-[15px] font-medium">长期记忆总结频率</h3>
        <p className="mt-0.5 text-[12.5px] text-black/45 dark:text-white/45">积累多少条记忆碎片后，自动总结一条核心记忆</p>
        <div className="mt-2.5 grid grid-cols-4 gap-1.5">
          {MEM_THRESHOLD_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={settings.threshold === n}
              data-testid={`mem-threshold-${n}`}
              onClick={() => patch({ threshold: n })}
              className={`rounded-[8px] py-2 text-[14px] font-medium transition-colors ${
                settings.threshold === n
                  ? 'bg-emerald-600 text-white'
                  : 'bg-black/[0.05] text-black/70 active:bg-black/10 dark:bg-white/[0.08] dark:text-white/70'
              }`}
            >
              {n} 条
            </button>
          ))}
        </div>
      </section>

      {/* 跨 App 互通开关 */}
      <section className="rounded-[14px] bg-card p-4" data-testid="mem-set-share">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-medium">跨 App 互通记忆</h3>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-black/45 dark:text-white/45">
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
      <section className="rounded-[14px] bg-card p-4" data-testid="mem-set-summary">
        <h3 className="text-[15px] font-medium">手动总结</h3>
        <p className="mt-0.5 text-[12.5px] text-black/45 dark:text-white/45">
          不用等 N 轮，立刻整理当前对话中的关键信息并一次性存入记忆库（自动区分碎片与长期记忆）。
        </p>
        <button
          type="button"
          data-testid="mem-summarize"
          onClick={() => void summarizeNow()}
          disabled={busy}
          className={`mt-3 flex h-[44px] w-full items-center justify-center gap-2 rounded-[10px] text-[16px] font-medium text-white transition-all ${
            busy ? 'bg-emerald-600/50' : 'bg-emerald-600 active:brightness-95'
          }`}
        >
          {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Sparkles className="h-[18px] w-[18px]" />}
          {busy ? '正在总结…' : '立即总结'}
        </button>
      </section>

      {/* 数据说明 */}
      <section className="rounded-[14px] bg-card p-4 text-[12.5px] leading-relaxed text-black/45 dark:text-white/45">
        <p>当前联系人：{fragCount} 条碎片（{pending} 条待总结）· {ltmCount} 条核心记忆</p>
        <p className="mt-1">记忆按联系人独立存储、跨重启保留；删除联系人时其全部记忆一并删除。默认设置：每 {DEFAULT_MEM_SETTINGS.interval} 轮提取、{DEFAULT_MEM_SETTINGS.threshold} 条碎片总结一次、互通开启。</p>
      </section>
    </div>
  );
}

// ---------------- 通用小组件 ----------------

/** iOS 风格开关 */
function MemSwitch({ checked, onChange, testid }: { checked: boolean; onChange: (v: boolean) => void; testid: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testid}
      onClick={() => onChange(!checked)}
      className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 ${
        checked ? 'bg-emerald-600' : 'bg-black/15 dark:bg-white/25'
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

/** 空状态 */
function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="grid place-items-center gap-2.5 px-6 py-16 text-center text-black/40 dark:text-white/40">
      {icon}
      <p className="text-[13.5px] leading-relaxed">{text}</p>
    </div>
  );
}

/** 记忆卡片：点开显示编辑/删除操作 */
function MemoryCard({
  content,
  meta,
  accent = false,
  testid,
  onSave,
  onDelete,
}: {
  content: string;
  meta: React.ReactNode;
  /** 长期记忆卡片描边强调 */
  accent?: boolean;
  testid: string;
  onSave: (text: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [confirmDel, setConfirmDel] = useState(false);

  return (
    <div
      data-testid={testid}
      className={`rounded-[14px] bg-card p-3.5 ${accent ? 'ring-1 ring-emerald-600/25' : ''}`}
    >
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={300}
            aria-label="编辑记忆内容"
            className="w-full resize-none rounded-[10px] bg-black/[0.04] p-2.5 text-[14.5px] leading-relaxed outline-none ring-1 ring-black/10 focus:ring-emerald-600/40 dark:bg-white/[0.06] dark:ring-white/15"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(content);
              }}
              className="rounded-[8px] px-3 py-1.5 text-[13.5px] text-black/55 active:bg-black/5 dark:text-white/55"
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
              className="flex items-center gap-1 rounded-[8px] bg-emerald-600 px-3 py-1.5 text-[13.5px] font-medium text-white active:brightness-95"
            >
              <Check className="h-[14px] w-[14px]" /> 保存
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" className="block w-full text-left" onClick={() => setOpen((v) => !v)}>
            <p className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed">{content}</p>
            <p className="mt-1.5 text-[11.5px] text-black/40 dark:text-white/40">{meta}</p>
          </button>
          {open && (
            <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-black/[0.06] pt-2.5 dark:border-white/[0.08]">
              {confirmDel ? (
                <>
                  <span className="mr-auto text-[12.5px] text-red-600 dark:text-red-400">确定删除这条记忆？</span>
                  <button
                    type="button"
                    onClick={() => setConfirmDel(false)}
                    className="rounded-[8px] px-3 py-1.5 text-[13.5px] text-black/55 active:bg-black/5 dark:text-white/55"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    data-testid={`${testid}-del-confirm`}
                    onClick={() => onDelete()}
                    className="rounded-[8px] bg-red-600 px-3 py-1.5 text-[13.5px] font-medium text-white active:brightness-95"
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
                    className="flex items-center gap-1 rounded-[8px] bg-black/[0.05] px-3 py-1.5 text-[13.5px] active:bg-black/10 dark:bg-white/[0.08] dark:active:bg-white/[0.14]"
                  >
                    <Pencil className="h-[13px] w-[13px]" /> 编辑
                  </button>
                  <button
                    type="button"
                    aria-label="删除记忆"
                    onClick={() => setConfirmDel(true)}
                    className="flex items-center gap-1 rounded-[8px] bg-red-500/10 px-3 py-1.5 text-[13.5px] text-red-600 active:bg-red-500/20 dark:text-red-400"
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
  );
}
