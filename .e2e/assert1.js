(() => {
  const msgs = [...document.querySelectorAll('[data-testid="wx-call-textbar"] p')].map(p => p.textContent.trim()).filter(Boolean);
  const header = !!document.querySelector('[data-testid="call-chat-header"]');
  const headerText = document.querySelector('[data-testid="call-chat-header"]')?.textContent;
  const dur = document.querySelector('[data-testid="wx-video-duration"]')?.textContent;
  const btns = ['wx-video-mic','wx-video-speaker','wx-video-cam','wx-video-hangup'].map(t => !!document.querySelector('[data-testid="'+t+'"]'));
  const centerAvatar = !!document.querySelector('[data-testid="wx-video-screen"] img[alt="小雪的画面"]');
  const input = document.querySelector('[data-testid="wx-call-textbar-input"]') ? 'ok' : 'missing';
  return JSON.stringify({header, headerText, dur, msgs: msgs.slice(0,6), btns, centerAvatar, input});
})()
