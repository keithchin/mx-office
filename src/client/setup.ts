// 🚀 First-run setup (/setup): a new office's first steps, for its admin (first-run/page.ts). A page of
// its own with plain fetches only: no socket.
import { $ } from './ui/dom';
import { colorThemes } from './ui/colortheme';
import { setupPage } from './first-run/page';
import { portalBar } from './ui/portal/topbar';

colorThemes($('theme'));
// The Portal themes' navy bar, minimal: this page may come before the office has anything to search or list.
portalBar({ section: 'Setup', minimal: true });
setupPage($('setup'));
