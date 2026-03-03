// src/routes/orders.js
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { sendOrderConfirmation } from '../services/whatsapp.js';

const router = express.Router();

/// GET /api/orders/admin/all
router.get('/admin/all', authMiddleware, async (req, res) => {
  try {
    // 1️⃣ Check Admin Status
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('is_Admin')
      .eq('id', req.id)
      .single();

    if (!profile?.is_Admin)
      return res.status(403).json({ error: "Unauthorized" });

    // 2️⃣ Fetch orders WITH items
    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select(`
        *,
        items:order_items (
          id,
          item_id,
          product_name,
          size,
          color,
          qty,
          price
        )
      `)
      .order('updated_at', { ascending: false });

    if (error) throw error;

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/my', authMiddleware, async (req, res) => {
  try {
    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('user_id', req.id)
      .order('updated_at', { ascending: false });

    if (error) throw error;

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/admin/remove-item/:orderId', authMiddleware, async (req, res) => {
  const { orderId } = req.params;
  const { itemId } = req.body;

  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('is_Admin')
      .eq('id', req.id)
      .single();

    if (!profile?.is_Admin)
      return res.status(403).json({ error: "Unauthorized" });

    const { error } = await supabaseAdmin.rpc(
      'remove_order_item_admin',
      {
        p_order_id: orderId,
        p_item_id: itemId
      }
    );

    if (error) throw error;

    res.json({ success: true });

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/admin/status/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status, note } = req.body;

  // 1. Backend Validation
  const allowedStatuses = ['pending', 'confirmed', 'delivered'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ 
      error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` 
    });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('orders')
      .update({ 
        status, 
        note, 
        updated_at: new Date().toISOString() 
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { items, shipping, note } = req.body;

    const skuIds = items.map(i => i.sku);

    const { data: dbVariants, error: itErr } = await supabaseAdmin
      .from('variants')
      .select('id, price, size, color, sku, stock, item_id, items(id, name)')
      .in('sku', skuIds);

    if (itErr) return res.status(400).json({ error: itErr.message });

    const variantMap = Object.fromEntries(
      dbVariants.map(v => [v.sku, v])
    );

    let total = 0;

    // Validate stock + compute total
    for (const clientLine of items) {
      const dbRow = variantMap[clientLine.sku];

      if (!dbRow)
        return res.status(404).json({ error: `SKU ${clientLine.sku} not found` });

      if (dbRow.stock < clientLine.qty)
        return res.status(400).json({
          error: `Not enough stock for ${dbRow.items.name} (${dbRow.size})`
        });

      total += Number(dbRow.price) * Number(clientLine.qty);
    }

    // 1️⃣ Create Order (NO JSON ITEMS)
    const { data: order, error: ordErr } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: req.id,
        status: 'pending',
        total_amount: total,
        shipping_name: shipping.name,
        shipping_phone: shipping.phone,
        shipping_address: shipping.address,
        shipping_city: shipping.city,
        note
      })
      .select()
      .single();

    if (ordErr) return res.status(400).json({ error: ordErr.message });

    // 2️⃣ Insert Order Items Rows
    const orderItemRows = items.map(clientLine => {
      const dbRow = variantMap[clientLine.sku];

      return {
        order_id: order.id,
        item_id: dbRow.items.id,
        sku: clientLine.sku,
        qty: clientLine.qty,
        price: Number(dbRow.price),
        product_name: dbRow.items.name,
        size: dbRow.size,
        color: dbRow.color
      };
    });

    const { error: itemInsertErr } = await supabaseAdmin
      .from('order_items')
      .insert(orderItemRows);

    if (itemInsertErr)
      return res.status(400).json({ error: itemInsertErr.message });

    // 3️⃣ Decrement Stock
    const stockUpdates = orderItemRows.map(item =>
      supabaseAdmin.rpc('decrement_stock', {
        row_sku: item.sku,
        qty_to_subtract: item.qty
      })
    );

    const stockResults = await Promise.all(stockUpdates);

    if (stockResults.some(r => r.error)) {
      console.error("Stock sync error occurred.");
    }

    res.status(201).json({
      // orderId: order.id,
      order: order,
      items: orderItemRows
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  const { data: order, error: orderErr } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('id', id)
    .eq('user_id', req.id) // make sure user owns it
    .single();

  if (orderErr) return res.status(400).json({ error: orderErr.message });

  const { data: items, error: itemErr } = await supabaseAdmin
    .from('order_items')
    .select('*')
    .eq('order_id', id);

  if (itemErr) return res.status(400).json({ error: itemErr.message });

  res.json({ order, items });
});

export default router;
