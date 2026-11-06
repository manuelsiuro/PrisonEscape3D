/**
 * The web fonts (Fredoka, Inter) known to the page: their stylesheet loaded (index.html doesn't let
 * it hold up the first paint, v2.34.2), then whatever is loading done. Asked before the stylesheet
 * is in, `document.fonts` knows no face and answers at once: a canvas drawn then stays in the
 * fallback font. Never rejects.
 */
export function fontsKnown(): Promise<void> {
  // (No web fonts at all: a headless test's page.)
  if (!document.fonts) return Promise.resolve();
  const link = document.querySelector<HTMLLinkElement>('link[data-fonts]');
  const sheet =
    !link || link.media === 'all'
      ? Promise.resolve()
      : new Promise((done) => ['load', 'error'].forEach((e) => link.addEventListener(e, done, { once: true })));
  return sheet
    .then(() => document.fonts?.ready)
    .then(
      () => {},
      () => {},
    );
}
