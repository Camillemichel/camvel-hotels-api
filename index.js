const express          = require("express");
const cors             = require("cors");
const { scrapeBooking } = require("./scraper");

const app = express();
app.use(cors());
app.use(express.json());

// GET /hotels?city=Paris&checkin=2026-06-10&checkout=2026-06-15&adults=2
app.get("/hotels", async (req, res) => {
  const { city, checkin, checkout, adults = 2 } = req.query;

  if (!city || !checkin || !checkout) {
    return res.status(400).json({ error: "city, checkin et checkout sont requis" });
  }

  try {
    const hotels = await scrapeBooking({ city, checkin, checkout, adults: parseInt(adults) });
    res.json({ hotels, count: hotels.length });
  } catch (e) {
    console.error("Scraping error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ API hôtels prête sur le port ${PORT}`));
