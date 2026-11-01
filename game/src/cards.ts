/**
 * What a card is, and the placeholder decks for the first slice.
 *
 * The rules only read `effects`; `name` and `text` are for whoever is drawing
 * the card. Effects resolve in the order they are listed.
 */

export type Side = 'ship' | 'target';

export type Effect =
  /** Damage to the target's hull. */
  | { kind: 'hit'; amount: number }
  /** Damage to your hull, less any brace you are holding. */
  | { kind: 'hurt'; amount: number }
  /** Cargo moved from the target's hold to yours. Capped by what is left. */
  | { kind: 'plunder'; amount: number }
  /** Hull back on your ship, up to its maximum. */
  | { kind: 'repair'; amount: number }
  /** Soaks up the next points of `hurt`. Lasts until it is used. */
  | { kind: 'brace'; amount: number }
  /** The target throws cargo overboard: gone for both of you. */
  | { kind: 'jettison'; amount: number }
  /** Hull back on the target, up to its maximum. */
  | { kind: 'mend'; amount: number };

export interface Card {
  /** Unique within an encounter: `broadside#2`. */
  id: string;
  side: Side;
  name: string;
  text: string;
  effects: Effect[];
}

export interface CardDef {
  key: string;
  name: string;
  text: string;
  effects: Effect[];
  copies: number;
}

/** Expand definitions into individual cards with unique ids. */
export function buildDeck(side: Side, defs: readonly CardDef[]): Card[] {
  const cards: Card[] = [];
  for (const def of defs) {
    for (let n = 1; n <= def.copies; n++) {
      cards.push({ id: `${def.key}#${n}`, side, name: def.name, text: def.text, effects: def.effects });
    }
  }
  return cards;
}

// Placeholder content. The numbers are what the simulator is for.

export const SHIP_CARDS: readonly CardDef[] = [
  { key: 'broadside', name: 'broadside', text: 'hit 3', effects: [{ kind: 'hit', amount: 3 }], copies: 2 },
  { key: 'raking-fire', name: 'raking fire', text: 'hit 2', effects: [{ kind: 'hit', amount: 2 }], copies: 2 },
  { key: 'grapple', name: 'grapple and haul', text: 'plunder 3', effects: [{ kind: 'plunder', amount: 3 }], copies: 2 },
  { key: 'boarding', name: 'boarding party', text: 'plunder 4, hurt 1', effects: [{ kind: 'plunder', amount: 4 }, { kind: 'hurt', amount: 1 }], copies: 1 },
  { key: 'swivel', name: 'swivel guns', text: 'hit 1, plunder 1', effects: [{ kind: 'hit', amount: 1 }, { kind: 'plunder', amount: 1 }], copies: 1 },
  { key: 'patch', name: 'patch the hull', text: 'repair 2', effects: [{ kind: 'repair', amount: 2 }], copies: 1 },
  { key: 'brace', name: 'brace', text: 'brace 2', effects: [{ kind: 'brace', amount: 2 }], copies: 1 },
];

export const MERCHANT_CARDS: readonly CardDef[] = [
  { key: 'return-fire', name: 'return fire', text: 'hurt 2', effects: [{ kind: 'hurt', amount: 2 }], copies: 4 },
  { key: 'stern-chasers', name: 'stern chasers', text: 'hurt 1', effects: [{ kind: 'hurt', amount: 1 }], copies: 2 },
  { key: 'grapeshot', name: 'grapeshot', text: 'hurt 3', effects: [{ kind: 'hurt', amount: 3 }], copies: 1 },
  { key: 'jettison', name: 'jettison cargo', text: 'jettison 3', effects: [{ kind: 'jettison', amount: 3 }], copies: 2 },
  { key: 'carpenters', name: 'carpenters below', text: 'mend 2', effects: [{ kind: 'mend', amount: 2 }], copies: 1 },
  { key: 'strike', name: 'strike colours', text: 'plunder 3', effects: [{ kind: 'plunder', amount: 3 }], copies: 1 },
  { key: 'crack-on', name: 'crack on sail', text: 'jettison 1, hurt 1', effects: [{ kind: 'jettison', amount: 1 }, { kind: 'hurt', amount: 1 }], copies: 1 },
];
