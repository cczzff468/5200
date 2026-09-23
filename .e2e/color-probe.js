/** 锁屏前景色首帧记录器：从第一帧起每 rAF 采样 [data-lock-fg] 与大时钟的计算色，
 * 只在颜色/标记变化时记一条（带时间戳），用于断言「黑→白」闪烁是否消失 */
(function () {
  if (window.__colorLog) return;
  window.__colorLog = [];
  function sample() {
    try {
      var fg = document.querySelector('[data-lock-fg]');
      var clock = document.querySelector('[data-ssr-clock]');
      var html = document.documentElement;
      if (fg) {
        var cs = getComputedStyle(fg).color;
        var entry = {
          t: Math.round(performance.now()),
          fg: cs,
          clock: clock ? getComputedStyle(clock).color : null,
          bootLight: html.hasAttribute('data-boot-lock-light'),
          bootDark: html.hasAttribute('data-boot-lock-dark'),
          loaded: !!(window.__colorLog && window.__loadedFlag),
        };
        var log = window.__colorLog;
        var last = log[log.length - 1];
        if (!last || last.fg !== entry.fg || last.bootLight !== entry.bootLight || last.bootDark !== entry.bootDark || last.clock !== entry.clock) {
          log.push(entry);
        }
      }
    } catch (e) {}
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
})();
