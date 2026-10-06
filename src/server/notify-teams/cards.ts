// The messages the office posts to a Teams Workflows webhook ("Post to a channel when a webhook request
// is received"): one Adaptive Card 1.4 in a message envelope, the shape Microsoft documents for Workflows
// (classic Office 365 connectors are retired). Pure, so the tests read the cards as they're built.

/** One red "Needs you" item, made ready to post (gather.ts). */
export interface RedItem {
  /** Stable across polls and restarts: the floor and the Needs you key (an agent's question also its start). */
  id: string;
  floor: string;
  project: string;
  /** Who it's from or about: the agent, whoever escalated, the PR's author, "The Firm". */
  who: string;
  /** One line. */
  summary: string;
  /** "CRITICAL", "URGENT", "Blocking", "Needs a look". */
  urgency: string;
  level: 'block' | 'warn';
  since?: number;
  /** Jeff's rank among the floor's open escalations (1 = resolve first). */
  rank?: number;
  /** Where its Open button goes, when the office has a public address. */
  link?: string;
}

/** What goes in a floor's daily digest (digest.ts). */
export interface DigestData {
  floor: string;
  project: string;
  /** PRs merged in the day before the digest. */
  merges: { number: number; title: string }[];
  /** How many Needs you items are open now, how many of them are red, and the red ones that aren't escalations (those are listed on their own). */
  openNeeds: number;
  redCount: number;
  red: string[];
  spent?: number;
  cap?: number;
  /** Toolkit stages by status, when the floor is a toolkit project. */
  stages?: { passed: number; total: number; waiting: string[]; next?: string };
  /** The three open escalations Jeff would have resolved first (or the loudest, oldest, unranked). */
  topEscalations: { title: string; urgency: string; rank?: number }[];
  link?: string;
}

export interface AdaptiveCard {
  type: 'AdaptiveCard';
  $schema: string;
  version: '1.4';
  body: unknown[];
  actions?: unknown[];
  msteams?: { width: 'Full' };
}

/** The webhook's body: a message with one Adaptive Card attachment. */
export interface TeamsMessage {
  type: 'message';
  attachments: { contentType: 'application/vnd.microsoft.card.adaptive'; contentUrl: null; content: AdaptiveCard }[];
}

/** Teams refuses a message over 28 KB; cards stop listing items well before that. */
export const MAX_ITEMS_PER_CARD = 10;

const SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json';

/** One line, at most `max` characters, with Markdown that would change it taken out. */
export function oneLine(s: string, max = 160): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Teams reads Markdown in TextBlocks: escape what would turn a worker's words into bold, italics or links. */
export const plain = (s: string) => s.replace(/([*_[\]])/g, '\\$1');

/** "just now", "4 min", "2 h", "3 d". */
export function ageOf(since: number | undefined, now: number): string | undefined {
  if (since === undefined || !Number.isFinite(since)) return undefined;
  const m = Math.max(0, Math.round((now - since) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
}

/** A link on the office's public address: '' when there's none (no button then). */
export function officeLink(publicUrl: string | undefined, path: string): string | undefined {
  if (!publicUrl) return undefined;
  try {
    return new URL(path, publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`).toString();
  } catch {
    return undefined;
  }
}

export function wrap(card: Omit<AdaptiveCard, 'type' | '$schema' | 'version'>): TeamsMessage {
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: { type: 'AdaptiveCard', $schema: SCHEMA, version: '1.4', msteams: { width: 'Full' }, ...card } }] };
}

const text = (t: string, more: Record<string, unknown> = {}) => ({ type: 'TextBlock', text: t, wrap: true, ...more });
const open = (url: string, title = 'Open') => ({ type: 'Action.OpenUrl', title, url });

/** One item: who and where, the line, then its facts and its own Open button. */
function itemBlock(i: RedItem, now: number, separator: boolean): unknown {
  const facts = [{ title: 'Urgency', value: i.urgency }];
  const age = ageOf(i.since, now);
  if (age) facts.push({ title: 'Waiting', value: age });
  if (i.rank !== undefined) facts.push({ title: "Jeff's priority", value: `#${i.rank}` });
  return {
    type: 'Container',
    separator,
    spacing: separator ? 'Medium' : 'Default',
    style: i.level === 'block' ? 'attention' : 'warning',
    items: [
      text(`**${plain(i.project)}** · ${plain(i.who)}`, { weight: 'Bolder' }),
      text(plain(oneLine(i.summary))),
      { type: 'FactSet', facts },
      ...(i.link ? [{ type: 'ActionSet', actions: [open(i.link)] }] : []),
    ],
  };
}

/** Red items raised together (within the batch window), in one card. */
export function needsCard(items: readonly RedItem[], now: number): TeamsMessage {
  const shown = items.slice(0, MAX_ITEMS_PER_CARD);
  const projects = [...new Set(items.map((i) => i.project))];
  const title = items.length === 1 ? `🔴 Needs you in ${projects[0]}` : `🔴 ${items.length} things need you${projects.length === 1 ? ` in ${projects[0]}` : ''}`;
  const more = items.length - shown.length;
  return wrap({
    body: [text(plain(title), { size: 'Large', weight: 'Bolder' }), ...shown.map((i, n) => itemBlock(i, now, n > 0)), ...(more > 0 ? [text(`…and ${more} more in the office.`, { isSubtle: true })] : [])],
  });
}

/** After quiet hours or a pause: what came up meanwhile, and which of it still needs you. */
export function catchUpCard(still: readonly RedItem[], resolved: number, why: string, now: number, home?: string): TeamsMessage {
  const n = still.length + resolved;
  const head = `🌅 While notifications were held (${why}): ${n} item${n === 1 ? '' : 's'} came up`;
  const sub = still.length ? `${still.length} still need${still.length === 1 ? 's' : ''} you${resolved ? `; ${resolved} ${resolved === 1 ? 'was handled or sorted itself out' : 'were handled or sorted themselves out'}` : ''}.` : 'All of them were handled meanwhile.';
  const shown = still.slice(0, MAX_ITEMS_PER_CARD);
  return wrap({
    body: [text(plain(head), { size: 'Large', weight: 'Bolder' }), text(sub, { isSubtle: true }), ...shown.map((i, k) => itemBlock(i, now, k > 0)), ...(still.length > shown.length ? [text(`…and ${still.length - shown.length} more in the office.`, { isSubtle: true })] : [])],
    ...(home ? { actions: [open(home, 'Open the office')] } : {}),
  });
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** A floor's morning summary, after its standup. */
export function digestCard(d: DigestData): TeamsMessage {
  const facts = [
    { title: 'Merged (last 24 h)', value: d.merges.length ? String(d.merges.length) : 'none' },
    { title: 'Needs you now', value: d.openNeeds ? `${d.openNeeds} (${d.redCount} red)` : 'nothing' },
  ];
  if (d.spent !== undefined) facts.push({ title: 'Spend today', value: d.cap !== undefined ? `${money(d.spent)} of ${money(d.cap)} cap` : money(d.spent) });
  if (d.stages) facts.push({ title: 'Stages (gates)', value: `${d.stages.passed} of ${d.stages.total} passed${d.stages.next ? ` · next: ${d.stages.next}` : ''}` });
  const body: unknown[] = [text(plain(`📋 Daily digest: ${d.project}`), { size: 'Large', weight: 'Bolder' }), { type: 'FactSet', facts }];
  if (d.merges.length) body.push(text('**Merged**', { separator: true }), text(d.merges.slice(0, 8).map((m) => `- #${m.number} ${plain(oneLine(m.title, 90))}`).join('\n')));
  if (d.stages?.waiting.length) body.push(text(`✋ Waiting for sign-off: ${plain(d.stages.waiting.join(', '))}`));
  if (d.topEscalations.length) {
    body.push(text("**Top escalations (Jeff's priority)**", { separator: true }));
    body.push(text(d.topEscalations.map((e, i) => `${i + 1}. ${e.rank !== undefined ? `#${e.rank} ` : ''}${e.urgency ? `[${e.urgency}] ` : ''}${plain(oneLine(e.title, 120))}`).join('\n')));
  }
  if (d.red.length) body.push(text('**Also needs you**', { separator: true }), text(d.red.slice(0, 6).map((r) => `- ${plain(oneLine(r, 110))}`).join('\n')));
  return wrap({ body, ...(d.link ? { actions: [open(d.link)] } : {}) });
}

/** The Test button's card. */
export function testCard(by: string, office: string, home?: string): TeamsMessage {
  return wrap({
    body: [text(plain(`🔔 ${by} connected ${office} to this channel`), { size: 'Large', weight: 'Bolder' }), text('Agent Office posts here when something needs a person: an agent asking, an escalation, the spend cap, failing checks, a Firm report, a gate to sign off.', { isSubtle: true })],
    ...(home ? { actions: [open(home, 'Open the office')] } : {}),
  });
}
