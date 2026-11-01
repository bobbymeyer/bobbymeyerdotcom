/** The one encounter the first slice knows about: you, and a fat merchant. */

import { MERCHANT_CARDS, SHIP_CARDS, buildDeck } from './cards.ts';
import { type EncounterState, createEncounter } from './rules.ts';

export function merchantEncounter(seed: number): EncounterState {
  return createEncounter({
    seed,
    shipCards: buildDeck('ship', SHIP_CARDS),
    targetCards: buildDeck('target', MERCHANT_CARDS),
    ship: { hull: 6, maxHull: 6, brace: 0 },
    target: { name: 'merchant', hull: 10, maxHull: 10, cargo: 12, bounty: 4 },
  });
}
