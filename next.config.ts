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
  // 4GB 沙箱内存紧张：Next 16.4 已移除 experimental.turbopackMemoryLimit
  //（16.1 可用），靠默认缓存驱逐策略即可
};

export default nextConfig;
