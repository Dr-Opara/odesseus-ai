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

const US_TERMS = [
  "United States","United States of America","USA","U.S.","Remote (US)","US Remote","North America",
  "New York","San Francisco","Los Angeles","Chicago","Boston","Seattle","Austin","Houston","Dallas",
  "Atlanta","Miami","Denver","Phoenix","Philadelphia","Washington, DC","Washington DC","Portland",
  "San Diego","San Jose","Bentonville","California","Texas","Florida","Virginia","Maryland",
  "Massachusetts","Illinois","Washington","Colorado","Arizona","Georgia","North Carolina",
  "South Carolina","Ohio","Pennsylvania","New Jersey","Connecticut","Minnesota","Michigan",
  "Tennessee","Missouri","Wisconsin","Oregon","Nevada","Utah","Indiana","Kentucky","Alabama",
  "Arkansas","Iowa","Kansas","Louisiana","Maine","Mississippi","Montana","Nebraska","New Hampshire",
  "New Mexico","North Dakota","Oklahoma","Rhode Island","South Dakota","Vermont","West Virginia",
  "Wyoming","Idaho","Delaware","Hawaii","Alaska"
];

const COUNTRY_TERMS: Record<string,string[]> = {
  NG:["Nigeria","Lagos","Abuja","Port Harcourt"],
  KE:["Kenya","Nairobi","Mombasa"],
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
    if (market && market.terms.some((term) => term.toLowerCase() === normalized)) return market;
  }

  return null;
}

export function jobMatchesMarket(location: string | null, market: JobMarket | null): boolean {
  if (!market) return true;
  if (!location) return false;
  const normalized = location.toLowerCase();
  return market.terms.some((term) => normalized.includes(term.toLowerCase()));
}
