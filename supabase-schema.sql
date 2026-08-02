-- J Realty Group Deal Desk - shared team state
-- Run this once in Supabase SQL Editor.

create table if not exists app_state (
    id text primary key,
    data jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
  );

insert into app_state (id, data)
values ('shared', '{"deals": [], "buyers": [], "photos": {}}'::jsonb)
on conflict (id) do nothing;

alter table app_state enable row level security;

drop policy if exists "authenticated read app_state" on app_state;
create policy "authenticated read app_state"
  on app_state for select
  using (auth.role() = 'authenticated');

drop policy if exists "authenticated update app_state" on app_state;
create policy "authenticated update app_state"
  on app_state for update
  using (auth.role() = 'authenticated');

drop policy if exists "authenticated insert app_state" on app_state;
create policy "authenticated insert app_state"
  on app_state for insert
  with check (auth.role() = 'authenticated');
