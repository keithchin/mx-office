// Whether some words ask for a hands-on action only a person can do: merge a pull request, sign in, paste
// a key, install a tool, allow something at the terminal, restart a preview. Such an ask must wait for the
// Project Manager whatever the autonomy level (a `task` proposal approved by the team at level 4 is a task
// nobody does), and an ask Jeff finds in chat becomes a `needs-human` escalation rather than a question.
// Conservative on purpose: "build the login page" or "add an API key field" is the team's work, so each
// rule wants the person's verb and its object together. Pure: the browser imports it too.

const RULES: readonly RegExp[] = [
  // Merge a pull request (not "merge the two entities").
  /\bmerg(?:e|ing)\b[^.\n]{0,40}\b(?:PR|pull request|branch)\b|\bmerg(?:e|ing)\s+#\d+|\b(?:PR|pull request)\s*#?\d+[^.\n]{0,30}\bmerg(?:e|ed|ing)\b/i,
  // Sign in: a CLI's login, or signing in to a service.
  /\b(?:mxcli|gh|az|npm|docker|cf|claude)\s+(?:auth\s+)?login\b|\b(?:sign|log)(?:\s|-)?in\s+(?:to|with|again)\b|\bre-?authenticat/i,
  // Paste or provide a key, token, secret or password (not "add a key field").
  /\b(?:paste|provide|send|share|enter|supply|give us|set)\b[^.\n]{0,30}\b(?:api[ -]?key|licen[cs]e key|key|token|secret|password|credentials?)\b(?!\s+(?:field|column|attribute|entity|input))/i,
  // Install a tool on the machine.
  /\binstall(?:ing)?\b[^.\n]{0,30}\b(?:tool|cli|jdk|java|node(?:\.js)?|python|docker|studio pro|mxcli|gh|git|runtime|sdk|on (?:the|this|your) (?:machine|computer|pc))\b/i,
  // Allow or grant something: a permission, access, a prompt at the terminal.
  /\b(?:allow|grant|approve|accept)\b[^.\n]{0,30}\b(?:permission|access|at the terminal|in the terminal|prompt|firewall)\b/i,
  // Restart a preview, the app, Studio Pro or the office.
  /\brestart(?:ing)?\b[^.\n]{0,30}\b(?:preview|the app|app server|runtime|studio pro|the office|server|the machine)\b/i,
];

/** Whether `text` asks for a hands-on action only a person can do. */
export const isHandsOn = (text: string): boolean => RULES.some((r) => r.test(text));
