-- ThreeDee V6: SUPABASE SQL EDITOR > New query > Run
-- V4 products/reviews tables, data and buckets remain unchanged.
-- Customer rows are accessible only through ThreeDee's authenticated Node backend.
create table if not exists public.museum_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id,product_id)
);
create table if not exists public.museum_cart (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  quantity integer not null check(quantity between 1 and 30),
  updated_at timestamptz not null default now(),
  primary key (user_id,product_id)
);
create table if not exists public.museum_orders (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  items jsonb not null,
  total numeric(12,2) not null check(total>=0),
  status text not null default 'new' check(status in ('new','contacted','cancelled')),
  payment_status text not null default 'not_paid' check(payment_status='not_paid'),
  recipient text not null,
  phone text not null,
  city text not null,
  address text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists museum_orders_user_date_idx on public.museum_orders(user_id,created_at desc);
create index if not exists museum_orders_date_idx on public.museum_orders(created_at desc);
alter table public.museum_favorites enable row level security;
alter table public.museum_cart enable row level security;
alter table public.museum_orders enable row level security;
revoke all on table public.museum_favorites,public.museum_cart,public.museum_orders from anon,authenticated,public;
grant select,insert,update,delete on public.museum_favorites,public.museum_cart,public.museum_orders to service_role;
-- Supabase Auth > Providers > Email: enable email signups and choose confirmation policy.
-- Supabase Auth > URL Configuration: Site URL = https://threed-urun-muzesi.onrender.com
