// Opens the new-project wizard, loading its code only then: nothing of it is in a page's start-up bundle.
import type { WizardOptions } from './index';

export const openWizard = (opts: WizardOptions): Promise<void> => import('./index').then((m) => m.openWizard(opts));
