// src/routes/catalogs.js
import express from "express";
import { supabaseAdmin } from "../supabase.js";
import {isBase64Image, isHttpUrl, isSupabaseStorageUrl, processImage, uploadToSupabase} from '../helper/Helper.js'

const router = express.Router();


router.get("/menu", async (req, res) => {
    try {
      // Call the custom PostgreSQL function
      const { data, error } = await supabaseAdmin.rpc('get_full_navigation_menu');
    
      if (error) {
          console.error("RPC get_full_navigation_menu error:", error);
          return res.status(400).json({ error: error.message });
      }
      res.json({ data: data || [] }); 
      
    } catch (err) {
      console.error("Get Navigation Menu error:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const { name, galleryurls, sort_order, isdisabled, description } = req.body;
      let uploadedBannerUrls = []
  
      if (Array.isArray(galleryurls) && galleryurls.length > 0) {
        const uploadPromises = image.map(async (img) => {
          if (isSupabaseStorageUrl(img)) {
            return img;
          }
            if (isBase64Image(img)) {
            return await processImage(img, 'category-images', 'banner');
            }
            if (isHttpUrl(img)) {
            return img;
          }
            return null;
        });
  
        uploadedBannerUrls = (await Promise.all(uploadPromises)).filter(Boolean);
      }


      const { data, error } = await supabaseAdmin
        .from("categories")
        .insert({
          name,
          galleryurls: uploadedBannerUrls ?? [],
          description,
          sort_order: sort_order ?? 0,
          isdisabled: isdisabled ?? false,
        })
        .select()
        .single();
  
      if (error) return res.status(400).json({ error });
      res.json(data);
    } catch (err) {
      console.error("Create Category error:", err);
      res.status(500).json({ error: "Server error" });
    }
  });
  

router.get("/relations/:id", async (req, res) => {
  try {
    const {id} = req.params;
    const {data, error} = await supabaseAdmin.rpc('get_category_by_id', {cat_id: id});
    if (error) return res.status(400).json({ error });
    res.json(data);
  } catch (err) {
    console.error("Get Category Relations error by id:", id, err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/relations/all", async (req, res) => {
  try {
    const {data, error} = await supabaseAdmin.from('category_full_view').select('*');
  
    if (error) return res.status(400).json({ error });
    res.json(data);
  } catch (err) {
    console.error("Get Category Relations error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/** GET all catalogs */
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("categories")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) return res.status(400).json({ error });
    res.json(data);
  } catch (err) {
    console.error("Get Categories error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    let updates = { ...req.body, updated_at: new Date().toISOString() };
    let uploadedBannerUrls = []

    if (Array.isArray(updates.galleryurls)) {
      const uploadPromises = updates.galleryurls.map(async (img) => {
        if (isSupabaseStorageUrl(img)) return img;     // keep
        if (isBase64Image(img)) return await uploadToSupabase(img, "category-images", "banner");
        if (isHttpUrl(img)) return img;                // optional
        return null;
      });
  
      uploadedBannerUrls = (await Promise.all(uploadPromises)).filter(Boolean);
    }

    updates = { ...req.body
        , galleryurls: uploadedBannerUrls, updated_at: new Date().toISOString() }
   
    const { data, error } = await supabaseAdmin
      .from("categories")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(400).json({ error });
    res.json(data);
  } catch (err) {
    console.error("Update Category error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


/** DELETE catalog */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from("categories")
      .delete()
      .eq("id", id);

    if (error) return res.status(400).json({ error });
    res.json({ message: "Category deleted" });
  } catch (err) {
    console.error("Delete Category error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
