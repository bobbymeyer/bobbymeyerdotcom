/**
 * Turning what GitHub returns into something the site can set.
 *
 * Both halves are about removing scaffolding. A README rendered by GitHub
 * carries the furniture of GitHub's own page — heading anchors, prefixed ids,
 * the repository name in an h1 the project page already has. A pull request
 * body carries the furniture of the pull request — review checklists in HTML
 * comments, tool footers, commit trailers. None of it is the writing.
 */

/** Lines and blocks that are a tool signing its name, not something written. */
const TRAILER = /^(?:co-authored-by|signed-off-by|claude-session|generated with):/i;
const TOOL_FOOTER = /^(?:🤖\s*)?generated (?:with|by) /i;
const SESSION_URL = /^https:\/\/claude\.ai\/code\//i;

const HEADING = /^#{1,6}\s+\S/;

/** The line a body stops at — see the loop in `cleanNote`. */
const BOILERPLATE =
  /^(?:dependabot (?:will resolve|commands|compatibility)|you can trigger dependabot|<summary>|-{3,}\s*$)/i;

const HTML_TAG =
  /<\/?(?:details|summary|p|br|h[1-6]|ul|ol|li|a|em|strong|b|i|code|pre|blockquote|img|picture|source|table|thead|tbody|tr|td|th|div|span|hr)\b[^>]*>/gi;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
};

/** A timeline entry is a line in a rail, not an essay. */
const NOTE_MAX = 320;

/**
 * The README as GitHub rendered it, with GitHub's page furniture taken off.
 *
 * The leading h1 goes because the project page states the title itself, and
 * two of them stacked is the sort of thing that makes a generated page look
 * generated. Heading ids keep working: GitHub prefixes them `user-content-`
 * to avoid colliding with its own markup, and nothing here collides, so the
 * prefix comes off and in-page links land where the README says they will.
 */
export function cleanReadmeHtml(html: string): string {
  // GitHub hands back the README inside the containers its own page would set
  // it in — `<div id="readme"><article class="markdown-body">`. The id would
  // collide with anything else on the page called readme and the classes
  // belong to a stylesheet this site does not load, so both come off before
  // anything else is done to what is inside them.
  let out = unwrap(unwrap(html.trim(), 'div'), 'article');

  // Newer renderings wrap a heading and its anchor in a div; older ones put
  // the anchor inside the heading. Flatten the wrapper, then drop the anchors.
  out = out.replace(
    /<div class="markdown-heading"[^>]*>\s*(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)[\s\S]*?<\/div>/g,
    '$1',
  );
  out = out.replace(/<a[^>]*class="[^"]*\banchor\b[^"]*"[^>]*>[\s\S]*?<\/a>/g, '');
  out = out.replace(/<a\s+name="[^"]*"\s*><\/a>/g, '');
  out = out.replace(/\sclass="heading-element"/g, '');

  out = out.replace(/\sid="user-content-([^"]*)"/g, ' id="$1"');
  out = out.replace(/href="#user-content-([^"]*)"/g, 'href="#$1"');

  // The h1 the page already carries, and only if it is the first thing.
  out = out.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>/, '');

  return out.trim();
}

/**
 * Take one wrapping element off, if the whole fragment is inside one.
 *
 * Only the outermost: the opening tag has to be the first thing and its
 * closing tag the last, and anything else is left exactly as it came.
 */
function unwrap(html: string, tag: string): string {
  const open = new RegExp(`^<${tag}\\b[^>]*>`);
  const close = new RegExp(`</${tag}>$`);
  if (!open.test(html) || !close.test(html)) return html;

  return html.replace(open, '').replace(close, '').trim();
}

/**
 * What was said when a pull request went in, as plain text.
 *
 * Plain text on purpose: this is set in a narrow rail beside the README, and a
 * body that brought its own headings and tables would fight the page it sits
 * next to. Markdown emphasis is unwrapped rather than rendered, links keep
 * their text and lose their target — the entry already links to the pull
 * request, which is where the whole thing is.
 */
export function cleanNote(body: string | null): string | null {
  if (!body) return null;

  let text = body.replace(/<!--[\s\S]*?-->/g, '');

  // Not every body is markdown. Dependabot writes HTML, and its release notes
  // go in a <details> that is collapsed on GitHub and would be several
  // screens of changelog here — so the block goes, and the tags around what
  // is left go with it. Only tags that are actually HTML are matched: a body
  // may well mention `<link>` or `<div>` as prose, and that is not markup.
  text = text.replace(/<details\b[^>]*>[\s\S]*?<\/details>/gi, '');
  text = text.replace(HTML_TAG, '');
  text = text.replace(
    /&(amp|lt|gt|quot|#39|apos|nbsp);/g,
    (_, name: string) => ENTITIES[name] ?? _,
  );

  // Before the lines are read, not after: a badge is a link around an image,
  // and until both are unwrapped a line that says nothing but "Dependabot
  // compatibility score" is a row of brackets and a URL.
  text = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  const kept: string[] = [];
  let started = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (TRAILER.test(trimmed) || TOOL_FOOTER.test(trimmed) || SESSION_URL.test(trimmed)) continue;

    // A pull request template opens on a heading — "What this is", "Why" —
    // and the entry above already answers it with the title. Later headings
    // stay: in a body written as a changelog, "Fixed" is what the lines under
    // it are. Only the one at the top goes.
    if (!started && HEADING.test(trimmed)) continue;

    // Where a body stops being about the change. Dependabot says what it
    // bumped in its first line and spends the rest telling a reviewer which
    // commands it answers to; a rule near the end of any body is nearly
    // always there to hold a footer up. Both end the note rather than
    // trimming it, because what follows either way is addressed to someone
    // standing in front of the pull request, not reading about it here.
    if (BOILERPLATE.test(trimmed)) break;

    if (trimmed) started = true;

    kept.push(line);
  }
  text = kept.join('\n');

  // A horizontal rule with nothing under it is what a stripped footer leaves.
  text = text.replace(/\n\s*(?:-{3,}|\*{3,}|_{3,})\s*$/, '');

  text = text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`{3,}[^\n]*\n[\s\S]*?`{3,}/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) return null;
  return truncate(text, NOTE_MAX);
}

/** Cut at the last sentence or word that fits, never mid-word. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;

  const head = text.slice(0, max);
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'));
  if (sentence > max * 0.5) return `${head.slice(0, sentence + 1)}`;

  const word = head.lastIndexOf(' ');
  return `${head.slice(0, word > 0 ? word : max).trimEnd()}…`;
}

/** A note as paragraphs, which is how it is set. */
export function noteParagraphs(note: string | null): string[] {
  return note ? note.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean) : [];
}
