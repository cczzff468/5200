/**
 * 弯钩小尾巴（第十八轮）——聊天气泡装扮「参考图同款」尾巴
 * ---------------------------------------------------------------------------
 * 形状：水滴弯钩 —— 尖端在头像一侧偏上，外缘凸弧向下掠入气泡本体，
 * 内缘与气泡圆角之间留出月牙缺口（BUBBLE_TAIL_PATH 贝塞尔，已在设计时数值验证）。
 *
 * 定位：横向与气泡本体重叠 2px 保证无缝（左/右 -8px，SVG 宽 10px）；
 * 我方（mine）自动水平镜像，尖端指向右侧自己的头像。
 * 尾巴固定尺寸（不随气泡行数缩放），与主流 IM 实现一致。
 */
import { BUBBLE_TAIL_PATH } from '@/lib/ios/bubble-style';

export function BubbleTail({
  side,
  color,
  top = 3,
}: {
  /** mine=我的气泡（右侧，尾巴朝右）/ theirs=TA的气泡（左侧，尾巴朝左） */
  side: 'mine' | 'theirs';
  /** 尾巴填充色（与气泡本体同色） */
  color: string;
  /** 距气泡顶部偏移（px） */
  top?: number;
}) {
  const theirs = side === 'theirs';
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute"
      width="10"
      height="13"
      viewBox="0 0 11 14"
      style={
        theirs
          ? { left: -8, top, transform: 'none' }
          : { right: -8, top, transform: 'scaleX(-1)' }
      }
    >
      <path d={BUBBLE_TAIL_PATH} fill={color} />
    </svg>
  );
}
