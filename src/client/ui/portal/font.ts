// The Portal themes' font, Noto Sans, from Google Fonts: asked for once a Portal theme is on, and only
// after the page has loaded, so it never holds up the first paint or the page's load (the pages draw in
// the "AO Portal" system face until it's there, styles/theme-portal.css). A variable font from 400 to
// 600, so nothing is heavier than semibold. With no internet the system face simply stays.

const HREF = 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400..600&display=swap';
let asked = false;

export function loadPortalFont() {
  if (asked || typeof document === 'undefined') return;
  asked = true;
  const add = () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = HREF;
    link.id = 'ao-portal-font';
    document.head.append(link);
  };
  if (document.readyState === 'complete') add();
  else addEventListener('load', add, { once: true });
}
