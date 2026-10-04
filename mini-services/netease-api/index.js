/**
 * 网易云音乐 API 本地服务（Task 53）—— mini-services/netease-api，端口 3010
 *
 * 作用：把开源项目 NeteaseCloudMusicApi（npm 4.32.0，经典版）自部署为本机常驻服务，
 *       供手机模拟器的音乐 App 后续接入「真实网易云账号登录」使用：
 *       - 扫码登录：/login/qr/key → /login/qr/create → /login/qr/check（801等待/802已扫/803成功+cookie）
 *       - 手机号登录：/captcha/sent（真实短信）→ /login/cellphone（验证码或密码）
 *       - 登录后能力：搜索 /search、歌单 /user/playlist、歌曲直链 /song/url/v1、每日推荐等 200+ 接口
 *
 * 接入链路（与项目网关约定一致）：
 *       前端相对路径请求 + ?XTransformPort=3010 → Caddy(:81) 按原路径转发 → 本服务 → music.163.com
 *       例：fetch('/login/qr/key?timestamp=' + Date.now() + '&XTransformPort=3010')
 *       登录 cookie（MUSIC_U）由调用方（前端/宿主）持有并按需通过 ?cookie= 参数回传，不出本机。
 *
 * 说明：
 * - 端口固定 3010（项目规范：mini service 显式指定端口，不依赖 PORT 环境变量）
 * - ⚠️ 运行时必须用 Node：bun 的 crypto 实现与 eapi 加密（aes-128-ecb + md5）存在兼容差异，
 *   bun 下 /login/qr/key 等部分 eapi 接口会被网易返回「参数错误」；Node 下全部正常（已实测对照）。
 *   因此 `bun run dev` = `node --watch index.js`（保留文件变更自动重启，与 bun --hot 等效）。
 * - checkVersion 关闭：避免启动时联网检查 npm 版本造成噪音/延迟
 */

const { serveNcmApi } = require('NeteaseCloudMusicApi');

const PORT = 3010;

serveNcmApi({ port: PORT, checkVersion: false })
  .then(() => {
    console.log(`[netease-api] ✅ 网易云 API 服务已启动: http://localhost:${PORT}`);
    console.log('[netease-api] 自检: curl "http://localhost:81/login/qr/key?XTransformPort=3010"');
  })
  .catch((err) => {
    console.error('[netease-api] ❌ 启动失败:', err);
    process.exit(1);
  });
