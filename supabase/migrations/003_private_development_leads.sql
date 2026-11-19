-- Additive: touches no existing drafts, prospects, contacts, team, or underwriting rows.
-- Apply before exposing the workspace. Roll back a dataset by selecting its previous
-- version; leave these tables in place if reverting the UI. Do not drop saved work.
begin;

create table public.dev_leads_snapshots (
  owner_id uuid not null,
  version text not null check (version ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null,
  imported_at timestamptz not null default now(),
  primary key (owner_id, version)
);
create table public.dev_leads_head (
  owner_id uuid primary key,
  version text not null,
  foreign key (owner_id, version) references public.dev_leads_snapshots(owner_id, version)
);
create table public.dev_leads_activity (
  owner_id uuid not null,
  site_id text not null check (site_id ~ '^[a-z0-9][a-z0-9._:-]{0,95}$'),
  revision integer not null check (revision > 0),
  edits jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, site_id)
);

alter table public.dev_leads_snapshots enable row level security;
alter table public.dev_leads_head enable row level security;
alter table public.dev_leads_activity enable row level security;
create policy dev_leads_snapshots_own on public.dev_leads_snapshots to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy dev_leads_head_own on public.dev_leads_head to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy dev_leads_activity_own on public.dev_leads_activity to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.dev_leads_snapshots, public.dev_leads_head, public.dev_leads_activity from public, anon, authenticated;

-- Private helper, never callable by the REST user's role. The definer APIs take
-- no caller-selected recipient; p_actor is only a same-login guard. The owner is
-- always derived from the verified JWT, with an existing team membership check. An admin team role does not broaden access.
create function public.dev_leads_owner(p_actor uuid) returns uuid
language plpgsql stable security invoker set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null or u is distinct from p_actor or not exists (select 1 from public.team_members where user_id = u and role in ('admin','member')) then
    raise exception 'This workspace requires an existing Deal Desk team login.' using errcode = '42501';
  end if;
  return u;
end $$;

create function public.dev_leads_workspace(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := public.dev_leads_owner(p_actor); v text; source jsonb;
begin
  select h.version, s.snapshot into v, source
    from public.dev_leads_head h join public.dev_leads_snapshots s on s.owner_id = h.owner_id and s.version = h.version
    where h.owner_id = u;
  return jsonb_build_object('version',v,'snapshot',source,
    'history', coalesce((select jsonb_agg(jsonb_build_object('version',s.version,'imported_at',s.imported_at,
      'generated_at',s.snapshot->>'generated_at','count',jsonb_array_length(s.snapshot->'leads')) order by s.imported_at desc, s.version)
      from (select version,snapshot,imported_at from public.dev_leads_snapshots where owner_id=u
            order by (version = v) desc, imported_at desc, version limit 50) s), '[]'::jsonb),
    'activity', coalesce((select jsonb_object_agg(a.site_id,jsonb_build_object('revision',a.revision,'edits',a.edits))
      from public.dev_leads_activity a join jsonb_array_elements(source->'leads') j on j->>'id'=a.site_id
      where a.owner_id=u), '{}'::jsonb));
end $$;

create function public.dev_leads_import(p_actor uuid,p_snapshot jsonb, p_expected_version text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.dev_leads_owner(p_actor); curr text; v text; n integer;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' or octet_length(p_snapshot::text) > 2097152
     or (p_snapshot->'schema_version') is distinct from '1'::jsonb
     or coalesce(p_snapshot->>'generated_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T|$)'
     or jsonb_typeof(p_snapshot->'leads') is distinct from 'array' then
    raise exception 'Invalid development research file.' using errcode = '22023';
  end if;
  perform (p_snapshot->>'generated_at')::timestamptz;
  n := jsonb_array_length(p_snapshot->'leads');
  if n not between 1 and 150 or exists (select 1 from jsonb_array_elements(p_snapshot->'leads') j
      where jsonb_typeof(j) <> 'object' or coalesce(j->>'id','') !~ '^[a-z0-9][a-z0-9._:-]{0,95}$'
      or coalesce(j->>'rank','') !~ '^[1-9][0-9]{0,2}$' or coalesce(j->>'type','') not in ('standalone','sandwich','air_rights','fallback')
      or coalesce(j->'anchor'->>'address','') = '' or coalesce(j->'anchor'->>'bbl','') !~ '^[1-5][0-9]{9}$'
      or coalesce(j->>'borough','') not in ('Bronx','Brooklyn','Manhattan','Queens','Staten Island')
      or jsonb_typeof(j->'parcels') is distinct from 'array'
      or coalesce(j->>'why_call','') = '')
      or (select count(distinct j->>'id') from jsonb_array_elements(p_snapshot->'leads') j) <> n
      or (select count(distinct j->>'rank') from jsonb_array_elements(p_snapshot->'leads') j) <> n then
    raise exception 'Invalid site count, identity, or shape.' using errcode = '22023';
  end if;
  -- Hash the canonical jsonb, never a browser-provided owner/version. Explicit
  -- rollback prevents an old file accidentally replacing the active snapshot.
  v := encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('dev-leads/' || u::text, 0));
  select version into curr from public.dev_leads_head where owner_id=u;
  if curr = v then return jsonb_build_object('outcome','unchanged','version',v); end if;
  if curr is distinct from p_expected_version then raise exception 'Research changed. Reload before importing.' using errcode = '40001'; end if;
  if exists (select 1 from public.dev_leads_snapshots where owner_id=u and version=v) then
    return jsonb_build_object('outcome','archived','version',v);
  end if;
  -- Avoid attaching old notes to a different acquisition/donor set under a reused ID.
  if exists (select 1 from public.dev_leads_snapshots s
    cross join lateral jsonb_array_elements(s.snapshot->'leads') old_site
    join jsonb_array_elements(p_snapshot->'leads') new_site on new_site->>'id'=old_site->>'id'
    where s.owner_id=u and (
      old_site->'anchor'->>'bbl' is distinct from new_site->'anchor'->>'bbl' or
      (select array_agg((p->>'bbl')||':'||(p->>'role'='donor')::text order by p->>'bbl') from jsonb_array_elements(old_site->'parcels') p)
      is distinct from
      (select array_agg((p->>'bbl')||':'||(p->>'role'='donor')::text order by p->>'bbl') from jsonb_array_elements(new_site->'parcels') p))) then
    raise exception 'A stable site ID was reused for a different parcel set.' using errcode = '22023';
  end if;
  insert into public.dev_leads_snapshots(owner_id,version,snapshot) values (u,v,p_snapshot);
  insert into public.dev_leads_head(owner_id,version) values (u,v)
    on conflict (owner_id) do update set version=excluded.version;
  return jsonb_build_object('outcome','imported','version',v);
end $$;

create function public.dev_leads_restore(p_actor uuid,p_version text, p_expected_version text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.dev_leads_owner(p_actor); curr text;
begin
  perform pg_advisory_xact_lock(hashtextextended('dev-leads/' || u::text, 0));
  select version into curr from public.dev_leads_head where owner_id=u;
  if curr is not distinct from p_expected_version and curr is not null and p_version = curr then
    return jsonb_build_object('outcome','unchanged','version',curr);
  end if;
  if curr is distinct from p_expected_version then raise exception 'Research changed. Reload before restoring.' using errcode = '40001'; end if;
  if p_version is null then
    delete from public.dev_leads_head where owner_id=u;
    return jsonb_build_object('outcome','paused','version',null);
  end if;
  if not exists (select 1 from public.dev_leads_snapshots where owner_id=u and version=p_version) then
    raise exception 'No saved version.' using errcode = '22023';
  end if;
  insert into public.dev_leads_head(owner_id,version) values (u,p_version)
    on conflict (owner_id) do update set version=excluded.version;
  return jsonb_build_object('outcome','restored','version',p_version);
end $$;

create function public.dev_leads_save(p_actor uuid,p_version text,p_site_id text,p_expected_revision integer,p_edits jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.dev_leads_owner(p_actor); r integer; prior jsonb;
begin
  if p_edits is null or jsonb_typeof(p_edits) <> 'object' or p_expected_revision is null or p_expected_revision < 0
     or octet_length(p_edits::text) > 16384 then raise exception 'Invalid card edits.' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_each(p_edits) e
       where jsonb_typeof(e.value) <> 'string' or e.key not in ('address','contact_name','phone','note','status'))
     or length(coalesce(p_edits->>'address','')) > 240 or length(coalesce(p_edits->>'contact_name','')) > 160
     or length(coalesce(p_edits->>'phone','')) > 60 or length(coalesce(p_edits->>'note','')) > 3000
     or coalesce(p_edits->>'status','New') not in ('New','To call','Follow up','Passed') then
    raise exception 'Invalid card fields.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dev-leads/' || u::text, 0));
  if not exists (select 1 from public.dev_leads_head h join public.dev_leads_snapshots s
      on s.owner_id=h.owner_id and s.version=h.version
      where h.owner_id=u and h.version=p_version and exists
        (select 1 from jsonb_array_elements(s.snapshot->'leads') j where j->>'id'=p_site_id)) then
    raise exception 'This site is not in your active snapshot. Reload before saving.' using errcode = '40001';
  end if;
  select revision,edits into r,prior from public.dev_leads_activity where owner_id=u and site_id=p_site_id;
  if prior = p_edits then return jsonb_build_object('revision',r,'edits',prior); end if;
  if coalesce(r,0) <> p_expected_revision then raise exception 'Card changed. Reload before saving.' using errcode = '40001'; end if;
  insert into public.dev_leads_activity(owner_id,site_id,revision,edits) values (u,p_site_id,coalesce(r,0)+1,p_edits)
    on conflict (owner_id,site_id) do update set revision=excluded.revision, edits=excluded.edits, updated_at=now();
  return jsonb_build_object('revision',coalesce(r,0)+1,'edits',p_edits);
end $$;

revoke all on function public.dev_leads_owner(uuid), public.dev_leads_workspace(uuid), public.dev_leads_import(uuid,jsonb,text),
  public.dev_leads_restore(uuid,text,text), public.dev_leads_save(uuid,text,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.dev_leads_workspace(uuid), public.dev_leads_import(uuid,jsonb,text),
  public.dev_leads_restore(uuid,text,text), public.dev_leads_save(uuid,text,text,integer,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
