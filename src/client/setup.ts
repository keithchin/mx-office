// 🚀 First-run setup (/setup): a new office's first steps, for its admin (first-run/page.ts). A page of
// its own with plain fetches only: no socket, no three.js.
import { $ } from './ui/dom';
import { colorThemes } from './ui/colortheme';
import { setupPage } from './first-run/page';

colorThemes($('theme'));
setupPage($('setup'));
