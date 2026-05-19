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

  // Plusieurs types possibles (ex: "hotel,apartment")
  const selectedTypes = (accomType || "hotel").split(",").map(t => t.trim());

  // Label texte pour la requête selon les types sélectionnés
  const TYPE_LABELS = {
    hotel: "hotel", hostel: "hostel auberge de jeunesse",
    apartment: "appartement location", house: "maison location vacances", villa: "villa location vacances",
  };
  const typeLabel = selectedTypes.map(t => TYPE_LABELS[t] || "hotel").join(" ");

  const travelPrefix = travelType === "family" ? "family" : travelType === "couple" ? "romantic" : "";
  // Extrait uniquement les mots-clés courts de la note (max 2 mots utiles, sans accents lourds)
  const reqKeywords  = requests
    ? requests.toLowerCase()
        .replace(/[àâä]/g,"a").replace(/[éèêë]/g,"e").replace(/[îï]/g,"i").replace(/[ôö]/g,"o").replace(/[ùûü]/g,"u")
        .match(/\b(sea|beach|plage|mer|centre|center|pool|piscine|view|vue|quiet|calme|luxe|luxury|garden|jardin|balcon|balcony)\b/g)
        ?.slice(0,2).join(" ") || ""
    : "";
  const queryStr = [travelPrefix, typeLabel, city, reqKeywords].filter(Boolean).join(" ");

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
  // Filtre de prix max (uniquement si valeur raisonnable > 10€)
  if (maxPrice && maxPrice > 10) params.max_price = maxPrice;

  const r = await axios.get("https://serpapi.com/search", { params, timeout: 25000 });

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

const isTimeout = (e) => e.code === "ECONNABORTED" || e.message?.includes("timeout");

async function searchHotels(params) {
  const key = `${params.city}-${params.checkin}-${params.checkout}-${params.adults}-${params.accomType}-${params.requests?.slice(0,20)}`;
  return cached(key, async () => {
    let results = [];

    // 1er essai : critères complets
    try {
      results = await searchHotelsSerpApi(params);
      if (results.length >= 2) return results;
    } catch(e) {
      if (isTimeout(e)) console.warn("Timeout essai 1, fallback direct");
      else throw e; // erreur non-timeout → remonte (400, clé invalide…)
    }

    // 2ème essai : requête simplifiée (sans demandes spéciales, sans filtres stricts)
    try {
      console.log("Fallback: requête simplifiée");
      results = await searchHotelsSerpApi({
        ...params, requests: "", maxPrice: null, minStars: null, maxStars: null, travelType: "",
      });
      if (results.length >= 2) return results.map(h => ({ ...h, _fallback: "Alternatives disponibles" }));
    } catch(e) {
      if (!isTimeout(e)) throw e;
    }

    // Dernier recours : "hotel [ville]" uniquement
    try {
      results = await searchHotelsSerpApi({
        ...params, requests: "", maxPrice: null, minStars: null, maxStars: null, accomType: "hotel", travelType: "",
      });
      return results.map(h => ({ ...h, _fallback: "Alternatives disponibles dans la ville" }));
    } catch(e) {
      throw new Error("Aucun hôtel trouvé pour cette destination.");
    }
  });
}


module.exports = { searchHotels };
