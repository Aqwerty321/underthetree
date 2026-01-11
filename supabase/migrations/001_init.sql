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
drop policy if exists "gifts_select_public" on public.gifts;
create policy "gifts_select_public"
on public.gifts for select
using (public = true);

-- user_gift_opens: allow insert/select for anyone (opaque user_id);
-- if you later add Supabase auth, tighten these.
drop policy if exists "user_gift_opens_insert" on public.user_gift_opens;
create policy "user_gift_opens_insert"
on public.user_gift_opens for insert
with check (true);

drop policy if exists "user_gift_opens_select" on public.user_gift_opens;
create policy "user_gift_opens_select"
on public.user_gift_opens for select
using (true);

-- wishes: allow insert for anyone; select only moderated public wishes.
drop policy if exists "wishes_insert" on public.wishes;
create policy "wishes_insert"
on public.wishes for insert
with check (true);

drop policy if exists "wishes_select_public_moderated" on public.wishes;
create policy "wishes_select_public_moderated"
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

-- Gift selection helper: prefer gifts that match a user's wishes (tags/summary/text),
-- otherwise fall back to a random public gift. Avoid repeats for the user when possible.
create or replace function public.open_gift_for_user(p_user_id text)
returns table (
  open_id uuid,
  gift_id uuid,
  gift_title text,
  gift_description text,
  opened_at timestamptz,
  reason text
)
language plpgsql
as $$
declare
  chosen_gift_id uuid;
  chosen_reason text;
  uid text;
begin
  uid := nullif(btrim(p_user_id), '');

  -- 1) Try to find an unseen gift that matches the user's wish content.
  if uid is not null then
    select g.id, 'wish_match'
      into chosen_gift_id, chosen_reason
    from public.gifts g
    where g.public = true
      and not exists (
        select 1
        from public.user_gift_opens ugo
        where ugo.user_id = uid
          and ugo.gift_id = g.id
      )
      and exists (
        select 1
        from public.wishes w
        where w.user_id = uid
          and (
            (
              coalesce(array_length(w.tags, 1), 0) > 0
              and exists (
                select 1
                from unnest(w.tags) t
                where g.title ilike ('%' || t || '%')
                   or g.description ilike ('%' || t || '%')
              )
            )
            or (
              w.summary is not null
              and (g.title ilike ('%' || w.summary || '%')
                or g.description ilike ('%' || w.summary || '%'))
            )
            or (
              g.title ilike ('%' || w.text || '%')
              or g.description ilike ('%' || w.text || '%')
            )
          )
        order by w.created_at desc
        limit 1
      )
    order by random()
    limit 1;

    if chosen_gift_id is null and exists (select 1 from public.wishes w where w.user_id = uid) then
      chosen_reason := 'wish_fallback_random';
    end if;
  end if;

  -- 2) Fallback: pick any random public gift, preferring unseen if we have a user id.
  if chosen_gift_id is null then
    select g.id
      into chosen_gift_id
    from public.gifts g
    where g.public = true
      and (
        uid is null
        or not exists (
          select 1
          from public.user_gift_opens ugo
          where ugo.user_id = uid
            and ugo.gift_id = g.id
        )
      )
    order by random()
    limit 1;

    if chosen_reason is null then
      chosen_reason := 'random';
    end if;
  end if;

  if chosen_gift_id is null then
    raise exception 'no_gifts_available' using errcode = 'P0001';
  end if;

  insert into public.user_gift_opens(user_id, gift_id)
  values (coalesce(uid, 'anonymous'), chosen_gift_id)
  returning id, gift_id, opened_at
  into open_id, gift_id, opened_at;

  select g.title, g.description
    into gift_title, gift_description
  from public.gifts g
  where g.id = chosen_gift_id;

  reason := chosen_reason;
  return next;
end;
$$;
