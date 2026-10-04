(() => {
  const s = document.querySelector('[data-testid="wx-video-screen"]');
  const dur = document.querySelector('[data-testid="wx-video-duration"]')?.textContent;
  return JSON.stringify({onCall: !!s, dur});
})()
