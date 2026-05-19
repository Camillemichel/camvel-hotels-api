const express          = require("express");
const cors             = require("cors");
const { searchHotels } = require("./scraper");
const flightsRouter    = require("./flights");

const app = express();
app.use(cors());
app.use(express.json());
// Timeout serveur : 60s pour laisser SerpApi répondre + fallbacks
app.use((req, res, next) => { res.setTimeout(60000); next(); });

// Routes vols
app.use("/flights", flightsRouter);

// GET /hotels?city=Paris&checkin=2026-06-10&checkout=2026-06-15&adults=2
app.get("/hotels", async (req, res) => {
  const { city, checkin, checkout, adults = 2 } = req.query;

  if (!city || !checkin || !checkout) {
    return res.status(400).json({ error: "city, checkin et checkout sont requis" });
  }

  const apiKey     = req.query.key || process.env.SERPAPI_KEY || "";
  const maxPrice   = req.query.maxPrice   ? parseInt(req.query.maxPrice)   : null;
  const minStars   = req.query.minStars   ? parseInt(req.query.minStars)   : null;
  const maxStars   = req.query.maxStars   ? parseInt(req.query.maxStars)   : null;
  const travelType  = req.query.travelType  || "";
  const accomType   = req.query.accomType   || "hotel";
  const requests    = req.query.requests    || "";

  try {
    const hotels = await searchHotels({ city, checkin, checkout, adults: parseInt(adults), apiKey, maxPrice, minStars, maxStars, travelType, accomType, requests });
    res.json({ hotels, count: hotels.length });
  } catch (e) {
    console.error("Search error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get("/env-check", (_req, res) => res.json({
  SERPAPI_KEY  : process.env.SERPAPI_KEY ? "✅ définie" : "❌ manquante",
  AMADEUS_KEY  : process.env.AMADEUS_KEY ? "✅ définie" : "❌ manquante",
  PORT         : process.env.PORT || "non défini",
}));

// Debug : teste chaque étape et retourne les erreurs détaillées
app.get("/debug", async (req, res) => {
  const city = req.query.city || "Paris";
  const steps = {};

  // Étape 1 : Nominatim
  try {
    const axios = require("axios");
    const r = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: { q: city, format: "json", limit: 1 },
      headers: { "User-Agent": "CamVelApp/1.0" },
      timeout: 8000,
    });
    steps.nominatim = { ok: true, lat: r.data?.[0]?.lat, lon: r.data?.[0]?.lon };
  } catch(e) { steps.nominatim = { ok: false, error: e.message }; }

  // Étape 2 : Overpass
  if (steps.nominatim.ok) {
    try {
      const axios = require("axios");
      const { lat, lon } = steps.nominatim;
      const q = `[out:json][timeout:10];(node["tourism"="hotel"](around:3000,${lat},${lon}););out tags 5;`;
      const r = await axios.get(`https://overpass.kumi.systems/api/interpreter?data=${encodeURIComponent(q)}`, { timeout: 15000 });
      steps.overpass = { ok: true, count: r.data?.elements?.length, sample: r.data?.elements?.[0]?.tags?.name };
    } catch(e) { steps.overpass = { ok: false, error: e.message, status: e.response?.status }; }
  }

  res.json(steps);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ API prête sur port ${PORT}`);
  console.log("SERPAPI_KEY:", process.env.SERPAPI_KEY ? `définie (${process.env.SERPAPI_KEY.length} chars)` : "MANQUANTE");
  console.log("Vars dispo:", Object.keys(process.env).filter(k => !k.includes("npm") && !k.includes("PATH")).join(", "));
});
