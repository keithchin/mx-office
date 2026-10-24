// Approve possible data impact (server/data-impact/): a compact dialog, ✕ top right, ✕ or Esc gives focus back
// to the button that opened it. It names what the approval binds (the live preview, the revision it runs, the
// candidate, the recovery evidence: a change to any of them voids it), asks for a recovery step (a database
// dump of the live preview, taken here and checked by the office, or the explicit "no data to keep") and a
// reason. Approve stays off until both are given; a refusal (no permission, the hold moved) is said in place.

import { NO_DATA_STATEMENT, type DataImpactView, type DumpRecord } from '../../../shared/data-impact';
import { h, openModal, toast } from '../dom';

const short = (sha?: string) => sha?.slice(0, 7) ?? '';
const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

type Answer = { ok: boolean; data: { error?: string; dump?: DumpRecord; view?: DataImpactView } };

async function post(body: Record<string, unknown>): Promise<Answer> {
  const res = await fetch('/api/data-impact', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as { error?: string; dump?: DumpRecord; view?: DataImpactView } };
}

export function openApproveDialog(v: DataImpactView, done: () => void) {
  const held = v.held;
  if (!held) return;
  // A dump is of the live preview's database: for a candidate or an external push only "no data to keep" (or a dump taken for that binding) can be the recovery step.
  const live = held.env === 'live-preview';
  const back = document.activeElement as HTMLElement | null;
  let dumps = [...v.dumps];
  let pick: string = dumps[0]?.id ?? '';
  let mode: 'dump' | 'none' | '' = dumps.length ? 'dump' : '';
  const msg = h('p.di-msg', { role: 'status', 'aria-live': 'polite' });
  const reason = h('textarea.di-reason', { rows: 3, maxlength: 500, 'aria-label': 'Reason', placeholder: 'Why this change may go ahead (e.g. the notes were moved to the new Comment entity first)' }) as HTMLTextAreaElement;
  const approve = h('button.btn.primary', { type: 'button', disabled: true }, 'Approve') as HTMLButtonElement;
  const dumpRadio = h('input', { type: 'radio', name: 'di-recovery', value: 'dump' }) as HTMLInputElement;
  const noneRadio = h('input', { type: 'radio', name: 'di-recovery', value: 'none' }) as HTMLInputElement;
  const noneCheck = h('input', { type: 'checkbox', class: 'di-none-check' }) as HTMLInputElement;
  const take = h('button.btn.di-take', { type: 'button' }, 'Take a database dump now') as HTMLButtonElement;
  const dumpList = h('div.di-dumps');

  const valid = () => reason.value.trim().length >= 3 && ((mode === 'dump' && !!pick) || (mode === 'none' && noneCheck.checked));
  const paint = () => {
    dumpRadio.checked = mode === 'dump';
    noneRadio.checked = mode === 'none';
    approve.disabled = !valid();
    dumpList.replaceChildren(
      ...dumps.map((d) => {
        const r = h('input', { type: 'radio', name: 'di-dump', value: d.id }) as HTMLInputElement;
        r.checked = d.id === pick;
        r.onchange = () => ((pick = d.id), (mode = 'dump'), paint());
        return h('label.di-dump', {}, r, ` ${d.path} · ${size(d.size)} · sha256 ${d.sha256.slice(0, 12)}… · ${d.verified} · ${d.by.name}`);
      }),
    );
  };
  dumpRadio.onchange = () => ((mode = 'dump'), paint());
  noneRadio.onchange = () => ((mode = 'none'), paint());
  noneCheck.onchange = () => (noneCheck.checked && (mode = 'none'), paint());
  reason.oninput = paint;
  take.onclick = async () => {
    take.disabled = true;
    msg.textContent = 'Taking a dump of the live preview’s database… (the app keeps running)';
    const r = await post({ floor: v.floor, action: 'dump' }).catch((err: Error): Answer => ({ ok: false, data: { error: err.message } }));
    take.disabled = false;
    if (!r.ok || !r.data.dump) return void (msg.textContent = r.data.error ?? 'The dump failed');
    dumps = [r.data.dump, ...dumps];
    pick = r.data.dump.id;
    mode = 'dump';
    msg.textContent = `Dump taken and checked: ${r.data.dump.verified}.`;
    paint();
  };

  take.hidden = !live;
  const body = h(
    'div.body.di-body',
    {},
    h('p.di-bind', {}, `This approval is for ${live ? 'the live preview' : held.env.startsWith('candidate:') ? `${held.env.slice(10)}’s candidate` : `the push to ${held.env.slice(9)}`} ${live ? 'running' : 'from'} ${short(held.base)}, taking ${short(held.target)}, with the recovery step below. If any of these change, it no longer counts and the change is looked at again.`),
    h('fieldset.di-recovery', {}, h('legend', {}, 'Recovery step'), h('label', {}, dumpRadio, ' A database dump was taken'), h('div.di-dump-box', {}, take, dumpList), h('label', {}, noneRadio, ' There is no data to keep'), h('label.di-none', {}, noneCheck, ` ${NO_DATA_STATEMENT}`)),
    h('label.di-reason-l', {}, 'Reason', reason),
  );
  const content = h('div.modal.di-modal', { role: 'dialog', 'aria-label': 'Approve possible data impact' }, h('header', {}, h('h2', {}, `Approve possible data impact at ${short(held.target)}`)), body, h('footer', {}, msg, approve));
  const modal = openModal(content, { onClose: () => back?.focus?.() });
  approve.onclick = async () => {
    if (!valid()) return;
    approve.disabled = true;
    const r = await post({ floor: v.floor, action: 'approve', env: held.env, base: held.base, target: held.target, reason: reason.value, ...(mode === 'dump' ? { dump: pick } : { noData: true }) }).catch((err: Error): Answer => ({ ok: false, data: { error: err.message } }));
    if (!r.ok) {
      msg.textContent = r.data.error ?? 'Not approved';
      approve.disabled = !valid();
      return;
    }
    toast(live ? `Approved: the live preview takes ${short(held.target)} now` : `Approved for ${held.env} (${short(held.target)})`);
    modal.close();
    done();
  };
  paint();
  reason.focus();
}
