import { describe, it, expect, beforeEach, vi } from 'vitest';

const makeLink = (attrs) => ({
  attrs: { ...attrs },
  getAttribute(name) {
    return this.attrs[name] ?? null;
  },
  setAttribute(name, value) {
    this.attrs[name] = value;
  },
  removeAttribute(name) {
    delete this.attrs[name];
  },
});

describe('setFavicon', () => {
  let icon;
  let apple;
  let setFavicon;

  beforeEach(async () => {
    vi.resetModules();
    icon = makeLink({ href: '/favicon.svg', type: 'image/svg+xml' });
    apple = makeLink({ href: '/apple-touch-icon.png' });
    globalThis.document = {
      querySelector: (selector) => (selector.includes('apple') ? apple : icon),
    };
    ({ setFavicon } = await import('./favicon.js'));
  });

  it('replaces the icon and drops the SVG type', () => {
    setFavicon('/uploads/custom.png');
    expect(icon.attrs).toEqual({ href: '/uploads/custom.png' });
    expect(apple.attrs.href).toBe('/uploads/custom.png');
  });

  it('restores the original icon for null', () => {
    setFavicon('/uploads/custom.png');
    setFavicon(null);
    expect(icon.attrs).toEqual({ href: '/favicon.svg', type: 'image/svg+xml' });
    expect(apple.attrs).toEqual({ href: '/apple-touch-icon.png' });
  });
});
