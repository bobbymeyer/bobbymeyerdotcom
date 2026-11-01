# encounter

The first slice of a card game, headless. No art, no renderer: a rules
module, a terminal harness to play it, and a simulator to tune it.

It sits in this repository for now and is meant to move into its own repo
before it goes on the site, the way every other project on bobbymeyer.com
does.

## the loop

1. Your ship's cards and the target's cards are shuffled into one deck.
2. Three are dealt. Keep two, in the order they should resolve. The third
   goes to the bottom.
3. It ends when you **stop** (keep your plunder), **destroy** the target
   (plunder plus bounty, its hold goes down with it), get **sunk** (lose this
   encounter's plunder), or the deck can't deal a full hand and the target
   **escapes** (keep your plunder).

You see the hand before you choose, so you can stop on a hand that would sink you.

## running it

No dependencies to run, only Node 22.12+.

```bash
npm test                     # the rules
npm run play                 # one encounter, random seed
npm run play -- --seed 42    # that encounter again
npm run sim                  # bots × 2000 seeds
npm run check                # type-check (needs npm install)
```

## layout

```
src/
  rng.ts         seeded RNG; its whole state is one integer kept in the game state
  cards.ts       the effect vocabulary and the placeholder decks
  rules.ts       createEncounter, act, legalActions — pure, no I/O
  setup.ts       the one encounter so far: you and a merchant
  rules.test.ts
cli/
  play.ts        the interactive harness
  sim.ts         bots and their outcome tables
  render.ts      text rendering shared by both
```

`rules.ts` knows nothing about drawing. A renderer reads `EncounterState`
and its `events` log and sends `Action`s back. The `events` log is there so a
renderer can animate what happened, not just show the new state.

## what the simulator says so far

With ship hull 6 and merchant hull 10, over 5,000 seeds:

| bot | payout | sunk |
| --- | --- | --- |
| never stops | 7.8 | 40% |
| stops at hull ≤ 2 | 9.4 | 11% |
| stops if the hand could sink you | 11.7 | 0.3% |
| random keeps | 0.6 | 94% |

The push-your-luck now pushes back. Reading the hand is worth about 50% more
than never stopping, and choosing badly is fatal. With the first numbers
(hull 8, fewer guns on the merchant), nobody sank and stopping never
helped.

Open questions:

- **Escape never happens.** Each deck is a fixed budget. The merchant deck
  holds 14 hurt against your 6 hull, so riding the deck to the end sinks you
  first. The ship deck holds 11 hit, so a merchant with 12 hull can't be
  sunk at all. Escape needs either a target that runs (a card that shrinks
  the deck) or a deck too thin to empty you.
- **Destroying beats stopping when you can.** The bounty (4) is bigger than
  the cargo it sinks in most runs. Destroying a target should probably cost
  something, or its hold should be worth more.
