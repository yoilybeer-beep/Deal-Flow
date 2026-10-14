-- 002_contacts_crm_and_buyer_tags.sql   (run after 001: uses is_team / can_write / is_admin)
begin;

-- 1. Buyers: new "what they buy" list. Tags live in buyers.data->'assetTypes' (jsonb array).
--    Rename the old tags in place; updated_at is left alone so the list order doesn't change.
--    Development site -> Development / Land ; Multifamily, Mixed-use -> Existing / Stabilized ; Conversion, Other stay.
update public.buyers b
set data = jsonb_set(b.data, '{assetTypes}', (
  select coalesce(jsonb_agg(distinct s.t), '[]'::jsonb)
  from (
    select case x
             when 'Development site' then 'Development / Land'
             when 'Multifamily'      then 'Existing / Stabilized'
             when 'Mixed-use'        then 'Existing / Stabilized'
             else x
           end as t
    from jsonb_array_elements_text(coalesce(b.data->'assetTypes', '[]'::jsonb)) as x
  ) s))
where b.data->'assetTypes' ?| array['Development site','Multifamily','Mixed-use'];

create index if not exists buyers_asset_types_idx on public.buyers using gin ((data->'assetTypes'));

-- 2. Contacts (owners / buyers / brokers / lenders)
create table if not exists public.contacts (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid(),
  name               text not null check (length(trim(name)) > 0),
  phone              text,
  email              text,
  address            text,
  area               text check (area in ('Brooklyn','Queens','Manhattan','Harlem','Bronx')),
  type               text not null default 'owner' check (type in ('owner','buyer','broker','lender')),
  follow_up_date     date,
  last_contacted     date,                                                    -- set when a call/note is logged, or by hand
  is_public          boolean not null default false,
  converted_buyer_id text references public.buyers(id) on delete set null,   -- "Convert to Buyer"
  converted_deal_id  text references public.deals(id)  on delete set null,   -- "Convert to Seller / Deal"
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists contacts_owner_updated_idx on public.contacts (owner_id, updated_at desc);
create index if not exists contacts_follow_up_idx     on public.contacts (follow_up_date) where follow_up_date is not null;

-- 3. Notes log: one dated row per call
create table if not exists public.contact_notes (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  owner_id    uuid not null default auth.uid(),
  author_name text,
  body        text not null check (length(trim(body)) > 0),
  noted_at    timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists contact_notes_contact_idx on public.contact_notes (contact_id, noted_at desc);

-- a new note bumps its contact to the top of the list
create or replace function public.touch_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.contacts set updated_at = now() where id = new.contact_id;
  return new;
end;
$$;
drop trigger if exists contact_notes_touch on public.contact_notes;
create trigger contact_notes_touch after insert on public.contact_notes
  for each row execute function public.touch_contact();

-- 4. RLS, same rules as buyers/deals after 001
alter table public.contacts      enable row level security;
alter table public.contact_notes enable row level security;

create policy "team reads own, published, admin all" on public.contacts for select to authenticated
  using (public.is_team() and (owner_id = auth.uid() or is_public or public.is_admin()));
create policy "writers insert own" on public.contacts for insert to authenticated
  with check (public.can_write() and owner_id = auth.uid());
create policy "owner or admin updates" on public.contacts for update to authenticated
  using (public.can_write() and (owner_id = auth.uid() or public.is_admin()))
  with check (public.can_write() and (owner_id = auth.uid() or public.is_admin()));
create policy "owner or admin deletes" on public.contacts for delete to authenticated
  using (public.can_write() and (owner_id = auth.uid() or public.is_admin()));

-- notes follow their contact: readable if you can read the contact; anyone who can write and can see it may add a note
create policy "read notes of visible contacts" on public.contact_notes for select to authenticated
  using (exists (select 1 from public.contacts c where c.id = contact_id));
create policy "writers add notes" on public.contact_notes for insert to authenticated
  with check (public.can_write() and owner_id = auth.uid() and exists (select 1 from public.contacts c where c.id = contact_id));
create policy "author or admin edits notes" on public.contact_notes for update to authenticated
  using (public.can_write() and (owner_id = auth.uid() or public.is_admin()));
create policy "author or admin deletes notes" on public.contact_notes for delete to authenticated
  using (public.can_write() and (owner_id = auth.uid() or public.is_admin()));

commit;
