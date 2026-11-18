-- 3DSTL Studio: عنوان السكن في طلبات الـStudio (إلزامي للطلبات الجديدة)
-- شغّله مرة واحدة في Supabase → SQL Editor قبل نشر الكود الجديد على Railway.
alter table public.studio_orders add column if not exists customer_address text;
