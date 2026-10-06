// What the team phone types into an agent: the person's words, who they're from, and that the reply
// goes back to them. The tag at the end is how the reply is found in the transcript (reply.ts).

/** The tag a phone message carries, to find the user message it became. */
export const phoneTag = (id: string) => `[team phone ${id}]`;

export function phonePrompt(by: string, body: string, id: string, group = false): string {
  return [
    `📱 ${by} (the Project Manager, a person) messaged ${group ? 'every Lead on the team' : 'you'} on the team phone:`,
    '',
    body,
    '',
    `Answer them in your reply here, in a few lines: the office posts the text of your reply back to them on the phone. No need to escalate this. ${phoneTag(id)}`,
  ].join('\n');
}
