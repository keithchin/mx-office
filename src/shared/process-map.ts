// 🗺️ The toolkit's Process map (its skills/process-map.md): one swimlane map per business process, each
// step in its actor's lane and on its wireframe, every open question and ASSUMED decision pinned to the
// step it is about. The toolkit writes it (design/process-model.json by hand, design/question-anchors.json
// by `process-map.js anchor`, design/process-map.html by `build`); the office only reads the three. This
// is what the office says about them, pure, for the server (server/process-map/), the Documents page and
// the decision cards: which map pass a file is, when it is older than what it is drawn from (the toolkit
// gate's rule), and which step a decision's question is pinned on.

/** Where a map sits: `design/` at the project root, or the nested layout `analysis/<name>/design/`. */
export const PROCESS_MAP_GLOBS = ['design/process-map.html', 'analysis/*/design/process-map.html'] as const;
const MAP_RE = /^(?:analysis\/[^/]+\/)?design\/process-map\.html$/i;

/** Whether `p` is a generated process map the office recognises. */
export const isProcessMapPath = (p: string): boolean => MAP_RE.test(p);

/** The design folder a map sits in (`design` or `analysis/<name>/design`). */
export const designDirOf = (mapPath: string): string => mapPath.slice(0, mapPath.lastIndexOf('/'));

/** The files a map is drawn from, beside it (the toolkit's gate checks the same ones). */
export const mapInputs = (mapPath: string) => {
  const d = designDirOf(mapPath);
  return { model: `${d}/process-model.json`, anchors: `${d}/question-anchors.json`, wireframes: `${d}/wireframes` };
};

/** The skill a toolkit pin has when it knows the process map: briefs mention the map only then. */
export const PROCESS_MAP_SKILL = 'skills/process-map.md';

/** What the toolkit's BRD report contains when it opens with the pass-1 map (bin/brd-report.sh's frame). */
export const BRD_REPORT_MAP_MARK = 'id="pm-frame"';

export type MapSourceName = 'model' | 'anchors' | 'wireframe';

/** What the office knows about a map file (or the BRD report that embeds one) beyond where it is. */
export interface ProcessMapFacts {
  /** `map`: a generated process-map.html; `report`: analysis/brd-report.html. */
  role: 'map' | 'report';
  /** A map: 1 with no wireframes beside it yet (drawn at Stage 2 close), 2 once screens exist (Stage 3). */
  pass?: 1 | 2;
  /** A map: what is newer than it (the gate fails such a map at Stage 3). Empty or absent: current. */
  stale?: MapSourceName[];
  /** A map with no process-model.json beside it (hand-made, or the model was removed). */
  noModel?: boolean;
  /** A report: it opens with the pass-1 process map. */
  embedsMap?: boolean;
}

/** Times (ms) of a map and what it is drawn from; undefined: not there. */
export interface MapTimes {
  map: number;
  model?: number;
  anchors?: number;
  /** The newest `wireframes/*.html` beside it. */
  wireframe?: number;
  wireframes: number;
}

/**
 * The toolkit gate's rule (bin/gate-check.sh check_stage_3): a map is stale when its model, its anchors
 * or any wireframe is newer than it. `slack` (ms) forgives files a checkout wrote a moment apart.
 */
export function staleSources(t: MapTimes, slack = 0): MapSourceName[] {
  const out: MapSourceName[] = [];
  const newer = (x?: number) => x !== undefined && x > t.map + slack;
  if (newer(t.model)) out.push('model');
  if (newer(t.anchors)) out.push('anchors');
  if (newer(t.wireframe)) out.push('wireframe');
  return out;
}

export function mapFacts(t: MapTimes, slack = 0): ProcessMapFacts {
  const stale = staleSources(t, slack);
  return { role: 'map', pass: t.wireframes > 0 ? 2 : 1, ...(stale.length ? { stale } : {}), ...(t.model === undefined ? { noModel: true } : {}) };
}

const SOURCE_WORD: Record<MapSourceName, string> = { model: 'its model', anchors: 'its anchors', wireframe: 'a wireframe' };

/** "its model and a wireframe". */
export const staleWords = (s: readonly MapSourceName[]): string => {
  const w = s.map((x) => SOURCE_WORD[x]);
  return w.length <= 1 ? (w[0] ?? '') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
};

export interface FactNote {
  text: string;
  tone: 'stale' | 'info';
  title?: string;
}

/** The small badges a file row and the viewer show for these facts. */
export function factNotes(f: ProcessMapFacts | undefined): FactNote[] {
  if (!f) return [];
  if (f.role === 'report') return f.embedsMap ? [{ text: 'Opens with the pass-1 process map', tone: 'info', title: "The toolkit's BRD report draws the process map at its top (bin/brd-report.sh)" }] : [];
  const out: FactNote[] = [];
  out.push(f.pass === 2 ? { text: 'Pass 2 · with screens', tone: 'info', title: 'The full map: wireframes exist beside it (Stage 3)' } : { text: 'Pass 1 · no screens yet', tone: 'info', title: 'The draft map drawn at Stage 2 close, before the wireframes' });
  if (f.stale?.length)
    out.push({ text: `Stale: older than ${staleWords(f.stale)}`, tone: 'stale', title: "The map was drawn before its inputs last changed: re-run the toolkit's process-map.js build. The toolkit's Stage 3 gate fails a map older than its model, its anchors or any wireframe." });
  if (f.noModel) out.push({ text: 'No process-model.json beside it', tone: 'stale', title: 'The map is generated from design/process-model.json, which is not there' });
  return out;
}

// ---------- pins: which step a question or decision sits on ----------

/** The parts of design/process-model.json the office reads. */
export interface ModelLite {
  app?: string;
  processes: { id: string; title?: string; steps: { id: string; title?: string; page?: string }[] }[];
}

/** One anchors entry, as the toolkit writes it (schema process-anchors/1). */
export interface AnchorLite {
  id: string;
  kind?: string;
  fingerprint?: string;
  targets: ({ type: 'step'; step: string } | { type: 'page'; page: string } | { type: 'global'; bucket: string })[];
}

/** Where an item is pinned, in the words of the card's link. */
export interface PinPlace {
  /** The process id (the map's own deep link is `#/<process>`), absent for a whole-app bucket. */
  process?: string;
  processTitle?: string;
  step?: string;
  /** The step's place in its process, from 1 (as the BRD report numbers them). */
  n?: number;
  stepTitle?: string;
  /** A whole-app item's bucket. */
  bucket?: string;
}

export interface Pin {
  id: string;
  kind: string;
  fingerprint: string;
  places: PinPlace[];
}

/** GET /api/process-map/pins: the floor's map, where it is, and its pins. */
export interface PinsView {
  floor: string;
  map?: { path: string; src: string; label: string; app?: string };
  pins: Pin[];
}

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const shortName = (x: string) => x.split('.').pop()!.toLowerCase();

/** The anchors file's entries as places on the model's steps (unknown steps dropped, at most three places each). */
export function pinsFrom(model: ModelLite, anchors: { anchors?: unknown }): Pin[] {
  const steps = new Map<string, PinPlace>();
  const byPage = new Map<string, PinPlace[]>();
  for (const p of model.processes ?? []) {
    (p.steps ?? []).forEach((s, i) => {
      const place: PinPlace = { process: p.id, processTitle: clean(p.title) || p.id, step: s.id, n: i + 1, stepTitle: clean(s.title) || s.id };
      steps.set(s.id, place);
      if (s.page) byPage.set(shortName(s.page), [...(byPage.get(shortName(s.page)) ?? []), place]);
    });
  }
  const out: Pin[] = [];
  for (const raw of Array.isArray(anchors.anchors) ? (anchors.anchors as AnchorLite[]) : []) {
    if (!raw || typeof raw.id !== 'string') continue;
    const targets = Array.isArray(raw.targets) ? raw.targets : typeof raw.targets === 'object' && raw.targets ? [raw.targets] : [];
    const places: PinPlace[] = [];
    for (const t of targets) {
      if (t?.type === 'step' && steps.has(t.step)) places.push(steps.get(t.step)!);
      else if (t?.type === 'page' && typeof t.page === 'string') places.push(...(byPage.get(shortName(t.page)) ?? []));
      else if (t?.type === 'global' && typeof t.bucket === 'string') places.push({ bucket: clean(t.bucket) });
    }
    if (!places.length) continue;
    out.push({ id: raw.id, kind: clean(raw.kind) || 'question', fingerprint: clean(raw.fingerprint), places: places.slice(0, 3) });
  }
  return out;
}

/** What a decision card says, for finding its pin. */
export interface CardText {
  question: string;
  detail?: string;
  texts?: readonly (string | undefined)[];
  /** A BRD question's key, `<file>#<id>` (shared/questions.ts). */
  questionKey?: string;
}

const norm = (s: string) => clean(s).toLowerCase().replace(/[“”"'‘’`]/g, '');
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const token = (hay: string, id: string) => new RegExp(`(^|[^A-Za-z0-9_-])${escRe(id)}($|[^A-Za-z0-9_-])`, 'i').test(hay);
/** A fingerprint this short is too common to match inside other words. */
const MIN_FINGERPRINT = 20;

/**
 * The pin a card is about: its BRD question by key (the anchor id is `<BRD id>:<question id>`, the BRD file
 * named after its id), else an anchor id named in its words (`F001:Q04`, `D3-02`), else the item's text,
 * which the toolkit keeps as the fingerprint (the first 80 characters).
 */
export function pinForCard(card: CardText, pins: readonly Pin[]): Pin | undefined {
  if (!pins.length) return undefined;
  if (card.questionKey) {
    const hash = card.questionKey.lastIndexOf('#');
    const file = card.questionKey.slice(0, hash).split('/').pop() ?? '';
    const qid = card.questionKey.slice(hash + 1);
    const hit = pins.find((p) => {
      const c = p.id.indexOf(':');
      if (c < 0 || p.id.slice(c + 1).toLowerCase() !== qid.toLowerCase()) return false;
      const brd = p.id.slice(0, c);
      return file.toLowerCase().startsWith(brd.toLowerCase()) && !/[A-Za-z0-9]/.test(file.charAt(brd.length));
    });
    if (hit) return hit;
  }
  const words = [card.question, card.detail, ...(card.texts ?? [])].filter((s): s is string => !!s);
  const raw = words.join('\n');
  const byId = pins.find((p) => /[:-]/.test(p.id) && token(raw, p.id));
  if (byId) return byId;
  const hay = norm(raw);
  return pins.find((p) => {
    const f = norm(p.fingerprint);
    return f.length >= MIN_FINGERPRINT && (hay.includes(f) || words.some((w) => norm(w).slice(0, 80) === f));
  });
}

/** The first place a pin is on a step, else its first place. */
export const bestPlace = (p: Pin): PinPlace => p.places.find((x) => x.step) ?? p.places[0];

/** "Order approval · step 3", or "whole app · Money". */
export const placeWords = (x: PinPlace): string => (x.step ? `${x.processTitle} · step ${x.n}` : `whole app · ${x.bucket}`);

/** The map's own deep link for a place: `#/<process>` opens that process (the map has no step link yet); the index otherwise. */
export const placeHash = (x: PinPlace): string => (x.process ? `#/${encodeURIComponent(x.process)}` : '#/');
