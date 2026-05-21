/**
 * flights.js — API de recherche de vols en temps réel via SerpApi Google Flights
 *
 * Endpoints exposés :
 *   GET /flights/search?from=Paris&to=Londres&date=2026-06-10&return_date=2026-06-15&adults=2&currency=EUR
 *   GET /flights/airports?q=Paris    → autocomplétion aéroports
 *
 * La clé SerpApi est lue depuis process.env.SERPAPI_KEY (déjà configurée pour les hôtels).
 */

const express = require("express");
const axios   = require("axios");
const router  = express.Router();

const SERPAPI_KEY = process.env.SERPAPI_KEY;

// ─── Cache mémoire 10 min ─────────────────────────────────────────────────────
const cache = {};
function cached(key, fn, ttl = 2 * 60 * 1000) { // 2 min pour les vols (prix en temps réel)
  if (cache[key] && Date.now() - cache[key].ts < ttl) return Promise.resolve(cache[key].data);
  return fn().then(d => { cache[key] = { data: d, ts: Date.now() }; return d; });
}

// ─── Résolution ville → identifiant aéroport (IATA ou Google Flights ID) ──────
const KNOWN_AIRPORTS = {
  // France
  "paris":"CDG","paris cdg":"CDG","roissy":"CDG","paris orly":"ORY","orly":"ORY",
  "lyon":"LYS","marseille":"MRS","nice":"NCE","toulouse":"TLS","bordeaux":"BOD",
  "nantes":"NTE","montpellier":"MPL","lille":"LIL","strasbourg":"SXB","rennes":"RNS",
  // UK — noms français ET anglais
  "londres":"LHR","london":"LHR","londre":"LHR","heathrow":"LHR","gatwick":"LGW","stansted":"STN","luton":"LTN",
  "manchester":"MAN","edinburgh":"EDI","birmingham":"BHX","glasgow":"GLA",
  // Europe — noms français
  "amsterdam":"AMS","bruxelles":"BRU","brussels":"BRU",
  "madrid":"MAD","barcelone":"BCN","barcelona":"BCN","seville":"SVQ","valence":"VLC",
  "rome":"FCO","roma":"FCO","milan":"MXP","milano":"MXP","venise":"VCE","naples":"NAP",
  "berlin":"BER","munich":"MUC","munchen":"MUC","francfort":"FRA","frankfurt":"FRA","hambourg":"HAM","hamburg":"HAM","cologne":"CGN","dusseldorf":"DUS",
  "vienne":"VIE","vienna":"VIE","salzbourg":"SZG","innsbruck":"INN",
  "lisbonne":"LIS","lisbon":"LIS","porto":"OPO","faro":"FAO",
  "athenes":"ATH","athens":"ATH","thessalonique":"SKG",
  "istanbul":"IST","ankara":"ESB",
  "varsovie":"WAW","warsaw":"WAW","cracovie":"KRK","prague":"PRG","budapest":"BUD",
  "stockholm":"ARN","oslo":"OSL","copenhague":"CPH","copenhagen":"CPH","helsinki":"HEL",
  "geneve":"GVA","genf":"GVA","zurich":"ZRH","bale":"BSL","berne":"BRN",
  "dubrovnik":"DBV","split":"SPU","zagreb":"ZAG","belgrade":"BEG","bucarest":"OTP",
  "sofia":"SOF","riga":"RIX","vilnius":"VNO","tallinn":"TLL",
  "reykjavik":"KEF","dublin":"DUB","malte":"MLA","chypre":"LCA","nicosie":"LCA",
  // Monde — noms français
  "new york":"JFK","new-york":"JFK","nyc":"JFK","los angeles":"LAX","la":"LAX",
  "miami":"MIA","chicago":"ORD","san francisco":"SFO","boston":"BOS","washington":"IAD",
  "las vegas":"LAS","seattle":"SEA","atlanta":"ATL","houston":"IAH","dallas":"DFW",
  "toronto":"YYZ","montreal":"YUL","montréal":"YUL","vancouver":"YVR","calgary":"YYC",
  "mexico":"MEX","mexico city":"MEX","cancun":"CUN","bogota":"BOG","lima":"LIM",
  "buenos aires":"EZE","sao paulo":"GRU","rio de janeiro":"GIG","rio":"GIG","santiago":"SCL",
  "dubai":"DXB","abu dhabi":"AUH","doha":"DOH","riyad":"RUH","koweït":"KWI","beyrouth":"BEY",
  "tel aviv":"TLV","amman":"AMM","le caire":"CAI","cairo":"CAI","tunis":"TUN",
  "casablanca":"CMN","marrakech":"RAK","agadir":"AGA","alger":"ALG","oran":"ORN",
  "dakar":"DSS","abidjan":"ABJ","accra":"ACC","lagos":"LOS","nairobi":"NBO",
  "johannesburg":"JNB","cape town":"CPT","le cap":"CPT","addis abeba":"ADD",
  "bangkok":"BKK","singapour":"SIN","singapore":"SIN","kuala lumpur":"KUL","jakarta":"CGK",
  "bali":"DPS","manille":"MNL","manila":"MNL","hanoi":"HAN","ho chi minh":"SGN",
  "tokyo":"NRT","osaka":"KIX","seoul":"ICN","séoul":"ICN","pekin":"PEK","beijing":"PEK",
  "pékin":"PEK","shanghai":"PVG","hong kong":"HKG","taipei":"TPE",
  "mumbai":"BOM","delhi":"DEL","new delhi":"DEL","bangalore":"BLR","chennai":"MAA",
  "sydney":"SYD","melbourne":"MEL","brisbane":"BNE","perth":"PER","auckland":"AKL",
};

function cityToIATA(city) {
  if (!city) return null;
  // Normalise : enlève accents, minuscules, trim
  const norm = city.trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[''`]/g, "");
  // Cherche dans le mapping
  if (KNOWN_AIRPORTS[norm]) return KNOWN_AIRPORTS[norm];
  // Si c'est déjà un code IATA 3 lettres → retourne tel quel
  if (/^[A-Z]{3}$/.test(city.trim().toUpperCase())) return city.trim().toUpperCase();
  // Dernier recours : 3 premières lettres en majuscule (risque d'erreur, mais évite le crash)
  const code = city.trim().toUpperCase().replace(/[^A-Z]/g,"").slice(0,3);
  return code.length === 3 ? code : city.trim().toUpperCase().slice(0,3);
}

// ─── Formatage du résultat SerpApi → structure propre ────────────────────────

function formatFlight(f, bookingToken) {
  const legs = f.flights || [];
  const first = legs[0] || {};
  const last  = legs[legs.length - 1] || {};

  return {
    // Compagnie
    airline       : first.airline || "N/A",
    airlineLogo   : first.airline_logo || f.airline_logo || null,
    flightNumber  : legs.map(l => l.flight_number).filter(Boolean).join(" + "),

    // Départ
    departureAirport  : first.departure_airport?.id   || null,
    departureCity     : first.departure_airport?.name || null,
    departureTime     : first.departure_airport?.time || null,

    // Arrivée
    arrivalAirport    : last.arrival_airport?.id   || null,
    arrivalCity       : last.arrival_airport?.name || null,
    arrivalTime       : last.arrival_airport?.time || null,

    // Vol
    duration   : f.total_duration || first.duration || null, // en minutes
    durationFmt: f.total_duration ? `${Math.floor(f.total_duration/60)}h${f.total_duration%60 ? (f.total_duration%60)+"min" : ""}` : null,
    stops      : legs.length - 1,
    stopsFmt   : legs.length <= 1 ? "Direct" : `${legs.length - 1} escale${legs.length > 2 ? "s" : ""}`,
    layovers   : (f.layovers || []).map(l => ({ airport: l.id, name: l.name, duration: l.duration })),

    // Prix
    price    : f.price || null,
    currency : "EUR",

    // CO₂
    co2      : f.carbon_emissions?.this_flight ? Math.round(f.carbon_emissions.this_flight / 1000) : null, // kg
    co2Diff  : f.carbon_emissions?.difference_percent || null,

    // Réservation
    // URL Google Flights : query naturelle avec IATA + date + compagnie
    bookUrl  : (() => {
      const dep     = f.flights?.[0]?.departure_airport?.id || "";
      const arr     = (f.flights?.[f.flights.length-1] || f.flights?.[0])?.arrival_airport?.id || "";
      const dt      = (f.flights?.[0]?.departure_airport?.time || "").slice(0,10);
      const airline = f.flights?.[0]?.airline || "";
      const flNum   = f.flights?.[0]?.flight_number || "";
      const q = ["vols", dep, arr, dt, airline, flNum].filter(Boolean).join(" ");
      const params = new URLSearchParams({ hl:"fr", q });
      if (dt) params.set("dates", dt.replace(/-/g,""));
      return `https://www.google.com/travel/flights?${params}`;
    })(),

    // Classe
    travelClass: first.travel_class || "Economy",
    airplane   : first.airplane || null,
  };
}

// ─── Recherche de vols ────────────────────────────────────────────────────────

async function searchFlights({ from, to, date, returnDate, adults = 2, currency = "EUR", lang = "fr", apiKey, directOnly = false }) {
  const key = apiKey || SERPAPI_KEY || process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY manquante dans les variables Railway");

  const depId  = cityToIATA(from);
  const destId = cityToIATA(to);
  // Sécurité : retour doit être après l'aller
  const validReturn = returnDate && returnDate > date ? returnDate : null;
  const isRoundTrip = !!validReturn;

  const params = {
    engine        : "google_flights",
    departure_id  : depId,
    arrival_id    : destId,
    outbound_date : date,
    adults        : parseInt(adults) || 2,
    currency      : currency || "EUR",
    hl            : lang === "fr" ? "fr" : lang === "es" ? "es" : lang === "de" ? "de" : "en",
    api_key       : key,
    type          : isRoundTrip ? "1" : "2",
    ...(isRoundTrip ? { return_date: validReturn } : {}),
  };

  console.log("Flight search params:", JSON.stringify({ departure_id:depId, arrival_id:destId, outbound_date:date, type:params.type, adults:params.adults }));
  let r;
  try {
    r = await axios.get("https://serpapi.com/search", { params, timeout: 25000 });
  } catch(e) {
    const serpErr = e.response?.data?.error || e.response?.data?.message || e.message;
    throw new Error(`SerpApi vols: ${serpErr}`);
  }
  const data = r.data;
  if (data.error) throw new Error(`SerpApi: ${data.error}`);

  let best  = (data.best_flights  || []).map(f => formatFlight(f, f.booking_token)).filter(f => f.price);
  let other = (data.other_flights || []).map(f => formatFlight(f, f.booking_token)).filter(f => f.price);
  let returnF = isRoundTrip
    ? (data.returning_flights || []).map(f => formatFlight(f, f.booking_token)).filter(f => f.price)
    : [];

  // Filtre direct uniquement si demandé
  if (directOnly) {
    best    = best.filter(f => f.stops === 0);
    other   = other.filter(f => f.stops === 0);
    returnF = returnF.filter(f => f.stops === 0);
  }

  // Tri par prix croissant
  const byPrice = (a, b) => (a.price||9999) - (b.price||9999);
  const flights      = [...best, ...other].sort(byPrice).slice(0, 20);
  const returnFlights = returnF.sort(byPrice).slice(0, 20);

  return {
    from        : { iata: depId, query: from },
    to          : { iata: destId, query: to },
    date, returnDate: returnDate || null,
    adults: parseInt(adults) || 2, currency: currency || "EUR", isRoundTrip,
    flights, returnFlights,
    priceInsights: data.price_insights || null,
    count: flights.length,
  };
}

// ─── Autocomplétion aéroports ─────────────────────────────────────────────────

async function searchAirports(query) {
  const r = await axios.get("https://serpapi.com/search", {
    params: { engine: "google_flights_airports", q: query, api_key: SERPAPI_KEY || process.env.SERPAPI_KEY },
    timeout: 10000,
  });
  return (r.data?.airports || []).slice(0, 6).map(a => ({
    id     : a.id,
    name   : a.name,
    city   : a.city,
    country: a.country,
  }));
}

// ─── Routes Express ───────────────────────────────────────────────────────────

/**
 * GET /flights/search
 * Params: from, to, date, return_date (opt), adults (opt), currency (opt), lang (opt)
 *
 * Exemple: /flights/search?from=Paris&to=Londres&date=2026-06-10&return_date=2026-06-15&adults=2
 */
router.get("/search", async (req, res) => {
  const { from, to, date, return_date, adults = 2, currency = "EUR", lang = "fr", key, direct = "false" } = req.query;

  if (!from || !to || !date) {
    return res.status(400).json({ error: "Paramètres requis : from, to, date" });
  }

  // Clé SerpApi passée depuis le client si variable Railway non disponible
  if (key && !process.env.SERPAPI_KEY) process.env.SERPAPI_KEY = key;

  try {
    const apiKey   = key || process.env.SERPAPI_KEY || "";
    const cacheKey = `${from}-${to}-${date}-${return_date||""}-${adults}`;
    const result = await cached(cacheKey, () => searchFlights({
      from, to, date, returnDate: return_date, adults, currency, lang, apiKey,
      directOnly: direct === "true",
    }));
    res.json(result);
  } catch (e) {
    console.error("Flights error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /flights/airports?q=Paris
 * Autocomplétion des aéroports
 */
router.get("/airports", async (req, res) => {
  const { q, key } = req.query;
  if (!q) return res.status(400).json({ error: "Paramètre q requis" });
  if (key && !process.env.SERPAPI_KEY) process.env.SERPAPI_KEY = key;

  try {
    const airports = await cached(`airports-${q}`, () => searchAirports(q), 60 * 60 * 1000);
    res.json({ airports });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
