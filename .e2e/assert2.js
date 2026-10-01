(() => {
  const msgs = [...document.querySelectorAll('[data-testid="wx-call-textbar"] p')].map(p => p.textContent.trim()).filter(Boolean);
  const header = !!document.querySelector('[data-testid="call-chat-header"]');
  const center = document.querySelector('[data-testid="wx-call-status"]') ? 'visible' : 'hidden';
  const mic = !!document.querySelector('[data-testid="wx-call-mic"]');
  const hangup = !!document.querySelector('[data-testid="wx-call-hangup"]');
  const spk = !!document.querySelector('[data-testid="wx-call-speaker"]');
  return JSON.stringify({header, center, msgs: msgs.slice(-4), mic, hangup, spk});
})()
