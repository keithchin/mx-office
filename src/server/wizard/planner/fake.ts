// The test planner: a deterministic stand-in for the Chief Analyst's planning calls, with no model call at
// all. Test offices (AGENT_OFFICE_PLANNER=fake) and the tests use it. It always drafts the same Visitor
// Registration brief (the approved mockup's sample), whatever it's told, names the first attached document it
// "read" as a source, adds a Security officer role on the first chat message and an open question on later
// ones, and maps the same four functional domains. It costs nothing.

import type { Brief, ChatMsg, Domains } from '../../../shared/brief.js';
import { cleanBrief, cleanDomains, emptyBrief } from '../../../shared/brief.js';
import type { PlannerEngine, PlannerFile } from './engine.js';

/** How long each fake call takes, so a page shows its drafting state as it would with the real one. */
const DELAY_MS = Number(process.env.AGENT_OFFICE_FAKE_PLANNER_MS ?? 1200);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function fakeBrief(files: PlannerFile[]): { brief: Brief; filesRead: string[] } {
  const read = files.filter((f) => f.text !== undefined);
  const doc = read[0]?.name;
  const d = 'from your description';
  const p = (n: number) => (doc ? `from ${doc} p.${n}` : d);
  const raw = {
    title: 'Visitor Registration',
    description: 'An office visitor sign-in app: reception or kiosk sign-in, host approval and printed badges.',
    goal: [{ text: 'Give each office a fast, paperless way to sign visitors in, get the host’s approval and print a badge, and always know who is in the building.', tag: 'answered', source: d }],
    success: [
      { text: 'A visitor is signed in and badged in under 60 seconds.', tag: 'answered', source: p(2) },
      { text: 'Hosts approve or decline within 5 minutes during office hours.', tag: 'assumed', source: 'inferred from "hosts respond fast"' },
      { text: 'The paper visitor book is retired at all 3 offices.', tag: 'answered', source: p(4) },
      { text: 'An up-to-date evacuation list can be printed in one click.', tag: 'answered', source: d },
    ],
    roles: [
      { name: 'Receptionist', text: 'Front-desk staff who welcome visitors.', when: 'When a visitor arrives, I need to register them in seconds so a queue doesn’t build up.', tag: 'answered', source: d },
      { name: 'Host employee', text: 'The employee a visitor comes to see.', when: 'When my visitor arrives, I need to be told and approve, so I can collect them.', tag: 'answered', source: p(2) },
      { name: 'Visitor', text: 'Signs in on a self-service kiosk.', when: 'When I arrive, I want to sign myself in on a tablet, so I don’t wait at the desk.', tag: 'assumed', source: 'inferred from "or on a kiosk"' },
      { name: 'Facility manager', text: 'Owns building safety and reporting.', when: 'When there is an evacuation, I need a list of everyone on site.', tag: 'answered', source: p(4) },
    ],
    scope: [
      { side: 'in', text: 'Visitor check-in and check-out', tag: 'answered', source: d },
      { side: 'in', text: 'Host notification and approval', tag: 'answered', source: d },
      { side: 'in', text: 'Badge printing with photo', tag: 'answered', source: p(3) },
      { side: 'in', text: 'Daily visitor list and evacuation report', tag: 'answered', source: p(4) },
      { side: 'out', text: 'Parking reservations', tag: 'answered', source: p(4) },
      { side: 'out', text: 'Contractor safety inductions', tag: 'answered', source: p(4) },
    ],
    constraints: [
      { text: 'Built on Mendix, the office’s default version.', tag: 'answered', source: 'from office Settings' },
      { text: 'Badges print on the existing Zebra label printers at each reception.', tag: 'answered', source: p(3) },
      { text: 'Visitor personal data is deleted after 30 days (GDPR).', tag: 'assumed', source: 'inferred: a common retention period, not stated in your notes' },
    ],
    questions: [
      { text: 'Do visitors need to accept an NDA or house rules at check-in?', tag: 'unverified', source: 'open question' },
      { text: 'Do hosts sign in with the company’s Microsoft account (single sign-on)?', tag: 'unverified', source: 'open question' },
    ],
  };
  return { brief: cleanBrief(raw) ?? emptyBrief('Visitor Registration'), filesRead: read.map((f) => f.name) };
}

export function fakeChat(brief: Brief, _history: ChatMsg[], text: string): { brief: Brief; reply: string } {
  const next = structuredClone(brief);
  if (!next.sections.roles.some((r) => r.name === 'Security officer')) {
    next.sections.roles.push({ id: '', name: 'Security officer', text: 'Watches who enters the building.', when: 'When a visitor is on the watch list, I need to be alerted before they get a badge.', tag: 'answered', source: 'from the chat' });
    return { brief: cleanBrief(next) ?? brief, reply: 'Good point. I added a Security officer role under User roles, with a watch-list alert. Anything else I should know?' };
  }
  next.sections.questions.push({ id: '', text: text.length > 120 ? `${text.slice(0, 117)}…` : text, tag: 'unverified', source: 'open question' });
  return { brief: cleanBrief(next) ?? brief, reply: 'I couldn’t settle that from your notes, so I added it to Open questions. It stays Unverified until someone answers it.' };
}

export function fakeDomains(): Domains {
  const s = (title: string, text: string, ac: number) => ({ title, text, ac });
  return cleanDomains({
    domains: [
      { code: 'VIS', name: 'Visitor check-in', roles: ['Receptionist', 'Visitor'], description: 'Register visitors at the desk or the kiosk, check them out, and see who is on site.', stories: [s('Register a walk-in visitor', 'As a receptionist, I want to register a walk-in visitor in under a minute, so that the queue stays short.', 4), s('Sign in on the kiosk', 'As a visitor, I want to sign myself in on a tablet, so that I don’t have to wait at the desk.', 3), s('Check a visitor out', 'As a receptionist, I want to check a visitor out when they return the badge, so that the on-site list is right.', 2), s('See who is on site', 'As a receptionist, I want to see everyone currently in the building, so that I can answer questions quickly.', 2)] },
      { code: 'HST', name: 'Host approval', roles: ['Host employee'], description: 'Tell hosts their visitor is here and let them approve, decline or delegate.', stories: [s('Get notified of my visitor', 'As a host employee, I want to be notified by email and chat when my visitor arrives, so that I don’t keep them waiting.', 3), s('Approve from my phone', 'As a host employee, I want to approve or decline from my phone, so that I can respond from anywhere.', 3), s('Delegate approval', 'As a host employee, I want a colleague to approve for me when I’m away, so that visitors aren’t stuck.', 2)] },
      { code: 'BDG', name: 'Badges & printing', roles: ['Receptionist'], description: 'Print a badge with the visitor’s photo and host, reprint or void it.', stories: [s('Print a visitor badge', 'As a receptionist, I want to print a badge with the visitor’s name, photo and host, so that staff can recognise visitors.', 3), s('Reprint or void a badge', 'As a receptionist, I want to reprint or void a badge, so that lost badges can’t be reused.', 2)] },
      { code: 'REP', name: 'Reporting', roles: ['Facility manager'], description: 'Daily visitor lists, the evacuation list and data retention.', stories: [s('Daily visitor list', 'As a facility manager, I want a daily list of visitors per office, so that I can spot unusual activity.', 2), s('Print the evacuation list', 'As a facility manager, I want to print everyone on site in one click, so that we can account for people in an emergency.', 3), s('Delete old visitor data', 'As a facility manager, I want visitor data deleted after the retention period, so that we stay GDPR-compliant.', 2)] },
    ],
    tier: 'standard',
    tierWhy: 'four domains and twelve stories: more than one module',
  })!;
}

/** The test planner as an engine: never unavailable, never spends. */
export function fakeEngine(delayMs = DELAY_MS): PlannerEngine {
  return {
    kind: 'fake',
    model: 'test planner',
    why: () => undefined,
    async brief(req) {
      await wait(delayMs);
      return { value: fakeBrief(req.files), cost: 0 };
    },
    async chat(req) {
      await wait(Math.min(delayMs, 600));
      return { value: fakeChat(req.brief, req.history, req.text), cost: 0 };
    },
    async domains() {
      await wait(delayMs);
      return { value: fakeDomains(), cost: 0 };
    },
  };
}
