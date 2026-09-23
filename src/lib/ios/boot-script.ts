/**
 * 首帧直出内联脚本（layout.tsx 注入 <body> 开头/结尾）：
 *
 * 为什么需要它：显示设置的真值在 localStorage / IndexedDB（客户端），服务端只有 cookie。
 * 而预览面板是跨站 iframe —— 第三方上下文里 samesite=lax cookie 写不进去，
 * 服务端永远拿到默认快照 → 首帧渲染 graphite/light → 水合后 load() 换成真实设置，
 * 观感就是「锁屏闪烁、壁纸卡 2 秒才显示」。
 *
 * 解法：localStorage 镜像（跨站 iframe 里也可写）+ 本脚本在首帧绘制前完成——
 *  1) html 背板色 = 真实壁纸底色（无白/黑闪）；
 *  2) PNG 壁纸 <link rel=preload>（图片请求从 HTML 解析期开始，不等 React 水合）；
 *  3) 壁纸层 CSS 变量（--ios-boot-*：预设或自定义 dataURL）→ 首帧直出真实壁纸；
 *  4) 深色主题 html.dark（auto 按系统偏好 matchMedia 即时判定）；
 *  5) 锁屏总开关关闭 → html[data-lock-off]，配 globals.css 规则首帧隐藏 SSR 锁屏；
 *  6) window.__IOS_DISPLAY__ 全局 → PhoneShell 客户端首渲染优先用它注水（cookie prop 兜底）。
 *
 * 尾部脚本（children 之后）：按镜像时区修正 SSR 时钟文本（iframe 里没有 cookie，
 * 服务端只能按本机时区（UTC）渲染，差 8 小时；水合后 useNow 接管，此脚本补齐前 ~1s 空窗）。
 *
 * 全部 try/catch 静默：脚本失败 = 退回「默认快照首帧 + load() 后换真」的旧行为，绝不白屏。
 */

import { bootPresetTableJson } from './wallpaper-presets';

export function buildHeadBootScript(): string {
  return `(function(){
try {
  var T=${bootPresetTableJson()};
  function parseJson(s){try{return JSON.parse(s);}catch(e){return null;}}
  function valid(s){return s&&((s.theme==='light'||s.theme==='dark'||s.theme==='auto')&&typeof s.wallpaper==='string'&&typeof s.lockWallpaper==='string'&&typeof s.lockScreen==='boolean');}
  function lsSnap(){var s=null;try{s=parseJson(localStorage.getItem('ios-display')||'null');}catch(e){}return valid(s)?s:null;}
  function cookieSnap(){
    var m=/(?:^|;\\s*)ios-display=([^;]*)/.exec(document.cookie||'');
    if(!m)return null;var raw=m[1];
    try{raw=decodeURIComponent(raw);}catch(e){}
    return valid(parseJson(raw))?parseJson(raw):null;
  }
  var snap=lsSnap()||cookieSnap();
  if(snap)window.__IOS_DISPLAY__=snap;
  var wc=null;try{wc=parseJson(localStorage.getItem('ios-display-wall')||'null');}catch(e){}
  if(wc&&wc.v===1)window.__IOS_DISPLAY_WALL__=wc;
  var html=document.documentElement;
  function presetOf(id){return T[id]||T.graphite||null;}
  var lockOn=snap?(snap.lockScreen!==false):true;
  var wallId=snap?snap.wallpaper:'graphite';
  var lockId=snap?snap.lockWallpaper:'graphite';
  var front=presetOf(lockOn?lockId:wallId);
  function preload(id){var p=presetOf(id);if(!p||!p.img)return;
    var l=document.createElement('link');l.rel='preload';l.as='image';l.href=p.img;l.setAttribute('fetchpriority','high');
    document.head.appendChild(l);}
  preload(lockId);if(!lockOn)preload(wallId);
  if(!snap)return;
  /* 背板色与壁纸变量一律写进 <head> 的 <style> 标签（:root 规则 + !important 背板）。
     【不能写 html 内联 style】—— React 19 水合时会把 <html> 的 style 属性重置为它期望的值
     （suppressHydrationWarning 管不住 style），内联变量会在水合瞬间被清空 →
     壁纸层 var() 回退透明 → 透出黑壳 → 等 load() 才恢复 = 「闪一下 + 壁纸卡两秒」。
     <style> 标签不属于 React 管理范围，整个生命周期安全。 */
  var decls=[];
  if(front)decls.push('background-color:'+front.base+'!important');
  function dataUrlOf(kind){try{var e=wc&&wc[kind];return e&&e.d?e.d:null;}catch(e){return null;}}
  function setVars(prefix,id,kind){
    var d=dataUrlOf(kind);var p=presetOf(id);
    if(d){
      decls.push(prefix+'-base:#1c1c1e');
      decls.push(prefix+'-image:url("'+d+'")');
      decls.push(prefix+'-size:cover');
      decls.push(prefix+'-pos:center');
    }else if(p){
      decls.push(prefix+'-base:'+p.base);
      decls.push(prefix+'-image:'+(p.img?'url("'+p.img+'")':p.css));
      if(p.img){decls.push(prefix+'-size:cover');decls.push(prefix+'-pos:center');}
    }
  }
  setVars('--ios-boot-wall',wallId,'home');
  setVars('--ios-boot-lock-wall',lockId,'lock');
  var st=document.createElement('style');
  st.id='ios-boot-style';
  st.textContent=':root{'+decls.join(';')+'}';
  document.head.appendChild(st);
  /* 首帧前景色：锁屏开启且锁屏壁纸偏浅时，SSR（无 cookie）按默认 graphite 画了白字，
     水合后才会变黑字 = 变色闪烁。标记 html 属性让全局 CSS 在首帧就覆盖成黑字
     （PhoneShell load() 后移除标记，前景色交还给实测逻辑）。 */
  if(lockOn&&front&&front.light)html.setAttribute('data-boot-lock-light','');
  var dark=snap.theme==='dark'||(snap.theme==='auto'&&!!(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches));
  if(dark)html.classList.add('dark');
  if(!lockOn)html.setAttribute('data-lock-off','');
} catch(e) {}
})();`;
}

export function buildTailBootScript(): string {
  return `(function(){
try {
  var s=window.__IOS_DISPLAY__;
  if(!s||!s.tz)return;
  var f=new Intl.DateTimeFormat('en-US',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:s.tz});
  var t=f.format(new Date());
  var nodes=document.querySelectorAll('[data-ssr-clock]');
  for(var i=0;i<nodes.length;i++)nodes[i].textContent=t;
} catch(e) {}
})();`;
}
