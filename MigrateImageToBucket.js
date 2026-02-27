import { supabaseAdmin } from "./supabase.js";

// Initialize Supabase Admin (Use your service_role key)
const BUCKET_NAME = 'item-images';

async function MigrateImageToBucket() {
  console.log('🚀 Starting Migration: Base64 to Supabase Storage...');

  // 1. Fetch items that have galleryurls
  const { data: items, error: fetchError } = await supabaseAdmin
    .from('types')
    .select('id, image')
    .not('image', 'is', null);

  if (fetchError) {
    console.error('❌ Error fetching items:', fetchError);
    return;
  }

  console.log(`📦 Found ${items.length} items to check.`);

  for (const item of items) {
    const newUrls = [];
    let updated = false;

    if(item?.galleryurls){
    for (let i = 0; i < item.galleryurls.length; i++) {
      const entry = item.galleryurls[i];

      // 2. Check if the string is actually Base64
      if (entry.startsWith('data:image') || entry.length > 1000) {
        try {
          console.log(`Uploading image ${i + 1} for Item ID: ${item.id}...`);
          
          // Clean base64
          const base64Data = entry.replace(/^data:image\/\w+;base64,/, "");
          const buffer = Buffer.from(base64Data, 'base64');
          
          // Generate Path
          const fileName = `migration/${item.id}-${i}-${Date.now()}.png`;

          // 3. Upload to Bucket
          const { data, error: uploadError } = await supabaseAdmin.storage
            .from(BUCKET_NAME)
            .upload(fileName, buffer, {
              contentType: 'image/png',
              upsert: true
            });

          if (uploadError) throw uploadError;

          // 4. Get Public URL
          const { data: { publicUrl } } = supabaseAdmin.storage
            .from(BUCKET_NAME)
            .getPublicUrl(fileName);

          newUrls.push(publicUrl);
          updated = true;
        } catch (err) {
          console.error(`❌ Failed to migrate image ${i} for item ${item.id}:`, err.message);
          newUrls.push(entry); // Keep the original if it fails
        }
      } else {
        // It's already a URL, just keep it
        newUrls.push(entry);
      }
    }
  }


    const entry = item.image
    if (entry.startsWith('data:image') || entry.length > 0) {
      try {
        console.log(`Uploading image ${i + 1} for Item ID: ${item.id}...`);
        
        // Clean base64
        const base64Data = entry.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Generate Path
        const fileName = `migration/${item.id}-${i}-${Date.now()}.png`;

        // 3. Upload to Bucket
        const { data, error: uploadError } = await supabaseAdmin.storage
          .from(BUCKET_NAME)
          .upload(fileName, buffer, {
            contentType: 'image/png',
            upsert: true
          });

        if (uploadError) throw uploadError;

        // 4. Get Public URL
        const { data: { publicUrl } } = supabaseAdmin.storage
          .from(BUCKET_NAME)
          .getPublicUrl(fileName);

        newUrls.push(publicUrl);
        updated = true;
      } catch (err) {
        console.error(`❌ Failed to migrate image for item ${item.id}:`, err.message);
        newUrls.push(entry); // Keep the original if it fails
      }
    } else {
      // It's already a URL, just keep it
      newUrls.push(entry);
    }

    // 5. Update the Database row if any images were converted
    if (updated && item?.galleryurls) {
      const { error: updateError } = await supabaseAdmin
        .from('items')
        .update({ galleryurls: newUrls })
        .eq('id', item.id);

    if (updated) {
      const { error: updateError } = await supabaseAdmin
        .from('types')
        .update({ image: newUrls })
        .eq('id', item.id);

      if (updateError) {
        console.error(`❌ Error updating DB for item ${item.id}:`, updateError.message);
      } else {
        console.log(`✅ Item ${item.id} migrated successfully.`);
      }
    }
  }

  console.log('🏁 Migration finished.');
}
}

MigrateImageToBucket();