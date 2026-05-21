/**
 * duffel.js — Recherche de vols via Duffel API
 * Prix INCLUANT toutes les taxes, données GDS en temps réel
 *
 * Endpoint : GET /flights/duffel/search?from=CDG&to=LHR&date=2026-09-21&adults=2
 */

const express = require("express");
const axios   = require("axios");
const router  = express.Router();

const DUFFEL_BASE = "https://api.duffel.com";

function duffelHeaders(key) {
  return {
    "Authorization" : `Bearer ${key.trim()}`,
    "Content-Type"  : "application/json",
    "Accept"        : "application/json",
    "Duffel-Version": "v2",
  };
}

// Durée ISO8601 (PT2H30M) → minutes
function parseDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  return m ? (parseInt(m[1]||0)*60 + parseInt(m[2]||0)) : null;
}

function fmtDuration(min) {
  if (!min) return null;
  const h = Math.floor(min/60), m = min%60;
  return `${h}h${m?m+"min":""}`;
}

// Formate une offre Duffel en objet lisible
function formatOffer(offer, adults) {
  const outSlice  = offer.slices?.[0];
  const retSlice  = offer.slices?.[1];
  const outSegs   = outSlice?.segments || [];
  const firstSeg  = outSegs[0];
  const lastSeg   = outSegs[outSegs.length-1];

  const airline     = firstSeg?.marketing_carrier?.name || "—";
  const airlineCode = firstSeg?.marketing_carrier?.iata_code || "";
  const flightNum   = `${airlineCode}${firstSeg?.marketing_carrier_flight_number||""}`;
  const depTime     = firstSeg?.departing_at || null;
  const arrTime     = lastSeg?.arriving_at   || null;
  const dur         = outSlice?.duration ? parseDuration(outSlice.duration) : null;
  const stops       = Math.max(0, outSegs.length - 1);

  // Prix TTC total (tous passagers) → prix par personne
  const totalPrice  = parseFloat(offer.total_amount || 0);
  const pricePerPax = adults > 0 ? Math.round(totalPrice / adults) : Math.round(totalPrice);

  // Vol retour si aller-retour
  let returnFlight = null;
  if (retSlice) {
    const retSegs     = retSlice.segments || [];
    const retFirst    = retSegs[0];
    const retLast     = retSegs[retSegs.length-1];
    const retDur      = retSlice.duration ? parseDuration(retSlice.duration) : null;
    const retStops    = Math.max(0, retSegs.length - 1);
    returnFlight = {
      airline          : retFirst?.marketing_carrier?.name || "—",
      flightNumber     : `${retFirst?.marketing_carrier?.iata_code||""}${retFirst?.marketing_carrier_flight_number||""}`,
      departureAirport : retFirst?.origin?.iata_code,
      arrivalAirport   : retLast?.destination?.iata_code,
      departureTime    : retFirst?.departing_at,
      arrivalTime      : retLast?.arriving_at,
      duration         : retDur,
      durationFmt      : fmtDuration(retDur),
      stops            : retStops,
      stopsFmt         : retStops===0?"Direct":`${retStops} escale${retStops>1?"s":""}`,
      airlineLogo      : retFirst?.marketing_carrier?.logo_symbol_url || null,
    };
  }

  return {
    offerId          : offer.id,
    airline,
    flightNumber     : flightNum,
    departureAirport : firstSeg?.origin?.iata_code,
    arrivalAirport   : lastSeg?.destination?.iata_code,
    departureCity    : firstSeg?.origin?.city?.name || firstSeg?.origin?.name,
    arrivalCity      : lastSeg?.destination?.city?.name || lastSeg?.destination?.name,
    departureTime    : depTime,
    arrivalTime      : arrTime,
    duration         : dur,
    durationFmt      : fmtDuration(dur),
    stops,
    stopsFmt         : stops===0?"Direct":`${stops} escale${stops>1?"s":""}`,
    price            : pricePerPax,     // par personne TTC
    totalPrice       : Math.round(totalPrice), // total TTC
    currency         : offer.total_currency || "EUR",
    travelClass      : outSlice?.fare_brand_name || "Economy",
    airlineLogo      : firstSeg?.marketing_carrier?.logo_symbol_url || null,
    returnFlight,
    _source          : "duffel",
  };
}

// ─── Recherche de vols ────────────────────────────────────────────────────────
async function searchDuffel({ from, to, date, returnDate, adults=2, children=0, directOnly=false, apiKey }) {
  const key = (apiKey || process.env.DUFFEL_KEY || "").trim();
  if (!key) throw new Error("DUFFEL_KEY manquante");

  const headers = duffelHeaders(key);

  // Slices : aller (+ retour si aller-retour)
  const slices = [{ origin: from, destination: to, departure_date: date }];
  if (returnDate && returnDate > date) {
    slices.push({ origin: to, destination: from, departure_date: returnDate });
  }

  // Passagers
  const passengers = [];
  for (let i=0; i<parseInt(adults||2); i++) passengers.push({ type:"adult" });
  for (let i=0; i<parseInt(children||0); i++) passengers.push({ type:"child", age:8 });

  // 1. Créer la demande d'offres
  const reqBody = { data: { slices, passengers, cabin_class:"economy" } };
  const reqRes  = await axios.post(`${DUFFEL_BASE}/air/offer_requests?return_offers=true`, reqBody, { headers, timeout:30000 });
  const offerRequestId = reqRes.data?.data?.id;
  if (!offerRequestId) throw new Error("Duffel : impossible de créer la demande");

  // 2. Récupérer les offres triées par prix
  const qp = new URLSearchParams({
    offer_request_id : offerRequestId,
    limit            : "30",
    sort             : "total_amount",
  });
  if (directOnly) qp.set("max_connections", "0");

  const offersRes = await axios.get(`${DUFFEL_BASE}/air/offers?${qp}`, { headers, timeout:30000 });
  const offers    = offersRes.data?.data || [];

  const totalAdults = parseInt(adults||2) + parseInt(children||0);
  return offers.map(o => formatOffer(o, totalAdults));
}

// ─── Route ────────────────────────────────────────────────────────────────────
router.get("/search", async (req, res) => {
  const { from, to, date, return_date, adults=2, children=0, direct="false", key } = req.query;

  if (!from || !to || !date) {
    return res.status(400).json({ error: "Paramètres requis : from, to, date" });
  }

  const apiKey = (key || process.env.DUFFEL_KEY || "").trim();
  if (!apiKey) return res.status(400).json({ error: "DUFFEL_KEY manquante" });

  try {
    const flights = await searchDuffel({
      from, to, date,
      returnDate  : return_date || null,
      adults      : parseInt(adults||2),
      children    : parseInt(children||0),
      directOnly  : direct==="true",
      apiKey,
    });
    res.json({ flights, count: flights.length, source: "duffel" });
  } catch(e) {
    console.error("Duffel error:", e.response?.data || e.message);
    const msg = e.response?.data?.errors?.[0]?.message || e.message;
    res.status(500).json({ error: `Duffel: ${msg}` });
  }
});

module.exports = router;
