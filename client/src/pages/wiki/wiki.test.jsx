import { describe, it, expect, beforeAll, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { isSafeUrl, renderRichText } from './richText.jsx';
import WikiArticle from './WikiArticle.jsx';

// The app's i18n module sets <html lang>; the node test environment has no DOM.
vi.hoisted(() => {
  globalThis.document = { documentElement: {} };
});
const { default: i18n } = await import('../../i18n/index.js');

const html = (nodes) => renderToStaticMarkup(<>{nodes}</>);

const article = (overrides = {}) => ({
  name: 'Mochi',
  subtitle: '',
  facts: {},
  infobox: [],
  image: null,
  sections: {},
  ...overrides,
});
const render = (a) => renderToStaticMarkup(<WikiArticle article={a} />);

beforeAll(() => i18n.changeLanguage('en'));

describe('isSafeUrl', () => {
  it('allows http(s) and same-origin relative URLs', () => {
    for (const url of ['https://example.com/a', 'http://example.com', '/path', './rel'])
      expect(isSafeUrl(url)).toBe(true);
  });
  it('blocks script, data and protocol-relative URLs', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', '//evil.com', 'nonsense', ''])
      expect(isSafeUrl(url)).toBe(false);
  });
});

describe('renderRichText', () => {
  it('renders **bold** and safe [links](url)', () => {
    const out = html(renderRichText('A **cat** and a [link](https://example.com).'));
    expect(out).toBe(
      'A <strong>cat</strong> and a <a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>.',
    );
  });
  it('renders unsafe links as plain text', () => {
    const out = html(renderRichText('[click](javascript:void)'));
    expect(out).toBe('<span>click</span>');
  });
  it('escapes HTML in the text', () => {
    expect(html(renderRichText('<img src=x onerror=alert(1)>'))).toContain('&lt;img');
  });
});

describe('WikiArticle', () => {
  it('renders the name, tagline and infobox for a minimal article', () => {
    const out = render(article());
    expect(out).toContain('<h1 class="wiki-title">Mochi</h1>');
    expect(out).toContain('Mochi&#x27;s personal page');
    expect(out).toContain('Given name');
    expect(out).not.toContain('<h2');
  });

  it('uses the custom subtitle instead of the default tagline', () => {
    expect(render(article({ subtitle: 'Domestic cat' }))).toContain('Domestic cat');
  });

  it('translates facts and lists them with the custom infobox rows', () => {
    const out = render(
      article({
        facts: { species: 'cat', sex: 'female', breed: 'Shorthair' },
        infobox: [{ label: 'Status', value: 'Adopted' }],
      }),
    );
    for (const text of ['Cat', 'Female', 'Shorthair', 'Status', 'Adopted'])
      expect(out).toContain(text);
  });

  it('renders the infobox twice (desktop and mobile variants)', () => {
    expect(render(article()).match(/class="wiki-infobox"/g)).toHaveLength(2);
  });

  it('renders only the sections that are present, in axel-wiki order', () => {
    const out = render(
      article({
        sections: {
          biography: { content: 'Intro', earlyLife: 'Early' },
          personality: { content: 'Nice', traits: ['Shy'] },
          health: { neutered: true, microchipped: false, vaccinations: [] },
          favourites: { toys: ['Ball'], foods: [], activities: [], sleepingSpots: [] },
          gallery: [{ file: 'a.png', caption: 'Nap' }],
          homeArea: { city: 'Toronto', state: '', notes: '' },
          contact: { ownerName: 'Nic', note: 'Be gentle' },
        },
      }),
    );
    const headings = [...out.matchAll(/<h2 class="wiki-h2">([^<]+)</g)].map((m) => m[1]);
    expect(headings).toEqual([
      'Biography',
      'Personality',
      'Health',
      'Favourite things',
      'Gallery',
      'Home area',
      'Contact information',
    ]);
    expect(out).toContain('/uploads/a.png');
    expect(out).toContain('If you found Mochi, please reach out!');
    expect(out).toContain('Be gentle');
  });

  it('skips empty favourite groups and shows Yes/No flags', () => {
    const out = render(
      article({
        sections: {
          health: { neutered: true, microchipped: false },
          favourites: { toys: ['Ball'], foods: [], activities: [], sleepingSpots: [] },
        },
      }),
    );
    expect(out).toContain('>Toys<');
    expect(out).not.toContain('>Foods<');
    expect(out).toMatch(/Spayed \/ Neutered<\/th><td>Yes</);
    expect(out).toMatch(/Microchipped<\/th><td>No</);
  });

  it('escapes user text', () => {
    const out = render(article({ name: '<script>x</script>' }));
    expect(out).not.toContain('<script>x');
  });

  it('is localised', async () => {
    await i18n.changeLanguage('de');
    const out = render(
      article({ sections: { homeArea: { city: 'Berlin', state: '', notes: '' } } }),
    );
    await i18n.changeLanguage('en');
    expect(out).toContain('Wohngebiet');
  });
});
