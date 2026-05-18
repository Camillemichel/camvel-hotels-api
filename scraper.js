const axios = require("axios");

// Cache 15 min
const cache = {};
function cached(key, fn) {
  if (cache[key] && Date.now() - cache[key].ts < 15 * 60 * 1000) return Promise.resolve(cache[key].data);
  return fn().then(d => { cache[key] = { data: d, ts: Date.now() }; return d; });
}

async function searchHotelsSerpApi({ city, checkin, checkout, adults, apiKey }) {
  const SERPAPI_KEY = apiKey || process.env.SERPAPI_KEY;
  if (!SERPAPI_KEY) throw new Error("Clé SerpApi manquante");

  const r = await axios.get("https://serpapi.com/search", {
    params: {
      engine         : "google_hotels",
      q              : `hotels ${city}`,
      check_in_date  : checkin,
      check_out_date : checkout,
      adults,
      currency       : "EUR",
      hl             : "fr",
      gl             : "fr",
      api_key        : SERPAPI_KEY,
    },
    timeout: 15000,
  });

  const results = r.data?.properties || r.data?.hotels_results || [];

  return results.slice(0, 8).map(h => {
    const price    = h.rate_per_night?.lowest || h.price || null;
    const priceNum = price ? parseInt(String(price).replace(/[^\d]/g, "")) : null;
    const nights   = Math.round((new Date(checkout) - new Date(checkin)) / 86400000);

    return {
      name    : h.name,
      stars   : h.star_rating || h.class || null,
      score   : h.overall_rating ? `${h.overall_rating}/5` : null,
      reviews : h.reviews || 0,
      address : h.description || h.location || city,
      perNight: priceNum || null,
      price   : priceNum ? `${priceNum}€/nuit` : "Voir les prix",
      total   : priceNum ? priceNum * nights : null,
      bookUrl : h.link || h.serpapi_property_details_link ||
        `https://www.google.com/travel/hotels?q=${encodeURIComponent(h.name + " " + city)}&checkin=${checkin}&checkout=${checkout}&adults=${adults}`,
    };
  });
}

async function searchHotels(params) {
  const key = `${params.city}-${params.checkin}-${params.checkout}-${params.adults}`;
  return cached(key, () => searchHotelsSerpApi(params));
}


module.exports = { searchHotels };
