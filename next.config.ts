import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // 触发 dev server 进程内重启以加载 src/instrumentation.ts（拉起 ncm-keeper 守护网易云 API）
  outputFileTracingIncludes: {},
  // 4GB 沙箱内存紧张：限制 Turbopack 内存目标（bytes），接近上限时自动驱逐缓存而不是把
  // RSS 推到 2GB+（此前 chrome 一开 dev server 即被 OOM killer 回收，页面永远黑屏）
  experimental: {
    turbopackMemoryLimit: 1280 * 1024 * 1024,
  },
};

export default nextConfig;
