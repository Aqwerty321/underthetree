-- supabase/migrations/001_init.sql
-- UndertheTree: gifts, user_gift_opens, wishes + RLS + rate limit + moderation fields.

-- Enable extensions used by UUID generation.
create extension if not exists pgcrypto;

-- gifts
create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  public boolean not null default true
);

-- user_gift_opens
create table if not exists public.user_gift_opens (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  gift_id uuid not null references public.gifts(id) on delete cascade,
  opened_at timestamptz not null default now()
);

-- wishes
create table if not exists public.wishes (
  id uuid primary key,
  user_id text null,
  text text not null,
  summary text null,
  tags text[] not null default '{}',
  is_public boolean not null,
  created_at timestamptz not null default now(),
  moderated boolean not null default false,
  moderated_at timestamptz null,
  synced boolean not null default false
);

-- Basic constraint for wish length.
alter table public.wishes
  drop constraint if exists wishes_text_len;
alter table public.wishes
  add constraint wishes_text_len check (char_length(text) <= 250);

-- RLS
alter table public.gifts enable row level security;
alter table public.user_gift_opens enable row level security;
alter table public.wishes enable row level security;

-- gifts: public read only
create policy if not exists "gifts_select_public"
on public.gifts for select
using (public = true);

-- user_gift_opens: allow insert/select for anyone (opaque user_id);
-- if you later add Supabase auth, tighten these.
create policy if not exists "user_gift_opens_insert"
on public.user_gift_opens for insert
with check (true);

create policy if not exists "user_gift_opens_select"
on public.user_gift_opens for select
using (true);

-- wishes: allow insert for anyone; select only moderated public wishes.
create policy if not exists "wishes_insert"
on public.wishes for insert
with check (true);

create policy if not exists "wishes_select_public_moderated"
on public.wishes for select
using (is_public = true and moderated = true);

-- NOTE: moderation updates should be done by a service role / edge function.

-- Rate limit: 5 per hour per user_id (when user_id present).
create or replace function public.enforce_wish_rate_limit()
returns trigger
language plpgsql
as $$
declare
  recent_count int;
begin
  if new.user_id is null then
    return new;
  end if;

  select count(*) into recent_count
  from public.wishes
  where user_id = new.user_id
    and created_at > (now() - interval '1 hour');

  if recent_count >= 5 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_wish_rate_limit on public.wishes;
create trigger trg_wish_rate_limit
before insert on public.wishes
for each row
execute function public.enforce_wish_rate_limit();

-- Moderation stub: keep moderated=false until an external process approves.
-- Implement an edge function to vet public wishes and set moderated=true.
