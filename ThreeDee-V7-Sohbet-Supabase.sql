-- ThreeDee V7: Müşteri sohbeti. Mevcut ürün/yorum/sipariş tablolarına dokunmaz.
create table if not exists public.museum_chat_messages (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 nickname varchar(25) not null,
 body varchar(240) not null,
 created_at timestamptz not null default now(),
 constraint museum_chat_msg_length check (char_length(trim(body)) between 2 and 240)
);
create index if not exists museum_chat_time_idx on public.museum_chat_messages (created_at desc);
create index if not exists museum_chat_user_time_idx on public.museum_chat_messages (user_id,created_at desc);

create table if not exists public.museum_chat_mutes (
 user_id uuid primary key references auth.users(id) on delete cascade,
 muted_until timestamptz not null
);

alter table public.museum_chat_messages enable row level security;
alter table public.museum_chat_mutes enable row level security;
-- No direct client access. Chat uses server-side secret with verified login.
revoke all on public.museum_chat_messages from anon, authenticated, public;
revoke all on public.museum_chat_mutes from anon, authenticated, public;
grant all on public.museum_chat_messages to service_role;
grant all on public.museum_chat_mutes to service_role;
