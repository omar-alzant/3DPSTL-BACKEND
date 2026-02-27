 CREATE TABLE IF NOT EXISTS brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  image TEXT,
  isdisabled boolean default false,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);


CREATE TABLE IF NOT EXISTS public.carousel (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NULL DEFAULT ''::text,
  image text[] NULL DEFAULT '{}'::text[],
  description text NULL,
  linkedPath text NULL DEFAULT ''::text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carousel_pkey PRIMARY KEY (id)
) TABLESPACE pg_default;


CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT,
  email TEXT,
  avatar TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  current_token TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT GENERATED ALWAYS AS (lower(replace(name, ' ', '-'))) STORED,
  icon_url TEXT,
  banner_url TEXT,
  description TEXT,
  sort_order INT DEFAULT 0,
  isdisabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);


CREATE TABLE IF NOT EXISTS types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES categories(id),
  name TEXT NOT NULL,
  description TEXT,
  image TEXT,
  isdisabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  search_vector TSVECTOR
);

CREATE TABLE IF NOT EXISTS models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type_id UUID REFERENCES types(id),
  name TEXT NOT NULL,
  description TEXT,
  isdisabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  search_vector TSVECTOR
);


CREATE INDEX IF NOT EXISTS models_search_idx 
ON models USING gin(search_vector);


create index if not exists models_search_idx on models using gin(search_vector);

CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id uuid NOT NULL, 
  CONSTRAINT items_model_id_fkey
    FOREIGN KEY(model_id) REFERENCES models(id)
    ON DELETE CASCADE, 
  name text,
  description text,
  short_description text,
  isdisabled boolean default false,
  galleryUrls text[], 
  brands_ids text[], 
  isSimple boolean default false,
  created_at timestamp default now(),
  updated_at timestamp default now(),
  search_vector tsvector 
);


CREATE TABLE variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL
    REFERENCES items(id)
    ON DELETE CASCADE,
  sku text UNIQUE,             
  barcode text NULL,             
  size text NOT NULL,
  color text NOT NULL,
  gender text,
  price float DEFAULT 0, 
  stock int DEFAULT 0,
  oldprice float DEFAULT 0,
  age text[], 
  lengthCm text[],
  outOfStock boolean DEFAULT false,
  onSale boolean DEFAULT false,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  UNIQUE (item_id, size, color)     
);
alter table variants
add constraint stock_non_negative
check (stock >= 0);


create index idx_variants_sku on variants(sku);

ALTER TABLE public.variants
  -- AGE
  ADD COLUMN age_min numeric,
  ADD COLUMN age_max numeric,
  ADD COLUMN age_unit text CHECK (age_unit IN ('M', 'Y')),

  -- LENGTH
  ADD COLUMN length_min numeric,
  ADD COLUMN length_max numeric,
  ADD COLUMN length_unit text CHECK (length_unit IN ('cm', 'in'));


CREATE UNIQUE INDEX variants_sku_unique
ON variants (item_id, size, color);

create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  user_id uuid not null,
  rate integer not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint ratings_rate_check check (rate between 1 and 5),
  constraint ratings_user_item_unique unique (user_id, item_id),
  constraint ratings_user_fkey foreign key (user_id)
    references profiles(id) on delete cascade
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  user_id uuid not null,
  comment text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint comments_user_item_unique unique (user_id, item_id),
  constraint comments_user_fkey foreign key (user_id)
    references profiles(id) on delete cascade
);


-- Orders table (COD flow)
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled','delivered')),
  total_amount numeric(10,2) not null,
  shipping_name text,
  shipping_phone text,                 -- store E.164 (+961...)
  shipping_address text,
  shipping_city text,
  note text,
  created_at timestamp default now()
);


create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  item_id uuid not null,
  sku text not null,
  product_name text not null,
  size text,
  color text,
  qty integer not null,
  price numeric not null,
  created_at timestamptz default now()
);



create or replace function get_related_items_by_type(
  p_item_id uuid,
  p_limit int default 10
)
returns json
language sql
as $$
  select json_agg(item)
  from (
    select
      i.*,
      (
        select json_agg(v)
        from variants v
        where v.item_id = i.id
      ) as variants
    from items i
    join models m on m.id = i.model_id
    where m.type_id = (
      select m2.type_id
      from items i2
      join models m2 on m2.id = i2.model_id
      where i2.id = p_item_id
    )
    and i.id <> p_item_id
    order by i.updated_at desc
    limit p_limit
  ) item;
$$;

create index if not exists idx_items_model_id on items(model_id);
create index if not exists idx_models_type_id on models(type_id);


-- alter table items
-- add column rating_avg numeric(3,2) default 0,
-- add column rating_count integer default 0;


create or replace function update_item_rating_stats()
returns trigger
language plpgsql
as $$
begin
  update items i
  set
    rating_avg = coalesce(sub.avg_rate, 0),
    rating_count = sub.cnt
  from (
    select
      item_id,
      round(avg(rate)::numeric, 2) as avg_rate,
      count(*) as cnt
    from ratings
    where item_id = coalesce(new.item_id, old.item_id)
      and rate is not null
    group by item_id
  ) sub
  where i.id = sub.item_id;

  return null;
end;
$$;

-- drop trigger trg_update_item_rating_stats;

create trigger trg_update_item_rating_stats
after insert or update or delete on ratings
for each row
execute function update_item_rating_stats();


create or replace function get_item_reviews(p_item_id uuid)
returns table (
  user_id uuid,
  avatar text,
  rating_id uuid,
  comment_id uuid,
  username text,
  rate integer,
  comment text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
as $$
  select
    p.id                    as user_id,
    p.avatar                as avatar,
    r.id                    as rating_id,
    c.id                    as comment_id,
    p.full_name             as username,
    r.rate                  as rate,
    c.comment               as comment,
    c.created_at            as created_at,
    c.updated_at            as updated_at
  from profiles p
  left join ratings r
    on r.user_id = p.id
   and r.item_id = p_item_id
  left join comments c
    on c.user_id = p.id
   and c.item_id = p_item_id
  where r.id is not null
     or c.id is not null
  order by coalesce(c.updated_at, r.updated_at) desc;
$$;



CREATE TABLE brands_items (
  brand_id UUID NOT NULL,
  item_id UUID NOT NULL,

  CONSTRAINT fk_brands_items_brand 
    FOREIGN KEY (brand_id)
    REFERENCES brands(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_brands_items_item
    FOREIGN KEY (item_id)
    REFERENCES items(id)
    ON DELETE CASCADE,

  PRIMARY KEY (brand_id, item_id)
);



-- CREATE TABLE IF NOT EXISTS category_types (
--   category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
--   type_id UUID REFERENCES types(id) ON DELETE CASCADE,
--   PRIMARY KEY (category_id, type_id)
-- );

-- CREATE TABLE IF NOT EXISTS category_models (
--   category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
--   model_id UUID REFERENCES models(id) ON DELETE CASCADE,
--   PRIMARY KEY (category_id, model_id)
-- );

CREATE INDEX IF NOT EXISTS categories_sort_idx 
ON categories(sort_order, name);

-- Optional: index to get categorys in order quickly
CREATE INDEX IF NOT EXISTS categories_sort_idx ON categories(sort_order, name);


-- Rating summary view
CREATE OR REPLACE VIEW item_rating_summary AS
SELECT
  item_id,
  ROUND(AVG(rate)::numeric, 2) AS avg_rate,
  COUNT(*) AS total_reviews
FROM ratings
GROUP BY item_id;


DROP TRIGGER IF EXISTS items_tsvector_update ON items;

CREATE OR REPLACE FUNCTION update_item_search_vector()
RETURNS trigger AS $$
DECLARE
  model_name TEXT;
  type_name TEXT;
  category_name TEXT;
BEGIN
  SELECT m.name, t.name, c.name
  INTO model_name, type_name, category_name
  FROM models m
  LEFT JOIN types t ON m.type_id = t.id
  LEFT JOIN categories c ON t.category_id = c.id
  WHERE m.id = NEW.model_id;

  NEW.search_vector :=
      setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
      setweight(to_tsvector('english', COALESCE(category_name, '') || ' ' ||
                                        COALESCE(type_name, '') || ' ' ||
                                        COALESCE(model_name, '')), 'B') ||
      setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'C');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER items_tsvector_update
BEFORE INSERT OR UPDATE ON items
FOR EACH ROW
EXECUTE FUNCTION update_item_search_vector();

-- CREATE OR REPLACE VIEW global_search_index AS 
-- SELECT 
--   v.id AS variant_id,
--   i.id AS item_id,
--   c.name AS category,
--   t.name AS type,
--   m.name AS model,
--   i.name AS item_name,
--   v.color,
--   v.size,
--   v.lengthCm,
--   v.gender,
--   v.age,
--   v.price,
--   i.description,
--   (
--     i.name || ' ' || c.name || ' ' || t.name || ' ' || m.name || ' ' ||
--     COALESCE(v.size, '') || ' ' ||
--     COALESCE(i.description, '')
--   ) AS combined_text
-- FROM variants v
-- JOIN items i ON v.item_id = i.id
-- JOIN models m ON i.model_id = m.id
-- JOIN types t ON m.type_id = t.id
-- JOIN categories c ON t.category_id = c.id;

CREATE OR REPLACE VIEW items_view AS
SELECT
  i.id,
  i.name,
  i.galleryUrls,
  i.created_at,
  m.name AS model,
  i.description,
  t.name AS type,
  c.name AS category,
  (
    c.name || ' ' || t.name || ' ' || m.name || ' ' ||
    COALESCE(i.name,'') || ' ' ||
    COALESCE(i.description,'')
  ) AS search_text,
  (SELECT MIN(price) FROM variants WHERE item_id = i.id) AS min_price,
  (SELECT SUM(stock) FROM variants WHERE item_id = i.id) AS total_stock
FROM items i
JOIN models m ON m.id = i.model_id
JOIN types t ON t.id = m.type_id
JOIN categories c ON c.id = t.category_id;


-- CREATE OR REPLACE VIEW category_full_view AS
-- SELECT 
--   c.id AS category_id,
--   c.name AS category_name,
--   (
--     SELECT json_agg(
--       jsonb_build_object(
--         'id', t.id,
--         'name', t.name,
--         'items',
--           (
--             SELECT json_agg(
--               jsonb_build_object(
--                 'id', i.id,
--                 'name', i.name
--               ) ORDER BY i.name
--             )
--             FROM items i
--             JOIN models m ON i.model_id = m.id
--             WHERE m.type_id = t.id
--               AND (
--                 t.id IN (SELECT type_id FROM category_types WHERE category_id = c.id)
--               )
--           )
--       ) ORDER BY t.name
--     )
--     FROM types t
--     WHERE 
--       t.id IN (SELECT type_id FROM category_types WHERE category_id = c.id)
--   ) AS types
-- FROM categories c;

-- CREATE OR REPLACE FUNCTION get_category_by_id(cat_id UUID)
-- RETURNS JSONB LANGUAGE plpgsql AS $$
-- DECLARE 
--   result JSONB;
-- BEGIN
--   SELECT jsonb_build_object(
--     'id', c.id,
--     'name', c.name,
--     'types',
--       (
--         SELECT json_agg(
--           jsonb_build_object(
--             'id', t.id,
--             'name', t.name,
--             'items',
--               (
--                 SELECT json_agg(
--                   jsonb_build_object(
--                     'id', i.id,
--                     'name', i.name
--                   ) ORDER BY i.name
--                 )
--                 FROM items i
--                 JOIN models m ON i.model_id = m.id
--                 WHERE m.type_id = t.id
--                   AND (
--                     t.id IN (SELECT type_id FROM category_types WHERE category_id = cat_id)
--                   )
--               )
--           ) ORDER BY t.name
--         )
--         FROM types t
--         WHERE 
--           t.id IN (SELECT type_id FROM category_types WHERE category_id = cat_id)
--       )
--   )
--   INTO result
--   FROM categories c
--   WHERE c.id = cat_id;

--   RETURN result;
-- END;
-- $$;

CREATE OR REPLACE FUNCTION get_full_navigation_menu()
RETURNS JSONB LANGUAGE sql AS $$
SELECT
    jsonb_agg(
        jsonb_build_object(
            'id', c.id,
            'name', c.name,
            'slug', c.slug,
            'types', COALESCE(( -- ⭐️ ADD COALESCE HERE ⭐️
                SELECT 
                    jsonb_agg(
                        jsonb_build_object(
                            'id', t.id,
                            'name', t.name,
                            'models', (
                                SELECT 
                                    COALESCE(jsonb_agg( -- Optional: COALESCE for models as well
                                        jsonb_build_object(
                                            'id', m.id,
                                            'name', m.name
                                        ) ORDER BY m.name
                                    ), '[]'::jsonb)
                                FROM models m
                                WHERE m.type_id = t.id 
                                  AND m."isdisabled" = FALSE
                            )
                        ) ORDER BY t.name
                    )
                FROM types t
                -- WHERE t.id IN (SELECT type_id FROM category_types WHERE category_id = c.id)
                where t.category_id = c.id
                  AND t."isdisabled" = FALSE
            ), '[]'::jsonb) -- ⭐️ COALESCE returns empty array if subquery is NULL ⭐️
        ) ORDER BY c.sort_order, c.name
    )
FROM categories c
WHERE c."isdisabled" = FALSE;
$$;

create or replace function decrement_stock(
    row_sku text,
    qty_to_subtract integer
)
returns void
language plpgsql
as $$
declare
    rows_updated integer;
begin
    if qty_to_subtract <= 0 then
        raise exception 'Quantity must be greater than 0';
    end if;

    update variants
    set stock = stock - qty_to_subtract
    where sku = row_sku
      and stock >= qty_to_subtract
    returning 1 into rows_updated;

    if rows_updated is null then
        raise exception 'Not enough stock or SKU not found: %', row_sku;
    end if;
end;
$$;


create or replace function increment_stock(
    row_sku text,
    qty_to_add integer
)
returns void
language plpgsql
as $$
declare
    rows_updated integer;
begin
    if qty_to_add <= 0 then
        raise exception 'Quantity must be greater than 0';
    end if;

    update variants
    set stock = stock + qty_to_add
    where sku = row_sku
    returning 1 into rows_updated;

    if rows_updated is null then
        raise exception 'SKU not found: %', row_sku;
    end if;
end;
$$;

create or replace function remove_order_item_admin(
    p_order_id uuid,
    p_item_id text
)
returns void
language plpgsql
as $$
declare
    v_order record;
    v_removed_item jsonb;
    v_updated_items jsonb;
    v_new_total numeric := 0;
begin
    -- Lock order row
    select *
    into v_order
    from orders
    where id = p_order_id
    for update;

    if not found then
        raise exception 'Order not found';
    end if;

    -- Find removed item
    select value
    into v_removed_item
    from jsonb_array_elements(v_order.items) value
    where value->>'item_id' = p_item_id;

    if v_removed_item is null then
        raise exception 'Item not found in order';
    end if;

    -- Remove item from array
    select jsonb_agg(value)
    into v_updated_items
    from jsonb_array_elements(v_order.items) value
    where value->>'item_id' <> p_item_id;

    if v_updated_items is null then
        v_updated_items := '[]'::jsonb;
    end if;

    -- Recalculate total
    select coalesce(sum(
        (value->>'price')::numeric *
        coalesce((value->>'qty')::numeric, 1)
    ), 0)
    into v_new_total
    from jsonb_array_elements(v_updated_items) value;

    -- Restore stock
    perform increment_stock(
        v_removed_item->>'sku',
        (v_removed_item->>'qty')::integer
    );

    -- Update order
    update orders
    set items = v_updated_items,
        total_amount = v_new_total,
        updated_at = now()
    where id = p_order_id;

end;
$$;



CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Optimized Search Index (Fixed)
CREATE INDEX IF NOT EXISTS idx_items_name_trgm ON items USING gin (name gin_trgm_ops);

-- 2. Foreign Key Indexes (Speeds up Joins)
CREATE INDEX IF NOT EXISTS idx_items_model_id ON items(model_id);
CREATE INDEX IF NOT EXISTS idx_variants_item_id ON variants(item_id);

-- 3. Filtering Indexes
CREATE INDEX IF NOT EXISTS idx_variants_price ON variants(price);
CREATE INDEX IF NOT EXISTS idx_variants_onsale ON variants(onsale) WHERE onsale = true;

-- 4. Range Indexes (For Age and LengthCM arrays)
-- These allow the database to quickly find overlapping ranges
CREATE INDEX IF NOT EXISTS idx_variants_age ON variants USING gin (age);
CREATE INDEX IF NOT EXISTS idx_variants_lengthcm ON variants USING gin (lengthcm);

create or replace function get_home_types_with_items(
  p_type_limit int default 10,
  p_item_limit int default 10
)
returns jsonb
language sql
stable
as $$
  select jsonb_agg(type_block)
  from (
    select jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'image', t.image,
      'items', items_block
    ) as type_block
    from types t
    join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'name', i.name,
          'galleryUrls', i.galleryUrls,
          'created_at', i.created_at,
          'short_description', i.short_description,
          'min_price', (
            select min(v.price)
            from variants v
            where v.item_id = i.id
          ),
          'onSale', (
            select bool_or(v.onSale)
            from variants v
            where v.item_id = i.id
          ),
          'total_stock', (
            select coalesce(sum(v.stock), 0)
            from variants v
            where v.item_id = i.id
          )
        )
        order by i.created_at desc
      ) as items_block
      from items i
      join models m on m.id = i.model_id
      where m.type_id = t.id
        and i.isdisabled = false
      limit p_item_limit
    ) items_lateral on items_lateral.items_block is not null
    where t.isdisabled = false
    order by t.created_at desc
    limit p_type_limit
  ) s;
$$;


-- 1. Give everyone access to the schema itself
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 2. Give access to all existing tables
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

-- 3. Give access to all sequences (important for ID auto-incrementing)
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- 4. Give access to all functions
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;