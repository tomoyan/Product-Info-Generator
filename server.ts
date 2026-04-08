import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Server-side cache
  let cachedRate: number | null = null;
  let cacheTimestamp: number = 0;
  const CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours

  // API Route for Exchange Rate
  app.get("/api/exchange-rate", async (req, res) => {
    const now = Date.now();
    if (cachedRate && (now - cacheTimestamp < CACHE_DURATION)) {
      return res.json({ exchangeRate: cachedRate, cached: true });
    }

    const apiKey = process.env.EXCHANGERATE_API_KEY || "1498718005475b8e15d33753";
    
    const fetchFromExchangeRateApi = async () => {
      const response = await fetch(`https://v6.exchangerate-api.com/v6/${apiKey}/latest/USD`);
      if (!response.ok) throw new Error(`ExchangeRate-API error: ${response.status}`);
      const data = await response.json();
      if (data?.result === "success" && data?.conversion_rates?.JPY) {
        return data.conversion_rates.JPY;
      }
      throw new Error("Invalid ExchangeRate-API structure");
    };

    const fetchFromFrankfurter = async () => {
      const response = await fetch("https://api.frankfurter.app/latest?from=USD&to=JPY");
      if (!response.ok) throw new Error(`Frankfurter error: ${response.status}`);
      const data = await response.json();
      if (data?.rates?.JPY) return data.rates.JPY;
      throw new Error("Invalid Frankfurter structure");
    };

    try {
      // Race the two fast APIs server-side (no CORS issues)
      const rate = await Promise.any([
        fetchFromExchangeRateApi(),
        fetchFromFrankfurter()
      ]);
      
      // Update server cache
      cachedRate = rate;
      cacheTimestamp = Date.now();
      
      res.json({ exchangeRate: rate, cached: false });
    } catch (err) {
      console.error("Server-side exchange rate fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch exchange rate from all sources" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
