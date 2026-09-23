/**
 * What a pull request body is allowed to arrive as, and what it is allowed to
 * leave as.
 *
 * Every case here is a note this site actually published. The rail is one
 * column of plain text beside a readme, and three kinds of markdown used to
 * walk straight into it — a table's pipes, a list's markers, and a code span,
 * which was worse than leaking because the tag strip reached inside it and
 * took the contents out. Eighty-four notes were carrying one of the three.
 *
 * Run with `npm test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanNote, cleanReadmeHtml } from './github-text.ts';

test('a code span keeps what is inside it, tags and all', () => {
  const note = cleanNote('asked whether a README *began* with an `<h1>`, and it did not');
  // Published as "an ``" — the tag strip ran over the whole body, code spans
  // included, and `<h1>` looked exactly like markup to it.
  assert.equal(note, 'asked whether a README began with an <h1>, and it did not');
});

test('a fenced block goes whole, and takes no backticks with it', () => {
  const note = cleanNote('What it runs:\n\n```sh\nbin/setup --skip-server\n```\n\nand then nothing.');
  assert.equal(note, 'What it runs:\n\nand then nothing.');
});

test('a table is dropped rather than printed as pipes', () => {
  const note = cleanNote(
    'Same seed across all of them:\n\n| Panel | What it shows |\n| :-- | :-- |\n| One | a dot |\n\nThat is the whole change.',
  );
  assert.equal(note, 'Same seed across all of them:\n\nThat is the whole change.');
});

test('a list keeps its lines and loses its markers', () => {
  const note = cleanNote('Four changes.\n\n- one thing\n- another thing\n  - nested\n1. numbered');
  assert.equal(note, 'Four changes.\n\none thing\nanother thing\nnested\nnumbered');
});

test('emphasis is unwrapped, single marks as well as double', () => {
  assert.equal(cleanNote('a **bold** and an *italic* and an _underscore_'),
    'a bold and an italic and an underscore');
});

test('a bare asterisk is left where it stands', () => {
  // Not emphasis: nothing closes it, and a footnote marker is somebody's text.
  assert.equal(cleanNote('see the note marked * at the foot'), 'see the note marked * at the foot');
});

test('a link keeps its words and loses its target', () => {
  assert.equal(cleanNote('Spec: [ROADMAP.md](https://example.com/ROADMAP.md)'), 'Spec: ROADMAP.md');
});

test('an opening heading goes, and later ones stay', () => {
  assert.equal(cleanNote('## What this is\n\nA thing.\n\n## Fixed\n\nAnother thing.'),
    'A thing.\n\nFixed\n\nAnother thing.');
});

test('a tool footer and its trailers end the note', () => {
  assert.equal(
    cleanNote('The change.\n\n---\n🤖 Generated with [Claude Code](https://claude.com/claude-code)'),
    'The change.',
  );
});

test('a body with nothing left in it is nothing', () => {
  assert.equal(cleanNote('## Why\n'), null);
  assert.equal(cleanNote(''), null);
  assert.equal(cleanNote(null), null);
});

test("a README's title goes even when it does not come first", () => {
  // funcooker opens on a screenshot; the rule used to require the h1 be the
  // literal first thing and walked past it, so the page set two titles.
  const html = cleanReadmeHtml('<p><img src="x.png"></p>\n<h1>funcooker</h1>\n<h2>quickstart</h2>');
  assert.equal(html.includes('<h1>'), false);
  assert.equal(html.includes('<h2>quickstart</h2>'), true);
});

test('an h1 after another heading is a section, and stays', () => {
  const html = cleanReadmeHtml('<h2>quickstart</h2>\n<h1>later</h1>');
  assert.equal(html.includes('<h1>later</h1>'), true);
});
