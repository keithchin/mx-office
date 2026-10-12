// The registration index of the project tabs (./registry.ts): one line per feature tab module, each of
// which calls registerTab when it's loaded. The page (./host.ts) loads this first, so every tab is
// registered before lite.ts reads ?tab= or draws the navigation. A new tab goes at the end; within a
// group, a tab without an `order` follows the ones above it here.

import '../ui/testlab/tab';
