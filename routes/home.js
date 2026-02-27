import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import {isBase64Image, isHttpUrl, isSupabaseStorageUrl, processImage, uploadToSupabase} from '../helper/Helper.js'

const router = express.Router();

// GET /api/home/types
router.get("/types", async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin.rpc(
        "get_home_types_with_items",
        {
          p_type_limit: 10,
          p_item_limit: 10
        }
      );
  
      if (error) {
        console.error(error);
        return res.status(400).json({ error: error.message });
      }
  
      res.json(data || []);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to load home data" });
    }
  });
  


export default router;