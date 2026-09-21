export function initContactForm() {
  const form = document.querySelector<HTMLFormElement>('.contact-form');
  if (!form) return;

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
