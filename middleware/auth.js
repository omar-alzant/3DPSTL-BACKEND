import jwt from  'jsonwebtoken';

import { supabaseAnon } from  '../supabase.js';



export async function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access denied' });

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) {
      // ⭐️ This tells the frontend to log out!
      return res.status(401).json({ error: 'Token expired or invalid' });
    }

    const userId = decoded.id;
    const email = decoded.email;
    
    // Optional: Check if token matches the current_token in DB (Single Session Logic)
    const { data: profile } = await supabaseAnon
      .from('profiles')
      .select('current_token')
      .eq('id', userId)
      .single();

    if (profile?.current_token !== token) {
      return res.status(401).json({ error: 'Session used on another device' });
    }

    req.id = userId;
    req.email = email;
    next();
  });
}