export function initContactForm() {
  const form = document.querySelector<HTMLFormElement>('.contact-form');
  if (!form) return;

  // The page calls this directly *and* on `astro:page-load`, which the client
  // router fires for the first load as well as for later ones. Without this
  // the form carries two submit handlers, and a single press of Send posts
  // the message twice — two rows in Netlify Forms and two notification
  // emails for every enquiry.
  if (form.dataset.wired) return;
  form.dataset.wired = 'true';

  const error = form.querySelector<HTMLElement>('.contact-form-error');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error?.setAttribute('hidden', '');

    // Every browser accepts a FormData here and encodes it, and has for
    // years; TypeScript's DOM library does not say so, because FormData's
    // iterator can in principle yield a File and URLSearchParams takes
    // strings. This form is three text fields, so it cannot. The cast is
    // that, and not a shortcut past a real problem.
    const body = new URLSearchParams(
      new FormData(form) as unknown as Record<string, string>,
    ).toString();

    try {
      const response = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!response.ok) throw new Error('submit failed');
      window.location.href = form.getAttribute('action') ?? '/contact/success/';
    } catch {
      error?.removeAttribute('hidden');
    }
  });
}
