'use client';

/**
 * 自定义 CSS 编辑器（第六十五轮）—— 三处入口共用一套编辑器
 * ---------------------------------------------------------------------------
 * - 主题界面（个性装扮 › 主题 Tab 最底部）：scope='global'，作用于整个手机；
 * - 联系人聊天设置（折叠区块「自定义CSS」，紧跟显示设置之后）：scope='chat-wx'/'chat-qq'，
 *   只作用于该 App 的聊天界面；
 * - 线下模式 › 现场设置（「自定义CSS」卡片）：scope='offline'，只作用于线下所有界面。
 *
 * 功能（用户指定）：代码编辑框 + 示例（可按照改）+ 文件上传（.css）+
 * 保存为方案（自定义名字，按作用域归类列表，可再次填入/应用/删除）+
 * 底部「应用 / 清除」两枚主按钮（应用=立即生效；清除=移除已应用的 CSS 恢复默认）。
 */
import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Code2, Eraser, FileUp, Play, Trash2, Wand2 } from 'lucide-react';
import {
  CUSTOM_CSS_MAX_LEN,
  CUSTOM_CSS_NAME_MAX,
  chatCssExample,
  type CustomCssScope,
  type CustomCssScheme,
} from '@/lib/ios/custom-css';
import { useSettings } from '@/lib/ios/store';

/** 作用域元信息（标题/说明文字） */
const SCOPE_META: Record<CustomCssScope, { title: string; hint: string }> = {
  global: { title: '自定义 CSS', hint: '作用于整个手机：所有界面、所有面板、所有按钮（含线下模式）。' },
  'chat-wx': { title: '自定义 CSS', hint: '只作用于微信的聊天界面（消息、气泡、输入栏），其他界面不受影响。' },
  'chat-qq': { title: '自定义 CSS', hint: '只作用于 QQ 的聊天界面（消息、气泡、输入栏），其他界面不受影响。' },
  offline: { title: '自定义 CSS', hint: '只作用于线下模式的所有界面（开始页、见面页、存档、现场设置、历史）。' },
};

export interface CustomCssEditorProps {
  scope: CustomCssScope;
  /** 示例 CSS（点「载入示例」填进编辑框，用户可在此基础上修改） */
  example: string;
  /** 主色（按钮/选中态） */
  accent: string;
  /** 弹提示 */
  onToast: (m: string) => void;
  /** 嵌入环境视觉变体：card=独立卡（主题页/线下设置用）；chat=聊天设置折叠区块内容（无外框） */
  variant?: 'card' | 'chat';
}

/** 单个作用域的编辑器本体（状态读写都走 useSettings.customCss） */
export function CustomCssEditor({ scope, example, accent, onToast, variant = 'card' }: CustomCssEditorProps) {
  const meta = SCOPE_META[scope];
  const activeCss = useSettings((s) => s.customCss[scope]);
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
  const charCount = draft.length;

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

  const loadExample = () => {
    setDraft(example);
    onToast('已载入示例，可修改后点「应用」');
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
    const name = nameDraft.trim().slice(0, CUSTOM_CSS_NAME_MAX) || `我的样式 ${mineSchemes.length + 1}`;
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
      {/* 标题行：作用范围说明 + 已应用徽标 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[15px] font-semibold text-black/85 dark:text-white/90">
            <Code2 className="h-[16px] w-[16px]" style={{ color: accent }} aria-hidden="true" />
            {meta.title}
          </p>
          <p className="mt-0.5 text-[12px] leading-[1.5] text-black/40 dark:text-white/40">{meta.hint}</p>
        </div>
        {activeCss ? (
          <span
            className="flex shrink-0 items-center gap-1 rounded-full px-2 py-[3px] text-[10.5px] font-semibold text-white"
            style={{ backgroundColor: accent }}
          >
            <Check className="h-[10px] w-[10px]" strokeWidth={3} aria-hidden="true" />
            已应用
          </span>
        ) : null}
      </div>

      {/* 代码编辑框 */}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, CUSTOM_CSS_MAX_LEN))}
        spellCheck={false}
        rows={8}
        placeholder={'/* 在这里写 CSS，或点下方「载入示例」 */'}
        aria-label={`自定义 CSS 编辑框（${meta.title}）`}
        data-testid={`custom-css-textarea-${scope}`}
        className="mt-3 w-full resize-y rounded-[12px] border border-black/[0.08] bg-black/[0.02] p-3 font-mono text-[12px] leading-[1.65] text-black/85 outline-none transition-colors placeholder:text-black/25 focus:border-black/30 dark:border-white/[0.12] dark:bg-black/25 dark:text-white/85 dark:placeholder:text-white/25 dark:focus:border-white/35"
      />
      <div className="mt-1 flex items-center justify-between text-[10.5px] text-black/30 dark:text-white/30">
        <span>{dirty ? '有未应用的修改' : '与当前应用一致'}</span>
        <span className="tabular-nums">
          {charCount} / {CUSTOM_CSS_MAX_LEN}
        </span>
      </div>

      {/* 工具行：载入示例 + 上传文件 */}
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={loadExample}
          data-testid={`custom-css-example-${scope}`}
          className="flex h-9 items-center justify-center gap-1.5 rounded-full border border-black/[0.08] bg-black/[0.03] text-[12.5px] font-medium text-black/60 transition-colors active:bg-black/[0.07] dark:border-white/[0.10] dark:bg-white/[0.06] dark:text-white/65 dark:active:bg-white/[0.10]"
        >
          <Wand2 className="h-[14px] w-[14px]" aria-hidden="true" />
          载入示例
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          data-testid={`custom-css-upload-${scope}`}
          className="flex h-9 items-center justify-center gap-1.5 rounded-full border border-black/[0.08] bg-black/[0.03] text-[12.5px] font-medium text-black/60 transition-colors active:bg-black/[0.07] dark:border-white/[0.10] dark:bg-white/[0.06] dark:text-white/65 dark:active:bg-white/[0.10]"
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
      </div>

      {/* 保存方案（自定义名字） */}
      <div className="mt-3">
        <div className="flex gap-2">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            maxLength={CUSTOM_CSS_NAME_MAX}
            placeholder="方案名字，如：我的按压手感"
            aria-label="方案名称"
            data-testid={`custom-css-name-${scope}`}
            className="h-9 min-w-0 flex-1 rounded-full border border-black/[0.08] bg-white px-3 text-[12.5px] text-black outline-none placeholder:text-black/25 focus:border-black/30 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-white dark:placeholder:text-white/25 dark:focus:border-white/35"
          />
          <button
            type="button"
            onClick={saveScheme}
            disabled={!draft.trim()}
            data-testid={`custom-css-save-${scope}`}
            className="h-9 shrink-0 rounded-full px-4 text-[12.5px] font-semibold text-white transition-transform active:scale-95 disabled:opacity-40"
            style={{ backgroundColor: accent }}
          >
            保存
          </button>
        </div>

        {/* 已保存方案列表（本作用域） */}
        {mineSchemes.length > 0 ? (
          <ul className="mt-2.5 space-y-1.5">
            {mineSchemes.map((s) => {
              const active = s.css === activeCss;
              return (
                <li
                  key={s.id}
                  data-testid={`custom-css-scheme-${scope}`}
                  className="flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 py-1.5 pl-3 pr-1.5 dark:border-white/[0.08] dark:bg-white/[0.05]"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(s.css);
                      onToast(`已把「${s.name}」填入编辑框`);
                    }}
                    className="min-w-0 flex-1 text-left"
                    title="点按填入编辑框"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-black/80 dark:text-white/85">{s.name}</span>
                      {active ? (
                        <span className="shrink-0 rounded-full px-1.5 py-[1px] text-[9.5px] font-semibold text-white" style={{ backgroundColor: accent }}>
                          应用中
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-[1px] block truncate text-[10.5px] tabular-nums text-black/35 dark:text-white/35">
                      {s.css.split('\n').length} 行 · {s.css.length} 字符
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`应用 ${s.name}`}
                    title="直接应用"
                    onClick={() => applyScheme(s)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors active:opacity-60"
                    style={{ color: accent }}
                  >
                    <Play className="h-[13px] w-[13px]" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`删除 ${s.name}`}
                    title="删除"
                    onClick={() => removeScheme(s)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-black/30 transition-colors active:bg-[#FF3B30]/12 active:text-[#FF3B30] dark:text-white/35 dark:active:text-[#FF6B6B]"
                  >
                    <Trash2 className="h-[13px] w-[13px]" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-[11.5px] text-black/30 dark:text-white/30">还没有保存的方案——写好 CSS 后起个名字保存，随时可以再应用。</p>
        )}
      </div>

      {/* 底部两枚主按钮：应用 / 清除 */}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={apply}
          data-testid={`custom-css-apply-${scope}`}
          className="flex h-11 items-center justify-center gap-1.5 rounded-full text-[14.5px] font-semibold text-white shadow-md transition-transform active:scale-[0.97] disabled:opacity-40"
          style={{ backgroundColor: accent, boxShadow: `0 6px 18px ${accent}40` }}
        >
          <Play className="h-[15px] w-[15px]" aria-hidden="true" />
          应用
        </button>
        <button
          type="button"
          onClick={clearAll}
          disabled={!activeCss && !draft}
          data-testid={`custom-css-clear-${scope}`}
          className="flex h-11 items-center justify-center gap-1.5 rounded-full border border-black/[0.10] bg-black/[0.03] text-[14.5px] font-semibold text-black/55 transition-colors active:bg-black/[0.07] disabled:opacity-40 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-white/60 dark:active:bg-white/[0.10]"
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
  /** 宿主 App（决定作用域与示例） */
  app: 'wx' | 'qq';
  /** 宿主强调色（微信绿 / QQ 蓝） */
  accent: string;
  /** 弹提示 */
  onToast: (m: string) => void;
}

/** 聊天设置页的「自定义 CSS」折叠区块：只改该 App 的聊天界面 */
export function ChatCssSection({ app, accent, onToast }: ChatCssSectionProps) {
  const [open, setOpen] = useState(false);
  const activeCss = useSettings((s) => s.customCss[app === 'qq' ? 'chat-qq' : 'chat-wx']);

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
                scope={app === 'qq' ? 'chat-qq' : 'chat-wx'}
                example={chatCssExample(app)}
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
