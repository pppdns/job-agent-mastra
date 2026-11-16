import { normalizeText } from "./posting";

// Whether a place named in a listing ("Remote (US)", "EMEA", "Berlin, Germany") includes where
// the person lives. A fixed table, not a model: unknown names stay "unknown", never a guess.
// Home is Budapest, Hungary for now (it becomes a structured preference later).

/** How sure we are that the person may work on the job from home, best first. */
export const ELIGIBILITY = ["open", "likely_open", "unclear", "likely_closed", "closed"] as const;
export type Eligibility = (typeof ELIGIBILITY)[number];

export type PlaceMatch = "covers" | "excludes" | "unknown";

/** Names that include Budapest, Hungary. */
const COVERS = [
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
  "europe",
  "european union",
  "eu",
  "eea",
  "emea",
  "europe middle east and africa",
  "cet",
  "cest",
  "central europe",
  "central european",
  "central european time",
  "eastern europe",
  "central and eastern europe",
  "cee",
  "european time zones",
  "european timezones",
  "hungary",
  "budapest",
];

/** Regions that don't include Hungary. */
const OTHER_REGIONS = [
  "north america",
  "americas",
  "the americas",
  "latam",
  "latin america",
  "south america",
  "central america",
  "caribbean",
  "apac",
  "asia",
  "asia pacific",
  "oceania",
  "africa",
  "middle east",
  "mena",
  "gcc",
  "dach",
  "nordics",
  "nordic countries",
  "scandinavia",
  "benelux",
  "baltics",
  "iberia",
  "western europe",
  "uk and ireland",
  "uk i",
  "anz",
  "us",
  "usa",
  "u s",
  "u s a",
  "united states",
  "united states of america",
  "america",
  "us only",
  "uk",
  "u k",
  "united kingdom",
  "great britain",
  "britain",
  "england",
  "scotland",
  "wales",
  "northern ireland",
];

const US_STATES =
  "alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada ohio oklahoma oregon pennsylvania tennessee texas utah vermont virginia washington wisconsin wyoming".split(
    " ",
  );
const US_MULTI = [
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

/** Countries other than Hungary (English names and common short forms). */
const COUNTRIES =
  "afghanistan|albania|algeria|andorra|angola|anguilla|antigua and barbuda|argentina|armenia|aruba|australia|austria|azerbaijan|bahamas|bahrain|bangladesh|barbados|belarus|belgium|belize|benin|bermuda|bhutan|bolivia|bosnia and herzegovina|botswana|brazil|brunei|bulgaria|burkina faso|cambodia|cameroon|canada|cape verde|cayman islands|chile|china|colombia|costa rica|croatia|cuba|curacao|cyprus|czechia|czech republic|denmark|dominica|dominican republic|ecuador|egypt|el salvador|estonia|ethiopia|fiji|finland|france|georgia|germany|ghana|greece|grenada|guatemala|guyana|haiti|honduras|hong kong|iceland|india|indonesia|iran|iraq|ireland|israel|italy|jamaica|japan|jordan|kazakhstan|kenya|korea|south korea|kosovo|kuwait|kyrgyzstan|laos|latvia|lebanon|liechtenstein|lithuania|luxembourg|macau|madagascar|malaysia|maldives|malta|mauritius|mexico|moldova|monaco|mongolia|montenegro|morocco|mozambique|myanmar|namibia|nepal|netherlands|the netherlands|new zealand|nicaragua|nigeria|north macedonia|macedonia|norway|oman|pakistan|panama|paraguay|peru|philippines|poland|portugal|qatar|romania|russia|rwanda|saint lucia|san marino|saudi arabia|senegal|serbia|singapore|slovakia|slovenia|south africa|spain|sri lanka|suriname|sweden|switzerland|taiwan|tanzania|thailand|trinidad and tobago|tunisia|turkey|turkiye|uganda|ukraine|united arab emirates|uae|uruguay|uzbekistan|venezuela|vietnam|zambia|zimbabwe".split(
    "|",
  );

/** Large cities outside Hungary that listings often name without a country. */
const CITIES =
  "new york city|nyc|san francisco|sf|bay area|san francisco bay area|los angeles|seattle|boston|austin|chicago|denver|atlanta|miami|dallas|houston|toronto|vancouver|montreal|london|dublin|paris|berlin|munich|hamburg|amsterdam|madrid|barcelona|lisbon|porto|milan|rome|vienna|zurich|geneva|stockholm|copenhagen|oslo|helsinki|warsaw|krakow|prague|bucharest|sofia|belgrade|zagreb|athens|tel aviv|bangalore|bengaluru|hyderabad|pune|mumbai|delhi|singapore|sydney|melbourne|tokyo|seoul|sao paulo|mexico city|buenos aires|bogota|cape town|dubai|bratislava|brno|kyiv|tallinn|riga|vilnius|ljubljana|edinburgh|manchester|cambridge|oxford".split(
    "|",
  );

const COVERS_SET = new Set(COVERS);
const OTHER_SET = new Set([...OTHER_REGIONS, ...US_STATES, ...US_MULTI, ...COUNTRIES, ...CITIES]);

/** Words around a place that don't change it ("Remote (US only)", "based in the UK"). */
const FILLER =
  /\b(?:fully |100 )?remote\b|\bonly\b|\bbased\b|\bwithin\b|\bthe\b|\bin\b|\bfrom\b|\bacross\b|\bresidents?\b|\bcandidates?\b|\bapplicants?\b|\blocated\b|\bhybrid\b|\bon ?site\b|\boffice\b|\bany ?where in\b|\bcountry\b|\bregion\b|\bpreferred\b|\btime ?zones?\b/g;

function classifyPart(raw: string, trailing: boolean): PlaceMatch {
  const full = normalizeText(raw);
  if (!full) return "unknown";
  if (COVERS_SET.has(full)) return "covers";
  if (OTHER_SET.has(full)) return "excludes";
  const part = full.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  if (!part) return /\bany ?where\b|\bworldwide\b/.test(full) ? "covers" : "unknown";
  if (COVERS_SET.has(part)) return "covers";
  if (OTHER_SET.has(part)) return "excludes";
  if (trailing && US_STATE_CODES.has(part)) return "excludes";
  // "another Eastern European country", "any large European city": Europe unless a named subregion.
  if (/\beurop(?:e|ean)\b/.test(part)) return "covers";
  return "unknown";
}

/**
 * Whether a place string includes Budapest. Lists ("US, Canada") and hierarchies ("Austin, TX,
 * United States") both split into parts; unknown parts are ignored when another part is known.
 */
export function matchPlace(place: string): PlaceMatch {
  const parts = place
    .split(/[,;/|()•·]|\s+(?:and|or|&|\+)\s+|\s+-\s+|\s+–\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "unknown";
  const results = parts.map((p, i) => classifyPart(p, i === parts.length - 1 && i > 0));
  if (results.includes("covers")) return "covers";
  if (results.includes("excludes")) return "excludes";
  return classifyPart(place, false);
}

/** Budapest and the towns around it: in commuting reach for office work. */
const COMMUTE =
  /\b(?:budapest|pest county|pest megye|torokbalint|budaors|erd|godollo|vac|szentendre|dunakeszi|fot|gyal|vecses|szigetszentmiklos|pilisvorosvar|biatorbagy|budakeszi|kerepes|kistarcsa|veresegyhaz|monor)\b/;

/**
 * Whether an office place is in commuting reach of Budapest: Budapest or a nearby town covers;
 * another named town in Hungary, or any known place abroad, excludes; "Hungary" alone is unknown.
 */
export function matchCommute(place: string): PlaceMatch {
  const text = normalizeText(place);
  if (COMMUTE.test(text) || /\bpest\b/.test(text)) return "covers";
  const parts = text
    .split(/\s{2,}/)
    .join(" ")
    .replace(/\b(?:hungary|magyarorszag)\b/g, "|")
    .split("|")
    .map((p) => p.replace(FILLER, " ").trim())
    .filter(Boolean);
  if (/\b(?:hungary|magyarorszag)\b/.test(text)) return parts.length > 0 ? "excludes" : "unknown";
  return matchPlace(place) === "excludes" ? "excludes" : "unknown";
}

/** Several places together: any that covers home wins; else any known other place excludes. */
export function matchPlaces(places: readonly string[]): PlaceMatch {
  const results = places.map(matchPlace);
  if (results.includes("covers")) return "covers";
  return results.includes("excludes") ? "excludes" : "unknown";
}
