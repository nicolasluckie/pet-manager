const RICH_TEXT = /(\*\*(.*?)\*\*|\[([^\]]+)\]\(([^)]+)\))/g;

/** Only http(s) and same-origin relative links are rendered as anchors. */
export function isSafeUrl(url) {
  if ((url.startsWith('/') && !url.startsWith('//')) || url.startsWith('./')) return true;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/** Inline markdown: **bold** and [link text](url). Everything else is plain text. */
export function renderRichText(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(RICH_TEXT)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2]) out.push(<strong key={m.index}>{m[2]}</strong>);
    else if (isSafeUrl(m[4])) {
      out.push(
        <a key={m.index} href={m[4]} target="_blank" rel="noopener noreferrer">
          {m[3]}
        </a>,
      );
    } else out.push(<span key={m.index}>{m[3]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
