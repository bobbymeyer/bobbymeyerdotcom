/** Plain-text rendering, shared by the harnesses. */

import type { Card, Effect } from '../src/cards.ts';
import type { EncounterState, GameEvent } from '../src/rules.ts';

const bar = (n: number, max: number) => '█'.repeat(Math.max(0, n)) + '·'.repeat(Math.max(0, max - n));

export function cardLine(c: Card): string {
  const who = c.side === 'ship' ? 'yours ' : 'theirs';
  return `${who}  ${c.name.padEnd(18)} ${c.text}`;
}

export function status(s: EncounterState): string {
  const ship = s.ship;
  const t = s.target;
  return [
    `round ${s.round}   deck ${s.deck.length}`,
    `you       hull ${bar(ship.hull, ship.maxHull)} ${ship.hull}/${ship.maxHull}${ship.brace ? `  brace ${ship.brace}` : ''}   plunder ${s.plunder}`,
    `${t.name.padEnd(9)} hull ${bar(t.hull, t.maxHull)} ${t.hull}/${t.maxHull}   cargo ${t.cargo}   bounty ${t.bounty}`,
  ].join('\n');
}

function effectLine(e: Effect, applied: number): string {
  const verb: Record<Effect['kind'], string> = {
    hit: 'hits the target for',
    hurt: 'hurts you for',
    plunder: 'hauls aboard',
    repair: 'repairs',
    brace: 'braces for',
    jettison: 'throws overboard',
    mend: 'mends the target by',
  };
  const short = applied !== e.amount && e.kind !== 'hurt' ? ` (of ${e.amount})` : '';
  return `    ${verb[e.kind]} ${applied}${short}`;
}

export function eventLines(events: GameEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.type === 'played') out.push(`  ▸ ${e.card.name}`);
    else if (e.type === 'effect') out.push(effectLine(e.effect, e.applied));
    else if (e.type === 'rejected') out.push(`  ▾ ${e.card.name} goes to the bottom`);
    else if (e.type === 'ended') out.push(`\n${e.outcome.toUpperCase()} — you walk away with ${e.payout}`);
  }
  return out;
}
