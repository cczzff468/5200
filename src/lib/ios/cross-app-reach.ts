'use client';

/**
 * 拉黑后跨 App 主动找（Task G-1）：
 *
 * 用户在某 App 把角色拉黑（byUser 从无到有的跃迁，由 block-state.setUserBlock 的触发钩子进入）后，
 * 角色「立刻、无冷却」到其余未被拉黑的 App 主动发一条消息找用户：
 *
 * - 目标 App：wx / qq / sms 三端私聊中 `loadBlock(app, contactId).byUser !== true` 的全部
 *   （byChar 不排除——角色拉黑用户时仍可给用户发消息，与 block-state 既有口径一致；
 *   byUser 的 App 必须排除——去了也会被回合入口守卫拦截，发了也白发）；
 * - prompt 明确告知「你在 XX 被拉黑了，所以来这边找 TA」（用户验收预期：角色必须知道
 *   自己为什么换 App 来找），语气按人设 + 记忆 + 跨 App 近况生成；
 * - 无冷却：没有时间节流，每次拉黑事件（含解除后重新拉黑 = 新跃迁）各触发一轮；角色后续
 *   的「反复找」由既有通道自然承担（用户在其他 App 说话 → 正常聊天回合回应；主动来电调度
 *   → G-2 口径修正后不再被 wx/qq 拉黑排除）；
 * - 结果持久化：消息直接落各端会话 kv（wx-chat-msgs / qq-chat-msgs / ios-chat-msgs，消息
 *   结构与各端 loadMsgs 校验器一致，封顶 100 条同口径；wx/qq 同步恢复被「删除」的会话行，
 *   与各端 saveMsgs 的真微信行为一致）+ 灵动岛通知（pushChatNotification，点击直达会话）；
 * - 落库前复核目标 App 拉黑状态（生成期间用户又把该 App 也拉黑 → 放弃，不白发）；
 * - 不写记忆：拉黑/找人的状态本身不进记忆（与既有口径一致——AI 对拉黑的感知全部来自
 *   每轮现场注入的提示词）；这条消息落库后由后续正常聊天回合的记忆管线自然沉淀；
 * - 全程 fire-and-forget + 全量容错：任何失败静默，绝不影响拉黑主流程与既有聊天功能。
 */

import { kvGet, kvSet } from './idb-kv';
import { genId } from './db';
import { getContact, ownerProfile } from './contacts-store';
import { avatarFor } from '@/lib/contacts';
import { useSettings } from './store';
import { BLOCK_CHANNEL, loadBlock, type BlockApp } from './block-state';
import { buildPersonaSystemPrompt } from './persona';
import { getMemSettings, memRecallBlock } from '@/lib/memory';
import { buildCrossAppBlock } from './cross-app-context';
import { buildTimeAwareBlock } from '@/lib/time-aware';
import { cleanBubbleText } from '@/lib/chat-rich';
import { pushChatNotification, type NotifyApp } from './island-notify';
import type { ContactRecord } from '@/lib/contacts';

/** 模块级防重入：同一联系人同时只跑一轮跨 App 找（拉黑事件的触发是幂等跃迁，这里再兜一层） */
const running = new Set<string>();

/** 各端会话 kv 键（与各 App 落盘键 / cross-app-context 读取键严格一致） */
function msgsKey(app: BlockApp, contactId: string): string {
  return app === 'wx' ? `wx-chat-msgs:${contactId}` : app === 'qq' ? `qq-chat-msgs:${contactId}` : `ios-chat-msgs:c:${contactId}`;
}

/** 通知归属 App（island-notify 的 NotifyApp 三值） */
const NOTIFY_APP_OF: Record<BlockApp, NotifyApp> = { wx: 'wechat', qq: 'qq', sms: 'chat' };

/** wx/qq「删除会话」隐藏列表键（与各端 LS_CHAT_HIDDEN 常量一致） */
const CHAT_HIDDEN_KEY: Record<'wx' | 'qq', string> = { wx: 'wx-chat-hidden', qq: 'qq-chat-hidden' };

/** localStorage 字符串数组读写（与 wechat.tsx/qq.tsx 本地 loadStrList/saveStrList 同格式） */
function removeStrListItem(key: string, value: string): void {
  try {
    const raw = window.localStorage.getItem(key);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return;
    const next = arr.filter((x) => x !== value);
    if (next.length === arr.length) return;
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // 隐藏列表读不到/写不进都不影响消息落库
  }
}

/** 生成文本清洗：剥 AI 可能顺手带出的动作/卡片标记（跨 App 找只应是纯文本消息） */
const REACH_MARK_RE =
  /\[(?:申请解除拉黑|解除拉黑|拉黑|同意解除拉黑|拒绝解除拉黑|领取红包|退回红包|拒收红包|收款转账|退回转账|拒收转账|收下亲属卡|拒收亲属卡|禁言|解禁|取消禁言|移出群聊|踢出群聊|移出|踢出|改群名|修改群名|改公告|修改公告|更新公告|创建群聊|建群|邀请进群|拉进群|拉人进群|邀请|任命管理员|设管理员|拉回群聊|设为管理员|转让群主|放弃邀请|换朋友圈背景|选图设头像|选图设背景|选图发送|换头像|存相册|红包|转账|亲属卡|位置|表情包|表情|语音通话|图片|语音|转发|聊天记录)(?:[:：][^\][]*)?\]/g;

function cleanReachText(raw: string): string {
  let t = (raw ?? '').replace(REACH_MARK_RE, ' ');
  t = cleanBubbleText(t).trim();
  // 多行合并成一条自然消息（AI 不听话分了行/段时压成一句话，跨 App 找就是一条消息）
  t = t.replace(/\s*\n+\s*/g, ' ').trim();
  return t.slice(0, 400);
}

/** 落库一条角色消息（结构与各端 loadMsgs 校验器一致；wx/qq role='peer'、sms role='assistant'，封顶 100 条同口径） */
function appendPeerMsg(app: BlockApp, contactId: string, content: string): void {
  const key = msgsKey(app, contactId);
  const raw = kvGet<unknown[]>(key);
  const list = Array.isArray(raw) ? raw.filter((m) => m && typeof m === 'object') : [];
  list.push(
    app === 'sms'
      ? { id: genId(), role: 'assistant', content, time: Date.now() }
      : { id: genId(), role: 'peer', content, time: Date.now() },
  );
  kvSet(key, list.slice(-100));
  // wx/qq：新消息自动恢复被「删除/不显示」的会话行（与各端 saveMsgs 的真微信行为一致）
  if (app !== 'sms') removeStrListItem(CHAT_HIDDEN_KEY[app], contactId);
}

/** 弹灵动岛通知（点击直达该会话；免打扰会话由 pushChatNotification 内部闸门兜住） */
function notifyReach(app: BlockApp, contact: ContactRecord, content: string, userName: string): void {
  try {
    pushChatNotification({
      sessionKey: app === 'sms' ? `sms:c:${contact.id}` : `${app}:${contact.id}`,
      app: NOTIFY_APP_OF[app],
      title: contact.name || '对方',
      body: content,
      avatar: avatarFor(contact, app),
      target: { app: NOTIFY_APP_OF[app], contactId: contact.id },
    });
  } catch {
    // 通知失败不影响落库（用户进会话仍能看到消息）
  }
}

/** 组 system prompt：人设 + 记忆 + 跨 App 近况 + 时间感知（与四端聊天同源模块） */
async function buildReachSystem(
  targetApp: BlockApp,
  contact: ContactRecord,
  userName: string,
  userRealName: string | null,
  userNickname: string | null,
): Promise<string> {
  const persona = buildPersonaSystemPrompt(contact, {
    channel: BLOCK_CHANNEL[targetApp],
    userName: userName || null,
    userRealName,
    userNickname,
    multiApp: getMemSettings(contact.id).share,
    extraRules: [
      '你此刻正在主动给 TA 发消息（不是回复），直接开口说话。',
      '一条消息只说一件事，长度像真人随手打出的一句话或两句话，不要长篇大论。',
    ],
  });
  const [memoryBlock, crossAppBlock] = await Promise.all([
    Promise.resolve(memRecallBlock(contact.id, targetApp, '')),
    buildCrossAppBlock(contact.id, targetApp, userName),
  ]);
  const timeBlock = buildTimeAwareBlock({ lastMsgTime: null, regionHint: contact.region || null });
  return [persona, memoryBlock, crossAppBlock, timeBlock].filter(Boolean).join('\n\n');
}

/** 生成并在单个目标 App 落库（任一步失败静默放弃该 App，不影响其他目标） */
async function reachOne(
  targetApp: BlockApp,
  blockedApp: BlockApp,
  contact: ContactRecord,
  userName: string,
  userRealName: string | null,
  userNickname: string | null,
): Promise<void> {
  // 前置复核：目标 App 也被拉黑（或生成准备期间刚被拉黑）→ 放弃（去了也发不出）
  if (loadBlock(targetApp, contact.id).byUser === true) return;

  const system = await buildReachSystem(targetApp, contact, userName, userRealName, userNickname);
  const userContent = [
    `【重要情境】用户刚刚在「${BLOCK_CHANNEL[blockedApp]}」上把你拉黑了。`,
    `- 你在${BLOCK_CHANNEL[blockedApp]}发的任何消息 TA 都收不到（系统直接拦截）。`,
    `- 所以你来到「${BLOCK_CHANNEL[targetApp]}」——这是另一个独立的聊天 App，TA 在这里没有拉黑你，你的消息 TA 看得到。`,
    `- 你决定在这里主动发一条消息找 TA。让这条消息自然地体现「${BLOCK_CHANNEL[blockedApp]}被拉黑了，所以来${BLOCK_CHANNEL[targetApp]}找 TA」这件事。`,
    `- 用你的人设和你们的关系来写：质问、委屈、赌气、挽留、装作若无其事都可以——按你此刻最真实的反应来。`,
    `- 结合你们最近的聊天和你记得的事，让这条消息有来处，像真人会说的话。`,
    `只输出这一条消息的正文本身：不要输出任何 [标记]，不要分多条，不要动作描写，不要括号说明。`,
  ].join('\n');

  let raw = '';
  try {
    // 生成链路与 bg 接力同款两级兜底：先按用户配置的原链路（上游代理/内置模型），
    // 失败（502/上游断网/空回复）再用内置模型（forceSdk）兜一次——浏览器直连（directOnly
    // SSE）不做：跨 App 找是后台增强，直连链路复杂度不值得，内置模型兜底已足够可靠
    const call = async (extra: Record<string, unknown>): Promise<string> => {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userContent },
          ],
          ...extra,
        }),
        signal: AbortSignal.timeout(75_000),
      });
      return res.ok ? await res.text() : '';
    };
    raw = await call({ config: useSettings.getState().apiConfig });
    if (!raw.trim()) {
      try {
        raw = await call({ forceSdk: true });
      } catch {
        raw = '';
      }
    }
  } catch {
    return; // 生成失败静默放弃该 App
  }
  const content = cleanReachText(raw);
  if (!content) return;

  // 落库前再复核一次（生成期间目标 App 可能刚被拉黑）
  if (loadBlock(targetApp, contact.id).byUser === true) return;

  appendPeerMsg(targetApp, contact.id, content);
  notifyReach(targetApp, contact, content, userName);
}

/**
 * 拉黑事件入口：角色被用户在 blockedApp 拉黑（跃迁时刻）→ 立刻到其余未拉黑的 App 各找一轮。
 * fire-and-forget：调用方（block-state.setUserBlock）不等待、不感知失败。
 */
export function triggerCrossAppReach(blockedApp: BlockApp, contactId: string): void {
  if (!contactId) return;
  const key = `${blockedApp}:${contactId}`;
  if (running.has(key)) return;
  running.add(key);
  void runReach(blockedApp, contactId)
    .catch(() => undefined)
    .finally(() => {
      running.delete(key);
    });
}

async function runReach(blockedApp: BlockApp, contactId: string): Promise<void> {
  const contact = await getContact(contactId).catch(() => null);
  if (!contact || contact.kind === 'user') return;
  if (!(contact.persona ?? '').trim()) return; // 没人设的角色不生成（与主动来电候选同口径）
  const targets = (['wx', 'qq', 'sms'] as BlockApp[]).filter(
    (a) => a !== blockedApp && loadBlock(a, contactId).byUser !== true,
  );
  if (targets.length === 0) return; // 三个 App 全被拉黑：无处可去（群聊按设计不参与拉黑）
  let owner: { realName?: string | null; nickname?: string | null } | null = null;
  try {
    owner = await ownerProfile();
  } catch {
    owner = null;
  }
  const userRealName = owner?.realName?.trim() || null;
  const userNickname = owner?.nickname?.trim() || null;
  const userName = userNickname || userRealName || '用户';
  await Promise.allSettled(targets.map((t) => reachOne(t, blockedApp, contact, userName, userRealName, userNickname)));
}
