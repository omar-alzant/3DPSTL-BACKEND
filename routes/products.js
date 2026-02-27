// src/routes/products.js
import express from 'express';
import { supabaseAdmin } from '../supabase.js';

const router = express.Router();

/** GET /api/products?market=&type=&q=&color=&size=&gender=&age=&maxPrice= */
router.get('/', async (req, res) => {
  try {
    const { market, type, q, color, size, gender, age, maxPrice } = req.query;

    // Base query over a view or join; here we keep it simple: list variants with model/type/market names.
    let query = supabaseAdmin
      .from('items_view') // 👉 create a DB view joining items/models/types/markets (recommended)
      .select('*');

    if (market)   query = query.eq('market', market);
    if (type)     query = query.eq('type', type);
    if (color)    query = query.ilike('color', `%${color}%`);
    if (size)     query = query.ilike('size', `%${size}%`);
    if (gender)   query = query.eq('gender', gender);
    if (age)      query = query.ilike('age', `%${age}%`);
    if (maxPrice) query = query.lte('price', Number(maxPrice));
    if (q)        query = query.filter('search_text', 'ilike', `%${q}%`); // or use FTS column

    const { data, error } = await query.limit(60);
    if (error) return res.status(400).json({ error });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to list products' });
  }
});

/** GET /api/products/:itemId */
router.get('/:itemId', async (req, res) => {
  const { itemId } = req.params;
  const { data, error } = await supabaseAdmin
    .from('items_view')
    .select('*')
    .eq('id', itemId)
    .single();
  if (error) return res.status(404).json({ error: 'Item not found' });
  res.json(data);
});

export default router;
