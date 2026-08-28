export function normalizePath(pathname: string): string {
  const path = pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '');
  return path || '/';
}
