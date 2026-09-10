/** Gallery links retain the app mount, including GitHub Pages project paths. */
export function treatmentNavigation(href: string) {
  const app = new URL(href);
  const treatmentPath = /\/treatments(?:\/.*)?$/;
  const pathPreview = treatmentPath.test(app.pathname);
  const isPreview = pathPreview || app.searchParams.has('design');
  if (pathPreview) app.pathname = app.pathname.replace(treatmentPath, '/') || '/';
  app.searchParams.delete('design');
  app.hash = '';
  const gallery = new URL(app);
  gallery.searchParams.set('design', '');
  return { isPreview, appUrl: app.toString(), galleryUrl: gallery.toString() };
}
