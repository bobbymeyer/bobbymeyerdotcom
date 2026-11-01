/**
 * Play one encounter in the terminal.
 *
 *   npm run play               a random seed
 *   npm run play -- --seed 42  that seed again
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { act } from '../src/rules.ts';
import { merchantEncounter } from '../src/setup.ts';
import { cardLine, eventLines, status } from './render.ts';

const flag = process.argv.indexOf('--seed');
const seed = flag >= 0 ? Number(process.argv[flag + 1]) : Math.floor(Math.random() * 2 ** 31);

const rl = createInterface({ input: stdin, output: stdout });
const lines = rl[Symbol.asyncIterator]();
let s = merchantEncounter(seed);
console.log(`seed ${seed}\n`);

while (!s.outcome) {
  console.log(status(s));
  console.log('');
  s.hand.forEach((c, i) => console.log(`  ${i + 1}  ${cardLine(c)}`));
  stdout.write('\nkeep two, in order (e.g. 31), or s to stop: ');
  const line = await lines.next();
  if (line.done) break;
  const answer = String(line.value).trim().toLowerCase();

  let next;
  try {
    if (answer === 's' || answer === 'stop') next = act(s, { type: 'stop' });
    else {
      const digits = answer.replace(/[^0-9]/g, '').split('').map((d) => Number(d) - 1);
      if (digits.length !== 2) throw new Error('name two cards');
      next = act(s, { type: 'keep', picks: [digits[0], digits[1]] });
    }
  } catch (err) {
    console.log(`  ${(err as Error).message}\n`);
    continue;
  }

  console.log(eventLines(next.events.slice(s.events.length).filter((e) => e.type !== 'dealt')).join('\n'));
  console.log('');
  s = next;
}

console.log(status(s));
rl.close();
