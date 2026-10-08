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
};

export default nextConfig;
