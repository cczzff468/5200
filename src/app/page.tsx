import PhoneShell from '@/components/ios/PhoneShell';

export default function Home() {
  return (
    <>
      {/* TEMP: Hunyuan3D login QR overlay — REMOVE after login */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99999,
          background: 'rgba(0,0,0,0.92)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div style={{ color: '#fff', fontSize: 22, fontWeight: 700 }}>
          🔍 请用「微信」扫描下方二维码
        </div>
        <div style={{ color: '#fbbf24', fontSize: 15, maxWidth: 420 }}>
          这是腾讯混元3D 的登录码（免费生成3D模型用）。
          <br />
          扫码 → 在手机上点「确认登录」→ 回聊天里告诉我「已登录」。
          <br />
          ⏰ 二维码约 1~2 分钟会过期，过期了在聊天里说「刷新」。
        </div>
        <img
          src="/hy-qr.png?v=1"
          alt="微信扫码登录腾讯混元3D"
          width={320}
          height={320}
          style={{
            borderRadius: 12,
            background: '#fff',
            padding: 10,
            boxShadow: '0 0 40px rgba(255,255,255,0.35)',
          }}
        />
        <div style={{ color: '#94a3b8', fontSize: 13 }}>
          （此浮层为临时登录辅助，登录完成后会自动移除）
        </div>
      </div>

      <PhoneShell />
    </>
  );
}
