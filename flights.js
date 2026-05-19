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
function cached(key, fn, ttl = 10 * 60 * 1000) {
  if (cache[key] && Date.now() - cache[key].ts < ttl) return Promise.resolve(cache[key].data);
  return fn().then(d => { cache[key] = { data: d, ts: Date.now() }; return d; });
}

// ─── Résolution ville → identifiant aéroport (IATA ou Google Flights ID) ──────
const KNOWN_AIRPORTS = {
  // France
  "paris":"CDG","paris cdg":"CDG","roissy":"CDG","paris orly":"ORY","orly":"ORY",
  "lyon":"LYS","marseille":"MRS","nice":"NCE","toulouse":"TLS","bordeaux":"BOD",
  "nantes":"NTE","montpellier":"MPL","lille":"LIL","strasbourg":"SXB",
  // Europe
  "londre":"LHR","london":"LHR","heathrow":"LHR","gatwick":"LGW","stansted":"STN",
  "amsterdam":"AMS","bruxelles":"BRU","brussels":"BRU","madrid":"MAD","barcelone":"BCN",
  "barcelona":"BCN","rome":"FCO","roma":"FCO","milan":"MXP","milano":"MXP",
  "berlin":"BER","munich":"MUC","münchen":"MUC","vienne":"VIE","vienna":"VIE",
  "lisbonne":"LIS","lisbon":"LIS","porto":"OPO","athenes":"ATH","athens":"ATH",
  "istanbul":"IST","varsovie":"WAW","warsaw":"WAW","prague":"PRG","budapest":"BUD",
  // Monde
  "new york":"JFK","nyc":"JFK","los angeles":"LAX","miami":"MIA","chicago":"ORD",
  "toronto":"YYZ","montréal":"YUL","montreal":"YUL","mexico":"MEX",
  "dubai":"DXB","abu dhabi":"AUH","doha":"DOH",
  "bangkok":"BKK","tokyo":"NRT","osaka":"KIX","singapour":"SIN","singapore":"SIN",
  "hong kong":"HKG","pékin":"PEK","beijing":"PEK","shanghai":"PVG",
  "sydney":"SYD","melbourne":"MEL",
  "marrakech":"RAK","casablanca":"CMN","tunis":"TUN","alger":"ALG","dakar":"DSS",
  "nairobi":"NBO","johannesburg":"JNB","le caire":"CAI","cairo":"CAI",
};

function cityToIATA(city) {
  if (!city) return null;
  const key = city.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return KNOWN_AIRPORTS[key] || city.toUpperCase().trim();
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
    bookUrl  : bookingToken
      ? `https://www.google.com/travel/flights?tfs=${encodeURIComponent(bookingToken)}`
      : null,

    // Classe
    travelClass: first.travel_class || "Economy",
    airplane   : first.airplane || null,
  };
}

// ─── Recherche de vols ────────────────────────────────────────────────────────

async function searchFlights({ from, to, date, returnDate, adults = 2, currency = "EUR", lang = "fr", apiKey }) {
  const key = apiKey || SERPAPI_KEY || process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY manquante dans les variables Railway");

  const depId  = cityToIATA(from);
  const destId = cityToIATA(to);
  const isRoundTrip = !!returnDate;

  const params = {
    engine        : "google_flights",
    departure_id  : depId,
    arrival_id    : destId,
    outbound_date : date,
    adults        : parseInt(adults) || 2,
    currency      : currency || "EUR",
    hl            : lang === "fr" ? "fr" : lang === "es" ? "es" : lang === "de" ? "de" : "en",
    api_key       : key,
    type          : isRoundTrip ? "1" : "2",   // 1 = aller-retour, 2 = aller simple
    ...(isRoundTrip ? { return_date: returnDate } : {}),
  };

  const r = await axios.get("https://serpapi.com/search", { params, timeout: 25000 });
  const data = r.data;

  const best  = (data.best_flights  || []).map(f => formatFlight(f, f.booking_token)).filter(f => f.price);
  const other = (data.other_flights || []).map(f => formatFlight(f, f.booking_token)).filter(f => f.price);

  // Vols retour (si aller-retour)
  const returnFlights = isRoundTrip
    ? (data.returning_flights || []).map(f => formatFlight(f, f.booking_token)).filter(f => f.price)
    : [];

  return {
    from        : { iata: depId, query: from },
    to          : { iata: destId, query: to },
    date,
    returnDate  : returnDate || null,
    adults      : parseInt(adults) || 2,
    currency    : currency || "EUR",
    isRoundTrip,
    flights     : [...best, ...other].slice(0, 12),
    returnFlights : returnFlights.slice(0, 8),
    priceInsights : data.price_insights || null,
    count       : best.length + other.length,
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
  const { from, to, date, return_date, adults = 2, currency = "EUR", lang = "fr", key } = req.query;

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
