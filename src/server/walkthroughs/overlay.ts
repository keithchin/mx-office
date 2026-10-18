// The annotations a walkthrough video shows, drawn by the app's page itself while it's recorded: a caption
// bar with the step's words, a step counter, a chapter card at the start, and a highlight box around what's
// about to be clicked or typed into. Injected before any of the app's own scripts (addInitScript) and kept
// in a shadow root of its own, so the app's CSS can't touch it and the journey's text checks never read it
// (innerText doesn't go into shadow roots). Nothing is random and nothing animates by time alone, so the
// same run draws the same frames. Plain JavaScript in a string: it runs in the app's page, not here.

export const OVERLAY_HOST = '__wt-host';

export const OVERLAY_SCRIPT = `(() => {
  if (window.__wt) return;
  const HOST = '${OVERLAY_HOST}';
  let root = null;
  const pending = [];
  const css = [
    ':host{all:initial}',
    '.wrap{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:500 18px/1.35 "Segoe UI",system-ui,sans-serif}',
    '.cap{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);max-width:80%;background:rgba(17,24,39,.88);color:#fff;padding:10px 18px;border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.35);display:none}',
    '.cap.fail{background:rgba(153,27,27,.92)}',
    '.count{position:absolute;right:18px;top:16px;background:rgba(17,24,39,.8);color:#fff;font-size:14px;padding:4px 10px;border-radius:999px;display:none}',
    '.chapter{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(15,23,42,.86);color:#fff;text-align:center}',
    '.chapter h1{font-size:34px;margin:0 0 10px}',
    '.chapter p{font-size:18px;margin:0;opacity:.85}',
    '.hl{position:absolute;border:3px solid #f59e0b;border-radius:6px;box-shadow:0 0 0 4000px rgba(0,0,0,.12);display:none}',
  ].join('');
  function mount() {
    if (root && document.documentElement.contains(root.host)) return root;
    const host = document.createElement('div');
    host.id = HOST;
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<style>' + css + '</style><div class="wrap"><div class="hl"></div><div class="count"></div><div class="cap"></div><div class="chapter"><div><h1></h1><p></p></div></div></div>';
    document.documentElement.appendChild(host);
    root = sr;
    return sr;
  }
  function q(sel) { return mount().querySelector(sel); }
  function show(el, on, display) { el.style.display = on ? (display || 'block') : 'none'; }
  const api = {
    chapter(title, sub) {
      q('.chapter h1').textContent = title || '';
      q('.chapter p').textContent = sub || '';
      show(q('.chapter'), !!title, 'flex');
    },
    step(n, total, text, failed) {
      api.chapter('');
      const c = q('.count');
      c.textContent = 'Step ' + n + ' of ' + total;
      show(c, true);
      const cap = q('.cap');
      cap.textContent = text;
      cap.className = failed ? 'cap fail' : 'cap';
      show(cap, true);
    },
    highlight(box) {
      const h = q('.hl');
      if (!box) return show(h, false);
      h.style.left = (box.x - 6) + 'px';
      h.style.top = (box.y - 6) + 'px';
      h.style.width = (box.width + 12) + 'px';
      h.style.height = (box.height + 12) + 'px';
      show(h, true);
    },
    state() {
      const r = mount();
      const vis = (s) => r.querySelector(s).style.display !== 'none' && r.querySelector(s).style.display !== '';
      return { caption: r.querySelector('.cap').textContent, counter: r.querySelector('.count').textContent, chapter: r.querySelector('.chapter h1').textContent, highlight: vis('.hl'), captionShown: vis('.cap') };
    },
  };
  // Calls before the page has a document element wait for it.
  const ready = () => document.documentElement;
  window.__wt = new Proxy(api, { get(t, k) { return (...a) => { if (ready()) return t[k](...a); pending.push([k, a]); }; } });
  const flush = () => { while (pending.length && ready()) { const [k, a] = pending.shift(); api[k](...a); } };
  document.addEventListener('DOMContentLoaded', flush);
  // The app re-rendering the whole document (a Mendix page load) can drop the host: put it back.
  new MutationObserver(() => { if (root && !document.documentElement.contains(root.host)) document.documentElement.appendChild(root.host); }).observe(document, { childList: true, subtree: false });
})();`;
