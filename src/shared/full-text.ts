// A long message's whole text beside its short preview (release 81): an escalation's decision card was cut to its
// first paragraph, about 320 characters, in Needs you, the answer's detail and the team chatter, so the Project
// Manager couldn't read the whole of what they were deciding. The preview stays (the lists stay light and quick);
// the whole text is shown folded under it, and only when it says more than the preview. Pure.

/** Line endings evened out and runs of blank lines kept to one. */
const tidy = (s: string) => s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** The whole text when it says more than `preview` (cut, or more paragraphs after it); undefined when the preview is all of it. */
export function fullBeyond(preview: string | undefined, whole: string | undefined): string | undefined {
  const t = tidy(whole ?? '');
  if (!t) return undefined;
  const p = (preview ?? '').replace(/\s+/g, ' ').trim();
  return p && t.replace(/\s+/g, ' ') === p ? undefined : t;
}

/** How a folded whole text is offered: "Read the whole message (1,240 words)". */
export const fullLabel = (text: string) => {
  const words = text.split(/\s+/).filter(Boolean).length;
  return `Read the whole message (${words.toLocaleString('en-GB')} words)`;
};
