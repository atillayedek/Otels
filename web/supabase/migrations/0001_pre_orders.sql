-- TSDMR Otel PMS tanıtım sitesi: ön sipariş talepleri ve yönetim paneli.
-- Ödeme alınmaz; yalnız talep kaydı tutulur. Kişisel veri en az düzeyde saklanır (IP yerine tuzlu özet).

create extension if not exists pgcrypto;

create table public.admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.pre_orders (
  id                     uuid primary key default gen_random_uuid(),
  reference              text not null unique,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  full_name              text not null check (char_length(btrim(full_name)) between 2 and 120),
  hotel_name             text not null check (char_length(btrim(hotel_name)) between 2 and 160),
  city                   text not null check (char_length(btrim(city)) between 2 and 80),
  phone                  text not null check (phone ~ '^\+?[0-9 ()-]{10,20}$'),
  email                  text not null check (char_length(email) <= 160 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  room_count             integer check (room_count between 1 and 5000),
  client_count           integer check (client_count between 1 and 500),
  current_software       text not null check (current_software in ('amonra', 'elektraweb', 'diger', 'yok')),
  current_software_other text check (char_length(current_software_other) <= 120),
  server_os              text not null check (server_os in ('windows', 'linux', 'karar_verilmedi')),
  needs_migration        boolean not null default false,
  message                text check (char_length(message) <= 2000),
  kvkk_accepted_at       timestamptz not null,
  status                 text not null default 'yeni'
                         check (status in ('yeni', 'iletisime_gecildi', 'teklif_verildi', 'kazanildi', 'iptal')),
  client_key_hash        text not null
);
create index pre_orders_created_idx on public.pre_orders (created_at desc);
create index pre_orders_status_idx on public.pre_orders (status, created_at desc);
create index pre_orders_email_idx on public.pre_orders (lower(email), created_at desc);
create index pre_orders_client_idx on public.pre_orders (client_key_hash, created_at desc);

create table public.pre_order_notes (
  id           uuid primary key default gen_random_uuid(),
  pre_order_id uuid not null references public.pre_orders(id) on delete restrict,
  author_id    uuid not null default auth.uid() references auth.users(id) on delete restrict,
  author_email text not null,
  body         text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at   timestamptz not null default now()
);
create index pre_order_notes_order_idx on public.pre_order_notes (pre_order_id, created_at);

create table public.pre_order_events (
  id           bigint generated always as identity primary key,
  pre_order_id uuid not null references public.pre_orders(id) on delete restrict,
  actor_id     uuid references auth.users(id) on delete set null,
  actor_email  text,
  from_status  text,
  to_status    text not null,
  created_at   timestamptz not null default now()
);
create index pre_order_events_order_idx on public.pre_order_events (pre_order_id, created_at);

-- Yetki kontrolü (API'de görünmeyen ayrı şemada)
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admin_users a where a.user_id = auth.uid());
$$;

-- Durum değişikliği geçmişi ve updated_at
create or replace function public.pre_orders_on_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    insert into public.pre_order_events (pre_order_id, actor_id, actor_email, from_status, to_status)
    values (new.id, auth.uid(), (select u.email from auth.users u where u.id = auth.uid()), old.status, new.status);
  end if;
  return new;
end;
$$;
create trigger pre_orders_on_update before update on public.pre_orders
  for each row execute function public.pre_orders_on_update();

-- Not yazarının e-postası sunucuda belirlenir (istemci değiştiremez)
create or replace function public.pre_order_notes_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.author_id := auth.uid();
  new.author_email := coalesce((select u.email from auth.users u where u.id = auth.uid()), '');
  new.created_at := now();
  return new;
end;
$$;
create trigger pre_order_notes_on_insert before insert on public.pre_order_notes
  for each row execute function public.pre_order_notes_on_insert();

-- Ön sipariş kaydı: tek giriş noktası. Doğrulama + kötüye kullanım sınırları veritabanında uygulanır.
-- p_client_key_hash: sitenin sunucu tarafında, istemci IP'sinden gizli tuzla üretilen SHA-256 özeti.
create or replace function public.submit_pre_order(p jsonb, p_client_key_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref text;
  v_email text := lower(btrim(p->>'email'));
begin
  if p_client_key_hash is null or p_client_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_client' using errcode = '22023';
  end if;
  if coalesce((p->>'kvkk_accepted')::boolean, false) is not true then
    raise exception 'kvkk_required' using errcode = '22023';
  end if;

  if (select count(*) from public.pre_orders where client_key_hash = p_client_key_hash and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.pre_orders where lower(email) = v_email and created_at > now() - interval '1 day') >= 3
     or (select count(*) from public.pre_orders where created_at > now() - interval '1 day') >= 500 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  loop
    v_ref := 'ON-' || to_char(now() at time zone 'Europe/Istanbul', 'YYMMDD') || '-' ||
             upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
    exit when not exists (select 1 from public.pre_orders where reference = v_ref);
  end loop;

  insert into public.pre_orders (
    reference, full_name, hotel_name, city, phone, email, room_count, client_count,
    current_software, current_software_other, server_os, needs_migration, message, kvkk_accepted_at, client_key_hash)
  values (
    v_ref,
    btrim(p->>'full_name'),
    btrim(p->>'hotel_name'),
    btrim(p->>'city'),
    btrim(p->>'phone'),
    v_email,
    nullif(p->>'room_count', '')::integer,
    nullif(p->>'client_count', '')::integer,
    p->>'current_software',
    nullif(btrim(coalesce(p->>'current_software_other', '')), ''),
    p->>'server_os',
    coalesce((p->>'needs_migration')::boolean, false),
    nullif(btrim(coalesce(p->>'message', '')), ''),
    now(),
    p_client_key_hash);

  return v_ref;
end;
$$;

-- RLS ve ayrıcalıklar: anonim kullanıcı tablolara doğrudan erişemez, yalnız submit_pre_order çağırabilir.
alter table public.admin_users      enable row level security;
alter table public.pre_orders       enable row level security;
alter table public.pre_order_notes  enable row level security;
alter table public.pre_order_events enable row level security;

revoke all on public.admin_users, public.pre_orders, public.pre_order_notes, public.pre_order_events from anon, authenticated;
revoke all on function public.submit_pre_order(jsonb, text) from public;
revoke all on function private.is_admin() from public, anon;
revoke all on function public.pre_orders_on_update() from public, anon, authenticated;
revoke all on function public.pre_order_notes_on_insert() from public, anon, authenticated;
grant execute on function public.submit_pre_order(jsonb, text) to anon, authenticated;
grant execute on function private.is_admin() to authenticated;

grant select on public.admin_users to authenticated;
grant select on public.pre_orders to authenticated;
grant update (status) on public.pre_orders to authenticated;
grant select, insert on public.pre_order_notes to authenticated;
grant select on public.pre_order_events to authenticated;

create policy admin_users_self on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));
create policy pre_orders_admin_select on public.pre_orders for select to authenticated
  using ((select private.is_admin()));
create policy pre_orders_admin_update on public.pre_orders for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy notes_admin_select on public.pre_order_notes for select to authenticated
  using ((select private.is_admin()));
create policy notes_admin_insert on public.pre_order_notes for insert to authenticated
  with check ((select private.is_admin()));
create policy events_admin_select on public.pre_order_events for select to authenticated
  using ((select private.is_admin()));
