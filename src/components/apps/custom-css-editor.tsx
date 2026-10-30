'use client';

/**
 * 自定义 CSS 编辑器（第六十五轮首建 · 第七十四轮全内联无弹窗）
 * ---------------------------------------------------------------------------
 * 三处入口共用一套编辑器：
 * - 主题界面（个性装扮 › 自定义CSS Tab）：scope='global'，作用于整个手机；
 * - 联系人聊天设置（折叠区块「自定义CSS」）：scope=`chat:wx:联系人ID` / `chat:qq:联系人ID`；
 * - 线下模式 › 现场设置：scope='offline'。
 *
 * 第七十四轮（用户指定：不要弹窗）：
 * - 全内联三段式：说明文字 + 大代码框 + 示例模板 chips（横向一行）；
 * - 我的方案：内联行列表（点按填入 / 右侧删除），不再走底部弹层；
 * - 底部一排按钮：上传 · 存当前 · 清除 · 应用（存当前自动命名，不再弹命名层）；
 * - 所有交互都在编辑器本体内完成，零弹窗零遮罩。
 */
import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Eraser, FileUp, LayoutTemplate, Play, Save, Trash2 } from 'lucide-react';
import {
  CUSTOM_CSS_MAX_LEN,
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

// ================= 编辑器本体 =================

export interface CustomCssEditorProps {
  scope: CustomCssScope;
  /** 示例模板组（界面完整模板 + 卡片模板…，chips 按此列出） */
  templates: CssTemplate[];
  /** 主色（应用按钮/选中态） */
  accent: string;
  /** 弹提示 */
  onToast: (m: string) => void;
  /** 嵌入环境视觉变体：card=独立卡（主题页/线下设置用）；chat=聊天设置折叠区块内容（无外框） */
  variant?: 'card' | 'chat';
}

/** 单个作用域的编辑器（状态读写都走 useSettings.customCss；聊天作用域按联系人隔离；全内联无弹窗） */
export function CustomCssEditor({ scope, templates, accent, onToast, variant = 'card' }: CustomCssEditorProps) {
  const meta = scopeMeta(scope);
  const activeCss = useSettings((s) => readCustomCssActive(s.customCss, scope));
  const schemes = useSettings((s) => s.customCss.schemes);
  const setActive = useSettings((s) => s.setCustomCssActive);
  const setSchemes = useSettings((s) => s.setCustomCssSchemes);

  /** 编辑框草稿（打开时带入当前已应用的 CSS） */
  const [draft, setDraft] = useState(activeCss);
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
        onToast(`已导入「${f.name}」，点「应用」生效`);
      })
      .catch(() => onToast('读取文件失败，请重试'));
  };

  /** 存当前：把编辑框里的 CSS 存成方案（自动命名「我的主题 N」，无弹窗） */
  const saveScheme = () => {
    const body = draft.trim();
    if (!body) {
      onToast('先写点 CSS 再保存');
      return;
    }
    const name = `我的主题 ${mineSchemes.length + 1}`;
    const scheme: CustomCssScheme = {
      id: `css-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      css: body,
      scope,
      createdAt: Date.now(),
    };
    setSchemes([scheme, ...schemes]);
    onToast(`已保存「${name}」，点方案名随时取用`);
  };

  const shellCls =
    variant === 'card'
      ? 'rounded-[20px] bg-white/70 p-4 backdrop-blur-xl ring-1 ring-black/[0.05] dark:bg-white/[0.06] dark:ring-white/[0.10]'
      : 'px-3.5 pb-3.5';

  // 灰底圆角按钮（iOS 简约按钮）
  const grayBtn =
    'flex h-11 items-center justify-center gap-1.5 rounded-[12px] bg-black/[0.05] text-[13.5px] font-medium text-black/70 ring-1 ring-black/[0.04] transition-colors active:bg-black/[0.11] dark:bg-white/[0.08] dark:text-white/75 dark:ring-white/[0.06] dark:active:bg-white/[0.14] disabled:opacity-35';

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
          placeholder={'/* 在这里输入 CSS，或点下方模板一键填入 */'}
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

      {/* 示例模板 chips：一行横向滚动，点按填入编辑框（无弹窗） */}
      {templates.length > 0 && (
        <div
          className="no-scrollbar -mx-1 mt-2.5 flex gap-2 overflow-x-auto px-1 pb-0.5"
          role="group"
          aria-label="示例模板"
        >
          {templates.map((t, i) => (
            <button
              key={t.name}
              type="button"
              data-testid={`custom-css-tpl-${scope}-${i}`}
              onClick={() => {
                setDraft(t.css);
                onToast(`已填入「${t.name}」，改好点「应用」`);
              }}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-black/[0.05] px-3 py-[7px] text-[12.5px] font-medium text-black/70 ring-1 ring-black/[0.04] transition-colors active:bg-black/[0.11] dark:bg-white/[0.08] dark:text-white/75 dark:ring-white/[0.06] dark:active:bg-white/[0.14]"
            >
              <LayoutTemplate className="h-[13px] w-[13px] shrink-0" style={{ color: accent }} aria-hidden="true" />
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* 我的方案：内联行列表（点按填入 / 右侧删除；当前应用中的带 accent 圆点） */}
      {mineSchemes.length > 0 && (
        <ul className="mt-2.5 space-y-1.5" aria-label="我的方案">
          {mineSchemes.map((s) => {
            const active = s.css === activeCss;
            return (
              <li
                key={s.id}
                data-testid={`custom-css-scheme-${scope}`}
                className="flex items-center gap-2 rounded-[12px] bg-white px-3 py-2 ring-1 ring-black/[0.05] dark:bg-white/[0.07] dark:ring-white/[0.08]"
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
                    onToast(`已把「${s.name}」填入编辑框`);
                  }}
                  className="min-w-0 flex-1 py-0.5 text-left"
                  title="点按填入编辑框"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13.5px] font-medium text-black/85 dark:text-white/90">{s.name}</span>
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
              </li>
            );
          })}
        </ul>
      )}

      {/* 底部按钮栏：上传 · 存当前 · 清除 · 应用（全内联，无弹窗） */}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          data-testid={`custom-css-upload-${scope}`}
          className={`${grayBtn} flex-1 px-1`}
        >
          <FileUp className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
          上传
        </button>
        <button
          type="button"
          onClick={saveScheme}
          disabled={!draft.trim()}
          data-testid={`custom-css-save-${scope}`}
          className={`${grayBtn} flex-1 px-1`}
        >
          <Save className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
          存当前
        </button>
        <button
          type="button"
          onClick={clearAll}
          disabled={!activeCss && !draft}
          data-testid={`custom-css-clear-${scope}`}
          className={`${grayBtn} flex-1 px-1`}
        >
          <Eraser className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
          清除
        </button>
        <button
          type="button"
          onClick={apply}
          data-testid={`custom-css-apply-${scope}`}
          className="flex h-11 flex-[1.25] items-center justify-center gap-1.5 rounded-[12px] px-1 text-[13.5px] font-semibold text-white transition-transform active:scale-[0.97] disabled:opacity-40"
          style={{ backgroundColor: accent }}
        >
          <Play className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
          应用
        </button>
      </div>

      {/* 隐藏的文件选择（「上传」按钮触发） */}
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
