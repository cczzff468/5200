/**
 * AI 回复逐条投递调度器（模拟真人连发）：
 * finalize 解析出的多条消息不再一次性落盘上屏，而是按真人打字节奏逐条投递——
 * 每条到达时才落盘（IndexedDB/localStorage）+ 弹灵动岛通知 + 语音频率判定，
 * 每条投递后广播 tick，让聊天页把新落盘的消息合并进本地 state。
 *
 * 调度器在模块层运行，与聊天页是否存活无关（退出聊天页/切 App 都继续投递，重进后无缝接上）。
 * 同一会话的批次串行排队（上一批投完才跑下一批），保证多轮/群聊多角色的消息上屏顺序与落盘顺序一致。
 */

/** 单批投递选项 */
export interface AiDeliveryOptions {
  /** 第 index 条（0 起）与上一条之间的停顿 ms（首条之前是首延迟）；缺省按内容长度模拟打字节奏 */
  delay?: (index: number, total: number) => number;
}

interface Batch {
  items: readonly unknown[];
  deliver: (item: unknown, index: number) => void;
  opts?: AiDeliveryOptions;
  resolve: () => void;
}

/** 每会话待投递批次队列（首批 = 正在跑） */
const queues = new Map<string, Batch[]>();
/** 会话是否正在投递（队列非空或当前批未跑完） */
const running = new Set<string>();
/** 每条投递后的 tick 订阅（聊天页用：把新落盘消息合并进本地 state） */
const tickListeners = new Map<string, Set<() => void>>();
/** 投递状态变化订阅（聊天页用：「正在输入」指示） */
const activeListeners = new Set<() => void>();

/** 默认停顿：各端通常传 typingDelayOf 按内容长度模拟打字；这里给一个保守的通用节奏 */
function defaultDelay(): number {
  return 700 + Math.random() * 600;
}

/** 按内容长度估算停顿（各端文字消息用；卡片类消息走默认） */
export function typingDelayOf(text: string): number {
  const len = text.trim().length;
  return Math.min(2400, 850 + len * 45 + Math.random() * 400);
}

function emitActive(): void {
  for (const fn of activeListeners) fn();
}

function emitTick(sessionKey: string): void {
  const set = tickListeners.get(sessionKey);
  if (!set) return;
  for (const fn of [...set]) fn();
}

/** 泵：跑掉队列里的一批；批内逐条 setTimeout 链式投递 */
function pump(sessionKey: string): void {
  const queue = queues.get(sessionKey);
  const batch = queue?.[0];
  if (!batch) {
    running.delete(sessionKey);
    emitActive();
    return;
  }
  const { items, deliver, opts, resolve } = batch;
  const delayOf = opts?.delay ?? defaultDelay;
  let index = 0;
  const step = (): void => {
    // 批可能被 flush 清空：每步重新校验
    const q = queues.get(sessionKey);
    if (!q || q[0] !== batch) {
      resolve();
      pump(sessionKey);
      return;
    }
    if (index >= items.length) {
      q.shift();
      resolve();
      pump(sessionKey);
      return;
    }
    const item = items[index];
    try {
      deliver(item, index);
    } catch {
      // 单条投递异常不阻断后续（与逐条落盘的容错口径一致）
    }
    emitTick(sessionKey);
    index += 1;
    const wait = Math.max(0, Math.round(delayOf(index - 1, items.length)));
    window.setTimeout(step, wait);
  };
  running.add(sessionKey);
  emitActive();
  step();
}

/**
 * 调度一批逐条投递；同一会话的批次串行排队（上一批投完才跑本批）。
 * 返回的 Promise 在本批全部投递完（且此前排队的同会话批次也投完）时 resolve——
 * 记忆提取等「一轮结束」动作挂在它后面，保证读到完整落盘数据。
 */
export function scheduleAiDelivery<T>(
  sessionKey: string,
  items: readonly T[],
  deliver: (item: T, index: number) => void,
  opts?: AiDeliveryOptions
): Promise<void> {
  if (items.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let queue = queues.get(sessionKey);
    if (!queue) {
      queue = [];
      queues.set(sessionKey, queue);
    }
    queue.push({
      items,
      deliver: deliver as (item: unknown, index: number) => void,
      opts,
      resolve,
    });
    if (!running.has(sessionKey)) pump(sessionKey);
  });
}

/** 该会话是否正在投递（含排队中的批次）——聊天页用来显示「正在输入」 */
export function isAiDelivering(sessionKey: string): boolean {
  return running.has(sessionKey) || (queues.get(sessionKey)?.length ?? 0) > 0;
}

/** 订阅每条投递后的 tick（返回退订函数） */
export function subscribeAiDelivery(sessionKey: string, cb: () => void): () => void {
  let set = tickListeners.get(sessionKey);
  if (!set) {
    set = new Set();
    tickListeners.set(sessionKey, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
    if (set && set.size === 0) tickListeners.delete(sessionKey);
  };
}

/** 订阅投递状态变化（任意会话开始/结束投递时触发；返回退订函数） */
export function subscribeAiDeliveryActive(cb: () => void): () => void {
  activeListeners.add(cb);
  return () => activeListeners.delete(cb);
}
