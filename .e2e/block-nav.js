/** 导航辅助：__unlock（上滑解锁）+ __goto（解锁并打开指定 App；不在当前页时走 Spotlight 搜索） */
(() => {
  window.__unlock = async () => {
    const lockEl = [...document.querySelectorAll('p')].find((e) => e.textContent.trim() === '向上轻扫以解锁');
    if (!lockEl) return 'no-lock';
    const opts = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'touch' };
    lockEl.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: 195, clientY: 760 }));
    for (let i = 1; i <= 9; i++) {
      lockEl.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: 195, clientY: 760 - i * 22 }));
      await new Promise((r) => setTimeout(r, 16));
    }
    lockEl.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: 195, clientY: 560 }));
    await new Promise((r) => setTimeout(r, 600));
    return document.querySelector('[aria-label="锁屏"]') ? 'still-locked' : 'unlocked';
  };
  window.__goto = async (name) => {
    await window.__unlock();
    let btn = [...document.querySelectorAll('button')].filter((b) => b.getAttribute('aria-label') === `打开${name}`)[0];
    if (!btn) {
      const searchBtn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '搜索应用');
      if (!searchBtn) return 'no-search-btn';
      searchBtn.click();
      await new Promise((r) => setTimeout(r, 450));
      btn = [...document.querySelectorAll('button')].filter((b) => b.getAttribute('aria-label') === `打开${name}`)[0];
      if (!btn) return `no-app-${name}`;
    }
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    await new Promise((r) => setTimeout(r, 800));
    return `opened-${name}`;
  };
  return 'nav-ready';
})()
