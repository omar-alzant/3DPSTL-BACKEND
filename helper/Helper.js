import {supabase, supabaseAdmin} from '../supabase.js'
// import { v4 as uuidv4 } from "uuid";

export function isBase64Image(value) {
  return typeof value === "string" &&
    value.startsWith("data:image/");
}

export function isSupabaseStorageUrl(value) {
  return typeof value === "string" &&
    value.includes("/storage/v1/object/");
}

export function isHttpUrl(str) {
  return typeof str === "string" && /^https?:\/\//i.test(str);
}

export async function processImage(image, bucket = "item-images", folder = "gallery") {
  // 1. Base64 → upload
  if (isBase64Image(image)) {
    const [meta, base64Data] = image.split(",");
    const extension = meta.match(/image\/(png|jpg|jpeg|webp)/)?.[1] || "png";

    const buffer = Buffer.from(base64Data, "base64");
    const fileName = `${folder}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${extension}`;

    const { error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(fileName, buffer, {
        contentType: `image/${extension}`,
        upsert: false,
      });

    if (error) {
      throw new Error(`Image upload failed: ${extension + error.message}`);
    }

    const { data } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(fileName);

    return data.publicUrl;
  }

  // 2. Already uploaded URL → keep as-is
  if (isHttpUrl(image)) {
    return image;
  }

  throw new Error("Invalid image format");
}


export const uploadBase64Image = async (base64String, fileName, bucketName = "item-images") => {
    // Remove the data:image/png;base64, prefix if it exists
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');
  
    
    // Upload to Supabase Storage
    const { data, error } = await supabaseAdmin.storage
      .from(bucketName)
      .upload(`variants/${fileName}.png`, buffer, {
        contentType: 'image/png',
        upsert: true // Overwrites if the file exists
      });
  
    if (error) throw error;
  
    // Get the Public URL
    const { data: publicUrlData } = supabaseAdmin.storage
      .from('item-images')
      .getPublicUrl(`variants/${fileName}.png`);
  
    return publicUrlData.publicUrl;
  };

  const getMimeType = (base64String) => {
    // Regex looks for the string between 'data:' and ';base64'
    const match = base64String.match(/^data:(.*);base64,/);
    return match ? match[1] : 'image/png'; // Default to png if not found
  };


  export const uploadToSupabase = async (base64Data, bucketName, folderName) => {
    // console.log({base64Data})
    try {
      const contentType = getMimeType(base64Data);
      let extension = contentType.split("/")[1] || "png";
      if (extension === "jpeg") extension = "jpg";
  
      const base64 = base64Data.split(";base64,").pop();
      const buffer = Buffer.from(base64, "base64");
  
      const fileName = `${Date.now()}-${Math.random()
        .toString(36)
        .substring(7)}.${extension}`;
      const filePath = `${folderName}/${fileName}`;
  
      const { error: uploadError } = await supabaseAdmin.storage
        .from(bucketName)
        .upload(filePath, buffer, {
          contentType,
          upsert: true
        });
  
      if (uploadError) throw uploadError;
  
      const { data } = supabaseAdmin.storage
        .from(bucketName)
        .getPublicUrl(filePath);
  
      if (!data?.publicUrl) {
        throw new Error("Public URL is undefined — check bucket visibility");
      }
  
      return data.publicUrl;
    } catch (err) {
      console.error("Supabase Upload Error:", err.message);
      throw err;
    }
  };
  