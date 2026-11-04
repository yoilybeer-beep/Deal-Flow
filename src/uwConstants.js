/* Deal Desk underwriting — defaults and published tables in one place.
   Update these once a year (HPD publishes new rents each spring). Every value is
   only a default: the model stores its own copy and every field stays editable. */

/* HPD "2025 New York City Area Affordable Monthly Rents" — maximum rent by % of AMI
   (nyc.gov/site/hpd/services-and-information/area-median-income.page). Specific rents
   and utility allowances vary by program / term sheet; every rent stays editable. */
export const HPD_RENT_YEAR = 2025;
export const HPD_RENT_LABEL = "HPD 2025 max gross rent";
export const HPD_RENT_SRC = "HPD 2025 max gross rent — \"2025 New York City Area Affordable Monthly Rents\", nyc.gov/hpd (Area Median Income page); program rents and utility allowances may differ";
export const HPD_RENTS = {
  30:  { studio: 850,  "1br": 911,  "2br": 1093, "3br": 1263 },
  40:  { studio: 1134, "1br": 1215, "2br": 1458, "3br": 1685 },
  50:  { studio: 1417, "1br": 1518, "2br": 1822, "3br": 2106 },
  60:  { studio: 1701, "1br": 1822, "2br": 2187, "3br": 2527 },
  70:  { studio: 1984, "1br": 2126, "2br": 2551, "3br": 2948 },
  80:  { studio: 2268, "1br": 2430, "2br": 2916, "3br": 3370 },
  90:  { studio: 2552, "1br": 2733, "2br": 3281, "3br": 3791 },
  100: { studio: 2835, "1br": 3037, "2br": 3645, "3br": 4212 },
  110: { studio: 3119, "1br": 3341, "2br": 4010, "3br": 4633 },
  120: { studio: 3402, "1br": 3644, "2br": 4374, "3br": 5054 },
  130: { studio: 3685, "1br": 3948, "2br": 4738, "3br": 5476 },
  165: { studio: 4678, "1br": 5011, "2br": 6014, "3br": 6950 },
};

/* Default deduction from HPD max gross rent, $/mo per unit type (J Realty Group's basis).
   At 60% AMI this gives net rents Studio 1383 / 1BR 1744 / 2BR 2070 / 3BR 2371; other AMI
   tiers use HPD max minus the same deduction. Editable per model. */
export const DEFAULT_AMI = 60;
export const RENT_DEDUCTION_LABEL = "Deduction (your basis)";
export const RENT_DEDUCTION = { studio: 318, "1br": 78, "2br": 117, "3br": 156 };

/* Set-aside rules (editable in the model; verify against the current rules before circulating) */
export const PROGRAMS = {
  market: { mode: "none", pct: 0, ami: 60, avg: null, label: "Free market — no affordable set-aside." },
  "485x": { mode: "units", pct: 20, ami: 80, avg: 80,
    label: "485-x (HPD): 6–99 units → 20% of units at avg 80% AMI; 100+ units → 25% at avg 80% AMI; max 3 bands, none over 100% AMI." },
  uap:  { mode: "uap", pct: 0, ami: 60, avg: 60,
    label: "UAP (ZR §27 / HPD 2025): the bonus floor area is permanently affordable at a weighted avg 60% AMI; max 3 bands, none over 100%; if 10,000+ SF affordable, 20% of it at ≤40% AMI." },
  mih:  { mode: "sf", pct: 25, ami: 60, avg: 60,
    label: "MIH Option 1 (DCP): 25% of residential floor area at avg 60% AMI (10% at 40% AMI)." },
};

/* Cost defaults by borough — hard $/gross SF and soft % of hard. Bronx = J Realty Group's standard ($230 hard, soft 15% of hard); other boroughs are starting points. */
export const BORO_COSTS = {
  Bronx: { hard: 230, soft: 15 },
  Brooklyn: { hard: 275, soft: 15 },
  Queens: { hard: 260, soft: 15 },
  Manhattan: { hard: 325, soft: 15 },
  "Staten Island": { hard: 240, soft: 15 },
};
export const DEFAULT_COSTS = { hard: 275, soft: 15 };

export const UNIT_SF = { studio: 400, "1br": 575, "2br": 800, "3br": 950 };
export const MKT_RENTS = { studio: 2600, "1br": 3200, "2br": 4200, "3br": 5200 };
