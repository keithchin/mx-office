// Whether a message to an agent says anything (the tell-honesty fix, after dispatch dsp_01M51S9XJC1XR77CBX8MK6HWVY:
// the Project Manager pressed "Ask Katherine" on a Needs you card, which prefills `About "<title>": `, and
// sent it as it was; Katherine got the heading and her marker line, and the PM's message was lost). A message
// that is empty, only whitespace, only the office's own lines (a dispatch marker, a `Task: tsk_…` line) or
// only that prefilled heading is nothing to send: the composer keeps its Send button off, and the server
// refuses it with EMPTY_TELL (a person's console or Team tab, the lead panel, an agent's `office-workers tell`).
// Pure: the browser imports it too.

/** What the caller is told when there was nothing to send. */
export const EMPTY_TELL = 'Nothing to send: the message was empty';

/** The office's own lines: an answer's marker, a task's id line. */
const OFFICE_LINE = /^\s*(?:\[office answer [^\]\n]*\]|Task:\s*tsk_[0-9A-Za-z]+)\s*$/;
/** The heading an "Ask <lead>" button prefills, with nothing after it. */
const PREFILL_ONLY = /^About\s+"[^\n]*"\s*:?$/i;

/** What a message says once the office's own lines and an untouched prefilled heading are taken out ('' when nothing). */
export function tellBody(text: unknown): string {
  if (typeof text !== 'string') return '';
  const body = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => !OFFICE_LINE.test(l))
    .join('\n')
    .trim();
  return PREFILL_ONLY.test(body) ? '' : body;
}

/** Whether a message has nothing to send. */
export const isEmptyTell = (text: unknown): boolean => !tellBody(text);
