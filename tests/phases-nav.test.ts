// A tab listed only when it applies (tabs/registry.ts `shown`): the Roadmap is in the navigation only for a
// project with phases. The navigation hears tabVisibilityChanged and draws its items again; ?tab= still knows it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { onTabVisibility, registerTab, tabShown, tabVisibilityChanged } from '../src/client/tabs/registry.js';
import { navGroups, navItem, visibleItems } from '../src/client/ui/portal/nav-logic.js';

test('a registered tab with shown() is in its group, listed only while shown() says so, and the navigation hears the change', () => {
  let on = false;
  registerTab({ id: 'phasetest', group: 'pm', label: 'Phase test', tooltip: 't', shown: () => on, mount: () => ({}) });
  const pm = () => navGroups().find((g) => g.id === 'pm')!;
  assert.ok(pm().items.some((i) => i.id === 'phasetest'), 'still one item of its group (deep links, the header)');
  assert.ok(!visibleItems(pm(), true).some((i) => i.id === 'phasetest'));
  assert.equal(tabShown('phasetest'), false);
  assert.equal(tabShown('board'), true, 'built-in tabs always');
  let heard = 0;
  const off = onTabVisibility(() => heard++);
  on = true;
  tabVisibilityChanged();
  assert.equal(heard, 1);
  assert.ok(visibleItems(pm(), false).some((i) => i.id === 'phasetest'));
  assert.equal(navItem('phasetest')?.label, 'Phase test');
  off();
  tabVisibilityChanged();
  assert.equal(heard, 1);
});
