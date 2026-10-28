import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { photoUrl } from '../../api/client.js';
import { formatDate } from '../../lib/format.js';
import { renderRichText } from './richText.jsx';
import './wiki.css';

const FACT_KEYS = ['species', 'breed', 'sex', 'color', 'born'];

function Section({ id, title, children }) {
  return (
    <section id={id} className="wiki-section">
      <h2 className="wiki-h2">{title}</h2>
      {children}
    </section>
  );
}

function Subsection({ title, children }) {
  return (
    <>
      <h3 className="wiki-h3">{title}</h3>
      {children}
    </>
  );
}

function BulletList({ items }) {
  return (
    <ul className="wiki-list">
      {items.map((item, i) => (
        <li key={`${item}-${i}`}>{item}</li>
      ))}
    </ul>
  );
}

function Infobox({ article }) {
  const { t } = useTranslation();
  const { name, image, facts, infobox } = article;
  const factValue = (key) =>
    key === 'species'
      ? t(`species.${facts.species}`)
      : key === 'sex'
        ? t(`pets.sex.${facts.sex}`)
        : key === 'born'
          ? formatDate(facts.born)
          : facts[key];
  const rows = [
    ...FACT_KEYS.filter((k) => facts[k]).map((k) => ({
      label: t(`wiki.article.${k}`),
      value: factValue(k),
    })),
    ...infobox,
  ];
  return (
    <table className="wiki-infobox">
      <thead>
        <tr>
          <th colSpan={2}>{name}</th>
        </tr>
      </thead>
      <tbody>
        {image && (
          <tr>
            <td colSpan={2} className="wiki-infobox-image">
              <img src={photoUrl(image.file)} alt={name} width={260} />
              {image.caption && <div className="wiki-caption">{image.caption}</div>}
            </td>
          </tr>
        )}
        <tr className="wiki-row">
          <th scope="row">{t('wiki.article.givenName')}</th>
          <td className="wiki-value">{name}</td>
        </tr>
        {rows.map((row, i) => (
          <tr key={`${row.label}-${i}`} className="wiki-row">
            <th scope="row">{row.label}</th>
            <td className="wiki-value">{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KeyValueTable({ rows, wide }) {
  return (
    <table className="wiki-kv">
      <tbody>
        {rows.map(([label, value], i) => (
          <tr key={label}>
            <th scope="row" className={i === 0 && wide ? 'wiki-kv-wide' : undefined}>
              {label}
            </th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Wikipedia-style article of a pet; `article` is the payload of the wiki API. */
export default function WikiArticle({ article }) {
  const { t } = useTranslation();
  const { name, subtitle, sections: s } = article;
  const yesNo = (v) => (v ? t('common.yes') : t('common.no'));
  const favourites = [
    ['toys', 'toys'],
    ['foods', 'foods'],
    ['activities', 'activities'],
    ['sleepingSpots', 'sleepingSpots'],
  ];
  const health = s.health;
  const healthRows = health
    ? [
        health.neutered !== undefined && [t('wiki.article.spayedNeutered'), yesNo(health.neutered)],
        health.microchipped !== undefined && [
          t('wiki.article.microchipped'),
          yesNo(health.microchipped),
        ],
        health.allergies && [t('wiki.article.allergies'), health.allergies],
        health.dietaryNotes && [t('wiki.article.dietaryNotes'), health.dietaryNotes],
      ].filter(Boolean)
    : [];

  return (
    <div className="wiki">
      <a href="#wiki-main" className="wiki-skip">
        {t('nav.skipToContent')}
      </a>
      <div className="wiki-page">
        <header>
          <h1 className="wiki-title">{name}</h1>
          <p className="wiki-tagline">{subtitle || t('wiki.article.tagline', { name })}</p>
        </header>
        <main id="wiki-main">
          <div className="wiki-infobox-desktop">
            <Infobox article={article} />
          </div>

          {s.biography?.content && (
            <p className="wiki-intro">{renderRichText(s.biography.content)}</p>
          )}

          <div className="wiki-infobox-mobile">
            <Infobox article={article} />
          </div>

          {s.biography?.earlyLife && (
            <Section id="biography" title={t('wiki.article.biography')}>
              <Subsection title={t('wiki.article.earlyLife')}>
                <p>{s.biography.earlyLife}</p>
              </Subsection>
            </Section>
          )}

          {s.personality && (
            <Section id="personality" title={t('wiki.article.personality')}>
              {s.personality.content && <p>{s.personality.content}</p>}
              {s.personality.traits.length > 0 && (
                <Subsection title={t('wiki.article.knownTraits')}>
                  <BulletList items={s.personality.traits} />
                </Subsection>
              )}
            </Section>
          )}

          {health && (
            <Section id="health" title={t('wiki.article.health')}>
              {health.content && <p>{health.content}</p>}
              {healthRows.length > 0 && <KeyValueTable rows={healthRows} wide />}
              {health.vaccinations && (
                <Subsection title={t('wiki.article.vaccinations')}>
                  <ul className="wiki-list">
                    {health.vaccinations.map((v, i) => (
                      <li key={`${v.name}-${v.date}-${i}`}>
                        <span className="wiki-medium">{v.name}</span>
                        <span className="wiki-muted">({formatDate(v.date)})</span>
                      </li>
                    ))}
                  </ul>
                </Subsection>
              )}
            </Section>
          )}

          {s.favourites && (
            <Section id="favourites" title={t('wiki.article.favourites')}>
              <div className="wiki-grid-2">
                {favourites
                  .filter(([key]) => s.favourites[key].length > 0)
                  .map(([key, label]) => (
                    <Fragment key={key}>
                      <div>
                        <Subsection title={t(`wiki.article.${label}`)}>
                          <BulletList items={s.favourites[key]} />
                        </Subsection>
                      </div>
                    </Fragment>
                  ))}
              </div>
            </Section>
          )}

          {s.gallery && (
            <Section id="gallery" title={t('wiki.article.gallery')}>
              <div className="wiki-grid-gallery">
                {s.gallery.map((img) => (
                  <figure key={img.file} className="wiki-figure">
                    <img src={photoUrl(img.file)} alt={img.caption} loading="lazy" />
                    {img.caption && <figcaption>{img.caption}</figcaption>}
                  </figure>
                ))}
              </div>
            </Section>
          )}

          {s.homeArea && (
            <Section id="home-area" title={t('wiki.article.homeArea')}>
              {(s.homeArea.city || s.homeArea.state) && (
                <KeyValueTable
                  rows={[
                    s.homeArea.city && [t('wiki.article.city'), s.homeArea.city],
                    s.homeArea.state && [t('wiki.article.state'), s.homeArea.state],
                  ].filter(Boolean)}
                />
              )}
              {s.homeArea.notes && <p className="wiki-note">{s.homeArea.notes}</p>}
            </Section>
          )}

          {s.contact && (
            <Section id="contact" title={t('wiki.article.contact')}>
              <div className="wiki-alert">
                <p className="wiki-alert-title">🔎 {t('wiki.article.found', { name })}</p>
                {s.contact.note && <p className="wiki-alert-note">{s.contact.note}</p>}
              </div>
              <KeyValueTable rows={[[t('wiki.article.owner'), s.contact.ownerName]]} />
            </Section>
          )}
        </main>

        <div className="wiki-separator" />
        <footer className="wiki-footer">{t('wiki.article.footer', { name })}</footer>
      </div>
    </div>
  );
}
