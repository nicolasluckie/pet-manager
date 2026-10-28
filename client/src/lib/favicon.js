// Swaps the browser tab icon at runtime; `null` restores the icon from index.html.
const SELECTORS = ['link[rel="icon"]', 'link[rel="apple-touch-icon"]'];
const originals = new Map();

export function setFavicon(href) {
  for (const selector of SELECTORS) {
    const link = document.querySelector(selector);
    if (!link) continue;
    if (!originals.has(selector)) {
      originals.set(selector, { href: link.getAttribute('href'), type: link.getAttribute('type') });
    }
    const original = originals.get(selector);
    link.setAttribute('href', href ?? original.href);
    // The type attribute describes the built-in SVG; custom icons are raster images.
    if (href || !original.type) link.removeAttribute('type');
    else link.setAttribute('type', original.type);
  }
}
