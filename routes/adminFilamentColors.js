// src/routes/adminFilamentColors.js
import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.get("/", async (req, res) => {

    const { data, error } = await supabaseAdmin
      .from("filament_colors")
      .select(`
        id,
        name,
        hex,
        stock,
        active,
        material_id,
        brand_id,
        filament_materials(name),
        filament_brands(name)
      `)
      .order("created_at", { ascending: false });
  
    if (error) return res.status(500).json(error);
  
    res.json(data);
  });

  router.get("/meta", authMiddleware, async (req, res) => {

    const [materials, brands] = await Promise.all([
  
      supabaseAdmin
        .from("filament_materials")
        .select("id,name"),
  
      supabaseAdmin
        .from("filament_brands")
        .select("id,name")
  
    ]);
  
    res.json({
      materials: materials.data || [],
      brands: brands.data || []
    });
  
  });

  router.post("/", authMiddleware, async (req, res) => {

    const {
      name,
      hex,
      material_id,
      brand_id,
      stock
    } = req.body;
  
    const { data, error } = await supabaseAdmin
      .from("filament_colors")
      .insert({
        name,
        hex,
        material_id,
        brand_id,
        stock
      })
      .select()
      .single();
  
    if (error) return res.status(500).json(error);
  
    res.json(data);
  });

  router.put("/:id", authMiddleware, async (req, res) => {

    const { id } = req.params;
  
    const { data, error } = await supabaseAdmin
      .from("filament_colors")
      .update(req.body)
      .eq("id", id)
      .select()
      .single();
  
    if (error) return res.status(500).json(error);
  
    res.json(data);
  });

  router.delete("/:id", authMiddleware, async (req, res) => {

    const { id } = req.params;
  
    const { error } = await supabaseAdmin
      .from("filament_colors")
      .delete()
      .eq("id", id);
  
    if (error) return res.status(500).json(error);
  
    res.json({ success: true });
  });

export default router;
