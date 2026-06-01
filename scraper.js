const axios = require("axios");

// Cache 15 min
const cache = {};
function cached(key, fn) {
  if (cache[key] && Date.now() - cache[key].ts < 15 * 60 * 1000) return Promise.resolve(cache[key].data);
  return fn().then(d => { cache[key] = { data: d, ts: Date.now() }; return d; });
}

// ─── Distance centre-ville ────────────────────────────────────────────────────
const CITY_CENTERS = {
  // France
  paris:{lat:48.8566,lon:2.3522},lyon:{lat:45.7640,lon:4.8357},marseille:{lat:43.2965,lon:5.3698},
  nice:{lat:43.7102,lon:7.2620},toulouse:{lat:43.6047,lon:1.4442},bordeaux:{lat:44.8378,lon:-0.5792},
  nantes:{lat:47.2184,lon:-1.5536},montpellier:{lat:43.6108,lon:3.8767},lille:{lat:50.6292,lon:3.0573},
  strasbourg:{lat:48.5734,lon:7.7521},rennes:{lat:48.1173,lon:-1.6778},
  // UK
  london:{lat:51.5074,lon:-0.1278},londres:{lat:51.5074,lon:-0.1278},
  manchester:{lat:53.4808,lon:-2.2426},edinburgh:{lat:55.9533,lon:-3.1883},
  // Europe
  amsterdam:{lat:52.3676,lon:4.9041},bruxelles:{lat:50.8503,lon:4.3517},brussels:{lat:50.8503,lon:4.3517},
  madrid:{lat:40.4168,lon:-3.7038},barcelona:{lat:41.3851,lon:2.1734},barcelone:{lat:41.3851,lon:2.1734},
  seville:{lat:37.3886,lon:-5.9823},
  rome:{lat:41.9028,lon:12.4964},milan:{lat:45.4642,lon:9.1900},venice:{lat:45.4408,lon:12.3155},
  venise:{lat:45.4408,lon:12.3155},naples:{lat:40.8518,lon:14.2681},florence:{lat:43.7696,lon:11.2558},
  berlin:{lat:52.5200,lon:13.4050},munich:{lat:48.1351,lon:11.5820},frankfurt:{lat:50.1109,lon:8.6821},
  francfort:{lat:50.1109,lon:8.6821},hamburg:{lat:53.5511,lon:9.9937},hambourg:{lat:53.5511,lon:9.9937},
  cologne:{lat:50.9333,lon:6.9500},dusseldorf:{lat:51.2217,lon:6.7762},
  vienna:{lat:48.2082,lon:16.3738},vienne:{lat:48.2082,lon:16.3738},
  lisbon:{lat:38.7169,lon:-9.1399},lisbonne:{lat:38.7169,lon:-9.1399},porto:{lat:41.1579,lon:-8.6291},
  athens:{lat:37.9755,lon:23.7348},athenes:{lat:37.9755,lon:23.7348},
  istanbul:{lat:41.0082,lon:28.9784},prague:{lat:50.0755,lon:14.4378},
  budapest:{lat:47.4979,lon:19.0402},warsaw:{lat:52.2297,lon:21.0122},varsovie:{lat:52.2297,lon:21.0122},
  stockholm:{lat:59.3293,lon:18.0686},oslo:{lat:59.9139,lon:10.7522},
  copenhagen:{lat:55.6761,lon:12.5683},copenhague:{lat:55.6761,lon:12.5683},
  helsinki:{lat:60.1699,lon:24.9384},dublin:{lat:53.3498,lon:-6.2603},
  geneva:{lat:46.2044,lon:6.1432},geneve:{lat:46.2044,lon:6.1432},zurich:{lat:47.3769,lon:8.5417},
  dubrovnik:{lat:42.6507,lon:18.0944},split:{lat:43.5081,lon:16.4402},
  krakow:{lat:50.0647,lon:19.9450},cracovie:{lat:50.0647,lon:19.9450},
  // Americas
  "new york":{lat:40.7128,lon:-74.0060},"los angeles":{lat:34.0522,lon:-118.2437},
  miami:{lat:25.7617,lon:-80.1918},chicago:{lat:41.8781,lon:-87.6298},
  "san francisco":{lat:37.7749,lon:-122.4194},boston:{lat:42.3601,lon:-71.0589},
  toronto:{lat:43.6511,lon:-79.3470},montreal:{lat:45.5017,lon:-73.5673},
  "montréal":{lat:45.5017,lon:-73.5673},vancouver:{lat:49.2827,lon:-123.1207},
  "mexico city":{lat:19.4326,lon:-99.1332},cancun:{lat:21.1619,lon:-86.8515},
  "buenos aires":{lat:-34.6037,lon:-58.3816},"rio de janeiro":{lat:-22.9068,lon:-43.1729},
  // Middle East
  dubai:{lat:25.2048,lon:55.2708},doha:{lat:25.2854,lon:51.5310},"abu dhabi":{lat:24.4539,lon:54.3773},
  // Africa
  marrakech:{lat:31.6295,lon:-7.9811},casablanca:{lat:33.5731,lon:-7.5898},
  tunis:{lat:36.8190,lon:10.1658},alger:{lat:36.7372,lon:3.0869},
  cairo:{lat:30.0444,lon:31.2357},"le caire":{lat:30.0444,lon:31.2357},
  nairobi:{lat:-1.2921,lon:36.8219},johannesburg:{lat:-26.2041,lon:28.0473},
  // Asia
  bangkok:{lat:13.7563,lon:100.5018},singapore:{lat:1.3521,lon:103.8198},
  singapour:{lat:1.3521,lon:103.8198},"kuala lumpur":{lat:3.1390,lon:101.6869},
  bali:{lat:-8.6705,lon:115.2126},jakarta:{lat:-6.2088,lon:106.8456},
  tokyo:{lat:35.6762,lon:139.6503},osaka:{lat:34.6937,lon:135.5023},
  seoul:{lat:37.5665,lon:126.9780},"séoul":{lat:37.5665,lon:126.9780},
  beijing:{lat:39.9042,lon:116.4074},pekin:{lat:39.9042,lon:116.4074},
  shanghai:{lat:31.2304,lon:121.4737},"hong kong":{lat:22.3193,lon:114.1694},
  taipei:{lat:25.0330,lon:121.5654},delhi:{lat:28.7041,lon:77.1025},
  mumbai:{lat:19.0760,lon:72.8777},bangalore:{lat:12.9716,lon:77.5946},
  // Oceania
  sydney:{lat:-33.8688,lon:151.2093},melbourne:{lat:-37.8136,lon:144.9631},
  brisbane:{lat:-27.4698,lon:153.0251},auckland:{lat:-36.8485,lon:174.7633},
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getCityCenter(city) {
  const norm = (city || "").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(",")[0].trim();
  return CITY_CENTERS[norm] || null;
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
  const cityCenter = getCityCenter(city);

  return results.slice(0, 8).map(h => {
    const nights      = Math.round((new Date(checkout) - new Date(checkin)) / 86400000);
    // Utilise extracted_lowest pour les vrais prix numériques SerpApi
    const perNight    = h.rate_per_night?.extracted_lowest || parseInt(String(h.rate_per_night?.lowest || "").replace(/[^\d]/g, "")) || null;
    const totalExact  = h.total_rate?.extracted_lowest || (perNight ? perNight * nights : null);

    const gps = h.gps_coordinates;
    const distanceKm = (cityCenter && gps?.latitude && gps?.longitude)
      ? Math.round(haversineKm(gps.latitude, gps.longitude, cityCenter.lat, cityCenter.lon) * 10) / 10
      : null;

    return {
      name       : h.name,
      stars      : h.star_rating || h.class || null,
      score      : h.overall_rating ? `${parseFloat(h.overall_rating).toFixed(1)}/5` : null,
      reviews    : h.reviews || 0,
      address    : h.description || h.location || city,
      perNight,
      price      : perNight ? `À partir de ${perNight}€/nuit` : "Voir les prix",
      total      : totalExact ? Math.round(totalExact) : null,
      distanceKm,
      bookUrl : (() => {
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
