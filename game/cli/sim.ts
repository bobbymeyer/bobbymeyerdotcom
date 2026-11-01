/**
 * Run bots through thousands of encounters and print how they come out. This
 * is the tool for tuning numbers: if no stopping rule beats "never stop", the
 * push-your-luck is not pushing back.
 *
 *   npm run sim                  2000 encounters per bot
 *   npm run sim -- --runs 10000
 */

import type { Card, Effect } from '../src/cards.ts';
import { type Action, type EncounterState, type Outcome, act } from '../src/rules.ts';
import { merchantEncounter } from '../src/setup.ts';

type Bot = { name: string; choose: (s: EncounterState) => Action };

/** A rough value for one effect from where the bot is sitting. */
function effectValue(e: Effect, s: EncounterState): number {
  const danger = s.ship.hull <= 3 ? 3 : 1;
  switch (e.kind) {
    case 'hit': return e.amount * 0.8;
    case 'hurt': return -Math.max(0, e.amount - s.ship.brace) * 1.5 * danger;
    case 'plunder': return Math.min(e.amount, s.target.cargo);
    case 'repair': return Math.min(e.amount, s.ship.maxHull - s.ship.hull) * danger;
    case 'brace': return e.amount * 0.7;
    case 'jettison': return -Math.min(e.amount, s.target.cargo) * 0.8;
    case 'mend': return -e.amount * 0.8;
  }
}

const cardValue = (c: Card, s: EncounterState) => c.effects.reduce((v, e) => v + effectValue(e, s), 0);

/** Keep the two best cards, better one first, ignoring the order subtleties. */
function bestKeep(s: EncounterState): Action {
  const ranked = s.hand.map((c, i) => ({ i, v: cardValue(c, s) })).sort((a, b) => b.v - a.v);
  // Repair and brace want to go before hurt; otherwise the better card first.
  const [a, b] = [ranked[0].i, ranked[1].i];
  const defensive = (c: Card) => c.effects.some((e) => e.kind === 'repair' || e.kind === 'brace');
  return defensive(s.hand[b]) && !defensive(s.hand[a])
    ? { type: 'keep', picks: [b, a] }
    : { type: 'keep', picks: [a, b] };
}

function worstForcedHurt(s: EncounterState): number {
  // The least hurt you can take from this hand, given you must keep two.
  const hurts = s.hand.map((c) => c.effects.reduce((h, e) => h + (e.kind === 'hurt' ? e.amount : 0), 0)).sort((a, b) => a - b);
  return Math.max(0, hurts[0] + hurts[1] - s.ship.brace);
}

const bots: Bot[] = [
  { name: 'never stops', choose: bestKeep },
  { name: 'stops at hull ≤ 2', choose: (s) => (s.ship.hull <= 2 ? { type: 'stop' } : bestKeep(s)) },
  { name: 'stops at hull ≤ 4', choose: (s) => (s.ship.hull <= 4 ? { type: 'stop' } : bestKeep(s)) },
  { name: 'stops if hand could sink', choose: (s) => (worstForcedHurt(s) >= s.ship.hull ? { type: 'stop' } : bestKeep(s)) },
  { name: 'stops at plunder ≥ 6', choose: (s) => (s.plunder >= 6 ? { type: 'stop' } : bestKeep(s)) },
  {
    name: 'random keeps',
    choose: (s) => {
      const a = (s.round * 7 + s.deck.length) % 3;
      return { type: 'keep', picks: [a, (a + 1) % 3] };
    },
  },
];

const flag = process.argv.indexOf('--runs');
const runs = flag >= 0 ? Number(process.argv[flag + 1]) : 2000;
const outcomes: Outcome[] = ['stopped', 'destroyed', 'escaped', 'sunk'];

console.log(`${runs} encounters per bot, seeds 0..${runs - 1}\n`);
console.log(['bot'.padEnd(26), 'payout', 'rounds', ...outcomes.map((o) => o.padStart(9))].join(' '));

for (const bot of bots) {
  let payout = 0;
  let rounds = 0;
  const counts: Record<Outcome, number> = { stopped: 0, destroyed: 0, escaped: 0, sunk: 0 };
  for (let seed = 0; seed < runs; seed++) {
    let s = merchantEncounter(seed);
    while (!s.outcome) s = act(s, bot.choose(s));
    payout += s.payout;
    rounds += s.round;
    counts[s.outcome!]++;
  }
  const pct = (n: number) => `${((100 * n) / runs).toFixed(1)}%`.padStart(9);
  console.log([
    bot.name.padEnd(26),
    (payout / runs).toFixed(2).padStart(6),
    (rounds / runs).toFixed(1).padStart(6),
    ...outcomes.map((o) => pct(counts[o])),
  ].join(' '));
}
