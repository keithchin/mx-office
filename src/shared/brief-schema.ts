// The JSON schemas the Chief Analyst's planning calls answer in (server/wizard/planner/cli.ts passes them to
// `claude -p --json-schema`): the brief, a chat turn (the brief again plus a short reply), and the
// functional domains. What comes back is cleaned by shared/brief.ts cleanBrief either way: the schema
// shapes the answer, the honesty rules decide the tags.

const TAG = { type: 'string', enum: ['answered', 'assumed', 'unverified'] };
const SOURCE = { type: 'string', description: 'Where it came from: "from your description", "from <file> p.N", "inferred from …" for a default you chose, or for an open question "open question" ("open question (from <file> p.N)" when a document raises it)' };
const ITEM = { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, tag: TAG, source: SOURCE }, required: ['text', 'tag', 'source'], additionalProperties: false };
const ROLE = { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, text: { type: 'string', description: 'What the role is, one line' }, when: { type: 'string', description: '"When I…, I need to…, so I can…"' }, whenSource: { type: 'string', description: '"drafted" when you wrote the statement, or "from your description" / "from <file> p.N" when it says so' }, tag: TAG, source: SOURCE }, required: ['name', 'text', 'when', 'whenSource', 'tag', 'source'], additionalProperties: false };
const SCOPE = { type: 'object', properties: { id: { type: 'string' }, side: { type: 'string', enum: ['in', 'out'] }, text: { type: 'string' }, tag: TAG, source: SOURCE }, required: ['side', 'text', 'tag', 'source'], additionalProperties: false };
const list = (items: object, max: number) => ({ type: 'array', items, maxItems: max });

const BRIEF_PROPS = {
  title: { type: 'string', description: 'The app’s name, two to four words' },
  description: { type: 'string', description: 'One line about the app' },
  goal: list(ITEM, 2),
  success: list(ITEM, 8),
  roles: list(ROLE, 8),
  scope: list(SCOPE, 16),
  constraints: list(ITEM, 10),
  questions: list(ITEM, 10),
};
const BRIEF_REQUIRED = ['title', 'description', 'goal', 'success', 'roles', 'scope', 'constraints', 'questions'];

export const BRIEF_SCHEMA = {
  type: 'object',
  properties: { ...BRIEF_PROPS, filesRead: { type: 'array', items: { type: 'string' }, description: 'The attached files you actually read' } },
  required: [...BRIEF_REQUIRED, 'filesRead'],
  additionalProperties: false,
};

export const CHAT_SCHEMA = {
  type: 'object',
  properties: { reply: { type: 'string', description: 'Your answer to the person, two or three sentences, saying what you changed' }, ...BRIEF_PROPS },
  required: ['reply', ...BRIEF_REQUIRED],
  additionalProperties: false,
};

const STORY = { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string', description: '"As a …, I want …, so that …"' }, ac: { type: 'integer', minimum: 1, maximum: 9, description: 'How many acceptance criteria it needs' } }, required: ['title', 'text', 'ac'], additionalProperties: false };
const DOMAIN = { type: 'object', properties: { code: { type: 'string', description: 'Three capital letters' }, name: { type: 'string' }, roles: { type: 'array', items: { type: 'string' } }, description: { type: 'string' }, stories: list(STORY, 8) }, required: ['code', 'name', 'roles', 'description', 'stories'], additionalProperties: false };

export const DOMAINS_SCHEMA = {
  type: 'object',
  properties: { domains: list(DOMAIN, 8), tier: { type: 'string', enum: ['small', 'standard'] }, tierWhy: { type: 'string' } },
  required: ['domains', 'tier', 'tierWhy'],
  additionalProperties: false,
};
