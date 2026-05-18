const axios   = require("axios");
const cheerio = require("cheerio");

const HEADERS = {
  "User-Agent"      : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept-Language" : "fr-FR,fr;q=0.9,en;q=0.8",
  "Accept"          : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Encoding" : "gzip, deflate, br",
  "Cache-Control"   : "no-cache",
  "Pragma"          : "no-cache",
};

async function scrapeBooking({ city, checkin, checkout, adults = 2 }) {
  const url = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(city)}&checkin=${checkin}&checkout=${checkout}&group_adults=${adults}&no_rooms=1&selected_currency=EUR&lang=fr`;

  const { data: html } = await axios.get(url, {
    headers : HEADERS,
    timeout : 15000,
    maxRedirects: 5,
  });

  const $       = cheerio.load(html);
  const hotels  = [];
  const nights  = Math.round((new Date(checkout) - new Date(checkin)) / 86400000);

  $('[data-testid="property-card"]').each((_, el) => {
    const name  = $('[data-testid="title"]',      el).first().text().trim();
    const price = $('[data-testid="price-and-discounted-price"]', el).first().text().trim();
    const link  = $('[data-testid="title-link"]', el).first().attr("href") ||
                  $("a",                          el).first().attr("href");

    const starsEl = $('[data-testid="rating-stars"] span, .b8b4f843d5 span', el);
    const stars   = starsEl.length || null;

    const scoreText = $('[data-testid="review-score"]', el).text().trim();
    const score     = scoreText.match(/\d[\d,.]+/)?.[0] || null;

    const distText  = $('[data-testid="distance"]', el).text().trim();
    const roomDesc  = $('[data-testid="recommended-units"]', el).first().text().trim();

    // Prix par nuit depuis le texte brut
    const priceNum  = price.replace(/[^\d]/g, "");
    const perNight  = priceNum && nights > 0 ? Math.round(parseInt(priceNum) / nights) : null;

    // Lien direct vers la page hôtel (pas les résultats de recherche)
    const bookUrl = link
      ? (link.startsWith("http") ? link : `https://www.booking.com${link}`)
      : `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(name + " " + city)}&checkin=${checkin}&checkout=${checkout}&group_adults=${adults}`;

    if (name) hotels.push({ name, stars, score, perNight, price, roomDesc, distance: distText, bookUrl });
  });

  return hotels;
}

module.exports = { scrapeBooking };
