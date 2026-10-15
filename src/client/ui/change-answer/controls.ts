// Change answer on a card (Slice 1B-3): the "Change answer" button and the "History (n revisions)" fold,
// for a resolved escalation (the Team tab's approvals), a follow-through item (Needs you) and a question
// sent or recorded (the Questions page). Admins only: for anyone else, nothing (the server checks too).
// Drawing it fetches nothing; the dialog and the fold ask once, when opened.

import { h } from '../dom';
import { openChangeAnswer } from './dialog';
import { historyFold } from './history';
import './change-answer.css';

/** The row for `decision` at revision `rev`, or null when there's nothing to change (no revision, not an admin). */
export function answerControls(floor: string | undefined, decision: string, rev: number | undefined, admin: boolean, done?: () => void): HTMLElement | null {
  if (!floor || !admin || !rev) return null;
  const btn = h('button.btn.small.ca-open', { type: 'button', title: 'Replace this answer with a new one: a new revision, sent to whoever records it', onclick: () => openChangeAnswer(floor, decision, rev, done) }, 'Change answer');
  return h('div.ca-row', { 'data-decision': decision }, btn, historyFold(floor, decision, rev));
}
