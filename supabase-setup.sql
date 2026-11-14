-- ThreeDee V4 | Supabase Dashboard > SQL Editor > New query > Run
-- Do not set public write policies; only your Render server uses the secret key.
create table if not exists public.museum_products (
 id text primary key,
 payload jsonb not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists museum_products_created_idx on public.museum_products (created_at);
create table if not exists public.museum_reviews (
 id text primary key,
 scope text not null check (scope in ('museum','product')),
 product_id text,
 name text not null,
 message text not null,
 rating integer check (rating between 1 and 5),
 created_at timestamptz not null default now(),
 constraint museum_review_rating check ((scope='product' and product_id is not null and rating between 1 and 5) or (scope='museum' and product_id is null and rating is null))
);
create index if not exists museum_reviews_created_idx on public.museum_reviews (created_at desc);
create index if not exists museum_reviews_product_idx on public.museum_reviews (product_id, created_at desc);
create or replace view public.museum_product_ratings with (security_invoker=true) as
 select product_id, count(*)::integer as count, round(avg(rating)::numeric,1)::float8 as average
 from public.museum_reviews where scope='product' group by product_id;
alter table public.museum_products enable row level security;
alter table public.museum_reviews enable row level security;
-- Explicitly remove direct privileges for the browser roles. The backend secret key uses service_role.
revoke all on public.museum_products from anon, authenticated;
revoke all on public.museum_reviews from anon, authenticated;
revoke all on public.museum_product_ratings from anon, authenticated;
grant all on public.museum_products to service_role;
grant all on public.museum_reviews to service_role;
grant select on public.museum_product_ratings to service_role;
insert into storage.buckets (id,name,public,file_size_limit)
 values ('museum-media','museum-media',true,52428800)
 on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit;
insert into storage.buckets (id,name,public,file_size_limit)
 values ('museum-originals','museum-originals',false,52428800)
 on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit;
-- Never add public write rules for storage.objects. Public museum-media is read-only for visitors.
