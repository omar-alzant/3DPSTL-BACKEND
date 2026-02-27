import express from 'express';
import { SitemapStream } from 'sitemap'; // Added missing import
import zlib from 'zlib'; // Added missing import
import { supabaseAdmin } from '../supabase.js';

const router = express.Router();

// Changed from '/sitemap.xml' to '/' because it's already prefixed in index.js
router.get('/', async (req, res) => {
  try {
    res.header('Content-Type', 'application/xml');
    res.header('Content-Encoding', 'gzip');


    const smStream = new SitemapStream({ hostname: 'https://libanbebe.com' });
    // 
    // const smStream = new SitemapStream({ hostname: 'http://localhost:3000' });
    const pipeline = smStream.pipe(zlib.createGzip());

    // 1. Static Pages
    smStream.write({ url: '/', changefreq: 'daily', priority: 1.0 });
    smStream.write({ url: '/shop', changefreq: 'daily', priority: 0.9 });

    // 2. Fetch Categories
    const { data: types } = await supabaseAdmin
      .from('types')
      .select('id, updated_at');

    if (types) {
      types.forEach((cat) => {
        smStream.write({
          url: `/shop?type_id=${cat.id}`, // Fixed path to match your logic
          lastmod: cat.updated_at,
          changefreq: 'weekly',
          priority: 0.8,
        });
      });
    }

    // // 3. Fetch Products (CRITICAL for the "Professional" search look)
    const { data: items } = await supabaseAdmin
      .from('items') // Ensure this is your product table name
      .select('id, updated_at');

    if (items) {
      items.forEach((item) => {
        smStream.write({
          url: `/item/${item.id}`, // Matches your React Route path="/item/:id"
          lastmod: item.updated_at,
          changefreq: 'weekly',
          priority: 0.7,
        });
      });
    }

    smStream.end();
    pipeline.pipe(res).on('error', (e) => { throw e });
  } catch (e) {
    console.error("Sitemap error:", e);
    res.status(500).end();
  }
});

export default router;