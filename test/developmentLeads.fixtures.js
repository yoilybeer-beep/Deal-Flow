// Fabricated property labels, parcel IDs, contacts and links for local tests.
const source = { label: 'Synthetic parcel evidence', url:'https://example.test/parcel' };
const area = (min,max) => ({min,max});
const units = (min,max,certainty='screened') => ({min,max,certainty});
const parcel = (address,bbl,role='anchor',existing_units=2) => ({ address,bbl,role,existing_units,area_sf:7900,frontage_ft:79,
  ownership:'Fixture ownership label (not real)', geometry:'Synthetic shared lot line; fixture only.', sources:[source] });
const lead = (id,rank,borough,a,props) => ({ id,rank,type:'standalone',borough,anchor:{address:a.address,bbl:a.bbl}, existing_units:a.existing_units,
  frontage_ft:79,depth_ft:100,lot_area_sf:7900,zoning:'R7 (fixture)',buildable_sf:area(27800,33320),target_units:units(33,44),
  why_call:'Good frontage and low housing count in the test-only zoning screen.', fit:'Fit assessed on the modeled envelope, not full legal FAR.',
  risks:['Confirm occupancy and verify vacant delivery.'],assumptions:['Excludes special bonuses; lot geometry is illustrative.'],sources:[source],
  parcels:[a],listing:{status:'unknown'}, ...props });
export function fixtureSnapshot() {
  const a = parcel('10 Fixture Orchard Way','4000000010');
  const b = parcel('20 Fixture Receiver Lane','2000000020','anchor',4);
  const donor = parcel('22 Fixture Donor Lane','2000000022','donor',54);
  const c = parcel('30 Fixture Assembly Place','3000000030','anchor',3);
  const cleft = parcel('28 Fixture Assembly Place','3000000028','left',2);
  const cright = parcel('32 Fixture Assembly Place','3000000032','right',2);
  const d = parcel('40 Fixture Watch Point','5000000040','anchor',0);
  return { schema_version:1, generated_at:'2030-06-12', label:'Synthetic research for local QA', methodology:'Fixture-only independent screening. No real deals or people. Data is not for decision-making.',
    leads:[lead('fixture-queens',1,'Queens',a,{neighborhood:'Fixture Gardens',listing:{status:'verified_listed',ask_usd:2350000,
      checked_at:'2030-06-12',source:{label:'Synthetic asking-price evidence',url:'https://example.test/listing'},note:'For test purposes only.'}}),
    lead('fixture-rights',2,'Bronx',b,{type:'air_rights', parcels:[b,donor], buildable_sf:area(168640,217600), target_units:units(241,305,'concept'),
      why_call:'Receiver could support a larger plan if the donor’s unused rights can legally transfer and fit the receiving envelope.',
      air_rights:{transfer_verified:false,receiver_standalone_sf:area(135320,149600),donor_unused_sf:area(61200,81600), receiver_increment_sf:area(33320,68000),
        new_build_sf:area(168640,217600),confidence:'concept',title_risk:'Bilateral control and no prior transfer not verified.',zoning_risk:'Verify common zoning lot and any district limits.',envelope_risk:'Model the plausible receiver increment on the survey.'}}),
    lead('fixture-sandwich',3,'Brooklyn',c,{type:'sandwich',existing_units:7,parcels:[c,cleft,cright],combined_area_sf:23700,combined_frontage_ft:237,
      buildable_sf:area(72000,100000),target_units:units(88,130),listing:{status:'not_found',checked_at:'2030-06-12'}}),
    lead('fixture-fallback',4,'Staten Island',d,{type:'fallback',parcels:[d],buildable_sf:null,target_units:null,
      why_call:'79′ frontage may support a neighboring acquisition; survey and zoning diligence required.'})] };
}
