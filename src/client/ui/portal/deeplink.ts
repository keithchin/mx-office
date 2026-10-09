// `&open=studio` on the 1D view's address: what Home's Portal project card ⋯ › Edit in Studio Pro links
// to. Once the floor the address names is the one you're on, it asks to open the project in Studio Pro
// (ui/studio/: the same checks and the same confirmation as the Command Center's button), and takes
// itself out of the address so a reload doesn't ask again.

import { store } from '../../state';
import { askedFloor, setAddress } from '../../shared/address';
import { openStudio } from '../studio';

export function portalDeepLinks() {
  if (new URLSearchParams(location.search).get('open') !== 'studio') return;
  setAddress({ open: null });
  const off = store.on('project', () => {
    if (!store.project || (askedFloor && store.floor !== askedFloor)) return;
    off();
    void openStudio();
  });
}
