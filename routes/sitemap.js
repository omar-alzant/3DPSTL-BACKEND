// GET /sitemap (served as https://www.3dpstl.com/sitemap.xml through netlify.toml)
// All public pages: home, shop + categories, products, Studio + every enabled tool, info pages.
// Built as plain XML (no gzip: Netlify/Google compress on their own) and cached for an hour.
import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { loadSettings } from './studio.js';

const router = express.Router();
const SITE = () => (process.env.SITE_URL || 'https://www.3dpstl.com').replace(/\/$/, '');

// Studio tools — the `id` inside each tool file in src/Sources/studio/tools/ (not the file name). Add new tools here too
const STUDIO_TOOLS = [
  'name-keychain', 'pencil-topper', 'initial-sign', 'dual-name', 'lebanese-plate', 'plate-keychain',
  'keycaps', 'tpu-tote', 'flexi-toy', 'birth-sign', 'phone-case',
  'qr-code', 'coaster', 'cookie-cutter', 'stamp', 'ramadan-tray', 'desk-organizer', 'lebanon-keychain',
  'lithophane', 'photo-lampshade', 'vase', 'jigsaw-puzzle', 'clicker', 'split', 'job-outfit',
];

const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const day = (d) => {
  const t = d ? new Date(d) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 10) : null;
};

let cache = { at: 0, xml: '' };

async function build() {
  const urls = [];
  const add = (path, changefreq, priority, lastmod) => urls.push({ loc: SITE() + path, changefreq, priority, lastmod: day(lastmod) });

  // pages
  add('/', 'daily', 1.0);
  add('/our-works', 'daily', 0.9);
  add('/studio', 'weekly', 0.9);
  add('/tools', 'monthly', 0.6);
  add('/filamentColors', 'monthly', 0.5);
  add('/aboutUs', 'monthly', 0.5);
  add('/terms', 'yearly', 0.2);
  add('/privacy', 'yearly', 0.2);

  // Studio tools (only the ones enabled in the admin)
  try {
    const settings = await loadSettings();
    for (const id of STUDIO_TOOLS) {
      if (settings?.tools?.[id]?.enabled === false) continue;
      add(`/studio/${id}`, 'weekly', 0.8);
    }
  } catch (err) {
    console.error('sitemap studio:', err.message);
  }

  // shop categories
  const { data: types, error: te } = await supabaseAdmin.from('types').select('id, updated_at');
  if (te) console.error('sitemap types:', te.message);
  for (const t of types || []) add(`/our-works?type_id=${t.id}`, 'weekly', 0.7, t.updated_at);

  // products
  const { data: items, error: ie } = await supabaseAdmin
    .from('items').select('id, updated_at').not('isdisabled', 'is', true);
  if (ie) console.error('sitemap items:', ie.message);
  for (const it of items || []) add(`/item/${it.id}`, 'weekly', 0.8, it.updated_at);

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((u) => `  <url><loc>${xmlEsc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.changefreq}</changefreq><priority>${u.priority.toFixed(1)}</priority></url>`)
  .join('\n')}
</urlset>
`;
}

router.get('/', async (req, res) => {
  try {
    if (!cache.xml || Date.now() - cache.at > 60 * 60e3) cache = { at: Date.now(), xml: await build() };
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(cache.xml);
  } catch (e) {
    console.error('Sitemap error:', e);
    if (cache.xml) return res.type('application/xml').send(cache.xml); // last good copy
    res.status(500).end();
  }
});

export default router;
