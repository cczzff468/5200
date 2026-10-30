'use client';

/**
 * 自定义 CSS 编辑器（第六十五轮首建 · 第六十九轮重设计 · 第七十轮按联系人隔离）—— 三处入口共用一套编辑器
 * ---------------------------------------------------------------------------
 * - 主题界面（个性装扮 › 主题 Tab 最底部）：scope='global'，作用于整个手机；
 * - 联系人聊天设置（折叠区块「自定义CSS」，紧跟显示设置之后）：scope=`chat:wx:联系人ID` / `chat:qq:联系人ID`，
 *   只作用于当前联系人的聊天界面（每个联系人一套，互不影响；第七十轮由按 App 升级为按联系人）；
 * - 线下模式 › 现场设置（「自定义CSS」卡片）：scope='offline'，只作用于线下所有界面。
 *
 * 第六十九轮：代码窗口造型 + 扁平方案列表（简约美观）。
 * 第七十轮：示例每作用域只留一个；聊天 CSS 按联系人隔离。
 * 第七十一轮（用户指定「要模板不要主题，把界面上所有东西都列出来」）：
 * - 「示例主题」chips → 一枚「填入完整模板」按钮，点按把该界面的完整元素清单填进编辑框
 *   （背景/顶栏/底栏/气泡/尾巴/时间/输入栏/状态栏/面板/按钮…逐段列出，微信/QQ 各按 App 样式）；
 * - 每段默认值 = 当前样式 → 不改直接应用 ≈ 没变化，用户改哪段哪段生效。
 */
import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, ChevronRight, Code2, Eraser, FileUp, LayoutTemplate, Play, Trash2 } from 'lucide-react';
import {
  CUSTOM_CSS_MAX_LEN,
  CUSTOM_CSS_NAME_MAX,
  chatCssScope,
  chatCssTemplate,
  readCustomCssActive,
  type CustomCssScope,
  type CustomCssScheme,
  type CssTemplate,
} from '@/lib/ios/custom-css';
import { useSettings } from '@/lib/ios/store';

/** 作用域元信息（说明文字 + 代码窗口文件名）；第七十轮：聊天作用域是动态 key（chat:app:联系人ID），改函数取 */
function scopeMeta(scope: CustomCssScope): { title: string; hint: string; file: string } {
  if (scope === 'global') {
    return { title: '自定义 CSS', hint: '作用于整个手机：所有界面、面板、按钮（含线下模式）', file: 'phone.css' };
  }
  if (scope === 'offline') {
    return { title: '自定义 CSS', hint: '只改线下模式的所有界面和按钮', file: 'offline.css' };
  }
  if (scope.startsWith('chat:qq:')) {
    return { title: '自定义 CSS', hint: '只改这个联系人的 QQ 聊天界面，其他联系人与界面不受影响', file: 'chat-qq.css' };
  }
  return { title: '自定义 CSS', hint: '只改这个联系人的微信聊天界面，其他联系人与界面不受影响', file: 'chat-wx.css' };
}

export interface CustomCssEditorProps {
  scope: CustomCssScope;
  /** 完整模板（一键填入编辑框：逐段列出该界面所有能改的元素，用户改值） */
  template: CssTemplate;
  /** 主色（按钮/选中态） */
  accent: string;
  /** 弹提示 */
  onToast: (m: string) => void;
  /** 嵌入环境视觉变体：card=独立卡（主题页/线下设置用）；chat=聊天设置折叠区块内容（无外框） */
  variant?: 'card' | 'chat';
}

/** 单个作用域的编辑器本体（状态读写都走 useSettings.customCss；聊天作用域按联系人隔离） */
export function CustomCssEditor({ scope, template, accent, onToast, variant = 'card' }: CustomCssEditorProps) {
  const meta = scopeMeta(scope);
  // 统一读取：global/offline 独立字段，chat:app:id → chats[联系人key]（第七十轮）
  const activeCss = useSettings((s) => readCustomCssActive(s.customCss, scope));
  const schemes = useSettings((s) => s.customCss.schemes);
  const setActive = useSettings((s) => s.setCustomCssActive);
  const setSchemes = useSettings((s) => s.setCustomCssSchemes);

  /** 编辑框草稿（打开时带入当前已应用的 CSS；应用/清除/填入方案时同步更新） */
  const [draft, setDraft] = useState(activeCss);
  /** 保存方案命名行 */
  const [nameDraft, setNameDraft] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const mineSchemes = schemes.filter((s) => s.scope === scope);
  const dirty = draft !== activeCss;

  const apply = () => {
    const v = draft.trim().slice(0, CUSTOM_CSS_MAX_LEN);
    setActive(scope, v);
    setDraft(v);
    onToast(v ? '自定义 CSS 已应用' : '自定义 CSS 已清空');
  };

  const clearAll = () => {
    setActive(scope, '');
    setDraft('');
    onToast('已清除，恢复默认样式');
  };

  const loadTemplate = () => {
    setDraft(template.css);
    onToast('已填入完整模板，改好点「应用」');
  };

  const onFile = (f: File | null | undefined) => {
    if (!f) return;
    if (f.size > 512 * 1024) {
      onToast('文件太大（上限 512KB）');
      return;
    }
    void f
      .text()
      .then((text) => {
        const v = text.slice(0, CUSTOM_CSS_MAX_LEN);
        setDraft(v);
        onToast(`已导入「${f.name}」，点「应用」生效`);
      })
      .catch(() => onToast('读取文件失败，请重试'));
  };

  const saveScheme = () => {
    const body = draft.trim();
    if (!body) {
      onToast('先写点 CSS 再保存');
      return;
    }
    const name = nameDraft.trim().slice(0, CUSTOM_CSS_NAME_MAX) || `我的主题 ${mineSchemes.length + 1}`;
    const scheme: CustomCssScheme = {
      id: `css-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      css: body,
      scope,
      createdAt: Date.now(),
    };
    setSchemes([scheme, ...schemes]);
    setNameDraft('');
    onToast(`已保存「${name}」`);
  };

  const applyScheme = (s: CustomCssScheme) => {
    setActive(scope, s.css);
    setDraft(s.css);
    onToast(`已应用「${s.name}」`);
  };

  const removeScheme = (s: CustomCssScheme) => {
    setSchemes(schemes.filter((x) => x.id !== s.id));
    onToast(`已删除「${s.name}」`);
  };

  const shellCls =
    variant === 'card'
      ? 'rounded-[20px] bg-white/70 p-4 backdrop-blur-xl ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:ring-white/[0.10]'
      : 'px-3.5 pb-3';

  return (
    <div className={shellCls} data-testid={`custom-css-editor-${scope}`} data-scope={scope}>
      {/* 标题行：图标 + 标题/说明 + 已应用徽标 */}
      <div className="flex items-center gap-2.5">
        <span
          className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[10px]"
          style={{ backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}
          aria-hidden="true"
        >
          <Code2 className="h-[15px] w-[15px]" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-semibold leading-tight text-black/85 dark:text-white/90">{meta.title}</p>
          <p className="mt-[2px] truncate text-[11.5px] leading-[1.45] text-black/40 dark:text-white/40">{meta.hint}</p>
        </div>
        {activeCss ? (
          <span
            className="flex shrink-0 items-center gap-1 rounded-full px-2 py-[3px] text-[10.5px] font-medium"
            style={{ backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}
          >
            <Check className="h-[10px] w-[10px]" strokeWidth={3} aria-hidden="true" />
            已应用
          </span>
        ) : null}
      </div>

      {/* 代码窗口：窗口栏（红黄绿圆点 + 文件名 + 未应用小圆点/字数）+ 编辑区 */}
      <div className="mt-3 overflow-hidden rounded-[14px] ring-1 ring-black/[0.08] focus-within:ring-[1.5px] focus-within:ring-black/30 dark:ring-white/[0.12] dark:focus-within:ring-white/35">
        <div className="flex items-center gap-2 border-b border-black/[0.06] bg-black/[0.03] px-3 py-[7px] dark:border-white/[0.08] dark:bg-white/[0.04]">
          <span className="flex gap-[5px]" aria-hidden="true">
            <i className="h-[9px] w-[9px] rounded-full bg-[#FF5F57]/80" />
            <i className="h-[9px] w-[9px] rounded-full bg-[#FEBC2E]/80" />
            <i className="h-[9px] w-[9px] rounded-full bg-[#28C840]/80" />
          </span>
          <span className="font-mono text-[11px] text-black/40 dark:text-white/40">{meta.file}</span>
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-[10.5px] tabular-nums text-black/35 dark:text-white/35">
            {dirty ? (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <i className="h-[6px] w-[6px] rounded-full bg-current" aria-hidden="true" />
                未应用
              </span>
            ) : null}
            {draft.length.toLocaleString()} / {CUSTOM_CSS_MAX_LEN.toLocaleString()}
          </span>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, CUSTOM_CSS_MAX_LEN))}
          spellCheck={false}
          rows={10}
          placeholder={'/* 在这里写 CSS，或点下面填入完整模板 */'}
          aria-label={`自定义 CSS 编辑框（${meta.title}）`}
          data-testid={`custom-css-textarea-${scope}`}
          className="block w-full resize-y bg-[#FCFBF8] px-3.5 py-3 font-mono text-[12px] leading-[1.7] text-black/85 outline-none placeholder:text-black/25 dark:bg-[#151517] dark:text-white/85 dark:placeholder:text-white/25"
        />
      </div>

      {/* 完整模板（第七十一轮）：一键填入该界面的元素清单——每段 = 一处，改值即换样式 */}
      <button
        type="button"
        onClick={loadTemplate}
        aria-label={`填入${template.name}`}
        data-testid={`custom-css-example-${scope}`}
        className="mt-3 flex w-full items-center gap-2.5 rounded-[13px] border border-black/[0.08] bg-white/60 px-3 py-2.5 text-left transition-colors active:bg-black/[0.06] dark:border-white/[0.10] dark:bg-white/[0.06] dark:active:bg-white/[0.10]"
      >
        <span
          className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[10px]"
          style={{ backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}
          aria-hidden="true"
        >
          <LayoutTemplate className="h-[15px] w-[15px]" strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold leading-tight text-black/80 dark:text-white/85">{template.name}</span>
          <span className="mt-[2px] block truncate text-[11px] leading-[1.4] text-black/40 dark:text-white/40">{template.desc}，点按填入</span>
        </span>
        <ChevronRight className="h-[16px] w-[16px] shrink-0 text-black/25 dark:text-white/25" aria-hidden="true" />
      </button>

      {/* 上传 CSS 文件（.css） */}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        data-testid={`custom-css-upload-${scope}`}
        className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-black/[0.15] text-[12.5px] font-medium text-black/45 transition-colors active:bg-black/[0.04] dark:border-white/[0.16] dark:text-white/45 dark:active:bg-white/[0.06]"
      >
        <FileUp className="h-[14px] w-[14px]" aria-hidden="true" />
        上传 CSS 文件
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".css,text/css"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {/* 保存方案（自定义名字） */}
      <div className="mt-2.5 flex gap-2">
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          maxLength={CUSTOM_CSS_NAME_MAX}
          placeholder="给这套主题起个名字…"
          aria-label="方案名称"
          data-testid={`custom-css-name-${scope}`}
          className="h-9 min-w-0 flex-1 rounded-[12px] border border-black/[0.08] bg-white px-3 text-[12.5px] text-black outline-none placeholder:text-black/25 focus:border-black/30 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-white dark:placeholder:text-white/25 dark:focus:border-white/35"
        />
        <button
          type="button"
          onClick={saveScheme}
          disabled={!draft.trim()}
          data-testid={`custom-css-save-${scope}`}
          className="h-9 shrink-0 rounded-[12px] px-4 text-[12.5px] font-semibold text-white transition-transform active:scale-95 disabled:opacity-40"
          style={{ backgroundColor: accent }}
        >
          保存
        </button>
      </div>

      {/* 已保存方案列表（本作用域，扁平细线风格） */}
      {mineSchemes.length > 0 ? (
        <div className="mt-2.5">
          <p className="px-0.5 pb-1 text-[11px] text-black/35 dark:text-white/35">我的方案</p>
          <ul className="divide-y divide-black/[0.05] dark:divide-white/[0.07]">
            {mineSchemes.map((s) => {
              const active = s.css === activeCss;
              return (
                <li
                  key={s.id}
                  data-testid={`custom-css-scheme-${scope}`}
                  className="flex items-center gap-1 py-[7px]"
                >
                  <i
                    className="h-[6px] w-[6px] shrink-0 rounded-full"
                    style={{ backgroundColor: active ? accent : 'transparent', boxShadow: active ? 'none' : 'inset 0 0 0 1.5px rgba(127,127,127,0.4)' }}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(s.css);
                      onToast(`已把「${s.name}」填入编辑框`);
                    }}
                    className="min-w-0 flex-1 py-0.5 text-left"
                    title="点按填入编辑框"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-black/80 dark:text-white/85">{s.name}</span>
                      {active ? (
                        <span
                          className="shrink-0 rounded-full px-1.5 py-[1px] text-[9.5px] font-semibold"
                          style={{ backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}
                        >
                          应用中
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-[1px] block truncate text-[10.5px] tabular-nums text-black/35 dark:text-white/35">
                      {s.css.split('\n').length} 行 · {s.css.length.toLocaleString()} 字符
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`应用 ${s.name}`}
                    title="直接应用"
                    onClick={() => applyScheme(s)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] transition-colors active:bg-black/[0.06] dark:active:bg-white/[0.08]"
                    style={{ color: accent }}
                  >
                    <Play className="h-[14px] w-[14px]" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`删除 ${s.name}`}
                    title="删除"
                    onClick={() => removeScheme(s)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-black/30 transition-colors active:bg-[#FF3B30]/12 active:text-[#FF3B30] dark:text-white/35 dark:active:text-[#FF6B6B]"
                  >
                    <Trash2 className="h-[14px] w-[14px]" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="mt-2.5 px-0.5 text-[11.5px] leading-[1.5] text-black/30 dark:text-white/30">
          保存的主题会出现在这里，随时一键换装。
        </p>
      )}

      {/* 底部两枚主按钮：应用 / 清除 */}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={apply}
          data-testid={`custom-css-apply-${scope}`}
          className="flex h-11 items-center justify-center gap-1.5 rounded-[14px] text-[14.5px] font-semibold text-white shadow-sm transition-transform active:scale-[0.97] disabled:opacity-40"
          style={{ backgroundColor: accent, boxShadow: `0 4px 14px color-mix(in srgb, ${accent} 35%, transparent)` }}
        >
          <Play className="h-[15px] w-[15px]" aria-hidden="true" />
          应用
        </button>
        <button
          type="button"
          onClick={clearAll}
          disabled={!activeCss && !draft}
          data-testid={`custom-css-clear-${scope}`}
          className="flex h-11 items-center justify-center gap-1.5 rounded-[14px] bg-black/[0.04] text-[14.5px] font-semibold text-black/55 ring-1 ring-black/[0.06] transition-colors active:bg-black/[0.08] disabled:opacity-40 dark:bg-white/[0.06] dark:text-white/60 dark:ring-white/[0.08] dark:active:bg-white/[0.10]"
        >
          <Eraser className="h-[15px] w-[15px]" aria-hidden="true" />
          清除
        </button>
      </div>
    </div>
  );
}

// ================= 聊天设置折叠区块（镜像 ChatDisplaySection 的展开交互） =================

export interface ChatCssSectionProps {
  /** 宿主 App（决定作用域与示例主题） */
  app: 'wx' | 'qq';
  /** 当前联系人 ID（第七十轮：聊天 CSS 按联系人隔离，每个联系人一套） */
  contactId: string;
  /** 宿主强调色（微信绿 / QQ 蓝） */
  accent: string;
  /** 弹提示 */
  onToast: (m: string) => void;
}

/** 聊天设置页的「自定义 CSS」折叠区块：只改当前联系人的聊天界面（其他联系人不受影响） */
export function ChatCssSection({ app, contactId, accent, onToast }: ChatCssSectionProps) {
  const [open, setOpen] = useState(false);
  const scope = chatCssScope(app, contactId);
  const activeCss = useSettings((s) => readCustomCssActive(s.customCss, scope));

  return (
    <div className="mt-3 overflow-hidden rounded-[10px] bg-white dark:bg-[#1A1A1A]" data-testid={`chat-css-section-${app}`}>
      {/* 折叠标题行 */}
      <button
        type="button"
        aria-expanded={open}
        data-testid={`chat-css-header-${app}`}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-[16px] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
      >
        <span>自定义CSS</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={`max-w-[130px] truncate text-[13.5px] ${activeCss ? 'text-black/55 dark:text-white/60' : 'text-black/35 dark:text-white/35'}`}
          >
            {activeCss ? '已应用' : '未应用'}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`h-[18px] w-[18px] shrink-0 text-black/25 transition-transform duration-300 dark:text-white/25 ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-1">
              <CustomCssEditor
                scope={scope}
                template={chatCssTemplate(app)}
                accent={accent}
                onToast={onToast}
                variant="chat"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
