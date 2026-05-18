const axios = require("axios");

const GOOGLE_KEY = process.env.GOOGLE_KEY;

// ─── Recherche via Google Places (si clé dispo) ───────────────────────────────

async function searchGoogle({ city, checkin, checkout, adults }) {
  const geoRes = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
    params: { address: city, key: GOOGLE_KEY }, timeout: 8000,
  });
  const loc = geoRes.data?.results?.[0]?.geometry?.location;
  if (!loc) throw new Error(`Ville introuvable : ${city}`);

  const placesRes = await axios.get("https://maps.googleapis.com/maps/api/place/nearbysearch/json", {
    params: { location: `${loc.lat},${loc.lng}`, radius: 5000, type: "lodging", key: GOOGLE_KEY },
    timeout: 8000,
  });

  return (placesRes.data?.results || []).slice(0, 10).map(p => ({
    name    : p.name,
    stars   : p.rating ? Math.min(Math.round(p.rating), 5) : null,
    score   : p.rating ? `${p.rating}/5` : null,
    reviews : p.user_ratings_total || 0,
    address : p.vicinity,
    perNight: null,
    price   : "Voir les prix",
    bookUrl : `https://www.google.com/travel/hotels?q=${encodeURIComponent(p.name + " " + city)}&checkin=${checkin}&checkout=${checkout}&adults=${adults}`,
  }));
}

// ─── Recherche via Nominatim + requête directe Overpass ───────────────────────

async function searchOverpass({ city, checkin, checkout, adults }) {
  // Géoloc
  const geoRes = await axios.get("https://nominatim.openstreetmap.org/search", {
    params : { q: city, format: "json", limit: 1 },
    headers: { "User-Agent": "CamVelApp/1.0" },
    timeout: 8000,
  });
  const geo = geoRes.data?.[0];
  if (!geo?.lat) throw new Error(`Ville introuvable : ${city}`);

  const query = `[out:json][timeout:15];(node["tourism"="hotel"](around:5000,${geo.lat},${geo.lon});node["tourism"="guest_house"](around:5000,${geo.lat},${geo.lon}););out tags 15;`;
  const MIRRORS = [
    "https://overpass.osm.ch/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  let ovRes = null;
  for (const mirror of MIRRORS) {
    try {
      ovRes = await axios.get(`${mirror}?data=${encodeURIComponent(query)}`, { timeout: 15000 });
      break;
    } catch(e) { console.warn(`Mirror ${mirror} failed:`, e.response?.status || e.message); }
  }
  if (!ovRes) throw new Error("Tous les serveurs Overpass sont indisponibles, réessayez dans 1 minute.");

  const seen = new Set();
  return (ovRes.data?.elements || [])
    .filter(el => el.tags?.name && !seen.has(el.tags.name) && seen.add(el.tags.name))
    .slice(0, 10)
    .map(el => ({
      name    : el.tags.name,
      stars   : parseInt(el.tags?.stars) || null,
      score   : null,
      reviews : 0,
      address : [el.tags?.["addr:street"], el.tags?.["addr:housenumber"]].filter(Boolean).join(" ") || city,
      perNight: null,
      price   : "Voir les prix",
      bookUrl : el.tags?.website ||
        `https://www.google.com/travel/hotels?q=${encodeURIComponent(el.tags.name + " " + city)}&checkin=${checkin}&checkout=${checkout}&adults=${adults}`,
    }));
}

// ─── Export ───────────────────────────────────────────────────────────────────

async function searchHotels(params) {
  if (GOOGLE_KEY) {
    try { return await searchGoogle(params); } catch (e) { console.warn("Google:", e.message); }
  }
  return searchOverpass(params);
}

module.exports = { searchHotels };
