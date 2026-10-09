const EUROPE_CODES = new Set([
  "AL","AD","AT","BY","BE","BA","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR",
  "HU","IS","IE","IT","LV","LI","LT","LU","MT","MD","MC","ME","NL","MK","NO","PL",
  "PT","RO","SM","RS","SK","SI","ES","SE","CH","UA","GB","VA"
]);

const EUROPE_TERMS = [
  "Europe","European","EMEA","United Kingdom","UK","England","Scotland","Wales","Ireland",
  "France","Germany","Spain","Portugal","Italy","Netherlands","Belgium","Switzerland",
  "Austria","Poland","Czech","Czechia","Slovakia","Hungary","Romania","Bulgaria","Greece",
  "Sweden","Norway","Denmark","Finland","Iceland","Estonia","Latvia","Lithuania","Croatia",
  "Slovenia","Serbia","Bosnia","Montenegro","Albania","North Macedonia","Cyprus","Malta",
  "Luxembourg","Ukraine","Moldova","Belarus","London","Paris","Berlin","Munich","Frankfurt",
  "Amsterdam","Dublin","Madrid","Barcelona","Lisbon","Rome","Milan","Zurich","Vienna",
  "Prague","Warsaw","Brussels","Stockholm","Copenhagen","Oslo","Helsinki","Budapest",
  "Bucharest","Athens"
];

const US_STATES: Record<string,string> = {
  Alabama:"AL", Alaska:"AK", Arizona:"AZ", Arkansas:"AR", California:"CA", Colorado:"CO",
  Connecticut:"CT", Delaware:"DE", Florida:"FL", Georgia:"GA", Hawaii:"HI", Idaho:"ID",
  Illinois:"IL", Indiana:"IN", Iowa:"IA", Kansas:"KS", Kentucky:"KY", Louisiana:"LA",
  Maine:"ME", Maryland:"MD", Massachusetts:"MA", Michigan:"MI", Minnesota:"MN",
  Mississippi:"MS", Missouri:"MO", Montana:"MT", Nebraska:"NE", Nevada:"NV",
  "New Hampshire":"NH", "New Jersey":"NJ", "New Mexico":"NM", "New York":"NY",
  "North Carolina":"NC", "North Dakota":"ND", Ohio:"OH", Oklahoma:"OK", Oregon:"OR",
  Pennsylvania:"PA", "Rhode Island":"RI", "South Carolina":"SC", "South Dakota":"SD",
  Tennessee:"TN", Texas:"TX", Utah:"UT", Vermont:"VT", Virginia:"VA", Washington:"WA",
  "West Virginia":"WV", Wisconsin:"WI", Wyoming:"WY"
};

const US_TERMS = [
  "United States","United States of America","USA","U.S.","Remote (US)","US Remote","North America",
  ...Object.entries(US_STATES).flatMap(([name,abbr]) => [name, `, ${abbr}`]),
  "Washington, DC","Washington DC","District of Columbia"
];

const COUNTRY_TERMS: Record<string,string[]> = {
  NG:["Nigeria","Lagos","Abuja","Port Harcourt","Ibadan","Kano"],
  KE:["Kenya","Nairobi","Mombasa","Kisumu","Nakuru"],
  CA:["Canada","Toronto","Vancouver","Montreal","Calgary","Ottawa"],
  AU:["Australia","Sydney","Melbourne","Brisbane","Perth","Adelaide"],
  IN:["India","Bengaluru","Bangalore","Mumbai","Delhi","New Delhi","Hyderabad","Pune","Chennai"],
  ZA:["South Africa","Johannesburg","Cape Town","Pretoria","Durban"],
  GH:["Ghana","Accra","Kumasi"],
  AE:["United Arab Emirates","UAE","Dubai","Abu Dhabi"],
  QA:["Qatar","Doha"],
  SA:["Saudi Arabia","Riyadh","Jeddah"],
  SG:["Singapore"],
  JP:["Japan","Tokyo","Osaka"],
  KR:["South Korea","Seoul"],
  BR:["Brazil","São Paulo","Sao Paulo","Rio de Janeiro"],
  MX:["Mexico","Mexico City","Ciudad de México"],
};

export type JobMarket = {
  key: string;
  label: string;
  countryCode: string | null;
  terms: string[];
};

export type ExplicitLocation = {
  label: string;
  terms: string[];
};

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

export function marketForCountry(countryCode: string | null | undefined): JobMarket | null {
  const code = countryCode?.trim().toUpperCase();
  if (!code) return null;

  if (code === "US") return { key:"US", label:"United States", countryCode:"US", terms:US_TERMS };
  if (EUROPE_CODES.has(code)) return { key:"EUROPE", label:"Europe", countryCode:code, terms:EUROPE_TERMS };

  const label = countryName(code);
  return {
    key: code,
    label,
    countryCode: code,
    terms: COUNTRY_TERMS[code] ?? [label],
  };
}

export function marketFromLocationInput(value: string | null | undefined): JobMarket | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;

  if (["us","usa","u.s.","united states","united states of america"].includes(normalized)) {
    return marketForCountry("US");
  }
  if (["europe","eu","european union","emea"].includes(normalized)) {
    return { key:"EUROPE", label:"Europe", countryCode:null, terms:EUROPE_TERMS };
  }

  for (const code of Object.keys(COUNTRY_TERMS)) {
    const market = marketForCountry(code);
    if (market && market.label.toLowerCase() === normalized) return market;
  }

  return null;
}

export function resolveExplicitLocation(value: string | null | undefined): ExplicitLocation | null {
  const raw = value?.trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();

  const market = marketFromLocationInput(raw);
  if (market) return { label: market.label, terms: market.terms };

  if (["dc","d.c.","washington dc","washington, dc","district of columbia"].includes(normalized)) {
    return {
      label:"Washington, DC",
      terms:["Washington, DC","Washington DC","District of Columbia",", DC"]
    };
  }

  for (const [state, abbr] of Object.entries(US_STATES)) {
    if (normalized === state.toLowerCase() || normalized === abbr.toLowerCase()) {
      return { label: state, terms:[state, `, ${abbr}`] };
    }
  }

  const cityAliases: Record<string,string[]> = {
    london:["London"],
    lagos:["Lagos"],
    abuja:["Abuja"],
    nairobi:["Nairobi"],
    mombasa:["Mombasa"],
    paris:["Paris"],
    berlin:["Berlin"],
    dublin:["Dublin"],
    toronto:["Toronto"],
    vancouver:["Vancouver"],
    dubai:["Dubai"],
    doha:["Doha"],
    "new york":["New York"],
    "san francisco":["San Francisco"],
    austin:["Austin"],
    houston:["Houston"],
    dallas:["Dallas"],
    chicago:["Chicago"],
    boston:["Boston"],
    seattle:["Seattle"],
    atlanta:["Atlanta"],
    miami:["Miami"]
  };

  return {
    label: raw,
    terms: cityAliases[normalized] ?? [raw],
  };
}

export function locationMatchesTerms(location: string | null, terms: string[]): boolean {
  if (!location) return false;
  const normalized = location.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

export function jobMatchesMarket(location: string | null, market: JobMarket | null): boolean {
  if (!market) return true;
  return locationMatchesTerms(location, market.terms);
}
