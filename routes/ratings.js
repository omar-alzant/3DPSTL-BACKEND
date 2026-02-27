// src/routes/ratings.js
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { supabaseAnon, supabaseAdmin } from '../supabase.js';

const router = express.Router();

// router.get('/:item_id/comment', async (req, res) => {
//   const { item_id } = req.params;

//   const { data, error } = await supabaseAdmin
//     .from('comments')
//     .select('*')
//     .eq('item_id', item_id)
//     .order('updated_at', { ascending: false });


//   if (error) return res.status(400).json({ error: error.message });

//   res.json(data);
// });

router.get('/:item_id/ratings', async (req, res) => {
  const { item_id } = req.params;

  const { data, error } = await supabaseAdmin
    .from('ratings')
    .select('*')
    .eq('item_id', item_id)
    .order('updated_at', { ascending: false });


  if (error) return res.status(400).json({ error: error.message });

  res.json(data);
});

router.post('/:itemId/ratings', authMiddleware, async (req, res) => {
    const { itemId } = req.params;
    const { rate } = req.body;
    const userId = req.id;

    // Validation
    if (!Number.isInteger(rate) || rate < 1 || rate > 5) {
      return res.status(400).json({ error: 'Rate must be an integer between 1 and 5' });
    }

    const { error } = await supabaseAdmin
      .from('ratings')
      .upsert(
        {
          item_id: itemId,
          user_id: userId,
          rate
        },
        {
          onConflict: 'user_id,item_id'
        }
      );

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ success: true });
  }
);

router.post('/:itemId/comments', authMiddleware, async (req, res) => {
    const { itemId } = req.params;
    const { comment } = req.body;
    const userId = req.id;

    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: 'Comment is required' });
    }

    const { error } = await supabaseAdmin
      .from('comments')
      .upsert(
        {
          item_id: itemId,
          user_id: userId,
          comment: comment.trim(),
        },
        {
          onConflict: 'user_id,item_id'
        }
      )
      .select();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ success: true });
  }
);


router.put('/:itemId/ratings/:rating_id', authMiddleware, async (req, res) => {
  const { rating_id, itemId } = req.params;
  const { rate } = req.body;
  const user_id = req.id;

  if (!Number.isInteger(rate) || rate < 1 || rate > 5) {
    return res.status(400).json({ error: 'Rate must be 1–5' });
  }

  const { data, error } = await supabaseAdmin
    .from('ratings')
    .update({ rate })
    .eq('id', rating_id)
    .eq('item_id', itemId)
    .eq('user_id', user_id)
    .select()
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Rating not found' });
  }

  return res.json(data);
});


router.put('/:itemId/comment/:comment_id', authMiddleware, async (req, res) => {
  const { comment_id, itemId } = req.params;
  const { comment } = req.body;
  const user_id = req.id;

  if (!comment || !comment.trim()) {
    return res.status(400).json({ error: 'Comment is required' });
  }

  const { data, error } = await supabaseAdmin
    .from('comments')
    .update({ comment: comment.trim() })
    .eq('id', comment_id)
    .eq('item_id', itemId)
    .eq('user_id', user_id)
    .select()
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Comment not found' });
  }

  return res.json(data);
});


router.delete(
  '/:itemId/comment/:comment_id',
  authMiddleware,
  async (req, res) => {
    const { itemId } = req.params;
    const { comment_id } = req.params;
    const userId = req.id;


    const { error } = await supabaseAdmin
      .from('comments')
      .delete()
      .eq('item_id', itemId)
      .eq('id', comment_id)
      .eq('user_id', userId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    

    return res.json({ success: true });
  }
);

router.delete(
  '/:itemId/ratings/:rating_id',
  authMiddleware,
  async (req, res) => {
    const { itemId } = req.params;
    const userId = req.id;

    const { error } = await supabaseAdmin
      .from('ratings')
      .delete()
      .eq('item_id', itemId)
      .eq('id', rating_id )
      .eq('user_id', userId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ success: true });
  }
);

router.get(
  '/:itemId/reviews',
  async (req, res) => {
    const { itemId } = req.params;

    const { data, error } = await supabaseAdmin
      .rpc('get_item_reviews', { p_item_id: itemId });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json(data);
  }
);

export default router;
