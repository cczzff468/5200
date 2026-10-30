'use client';

/**
 * 自定义 CSS 编辑器（第六十五轮首建 · 第六十九轮美化 · 第七十轮按联系人隔离 · 第七十二轮极简化）
 * ---------------------------------------------------------------------------
 * 三处入口共用一套编辑器：
 * - 主题界面（个性装扮 › 主题 Tab 最底部）：scope='global'，作用于整个手机；
 * - 联系人聊天设置（折叠区块「自定义CSS」）：scope=`chat:wx:联系人ID` / `chat:qq:联系人ID`；
 * - 线下模式 › 现场设置：scope='offline'。
 *
 * 第七十二轮（用户截图指定的极简样式）：
 * - 结构极简三段式：一行说明文字 + 大代码框 + 底部一排按钮
 *   （保存 · 打开 · 示例 · 清除 · 应用，iOS 灰底圆角按钮）；
 * - 「示例 / 打开 / 保存」点开 iOS 底部弹层（portal 进手机壳内，不遮手机外）；
 * - 模板升级为数组：聊天作用域同时提供「界面完整模板」+「卡片模板」
 *   （红包 / 转账 / 亲属卡 / 礼物 / 代付 / 外卖 / 标签 / 圆角全可改）。
 */
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  Eraser,
  FileUp,
  FolderOpen,
  LayoutTemplate,
  Play,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import {
  CUSTOM_CSS_MAX_LEN,
  CUSTOM_CSS_NAME_MAX,
  chatCssScope,
  chatCssTemplates,
  readCustomCssActive,
  type CustomCssScope,
  type CustomCssScheme,
  type CssTemplate,
} from '@/lib/ios/custom-css';
import { useSettings } from '@/lib/ios/store';

/** 作用域元信息（说明文字；聊天作用域是动态 key（chat:app:联系人ID）） */
function scopeMeta(scope: CustomCssScope): { title: string; hint: string } {
  if (scope === 'global') {
    return { title: '自定义 CSS', hint: '在此输入 CSS 自定义整台手机的样式（页面、面板、按钮、状态栏等）。联系人单独设置的聊天 CSS 优先级更高。' };
  }
  if (scope === 'offline') {
    return { title: '自定义 CSS', hint: '在此输入 CSS 自定义线下模式的所有界面和按钮（开始页、见面页、存档、现场设置）。' };
  }
  if (scope.startsWith('chat:qq:')) {
    return { title: '自定义 CSS', hint: '在此输入 CSS 自定义这个联系人的 QQ 聊天页面（气泡、红包转账、外卖卡片等）。其他联系人与界面不受影响。' };
  }
  return { title: '自定义 CSS', hint: '在此输入 CSS 自定义这个联系人的微信聊天页面（气泡、红包转账、外卖卡片等）。其他联系人与界面不受影响。' };
}

// ================= 手机内底部弹层（portal 进手机壳，遮罩只盖手机屏幕） =================

/** 把弹层渲染进手机壳根节点（[data-phone-shell]）——不受宿主页 overflow 裁剪、不遮手机外的浏览器。
 *  惰性取宿主节点：弹层只会在用户点按后打开（SSR/水合阶段永远不渲染），此时手机壳必然已挂载 */
function PhonePortal({ children }: { children: ReactNode }) {
  const [host] = useState<HTMLElement | null>(() =>
    typeof document === 'undefined' ? null : document.querySelector('[data-phone-shell]'),
  );
  if (!host) return null;
  return createPortal(children, host);
}

/** iOS 风格底部弹层：顶部标题 + 关闭钮，内容区滚动（最大 62vh） */
function ActionSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <PhonePortal>
      <div className="absolute inset-0 z-[92]" role="dialog" aria-modal="true" aria-label={title}>
        <motion.div
          className="absolute inset-0 bg-black/40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          aria-hidden="true"
        />
        <motion.div
          className="absolute inset-x-0 bottom-0 overflow-hidden rounded-t-[22px] bg-[#F6F6F8] shadow-[0_-10px_44px_rgba(0,0,0,0.24)] dark:bg-[#1C1C1E]"
          initial={{ y: '104%' }}
          animate={{ y: 0 }}
          exit={{ y: '104%' }}
          transition={{ duration: 0.34, ease: [0.32, 0.72, 0, 1] }}
        >
          {/* 小灰条（iOS 抓手） */}
          <div className="flex justify-center pt-2" aria-hidden="true">
            <span className="h-[5px] w-9 rounded-full bg-black/15 dark:bg-white/20" />
          </div>
          <div className="flex items-center justify-between px-4 pb-1 pt-1.5">
            <p className="text-[16px] font-semibold text-black/85 dark:text-white/90">{title}</p>
            <button
              type="button"
              aria-label="关闭"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-full bg-black/[0.06] transition-colors active:bg-black/[0.12] dark:bg-white/[0.10] dark:active:bg-white/[0.16]"
            >
              <X className="h-[15px] w-[15px] text-black/55 dark:text-white/60" aria-hidden="true" />
            </button>
          </div>
          <div className="max-h-[62vh] overflow-y-auto px-3 pb-6 pt-1.5">{children}</div>
        </motion.div>
      </div>
    </PhonePortal>
  );
}

// ================= 编辑器本体 =================

export interface CustomCssEditorProps {
  scope: CustomCssScope;
  /** 示例模板组（界面完整模板 + 卡片模板…，「示例」弹层按此列出） */
  templates: CssTemplate[];
  /** 主色（应用按钮/选中态） */
  accent: string;
  /** 弹提示 */
  onToast: (m: string) => void;
  /** 嵌入环境视觉变体：card=独立卡（主题页/线下设置用）；chat=聊天设置折叠区块内容（无外框） */
  variant?: 'card' | 'chat';
}

/** 单个作用域的编辑器（状态读写都走 useSettings.customCss；聊天作用域按联系人隔离） */
export function CustomCssEditor({ scope, templates, accent, onToast, variant = 'card' }: CustomCssEditorProps) {
  const meta = scopeMeta(scope);
  const activeCss = useSettings((s) => readCustomCssActive(s.customCss, scope));
  const schemes = useSettings((s) => s.customCss.schemes);
  const setActive = useSettings((s) => s.setCustomCssActive);
  const setSchemes = useSettings((s) => s.setCustomCssSchemes);

  /** 编辑框草稿（打开时带入当前已应用的 CSS） */
  const [draft, setDraft] = useState(activeCss);
  /** 保存方案命名 */
  const [nameDraft, setNameDraft] = useState('');
  /** 底部弹层：presets=示例模板 schemes=我的方案 save=保存命名 */
  const [sheet, setSheet] = useState<null | 'presets' | 'schemes' | 'save'>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const mineSchemes = schemes.filter((s) => s.scope === scope);
  const dirty = draft !== activeCss;
  const closeSheet = () => setSheet(null);

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

  const onFile = (f: File | null | undefined) => {
    if (!f) return;
    if (f.size > 512 * 1024) {
      onToast('文件太大（上限 512KB）');
      return;
    }
    void f
      .text()
      .then((text) => {
        setDraft(text.slice(0, CUSTOM_CSS_MAX_LEN));
        closeSheet();
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
    closeSheet();
    onToast(`已保存「${name}」，在「打开」里随时取用`);
  };

  const shellCls =
    variant === 'card'
      ? 'rounded-[20px] bg-white/70 p-4 backdrop-blur-xl ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:ring-white/[0.10]'
      : 'px-3.5 pb-3.5';

  // 灰底圆角按钮（截图同款 iOS 简约按钮）
  const grayBtn =
    'flex h-11 items-center justify-center gap-1.5 rounded-[12px] bg-black/[0.05] text-[14.5px] font-medium text-black/70 ring-1 ring-black/[0.04] transition-colors active:bg-black/[0.11] dark:bg-white/[0.08] dark:text-white/75 dark:ring-white/[0.06] dark:active:bg-white/[0.14] disabled:opacity-35';

  return (
    <div className={shellCls} data-testid={`custom-css-editor-${scope}`} data-scope={scope}>
      {/* 说明文字 */}
      <p className="px-1 text-[12.5px] leading-[1.6] text-black/40 dark:text-white/40">{meta.hint}</p>

      {/* 代码编辑框：大输入区 + 底部状态行（字数 / 应用状态） */}
      <div className="mt-2.5 overflow-hidden rounded-[12px] border border-black/[0.08] bg-black/[0.025] focus-within:border-black/[0.22] dark:border-white/[0.10] dark:bg-white/[0.05] dark:focus-within:border-white/[0.28]">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, CUSTOM_CSS_MAX_LEN))}
          spellCheck={false}
          rows={11}
          placeholder={'/* 在这里输入 CSS，或点「示例」填入模板 */'}
          aria-label={`自定义 CSS 编辑框（${meta.title}）`}
          data-testid={`custom-css-textarea-${scope}`}
          className="block min-h-[210px] w-full resize-y bg-transparent px-3.5 py-3 font-mono text-[12.5px] leading-[1.75] text-black/85 outline-none placeholder:text-black/25 dark:text-white/85 dark:placeholder:text-white/25"
        />
        <div className="flex items-center justify-between border-t border-black/[0.06] px-3 py-[5px] dark:border-white/[0.07]">
          <span className="text-[10.5px] tabular-nums text-black/30 dark:text-white/30">
            {draft.length.toLocaleString()} / {CUSTOM_CSS_MAX_LEN.toLocaleString()}
          </span>
          {dirty ? (
            <span className="flex items-center gap-1 text-[10.5px] font-medium text-amber-600 dark:text-amber-400">
              <i className="h-[6px] w-[6px] rounded-full bg-current" aria-hidden="true" />
              未应用
            </span>
          ) : activeCss ? (
            <span className="flex items-center gap-1 text-[10.5px] font-medium" style={{ color: accent }}>
              <Check className="h-[11px] w-[11px]" strokeWidth={3} aria-hidden="true" />
              已应用
            </span>
          ) : (
            <span className="text-[10.5px] text-black/30 dark:text-white/30">未应用</span>
          )}
        </div>
      </div>

      {/* 底部按钮栏：保存 · 打开 · 示例 · 清除 · 应用（截图同款一排五个） */}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          aria-label="保存方案"
          title="保存方案"
          onClick={() => setSheet('save')}
          disabled={!draft.trim()}
          data-testid={`custom-css-save-${scope}`}
          className={`${grayBtn} w-11 shrink-0 p-0`}
        >
          <Save className="h-[17px] w-[17px]" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="打开方案"
          title="打开 / 上传方案"
          onClick={() => setSheet('schemes')}
          data-testid={`custom-css-open-${scope}`}
          className={`${grayBtn} w-11 shrink-0 p-0`}
        >
          <FolderOpen className="h-[17px] w-[17px]" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setSheet('presets')}
          data-testid={`custom-css-example-${scope}`}
          className={`${grayBtn} flex-1`}
        >
          示例
        </button>
        <button
          type="button"
          onClick={clearAll}
          disabled={!activeCss && !draft}
          data-testid={`custom-css-clear-${scope}`}
          className={`${grayBtn} flex-1`}
        >
          <Eraser className="h-[15px] w-[15px]" aria-hidden="true" />
          清除
        </button>
        <button
          type="button"
          onClick={apply}
          data-testid={`custom-css-apply-${scope}`}
          className="flex h-11 flex-[1.25] items-center justify-center gap-1.5 rounded-[12px] text-[14.5px] font-semibold text-white transition-transform active:scale-[0.97] disabled:opacity-40"
          style={{ backgroundColor: accent }}
        >
          <Play className="h-[15px] w-[15px]" aria-hidden="true" />
          应用
        </button>
      </div>

      {/* 隐藏的文件选择（「打开」弹层里点「上传 CSS 文件」触发） */}
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

      {/* ───── 底部弹层：示例模板 / 我的方案 / 保存命名 ───── */}
      <AnimatePresence>
        {sheet === 'presets' ? (
          <ActionSheet key="presets" title="示例模板" onClose={closeSheet}>
            <p className="px-1 pb-2 text-[12px] leading-[1.55] text-black/40 dark:text-white/40">
              点按填入编辑框——模板列出所有能改的地方，把值换成你想要的，改好点「应用」。
            </p>
            {templates.map((t, i) => (
              <button
                key={t.name}
                type="button"
                data-testid={`custom-css-tpl-${scope}-${i}`}
                onClick={() => {
                  setDraft(t.css);
                  closeSheet();
                  onToast(`已填入「${t.name}」，改好点「应用」`);
                }}
                className="mb-2 flex w-full items-center gap-3 rounded-[14px] bg-white px-3 py-3 text-left ring-1 ring-black/[0.05] transition-colors active:bg-black/[0.04] dark:bg-white/[0.07] dark:ring-white/[0.08] dark:active:bg-white/[0.11]"
              >
                <span
                  className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px]"
                  style={{ backgroundColor: `color-mix(in srgb, ${accent} 13%, transparent)`, color: accent }}
                  aria-hidden="true"
                >
                  <LayoutTemplate className="h-[16px] w-[16px]" strokeWidth={2.1} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold leading-tight text-black/85 dark:text-white/90">{t.name}</span>
                  <span className="mt-[3px] block truncate text-[11.5px] leading-[1.45] text-black/40 dark:text-white/40">{t.desc}</span>
                </span>
                <span className="shrink-0 text-[10.5px] tabular-nums text-black/30 dark:text-white/30">{t.css.split('\n').length} 行</span>
              </button>
            ))}
          </ActionSheet>
        ) : null}

        {sheet === 'schemes' ? (
          <ActionSheet key="schemes" title="我的方案" onClose={closeSheet}>
            {/* 上传 CSS 文件 */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              data-testid={`custom-css-upload-${scope}`}
              className="mb-2 flex h-11 w-full items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-black/[0.16] text-[12.5px] font-medium text-black/45 transition-colors active:bg-black/[0.04] dark:border-white/[0.18] dark:text-white/45 dark:active:bg-white/[0.06]"
            >
              <FileUp className="h-[14px] w-[14px]" aria-hidden="true" />
              上传 CSS 文件
            </button>

            {mineSchemes.length > 0 ? (
              mineSchemes.map((s) => {
                const active = s.css === activeCss;
                return (
                  <div
                    key={s.id}
                    data-testid={`custom-css-scheme-${scope}`}
                    className="mb-2 flex items-center gap-2 rounded-[14px] bg-white px-3 py-2.5 ring-1 ring-black/[0.05] dark:bg-white/[0.07] dark:ring-white/[0.08]"
                  >
                    <i
                      className="h-[7px] w-[7px] shrink-0 rounded-full"
                      style={{ backgroundColor: active ? accent : 'transparent', boxShadow: active ? 'none' : 'inset 0 0 0 1.5px rgba(127,127,127,0.4)' }}
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(s.css);
                        closeSheet();
                        onToast(`已把「${s.name}」填入编辑框`);
                      }}
                      className="min-w-0 flex-1 py-0.5 text-left"
                      title="点按填入编辑框"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[14px] font-medium text-black/85 dark:text-white/90">{s.name}</span>
                        {active ? (
                          <span
                            className="shrink-0 rounded-full px-1.5 py-[1px] text-[9.5px] font-semibold"
                            style={{ backgroundColor: `color-mix(in srgb, ${accent} 13%, transparent)`, color: accent }}
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
                      aria-label={`删除 ${s.name}`}
                      title="删除"
                      onClick={() => {
                        setSchemes(schemes.filter((x) => x.id !== s.id));
                        onToast(`已删除「${s.name}」`);
                      }}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-black/30 transition-colors active:bg-[#FF3B30]/12 active:text-[#FF3B30] dark:text-white/35 dark:active:text-[#FF6B6B]"
                    >
                      <Trash2 className="h-[15px] w-[15px]" aria-hidden="true" />
                    </button>
                  </div>
                );
              })
            ) : (
              <p className="px-1 pb-1 pt-2 text-center text-[12.5px] leading-[1.6] text-black/35 dark:text-white/35">
                还没有保存过方案——写好 CSS 后点左下「保存」，
                <br />
                或上传一份 .css 文件。
              </p>
            )}
          </ActionSheet>
        ) : null}

        {sheet === 'save' ? (
          <ActionSheet key="save" title="保存方案" onClose={closeSheet}>
            <p className="px-1 pb-2.5 text-[12px] leading-[1.55] text-black/40 dark:text-white/40">
              把编辑框里的 CSS 存成方案，之后在「打开」里随时取用。
            </p>
            <div className="flex gap-2">
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                maxLength={CUSTOM_CSS_NAME_MAX}
                placeholder="方案名字（留空自动起名）"
                aria-label="方案名称"
                data-testid={`custom-css-name-${scope}`}
                className="h-11 min-w-0 flex-1 rounded-[12px] border border-black/[0.09] bg-white px-3 text-[13.5px] text-black outline-none placeholder:text-black/25 focus:border-black/30 dark:border-white/[0.12] dark:bg-white/[0.08] dark:text-white dark:placeholder:text-white/25 dark:focus:border-white/35"
              />
              <button
                type="button"
                onClick={saveScheme}
                data-testid={`custom-css-save-confirm-${scope}`}
                className="h-11 shrink-0 rounded-[12px] px-5 text-[14px] font-semibold text-white transition-transform active:scale-95"
                style={{ backgroundColor: accent }}
              >
                保存
              </button>
            </div>
          </ActionSheet>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// ================= 聊天设置折叠区块（镜像 ChatDisplaySection 的展开交互） =================

export interface ChatCssSectionProps {
  /** 宿主 App（决定作用域与示例模板组） */
  app: 'wx' | 'qq';
  /** 当前联系人 ID（聊天 CSS 按联系人隔离，每个联系人一套） */
  contactId: string;
  /** 宿主强调色（微信绿 / QQ 蓝） */
  accent: string;
  /** 弹提示 */
  onToast: (m: string) => void;
}

/** 聊天设置页的「自定义 CSS」折叠区块：只改当前联系人的聊天界面 */
export function ChatCssSection({ app, contactId, accent, onToast }: ChatCssSectionProps) {
  const [open, setOpen] = useState(false);
  const scope = chatCssScope(app, contactId);
  const activeCss = useSettings((s) => readCustomCssActive(s.customCss, scope));

  return (
    <div className="mt-3 overflow-hidden rounded-[10px] bg-white dark:bg-[#1A1A1A]" data-testid={`chat-css-section-${app}`}>
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
                templates={chatCssTemplates(app)}
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
