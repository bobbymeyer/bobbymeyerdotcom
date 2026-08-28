export function initContactForm() {
  const form = document.querySelector<HTMLFormElement>('.contact-form');
  if (!form) return;

  const error = form.querySelector<HTMLElement>('.contact-form-error');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error?.setAttribute('hidden', '');

    const body = new URLSearchParams(new FormData(form)).toString();

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
