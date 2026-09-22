/**
 * 默认头像：黑白灰小人剪影（联系人 App / 信息 App 通用）。
 * shape='square' 时不内置圆角（微信 App 风格：方形圆角头像由调用方按尺寸传入 rounded-[Xpx]），
 * 避免与内置 rounded-full 产生同类工具类冲突。
 */
export function DefaultAvatar({
  size = 44,
  className = '',
  shape = 'circle',
}: {
  size?: number;
  className?: string;
  shape?: 'circle' | 'square';
}) {
  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center ${shape === 'circle' ? 'rounded-full' : ''} bg-[#C7C7CC] text-white ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: size * 0.62, height: size * 0.62 }}>
        <circle cx="12" cy="8.2" r="4.3" />
        <path d="M12 14.1c-4.7 0-8.1 2.7-8.1 6.3 0 .9.7 1.6 1.6 1.6h13c.9 0 1.6-.7 1.6-1.6 0-3.6-3.4-6.3-8.1-6.3z" />
      </svg>
    </div>
  );
}
