// 🗺️ The toolkit's process map in the office (shared/process-map.ts): what the Documents page says about
// a map the deliverables scan found (its pass and whether it is older than its model, its anchors or a
// wireframe, by the toolkit gate's rule; the BRD report that opens with the pass-1 map), and the pins a
// decision card links to (GET /api/process-map/pins). The office reads the toolkit's files; it never runs
// process-map.js. A project with no map, or on a toolkit pin without the skill, is left as it was.

import type { DeliverableFile, DeliverableItem, DeliverablesView, DeliverableWhere } from '../../shared/deliverables.js';
import { BRD_REPORT_MAP_MARK, mapFacts, mapInputs, pinsFrom, type ModelLite, type Pin, type PinsView, type ProcessMapFacts } from '../../shared/process-map.js';
import type { Source } from '../deliverables/content.js';
import type { ScanInput } from '../deliverables/scan.js';
import { FOLDER_SLACK_MS, fileHas, mapTimes, placeKey, placeOf, readJson, type Place } from './read.js';

/** Files of an item looked at (a project has one map, two with the nested layout). */
const LOOKED_AT = 6;
/** The BRD report is read only this far for its map frame (the viewer's HTML cap). */
const REPORT_MAX = 5 * 1024 * 1024;
const JSON_MAX = 2 * 1024 * 1024;

/** Where a scan's place is, as the file routes read it (deliverables/index.ts sourceOf), from the scan's own input. */
export function sourceFromScan(input: Pick<ScanInput, 'dir' | 'main' | 'people'>, where: DeliverableWhere): Source | undefined {
  if (where.src === 'main') return input.main ? { repo: input.dir, branch: input.main.sha } : { dir: input.dir };
  if (where.src.startsWith('wt:')) {
    const p = input.people.find((x) => x.workerId === where.src.slice(3));
    return p?.dir ? { dir: p.dir } : undefined;
  }
  if (where.src.startsWith('ref:')) return { repo: input.dir, branch: where.src.slice(4) };
  return undefined;
}

/** A map file's facts at its first place; undefined when it can't be read there. */
export async function mapFileFacts(place: Place, mapPath: string): Promise<ProcessMapFacts | undefined> {
  const t = await mapTimes(place, mapPath);
  return t ? mapFacts(t, 'dir' in place ? FOLDER_SLACK_MS : 0) : undefined;
}

/** The file of an item that counts: merged before branch work, then the first. */
const bestFile = (item: DeliverableItem): DeliverableFile | undefined => item.files.find((f) => f.status === 'present') ?? item.files[0];

export interface MapOptions {
  /** The project's toolkit has skills/process-map.md: a missing map is listed (optional); otherwise it isn't. */
  toolkitHasMap: boolean;
}

/**
 * `view` with what the office knows of its process maps: each map file's pass and freshness, the BRD report's
 * embedded map, a pass-1 map shown at Stage 2 as the Chief Analyst's, and no "Process map" row at all for a
 * project whose toolkit can't make one and hasn't. Never throws: a file it can't read is shown as it was.
 */
export async function withProcessMap(input: Pick<ScanInput, 'dir' | 'main' | 'people'>, view: DeliverablesView, opts: MapOptions): Promise<DeliverablesView> {
  const facts = async (f: DeliverableFile, fn: (place: Place) => Promise<ProcessMapFacts | undefined>): Promise<DeliverableFile> => {
    try {
      const src = f.where[0] && sourceFromScan(input, f.where[0]);
      const place = src && (await placeOf(src));
      const pm = place && (await fn(place));
      return pm ? { ...f, processMap: pm } : f;
    } catch {
      return f;
    }
  };
  const items = await Promise.all(
    view.items.map(async (item): Promise<DeliverableItem | undefined> => {
      if (item.id === 'process-map') {
        if (!item.files.length) return opts.toolkitHasMap ? item : undefined;
        const files = await Promise.all(item.files.map((f, i) => (i < LOOKED_AT ? facts(f, (pl) => mapFileFacts(pl, f.path)) : f)));
        const out = { ...item, files };
        // Pass 1 is drawn at Stage 2 close, before any wireframe: it is the Chief Analyst's, at Stage 2.
        if (bestFile(out)?.processMap?.pass === 1) Object.assign(out, { stage: '2', team: 'analysis', owner: 'chief-analyst' });
        return out;
      }
      if (item.id === 'brd-report' && item.files.length) {
        const files = await Promise.all(item.files.map((f, i) => (i < LOOKED_AT ? facts(f, async (pl) => ((await fileHas(pl, f.path, BRD_REPORT_MAP_MARK, REPORT_MAX)) ? { role: 'report', embedsMap: true } : undefined)) : f)));
        return { ...item, files };
      }
      return item;
    }),
  );
  return { ...view, items: items.filter((i): i is DeliverableItem => !!i) };
}

const pinCache = new Map<string, Pin[]>();

/** The pins of the map at `mapPath` in `place`, from its model and anchors beside it (kept per version of the two). */
export async function pinsAt(place: Place, mapPath: string): Promise<Pin[]> {
  const inp = mapInputs(mapPath);
  const [model, anchors] = await Promise.all([readJson(place, inp.model, JSON_MAX), readJson(place, inp.anchors, JSON_MAX)]);
  if (!model || !anchors || typeof model.value !== 'object' || typeof anchors.value !== 'object') return [];
  const key = `${placeKey(place)}\0${model.sig}\0${anchors.sig}`;
  const hit = pinCache.get(key);
  if (hit) return hit;
  const m = model.value as ModelLite;
  const pins = Array.isArray(m.processes) ? pinsFrom(m, anchors.value as { anchors?: unknown }) : [];
  pinCache.set(key, pins);
  if (pinCache.size > 50) pinCache.delete(pinCache.keys().next().value!);
  return pins;
}

/** The floor's map (the best "Process map" file of its scan) and its pins; no map: no pins. */
export async function pinsView(floor: string, view: DeliverablesView, sourceOf: (src: string) => Promise<Source | undefined>): Promise<PinsView> {
  const item = view.items.find((i) => i.id === 'process-map');
  const f = item && bestFile(item);
  const where = f?.where[0];
  if (!f || !where) return { floor, pins: [] };
  try {
    const src = await sourceOf(where.src);
    const place = src && (await placeOf(src));
    if (!place) return { floor, pins: [] };
    const model = await readJson(place, mapInputs(f.path).model, JSON_MAX);
    const app = model && typeof (model.value as ModelLite | undefined)?.app === 'string' ? (model.value as ModelLite).app : undefined;
    return { floor, map: { path: f.path, src: where.src, label: where.label, ...(app ? { app } : {}) }, pins: await pinsAt(place, f.path) };
  } catch {
    return { floor, pins: [] };
  }
}
