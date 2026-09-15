'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Camera,
  Check,
  ChevronRight,
  Dices,
  FileDown,
  FileUp,
  Loader2,
  Phone,
  Plus,
  Trash2,
  UserRound,
} from 'lucide-react';
import { IOSBackButton, IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';
import { GlassButton } from '@/components/ios/GlassButton';
import { DefaultAvatar } from '@/components/apps/default-avatar';
import {
  createContact,
  deleteContact,
  listContacts,
  updateContact,
} from '@/lib/ios/contacts-store';
import {
  genPhone,
  genQQ,
  genWechatId,
  type ContactKind,
  type ContactRecord,
} from '@/lib/contacts';

/**
 * 联系人 App：
 * - 三个 tab（CHAR/USER/NPC，固定屏幕底部）：CHAR 与 USER 表单一致，NPC 多「为谁添加」
 * - 好友机制：CHAR/NPC 创建后默认未添加好友，不出现在主列表；
 *   只能在「信息」App 右上角「+」凭手机号搜索并添加好友后，
 *   才会出现在联系人主列表与信息 App（USER 恒为好友）
 * - 表单：长方形边框输入框（年龄/身高/体重/职业/地区两列平行）、头像本机上传（默认黑白灰小人）、
 *   人设/背景、手机号/微信号/QQ号可生成（留空保存时本地自动生成）
 * - 详情页：渐变头部 + 类型胶囊 + 带图标分组卡片 + 编辑 + 导出全部资料（txt，全部字段）+ 删除（删除主体时名下 NPC 级联删除）
 * - 导入/导出闭环：列表页右上角「导入」（加号左侧）可从 txt/md 文件导入联系人（导入即好友）；
 *   详情页「导出全部资料」导出全部字段（名字/类型/基础信息/账号/人设/背景），与导入同一格式、可直接再导入
 * 数据存浏览器本地 IndexedDB（四 App 共享同一份），增删改查/编号/级联全在本地完成。
 */

type View =
  | { mode: 'list' }
  | { mode: 'add'; kind: ContactKind }
  | { mode: 'edit'; id: string }
  | { mode: 'detail'; id: string };

const TABS: { key: ContactKind; label: string; hint: string }[] = [
  { key: 'char', label: 'CHAR', hint: 'AI 角色' },
  { key: 'user', label: 'USER', hint: '我自己' },
  { key: 'npc', label: 'NPC', hint: '配角' },
];

function isFriendOf(c: ContactRecord): boolean {
  return c.kind === 'user' || c.isFriend;
}

function Avatar({ contact, size = 44 }: { contact: ContactRecord; size?: number }) {
  if (contact.avatar) {
    return (
      // inline-flex：在任意父级（含非 flex 的行内容器）里都保持固定尺寸，图片不会撑破布局
      <span className="inline-flex shrink-0 overflow-hidden rounded-full" style={{ width: size, height: size }}>
        <img src={contact.avatar} alt={`${contact.name}的头像`} className="h-full w-full object-cover" />
      </span>
    );
  }
  return <DefaultAvatar size={size} />;
}

/** 本机选图 → canvas 居中裁剪压缩成 240px JPEG dataURL（控制入库体积） */
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

// ---------------- 表单小组件 ----------------

/** 分组小标题（表单分区提示） */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-5 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground/70">
      {children}
    </p>
  );
}

/** 长方形输入框（带边框圆角矩形，聚焦高亮） */
const boxInputCls =
  'h-[46px] w-full rounded-[12px] border border-border/80 bg-background px-3.5 text-[15px] leading-[22px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-foreground/45 focus:ring-4 focus:ring-foreground/[0.07]';

/** 长方形多行输入框 */
const boxAreaCls =
  'w-full resize-none rounded-[12px] border border-border/80 bg-background px-3.5 py-3 text-[15px] leading-[22px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-foreground/45 focus:ring-4 focus:ring-foreground/[0.07]';

/** 字段格子：上方小标签、下方长方形输入框 */
function BoxField({
  label,
  required = false,
  children,
  className = '',
}: {
  label: string;
  /** 必填标记：标签尾随红色 *（微信密码/QQ密码用） */
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label className="mb-1.5 block px-1 text-[12.5px] font-medium text-muted-foreground">
        {label}
        {required && <span aria-hidden="true" className="ml-0.5 text-[#FF3B30]">*</span>}
      </label>
      {children}
    </div>
  );
}

/** 短字段两列网格（性别/年龄/身高/体重/职业/地区 平行排列） */
function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-3 gap-y-3.5">{children}</div>;
}

/** 性别三选 pill（放进 BoxField 使用） */
function GenderPills({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label="性别">
      {['男', '女', '其他'].map((g) => (
        <button
          key={g}
          type="button"
          role="radio"
          aria-checked={value === g}
          aria-label={`性别${g}`}
          onClick={() => onChange(value === g ? '' : g)}
          className={`h-[46px] flex-1 rounded-[12px] text-[14px] font-medium transition-all active:scale-[0.97] ${
            value === g
              ? 'bg-foreground text-background shadow-[0_2px_10px_rgba(0,0,0,0.14)]'
              : 'border border-border/80 bg-background text-muted-foreground'
          }`}
        >
          {g}
        </button>
      ))}
    </div>
  );
}

/** 名字输入框提示语（按 tab 类型区分） */
const NAME_PLACEHOLDERS: Record<ContactKind, string> = {
  char: '给 AI 角色起个名字',
  user: '你的昵称',
  npc: '配角的名字',
};

/** 带生成按钮的长方形输入框（骰子按钮内嵌右侧） */
function GenBoxField({
  label,
  value,
  onChange,
  onGen,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onGen: () => void;
  placeholder: string;
}) {
  return (
    <BoxField label={label}>
      <div className="relative">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          className={`${boxInputCls} pr-12`}
        />
        <button
          type="button"
          onClick={onGen}
          aria-label={`生成${label}`}
          title={`生成${label}`}
          className="absolute right-[5px] top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[9px] border border-border/50 bg-card/60 text-muted-foreground backdrop-blur-xl transition-colors active:text-foreground"
        >
          <Dices className="h-[17px] w-[17px]" strokeWidth={1.9} />
        </button>
      </div>
    </BoxField>
  );
}

// ---------------- 联系人文件导入 / 导出格式 ----------------

/**
 * 导入文件格式（与详情页「导出全部资料」同一格式，可回环）：
 * 【AI手机联系人】                          ← 区块开标（一个文件可含多个联系人）
 * 名字：乐乐
 * 类型：CHAR                                ← CHAR / USER / NPC
 * 性别：男 / 年龄：22 / 身高 / 体重 / 职业 / 地区 / 关系 / 归属（NPC 归属主人名）
 * 手机号 / 微信号 / 微信密码 / QQ号 / QQ密码
 * 人设：                                    ← 多行块，到下一个标签或区块结束
 * ……
 * 背景：
 * ……
 */
interface ParsedContact {
  name: string;
  nickname: string;
  kind: ContactKind;
  gender: string;
  age: string;
  height: string;
  weight: string;
  occupation: string;
  region: string;
  relation: string;
  ownerName: string;
  phone: string;
  wechatId: string;
  wechatPassword: string;
  qqId: string;
  qqPassword: string;
  persona: string;
  background: string;
}

/** 单行字段标签 → 字段名（长标签在前，避免「微信号」截胡「微信密码」） */
const SINGLE_FIELD_LABELS: Array<[string, keyof ParsedContact]> = [
  ['名字', 'name'],
  ['昵称', 'nickname'],
  ['类型', 'kind'],
  ['性别', 'gender'],
  ['年龄', 'age'],
  ['身高', 'height'],
  ['体重', 'weight'],
  ['职业', 'occupation'],
  ['地区', 'region'],
  ['关系', 'relation'],
  ['归属', 'ownerName'],
  ['手机号', 'phone'],
  ['微信密码', 'wechatPassword'],
  ['微信号', 'wechatId'],
  ['QQ密码', 'qqPassword'],
  ['QQ号', 'qqId'],
];

function emptyParsed(): ParsedContact {
  return {
    name: '',
    nickname: '',
    kind: 'char',
    gender: '',
    age: '',
    height: '',
    weight: '',
    occupation: '',
    region: '',
    relation: '',
    ownerName: '',
    phone: '',
    wechatId: '',
    wechatPassword: '',
    qqId: '',
    qqPassword: '',
    persona: '',
    background: '',
  };
}

/** 解析单个区块的行 → 联系人；没有「名字：」返回 null */
function parseContactBlock(blockLines: string[]): ParsedContact | null {
  const c = emptyParsed();
  const personaLines: string[] = [];
  const backgroundLines: string[] = [];
  let block: 'persona' | 'background' | null = null;

  for (const raw of blockLines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      // 多行块内的空行保留换行
      if (block === 'persona') personaLines.push('');
      else if (block === 'background') backgroundLines.push('');
      continue;
    }
    // 多行块标签：整行恰为「人设：」/「背景：」（半/全角冒号均可）
    if (/^人设[:：]$/.test(trimmed)) {
      block = 'persona';
      continue;
    }
    if (/^背景[:：]$/.test(trimmed)) {
      block = 'background';
      continue;
    }
    // 单行字段
    let matched = false;
    for (const [label, key] of SINGLE_FIELD_LABELS) {
      const m = trimmed.match(new RegExp(`^${label}[:：]\\s*(.*)$`));
      if (m) {
        const v = m[1].trim();
        if (key === 'kind') {
          c.kind = /user/i.test(v) ? 'user' : /npc/i.test(v) ? 'npc' : 'char';
        } else {
          c[key] = v;
        }
        block = null;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    // 其余行归当前多行块（保留行内空白）
    if (block === 'persona') personaLines.push(raw.replace(/\s+$/, ''));
    else if (block === 'background') backgroundLines.push(raw.replace(/\s+$/, ''));
  }

  c.persona = personaLines.join('\n').trim();
  c.background = backgroundLines.join('\n').trim();
  return c.name.trim() ? c : null;
}

/** 解析导入文件：按【AI手机联系人】标记拆区块；无标记时若含「名字：」按单区块处理 */
function parseContactsFile(text: string): { list: ParsedContact[]; skipped: number } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const blocks: string[][] = [];
  let current: string[] = [];
  let sawMarker = false;
  for (const line of lines) {
    if (/^【AI手机联系人】\s*$/.test(line.trim())) {
      sawMarker = true;
      blocks.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  blocks.push(current);

  if (!sawMarker && !/^名字\s*[:：]/m.test(text)) {
    return { list: [], skipped: 0 };
  }

  const list: ParsedContact[] = [];
  let skipped = 0;
  for (const b of blocks) {
    const parsed = parseContactBlock(b);
    if (parsed) list.push(parsed);
    else if (b.some((l) => l.trim())) skipped += 1;
  }
  return { list, skipped };
}

// ---------------- 主组件 ----------------

export default function ContactsApp() {
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<ContactKind>('char');
  const [view, setView] = useState<View>({ mode: 'list' });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setContacts(await listContacts());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '读取联系人失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 新建或更新本地联系人（编辑/添加好友后同步） */
  const upsert = useCallback((c: ContactRecord) => {
    setContacts((prev) => {
      const i = prev.findIndex((x) => x.id === c.id);
      if (i === -1) return [c, ...prev];
      const next = [...prev];
      next[i] = c;
      return next;
    });
  }, []);

  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const owners = useMemo(() => contacts.filter((c) => c.kind === 'char' || c.kind === 'user'), [contacts]);

  const subtitleOf = (c: ContactRecord): string => {
    if (c.kind === 'npc') {
      const owner = c.ownerId ? byId.get(c.ownerId) : undefined;
      const parts = [c.relation || 'NPC'];
      if (owner) parts.push(owner.name);
      return parts.join(' · ');
    }
    const parts = [c.gender, c.age ? `${c.age}岁` : ''].filter(Boolean);
    return parts.join(' · ');
  };

  return (
    <IOSScreen>
      {view.mode === 'list' && (
        <ListView
          contacts={contacts}
          loading={loading}
          loadError={loadError}
          tab={tab}
          onTab={setTab}
          subtitleOf={subtitleOf}
          onOpenDetail={(id) => setView({ mode: 'detail', id })}
          onAdd={(kind) => setView({ mode: 'add', kind })}
          onRetry={() => void load()}
        />
      )}
      {view.mode === 'add' && (
        <ContactFormView
          kind={view.kind}
          owners={owners}
          onSaved={(created) => {
            upsert(created);
            setTab(created.kind);
            setView({ mode: 'list' });
          }}
          onCancel={() => setView({ mode: 'list' })}
        />
      )}
      {view.mode === 'edit' && (
        <ContactFormView
          kind={byId.get(view.id)?.kind ?? 'char'}
          initial={byId.get(view.id) ?? null}
          owners={owners}
          onSaved={(updated) => {
            upsert(updated);
            setView({ mode: 'detail', id: updated.id });
          }}
          onCancel={() => setView({ mode: 'detail', id: view.id })}
        />
      )}
      {view.mode === 'detail' && (
        <DetailView
          contact={byId.get(view.id) ?? null}
          ownerName={(() => {
            const c = byId.get(view.id);
            return c?.ownerId ? byId.get(c.ownerId)?.name ?? null : null;
          })()}
          onEdit={(id) => setView({ mode: 'edit', id })}
          onBack={() => setView({ mode: 'list' })}
          onDeleted={(id) => {
            // 服务端级联删 NPC，本地同步移除
            setContacts((prev) => prev.filter((c) => c.id !== id && c.ownerId !== id));
            setView({ mode: 'list' });
          }}
        />
      )}
    </IOSScreen>
  );
}

// ---------------- 列表 ----------------

/** 列表行（好友） */
function FriendRow({
  contact,
  subtitle,
  onOpen,
}: {
  contact: ContactRecord;
  subtitle: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`查看${contact.name}`}
      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors active:bg-muted/60"
    >
      <Avatar contact={contact} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-medium leading-tight">{contact.name}</span>
        <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{subtitle}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
    </button>
  );
}

/** 未添加好友行：灰显 + 引导去「信息」App 添加/删除（联系人 App 不提供添加/删除入口） */
function PendingRow({ contact, onOpen }: { contact: ContactRecord; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`查看${contact.name}资料`}
      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors active:bg-muted/60"
    >
      <span className="opacity-70">
        <Avatar contact={contact} size={40} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-tight">{contact.name}</span>
        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
          未添加好友 · 去「信息」App ›「+」凭手机号添加或删除
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
    </button>
  );
}

function ListView({
  contacts,
  loading,
  loadError,
  tab,
  onTab,
  subtitleOf,
  onOpenDetail,
  onAdd,
  onRetry,
}: {
  contacts: ContactRecord[];
  loading: boolean;
  loadError: string;
  tab: ContactKind;
  onTab: (k: ContactKind) => void;
  subtitleOf: (c: ContactRecord) => string;
  onOpenDetail: (id: string) => void;
  onAdd: (kind: ContactKind) => void;
  onRetry: () => void;
}) {
  const all = contacts.filter((c) => c.kind === tab);
  // USER 恒为好友；CHAR/NPC 需添加好友后才进主列表
  const friendList = all.filter(isFriendOf);
  const pendingList = all.filter((c) => !isFriendOf(c));
  const activeTab = TABS.find((t) => t.key === tab)!;

  // ---- 导入联系人文件（右上角「导入」，加号左侧） ----
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ text: string; bad: boolean } | null>(null);

  useEffect(() => {
    if (!importMsg) return;
    const t = window.setTimeout(() => setImportMsg(null), 6000);
    return () => window.clearTimeout(t);
  }, [importMsg]);

  /** 导入联系人文件：解析 → 逐个创建（导入即好友）→ 刷新列表 */
  const onPickImportFile = async (f: File | undefined) => {
    if (!f || importing) return;
    setImporting(true);
    try {
      const text = await f.text();
      const { list, skipped } = parseContactsFile(text);
      if (list.length === 0) {
        setImportMsg({ text: '导入失败：文件里没有找到「名字：」开头的联系人信息', bad: true });
        return;
      }
      const importedNames: string[] = [];
      let failed = 0;
      for (const p of list) {
        // NPC 归属：按「归属：名字」匹配现有 CHAR/USER；匹配不到则跳过（服务端要求 NPC 必须有归属）
        let ownerId: string | null = null;
        if (p.kind === 'npc') {
          const owner = p.ownerName
            ? contacts.find((x) => x.kind !== 'npc' && x.name === p.ownerName)
            : undefined;
          if (!owner) {
            failed += 1;
            continue;
          }
          ownerId = owner.id;
        }
        const created = await createContact({
          kind: p.kind,
          ownerId,
          name: p.name,
          nickname: p.nickname,
          gender: p.gender,
          age: p.age,
          height: p.height,
          weight: p.weight,
          occupation: p.occupation,
          region: p.region,
          relation: p.relation,
          phone: p.phone,
          wechatId: p.wechatId,
          wechatPassword: p.wechatPassword,
          qqId: p.qqId,
          qqPassword: p.qqPassword,
          persona: p.persona,
          background: p.background,
          avatar: null,
        }).catch(() => null);
        if (!created) {
          failed += 1;
          continue;
        }
        importedNames.push(created.name);
        // 导入即视为好友：CHAR/NPC 本地默认「待添加」，补一次更新让它直接进主列表与信息 App
        if (created.kind !== 'user' && !created.isFriend) {
          const friended = await updateContact(created.id, { isFriend: true }).catch(() => null);
          if (friended) importedNames[importedNames.length - 1] = friended.name;
        }
      }
      onRetry();
      if (importedNames.length === 0) {
        setImportMsg({ text: '导入失败：没有可导入的联系人（NPC 缺归属或字段无效）', bad: true });
      } else {
        const extra = skipped + failed > 0 ? `；跳过 ${skipped + failed} 位` : '';
        setImportMsg({
          text: `已导入 ${importedNames.length} 位联系人：${importedNames.join('、')}${extra}`,
          bad: false,
        });
      }
    } catch {
      setImportMsg({ text: '读取文件失败，请重试', bad: true });
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <IOSNavBar
        inline
        title="联系人"
        left={<BackToHome className="static!" />}
        right={
          <div className="flex items-center gap-2">
            {/* 导入联系人：在加号左侧，从 txt/md 文件导入（与详情页「导出全部资料」同一格式） */}
            <GlassButton
              type="button"
              onClick={() => importInputRef.current?.click()}
              disabled={importing}
              aria-label="导入联系人"
              title="从文件导入联系人"
              className="flex h-9 w-9 items-center justify-center rounded-full"
            >
              {importing ? (
                <Loader2 className="h-[17px] w-[17px] animate-spin" strokeWidth={2.1} />
              ) : (
                <FileUp className="h-[17px] w-[17px]" strokeWidth={2} />
              )}
            </GlassButton>
            <GlassButton
              type="button"
              onClick={() => onAdd(tab)}
              aria-label={`添加${activeTab.label}`}
              className="flex h-9 w-9 items-center justify-center rounded-full"
            >
              <Plus className="h-[19px] w-[19px]" strokeWidth={2.2} />
            </GlassButton>
          </div>
        }
      />

      {/* 导入结果提示（几秒后自动消失）+ 隐藏文件选择框 */}
      {importMsg && (
        <p
          role="status"
          className={`px-4 pb-0.5 text-center text-[12.5px] leading-[18px] ${
            importMsg.bad ? 'text-[#FF3B30]' : 'text-muted-foreground'
          }`}
        >
          {importMsg.text}
        </p>
      )}
      <input
        ref={importInputRef}
        type="file"
        accept=".txt,.md,.markdown,text/plain,text/markdown"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          void onPickImportFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {!loading && loadError && (
          <div className="px-6 py-10 text-center text-[14px] text-muted-foreground">
            {loadError}
            <button type="button" onClick={onRetry} className="ml-2 text-foreground underline">
              重试
            </button>
          </div>
        )}

        {!loading && !loadError && (
          <>
            {/* 未添加好友（CHAR/NPC 创建后先在这里；添加/删除都只能去「信息」App） */}
            {pendingList.length > 0 && (
              <div className="mx-4 mb-3 overflow-hidden rounded-[14px] bg-muted/35 ring-1 ring-border/40">
                <p className="px-3.5 pb-1 pt-2.5 text-[12px] font-medium text-muted-foreground">
                  未添加好友 · 只能在「信息」App 添加或删除
                </p>
                <div className="pb-1">
                  {pendingList.map((c) => (
                    <PendingRow key={c.id} contact={c} onOpen={() => onOpenDetail(c.id)} />
                  ))}
                </div>
              </div>
            )}

            {/* 好友主列表 */}
            {friendList.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <p className="text-[15px] font-medium text-muted-foreground">
                  {pendingList.length > 0 ? `还没有已添加的${activeTab.label}` : `还没有${activeTab.label}`}
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground/70">
                  {pendingList.length > 0
                    ? '到「信息」App ›「+」凭手机号添加好友'
                    : `${activeTab.hint} · 点右上角「+」创建`}
                </p>
              </div>
            ) : (
              <ul
                className="mx-4 mb-3 overflow-hidden rounded-[14px] bg-muted/45"
                aria-label={`${activeTab.label}列表`}
              >
                {friendList.map((c) => (
                  <li key={c.id} className="border-b border-border/50 last:border-b-0">
                    <FriendRow
                      contact={c}
                      subtitle={subtitleOf(c)}
                      onOpen={() => onOpenDetail(c.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* 三段式 tab：CHAR / USER / NPC（屏幕底部） */}
      <nav
        role="tablist"
        aria-label="联系人分类"
        className="z-20 shrink-0 border-t border-border/40 bg-background/85 pb-[26px] pt-2 backdrop-blur-xl"
      >
        <div className="mx-4 flex rounded-[10px] bg-muted/70 p-[2px]">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => onTab(t.key)}
              className={`h-[32px] flex-1 rounded-[8px] text-[13px] font-semibold tracking-wide transition-all ${
                tab === t.key
                  ? 'bg-background text-foreground shadow-[0_1px_4px_rgba(0,0,0,0.12)]'
                  : 'text-muted-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}

// ---------------- 添加 / 编辑表单 ----------------

interface ContactFormState {
  name: string;
  /** 昵称：QQ/微信等社交 App 显示的名字（非真实名字） */
  nickname: string;
  gender: string;
  age: string;
  height: string;
  weight: string;
  occupation: string;
  region: string;
  relation: string;
  persona: string;
  background: string;
  phone: string;
  wechatId: string;
  wechatPassword: string;
  qqId: string;
  qqPassword: string;
}

const EMPTY_FORM: ContactFormState = {
  name: '',
  nickname: '',
  gender: '',
  age: '',
  height: '',
  weight: '',
  occupation: '',
  region: '',
  relation: '',
  persona: '',
  background: '',
  phone: '',
  wechatId: '',
  wechatPassword: '',
  qqId: '',
  qqPassword: '',
};

function formFromRecord(c: ContactRecord): ContactFormState {
  const pick = (v: string | null): string => v ?? '';
  return {
    name: pick(c.name),
    nickname: pick(c.nickname),
    gender: pick(c.gender),
    age: pick(c.age),
    height: pick(c.height),
    weight: pick(c.weight),
    occupation: pick(c.occupation),
    region: pick(c.region),
    relation: pick(c.relation),
    persona: pick(c.persona),
    background: pick(c.background),
    phone: pick(c.phone),
    wechatId: pick(c.wechatId),
    wechatPassword: pick(c.wechatPassword),
    qqId: pick(c.qqId),
    qqPassword: pick(c.qqPassword),
  };
}

/** 添加 / 编辑共用表单：编辑模式传 initial，保存走 PATCH；新建走 POST */
function ContactFormView({
  kind,
  initial,
  owners,
  onSaved,
  onCancel,
}: {
  kind: ContactKind;
  /** 编辑模式：传入原记录；新建模式不传 */
  initial?: ContactRecord | null;
  owners: ContactRecord[];
  onSaved: (c: ContactRecord) => void;
  onCancel: () => void;
}) {
  const editing = Boolean(initial);
  const isNpc = kind === 'npc';
  const tabMeta = TABS.find((t) => t.key === kind)!;

  const [form, setForm] = useState<ContactFormState>(initial ? formFromRecord(initial) : EMPTY_FORM);
  const [avatar, setAvatar] = useState<string | null>(initial?.avatar ?? null);
  const [personaFileName, setPersonaFileName] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string>(initial?.ownerId ?? '');
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const personaFileRef = useRef<HTMLInputElement | null>(null);

  const set = (k: keyof ContactFormState) => (v: string) => setForm((p) => ({ ...p, [k]: v }));

  const onPickFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      setAvatar(await fileToAvatarDataUrl(f));
    } catch {
      setError('头像处理失败，请换一张图片');
    }
  };

  /** 从手机导入人设文件（txt/md/json）：读取纯文本填入「人设」框，导入后可继续编辑 */
  const onPickPersonaFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const text = (await f.text()).replace(/^\uFEFF/, '').trim();
      if (!text) {
        setError('文件内容为空，请换一个文件');
        return;
      }
      setForm((p) => ({ ...p, persona: text }));
      setPersonaFileName(f.name);
      setError('');
    } catch {
      setError('读取文件失败，请重试');
    }
  };

  const save = async () => {
    if (submitting) return;
    if (!form.name.trim()) {
      setError('名字不能为空');
      return;
    }
    if (isNpc && !ownerId) {
      setError('请选择为谁添加 NPC');
      return;
    }
    // 密码规则：密码只是微信/QQ 的登录凭据，仅 kind='user' 需要——
    // CHAR/NPC 不能登录，不再强制填密码（否则「只改个人设/背景」也会被拦死，实测复现）；
    // 编辑 USER 时清空密码框 = 保持原密码（表单已回显原值，误清会导致无法登录，按未修改处理）
    const wechatPassword = form.wechatPassword.trim() || (editing && initial ? initial.wechatPassword ?? '' : '');
    const qqPassword = form.qqPassword.trim() || (editing && initial ? initial.qqPassword ?? '' : '');
    if (kind === 'user' && !wechatPassword) {
      setError('请填写微信密码（密码为必填项）');
      return;
    }
    if (kind === 'user' && !qqPassword) {
      setError('请填写QQ密码（密码为必填项）');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const saved = editing
        ? await updateContact(initial!.id, {
            ...form,
            wechatPassword,
            qqPassword,
            ownerId: isNpc ? ownerId : null,
            avatar,
          })
        : await createContact({ kind, ownerId: isNpc ? ownerId : null, avatar, ...form, wechatPassword, qqPassword });
      if (!saved) throw new Error('联系人不存在');
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请重试');
      setSubmitting(false);
    }
  };

  const owner = ownerId ? owners.find((o) => o.id === ownerId) : undefined;

  return (
    <>
      {/* 顶部导航：标题居中，左侧返回键，右侧保存 */}
      <IOSNavBar
        title={editing ? `编辑${tabMeta.label}` : `添加${tabMeta.label}`}
        large={false}
        left={<IOSBackButton onClick={onCancel} label="返回" />}
        right={
          <GlassButton
            type="button"
            onClick={() => void save()}
            disabled={submitting}
            aria-label="保存联系人"
            className="flex h-[30px] items-center rounded-full px-3.5 text-[14px] font-semibold"
          >
            {submitting ? '保存中…' : '保存'}
          </GlassButton>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10">
        {/* 头像（本机上传）：大圆 + 相机角标（点头像即选图） */}
        <div className="flex flex-col items-center pb-1 pt-5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="上传头像"
            className={`relative h-[104px] w-[104px] rounded-full transition-transform active:scale-95 ${
              avatar
                ? 'shadow-[0_6px_20px_rgba(0,0,0,0.14)] ring-1 ring-border/50'
                : 'bg-gradient-to-b from-muted/90 to-muted/40 ring-1 ring-border/60'
            }`}
          >
            {avatar ? (
              <img src={avatar} alt="头像预览" className="h-full w-full rounded-full object-cover" />
            ) : (
              <DefaultAvatar size={104} />
            )}
            <span
              aria-hidden="true"
              className="absolute -bottom-0.5 -right-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background ring-[3px] ring-background"
            >
              <Camera className="h-[15px] w-[15px]" strokeWidth={2.2} />
            </span>
          </button>
          {avatar ? (
            <button
              type="button"
              onClick={() => setAvatar(null)}
              className="mt-2.5 text-[13px] text-muted-foreground underline underline-offset-2"
            >
              移除头像
            </button>
          ) : (
            <p className="mt-2.5 text-[12px] text-muted-foreground/60">从手机相册选择一张图片作为头像</p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              void onPickFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        {error && <p className="pb-1 pt-2 text-center text-[13px] text-[#FF3B30]">{error}</p>}

        {/* NPC：选择归属 */}
        {isNpc && (
          <>
            <SectionTitle>归属</SectionTitle>
            <button
              type="button"
              onClick={() => setOwnerPickerOpen((v) => !v)}
              aria-label="选择为谁添加NPC"
              className="flex w-full items-center gap-3 rounded-[12px] border border-border/80 bg-background px-3.5 py-3 text-left transition-colors"
            >
              <span className="shrink-0 text-[14px] text-muted-foreground">为谁添加</span>
              <span className={`min-w-0 flex-1 truncate text-right text-[15px] ${owner ? '' : 'text-muted-foreground/50'}`}>
                {owner ? owner.name : '请选择'}
              </span>
              <ChevronRight
                className={`h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform ${ownerPickerOpen ? 'rotate-90' : ''}`}
              />
            </button>
            {ownerPickerOpen && (
              <div className="mt-2 overflow-hidden rounded-[12px] border border-border/80 bg-background">
                {owners.length === 0 && (
                  <p className="px-4 py-3 text-[13px] text-muted-foreground">
                    还没有 CHAR/USER，请先创建一个
                  </p>
                )}
                {owners.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      setOwnerId(o.id);
                      setOwnerPickerOpen(false);
                    }}
                    aria-label={`为${o.name}添加NPC`}
                    className="flex w-full items-center gap-3 border-b border-border/50 px-3.5 py-3 text-left last:border-b-0 active:bg-muted/60"
                  >
                    <Avatar contact={o} size={32} />
                    <span className="min-w-0 flex-1 truncate text-[15px]">{o.name}</span>
                    <span className="text-[12px] uppercase text-muted-foreground/60">{o.kind}</span>
                    {ownerId === o.id && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* 基础信息：昵称在名字上方（QQ/微信显示名），短字段两列平行，关系整行 */}
        <SectionTitle>基础信息</SectionTitle>
        <div className="flex flex-col gap-3.5">
          <BoxField label="昵称">
            <input
              value={form.nickname}
              onChange={(e) => set('nickname')(e.target.value)}
              placeholder="QQ/微信里显示的名字（选填）"
              aria-label="昵称"
              className={boxInputCls}
            />
          </BoxField>
          <BoxField label="名字">
            <input
              value={form.name}
              onChange={(e) => set('name')(e.target.value)}
              placeholder={NAME_PLACEHOLDERS[kind]}
              aria-label="名字"
              className={boxInputCls}
            />
          </BoxField>
          <FieldGrid>
            <BoxField label="性别">
              <GenderPills value={form.gender} onChange={set('gender')} />
            </BoxField>
            <BoxField label="年龄">
              <input value={form.age} onChange={(e) => set('age')(e.target.value)} placeholder="如 22" aria-label="年龄" className={boxInputCls} />
            </BoxField>
            <BoxField label="身高">
              <input value={form.height} onChange={(e) => set('height')(e.target.value)} placeholder="如 175cm" aria-label="身高" className={boxInputCls} />
            </BoxField>
            <BoxField label="体重">
              <input value={form.weight} onChange={(e) => set('weight')(e.target.value)} placeholder="如 60kg" aria-label="体重" className={boxInputCls} />
            </BoxField>
            <BoxField label="职业">
              <input value={form.occupation} onChange={(e) => set('occupation')(e.target.value)} placeholder="如 程序员" aria-label="职业" className={boxInputCls} />
            </BoxField>
            <BoxField label="地区">
              <input value={form.region} onChange={(e) => set('region')(e.target.value)} placeholder="如 上海" aria-label="地区" className={boxInputCls} />
            </BoxField>
          </FieldGrid>
          <BoxField label={isNpc ? '你们的关系' : '关系'}>
            <input
              value={form.relation}
              onChange={(e) => set('relation')(e.target.value)}
              placeholder={isNpc ? '如 同学 / 同事' : '如 朋友 / 家人'}
              aria-label={isNpc ? '你们的关系' : '关系'}
              className={boxInputCls}
            />
          </BoxField>
        </div>

        {/* 人设 / 背景 */}
        <SectionTitle>人设与背景</SectionTitle>
        <div className="flex flex-col gap-3.5">
          <BoxField label="人设">
            <textarea
              value={form.persona}
              onChange={(e) => set('persona')(e.target.value)}
              placeholder="性格、说话方式、身份设定…"
              aria-label="人设"
              rows={4}
              className={`${boxAreaCls} min-h-[110px]`}
            />
            {/* 从手机上传人设文件：毛玻璃按钮，与全 App 按钮风格一致 */}
            <GlassButton
              type="button"
              onClick={() => personaFileRef.current?.click()}
              aria-label="从手机上传人设文件"
              className="mt-2 flex h-[44px] w-full items-center justify-center gap-2 rounded-[12px] text-[14px] font-medium text-foreground/80"
            >
              <FileUp className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              从手机上传人设文件
            </GlassButton>
            {personaFileName && (
              <p className="mt-1.5 px-1 text-[12px] text-muted-foreground">
                已导入「{personaFileName}」，可继续编辑
              </p>
            )}
            <input
              ref={personaFileRef}
              type="file"
              accept=".txt,.md,.markdown,.json,text/plain,text/markdown,application/json"
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                void onPickPersonaFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </BoxField>
          <BoxField label="背景">
            <textarea
              value={form.background}
              onChange={(e) => set('background')(e.target.value)}
              placeholder="经历、家庭、所处环境…"
              aria-label="背景"
              rows={4}
              className={`${boxAreaCls} min-h-[110px]`}
            />
          </BoxField>
        </div>

        {/* 账号信息：ID 可自动生成，密码自己填写并牢记 */}
        <SectionTitle>账号信息</SectionTitle>
        <div className="flex flex-col gap-3.5">
          <GenBoxField label="手机号" value={form.phone} onChange={set('phone')} onGen={() => set('phone')(genPhone())} placeholder="留空自动生成" />
          <GenBoxField label="微信号" value={form.wechatId} onChange={set('wechatId')} onGen={() => set('wechatId')(genWechatId())} placeholder="留空自动生成" />
          <BoxField label="微信密码" required={kind === 'user'}>
            <input value={form.wechatPassword} onChange={(e) => set('wechatPassword')(e.target.value)} placeholder={kind === 'user' ? (editing ? '密码已回显，留空保持不变' : '必填，请牢记密码') : '选填（该角色不用于登录）'} aria-label="微信密码" className={boxInputCls} />
          </BoxField>
          <GenBoxField label="QQ号" value={form.qqId} onChange={set('qqId')} onGen={() => set('qqId')(genQQ())} placeholder="留空自动生成" />
          <BoxField label="QQ密码" required={kind === 'user'}>
            <input value={form.qqPassword} onChange={(e) => set('qqPassword')(e.target.value)} placeholder={kind === 'user' ? (editing ? '密码已回显，留空保持不变' : '必填，请牢记密码') : '选填（该角色不用于登录）'} aria-label="QQ密码" className={boxInputCls} />
          </BoxField>
        </div>
        <p className="px-1 pt-3 text-center text-[12px] leading-[18px] text-muted-foreground/60">
          {editing
            ? kind === 'user'
              ? '手机号 / 微信号 / QQ号 / 密码编辑后按原样保存；USER 密码为必填项，清空密码框视为保持原密码'
              : 'CHAR / NPC 不用于登录，无需填写密码；只改人设、背景等资料可直接保存'
            : '手机号 / 微信号 / QQ号 留空自动生成；USER 的微信密码、QQ密码为必填项，请填写并牢记'}
        </p>
      </div>
    </>
  );
}

// ---------------- 详情 ----------------

function DetailRow({ label, value, block = false }: { label: string; value: string; block?: boolean }) {
  return (
    <div
      className={`flex gap-3 border-b border-border/45 px-4 py-[11px] last:border-b-0 ${
        block ? 'items-start' : 'items-center'
      }`}
    >
      <span className={`w-[88px] shrink-0 text-[13.5px] leading-[20px] text-muted-foreground ${block ? 'pt-[2px]' : ''}`}>
        {label}
      </span>
      <span
        className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-[15px] leading-[22px] ${block ? '' : 'text-right'}`}
      >
        {value}
      </span>
    </div>
  );
}

function DetailView({
  contact,
  ownerName,
  onEdit,
  onBack,
  onDeleted,
}: {
  contact: ContactRecord | null;
  ownerName: string | null;
  onEdit: (id: string) => void;
  onBack: () => void;
  onDeleted: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /** 导出全部资料：全部字段导出为 txt（与列表页「导入」同一格式，可直接回环导入） */
  const exportAll = () => {
    if (!contact) return;
    const pick = (v: string | null | undefined) => (v ?? '').trim();
    const lines: string[] = ['【AI手机联系人】'];
    lines.push(`名字：${pick(contact.name)}`);
    if (pick(contact.nickname)) lines.push(`昵称：${pick(contact.nickname)}`);
    lines.push(`类型：${TABS.find((t) => t.key === contact.kind)?.label ?? 'CHAR'}`);
    const singles: Array<[string, string | null | undefined]> = [
      ['性别', contact.gender],
      ['年龄', contact.age],
      ['身高', contact.height],
      ['体重', contact.weight],
      ['职业', contact.occupation],
      ['地区', contact.region],
      ['关系', contact.relation],
    ];
    for (const [label, v] of singles) {
      const val = pick(v);
      if (val) lines.push(`${label}：${val}`);
    }
    if (contact.kind === 'npc' && ownerName) lines.push(`归属：${ownerName}`);
    const accounts: Array<[string, string | null | undefined]> = [
      ['手机号', contact.phone],
      ['微信号', contact.wechatId],
      ['微信密码', contact.wechatPassword],
      ['QQ号', contact.qqId],
      ['QQ密码', contact.qqPassword],
    ];
    for (const [label, v] of accounts) {
      const val = pick(v);
      if (val) lines.push(`${label}：${val}`);
    }
    const persona = pick(contact.persona);
    const background = pick(contact.background);
    if (persona) lines.push('人设：', persona);
    if (background) lines.push('背景：', background);
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `联系人-${pick(contact.name) || '未命名'}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  useEffect(() => {
    if (!confirming) return;
    const t = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirming]);

  if (!contact) {
    return (
      <>
        <IOSNavBar inline title="详情" left={<BackToHome className="static!" onClick={onBack} />} />
        <div className="flex flex-1 items-center justify-center text-[14px] text-muted-foreground">联系人不存在</div>
      </>
    );
  }

  const kindLabel = TABS.find((t) => t.key === contact.kind)?.label ?? contact.kind;
  const friend = isFriendOf(contact);

  const doDelete = async () => {
    if (!confirming || deleting) return;
    setDeleting(true);
    try {
      const removed = await deleteContact(contact.id);
      if (removed) onDeleted(contact.id);
      else {
        setDeleting(false);
        setConfirming(false);
      }
    } catch {
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <IOSNavBar
        inline
        title={contact.name}
        left={<BackToHome className="static!" onClick={onBack} />}
        right={
          <GlassButton
            type="button"
            onClick={() => onEdit(contact.id)}
            aria-label={`编辑${contact.name}`}
            className="flex h-[30px] items-center rounded-full px-3.5 text-[13.5px] font-medium"
          >
            编辑
          </GlassButton>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {/* 头部：渐变底 + 大头像（ring+阴影）+ 名字 + 类型胶囊 */}
        <div className="relative flex flex-col items-center overflow-hidden pb-5 pt-2">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-[150px] bg-gradient-to-b from-muted/80 to-transparent"
          />
          <span
            className="relative block overflow-hidden rounded-full shadow-[0_10px_28px_rgba(0,0,0,0.16)] ring-[3px] ring-background"
            style={{ width: 108, height: 108 }}
          >
            {contact.avatar ? (
              <img src={contact.avatar} alt={`${contact.name}的头像`} className="h-full w-full object-cover" />
            ) : (
              <DefaultAvatar size={108} />
            )}
          </span>
          <p className="mt-3 text-[24px] font-bold leading-tight">{contact.name}</p>
          <span className="mt-1.5 rounded-full bg-foreground/[0.06] px-3 py-1 text-[11.5px] font-medium text-muted-foreground ring-1 ring-border/50">
            {contact.kind === 'npc'
              ? ownerName
                ? `NPC · ${ownerName}${contact.relation ? ` · ${contact.relation}` : ''}`
                : 'NPC'
              : kindLabel}
          </span>
        </div>

        {/* 未添加好友：虚线引导条（联系人 App 不提供添加/删除按钮，去「信息」App 操作） */}
        {!friend && (
          <div className="px-4 pb-1">
            <div
              className="rounded-[14px] border-[1.5px] border-dashed border-foreground/30 bg-muted/25 px-4 py-3 text-center"
              role="note"
              aria-label="还未添加好友"
            >
              <p className="text-[13.5px] font-medium text-foreground/80">还未添加好友</p>
              <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                打开「信息」App › 右上角「+」› 输入手机号 {contact.phone ?? '（未设置）'} 添加或删除
              </p>
            </div>
          </div>
        )}

        <div className="pb-3 pt-3" />
        <CardGroup
          title="基本信息"
          icon={<UserRound className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
        >
          {contact.nickname?.trim() && <DetailRow label="昵称" value={contact.nickname.trim()} />}
          {contact.gender && <DetailRow label="性别" value={contact.gender} />}
          {contact.age && <DetailRow label="年龄" value={contact.age} />}
          {contact.height && <DetailRow label="身高" value={contact.height} />}
          {contact.weight && <DetailRow label="体重" value={contact.weight} />}
          {contact.occupation && <DetailRow label="职业" value={contact.occupation} />}
          {contact.region && <DetailRow label="地区" value={contact.region} />}
          {contact.relation && (
            <DetailRow label={contact.kind === 'npc' ? '你们的关系' : '关系'} value={contact.relation} />
          )}
          {!contact.gender &&
            !contact.age &&
            !contact.height &&
            !contact.weight &&
            !contact.occupation &&
            !contact.region &&
            !contact.relation && (
              <p className="px-4 py-3 text-[13px] text-muted-foreground/60">未填写基础信息</p>
            )}
        </CardGroup>

        {(contact.persona || contact.background) && (
          <>
            <div className="pb-3 pt-3" />
            <CardGroup
              title="人设与背景"
              icon={<BookOpen className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
            >
              {contact.persona && <DetailRow label="人设" value={contact.persona} block />}
              {contact.background && <DetailRow label="背景" value={contact.background} block />}
            </CardGroup>
          </>
        )}

        <div className="pb-3 pt-3" />
        <CardGroup
          title="账号信息"
          icon={<Phone className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
        >
          {contact.phone && <DetailRow label="手机号" value={contact.phone} />}
          {contact.wechatId && <DetailRow label="微信号" value={contact.wechatId} />}
          {contact.wechatPassword && <DetailRow label="微信密码" value={contact.wechatPassword} />}
          {contact.qqId && <DetailRow label="QQ号" value={contact.qqId} />}
          {contact.qqPassword && <DetailRow label="QQ密码" value={contact.qqPassword} />}
          {!contact.phone && !contact.wechatId && !contact.qqId && (
            <p className="px-4 py-3 text-[13px] text-muted-foreground/60">未生成账号信息</p>
          )}
        </CardGroup>

        {/* 导出全部资料：全部字段导出为 txt（与列表页「导入」同格式，可回环恢复） */}
        <div className="px-4 pt-5">
          <GlassButton
            type="button"
            onClick={exportAll}
            aria-label={`导出${contact.name}的全部资料`}
            className="flex h-[48px] w-full items-center justify-center gap-2 rounded-[16px] text-[15.5px] font-semibold"
          >
            <FileDown className="h-[18px] w-[18px]" strokeWidth={2.1} aria-hidden="true" />
            导出全部资料
          </GlassButton>
          <p className="pt-1.5 text-center text-[12px] text-muted-foreground/60">
            含名字、类型、基本信息、账号与人设背景，可到列表页右上角「导入」恢复
          </p>
        </div>

        {/* 删除（二次确认）：仅已添加好友的联系人可在这里删除；
            未添加好友按规则只能在「信息」App ›「+」里删除 */}
        {friend && (
          <div className="px-4 pt-4">
            <GlassButton
              variant="danger"
              type="button"
              onClick={() => {
                if (!confirming) setConfirming(true);
                else void doDelete();
              }}
              aria-label={confirming ? '确认删除联系人' : '删除联系人'}
              className={`flex h-[50px] w-full items-center justify-center gap-2 rounded-[16px] text-[16px] font-semibold ${
                confirming ? 'bg-[#FF453A]/[0.20] shadow-[0_6px_18px_rgba(255,69,58,0.18)]' : ''
              }`}
            >
              <Trash2 className="h-[18px] w-[18px]" strokeWidth={2.1} aria-hidden="true" />
              {deleting ? '删除中…' : confirming ? '再点一次确认删除' : '删除联系人'}
            </GlassButton>
            {confirming && !deleting && (
              <p className="pt-2 text-center text-[12px] text-muted-foreground">
                删除后无法恢复
                {contact.kind !== 'npc' ? '，其名下 NPC 会一并删除' : ''}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** 详情分组卡片：带小标题 + 图标（与信息 App 视觉一致）；action = 标题行右侧操作（如「导出人设」） */
function CardGroup({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-4">
      <div className="mb-1.5 flex items-center gap-1.5 px-1.5 text-[12px] font-semibold tracking-wide text-muted-foreground/80">
        {icon}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {action}
      </div>
      <div className="overflow-hidden rounded-[18px] bg-muted/40 ring-1 ring-border/45">{children}</div>
    </div>
  );
}
