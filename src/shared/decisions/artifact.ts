// The related artifact of a decision (C4 of the App Workspace proposal, section 5.1): what the person should
// look at to answer it (a page screenshot, a process map, a document, a walkthrough, a guided check), shown
// beside the decision card in the App Workspace only when the decision names it explicitly. The office never
// guesses one from the words of a question: the same "explicit id only" rule as folding cards (./ids.ts).
//
// An agent names it when it escalates: `office-workers escalate --artifact <kind>:<ref>`, the MCP tool's
// `artifact` field, or a line of its own in the details, `Artifact: <kind>:<ref>`. One per decision.
//
//   screenshot:<path>     an image in the project (png, jpg, jpeg, gif, webp), its path from the project root
//   process-map:<path>    the toolkit's process map (or another diagram file) in the project
//   document:<path>       a document in the project (md, html, pdf, csv, docx, xlsx, txt)
//   walkthrough:<id>      a recorded walkthrough, by its id (Walkthroughs)
//   journey:<J-nn>        a guided check (journey) by its id (Testing)
//
// A ref that doesn't read as one of these is not an artifact: nothing is shown, never a guess. Pure.

export const ARTIFACT_KINDS = ['screenshot', 'process-map', 'document', 'walkthrough', 'journey'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export const isArtifactKind = (v: unknown): v is ArtifactKind => typeof v === 'string' && (ARTIFACT_KINDS as readonly string[]).includes(v);

export interface DecisionArtifact {
  kind: ArtifactKind;
  /** A path from the project root (screenshot, process-map, document) or an id (walkthrough, journey). */
  ref: string;
}

/** What each kind is called on screen. */
export const ARTIFACT_WORDS: Record<ArtifactKind, string> = {
  screenshot: 'Page screenshot',
  'process-map': 'Process map',
  document: 'Document',
  walkthrough: 'Walkthrough',
  journey: 'Guided check',
};

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const DOC = /\.(md|html?|pdf|csv|docx|xlsx|txt|json)$/i;
const MAP = /\.(html?|md|mmd|svg|png|json)$/i;

/** A path from the project root: relative, no `..`, no drive or scheme, plain characters. */
function cleanPath(raw: string): string | undefined {
  const p = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p || p.length > 200 || p.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(p) || p.split('/').some((s) => s === '..' || s === '')) return undefined;
  return /^[\w.\- /]+$/.test(p) ? p : undefined;
}

/** An artifact from `kind:ref` (or `{ kind, ref }`), or undefined when it isn't one exactly. */
export function readArtifact(v: unknown): DecisionArtifact | undefined {
  let kind: unknown;
  let ref: unknown;
  if (typeof v === 'string') {
    const m = /^\s*([a-z-]+)\s*:\s*(.+?)\s*$/.exec(v);
    if (!m) return undefined;
    [kind, ref] = [m[1], m[2]];
  } else if (v && typeof v === 'object') ({ kind, ref } = v as { kind?: unknown; ref?: unknown });
  if (!isArtifactKind(kind) || typeof ref !== 'string') return undefined;
  if (kind === 'walkthrough') return /^[\w.-]{1,80}$/.test(ref.trim()) ? { kind, ref: ref.trim() } : undefined;
  if (kind === 'journey') return /^J-\d{1,3}[a-z]?$/.test(ref.trim()) ? { kind, ref: ref.trim() } : undefined;
  const p = cleanPath(ref);
  if (!p) return undefined;
  if (kind === 'screenshot' && !IMAGE.test(p)) return undefined;
  if (kind === 'document' && !DOC.test(p)) return undefined;
  if (kind === 'process-map' && !MAP.test(p)) return undefined;
  return { kind, ref: p };
}

/** The `Artifact: <kind>:<ref>` line of a text (its own line), when it has exactly one that reads. */
export function artifactInText(text: string | undefined): DecisionArtifact | undefined {
  if (!text) return undefined;
  const found = [...text.matchAll(/^\s*Artifact:\s*(.+?)\s*$/gim)].map((m) => readArtifact(m[1])).filter((a): a is DecisionArtifact => !!a);
  return found.length === 1 ? found[0] : undefined;
}

/** The artifact an escalation names: its field, else its details' `Artifact:` line. */
export const artifactOf = (field: unknown, details?: string): DecisionArtifact | undefined => readArtifact(field) ?? artifactInText(details);

/** The details without their `Artifact:` line (it's shown as the artifact, not as words). */
export const withoutArtifactLine = (text: string) => text.replace(/^\s*Artifact:.*(\r?\n|$)/gim, '').trim();
