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

-- Seed gifts (idempotent by title). This keeps the demo working even if the agent only
-- creates user_gift_opens rows and the frontend fetches gift details directly.
with seed(title, description, meta, public) as (
  values
    ('Wool Mittens', 'Cozy wool mittens to keep your hands warm.', '{"tags":["warm","winter"],"rarity":"common"}', true),
    ('Hot Cocoa Kit', 'A rich cocoa mix with mini marshmallows.', '{"tags":["treat","cozy"],"rarity":"common"}', true),
    ('Snowflake Ornament', 'A sparkling ornament for your tree.', '{"tags":["decor"],"rarity":"common"}', true),
    ('Storybook Collection', 'A bundle of bedtime stories for snowy nights.', '{"tags":["book","calm"],"rarity":"common"}', true),
    ('Wooden Train Set', 'A classic wooden train with tracks.', '{"tags":["toy","classic"],"rarity":"common"}', true),
    ('Knitted Scarf', 'A soft scarf in festive colors.', '{"tags":["warm","fashion"],"rarity":"common"}', true),
    ('Candy Cane Jar', 'A jar filled with peppermint candy canes.', '{"tags":["treat"],"rarity":"common"}', true),
    ('Puzzle Box', 'A tricky puzzle box that hides a surprise.', '{"tags":["puzzle"],"rarity":"uncommon"}', true),
    ('Snow Globe', 'A tiny winter scene that swirls with snow.', '{"tags":["decor","collectible"],"rarity":"uncommon"}', true),
    ('Sketchbook', 'A blank sketchbook for doodles and dreams.', '{"tags":["art"],"rarity":"common"}', true),
    ('Color Pencil Set', 'A set of vibrant colored pencils.', '{"tags":["art"],"rarity":"common"}', true),
    ('Warm Socks', 'Fluffy socks that feel like a hug.', '{"tags":["warm"],"rarity":"common"}', true),
    ('Tiny Lantern', 'A little lantern for a cozy desk glow.', '{"tags":["cozy"],"rarity":"uncommon"}', true),
    ('Stargazer Map', 'A beginner star map for clear winter skies.', '{"tags":["science"],"rarity":"uncommon"}', true),
    ('Tea Sampler', 'A sampler of comforting herbal teas.', '{"tags":["treat","calm"],"rarity":"common"}', true),
    ('Cookie Cutter Set', 'Fun shapes for holiday baking.', '{"tags":["baking"],"rarity":"common"}', true),
    ('Mini Drum', 'A tiny drum for parade practice.', '{"tags":["music","toy"],"rarity":"uncommon"}', true),
    ('Harmonica', 'A pocket harmonica with a bright sound.', '{"tags":["music"],"rarity":"uncommon"}', true),
    ('Beginner Chess Set', 'A simple chess set to learn strategy.', '{"tags":["game"],"rarity":"uncommon"}', true),
    ('Kite Voucher', 'A promise for a windy-day kite adventure.', '{"tags":["outdoors"],"rarity":"common"}', true),
    ('Plant Starter Kit', 'Seeds and soil to grow something green.', '{"tags":["garden"],"rarity":"uncommon"}', true),
    ('Sticker Pack', 'A pack of cute winter-themed stickers.', '{"tags":["fun"],"rarity":"common"}', true),
    ('Comic Zine', 'A tiny handmade comic zine.', '{"tags":["book","fun"],"rarity":"uncommon"}', true),
    ('Reusable Bottle', 'A sturdy bottle for everyday adventures.', '{"tags":["practical"],"rarity":"common"}', true),
    ('Desk Fidget', 'A small fidget to keep hands busy.', '{"tags":["focus"],"rarity":"common"}', true),
    ('Origami Paper', 'A pack of patterned paper for folding.', '{"tags":["craft"],"rarity":"common"}', true),
    ('Model Airplane', 'A simple model airplane kit.', '{"tags":["build"],"rarity":"uncommon"}', true),
    ('Treasure Map', 'A playful map to a pretend treasure.', '{"tags":["adventure"],"rarity":"uncommon"}', true),
    ('Mystery Key', 'A key that surely unlocks something someday.', '{"tags":["mystery"],"rarity":"rare"}', true),
    ('Cozy Blanket', 'A warm blanket for movie nights.', '{"tags":["warm","cozy"],"rarity":"uncommon"}', true),
    ('Glow Star Stickers', 'Stars that glow softly at night.', '{"tags":["decor"],"rarity":"common"}', true),
    ('Mini Photo Frame', 'A small frame for a favorite memory.', '{"tags":["decor"],"rarity":"common"}', true),
    ('Cookbook Pamphlet', 'Simple recipes for tasty treats.', '{"tags":["baking","book"],"rarity":"common"}', true),
    ('Winter Hat', 'A beanie that fits snug and warm.', '{"tags":["warm"],"rarity":"common"}', true),
    ('Hot Pack', 'A reusable heat pack for chilly days.', '{"tags":["warm","practical"],"rarity":"common"}', true),
    ('Tiny Tool Kit', 'A mini tool kit for small fixes.', '{"tags":["practical"],"rarity":"uncommon"}', true),
    ('Notebook', 'A notebook for lists, plans, and poems.', '{"tags":["write"],"rarity":"common"}', true),
    ('Fountain Pen', 'A smooth pen for happy handwriting.', '{"tags":["write"],"rarity":"uncommon"}', true),
    ('Board Game Night', 'A voucher for a cozy board game night.', '{"tags":["game","cozy"],"rarity":"common"}', true),
    ('Movie Ticket Pair', 'A voucher for a movie with popcorn.', '{"tags":["fun"],"rarity":"uncommon"}', true),
    ('Sled Ride', 'A promise for a thrilling sled ride.', '{"tags":["outdoors"],"rarity":"uncommon"}', true),
    ('Snowman Kit', 'Buttons, a scarf, and a carrot (imagined).', '{"tags":["outdoors","fun"],"rarity":"common"}', true),
    ('Caramel Treat', 'A small caramel treat wrapped neatly.', '{"tags":["treat"],"rarity":"common"}', true),
    ('Peppermint Tea', 'A soothing peppermint tea blend.', '{"tags":["treat","calm"],"rarity":"common"}', true),
    ('Mini Canvas', 'A mini canvas for a tiny masterpiece.', '{"tags":["art"],"rarity":"common"}', true),
    ('Watercolor Set', 'A starter watercolor set with a brush.', '{"tags":["art"],"rarity":"uncommon"}', true),
    ('Clay Kit', 'Air-dry clay for small creations.', '{"tags":["craft"],"rarity":"uncommon"}', true),
    ('Friendship Bracelet Kit', 'Thread for making bracelets.', '{"tags":["craft","fun"],"rarity":"common"}', true),
    ('Mini Cookbook', 'A tiny booklet of comfort recipes.', '{"tags":["book","baking"],"rarity":"common"}', true),
    ('Nature Journal', 'A journal for notes from outdoor walks.', '{"tags":["write","outdoors"],"rarity":"uncommon"}', true),
    ('Binoculars', 'Compact binoculars for bird watching.', '{"tags":["outdoors"],"rarity":"rare"}', true),
    ('Science Kit', 'A small kit of safe experiments.', '{"tags":["science"],"rarity":"uncommon"}', true),
    ('Magnet Set', 'A set of tiny magnets for your fridge.', '{"tags":["fun"],"rarity":"common"}', true),
    ('Music Playlist', 'A curated playlist for winter vibes.', '{"tags":["music"],"rarity":"common"}', true),
    ('Cozy Reading Light', 'A clip-on light for late-night reading.', '{"tags":["cozy"],"rarity":"uncommon"}', true),
    ('Adventure Compass', 'A small compass to point the way.', '{"tags":["outdoors","adventure"],"rarity":"uncommon"}', true),
    ('Mystery Envelope', 'A sealed envelope with a surprise note.', '{"tags":["mystery"],"rarity":"rare"}', true),
    ('Chocolate Coins', 'A pouch of chocolate coins.', '{"tags":["treat"],"rarity":"common"}', true),
    ('Mini Plush', 'A tiny plush friend for your pocket.', '{"tags":["toy","cozy"],"rarity":"uncommon"}', true),
    ('Snowy Postcard Set', 'Postcards to send warm wishes.', '{"tags":["write"],"rarity":"common"}', true),
    ('DIY Candle Kit', 'A small kit to make a candle.', '{"tags":["craft","cozy"],"rarity":"rare"}', true),
    ('Winter Playlist Card', 'A card with songs to brighten the day.', '{"tags":["music"],"rarity":"common"}', true),
    ('Bake Together Coupon', 'A coupon for baking with a friend.', '{"tags":["baking","fun"],"rarity":"common"}', true),
    ('Mini Terrarium', 'A tiny terrarium to grow a small plant.', '{"tags":["garden"],"rarity":"rare"}', true),
    ('Sturdy Backpack', 'A backpack ready for adventures.', '{"tags":["practical","outdoors"],"rarity":"rare"}', true),
    ('Cozy Hoodie', 'A soft hoodie for cold mornings.', '{"tags":["warm"],"rarity":"rare"}', true),
    ('Ice Skating Pass', 'A pass for a day of skating.', '{"tags":["outdoors"],"rarity":"rare"}', true),
    ('Mini Speaker', 'A small speaker for music anywhere.', '{"tags":["music"],"rarity":"rare"}', true),
    ('Cookbook for Kids', 'Simple recipes with big flavor.', '{"tags":["book","baking"],"rarity":"uncommon"}', true),
    ('Puzzle Calendar', 'A daily mini-puzzle for a month.', '{"tags":["puzzle"],"rarity":"uncommon"}', true),
    ('Comfort Tea Box', 'A box of calming tea blends.', '{"tags":["treat","calm"],"rarity":"uncommon"}', true),
    ('Warm Hand Cream', 'A small hand cream for winter skin.', '{"tags":["practical"],"rarity":"common"}', true),
    ('Secret Recipe', 'A handwritten secret recipe card.', '{"tags":["mystery","baking"],"rarity":"rare"}', true),
    ('Tiny Snowflake Pin', 'A little pin that sparkles.', '{"tags":["fashion"],"rarity":"uncommon"}', true),
    ('Comic Book', 'A fun comic for a cozy afternoon.', '{"tags":["book","fun"],"rarity":"common"}', true),
    ('Mini Telescope', 'A starter telescope for stargazing.', '{"tags":["science"],"rarity":"rare"}', true),
    ('Winter Walk Kit', 'A scarf, a snack, and a plan (in spirit).', '{"tags":["outdoors"],"rarity":"common"}', true),
    ('DIY Snowflake Crafts', 'Craft supplies for paper snowflakes.', '{"tags":["craft"],"rarity":"common"}', true),
    ('Gratitude Cards', 'Cards to write thank-you notes.', '{"tags":["write"],"rarity":"common"}', true),
    ('Bookstore Voucher', 'A small voucher for a new book.', '{"tags":["book"],"rarity":"rare"}', true),
    ('Arcade Token Pack', 'A pack of tokens for arcade fun.', '{"tags":["fun"],"rarity":"uncommon"}', true),
    ('Cozy Slippers', 'Warm slippers for quiet mornings.', '{"tags":["warm","cozy"],"rarity":"uncommon"}', true)
)
insert into public.gifts (title, description, meta, public)
select s.title, s.description, s.meta::jsonb, s.public
from seed s
where not exists (
  select 1 from public.gifts g where g.title = s.title
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

-- Explicitly disallow deletions for client roles.
revoke delete on table public.gifts from anon, authenticated;
revoke delete on table public.user_gift_opens from anon, authenticated;
revoke delete on table public.wishes from anon, authenticated;

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
