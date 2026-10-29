'use client';

/**
 * 单行缩字文本（ShrinkText）——用户指定行为
 * ---------------------------------------------------------------------------
 * 「字数超了的话，文字变小，不要让他弄第二行」：
 *  - 内容超宽时字号自动等比变小（下限 min），永不折行、不越出自身盒子；
 *  - 宽度由外层给定（本组件不设宽）：常见用法
 *      头像下元信息：className 含 block w-full（跟随头像列宽 38/40px）→ 缩到头像宽内；
 *      输入框占位文字：className 含 absolute inset-0 flex items-center + 左右内边距；
 *  - 文字宽度用「离屏探针」测量：与目标元素同字体参数、挂在 body（无祖先 transform）——
 *    直接 Range.getBoundingClientRect 会带祖先 transform（本机手机壳旋转 90°），
 *    量出的是视觉宽而非排版宽，与 clientWidth（排版空间）单位不一致会导致缩字失灵；
 *  - 字号按实测宽度等比换算，收敛阶段 0.1px 递减兜底；
 *    极端超长（缩到 min 仍放不下）整段溢出被 overflow-hidden 裁掉，绝不折行。
 *
 * 宽度变化（转屏/窗口缩放）经 ResizeObserver 跟随重算。
 */
import { useEffect, useRef } from 'react';

export interface ShrinkTextProps {
  /** 要显示的文字（纯文本） */
  children: string;
  /** 追加类：需自带布局（block w-full / absolute inset-0 等）与颜色/字号基准 */
  className?: string;
  /** 最小字号（px；再放不下就整段裁掉，绝不折行） */
  min?: number;
  testId?: string;
  /** 对屏幕阅读器隐藏（纯装饰性叠层用，如输入框占位文字） */
  ariaHidden?: boolean;
}

export function ShrinkText({ children, className, min = 6, testId, ariaHidden }: ShrinkTextProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const text = children;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      // 每次从头算：先清内联字号回类基准
      el.style.fontSize = '';
      const cs = getComputedStyle(el);
      const avail = el.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
      if (avail <= 0) return;
      const base = parseFloat(cs.fontSize) || 10;
      if (!(base > 0)) return;

      // 离屏探针：同字体参数挂在 body（无祖先 transform），量真实排版宽度
      const probe = document.createElement('span');
      probe.style.cssText = 'position:fixed;left:-99999px;top:0;white-space:nowrap;visibility:hidden;';
      probe.style.fontFamily = cs.fontFamily;
      probe.style.fontWeight = cs.fontWeight;
      probe.style.fontStyle = cs.fontStyle;
      probe.style.letterSpacing = cs.letterSpacing;
      probe.style.fontSize = cs.fontSize;
      probe.textContent = el.textContent ?? '';
      document.body.appendChild(probe);
      try {
        let w = probe.getBoundingClientRect().width;
        if (w <= avail) return; // 放得下：保持基准字号

        // 等比换算一次到位（字号与字形宽度近似线性），0.1px 粒度向下取
        let size = Math.max(min, Math.min(base, (base * avail) / w));
        size = Math.floor(size * 10) / 10;

        // 收敛兜底：近似换算仍略超时按 0.1px 递减（换算与渲染有亚像素差）
        for (let guard = 48; guard > 0; guard--) {
          probe.style.fontSize = `${size}px`;
          el.style.fontSize = `${size}px`;
          if (probe.getBoundingClientRect().width <= avail) break;
          if (size <= min) break;
          size = Math.max(min, Math.floor((size - 0.1) * 10) / 10);
        }
      } finally {
        probe.remove();
      }
    };

    fit();
    // 宽度跟随：盒子尺寸变化（转屏/窗口缩放/父级布局变化）重算
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, min]);

  return (
    <span
      ref={ref}
      data-testid={testId}
      aria-hidden={ariaHidden || undefined}
      className={`overflow-hidden whitespace-nowrap ${className ?? ''}`}
    >
      {text}
    </span>
  );
}
