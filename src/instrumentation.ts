/**
 * Next.js instrumentation hook —— Next server 启动时执行（dev 模式同样生效）。
 *
 * 作用：从「容器启动树」成员（本 Next server 进程）内部拉起 ncm-keeper 守护脚本，
 *       让 netease-api（网易云 API，端口 3010）常驻不被回收：
 *
 *       Next server(启动树) → instrumentation.register()
 *         → ncm-keeper.sh（守护 3010，PID 单实例）
 *           → node index.js（netease-api）
 *             → next-keeper.sh（守护 3000，PID 单实例，index.js 内置拉起）
 *
 * 背景：Bash 工具调用产生的后台进程会在调用结束后被沙箱回收；
 *       只有启动树（tini → start.sh → bun run dev → Next）内的进程能常驻。
 *       本文件是把守护进程「挂进启动树」的入口。
 *
 * 幂等性：ncm-keeper / next-keeper 各自带 PID 文件单实例守卫，重复拉起自动退出。
 *
 * 实现细节：用 process.getBuiltinModule('child_process')（Node ≥22.3，本机 Node 24）
 * 代替 import / require —— 避免打包器把 child_process 静态分析进 Edge Runtime
 * 产物（此前每次编译都会刷「node-module-in-edge-runtime」警告）；
 * Edge 分支已在第一行 return，不会执行到这里。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const childProcess = process.getBuiltinModule('child_process');
    const child = childProcess.spawn(
      'bash',
      ['/home/z/my-project/mini-services/netease-api/ncm-keeper.sh'],
      {
        cwd: '/home/z/my-project/mini-services/netease-api',
        detached: true,
        stdio: 'ignore',
      },
    );
    child.unref();
    console.log(`[instrumentation] ncm-keeper spawned pid=${child.pid}`);
  } catch (e) {
    console.error('[instrumentation] spawn ncm-keeper failed:', e);
  }
}
