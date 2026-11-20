-- Customer location on the map (Google Maps / Apple Maps link, or "my current location")
alter table public.studio_orders add column if not exists customer_location text;
notify pgrst, 'reload schema';
