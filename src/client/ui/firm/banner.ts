// The Firm on a floor's 1D view: a slim banner while an audit runs there ("📑 The Firm is auditing
// this project: 5 reviewers · $12.40 of $60"), "Audit report ready" once it's delivered, and the
// "📑 Call an audit" button otherwise (the wizard is firm/wizard.ts). It fetches the floor's status
// itself, again when the office says the floor's team changed and every so often while one runs.

import { PHASE_LABEL, type FirmFloorStatus } from '../../../shared/firm/engagement';
import type { ServerMsg } from '../../../shared/protocol';
import { fetchFirm, fetchFloorStatus, reportUrl, usd } from '../../firm/api';
import { openAuditWizard } from '../../firm/wizard';
import { h, toast } from '../dom';
import './banner.css';

export interface FirmBanner {
  /** The floor may have changed: fetch again. */
  refresh(floor: string | undefined): void;
  onMessage(msg: ServerMsg): void;
}

export function firmBanner(root: HTMLElement, onStatus?: (s: FirmFloorStatus | undefined) => void): FirmBanner {
  let floor: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function callAudit() {
    try {
      const v = await fetchFirm();
      await openAuditWizard({ floors: v.floors, floor, admin: v.admin, onStarted: () => load() });
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  function draw(s: FirmFloorStatus | undefined) {
    onStatus?.(s);
    if (s?.active) {
      const a = s.active;
      const level = a.spent >= a.budget ? 'cap' : a.spent >= a.budget * 0.8 ? 'warn' : '';
      return root.replaceChildren(
        h('a.firm-strip.active', { href: '/firm', class: level, title: 'Open The Firm: who is reviewing what, live' },
          h('span.firm-strip-ico', { 'aria-hidden': 'true' }, '📑'),
          h('span.firm-strip-text', {}, h('b', {}, 'The Firm is auditing this project'), `: ${a.reviewers} reviewers · ${usd(a.spent)} of ${usd(a.budget)} · ${PHASE_LABEL[a.phase]}${a.open ? ` · ${a.open} question${a.open === 1 ? '' : 's'} open` : ''}`),
          h('span.firm-strip-go', {}, 'View →'),
        ),
      );
    }
    if (s?.reportReady) {
      return root.replaceChildren(
        h('a.firm-strip.ready', { href: reportUrl(s.reportReady.report) }, h('span.firm-strip-ico', { 'aria-hidden': 'true' }, '📑'), h('span.firm-strip-text', {}, h('b', {}, 'Audit report ready'), ' from The Firm'), h('span.firm-strip-go', {}, 'Read →')),
      );
    }
    root.replaceChildren(h('div.firm-strip.idle', {}, h('button.btn.small.firm-call', { type: 'button', onclick: () => void callAudit(), title: 'An independent audit of this project by The Firm\'s Reviewer Agents' }, '📑 Call an audit'), h('a.firm-strip-link', { href: '/firm' }, 'The Firm →')));
  }

  function load() {
    clearTimeout(timer);
    const f = floor;
    if (!f) return root.replaceChildren();
    fetchFloorStatus(f).then(
      (s) => {
        if (f !== floor) return;
        draw(s);
        if (s.active) timer = setTimeout(load, 20_000);
      },
      () => f === floor && draw(undefined),
    );
  }

  return {
    refresh(f) {
      if (f === floor) return;
      floor = f;
      load();
    },
    onMessage(msg) {
      if (msg.t === 'roster.changed' && msg.floor === floor) {
        clearTimeout(timer);
        timer = setTimeout(load, 400);
      }
    },
  };
}
