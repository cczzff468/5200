'use client';

/**
 * 批量添加表情确认弹窗（微信 / QQ 共用）：
 * 选择多张手机图片（或解析批量链接）后先进入预览确认——
 * 缩略图 + 可编辑名称（意思）+ 单项移除 + 批量链接导入，
 * 点「确认添加 (N)」才真正入库。
 * 视觉为自研样式：浅灰底 + 白卡片列表 + 左标题右关闭 + 品牌色主按钮（与参考样式刻意区分）。
 */

import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { extractMeaningFromUrl, isImageUrl, newStickerId } from '@/lib/ios/stickers';

export interface BatchDraftItem {
  key: string;
  /** dataURL（本机图片）或 http(s) URL */
  preview: string;
  /** 名称（即表情意思，可编辑） */
  name: string;
  /** 来源默认名（文件名去扩展名 / 链接自动识别，作为初始名称） */
  fallbackName: string;
  source: 'file' | 'url';
}

/** 解析一行批量链接：支持「名称: URL」「名称 URL」或纯 URL（名称缺省时从 URL 自动识别） */
function parseBatchUrlLine(line: string): { name: string; url: string } | null {
  const m = line.match(/https?:\/\/\S+/i);
  if (!m) return null;
  const url = m[0];
  if (!isImageUrl(url)) return null;
  let name = line
    .slice(0, m.index ?? 0)
    .trim()
    .replace(/[:：]\s*$/, '')
    .trim();
  if (!name) name = extractMeaningFromUrl(url);
  return { name, url };
}

/** 表情意思预设（聊天面板长按下方意思标签时快速选用；也支持自定义输入或不设置） */
export const STICKER_MEANING_PRESETS = [
  '开心',
  '哈哈',
  '点赞',
  '可爱',
  '贴贴',
  '裂开',
  '哭哭',
  '生气',
  '疑惑',
  '惊讶',
  'OK',
  '晚安',
  '抱抱',
  '吃瓜',
  '握手',
  '庆祝',
];

/**
 * 表情意思选择 UI（微信 / QQ 聊天表情面板共用）：
 * 点表情下方的意思标签弹出——预设意思胶囊（点选/再点取消）+ 自定义输入 + 「不设置」（可以不选择意思）。
 */
export function StickerMeaningPicker({
  testPrefix,
  url,
  value,
  onConfirm,
  onClose,
}: {
  testPrefix: string;
  /** 表情缩略图（弹窗内回显） */
  url: string;
  /** 当前意思（可为空 = 未设置） */
  value: string;
  /** 确定：携带最终意思（空串 = 清除） */
  onConfirm: (v: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const t = (k: string) => `${testPrefix}-meaning-${k}`;
  const accent = testPrefix === 'wx' ? '#07C160' : '#0099FF';

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 px-6"
      data-testid={t('sheet')}
      onClick={onClose}
    >
      <div
        className="w-full rounded-[18px] bg-[#F2F3F5] p-4 shadow-2xl dark:bg-[#232427]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-semibold">设置意思</p>
          <button
            type="button"
            aria-label="关闭"
            data-testid={t('close')}
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-full bg-black/[0.06] text-black/45 active:bg-black/[0.1] dark:bg-white/10 dark:text-white/45"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-white dark:bg-white/[0.08]">
            <img src={url} alt="表情" className="h-full w-full object-contain" />
          </span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={20}
            placeholder="自定义意思，可留空"
            data-testid={t('input')}
            className="h-10 min-w-0 flex-1 rounded-[10px] bg-white px-3 text-[14px] outline-none placeholder:text-black/30 dark:bg-white/[0.08] dark:placeholder:text-white/30"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {STICKER_MEANING_PRESETS.map((p, i) => (
            <button
              key={p}
              type="button"
              data-testid={`${t('chip')}-${i}`}
              onClick={() => setDraft(draft === p ? '' : p)}
              className={`h-8 rounded-full px-3 text-[13px] active:opacity-70 ${
                draft === p
                  ? 'text-white'
                  : 'bg-black/[0.05] text-black/60 dark:bg-white/[0.08] dark:text-white/60'
              }`}
              style={draft === p ? { backgroundColor: accent } : undefined}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            data-testid={t('clear')}
            onClick={() => onConfirm('')}
            className="h-10 rounded-full border border-black/10 bg-white px-5 text-[14px] text-black/55 active:bg-black/[0.04] dark:border-white/15 dark:bg-white/[0.06] dark:text-white/55"
          >
            不设置
          </button>
          <button
            type="button"
            data-testid={t('done')}
            onClick={() => onConfirm(draft.trim())}
            className="h-10 rounded-full px-6 text-[14px] font-medium text-white active:opacity-85"
            style={{ backgroundColor: accent }}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

export function BatchStickerSheet({
  open,
  items,
  onItemsChange,
  onCancel,
  onConfirm,
  onToast,
  testPrefix,
}: {
  open: boolean;
  items: BatchDraftItem[];
  onItemsChange: (items: BatchDraftItem[]) => void;
  onCancel: () => void;
  onConfirm: (items: BatchDraftItem[]) => void;
  onToast: (m: string) => void;
  testPrefix: string;
}) {
  const [urlText, setUrlText] = useState('');
  if (!open) return null;

  const t = (k: string) => `${testPrefix}-batch-${k}`;
  const MAX = 12;
  /** 品牌主色：微信绿 / QQ 蓝（主按钮与解析按钮用） */
  const accent = testPrefix === 'wx' ? '#07C160' : '#0099FF';

  const appendItems = (next: BatchDraftItem[]) => {
    const merged = [...items, ...next];
    if (merged.length > MAX) {
      onItemsChange(merged.slice(0, MAX));
      onToast(`一次最多添加 ${MAX} 张`);
    } else {
      onItemsChange(merged);
    }
  };

  /** 解析批量链接文本域：每行一个，「名称: URL」「名称 URL」或纯 URL */
  const parseUrls = () => {
    const lines = urlText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      onToast('请先输入图片链接');
      return;
    }
    const added: BatchDraftItem[] = [];
    let bad = 0;
    for (const line of lines) {
      const p = parseBatchUrlLine(line);
      if (!p) {
        bad++;
        continue;
      }
      added.push({ key: newStickerId(), preview: p.url, name: p.name, fallbackName: p.name, source: 'url' });
    }
    if (added.length === 0) {
      onToast('没有有效的图片链接');
      return;
    }
    appendItems(added);
    setUrlText('');
    onToast(bad > 0 ? `已解析 ${added.length} 个，${bad} 行无效已跳过` : `已解析 ${added.length} 个链接`);
  };


  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 px-6"
      data-testid={t('sheet')}
      onClick={onCancel}
    >
      <div
        className="max-h-[86%] w-full overflow-y-auto rounded-[18px] bg-[#F2F3F5] shadow-2xl dark:bg-[#232427]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：标题左对齐 + 右侧关闭按钮 */}
        <div className="flex items-center justify-between px-5 pb-1 pt-4">
          <p className="text-[16px] font-semibold" data-testid={t('title')}>
            添加表情
          </p>
          <button
            type="button"
            aria-label="关闭"
            data-testid={t('close')}
            onClick={onCancel}
            className="grid h-7 w-7 place-items-center rounded-full bg-black/[0.06] text-black/45 active:bg-black/[0.1] dark:bg-white/10 dark:text-white/45"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
        {items.length > 0 && (
          <p className="px-5 pt-0.5 text-[12px] text-black/40 dark:text-white/40">已选 {items.length} 张，点名称可修改</p>
        )}

        {/* 批量链接导入 */}
        <p className="mt-4 px-5 text-[13px] text-black/45 dark:text-white/45">从链接导入</p>
        <div className="px-5">
          <textarea
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            placeholder={'每行一个图片链接，名称可省略\n示例：可爱 https://example.com/cat.gif'}
            rows={3}
            data-testid={t('urls')}
            className="mt-2 w-full resize-none rounded-[12px] border border-black/[0.06] bg-white p-3 text-[13px] leading-6 outline-none placeholder:text-black/30 dark:border-white/[0.08] dark:bg-white/[0.06] dark:placeholder:text-white/30"
          />
          <div className="mt-2 flex items-center justify-between">
            <p className="pr-3 text-[12px] leading-5 text-black/40 dark:text-white/40">支持「名称: 链接」，名称自动从链接识别</p>
            <button
              type="button"
              data-testid={t('parse')}
              onClick={parseUrls}
              className="h-9 shrink-0 rounded-full px-4 text-[13px] font-medium text-white active:opacity-85"
              style={{ backgroundColor: accent }}
            >
              解析链接
            </button>
          </div>
        </div>

        {/* 待添加列表：白卡片式 */}
        {items.length > 0 && (
          <div className="mt-3 max-h-[240px] space-y-2 overflow-y-auto px-5">
            {items.map((it, i) => (
              <div
                key={it.key}
                className="flex items-center gap-3 rounded-[14px] bg-white p-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:bg-white/[0.07]"
                data-testid={`${t('item')}-${i}`}
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[#F2F3F5] dark:bg-white/[0.08]">
                  <img src={it.preview} alt={it.name || '表情'} className="h-full w-full object-contain" loading="lazy" />
                </span>
                <span className="min-w-0 flex-1">
                  <input
                    value={it.name}
                    onChange={(e) => onItemsChange(items.map((x) => (x.key === it.key ? { ...x, name: e.target.value } : x)))}
                    maxLength={20}
                    placeholder="名称（表情意思）"
                    data-testid={`${t('name')}-${i}`}
                    className="h-9 w-full rounded-[8px] bg-black/[0.04] px-2.5 text-[14px] outline-none placeholder:text-black/30 dark:bg-white/[0.08] dark:placeholder:text-white/30"
                  />
                  <span className="mt-0.5 block text-[11px] text-black/35 dark:text-white/35">
                    {it.source === 'file' ? '来自手机' : '来自链接'}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label="移除"
                  data-testid={`${t('del')}-${i}`}
                  onClick={() => onItemsChange(items.filter((x) => x.key !== it.key))}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#FA5151] active:bg-[#FA5151]/10"
                >
                  <Trash2 className="h-[18px] w-[18px]" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 底部操作：描边取消 + 品牌色确认 */}
        <div className="mt-4 flex items-center justify-between px-5 pb-5">
          <button
            type="button"
            data-testid={t('cancel')}
            onClick={onCancel}
            className="h-11 rounded-full border border-black/10 bg-white px-6 text-[15px] text-black/55 active:bg-black/[0.04] dark:border-white/15 dark:bg-white/[0.06] dark:text-white/55"
          >
            取消
          </button>
          <button
            type="button"
            data-testid={t('confirm')}
            onClick={() => onConfirm(items)}
            disabled={items.length === 0}
            className="h-11 rounded-full px-6 text-[15px] font-medium text-white active:opacity-85 disabled:opacity-40"
            style={{ backgroundColor: accent }}
          >
            确认添加 ({items.length})
          </button>
        </div>
      </div>
    </div>
  );
}
