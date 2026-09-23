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

/**
 * A row of a markdown table: a line of pipe-separated cells, or the `|:--|`
 * rule under the header. Either way it is a grid, and the rail it would be
 * set in is one column wide.
 */
const TABLE_ROW = /^\|.*\|?\s*$|^\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/;

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
/**
 * Point a README's relative links at the repository they were written against.
 *
 * GitHub rewrites relative paths in *markdown* image and link syntax before it
 * hands the HTML over, but leaves them alone inside raw `<img>` and `<a>` tags,
 * which a README uses as soon as it wants to set a width. Relative is correct on
 * github.com, where the page sits at the repository; on a project page here the
 * browser resolves it against /posts/<slug> and gets nothing. Assets go to raw,
 * links go to the blob view, and anything already absolute, rooted, or an anchor
 * is left as it is.
 */
function absolutize(html: string, repo: string, branch: string): string {
  const relative = (url: string) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(url);
  const clean = (url: string) => url.replace(/^\.\//, '');

  return html
    .replace(/(<(?:img|source)\b[^>]*?\ssrc=")([^"]+)(")/gi, (m, head, url, tail) =>
      relative(url)
        ? `${head}https://raw.githubusercontent.com/${repo}/${branch}/${clean(url)}${tail}`
        : m,
    )
    .replace(/(<a\b[^>]*?\shref=")([^"]+)(")/gi, (m, head, url, tail) =>
      relative(url)
        ? `${head}https://github.com/${repo}/blob/${branch}/${clean(url)}${tail}`
        : m,
    );
}

export function cleanReadmeHtml(html: string, repo?: { nameWithOwner: string; branch: string }): string {
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

  // The h1 the page already carries.
  //
  // It is the README's title, and a title is the first *heading* in the file
  // rather than the first thing in it: funcooker opens on a screenshot, so a
  // rule that only fired on a fragment beginning `<h1>` walked straight past
  // it and the project page set its own title with the README's stacked under
  // it. What matters is that no other heading has been met yet — an h1 after
  // an h2 is a section, and sections stay.
  const title = out.search(/<h1[\s>]/i);
  const heading = out.search(/<h[2-6][\s>]/i);
  if (title !== -1 && (heading === -1 || title < heading)) {
    out =
      out.slice(0, title).replace(/\s*$/, '') +
      out.slice(title).replace(/^<h1[^>]*>[\s\S]*?<\/h1>/i, '');
  }

  if (repo) out = absolutize(out, repo.nameWithOwner, repo.branch);

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
 *
 * The order below is the whole of it. This used to be a pile of independent
 * replacements over one string, and three things went wrong at once because
 * of it: nothing knew about lists or tables, so a changelog arrived in the
 * rail as `- item` and `| Panel | What it shows |`; and the tag strip reached
 * inside code spans and ate what it found, so a note about an `<h1>` was
 * published reading "asked whether a README began with an ``". Eighty-four
 * notes on this site were carrying one of the three.
 *
 * So: code spans come out first and go back last, and every pass in between
 * runs over a body that no longer contains any.
 */
export function cleanNote(body: string | null): string | null {
  if (!body) return null;

  let text = body.replace(/<!--[\s\S]*?-->/g, '');

  // Fenced blocks go whole, before anything counts a backtick.
  text = text.replace(/^[ \t]*`{3,}[^\n]*\n[\s\S]*?^[ \t]*`{3,}[ \t]*$/gm, '');

  // Then the inline ones, lifted out and held.
  //
  // Everything downstream — the tag strip, the entity decode, the emphasis
  // unwrapping — is written for prose, and inside a code span none of it is
  // prose. `<div>` in backticks is a word somebody typed, not markup, and the
  // rule that deletes markup cannot tell the difference. Nor should it have
  // to: it never sees one.
  const spans: string[] = [];
  text = text.replace(/`+([^`\n]+?)`+/g, (_, code: string) => {
    spans.push(code);
    return `\u0000${spans.length - 1}\u0000`;
  });

  // Not every body is markdown. Dependabot writes HTML, and its release notes
  // go in a <details> that is collapsed on GitHub and would be several
  // screens of changelog here — so the block goes, and the tags around what
  // is left go with it.
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

    // A table is a shape, and this rail is one column wide. Rendering it is
    // out of the question and printing its pipes is worse — a delimiter row
    // is not even prose, it is punctuation holding a grid up that is not
    // here. The whole row goes, cells and all: what a changelog table says is
    // said again in the sentence above it, and a note is a line in a rail.
    if (TABLE_ROW.test(trimmed)) continue;

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
    // Spaces and tabs, not `\s`: with `m` the caret matches at the head of a
    // blank line, and `\s` will happily eat that line's own newline on its way
    // to the hashes — so every heading in a note used to close the paragraph
    // above it up against itself.
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    // A bullet keeps its line and loses its marker. The marker is a shape the
    // rail does not draw — there is no hanging indent here and no room for
    // one — and a list of four things reads as four lines without it. The
    // nesting goes with the indent, for the same reason.
    .replace(/^[ \t]*[-*+][ \t]+/gm, '')
    .replace(/^[ \t]*\d{1,3}[.)][ \t]+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    // The single-mark pair the old rule left behind, which is why a note that
    // said a README *began* with something published the asterisks.
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1$2')
    .replace(/(^|[^_\w])_(?!\s)([^_\n]+?)(?<!\s)_(?!_)/g, '$1$2')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // And the code back, as the words they were.
  text = text.replace(/\u0000(\d+)\u0000/g, (_, i: string) => spans[Number(i)] ?? '');

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
