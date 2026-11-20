// Accepts a map link (Google Maps, Apple Maps, Waze) or coordinates "33.89, 35.50".
// Returns a clean https link, or '' if it isn't a map location (we never store random links).
const HOSTS = [
  /^(www\.)?google\.[a-z.]+$/,   // google.com/maps/...
  /^maps\.google\.[a-z.]+$/,
  /^maps\.app\.goo\.gl$/,
  /^goo\.gl$/,                   // goo.gl/maps/...
  /^maps\.apple\.com$/,
  /^maps\.apple$/,
  /^(www\.)?waze\.com$/,
];

export function normalizeMapLink(raw) {
  const v = typeof raw === 'string' ? raw.trim().slice(0, 600) : '';
  if (!v) return '';

  // plain coordinates
  const m = v.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (m) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return `https://www.google.com/maps?q=${lat},${lng}`;
    return '';
  }

  // a link somewhere in the text (shared links often come with a title before them)
  const urlText = (v.match(/https?:\/\/\S+/) || [])[0] || (/^[\w.-]+\.[a-z]{2,}\//i.test(v) ? `https://${v}` : '');
  if (!urlText) return '';
  try {
    const u = new URL(urlText);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    const host = u.hostname.toLowerCase();
    if (!HOSTS.some((r) => r.test(host))) return '';
    if (/^(www\.)?google\./.test(host) && !u.pathname.startsWith('/maps')) return '';
    if (host === 'goo.gl' && !u.pathname.startsWith('/maps')) return '';
    u.protocol = 'https:';
    return u.toString();
  } catch {
    return '';
  }
}
