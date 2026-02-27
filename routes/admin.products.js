// src/routes/admin.products.js
import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import {isBase64Image, isHttpUrl, isSupabaseStorageUrl, processImage, uploadToSupabase} from '../helper/Helper.js'

const router = express.Router();

//  Brands Endpoints
router.get('/market', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabaseAdmin
    .from('brands')
    .select('*', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .range(from, to);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({
    items: data,
    total: count,
    page,
    pageSize,
  });
});

router.put('/market/:id', authMiddleware, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, description, image, isdisabled } = req.body;
  // const userId = req.id;
  let uploadedUrls = [];

  if (Array.isArray(image)) {
    const uploadPromises = image.map(async (img) => {
      if (isSupabaseStorageUrl(img)) return img;     // keep
      if (isBase64Image(img)) return await uploadToSupabase(img, "brands-images", "gallery");
      if (isHttpUrl(img)) return img;                // optional
      return null;
    });

    uploadedUrls = (await Promise.all(uploadPromises)).filter(Boolean);
  }

  const { data, error } = await supabaseAdmin
    .from('brands')
    .update({ 
      name, description, image:uploadedUrls, isdisabled, updated_at: new Date().toISOString() 
    })
    .eq('id', id)   // 👈 Make sure to update the correct row
    .select();      // return the updated row(s)

  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.status(200).json(data);
});

router.post('/market',authMiddleware, requireAdmin, async (req, res) => {
  try{
    const {
      name, description, image, isdisabled
    } = req.body;

    let { data: mk } = await supabaseAdmin.from('brands').select('*').eq('name', name).maybeSingle();
    let uploadedUrls = [];
    if (!mk) {

      // const galleryBucketUrls =
      //   normalizeArray(image ?? req.body.image) || [];
  
      if (Array.isArray(image) && image.length > 0) {
        const uploadPromises = image.map(async (img) => {
          if (isSupabaseStorageUrl(img)) {
            return img;
          }
            if (isBase64Image(img)) {
            return await processImage(img, 'brands-images');
            }
            if (isHttpUrl(img)) {
            return img;
          }
            return null;
        });
  
        uploadedUrls = (await Promise.all(uploadPromises)).filter(Boolean);
      }
      const ins = await supabaseAdmin.from('brands').insert({ name, description, image:uploadedUrls, isdisabled: isdisabled}).select().single();
      if (ins.error) return res.status(400).json({ error: ins.error.message });
      mk = ins.data;
    }
    res.status(201).json({ mk });
  } catch (e) {
    res.status(500).json({ error: 'Failed to insert brand' });
  }
});

//   Type Endpoints
router.get('/type', async (req, res) => {
  const { data: types, error } = await supabaseAdmin
    .from('types')
    .select('*')
    .order('updated_at', { ascending: false });


  if (error) {
    return res.status(400).json({ error: error.message });
  }

  if (!types || types.length === 0) {
    return res.json([]);
  }

  const categoriesIds = Array.from(new Set(types.map(t => t.category_id).filter(Boolean)));

  const { data: categories, error: categoriesError } = await supabaseAdmin
    .from('categories')
    .select('id, name')
    .in('id', categoriesIds);

  if (categoriesError) {
    return res.status(400).json({ error: categoriesError.message });
  }

  const marketIdToName = new Map((categories || []).map(m => [m.id, m.name]));
  const enriched = types.map(t => ({
    ...t,
    category_name: marketIdToName.get(t.category_id) || null,
  }));

  res.json(enriched);
});

router.post('/type', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { category_id, name, description, image, isdisabled } = req.body;

      // 1. Resolve Category
      let { data: ct, error: catError } = await supabaseAdmin
          .from('categories')
          .select('id')
          .eq('id', category_id)
          .maybeSingle();

      if (catError || !ct) {
           return res.status(404).json({ error: 'Category not found.' });
      }
      
      // 2. Try to find existing Type linked to this Category (using the category_id foreign key on 'types' table)
      let { data: tp } = await supabaseAdmin.from('types')
      .select('id')
      .eq('category_id', ct.id) // Still needed for uniqueness check
      .eq('name', name)
      .maybeSingle();

      // 3. Create Type if it doesn't exist
      let uploadedUrls = [];
      if (!tp) {

        // const galleryBucketUrls =
        //   normalizeArray(image ?? req.body.image) || [];
    
        if (Array.isArray(image) && image.length > 0) {
          const uploadPromises = image.map(async (img) => {
            if (isSupabaseStorageUrl(img)) {
              return img;
            }
              if (isBase64Image(img)) {
              return await processImage(img, 'types-images');
              }
              if (isHttpUrl(img)) {
              return img;
            }
              return null;
          });
    
          uploadedUrls = (await Promise.all(uploadPromises)).filter(Boolean);
        }

        const ins = await supabaseAdmin.from('types').insert({ 
              category_id: ct.id, // Insert into the foreign key column
              name, image: uploadedUrls, description, isdisabled 
          }).select().single();
          
          if (ins.error) return res.status(400).json({ error: ins.error.message });
          tp = ins.data;
      }

      res.status(201).json({ tp });

  } catch (e) {
      console.error("Create Type error:", e.message);
      res.status(500).json({ error: 'Failed to create type' });
  }
});

router.put('/type/:id', authMiddleware, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { category_id, name, description, image, isdisabled } = req.body;
  
  let updatedCategoryId = null;

  // 1. Resolve the new Category (if category_id is provided)
  let uploadedUrls = [];
  if (category_id) {

    if (Array.isArray(image)) {
      const uploadPromises = image.map(async (img) => {
        if (isSupabaseStorageUrl(img)) return img;     // keep
        if (isBase64Image(img)) return await uploadToSupabase(img, "types-images", "gallery");
        if (isHttpUrl(img)) return img;                // optional
        return null;
      });
  
      uploadedUrls = (await Promise.all(uploadPromises)).filter(Boolean);
    }
      let { data: ct, error: catError } = await supabaseAdmin
          .from('categories')
          .select('id')
          .eq('id', category_id)
          .maybeSingle();

      if (catError || !ct) {
           return res.status(404).json({ error: 'New category not found.' });
      }
      updatedCategoryId = ct.id;
  }

  // 2. Build the update payload for the 'types' table
  const updates = { 
      name, 
      description, 
      image: uploadedUrls, 
      isdisabled, 
      updated_at: new Date().toISOString() 
  };
  
  // Only include category_id in the update if it was provided
  if (updatedCategoryId) {
      updates.category_id = updatedCategoryId; 
  }

  // 3. Update the 'types' record
  const { data: updatedRecords, error: updateError } = await supabaseAdmin
      .from('types')
      .update(updates)
      .eq('id', id)
      .select();

  if (updateError) {
      console.error("Supabase Update Error:", updateError.message);
      return res.status(400).json({ error: updateError.message });
  }
  
  const updatedType = updatedRecords?.[0];

  if (!updatedType) {
      return res.status(404).json({ error: "Type not found or no changes were made." });
  }
  
  res.status(200).json(updatedType); // Send the single object
});

//  Carousel Endpoint
router.get('/carousel', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('carousel')
    .select('*')
    .order('updated_at', { ascending: false });

    // const userId = req.id;

    if (error) {
    // loggerSupa(`Material.Error`, error.message, userId);  
    return res.status(400).json({ error: error.message });
  }
  // loggerSupa(`Material.Info`, 'Get all materials successuly!', userId);  
  res.json(data);
});

router.put('/carousel/:id',  authMiddleware, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, description, image, linkedPath } = req.body;
  // const userId = req.id;
  let uploadedUrls = [];

  if (Array.isArray(image)) {
    const uploadPromises = image.map(async (img) => {
      if (isSupabaseStorageUrl(img)) return img;     // keep
      if (isBase64Image(img)) return await uploadToSupabase(img, "carousel-images", "gallery");
      if (isHttpUrl(img)) return img;                // optional
      return null;
    });

    uploadedUrls = (await Promise.all(uploadPromises)).filter(Boolean);
  }
  const { data, error } = await supabaseAdmin
    .from('carousel')
    .update({ 
      name, description, image: uploadedUrls, linkedPath, updated_at: new Date().toISOString()
    })
    .eq('id', id)   // 👈 Make sure to update the correct row
    .select();      // return the updated row(s)

  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.status(200).json(data);
});

router.post('/carousel', authMiddleware, requireAdmin, async (req, res) => {
  try{
    const {
      name, description, image, linkedPath
    } = req.body;

    let { data: mk } = await supabaseAdmin.from('carousel').select('*').eq('name', name).maybeSingle();
    if (!mk) {
      let uploadedUrls = [];

      // const galleryBucketUrls =
      //   normalizeArray(image ?? req.body.image) || [];
  
      if (Array.isArray(image) && image.length > 0) {
        const uploadPromises = image.map(async (img) => {
          if (isSupabaseStorageUrl(img)) {
            return img;
          }
            if (isBase64Image(img)) {
            return await processImage(img, 'carousel-images');
            }
            if (isHttpUrl(img)) {
            return img;
          }
            return null;
        });
  
        uploadedUrls = (await Promise.all(uploadPromises)).filter(Boolean);
      }

      // console.log(uploadedUrls)
      const ins = await supabaseAdmin.from('carousel').insert({ name, description, linkedPath, image:uploadedUrls}).select().single();
      if (ins.error) return res.status(400).json({ error: ins.error.message });
      mk = ins.data;
    }
    res.status(201).json({ mk });
  } catch (e) {
    res.status(500).json({ error: 'Failed to insert carousel' });
  }
});

router.delete('/carousel/:id', authMiddleware, requireAdmin, async (req, res) => {
  const { id } = req.params;

  const { error } = await supabaseAdmin
    .from('carousel')
    .delete()
    .eq('id', id);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: 'carousel deleted' });
});

//   Model Endpoint
router.get('/model', async (req, res) => {
  // 1. Fetch all models (without relations)
  const { data: models, error } = await supabaseAdmin
    .from('models')
    .select('id, type_id, name, description, isdisabled, created_at, updated_at') // Specify columns for clarity/efficiency
    .order('updated_at', { ascending: false });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  if (!models || models.length === 0) {
    return res.json([]);
  }

  // 2. Identify all unique Type IDs present in the models
  const typesIds = Array.from(new Set(models.map(m => m.type_id).filter(Boolean)));

  // Handle case where no models have a type_id (though unlikely)
  if (typesIds.length === 0) {
      return res.json(models.map(m => ({
          ...m,
          type_name: null,
          category_name: null,
      })));
  }

  // 3. Fetch all necessary Type and Category data in one query (using the correct relationship)
  const { data: types, error: typesError } = await supabaseAdmin
    .from('types')
    .select(`
      id,
      name,
      category:categories( id, name ) // Corrected relation name
    `)
    .in('id', typesIds)
    .order('updated_at', { ascending: false });

  if (typesError) {
    return res.status(400).json({ error: typesError.message });
  }

  // 4. Create a Map for fast lookup
  const typeMap = new Map(
    (types || []).map(t => [
      t.id,
      {
        type_name: t.name,
        category_name: t.category?.name || null // Use optional chaining for safety
      }
    ])
  );

  // 5. Enrich the original models array
  const enriched = models.map(m => {
    // Look up the corresponding type data
    const typeInfo = typeMap.get(m.type_id);

    return {
      ...m,
      type_name: typeInfo?.type_name || null,
      category_name: typeInfo?.category_name || null,
    };
  });
  
  res.json(enriched);
});

router.post('/model', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { type_id, name, description, isdisabled } = req.body;

    // Get type + category
    const { data: tp, error: typeErr } = await supabaseAdmin
      .from('types')
      // .select('*, category:categories ( id, name )')
      .select('*')
      .eq('id', type_id)
      .maybeSingle();

    if (typeErr || !tp) return res.status(400).json({ error: "Invalid type" });

    // Check if model exists
    let { data: md } = await supabaseAdmin
      .from('models')
      .select('*')
      .eq('type_id', tp.id)
      .eq('name', name)
      .maybeSingle();

    // Create if not exists
    if (!md) {
      const ins = await supabaseAdmin
        .from('models')
        .insert({ 
          type_id: tp.id, 
          name, 
          description, 
          isdisabled: isdisabled 
        })
        .select()
        .single();

      if (ins.error) return res.status(400).json({ error: ins.error.message });
      md = ins.data;
    }

    // ✔ Fetch model with type + category
    const { data: modelWithRelations } = await supabaseAdmin
      .from('models')
      .select(`
        *,
        type:types (
          id,
          name,
          category (
            id,
            name
          )
        )
      `)
      .eq('id', md.id)
      .maybeSingle();

    res.status(201).json(modelWithRelations);

  } catch (e) {
    res.status(500).json({ error: 'Failed to create model' });
  }
});

router.put('/model/:id', authMiddleware, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { type_id, name, description, isdisabled } = req.body;

  const { data: tp } = await supabaseAdmin
    .from('types')
    .select('id')
    .eq('id', type_id)
    .maybeSingle();

  const updatedTypeId = tp ? tp.id : type_id;

  const { data: updated, error } = await supabaseAdmin
    .from('models')
    .update({
      type_id: updatedTypeId,
      name,
      description,
      isdisabled: isdisabled,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error || !updated) {
    return res.status(400).json({ error: "Update failed" });
  }

  // ✔ Fetch with relations
  const { data: modelWithRelations } = await supabaseAdmin
    .from('models')
    .select(`
      *,
      type:types (
        id,
        name,
        category(
          id,
          name
        )
      )
    `)
    .eq('id', id)
    .maybeSingle();

  res.status(200).json(modelWithRelations);
});

router.get('/item/onsale', async (req, res) => {
  const { data: items, error } = await supabaseAdmin
    .from('items')
    .select(`
      *,
      variants!inner(*),
      model:models(
        id,
        name,
        type:types(
          id,
          name,
          category:categories(
            id,
            name
          )
        )
      ),
      brands:brands_items(
        brand:brands(id, name)
      )
  `)
    .eq('variants.onsale', true)
    .order('updated_at', { ascending: false })
    .limit(5);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json(items || []);
});

router.get("/item", async (req, res) => {
  try {
    const {
      q,
      type_id,
      model_id,
      brand_id,
      minPrice,
      maxPrice,
      minAge,
      maxAge,
      minLen,
      maxLen,
      onsale,
      page = 1,
      pageSize = 8
    } = req.query;

    // console.log({dd : req.query})

    
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabaseAdmin
      .from("items")
      .select(`
        *,
        variants!inner(*),
        model:models!inner(
          id,
          name,
          type_id,
          type:types(
            id,
            name,
            category:categories(
              id,
              name
            )
          )
        ),
        brands:brands_items(
          brand:brands(id, name)
        )
    `,
    { count: "exact" }
  
  );

    /* ---------- ITEM FILTERS ---------- */
    if (q) query = query.ilike("name", `%${q}%`);

    if (model_id)
      query = query.in("model_id", model_id.split(","));

    if (brand_id)
      query = query.overlaps("brands_ids", brand_id.split(","));

    if (type_id)
      query = query.in("models.type_id", type_id.split(","));

    /* ---------- VARIANT FILTERS ---------- */
    if (minPrice) query = query.gte("variants.price", Number(minPrice));
    if (maxPrice) query = query.lte("variants.price", Number(maxPrice));

    if (onsale === "true")
      query = query.eq("variants.onsale", true);

    if (minAge) query = query.gte("variants.age->>0", Number(minAge));
    if (maxAge) query = query.lte("variants.age->>1", Number(maxAge));

    if (minLen) query = query.gte("variants.lengthcm->>0", Number(minLen));
    if (maxLen) query = query.lte("variants.lengthcm->>1", Number(maxLen));

    
    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    res.json({ items: data, total: count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/item/:id', async (req, res) => {
  const { id } = req.params;
  const { data: item, error } = await supabaseAdmin
    .from('items')
    .select(`
       *,
      variants!inner(*),
      model:models(
        id,
        name,
        type:types(
          id,
          name,
          category:categories(
            id,
            name
          )
        )
      ),
      brands:brands_items(
        brand:brands(id, name)
      )
  `)
    .eq('id', id)
    .maybeSingle()

    const { data: relatedItems, errorRelatedItems } = await supabaseAdmin
    .rpc("get_related_items_by_type", {
      p_item_id: id,
      p_limit: 10
    });
  

  if (errorRelatedItems) {
    return res.status(400).json({ error: errorRelatedItems.message });
  }

  if (!item) { // Check if item is null, not an empty array
    return res.status(404).json({ message: 'Item not found' });
  }

  res.json({item, relatedItems});
});

router.post('/item', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const normalizeArray = (value) => {
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') return [];
        
        // Check if it's a Base64 image - DON'T split these
        if (trimmed.startsWith('data:image')) return [trimmed]; 
    
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed;
          } catch (e) {}
        }
        // Only split by comma if it's NOT an image
        if (trimmed.includes(',')) {
          return trimmed.split(',').map(s => s.trim()).filter(Boolean);
        }
        return [trimmed];
      }
      return [String(value)];
    };

    const safeInt = (v, fallback = null) => {
      if (v === null || v === undefined || v === '') return fallback;
      const n = parseInt(v, 10);
      return Number.isNaN(n) ? fallback : n;
    };
    const safeFloat = (v, fallback = null) => {
      if (v === null || v === undefined || v === '') return fallback;
      const n = parseFloat(v);
      return Number.isNaN(n) ? fallback : n;
    };
    const safeBool = (v) => {
      if (v === null || v === undefined) return false;
      if (typeof v === 'boolean') return v;
      const s = String(v).toLowerCase().trim();
      return s === 'true' || s === '1' || s === 'yes';
    };

    const { 
      model_id, name, description, galleryurls, brands_ids, isSimple,
      short_description,
      variants: newVariants // 🔑 KEY CHANGE: Extract variants array
    } = req.body;
    // console.log(galleryurls)

    const model_id_final = model_id || req.body.modelId;
    const { data: mod } = await supabaseAdmin.from('models').select('*').eq('id', model_id_final).maybeSingle();
    if (!mod) return res.status(404).json({ error: 'Model not found' });
    
    if (name) {
      const { data: existingItem, error: checkError } = await supabaseAdmin
          .from('items')
          .select('id')
          .eq('name', name)
          .eq('model_id', model_id_final) // Optional: Check uniqueness within the same model
          .maybeSingle();

      if (checkError) {
          console.error('Item check error:', checkError);
          return res.status(500).json({ error: 'Database check failed' });
      }

      if (existingItem) {
          // Item already exists, return a 409 Conflict error
          return res.status(403).json({ 
              error: `Item with name '${name}' already exists under this model.`,
              itemId: existingItem.id
          });
      }
  }

    // Validate model exists (unchanged)
    const { data: modTp } = await supabaseAdmin.from('types').select('*').eq('id', mod.type_id).maybeSingle();
    const { data: tpMk } = await supabaseAdmin.from('brands').select('*').eq('id', modTp?.market_id).maybeSingle();
    // 2. Prepare and Insert the Main Item
   let uploadedUrls = [];

    const galleryBucketUrls =
      normalizeArray(galleryurls ?? req.body.galleryUrls) || [];

    if (Array.isArray(galleryBucketUrls) && galleryBucketUrls.length > 0) {
      const uploadPromises = galleryBucketUrls.map(async (img) => {
        // 1. Already uploaded to Supabase → keep it
        if (isSupabaseStorageUrl(img)) {
          return img;
        }

        // 2. Base64 → upload
        if (isBase64Image(img)) {
          return await processImage(img);

          // return await uploadToSupabase(img, "item-images", "gallery");
        }

        // 3. External URL → keep OR reject (your choice)
        if (isHttpUrl(img)) {
          return img;
        }

        // 4. Invalid value
        return null;
      });

      uploadedUrls = (await Promise.all(uploadPromises)).filter(Boolean);
    }

    // console.log({uploadedUrls})
    
    const itemData = {
      model_id: model_id_final,
      name: name ?? null,
      issimple: isSimple,
      description: description ?? null,
      short_description: short_description ?? null,
      brands_ids: brands_ids,
      galleryurls: uploadedUrls,
      };

    const { data: item, error: iErr } = await supabaseAdmin
      .from('items')
      .insert(itemData)
      .select('id')
      .single();

    if (iErr) {
      console.error('Item insert error:', iErr);
      return res.status(400).json({ error: iErr.message || iErr });
    }

    const itemId = item.id;

    const generateSku = ({ itemId, size, color }) => {
      const clean = (v) =>
        String(v || '')
          .replace('#', '')
          .replace(/\s+/g, '')
          .toUpperCase();
    
      return [
        clean(itemId).slice(0, 8), // short item ref
        clean(size),
        clean(color),
      ]
        .filter(Boolean)
        .join('-');
    };

    
   // 3. PREPARE & INSERT SKUs (SKU-FIRST)
    if (Array.isArray(newVariants) && newVariants.length > 0) {
      const skusToInsert = [];

      for (const v of newVariants) {
        const colors = Array.isArray(v.color) ? v.color : [v.color];

        for (const color of colors) {
          const sku = generateSku({
            itemId,
            size: v.size,
            color,
          });
        
          skusToInsert.push({
            item_id: itemId,
            sku,         
            size: v.size ?? null,
            color: color ?? '',
            barcode: v.barcode ?? '',
            gender: v.gender ?? null,
            age: normalizeArray(v.age),
            lengthcm: normalizeArray(v.lengthcm),
            stock: safeInt(v.stock, 0),
            price: safeFloat(v.price, 0),
            oldprice: safeFloat(v.oldPrice ?? v.oldprice, 0),
            outofstock: safeBool(v.outOfStock ?? v.outofstock),
            onsale: safeBool(v.onSale ?? v.onsale),
          });
        }
      }

      const { error: skuErr } = await supabaseAdmin
        .from('variants')
        .insert(skusToInsert);

      if (skuErr) {
        console.error('SKU insert error:', skuErr);
        return res.status(400).json({
          error: `Failed to insert SKUs: ${skuErr.message}`,
        });
      }
    }

 
    // ---- INSERT CATEGORY RELATIONS ----
    if (Array.isArray(brands_ids) && brands_ids.length > 0) {
      const rows = brands_ids.map(cid => ({ item_id: itemId, brand_id: cid }));
      await supabaseAdmin.from("brands_items").insert(rows);
    }
	 
				  
   // 4. Return the complete item structure
   // ---- FULL ITEM RESPONSE ----
   
const { data: fullItem, error: fetchError } = await supabaseAdmin
  .from("items")
  .select(`
      *,
      variants(*),
      model:models(
        id,
        name,
        type:types(
          id,
          name,
          category:categories(
            id,
            name
          )
        )
      ),
      brands:brands_items(
        brand:brands(id, name)
      )
  `)
  .eq("id", itemId)
  .single();
   if (fetchError) {
    console.error('Re-fetch error:', fetchError);
    return res.status(201).json({ id: itemId, message: 'Item created, but failed to fetch full response.' });
}

    return res.status(201).json(fullItem);

    } catch (e) {
    console.error('Handler exception:', e);
    return res.status(500).json({ error: 'Failed to create product' });
    }
});

router.put('/item/:itemId', authMiddleware, requireAdmin, async (req, res) => {
  const { itemId } = req.params;
  const { 
    variants: updatedVariants = [], 
    brands_ids = [],
    galleryurls,
    ...itemPatch 
  } = req.body;

 
  const normalizeArray = (value) => {
    // if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      const t = value.trim();
      if (t === "") return [];
      try {
        const p = JSON.parse(t);
        if (Array.isArray(p)) return p;
      } catch {}
      if (t.includes(",")) return t.split(",").map(s => s.trim()).filter(Boolean);
      return [t];
    }
    return [String(value)];
  };

  const safeInt = (v) => (isNaN(parseInt(v)) ? 0 : parseInt(v));
  const safeFloat = (v) => (isNaN(parseFloat(v)) ? 0 : parseFloat(v));
  const safeBool = (v) => ["true","1","yes"].includes(String(v).toLowerCase());
  const incomingVariantCount = updatedVariants.reduce((acc, v) => {
    if (!v.size) return acc;
    const colors = Array.isArray(v.color) ? v.color : [v.color];
    return acc + colors.filter(Boolean).length;
  }, 0);
  
  let uploadedUrls = [];
  const galleryInput = normalizeArray(galleryurls);

  if (Array.isArray(galleryInput)) {
    const uploadPromises = galleryInput.map(async (img) => {
      if (isSupabaseStorageUrl(img)) return img;     // keep
      if (isBase64Image(img)) return await uploadToSupabase(img, "item-images", "gallery");
      if (isHttpUrl(img)) return img;                // optional
      return null;
    });

    uploadedUrls = (await Promise.all(uploadPromises)).filter(Boolean);
  }

  if (uploadedUrls.length > 0) {
    itemPatch.galleryurls = uploadedUrls;
  }



  // ---- UPDATE ITEM ----
  itemPatch.updated_at = new Date().toISOString();
  if ("isSimple" in itemPatch) {
    itemPatch.issimple = safeBool(itemPatch.isSimple);  
    delete itemPatch.isSimple;     // remove original key
  }

  itemPatch.brands_ids = brands_ids;
  
  if (itemPatch.issimple === true && incomingVariantCount > 1) {
    return res.status(400).json({
      error: "Cannot set item as simple when more than one variant exists."
    });
  }
  


  const { error: itemErr } = await supabaseAdmin
    .from("items")
    .update(itemPatch)
    .eq("id", itemId);

  if (itemErr) return res.status(400).json({ error: itemErr.message });

// ---- UPSERT SKUs (item_id + size + color) ----
const incomingSkuKeys = new Set();

for (const v of updatedVariants) {
  if (!v.size) continue;

  const colors = Array.isArray(v.color) ? v.color : [v.color];

  for (const color of colors) {
    if (!color) continue;

    const skuKey = `${itemId}|${v.size}|${color}`;
    incomingSkuKeys.add(skuKey);

    const payload = {
      item_id: itemId,
      size: v.size,
      color,
      gender: v.gender ?? null,
      barcode: v.barcode ?? '',
      age: normalizeArray(v.age),
      lengthcm: normalizeArray(v.lengthcm),
      stock: safeInt(v.stock),
      price: safeFloat(v.price),
      oldprice: safeFloat(v.oldPrice ?? v.oldprice),
      outofstock: safeBool(v.outOfStock ?? v.outofstock),
      onsale: safeBool(v.onSale ?? v.onsale),
      sku: skuKey,
      updated_at: new Date().toISOString(),
    };


    
    // 🔎 find SKU
    const { data: existingSku, error: findErr } = await supabaseAdmin
      .from("variants")
      .select("id")
      .eq("item_id", itemId)
      .eq("size", v.size)
      .eq("color", color)
      .maybeSingle();

    if (findErr) {
      return res.status(400).json({ error: findErr.message });
    }

    if (existingSku?.id) {
      // UPDATE SKU
      const { error: updateErr } = await supabaseAdmin
        .from("variants")
        .update(payload)
        .eq("id", existingSku.id);

      if (updateErr) {
        return res.status(400).json({ error: updateErr.message });
      }
    } else {
      // INSERT SKU
      const { error: insertErr } = await supabaseAdmin
        .from("variants")
        .insert(payload);

      if (insertErr) {
        return res.status(400).json({ error: insertErr.message });
      }
    }
  }
}
// ---- DELETE REMOVED SKUs ----
const { data: existingSkus } = await supabaseAdmin
  .from("variants")
  .select("id, item_id, size, color")
  .eq("item_id", itemId);

const skuIdsToDelete = existingSkus
  .filter(sku => {
    const key = `${sku.item_id}|${sku.size}|${sku.color}`;
    return !incomingSkuKeys.has(key);
  })
  .map(sku => sku.id);

if (skuIdsToDelete.length > 0) {
  await supabaseAdmin
    .from("variants")
    .delete()
    .in("id", skuIdsToDelete);
}
  // ---- UPDATE CATEGORY RELATIONS ----
  await supabaseAdmin.from("brands_items").delete().eq("item_id", itemId);

  if (Array.isArray(brands_ids)) {
    const rows = brands_ids.map(cid => ({ item_id: itemId, brand_id: cid }));
    if (rows.length > 0) {
      await supabaseAdmin.from("brands_items").insert(rows);
    }
  }

  // ---- RETURN FULL UPDATED ITEM ----
  const { data: fullItem, error: fetchError } = await supabaseAdmin
    .from("items")
    .select("*, variants(*), brands_items(brand_id)")
    .eq("id", itemId)
    .single();

    if (fetchError) { console.error('Re-fetch after update error:', fetchError); 
    
    return res.json({ id: itemId, message: 'Item updated, but failed to fetch full response.' });
   }   
    res.json(fullItem);
  });

router.get('/item/relateditem/:itemId', async (req, res) => {
  const { itemId } = req.params;

  const { data, error } = await supabase
  .rpc("get_related_items_by_type", {
    p_item_id: itemId,
    p_limit: 10
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json(data);
})

router.delete('/item/:id', authMiddleware, requireAdmin, async (req, res) => {
  const { id } = req.params;

  // Assuming 'variants' table has ON DELETE CASCADE constraint on 'item_id'
  const { error } = await supabaseAdmin
    .from('items')
    .delete()
    .eq('id', id);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: 'Item and its variants deleted' });
});

export default router;
