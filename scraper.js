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

  // Mapping type → property_types SerpApi Google Hotels
  const PROP_TYPES = {
    hotel     : [1],
    hostel    : [3],
    apartment : [5, 2],
    house     : [11, 2],
    villa     : [2, 11],
  };

  // Plusieurs types possibles (ex: "hotel,apartment")
  const selectedTypes = (accomType || "hotel").split(",").map(t => t.trim());
  const propertyTypeIds = [...new Set(selectedTypes.flatMap(t => PROP_TYPES[t] || [1]))];

  // Label texte pour la requête selon les types sélectionnés
  const TYPE_LABELS = {
    hotel: "hotel", hostel: "hostel auberge de jeunesse",
    apartment: "appartement location", house: "maison location vacances", villa: "villa location vacances",
  };
  const typeLabel = selectedTypes.map(t => TYPE_LABELS[t] || "hotel").join(" ");

  const travelPrefix = travelType === "family" ? "family" : travelType === "couple" ? "romantic" : "";
  const reqExtra     = requests ? requests.slice(0, 60) : "";
  const queryStr     = [travelPrefix, typeLabel, city, reqExtra].filter(Boolean).join(" ");

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
  // Filtre par type d'hébergement (property_types SerpApi)
  if (propertyTypeIds.length > 0 && !(selectedTypes.length === 1 && selectedTypes[0] === "hotel")) {
    params.property_types = propertyTypeIds.join(",");
  }
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
  return cached(key, async () => {
    // 1er essai : critères complets
    let results = await searchHotelsSerpApi(params);
    if (results.length >= 2) return results;

    // 2ème essai : sans la note spéciale
    if (params.requests) {
      console.log("Fallback 1: sans requests");
      results = await searchHotelsSerpApi({ ...params, requests: "" });
      if (results.length >= 2) return results.map(h => ({ ...h, _fallback: "Sans la demande spéciale" }));
    }

    // 3ème essai : sans filtre de prix
    if (params.maxPrice) {
      console.log("Fallback 2: sans filtre prix");
      results = await searchHotelsSerpApi({ ...params, requests: "", maxPrice: null });
      if (results.length >= 2) return results.map(h => ({ ...h, _fallback: "Budget élargi" }));
    }

    // 4ème essai : type conservé mais sans aucun autre filtre
    console.log("Fallback 3: recherche générale");
    results = await searchHotelsSerpApi({ ...params, requests: "", maxPrice: null, minStars: null, maxStars: null, travelType: "" });
    if (results.length === 0) {
      // Dernier recours : juste "hotel [ville]"
      results = await searchHotelsSerpApi({ ...params, requests: "", maxPrice: null, minStars: null, maxStars: null, accomType: "hotel", travelType: "" });
    }
    return results.map(h => ({ ...h, _fallback: "Alternatives disponibles dans la ville" }));
  });
}


module.exports = { searchHotels };
