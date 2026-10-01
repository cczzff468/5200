'use client';

/**
 * 视频通话相机采集（Task 22）——用户摄像头画面预览 + 帧捕获 + 识图描述：
 *
 * - useLocalCamera(enabled, facing)：getUserMedia({ video }) 拉起摄像头流（只拉视频轨，音频轨由
 *   通话引擎自理，两条 getUserMedia 互不影响）；facing 切换（user/environment 前后置）时先停旧轨
 *   再重拉；enabled=false 或组件卸载时停轨释放。权限拒绝/设备不可用 → denied=true（界面降级为
 *   头像展示，通话/文字聊天完全不受影响——与语音通话「麦克风拒绝不影响其他功能」同口径）；
 * - captureFrameDataUrl(videoEl, maxSize)：把 <video> 当前帧绘到 canvas 缩帧（默认长边 640px）
 *   转 JPEG dataURL，供识图（帧不上传任何第三方，只内联给用户自己配置的识图接口，同聊天识图链路）；
 * - describeUserFrame(cfg, frame)：包装 describeImages——视频画面用专用提问语，描述客观简洁；
 *   未配置识图模型时抛错（调用方静默降级，不影响通话）。
 *
 * 隐私边界：画面只用于①本地 <video> 预览 ②用户自己配置的识图模型描述；不做录制、不落盘、不推送。
 */

import { useEffect, useRef, useState } from 'react';
import type { VisionConfig } from './store';
import { describeImages, visionConfigReady } from '../vision-client';

export type CameraFacing = 'user' | 'environment';

/** 视频识图提问语（describeImages 的 text 参；要求客观描述画面，不寒暄不评论） */
const VIDEO_FRAME_PROMPT =
  '这是视频通话中对方摄像头的实时画面，请用中文客观、简洁地描述此刻画面内容（人物外观/穿着/表情/动作/周围环境/可见物品与文字），150字以内，不要寒暄、不要评论、只输出描述本身。';

/** 摄像头流 hook：返回 videoRef（挂 <video>）+ 就绪/拒绝状态。
 *  enabled=false 时不拉流；facing 变化时重建流（翻转前后置）。 */
export function useLocalCamera(enabled: boolean, facing: CameraFacing): {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  ready: boolean;
  denied: boolean;
  error: string;
} {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [readyRaw, setReadyRaw] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState('');
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stopStream = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    if (!enabled) {
      stopStream();
      return; // ready 由返回值派生（readyRaw && enabled），关闭路径无需同步 setState
    }
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 720 }, height: { ideal: 1280 } },
          audio: false, // 音频轨由通话引擎单独 getUserMedia（录音链路），这里只拉画面
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch {
            // autoplay 策略：用户已与页面交互过，失败静默（通话场景必有交互）
          }
        }
        setDenied(false);
        setError('');
        setReadyRaw(true);
      } catch (e) {
        if (cancelled) return;
        // NotAllowedError=权限拒绝 / NotFoundError=无摄像头 / 其他=不可用：统一降级（头像展示），不中断通话
        setDenied(true);
        setError(e instanceof Error && e.message ? e.message : '摄像头不可用');
        setReadyRaw(false);
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [enabled, facing]);

  // ready 派生值：enabled=false 时同步为 false（无 setState，避免 effect 级联渲染）
  return { videoRef, ready: readyRaw && enabled, denied, error };
}

/** 抓当前帧 → 缩放至长边 ≤maxSize 的 JPEG dataURL（视频未就绪/已暂停返回 null） */
export function captureFrameDataUrl(video: HTMLVideoElement | null, maxSize = 640): string | null {
  if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null;
  try {
    const scale = Math.min(1, maxSize / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.max(1, Math.round(video.videoWidth * scale));
    const h = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const url = canvas.toDataURL('image/jpeg', 0.72);
    return url.startsWith('data:image/') ? url : null;
  } catch {
    return null;
  }
}

/** 识图配置是否就绪（未配置 = AI 看不见，界面照常、识图循环不启动） */
export function videoVisionReady(cfg: VisionConfig): boolean {
  return visionConfigReady(cfg);
}

/** 描述一帧用户画面（识图模型；失败抛 Error 由调用方静默降级——绝不影响通话本身） */
export async function describeUserFrame(cfg: VisionConfig, frame: string): Promise<string> {
  return describeImages(cfg, { images: [frame], text: VIDEO_FRAME_PROMPT });
}
