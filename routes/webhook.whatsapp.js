// src/routes/webhook.whatsapp.js
import express from 'express';
import { supabaseAdmin } from '../supabase.js';

const router = express.Router();

// Verification (GET)
router.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Receiver (POST)
router.post('/', async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const messages = change?.messages || [];

    for (const msg of messages) {
      const from = msg.from; // sender phone
      // Interactive reply?
      const buttonId = msg?.interactive?.button_reply?.id || msg?.button?.payload || null;

      if (buttonId) {
        // Expected format: confirm_<orderId> / cancel_<orderId>
        if (buttonId.startsWith('confirm_')) {
          const orderId = buttonId.replace('confirm_', '');
          await supabaseAdmin.from('orders').update({ status: 'confirmed' }).eq('id', orderId);
        } else if (buttonId.startsWith('cancel_')) {
          const orderId = buttonId.replace('cancel_', '');
          await supabaseAdmin.from('orders').update({ status: 'cancelled' }).eq('id', orderId);
        }
      } else if (msg.text?.body) {
        // Fallback: if user replies "CONFIRM" or "CANCEL"
        const body = msg.text.body.trim().toUpperCase();
        // You could map phone -> last pending order for that phone:
        const { data: pending } = await supabaseAdmin
          .from('orders')
          .select('id')
          .eq('shipping_phone', from)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (pending?.id) {
          if (body.includes('CONFIRM')) {
            await supabaseAdmin.from('orders').update({ status: 'confirmed' }).eq('id', pending.id);
          } else if (body.includes('CANCEL')) {
            await supabaseAdmin.from('orders').update({ status: 'cancelled' }).eq('id', pending.id);
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (e) {
    res.sendStatus(200); // Avoid retries storm; log the error in Railway logs
  }
});

export default router;
