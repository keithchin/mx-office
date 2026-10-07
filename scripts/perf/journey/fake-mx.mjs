#!/usr/bin/env node
// A stand-in for Studio Pro's mx, for the journey's test office only: `mx create-project --app-name X
// --output-dir D` writes an empty D/X.mpr (enough for the wizard to find the app); `mx show-version`
// says the stub's version. Nothing else.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (args[0] === 'create-project') {
  const dir = flag('output-dir') ?? process.cwd();
  const name = flag('app-name') ?? 'App';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.mpr`), '');
  console.log(`fake mx: created ${name}.mpr`);
} else if (args[0] === 'show-version') {
  console.log('11.12.4');
} else {
  console.log('fake mx');
}
