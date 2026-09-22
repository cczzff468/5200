'use client';

/**
 * 黑胶唱片小组件（第四页 2×3 方格，用户参考图样式）：
 * 一张大黑胶唱片 + 右上角唱针（枢轴圆点 + 弯臂 + 唱头落在盘面纹路上），
 * 盘面缓慢旋转表示播放中；纯装饰浮在壁纸上（无边框无卡体无投影）。
 * 黑胶黑盘 + 浅盘标深浅主题两态通用（黑胶本体的质感）。
 * 点击打开音乐 App（WIDGET_META.openApp 驱动）。
 */

export function VinylCardWidget() {
  return (
    <div className="relative h-[260px] w-full select-none">
      {/* 大黑胶唱片（缓慢旋转）：黑色盘体 + 细密纹路 + 盘标 + 中心孔 */}
      <div className="absolute left-1/2 top-[22px] h-[150px] w-[150px] -translate-x-1/2">
        <div
          aria-hidden="true"
          className="h-full w-full rounded-full bg-[#141416] animate-[netease-spin_16s_linear_infinite]"
        >
          {/* 纹路（同心细圈，由外向内） */}
          <span className="absolute inset-[6px] rounded-full border border-white/[0.07]" />
          <span className="absolute inset-[12px] rounded-full border border-white/[0.06]" />
          <span className="absolute inset-[18px] rounded-full border border-white/[0.055]" />
          <span className="absolute inset-[24px] rounded-full border border-white/[0.05]" />
          <span className="absolute inset-[30px] rounded-full border border-white/[0.045]" />
          {/* 盘标 + 中心孔 */}
          <span className="absolute left-1/2 top-1/2 h-[52px] w-[52px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#f0f0f2]" />
          <span className="absolute left-1/2 top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#141416]" />
        </div>
      </div>

      {/* 唱针：右上角枢轴 → 弯臂探向盘面（唱头落在唱片纹路上） */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute right-[2px] top-[6px] h-[74px] w-[88px]"
        viewBox="0 0 88 74"
        fill="none"
      >
        <path d="M76 12 L36 56" stroke="#f4f4f6" strokeWidth="4.4" strokeLinecap="round" />
        <path d="M36 56 L27 66" stroke="#f4f4f6" strokeWidth="8" strokeLinecap="round" />
        <circle cx="76" cy="12" r="9" fill="#f4f4f6" />
        <circle cx="76" cy="12" r="3.4" fill="#9a9aa0" />
      </svg>
    </div>
  );
}
