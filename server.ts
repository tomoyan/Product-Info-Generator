import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

const formatGeminiErrorMessage = (err: any): string => {
  if (!err) return "Failed to process request. Please try again.";
  const raw = typeof err === "string" ? err : err.message || String(err);
  try {
    const jsonMatch = raw.match(/\{[\s\S]*"error"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed?.error?.message) {
        if (parsed.error.code === 503 || parsed.error.status === "UNAVAILABLE" || parsed.error.message.includes("high demand")) {
          return "The AI model is currently experiencing high demand. Please click Retry in a few seconds, or try entering the product name directly.";
        }
        if (parsed.error.code === 429 || parsed.error.status === "RESOURCE_EXHAUSTED") {
          return "API rate limit reached. Please wait a moment and click Retry.";
        }
        return parsed.error.message;
      }
    }
  } catch {
    // Ignore JSON parse errors
  }
  if (raw.includes("503") || raw.includes("UNAVAILABLE") || raw.includes("high demand")) {
    return "The AI model is currently experiencing temporary high demand. Please click Retry in a moment.";
  }
  return raw;
};

const callGeminiWithFallback = async (params: {
  contents: any;
  config?: any;
}) => {
  // Ordered by current availability and stability
  const models = [
    "gemini-3-flash-preview",
    "gemini-flash-lite-latest",
    "gemini-3.6-flash",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
    "gemini-flash-latest",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash"
  ];
  let lastErr: any = null;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await ai.models.generateContent({
          model,
          contents: params.contents,
          config: params.config,
        });
      } catch (err: any) {
        lastErr = err;
        const msg = err?.message || "";
        console.warn(`Model ${model} (attempt ${attempt + 1}) failed: ${msg}.`);
        const isHighDemandOrLimit = msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("429");
        if (isHighDemandOrLimit && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } else {
          break; // Try next model in list
        }
      }
    }
  }

  throw lastErr;
};

const extractJson = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
    if (match) {
      try {
        return JSON.parse(match[1].trim());
      } catch {
        const start = match[1].indexOf("{");
        const end = match[1].lastIndexOf("}");
        if (start !== -1 && end !== -1) {
          return JSON.parse(match[1].substring(start, end + 1));
        }
      }
    }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      return JSON.parse(text.substring(start, end + 1));
    }
    throw new Error("Failed to parse JSON from AI response");
  }
};

const roundUpDimensions = (raw?: string): string => {
  if (!raw) return "";
  let text = raw.trim();

  // If text doesn't contain cm/センチ and contains inch marks, convert to cm (1 in = 2.54 cm) and round up
  if (!/cm|センチ/i.test(text) && (/["”″]|(?:in|inch|inches)\b/i.test(text))) {
    text = text.replace(/(\d+(?:\.\d+)?)\s*(?:["”″]|(?:in|inch|inches)\b)/gi, (_, val) => {
      const num = parseFloat(val);
      if (isNaN(num)) return _;
      const cmVal = Math.ceil(num * 2.54);
      return `${cmVal}cm`;
    });
  }

  // Round up any decimal numbers to whole numbers (e.g., 10.2 -> 11, 25.4 -> 26, 0.5 -> 1)
  text = text.replace(/(\d+)\.(\d+)/g, (match) => {
    const num = parseFloat(match);
    return isNaN(num) ? match : Math.ceil(num).toString();
  });

  if (text && !text.startsWith("約")) {
    text = `約${text}`;
  }

  return text;
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "10mb" }));

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

    const fetchFromGemini = async () => {
      const response = await callGeminiWithFallback({
        contents: "What is the current USD/JPY exchange rate right now? Return strictly JSON with format {\"exchangeRate\": 152.5}",
        config: {
          tools: [{ googleSearch: {} }],
        },
      });
      const text = response?.text || (response?.candidates?.[0]?.content?.parts?.[0]?.text);
      if (!text) throw new Error("Empty rate response from AI");
      const parsed = extractJson(text);
      if (typeof parsed?.exchangeRate === "number") return parsed.exchangeRate;
      throw new Error("Could not parse rate from AI");
    };

    try {
      // Race the fast public APIs first, fallback to Gemini
      let rate: number;
      try {
        rate = await Promise.any([
          fetchFromExchangeRateApi(),
          fetchFromFrankfurter(),
        ]);
      } catch {
        rate = await fetchFromGemini();
      }

      cachedRate = rate;
      cacheTimestamp = Date.now();

      res.json({ exchangeRate: rate, cached: false });
    } catch (err: any) {
      console.error("Server-side exchange rate fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch exchange rate from all sources" });
    }
  });

  // API Route for Product Extraction / Analysis
  app.post("/api/analyze", async (req, res) => {
    const { input, rateInstruction } = req.body;
    if (!input || typeof input !== "string") {
      return res.status(400).json({ error: "Input is required" });
    }

    const trimmedInput = input.trim();
    const isUrl = trimmedInput.startsWith("http://") || trimmedInput.startsWith("https://");

    let pageContext = "";
    if (isUrl) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const htmlRes = await fetch(trimmedInput, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
          },
        });
        clearTimeout(timeout);
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
          const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
          const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
          const ldJsonMatch = html.match(/<script type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/i);

          const parts = [
            titleMatch ? `Page Title: ${titleMatch[1].trim()}` : "",
            ogTitleMatch ? `Product Title: ${ogTitleMatch[1].trim()}` : "",
            ogDescMatch ? `Product Description: ${ogDescMatch[1].trim()}` : "",
            descMatch ? `Description: ${descMatch[1].trim()}` : "",
            ldJsonMatch ? `Structured Data: ${ldJsonMatch[1].trim().slice(0, 1500)}` : "",
          ].filter(Boolean);

          if (parts.length > 0) {
            pageContext = `\nSource Webpage Context:\n${parts.join("\n")}\n`;
          }
        }
      } catch (fetchErr) {
        console.warn("Direct page fetch failed or timed out, continuing with prompt:", fetchErr);
      }
    }

    const prompt = `Extract product info from: ${trimmedInput}.${pageContext} ${rateInstruction || "Find the current USD/JPY market exchange rate and use it for calculations."}

Return the result as a valid JSON object formatted inside a \`\`\`json ... \`\`\` code block with this exact structure:
{
  "englishName": "Product name in English",
  "japaneseName": "Product name in Japanese",
  "usdPriceValue": 12.00,
  "exchangeRate": 150.5,
  "details": {
    "price": "$12.00",
    "id": "SKU or product code if available",
    "material": "Material in Japanese",
    "dimensions": "Dimensions in cm in Japanese with all numbers rounded up to whole numbers",
    "color": "Color in Japanese",
    "description": "Short 1-sentence summary in Japanese"
  }
}
CRITICAL REQUIREMENTS:
- Do not use special characters or trademark symbols like "®", "™", or similar in any text fields.
- MATERIAL: Focus on the main materials, listing up to two materials in Japanese. When analyzing shoes, specifically find the main material for the upper part and the bottom (sole) of the shoe.
- DIMENSIONS: Be extra careful and accurate with dimensions. Always express dimensions in cm (centimeters). If the source dimensions are in inches or other units, convert them to cm. All numbers must be rounded up to whole numbers (no decimals, e.g., 10.2 cm becomes 11 cm, 25.4 cm becomes 26 cm). Always add "約" in front of the dimensions in the "dimensions" field (e.g., 約W11 x H21 cm or 約25 x 30 x 10 cm).
- Output valid JSON only. Do not add markdown introductory or concluding text outside the code block.`;

    let response: any = null;
    let lastError: any = null;

    // Helper to generate content with fallback
    const generateWithTools = async (toolsConfig?: any[]) => {
      return await callGeminiWithFallback({
        contents: prompt,
        config: toolsConfig ? { tools: toolsConfig } : undefined,
      });
    };

    // Step 1: Direct prompt without tools (fastest, most reliable, avoids 429 tool quota exhaustion)
    try {
      response = await generateWithTools();
    } catch (err: any) {
      console.warn("Direct generation attempt failed, trying tool fallbacks:", err?.message || err);
      lastError = err;
    }

    // Step 2: Try urlContext if direct prompt failed and input was a URL
    if (!response && isUrl) {
      try {
        response = await generateWithTools([{ urlContext: {} }]);
      } catch (err: any) {
        console.warn("urlContext attempt failed, falling back to search:", err?.message || err);
        lastError = err;
      }
    }

    // Step 3: Try googleSearch if needed
    if (!response) {
      try {
        response = await generateWithTools([{ googleSearch: {} }]);
      } catch (err: any) {
        console.warn("googleSearch attempt failed:", err?.message || err);
        lastError = err;
      }
    }

    if (!response) {
      return res.status(500).json({
        error: lastError ? formatGeminiErrorMessage(lastError) : "Failed to analyze product. Please try again.",
      });
    }

    const text = response?.text || (response?.candidates?.[0]?.content?.parts?.[0]?.text);
    if (!text) {
      return res.status(500).json({ error: "Gemini returned an empty response. Please try again." });
    }

    try {
      const data = extractJson(text);

      // Sanitize fields
      if (typeof data.usdPriceValue === "string") {
        data.usdPriceValue = parseFloat(data.usdPriceValue.replace(/[^0-9.]/g, "")) || 0;
      }
      if (typeof data.exchangeRate === "string") {
        data.exchangeRate = parseFloat(data.exchangeRate.replace(/[^0-9.]/g, "")) || 150;
      }
      if (data.details) {
        if (data.details.dimensions) {
          data.details.dimensions = roundUpDimensions(data.details.dimensions);
        }
      } else {
        data.details = {};
      }

      return res.json({ data });
    } catch (parseErr) {
      console.error("Failed to parse JSON from AI response:", text);
      return res.status(500).json({ error: "Could not parse product data from AI response. Please try again." });
    }
  });

  // API Route for Translation
  app.post("/api/translate", async (req, res) => {
    const { text } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Text is required" });
    }

    try {
      const response = await callGeminiWithFallback({
        contents: `Translate the following product information into professional Japanese.
If it's a short product name, provide the Japanese name in "translatedName".
If it's a longer description, provide a simple, professional 1-2 sentence summary in Japanese in "translatedSummary".

Input: ${text}

Return the result as a JSON object:
{
  "translatedName": "Japanese name",
  "translatedSummary": "Japanese summary"
}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              translatedName: { type: Type.STRING },
              translatedSummary: { type: Type.STRING },
            },
          },
        },
      });

      const responseText = response?.text || (response?.candidates?.[0]?.content?.parts?.[0]?.text);
      if (!responseText) {
        return res.status(500).json({ error: "Empty translation response" });
      }

      const data = extractJson(responseText);
      return res.json({
        translatedName: data.translatedName,
        translatedSummary: data.translatedSummary,
      });
    } catch (err: any) {
      console.error("Translation API error:", err);
      return res.status(500).json({ error: `Translation failed: ${formatGeminiErrorMessage(err)}` });
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
