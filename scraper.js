const axios = require("axios");

// Cache 15 min
const cache = {};
function cached(key, fn) {
  if (cache[key] && Date.now() - cache[key].ts < 15 * 60 * 1000) return Promise.resolve(cache[key].data);
  return fn().then(d => { cache[key] = { data: d, ts: Date.now() }; return d; });
}

async function searchHotelsSerpApi({ city, checkin, checkout, adults, apiKey, maxPrice, minStars, maxStars, travelType, accomType, requests }) {
  const SERPAPI_KEY = apiKey || process.env.SERPAPI_KEY;
  if (!SERPAPI_KEY) throw new Error("Clé SerpApi manquante");

  // Type d'hébergement
  const typeLabel = {
    hostel    : "hostel auberge de jeunesse",
    apartment : "apartment appartement location",
    house     : "maison house location vacances",
    villa     : "villa location vacances",
    hotel     : "hotel",
  }[accomType] || "hotel";

  // Type de voyage + demandes spéciales dans la requête
  const travelPrefix = travelType === "family" ? "family"
    : travelType === "couple" ? "romantic" : "";
  const reqExtra = requests ? requests.slice(0, 60) : ""; // max 60 chars
  const queryStr = [travelPrefix, typeLabel, city, reqExtra].filter(Boolean).join(" ");

  const params = {
    engine         : "google_hotels",
    q              : queryStr,
    check_in_date  : checkin,
    check_out_date : checkout,
    adults,
    currency       : "EUR",
    hl             : "fr",
    gl             : "fr",
    api_key        : SERPAPI_KEY,
  };
  // Filtre de prix max si budget renseigné
  if (maxPrice) params.max_price = maxPrice;
  // Filtre d'étoiles
  if (minStars) params.hotel_class = Array.from({length: (maxStars||5) - minStars + 1}, (_,i) => minStars + i).join(",");

  const r = await axios.get("https://serpapi.com/search", { params, timeout: 15000 });

  const results = r.data?.properties || r.data?.hotels_results || [];

  return results.slice(0, 8).map(h => {
    const nights      = Math.round((new Date(checkout) - new Date(checkin)) / 86400000);
    // Utilise extracted_lowest pour les vrais prix numériques SerpApi
    const perNight    = h.rate_per_night?.extracted_lowest || parseInt(String(h.rate_per_night?.lowest || "").replace(/[^\d]/g, "")) || null;
    const totalExact  = h.total_rate?.extracted_lowest || (perNight ? perNight * nights : null);

    return {
      name    : h.name,
      stars   : h.star_rating || h.class || null,
      score   : h.overall_rating ? `${parseFloat(h.overall_rating).toFixed(1)}/5` : null,
      reviews : h.reviews || 0,
      address : h.description || h.location || city,
      perNight,
      price   : perNight ? `À partir de ${perNight}€/nuit` : "Voir les prix",
      total   : totalExact ? Math.round(totalExact) : null,
      bookUrl : (() => {
        // Format Google Hotels avec dates : dates=YYYYMMDD,YYYYMMDD (sans tirets)
        const d1 = checkin.replace(/-/g, "");
        const d2 = checkout.replace(/-/g, "");
        return `https://www.google.com/travel/hotels?q=${encodeURIComponent(h.name + " " + city)}&dates=${d1},${d2}&adults=${adults}&hl=fr`;
      })(),
    };
  });
}

async function searchHotels(params) {
  const key = `${params.city}-${params.checkin}-${params.checkout}-${params.adults}-${params.accomType}-${params.requests?.slice(0,20)}`;
  return cached(key, () => searchHotelsSerpApi(params));
}


module.exports = { searchHotels };
