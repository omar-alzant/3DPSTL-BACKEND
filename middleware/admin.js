// src/middleware/admin.js
import { supabaseAdmin } from '../supabase.js';

export async function requireAdmin(req, res, next) {
  try {
    const userId = req.id; // comes from your auth middleware

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Fetch the profile of the logged-in user
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('is_Admin')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Supabase error:', error.message);
      return res.status(500).json({ error: 'Failed to verify admin status' });
    }

    if (!profile?.is_Admin) {
      return res.status(403).json({ error: 'Admin access only' });
    }

    // If admin → continue to next route
    next();

  } catch (err) {
    console.error('requireAdmin error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
