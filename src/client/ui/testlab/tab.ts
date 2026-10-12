// 🧪 Test mode as a project tab of the 1D view (Monitoring › Tests, admins only in the navigation), from
// the tab registry (tabs/registry.ts). No button in the classic tab row: the ☰, the home page and
// ⚙️ Settings › Testing open it (/lite?tab=tests).

import { registerTab } from '../../tabs/registry';
import { testlabView } from './index';

registerTab({
  id: 'tests',
  group: 'monitor',
  label: 'Tests',
  tooltip: 'Test mode: the suites, their runs and results',
  icon: '🧪',
  admin: true,
  mount: (container) => testlabView(container),
});
