// The page's state: the store (./store.ts), made of the core and every slice (./slices), and what this
// browser remembers between visits (./persist.ts).

import { SLICES } from './slices';
import { Store } from './store';

export { AVATAR_COLORS, lastFloor, loadProfile, loadSettings, saveProfile, saveSettings } from './persist';
export type { Profile, Settings } from './persist';
export { workerForPull } from './store';
export type { ScreenState, Slice, Store, Topic, Topics } from './store';

export const store = new Store(SLICES);
