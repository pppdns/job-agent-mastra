import { normalizeText } from "./posting";

// Whether a place named in a listing ("Remote (US)", "EMEA", "Berlin, Germany") includes where
// the person lives (`Home`, a structured preference). Fixed tables, not a model: names the
// tables don't know stay "unknown", never a guess.

/** How sure we are that the person may work on the job from home, best first. */
export const ELIGIBILITY = ["open", "likely_open", "unclear", "likely_closed", "closed"] as const;
export type Eligibility = (typeof ELIGIBILITY)[number];

export type PlaceMatch = "covers" | "excludes" | "unknown";

/** Where the person lives. */
export type Home = { city: string; country: string };

/** Names that include every place. */
const GLOBAL = new Set([
  "worldwide",
  "anywhere",
  "anywhere in the world",
  "global",
  "globally",
  "international",
  "any location",
  "any country",
  "all countries",
  "all locations",
]);

/** Country aliases → one canonical name. */
const COUNTRY_ALIASES: Record<string, string> = {
  us: "united states",
  usa: "united states",
  "u s": "united states",
  "u s a": "united states",
  "united states of america": "united states",
  america: "united states",
  "us only": "united states",
  uk: "united kingdom",
  "u k": "united kingdom",
  "great britain": "united kingdom",
  britain: "united kingdom",
  england: "united kingdom",
  scotland: "united kingdom",
  wales: "united kingdom",
  "northern ireland": "united kingdom",
  "the netherlands": "netherlands",
  holland: "netherlands",
  "czech republic": "czechia",
  uae: "united arab emirates",
  turkiye: "turkey",
  macedonia: "north macedonia",
  korea: "south korea",
  magyarorszag: "hungary",
  deutschland: "germany",
};

const EU = [
  "austria",
  "belgium",
  "bulgaria",
  "croatia",
  "cyprus",
  "czechia",
  "denmark",
  "estonia",
  "finland",
  "france",
  "germany",
  "greece",
  "hungary",
  "ireland",
  "italy",
  "latvia",
  "lithuania",
  "luxembourg",
  "malta",
  "netherlands",
  "poland",
  "portugal",
  "romania",
  "slovakia",
  "slovenia",
  "spain",
  "sweden",
];
const EUROPE = [
  ...EU,
  "norway",
  "iceland",
  "liechtenstein",
  "switzerland",
  "united kingdom",
  "albania",
  "andorra",
  "belarus",
  "bosnia and herzegovina",
  "kosovo",
  "moldova",
  "monaco",
  "montenegro",
  "north macedonia",
  "san marino",
  "serbia",
  "ukraine",
];
const CEE = [
  "hungary",
  "poland",
  "czechia",
  "slovakia",
  "slovenia",
  "croatia",
  "romania",
  "bulgaria",
  "serbia",
  "estonia",
  "latvia",
  "lithuania",
  "ukraine",
  "moldova",
  "bosnia and herzegovina",
  "montenegro",
  "north macedonia",
  "albania",
  "kosovo",
  "austria",
];
/** Countries on Central European Time (CET / CEST). */
const CET = EUROPE.filter(
  (c) =>
    ![
      "united kingdom",
      "ireland",
      "portugal",
      "iceland",
      "finland",
      "estonia",
      "latvia",
      "lithuania",
      "romania",
      "bulgaria",
      "greece",
      "cyprus",
      "ukraine",
      "moldova",
      "belarus",
    ].includes(c),
);
const LATAM = [
  "mexico",
  "argentina",
  "bolivia",
  "brazil",
  "chile",
  "colombia",
  "costa rica",
  "cuba",
  "dominican republic",
  "ecuador",
  "el salvador",
  "guatemala",
  "honduras",
  "nicaragua",
  "panama",
  "paraguay",
  "peru",
  "uruguay",
  "venezuela",
];
const APAC = [
  "australia",
  "new zealand",
  "china",
  "hong kong",
  "india",
  "indonesia",
  "japan",
  "south korea",
  "malaysia",
  "philippines",
  "singapore",
  "taiwan",
  "thailand",
  "vietnam",
  "pakistan",
  "bangladesh",
  "sri lanka",
];
const MIDDLE_EAST = [
  "united arab emirates",
  "saudi arabia",
  "qatar",
  "bahrain",
  "kuwait",
  "oman",
  "israel",
  "jordan",
  "lebanon",
  "egypt",
  "turkey",
  "iran",
  "iraq",
];
const AFRICA = [
  "south africa",
  "nigeria",
  "kenya",
  "egypt",
  "morocco",
  "ghana",
  "ethiopia",
  "tunisia",
  "algeria",
  "rwanda",
  "uganda",
  "tanzania",
  "senegal",
];

/** Region names → the countries they include. */
const REGIONS: [string[], string[]][] = [
  [
    [
      "europe",
      "european",
      "european countries",
      "european time zones",
      "european timezones",
      "european time",
    ],
    EUROPE,
  ],
  [
    ["european union", "eu", "eea", "european economic area"],
    [...EU, "norway", "iceland"],
  ],
  [
    ["emea", "europe middle east and africa"],
    [...EUROPE, ...MIDDLE_EAST, ...AFRICA],
  ],
  [
    [
      "central europe",
      "central european",
      "eastern europe",
      "eastern european",
      "central and eastern europe",
      "central eastern europe",
      "cee",
    ],
    CEE,
  ],
  [["cet", "cest", "central european time"], CET],
  [
    ["western europe"],
    [
      "france",
      "belgium",
      "netherlands",
      "luxembourg",
      "ireland",
      "united kingdom",
      "germany",
      "austria",
      "switzerland",
      "spain",
      "portugal",
      "italy",
    ],
  ],
  [["dach"], ["germany", "austria", "switzerland"]],
  [
    ["nordics", "nordic countries", "scandinavia"],
    ["denmark", "sweden", "norway", "finland", "iceland"],
  ],
  [["benelux"], ["belgium", "netherlands", "luxembourg"]],
  [
    ["baltics", "baltic states"],
    ["estonia", "latvia", "lithuania"],
  ],
  [["iberia"], ["spain", "portugal"]],
  [
    ["uk and ireland", "uk i"],
    ["united kingdom", "ireland"],
  ],
  [["north america"], ["united states", "canada", "mexico"]],
  [
    ["americas", "the americas"],
    ["united states", "canada", ...LATAM],
  ],
  [["latam", "latin america", "south america", "central america", "caribbean"], LATAM],
  [["apac", "asia", "asia pacific", "anz", "oceania"], APAC],
  [["middle east", "mena", "gcc"], MIDDLE_EAST],
  [["africa"], AFRICA],
];

const OTHER_COUNTRIES =
  "afghanistan|angola|anguilla|antigua and barbuda|armenia|aruba|azerbaijan|bahamas|barbados|belize|benin|bermuda|bhutan|botswana|brunei|burkina faso|cambodia|cameroon|canada|cape verde|cayman islands|curacao|dominica|fiji|georgia|grenada|guyana|haiti|jamaica|kazakhstan|kyrgyzstan|laos|macau|madagascar|maldives|mauritius|mongolia|mozambique|myanmar|namibia|nepal|russia|saint lucia|suriname|trinidad and tobago|uzbekistan|zambia|zimbabwe|united states".split(
    "|",
  );
const COUNTRIES = new Set([
  ...EUROPE,
  ...LATAM,
  ...APAC,
  ...MIDDLE_EAST,
  ...AFRICA,
  ...OTHER_COUNTRIES,
]);

const US_STATES = [
  ..."alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada ohio oklahoma oregon pennsylvania tennessee texas utah vermont virginia washington wisconsin wyoming".split(
    " ",
  ),
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "rhode island",
  "south carolina",
  "south dakota",
  "west virginia",
  "district of columbia",
  "washington dc",
  "washington d c",
  "puerto rico",
];
/** Two-letter state codes, only as a trailing part ("Austin, TX"). */
const US_STATE_CODES = new Set(
  "al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc".split(
    " ",
  ),
);

/** Large cities that listings often name without a country → their country. */
const CITIES: Record<string, string> = Object.fromEntries(
  (
    [
      [
        "united states",
        "new york city|nyc|san francisco|sf|bay area|san francisco bay area|los angeles|seattle|boston|austin|chicago|denver|atlanta|miami|dallas|houston",
      ],
      ["canada", "toronto|vancouver|montreal"],
      ["united kingdom", "london|edinburgh|manchester|cambridge|oxford"],
      ["ireland", "dublin"],
      ["france", "paris"],
      ["germany", "berlin|munich|hamburg"],
      ["netherlands", "amsterdam"],
      ["spain", "madrid|barcelona"],
      ["portugal", "lisbon|porto"],
      ["italy", "milan|rome"],
      ["austria", "vienna"],
      ["switzerland", "zurich|geneva"],
      ["sweden", "stockholm"],
      ["denmark", "copenhagen"],
      ["norway", "oslo"],
      ["finland", "helsinki"],
      ["poland", "warsaw|krakow"],
      ["czechia", "prague|brno"],
      ["slovakia", "bratislava"],
      ["romania", "bucharest"],
      ["bulgaria", "sofia"],
      ["serbia", "belgrade"],
      ["croatia", "zagreb"],
      ["greece", "athens"],
      ["slovenia", "ljubljana"],
      ["estonia", "tallinn"],
      ["latvia", "riga"],
      ["lithuania", "vilnius"],
      ["ukraine", "kyiv"],
      ["hungary", "budapest"],
      ["israel", "tel aviv"],
      ["india", "bangalore|bengaluru|hyderabad|pune|mumbai|delhi"],
      ["singapore", "singapore"],
      ["australia", "sydney|melbourne"],
      ["japan", "tokyo"],
      ["south korea", "seoul"],
      ["brazil", "sao paulo"],
      ["mexico", "mexico city"],
      ["argentina", "buenos aires"],
      ["colombia", "bogota"],
      ["south africa", "cape town"],
      ["united arab emirates", "dubai"],
    ] as const
  ).flatMap(([country, cities]) => cities.split("|").map((c) => [c, country])),
);

/** Towns in commuting reach of a home city (normalized names). */
const NEARBY: Record<string, string[]> = {
  budapest: [
    "pest",
    "pest county",
    "pest megye",
    "torokbalint",
    "budaors",
    "erd",
    "godollo",
    "vac",
    "szentendre",
    "dunakeszi",
    "fot",
    "gyal",
    "vecses",
    "szigetszentmiklos",
    "pilisvorosvar",
    "biatorbagy",
    "budakeszi",
    "kerepes",
    "kistarcsa",
    "veresegyhaz",
    "monor",
    "csomor",
  ],
};

/** Words around a place that don't change it ("Remote (US only)", "based in the UK"). */
const FILLER =
  /\b(?:fully |100 )?remote\b|\bonly\b|\bbased\b|\bwithin\b|\bthe\b|\bin\b|\bfrom\b|\bacross\b|\bresidents?\b|\bcandidates?\b|\bapplicants?\b|\blocated\b|\bhybrid\b|\bon ?site\b|\boffice\b|\bany ?where in\b|\banother\b|\bany\b|\blarge\b|\bcountry\b|\bcountries\b|\bcity\b|\bcities\b|\bregion\b|\bpreferred\b|\btime ?zones?\b/g;

const country = (name: string) => COUNTRY_ALIASES[name] ?? name;

/** Countries a known name stands for (a country, a city's country, or a region's members). */
function countriesOf(name: string): string[] | undefined {
  const c = country(name);
  if (COUNTRIES.has(c)) return [c];
  if (CITIES[name]) return [CITIES[name]];
  if (US_STATES.includes(name)) return ["united states"];
  return REGIONS.find(([names]) => names.includes(name))?.[1];
}

function classifyName(name: string, home: Home, trailing: boolean): PlaceMatch | undefined {
  if (!name) return undefined;
  if (GLOBAL.has(name)) return "covers";
  const homeCountry = country(normalizeText(home.country));
  if (name === normalizeText(home.city)) return "covers";
  const countries =
    countriesOf(name) ?? (trailing && US_STATE_CODES.has(name) ? ["united states"] : undefined);
  if (countries) return countries.includes(homeCountry) ? "covers" : "excludes";
  // "another Eastern European country", "any large European city": Europe, unless named above.
  if (/\beurop(?:e|ean)\b/.test(name)) return EUROPE.includes(homeCountry) ? "covers" : "excludes";
  return undefined;
}

function classifyPart(raw: string, home: Home, trailing: boolean): PlaceMatch {
  const full = normalizeText(raw);
  if (!full) return "unknown";
  const direct = classifyName(full, home, false);
  if (direct) return direct;
  const part = full.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  if (!part) return /\bany ?where\b|\bworldwide\b/.test(full) ? "covers" : "unknown";
  return classifyName(part, home, trailing) ?? "unknown";
}

/**
 * Whether a place string includes home. Lists ("US, Canada") and hierarchies ("Austin, TX,
 * United States") both split into parts; unknown parts are ignored when another part is known.
 */
export function matchPlace(place: string, home: Home): PlaceMatch {
  const parts = place
    .split(/[,;/|()•·]|\s+(?:and|or|&|\+)\s+|\s+-\s+|\s+–\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "unknown";
  const results = parts.map((p, i) => classifyPart(p, home, i === parts.length - 1 && i > 0));
  if (results.includes("covers")) return "covers";
  if (results.includes("excludes")) return "excludes";
  return classifyPart(place, home, false);
}

/** Several places together: any that covers home wins; else any known other place excludes. */
export function matchPlaces(places: readonly string[], home: Home): PlaceMatch {
  const results = places.map((p) => matchPlace(p, home));
  if (results.includes("covers")) return "covers";
  return results.includes("excludes") ? "excludes" : "unknown";
}

/**
 * Whether an office place is in commuting reach of home: the home city or a nearby town covers;
 * another named town in the home country, or any known place abroad, excludes; the home country
 * alone is unknown.
 */
export function matchCommute(place: string, home: Home): PlaceMatch {
  const text = normalizeText(place);
  const city = normalizeText(home.city);
  const near = [city, ...(NEARBY[city] ?? [])].filter(Boolean);
  if (near.some((n) => new RegExp(`\\b${n}\\b`).test(text))) return "covers";
  const homeCountry = country(normalizeText(home.country));
  const names = [
    homeCountry,
    ...Object.keys(COUNTRY_ALIASES).filter((a) => COUNTRY_ALIASES[a] === homeCountry),
  ];
  const named = names.find((n) => new RegExp(`\\b${n}\\b`).test(text));
  if (named) {
    const rest = names
      .reduce((t, n) => t.replace(new RegExp(`\\b${n}\\b`, "g"), " "), text)
      .replace(FILLER, " ")
      .trim();
    return rest ? "excludes" : "unknown";
  }
  return matchPlace(place, home) === "excludes" ? "excludes" : "unknown";
}

/** Several office places: any in commuting reach covers; else any known other place excludes. */
export function matchCommutes(places: readonly string[], home: Home): PlaceMatch {
  const results = places.map((p) => matchCommute(p, home));
  if (results.includes("covers")) return "covers";
  return results.includes("excludes") ? "excludes" : "unknown";
}
