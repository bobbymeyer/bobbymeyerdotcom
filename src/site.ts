/**
 * The things the site says about itself, in one place.
 *
 * The name, the line under it and the place are set on the index, on the
 * about page and on every social card, and they should not drift between the
 * three. `NAME` is the person; `HANDLE` is what the browser tab and the
 * search result call the site, which is the domain without the dot-com.
 */

/**
 * The person.
 *
 * Lowercase, which is how he sets it — the header lockup always did, and the
 * rest of the site follows it rather than the other way round. It is not the
 * general rule for names on this site, only for this one.
 */
export const NAME = 'bobby meyer';

/** What a `<title>` is attributed to, and what the social card signs off. */
export const HANDLE = 'bobbymeyer';

export const DOMAIN = 'bobbymeyer.com';

/**
 * Where else to find him.
 *
 * A project page already links to its own repository, so this is the profile
 * rather than the source: the answer to "what else has he got", which the
 * index cannot give because the index is only the projects he chose to put on
 * it.
 */
export const GITHUB = {
  url: 'https://github.com/bobbymeyer',
  /** How it is written when the address is worth showing rather than hiding. */
  label: 'github.com/bobbymeyer',
};

/** The line under the name, on the index and on the card. */
export const LEDE =
  'I make computers build stuff, talk to each other, and look good while doing it.';

export const PLACE = 'Ojai, CA';

/** The meta description for pages that do not write their own. */
export const DESCRIPTION = `${NAME} — projects, newest change first.`;

/**
 * A page title, attributed.
 *
 * The page names itself and the site adds the signature, so `about` becomes
 * `about — bobbymeyer` and a project becomes `🐼 pandatone — bobbymeyer`. The
 * index passes nothing and is the handle on its own, because
 * `bobbymeyer — bobbymeyer` is not a thing anyone wants in a tab.
 */
export function pageTitle(title?: string): string {
  return title ? `${title} — ${HANDLE}` : HANDLE;
}
