-- Additive workbook catalog: no existing policies, identities or records are modified.
-- A project administrator stages an owner-approved master privately. Signed-in clients
-- can only read their own master; changing a downloaded copy cannot overwrite it.
begin;
create table public.uw_excel_templates (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  byte_count integer not null check (byte_count between 4 and 524288),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  xlsx_base64 text not null check (
    length(xlsx_base64) = 4 * ((byte_count + 2) / 3) and
    octet_length(decode(xlsx_base64, 'base64')) = byte_count and
    substring(decode(xlsx_base64, 'base64') from 1 for 4) = decode('504b0304','hex') and
    encode(sha256(decode(xlsx_base64,'base64')), 'hex') = file_sha256
  ),
  updated_at timestamptz not null default now()
);
alter table public.uw_excel_templates enable row level security;
alter table public.uw_excel_templates force row level security;
revoke all on public.uw_excel_templates from public, anon, authenticated;
grant select (owner_id, byte_count, xlsx_base64) on public.uw_excel_templates to authenticated;
create policy uw_excel_owner_read on public.uw_excel_templates for select to authenticated using (owner_id = (select auth.uid()));
notify pgrst, 'reload schema';
commit;
