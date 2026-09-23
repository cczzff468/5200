/** 测试工具集：send（填输入框并发送）、ui（查询页面状态）、kv（读 IndexedDB kv） */
(() => {
  window.__fill = (sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return 'no-el:' + sel;
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'filled';
  };
  window.__click = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return 'no-el:' + sel;
    el.click();
    return 'clicked';
  };
  window.__fillInput = (sel, text) => {
    const i = document.querySelector(sel);
    if (!i) return 'no-input';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, text);
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return 'filled';
  };
  window.__sendWx = (text) => {
    const r = window.__fillInput('[data-testid="wx-chat-input"]', text);
    if (r !== 'filled') return r;
    return new Promise((res) => setTimeout(() => {
      const s = document.querySelector('[data-testid="wx-chat-send"]');
      if (!s) { res('no-send-btn'); return; }
      s.click();
      res('sent');
    }, 150));
  };
  window.__chatState = (prefix) => {
    const rows = [...document.querySelectorAll('[data-mid]')];
    const badges = [...document.querySelectorAll(`[data-testid$="-block-badge-me"],[data-testid$="-block-badge-peer"]`)]
      .filter((b) => b.getAttribute('data-testid').startsWith(prefix))
      .map((b) => b.getAttribute('data-testid') + ':' + b.textContent.trim());
    const sys = [...document.querySelectorAll(`[data-testid="${prefix}-sys-row"]`)].map((e) => e.textContent.trim());
    const req = document.querySelector(`[data-testid="${prefix}-blockreq-card"]`);
    const stream = document.querySelector(`[data-testid="${prefix}-stream-bubble"]`);
    return JSON.stringify({ msgs: rows.length, last: rows.slice(-2).map((r) => r.textContent.slice(0, 26)), badges, sys, hasReq: !!req, reqText: req ? req.textContent.slice(0, 60) : null, streaming: !!stream });
  };
  window.__kvGet = (key) => new Promise((res) => {
    const r = indexedDB.open('ios-phone-db');
    r.onsuccess = () => {
      const db = r.result;
      const req = db.transaction('kv').objectStore('kv').get(key);
      req.onsuccess = () => { db.close(); res(JSON.stringify(req.result ? req.result.value : null)); };
      req.onerror = () => { db.close(); res('err'); };
    };
    r.onerror = () => res('err');
  });
  return 'util-ready';
})()
