import xlsx from "xlsx";
import "dotenv/config";


const wb = xlsx.readFile("catalog_import.xlsx");

const sheet = name =>
  xlsx.utils.sheet_to_json(wb.Sheets[name], { defval: null });

const mapByName = async (table, column = "name") => {
  const { data } = await supabaseAdmin.from(table).select("id," + column);
  return Object.fromEntries(data.map(r => [r[column], r.id]));
};

(async () => {
  /* ---------- CATEGORIES ---------- */
  await supabaseAdmin.from("categories").insert(sheet("categories"));

  /* ---------- TYPES ---------- */
  const categories = await mapByName("categories");
  await supabaseAdmin.from("types").insert(
    sheet("types").map(r => ({
      ...r,
      category_id: categories[r.category_name]
    }))
  );

  /* ---------- MODELS ---------- */
  const types = await mapByName("types");
  await supabaseAdmin.from("models").insert(
    sheet("models").map(r => ({
      ...r,
      type_id: types[r.type_name]
    }))
  );

  /* ---------- BRANDS ---------- */
  await supabaseAdmin.from("brands").insert(sheet("brands"));

  /* ---------- ITEMS ---------- */
  const models = await mapByName("models");
  await supabaseAdmin.from("items").insert(
    sheet("items").map(r => ({
      ...r,
      model_id: models[r.model_name],
      galleryUrls: r.galleryUrls
        ? r.galleryUrls.split("|").map(s => s.trim())
        : []
    }))
  );

  /* ---------- BRANDS_ITEMS ---------- */
  const brands = await mapByName("brands");
  const items = await mapByName("items");
  await supabaseAdmin.from("brands_items").insert(
    sheet("brands_items").map(r => ({
      brand_id: brands[r.brand_name],
      item_id: items[r.item_name]
    }))
  );

  /* ---------- VARIANTS ---------- */
  await supabaseAdmin.from("variants").insert(
    sheet("variants").map(r => ({
      ...r,
      item_id: items[r.item_name]
    }))
  );

  console.log("✅ Import completed successfully");
})();
