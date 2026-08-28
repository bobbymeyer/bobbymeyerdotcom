const ACCENT = '.site-accent';

function isNavPath(pathname: string) {
  const path = pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '') || '/';
  return path === '/' || path === '/about' || path === '/contact' || path.startsWith('/contact/');
}

if (typeof document !== 'undefined') {
  document.addEventListener('astro:before-preparation', (event) => {
    if (isNavPath(new URL(event.to).pathname)) return;
    document.querySelector<HTMLElement>(ACCENT)?.style.setProperty('visibility', 'hidden');
  });
}
