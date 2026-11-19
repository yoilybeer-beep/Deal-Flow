import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabaseClient';
import { BOROUGHS, TYPES, STATUSES, LISTING, CERTAINTY, PARCEL_ROLES, MAX_BYTES,
  parseSnapshot, cleanEdits, emptyEdits, dialNumber, inFilter, roughSensitivity, safeLink } from './developmentLeads';
import './developmentLeads.css';

const START_FILTERS = { q:'', borough:'', type:'', units:'', existing:'', frontage:'', listing:'', status:'' };
const PAGE = 18;
const usd = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
const fmt = new Intl.NumberFormat('en-US',{maximumFractionDigits:1});
const dateLabel = (iso) => !iso ? '' : new Date(iso.length === 10 ? iso+'T12:00:00Z' : iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'America/New_York'});
const measure = (n, suffix) => n == null ? 'Unknown' : `${fmt.format(n)}${suffix}`;
const rangeLabel = (r, suffix = '') => r ? `${fmt.format(r.min)}${r.max !== r.min ? `–${fmt.format(r.max)}` : ''}${suffix}` : 'Unconfirmed';
const objectEntries = (map) => Object.entries(map);
const options = (labels) => labels.map((l) => [l,l]);
const copyFieldError = (e) => e?.code === '40001' ? 'This card or research version changed in another tab. Reload the latest workspace before saving. Your current text is still here to copy.' :
  e?.code === '42501' ? 'Your existing Deal Desk login no longer matches this workspace.' :
  e?.code === '22023' ? 'The server rejected these fields. Check the selected file or your changes.' : 'No save confirmation. Reload to check what was saved before trying again.';

export default function DevelopmentLeads({ userId, accountLabel, onDraft }) {
  const [work, setWork] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const [message, setMessage] = useState(''), [manage, setManage] = useState(false), [candidate, setCandidate] = useState(null);
  const [inputError, setInputError] = useState(''), [restore, setRestore] = useState(null), [editing, setEditing] = useState(null);
  const [filters, setFilters] = useState(START_FILTERS), [limit, setLimit] = useState(PAGE);
  const [filterOpen, setFilterOpen] = useState(false), [editError, setEditError] = useState('');
  const live = useRef(null), pending = useRef(false), fileRead = useRef(0);
  const call = async (fn, args, signal) => {
    const { data, error } = await supabase.rpc(fn, { p_actor:userId, ...args }).abortSignal(signal);
    if (error) throw error;
    if (!data || typeof data !== 'object') throw new Error('Unexpected workspace response.');
    return data;
  };
  const refresh = async (signal, mounted = true) => {
    if (mounted) setError('');
    try {
      const w = await call('dev_leads_workspace', {}, signal);
      if (signal.aborted) return null;
      const next = { version:w.version || null, snapshot:w.snapshot ? parseSnapshot(w.snapshot) : null,
        activity:w.activity && typeof w.activity === 'object' ? w.activity : {}, history:Array.isArray(w.history) ? w.history : [] };
      if (!!next.snapshot !== !!next.version) throw new Error('Invalid active snapshot.');
      setWork(next);
      return next;
    } catch (e) {
      if (!signal.aborted) {
        setWork(null);
        setError(['PGRST202','42883','42P01'].includes(e?.code) ? 'The private database for Development Leads has not been enabled yet.' :
          e?.code === '42501' ? 'This workspace is not available for this Deal Desk login.' : 'Could not read your private workspace. Try reloading.');
      }
      return null;
    }
  };
  useEffect(() => {
    const controller = new AbortController(); live.current = controller; pending.current = false;
    refresh(controller.signal);
    return () => { controller.abort(); fileRead.current++; };
  }, [userId]);
  const transact = async (name, fn) => {
    if (pending.current || !live.current || live.current.signal.aborted) return;
    const signal = live.current.signal;
    pending.current = true; setBusy(name);
    try { await fn(signal); } finally { if (!signal.aborted) { pending.current = false; setBusy(''); } }
  };
  const retry = () => transact('loading', async (signal) => { await refresh(signal); });
  const stageFile = async (event) => {
    const item = event.target.files?.[0]; event.target.value = '';
    setCandidate(null); setInputError(''); setRestore(null);
    if (!item) return;
    const key = ++fileRead.current;
    try {
      if (item.size > MAX_BYTES) throw new Error('Choose a JSON file under 1.8 MB.');
      let raw;
      try { raw = JSON.parse(await item.text()); } catch { throw new Error('That file is not readable JSON.'); }
      const data = parseSnapshot(raw);
      if (key === fileRead.current) setCandidate({ data, expected:work.version });
    } catch (e) { if (key === fileRead.current) setInputError(e.message); }
  };
  const commitSnapshot = () => transact('importing', async (signal) => {
    setInputError(''); setMessage('');
    try {
      const r = await call('dev_leads_import', { p_snapshot:candidate.data, p_expected_version:candidate.expected }, signal);
      if (signal.aborted) return;
      const read = await refresh(signal);
      if (!read) return;
      setCandidate(null);
      setMessage(r.outcome === 'archived' ? 'That file is an older snapshot. Nothing changed. Restore it from history if you want to use it.' :
        read.version !== r.version ? 'The import was recorded, but another research version is active. Check version history.' :
        r.outcome === 'unchanged' ? 'That exact research is already active. No duplicate was created.' : 'Private research imported and read back. Your card edits stayed in place.');
    } catch (e) { if (!signal.aborted) setInputError(e?.code === '40001' ? 'Research changed. Reload and preview the file again before importing.' : copyFieldError(e)); }
  });
  const restoreSnapshot = () => transact('restoring', async (signal) => {
    setInputError(''); setMessage('');
    try {
      const r = await call('dev_leads_restore', { p_version:restore.target, p_expected_version:restore.expected }, signal);
      if (signal.aborted) return;
      const check = await refresh(signal);
      if (!check) return;
      setRestore(null);
      setMessage(check.version !== r.version ? 'Another snapshot took its place. Check version history.' :
        restore.target ? 'Research version restored. Your private card edits stayed in place.' : 'Active list paused. Research and card edits are still saved.');
    } catch (e) { if (!signal.aborted) setInputError(e?.code === '40001' ? 'Research changed. Reload before restoring.' : copyFieldError(e)); }
  });
  const saveEdit = (editingValue, values, site) => transact('saving', async (signal) => {
    setEditError('');
    try {
      const row = await call('dev_leads_save', { p_version:editingValue.version, p_site_id:site.id,
        p_expected_revision:editingValue.revision, p_edits:values }, signal);
      if (signal.aborted) return;
      if (!Number.isInteger(row.revision) || JSON.stringify(cleanEdits(row.edits)) !== JSON.stringify(values)) {
        throw new Error('No matching card confirmation.');
      }
      setWork((w) => w && ({ ...w, activity:{...w.activity, [site.id]:row} }));
      // If a working address or status changed, keep the saved card in view.
      if (!inFilter(site, row.edits, filters)) setFilters((f) => ({ ...f, status:'', q:'' }));
      setEditing(null); setMessage('Saved to your account. Source research was not changed.');
    } catch (e) { if (!signal.aborted) setEditError(copyFieldError(e)); }
  });
  const downloadResearch = () => {
    const b = new Blob([JSON.stringify(work.snapshot,null,2)], { type:'application/json' });
    const href = URL.createObjectURL(b);
    const a = document.createElement('a'); a.href = href; a.download = 'development-leads-private-research.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1500);
  };
  const sites = work?.snapshot?.leads;
  const shown = useMemo(() => (sites || []).filter((s) => inFilter(s, work.activity[s.id]?.edits, filters)), [sites, work?.activity, filters]);
  const change = (name, value) => { setFilters((f) => ({ ...f,[name]:value })); setLimit(PAGE); };
  const clear = () => { setFilters(START_FILTERS); setLimit(PAGE); };
  const openEdit = (site, phoneOnly) => {
    if (pending.current) return;
    setEditError(''); setMessage('');
    const saved = work.activity[site.id];
    setEditing({ site, phoneOnly, version:work.version, revision:saved?.revision || 0, values:{...emptyEdits,...saved?.edits} });
  };
  const applied = Object.entries(filters).filter(([k,v]) => k !== 'q' && v).length;
  return <section className="dev-leads" aria-labelledby="dev-title">
    <header className="dev-hero">
      <div><div className="dev-kicker">NYC ACQUISITIONS <span>ACCOUNT ONLY</span></div>
        <h1 id="dev-title">Development Leads</h1>
        <p>One ranked list across all five boroughs. 30+ home scenarios, assemblages, air rights and 50′+ fallbacks.</p></div>
      {work && <button type="button" className="dev-btn dev-manage" aria-expanded={manage} aria-controls="dev-manage"
        onClick={() => { setManage((v) => !v); setCandidate(null); setRestore(null); setInputError(''); fileRead.current++; }} disabled={!!busy}>
        {manage ? 'Close research tools' : 'Manage research'}</button>}
    </header>
    <div className="dev-live" role="status" aria-live="polite">{message}</div>
    {error && <div className="dev-empty"><h2>Workspace unavailable</h2><p>{error}</p><button className="dev-btn" type="button" disabled={!!busy} onClick={retry}>Retry loading</button></div>}
    {!work && !error && <div className="dev-empty" role="status">Loading your private leads…</div>}
    {work && manage && <section id="dev-manage" className="dev-panel dev-manage-panel" aria-label="Manage private research">
      <div><h2>Private research snapshots</h2><p>Signed in as <strong>{accountLabel}</strong>. Import updates your list only. Notes, contacts and working addresses stay separate.</p></div>
      <label className="dev-file">Preview a local research file <input type="file" accept=".json,application/json" disabled={!!busy} onChange={stageFile}/></label>
      {candidate && <div className="dev-confirm"><strong>{candidate.data.leads.length} ranked sites · {dateLabel(candidate.data.generated_at)}</strong>
        <p>Ready for this login only. Prior research versions are kept.</p>
        <button className="dev-btn dev-primary" type="button" disabled={!!busy} onClick={commitSnapshot}>{busy === 'importing' ? 'Importing…' : 'Import private snapshot'}</button>{' '}
        <button className="dev-btn" type="button" disabled={!!busy} onClick={() => setCandidate(null)}>Cancel</button></div>}
      {inputError && <p className="dev-error" role="alert">{inputError}</p>}
      {!!work.history.length && <div className="dev-history"><h3>Version history</h3><ul>{work.history.map((h) => <li key={h.version}>
        <div><strong>{dateLabel(h.generated_at)} · {h.count} sites</strong> <small>{h.version.slice(0,8)} · imported {dateLabel(h.imported_at)}</small></div>
        {work.version === h.version ? <span className="dev-pill dev-green">Active</span> : <button className="dev-btn" type="button" disabled={!!busy}
          onClick={() => { setRestore({target:h.version,expected:work.version}); setCandidate(null); setInputError(''); }}>Restore</button>}</li>)}</ul></div>}
      <div className="dev-actions">
        {work.snapshot && <><button className="dev-btn" type="button" disabled={!!busy} onClick={downloadResearch}>Download research JSON</button>
          <button className="dev-btn" type="button" disabled={!!busy} onClick={() => { setRestore({target:null,expected:work.version}); setCandidate(null); setInputError(''); }}>Pause active list</button></>}
        <button className="dev-btn" type="button" disabled={!!busy} onClick={retry}>Reload workspace</button>
      </div>
      {restore && <div className="dev-confirm"><strong>{restore.target ? 'Restore this research version?' : 'Pause the active list?'}</strong>
        <p>Saved research versions and private edits are not deleted.</p>
        <button className="dev-btn dev-primary" type="button" disabled={!!busy} onClick={restoreSnapshot}>{busy === 'restoring' ? 'Saving…' : restore.target ? 'Confirm restore' : 'Confirm pause'}</button>{' '}
        <button className="dev-btn" type="button" disabled={!!busy} onClick={() => setRestore(null)}>Cancel</button></div>}
    </section>}
    {work && !sites && <div className="dev-empty"><div className="dev-kicker">PRIVATE LIST</div><h2>No active research yet</h2>
      <p>A reviewed list will appear here after it’s imported to this login. New Opportunities is unchanged.</p></div>}
    {sites && <>
      <div className="dev-meta"><div><strong>{sites.length} ranked {sites.length === 1 ? 'site' : 'sites'}</strong><span>Research snapshot · {dateLabel(work.snapshot.generated_at)}</span></div>
        <span>Screening estimates, not zoning or vacancy approvals</span></div>
      <section className="dev-panel dev-filters" aria-label="Filter ranked development leads">
        <div className="dev-search"><label>Search the list <input type="search" value={filters.q} onChange={(e) => change('q',e.target.value)}
          placeholder="Address, BBL or phone"/></label>
          <button type="button" className="dev-btn dev-filter-toggle" aria-expanded={filterOpen} aria-controls="dev-filter-grid" onClick={() => setFilterOpen(!filterOpen)}>
            Filters{applied ? ` (${applied})` : ''}</button></div>
        <div className="dev-filter-grid" id="dev-filter-grid" data-open={filterOpen}>
          <Filter label="Borough" value={filters.borough} set={(v) => change('borough',v)} choices={options(BOROUGHS)}/>
          <Filter label="Site type" value={filters.type} set={(v) => change('type',v)} choices={objectEntries(TYPES)}/>
          <Filter label="Estimated homes" value={filters.units} set={(v) => change('units',v)} choices={[["30-99","30–99"],["100+","100+"],["299+","299+"],["unconfirmed","Unconfirmed"]]}/>
          <Filter label="Existing homes" value={filters.existing} set={(v) => change('existing',v)} choices={[["0-5","0–5"],["6-10","6–10"],["unknown","Unknown"]]}/>
          <Filter label="Anchor frontage" value={filters.frontage} set={(v) => change('frontage',v)} choices={[["50","50′+"],["75","75′+"],["100","100′+"]]}/>
          <Filter label="Listing evidence" value={filters.listing} set={(v) => change('listing',v)} choices={objectEntries(LISTING)}/>
          <Filter label="My status" value={filters.status} set={(v) => change('status',v)} choices={options(STATUSES)}/>
        </div>
      </section>
      <div className="dev-count" aria-live="polite"><span><strong>{shown.length}</strong> of {sites.length} · Highest-ranked first</span>
        {(applied > 0 || filters.q) && <button className="dev-link" type="button" onClick={clear}>Clear filters</button>}</div>
      {shown.length === 0 ? <div className="dev-empty"><h2>No matching sites</h2><p>Try another borough, site type or unit band.</p></div> :
        <div className="dev-grid">{shown.slice(0,limit).map((s) => <LeadCard key={s.id} site={s} edits={work.activity[s.id]?.edits || emptyEdits}
          openEdit={(phoneOnly) => openEdit(s, phoneOnly)} onDraft={onDraft}/>)}</div>}
      {shown.length > limit && <button className="dev-btn dev-next" type="button" onClick={() => setLimit((l) => l + PAGE)}>Show the next {Math.min(PAGE,shown.length-limit)} sites</button>}
      {work.snapshot.methodology && <details className="dev-panel dev-method"><summary>How this list was screened</summary><p>{work.snapshot.methodology}</p></details>}
    </>}
    {editing && <EditDialog entry={editing} busy={busy === 'saving'} serverError={editError} onClose={() => setEditing(null)}
      onSave={(values) => saveEdit(editing, values, editing.site)}/>}
  </section>;
}

function Filter({ label, value, set, choices }) {
  return <label>{label}<select aria-label={label} value={value} onChange={(e) => set(e.target.value)}><option value="">Any</option>
    {choices.map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>;
}
function LeadCard({ site:s, edits, openEdit, onDraft }) {
  const worked = !!(edits.address || edits.contact_name || edits.phone || edits.note || (edits.status && edits.status !== 'New'));
  const dial = dialNumber(edits.phone), u = s.target_units;
  const warn = s.existing_units == null || s.existing_units >= 6;
  const labelExisting = s.existing_units == null ? 'Occupancy unknown' : s.existing_units >= 6 ? 'Delivery risk' : 'Low res. count ≠ vacant';
  const titleAddress = edits.address || s.anchor.address;
  const draft = (view) => onDraft?.(view, { address:titleAddress, borough:s.borough, contactName:edits.contact_name,
    phone:edits.phone, addressEntered:!!edits.address });
  return <article className="dev-card">
    <div className="dev-card-top"><div className="dev-stand"><span className="dev-rank" aria-label={`Rank ${s.rank}`}>#{s.rank}</span><span>{s.borough}{s.neighborhood ? ` · ${s.neighborhood}` : ''}</span></div>
      <span className={`dev-pill dev-type-${s.type}`}>{TYPES[s.type]}</span></div>
    <h2>{titleAddress}</h2><div className="dev-id">{edits.address ? 'Working address · Original parcel in Details' : `Anchor parcel · BBL ${s.anchor.bbl}`}</div>
    <div className="dev-metrics"><div><small>{s.type === 'sandwich' ? 'Assembled homes' : 'New homes est.'}</small><strong>{rangeLabel(u)}</strong>
      <span>{u ? CERTAINTY[u.certainty] : 'Not a yield claim'}</span></div>
      <div><small>Anchor frontage</small><strong>{measure(s.frontage_ft,'′')}</strong><span>{s.depth_ft == null ? 'Depth unknown' : measure(s.depth_ft,'′ deep')}</span></div>
      <div><small>Existing homes</small><strong>{measure(s.existing_units,'')}</strong><span className={warn ? 'dev-warning' : ''}>{labelExisting}</span></div></div>
    <p className="dev-call"><strong>Why call</strong> {s.why_call}</p>
    <div className="dev-listing"><span className={`dev-pill ${s.listing.status === 'verified_listed' ? 'dev-green' : 'dev-neutral'}`}>{LISTING[s.listing.status]}</span>
      {s.listing.ask_usd != null && <strong>{usd.format(s.listing.ask_usd)}</strong>}
      {s.listing.checked_at && <small>Checked {dateLabel(s.listing.checked_at)}</small>}</div>
    <div className="dev-work"><div className="dev-work-heading"><span>MY WORK</span><span className="dev-work-status">{edits.status || 'New'}</span></div>
      {edits.contact_name && <div className="dev-person">{edits.contact_name}</div>}
      {edits.note && <p className="dev-note" title="Open Edit card to view the full note">{edits.note}</p>}
      <div className="dev-actions">
        {dial ? <><a className="dev-btn" href={`tel:${dial}`}>{edits.phone}</a><button className="dev-btn" type="button" onClick={() => openEdit(true)}>Edit phone</button></> :
          <button className="dev-btn dev-primary" type="button" onClick={() => openEdit(true)}>Add phone</button>}
        <button className={`dev-btn${worked ? ' dev-primary' : ''}`} type="button" onClick={() => openEdit(false)}>Edit card</button>
      </div>
    </div>
    <details className="dev-detail"><summary>Site details <span>{s.parcels.length} {s.parcels.length === 1 ? 'parcel' : 'parcels'}</span></summary>
      <div className="dev-detail-body"><div className="dev-detail-label">SOURCE RESEARCH · NOT CHANGED BY CARD EDITS</div>
        <p><strong>{s.anchor.address}</strong> · BBL {s.anchor.bbl}{s.zoning ? ` · ${s.zoning}` : ''}</p>
        <dl className="dev-detail-grid"><Fact name="Anchor lot area" value={measure(s.lot_area_sf,' SF')}/>
          <Fact name={s.type === 'sandwich' ? 'Assembled new build zoning SF' : 'New build zoning SF (estimate)'} value={rangeLabel(s.buildable_sf,' SF')}/>
          {s.type === 'sandwich' && <Fact name="Anchor alone · estimated zoning SF" value={rangeLabel(s.standalone_buildable_sf,' SF')}/>}
          {s.combined_area_sf != null && s.type !== 'standalone' && <Fact name="Redevelopment lot area" value={measure(s.combined_area_sf,' SF')}/>}
          {s.combined_frontage_ft != null && s.type !== 'standalone' && <Fact name="Redevelopment frontage" value={measure(s.combined_frontage_ft,'′')}/>}
        </dl>
        {s.fit && <p><strong>Site fit:</strong> {s.fit}</p>}
        {s.air_rights && <AirRights air={s.air_rights}/>}
        {s.type === 'sandwich' && <p className="dev-caution">Assemblage estimate, not standalone yield. Acquisitions, lot merger and buildability are unconfirmed.</p>}
        {s.type === 'standalone' && <p className="dev-caution">Standalone zoning screen, not an as-of-right approval.</p>}
        {s.type === 'fallback' && <p className="dev-caution">Fallback only. Width qualifies for follow-up; yield isn’t confirmed.</p>}
        <TextList title="Sizing assumptions" items={s.assumptions}/><TextList title="Delivery & diligence" items={s.risks}/>
        <h3>Parcels and roles</h3><ul className="dev-parcels">{s.parcels.map((p) => <li key={p.bbl}>
          <span className={`dev-pill ${p.role === 'donor' ? 'dev-type-air_rights' : 'dev-neutral'}`}>{PARCEL_ROLES[p.role]}</span>
          <strong>{p.address}</strong><small>BBL {p.bbl} · {p.existing_units == null ? 'Homes unknown' : `${fmt.format(p.existing_units)} ${p.role === 'donor' ? 'retained' : 'existing'} homes`}
            {p.area_sf != null ? ` · ${measure(p.area_sf,' SF')}` : ''}{p.frontage_ft != null ? ` · ${measure(p.frontage_ft,'′')}` : ''}</small>
          {p.ownership && <p>Ownership evidence: {p.ownership}</p>}{p.geometry && <p>{p.geometry}</p>}<Sources items={p.sources}/></li>)}</ul>
        <h3>Evidence</h3>
        {s.listing.note && <p>{s.listing.note}</p>}{s.listing.status === 'not_found' && <p>No listing located in the search; that does not prove it’s off-market.</p>}
        <Sources items={[...(s.listing.source ? [s.listing.source] : []), ...s.sources]}/>
        {onDraft && <div className="dev-crm"><h3>Next step</h3><p>Open a private draft in Deal Desk. Nothing is added to Contacts or Deals until you save there.</p>
          <div className="dev-actions"><button type="button" className="dev-btn" onClick={() => draft('contacts')}>Draft contact</button><button type="button" className="dev-btn" onClick={() => draft('deals')}>Draft deal</button></div></div>}
      </div>
    </details>
  </article>;
}
function Fact({name,value}) { return <div><dt>{name}</dt><dd>{value}</dd></div>; }
function TextList({title,items}) { return items.length > 0 && <><h3>{title}</h3><ul className="dev-text-list">{items.map((x,i) => <li key={i}>{x}</li>)}</ul></>; }
function Sources({items}) {
  return items.length > 0 && <ul className="dev-sources">{items.map((s,i) => safeLink(s.url) && <li key={i}><a href={safeLink(s.url)} target="_blank" rel="noopener noreferrer">{s.label} ↗</a></li>)}</ul>;
}
function AirRights({air:a}) {
  const sensitivity = roughSensitivity(a.new_build_sf);
  return <section className="dev-air"><h3>Air-rights scenario · transfer unverified</h3>
    <dl className="dev-detail-grid">
      <Fact name="Receiver alone" value={rangeLabel(a.receiver_standalone_sf,' zoning SF')}/>
      <Fact name="Donor unused estimate" value={rangeLabel(a.donor_unused_sf,' zoning SF')}/>
      <Fact name="Plausible receiver increment" value={rangeLabel(a.receiver_increment_sf,' zoning SF')}/>
      <Fact name="New build incl. increment" value={rangeLabel(a.new_build_sf,' zoning SF')}/>
    </dl>
    <p><strong>{CERTAINTY[a.confidence]}.</strong> {sensitivity ? `${rangeLabel(sensitivity)} at 680 zoning SF per unit — arithmetic only, not approved or design yield.` : '680 SF/unit sensitivity not available without a new build estimate.'} Retained donor homes are not new homes or counted toward redevelopment occupancy.</p>
    <ul className="dev-text-list"><li><strong>Title:</strong> {a.title_risk}</li><li><strong>Zoning:</strong> {a.zoning_risk}</li><li><strong>Envelope:</strong> {a.envelope_risk}</li></ul>
  </section>;
}
function EditDialog({ entry, busy, serverError, onClose, onSave }) {
  const ref = useRef(null), [value, set] = useState(entry.values), [invalid, setInvalid] = useState('');
  useEffect(() => { const el = ref.current; el.showModal(); return () => el.close(); }, []);
  const patch = (name,v) => { set((s) => ({ ...s,[name]:v })); setInvalid(''); };
  return <dialog ref={ref} className="dev-dialog" aria-labelledby="dev-edit-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(e) => { e.preventDefault(); if (busy) return; try { onSave(cleanEdits(value)); } catch (err) { setInvalid(err.message); } }}>
      <div className="dev-kicker">PRIVATE CARD EDITS</div><h2 id="dev-edit-title">{entry.phoneOnly ? 'Contact phone' : 'Edit lead card'}</h2>
      <p>{entry.site.anchor.address} · original research won’t change.</p>
      <fieldset disabled={busy} className="dev-edit-fields">
        {!entry.phoneOnly && <><label>Working address <input value={value.address} onChange={(e) => patch('address',e.target.value)} maxLength={240}
          placeholder={entry.site.anchor.address}/></label><small>Leave blank to use the sourced address.</small>
          <label>Contact name <input value={value.contact_name} onChange={(e) => patch('contact_name',e.target.value)} maxLength={160}/></label></>}
        <label>Phone number <input type="tel" autoFocus={entry.phoneOnly} placeholder="Add a number you’ve confirmed" autoComplete="off" value={value.phone}
          onChange={(e) => patch('phone',e.target.value)} maxLength={60}/></label>
        {value.phone && <button className="dev-link dev-clear-phone" type="button" onClick={() => patch('phone','')}>Clear phone number</button>}
        {!entry.phoneOnly && <><label>Status <select aria-label="Status" value={value.status} onChange={(e) => patch('status',e.target.value)}>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label>Private note <textarea rows={4} value={value.note} onChange={(e) => patch('note',e.target.value)} maxLength={3000}/></label></>}
      </fieldset>
      {(invalid || serverError) && <p className="dev-error" role="alert">{invalid || serverError}</p>}
      <div className="dev-actions"><button className="dev-btn dev-primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save privately'}</button>
        <button className="dev-btn" disabled={busy} type="button" onClick={onClose}>Cancel</button></div>
    </form>
  </dialog>;
}
