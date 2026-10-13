// The floor's open questions for the client (GET /api/questions, server/questions/), for Needs you (the
// Command Center's strip, the team phone, the Overview, the team-lead panel's count) and the Questions
// page: fetched for the floor on first use, again whenever the audit log says something about them changed
// ({t:'audit.new'} with a questions.* action), and every few minutes in case a message was missed.

import type { QuestionsNeed, QuestionsView } from '../../../shared/questions';
import type { ServerMsg } from '../../../shared/protocol';

const POLL_MS = 5 * 60_000;

let view: QuestionsView | undefined;
let asked: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
const subs = new Set<() => void>();

const tell = () => subs.forEach((fn) => fn());

async function refresh(floor: string) {
  try {
    const res = await fetch(`/api/questions?floor=${encodeURIComponent(floor)}`, { credentials: 'same-origin' });
    if (!res.ok || floor !== asked) return;
    const next = (await res.json()) as QuestionsView;
    if (JSON.stringify(next) === JSON.stringify(view)) return;
    view = next;
    tell();
    // A collection was running: look again once it's likely done.
    if (next.collecting) setTimeout(() => floor === asked && void refresh(floor), 8_000);
  } catch {
    // Next time.
  }
}

/** Looks again soon (several changes at once are one look). */
export function refreshQuestions() {
  clearTimeout(timer);
  const f = asked;
  if (f) timer = setTimeout(() => void refresh(f), 300);
}

/** Starts following `floor` (the first call for a floor fetches). */
export function followQuestions(floor: string | null | undefined) {
  if (!floor || typeof fetch !== 'function' || floor === asked) return;
  asked = floor;
  view = undefined;
  void refresh(floor);
  if (!polling) {
    polling = true;
    setInterval(() => asked && void refresh(asked), POLL_MS);
  }
}

/** The floor's questions waiting on you as last fetched, for collectNeeds. */
export function questionsNeed(floor: string | null | undefined): QuestionsNeed | undefined {
  followQuestions(floor);
  return view && view.floor === floor ? view.need : undefined;
}

/** The whole view, for the page. */
export const questionsView = (): QuestionsView | undefined => view;

/** Replaces the view with what an action answered. */
export function setQuestionsView(v: QuestionsView) {
  if (v.floor !== asked) return;
  view = v;
  tell();
}

export function onQuestionsChanged(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Every message from the office: the questions changed when the audit log says so. */
export function questionsFeedMessage(msg: ServerMsg) {
  if (asked && msg.t === 'audit.new' && msg.event.action.startsWith('questions.') && (msg.floor === asked || msg.event.floor === asked)) refreshQuestions();
}
