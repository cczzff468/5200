'use client';

/**
 * 识图模型客户端（设置 › 识图模型）。
 *
 * 职责边界：识图模型只负责「看」——把用户在聊天里发送的图片转成一段文字描述；
 * 描述作为上下文交给聊天模型生成最终回复。识图模型不参与聊天，两个模型配置互相独立。
 *
 * 调用策略与聊天一致：优先走服务器代理 /api/vision（服务器转发到用户配置的接口，
 * 避开浏览器 CORS）；内网地址 / 服务器建议直连（directOnly）时回退浏览器直连。
 * 图片只以 data URL 内联传给用户自己配置的识图接口，不经过任何第三方图床/公网上传。
 * 未配置（baseUrl 为空）时调用方应直接跳过识图，文字聊天完全不受影响。
 */

import type { VisionConfig } from '@/lib/ios/store';
import { directVisionDescribe, isPrivateApiUrl } from '@/lib/ios/direct-api';

/** 识图 system 提示：客观、简洁、不寒暄，输出描述本身（服务端 /api/vision 用同一份文案） */
export const VISION_SYSTEM_PROMPT =
  '你是聊天应用内置的图片识别助手。用户在聊天中发来图片，请用中文客观、简洁地描述图片内容（有什么人/物/场景/可见文字），150 字以内；不要寒暄、不要评论、只输出描述本身。如果消息附带了文字问题，请结合图片回答该问题。';

/** 识图请求：图片 data URL（仅接受 data:image/ 前缀）+ 用户随图附言（可空） */
export interface VisionRequest {
  images: string[];
  text: string;
}

/** 校验识图配置完整性（baseUrl + model 必填；apiKey 可空——反代/本地网关可能免 Key） */
export function visionConfigReady(cfg: VisionConfig): boolean {
  return Boolean(cfg.baseUrl.trim() && cfg.model.trim());
}

/** 过滤非法图片（只允许 data:image/ 内联数据；数量与体积由调用方在上传压缩阶段控制） */
function sanitizeImages(images: string[]): string[] {
  return images.filter((u) => typeof u === 'string' && u.startsWith('data:image/'));
}

/**
 * 请求识图描述：返回描述文本（可能为空串 = 模型没产出，调用方按未识图处理）。
 * 失败抛 Error（友好文案，由调用方展示为系统提示；绝不把错误当角色台词）。
 */
export async function describeImages(config: VisionConfig, req: VisionRequest): Promise<string> {
  if (!visionConfigReady(config)) {
    throw new Error('还没有配置识图模型：请到「设置 › 识图模型」填写 API 地址与模型名');
  }
  const images = sanitizeImages(req.images);
  if (images.length === 0) return '';
  // 内网/本机地址：云端服务器必然不可达 → 直接浏览器直连
  if (isPrivateApiUrl(config.baseUrl)) {
    return directVisionDescribe(config, images, req.text, VISION_SYSTEM_PROMPT);
  }
  const res = await fetch('/api/vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, text: req.text, config }),
  });
  const data = (await res.json().catch(() => null)) as
    | { desc?: unknown; error?: unknown; directOnly?: unknown }
    | null;
  if (res.ok && data && typeof data.desc === 'string') return data.desc.trim();
  // 服务器建议直连（地区限制/网络不可达）→ 浏览器直连兜底
  if (data?.directOnly === true) {
    return directVisionDescribe(config, images, req.text, VISION_SYSTEM_PROMPT);
  }
  const msg = typeof data?.error === 'string' && data.error ? data.error : `识图请求失败（HTTP ${res.status}）`;
  throw new Error(msg);
}
