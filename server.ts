import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

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
  // Ordered by lowest latency and active quota availability
  const models: Array<{ name: string; thinkingLevel?: ThinkingLevel; timeoutMs: number }> = [
    { name: "gemini-flash-lite-latest", timeoutMs: 9000 },
    { name: "gemini-3.1-flash-lite-preview", thinkingLevel: ThinkingLevel.MINIMAL, timeoutMs: 10000 },
    { name: "gemini-3.1-flash-lite", thinkingLevel: ThinkingLevel.MINIMAL, timeoutMs: 10000 },
    { name: "gemini-3.8-flash", thinkingLevel: ThinkingLevel.LOW, timeoutMs: 12000 },
    { name: "gemini-flash-latest", timeoutMs: 10000 },
  ];
  let lastErr: any = null;

  for (const modelSpec of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const mergedConfig: any = { ...(params.config || {}) };
        if (modelSpec.thinkingLevel && !mergedConfig.thinkingConfig) {
          mergedConfig.thinkingConfig = { thinkingLevel: modelSpec.thinkingLevel };
        }

        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`MODEL_TIMEOUT: ${modelSpec.name} exceeded ${modelSpec.timeoutMs}ms`)),
            modelSpec.timeoutMs
          );
        });

        return await Promise.race([
          ai.models.generateContent({
            model: modelSpec.name,
            contents: params.contents,
            config: mergedConfig,
          }),
          timeoutPromise,
        ]);
      } catch (err: any) {
        lastErr = err;
        const msg = err?.message || "";
        const isQuotaExceeded = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED");
        const isTimeout = msg.includes("MODEL_TIMEOUT");
        const isTransientUnavailable = msg.includes("503") || msg.includes("UNAVAILABLE");
        // Only retry once on fast 503; on timeout or 429 immediately switch to next model
        if (isTransientUnavailable && !isQuotaExceeded && !isTimeout && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        } else {
          break;
        }
      } finally {
        if (timer) clearTimeout(timer);
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
  if (!raw) return "N/A";
  let text = raw.trim();
  if (
    !text ||
    !/\d/.test(text) ||
    /^(?:n\/?a|none|null|undefined|-|約?-|約?n\/?a|不明|なし|該当なし|情報なし|記載なし|サイズ表記なし)$/i.test(text)
  ) {
    return "N/A";
  }

  // Convert inches to cm (1 in = 2.54 cm) and round up if cm is not already present
  if (!/cm|センチ/i.test(text) && (/["”″]|(?:\bin|\binch|\binches)\b/i.test(text))) {
    text = text.replace(/(\d+(?:\.\d+)?)\s*(?:["”″]|(?:\bin|\binch|\binches)\b)/gi, (_, val) => {
      const num = parseFloat(val);
      if (isNaN(num)) return _;
      const cmVal = Math.ceil(num * 2.54);
      return `${cmVal}cm`;
    });
  }

  // Convert mm to cm (10 mm = 1 cm) and round up if cm is not already present
  if (!/cm|センチ/i.test(text) && /\d+(?:\.\d+)?\s*mm\b/i.test(text)) {
    text = text.replace(/(\d+(?:\.\d+)?)\s*mm\b/gi, (_, val) => {
      const num = parseFloat(val);
      if (isNaN(num)) return _;
      const cmVal = Math.ceil(num / 10);
      return `${cmVal}cm`;
    });
  }

  // Round up any decimal numbers to whole numbers (e.g., 10.2 -> 11, 25.4 -> 26, 0.5 -> 1)
  text = text.replace(/(\d+)\.(\d+)/g, (match) => {
    const num = parseFloat(match);
    return isNaN(num) ? match : Math.ceil(num).toString();
  });

  if (text && !text.includes("約")) {
    text = `約${text}`;
  }

  return text;
};

// Scans full-length page text (before truncation) for any lines mentioning materials, fabrics, or dimensions/measurements
const extractSpecHighlights = (fullText: string): string => {
  if (!fullText) return "";
  const lines = fullText.split(/\n+/);
  const matched: string[] = [];
  const specRegex =
    /(?:material|fabric|composition|construction|shell|lining|upper|outsole|midsole|insole|footbed|leather|suede|canvas|cotton|polyester|nylon|spandex|elastane|wool|fleece|cashmere|silk|linen|denim|rayon|viscose|acrylic|polyurethane|faux|manmade|synthetic|rubber|eva|tpu|stainless|steel|aluminum|titanium|brass|metal|alloy|silicone|polyethylene|polycarbonate|resin|wood|ceramic|glass|dimension|measurement|spec|exterior|interior|width|height|depth|length|diameter|circumference|capacity|weight|drop|strap|handle|inseam|waist|chest|アウトソール|アッパー|素材|材質|生地|寸法|サイズ|幅|高さ|奥行|マチ|全長|\d+(?:\.\d+)?\s*(?:cm|mm|in|inch|inches|["”″])\b|\d+(?:\.\d+)?\s*[x×]\s*\d+)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length < 3 || line.length > 500) continue;
    if (
      /cookie|privacy|shipping on orders|reward points|clearance|accessibility|write a review|customer rating|ask owners|forgot password|sign in|log in|subscribe|newsletter|terms of use/i.test(
        line
      )
    ) {
      continue;
    }
    if (specRegex.test(line)) {
      const prev = i > 0 ? lines[i - 1].trim() : "";
      const next = i + 1 < lines.length ? lines[i + 1].trim() : "";
      const context = [
        prev && prev.length < 120 ? prev : "",
        line,
        next && next.length < 180 ? next : "",
      ]
        .filter(Boolean)
        .join(" | ");
      if (!matched.includes(context)) {
        matched.push(context);
      }
    }
  }
  return matched.slice(0, 45).join("\n");
};

// Extracts embedded JSON fields (from Next.js __NEXT_DATA__, Shopify JSON, Demandware, etc.) related to materials & dimensions
const extractEmbeddedSpecJson = (html: string): string => {
  if (!html) return "";
  const snippets: string[] = [];
  const keyRegex =
    /"(?:material|materials|fabric|composition|dimensions|dimension|measurements|measurement|specifications|specs|sizeAndFit|careAndMaterials|features|bullets|detailBullets|exteriorDimensions|interiorDimensions|width|height|depth|length)"\s*:\s*("[^"]{2,400}"|\[[^\]]{2,600}\]|\{[^{}]{2,600}\})/gi;
  let match: RegExpExecArray | null;
  while ((match = keyRegex.exec(html)) !== null && snippets.length < 25) {
    const cleaned = match[0].replace(/\\n|\\r|\\t/g, " ").replace(/\s+/g, " ").trim();
    if (!snippets.includes(cleaned)) {
      snippets.push(cleaned);
    }
  }
  return snippets.join("\n");
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
      const isBotBlockText = (sample: string): boolean =>
        /Access to this page has been denied|Access Denied|Target URL returned error 403|requiring CAPTCHA|confirm you are\s+a human|Press & Hold|Attention Required|Just a moment|Security Challenge|Pardon Our Interruption|Verify you are human|Robot or human/i.test(
          sample
        );

      const fetchViaJinaReader = async (): Promise<string> => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7500);
        try {
          const readerRes = await fetch(`https://r.jina.ai/${trimmedInput}`, {
            signal: controller.signal,
            headers: {
              "X-Remove-Selector": "header, nav, footer, #onetrust-consent-sdk",
              "X-Retain-Images": "none",
              "Accept": "text/plain",
            },
          });
          if (!readerRes.ok) return "";
          const text = await readerRes.text();
          if (!text || text.length < 150 || isBotBlockText(text.slice(0, 800))) {
            return "";
          }
          // Strip markdown link URLs [label](url) -> label and remove trailing cookie preference banners
          const cleaned = text
            .replace(/##\s*Privacy Preference Center[\s\S]*$/i, "")
            .replace(/\[([^\]]*)\]\([^)]+\)/g, "$1")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

          if (cleaned.length < 150 || isBotBlockText(cleaned.slice(0, 600))) {
            return "";
          }

          // Extract all Material & Dimension lines from the FULL untruncated page first so specs past char 12,000 are never lost
          const specHighlights = extractSpecHighlights(cleaned);
          const bodySlice = cleaned.slice(0, 14000);
          return specHighlights
            ? `=== HIGHLIGHTED SPECS, MATERIALS & DIMENSIONS FROM PAGE ===\n${specHighlights}\n\n=== FULL PAGE TEXT ===\n${bodySlice}`
            : bodySlice;
        } catch {
          return "";
        } finally {
          clearTimeout(timeout);
        }
      };

      const fetchShopifyJson = async (): Promise<string> => {
        if (!/\/products\/[^/?#]+/i.test(trimmedInput)) return "";
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        try {
          const urlObj = new URL(trimmedInput);
          const jsonUrl = `${urlObj.origin}${urlObj.pathname.replace(/\/$/, "")}.json`;
          const r = await fetch(jsonUrl, {
            signal: controller.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              "Accept": "application/json",
            },
          });
          if (!r.ok) return "";
          const data = await r.json();
          const p = data?.product;
          if (!p) return "";
          const bodyText = (p.body_html || "")
            .replace(/<[^>]+>/g, "\n")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/\n{2,}/g, "\n")
            .trim();
          const variantPrices = Array.isArray(p.variants)
            ? p.variants.slice(0, 5).map((v: any) => `${v.title}: $${v.price} (SKU: ${v.sku || "N/A"})`).join(", ")
            : "";
          return [
            p.title ? `Shopify Product Title: ${p.title}` : "",
            p.vendor ? `Brand: ${p.vendor}` : "",
            p.product_type ? `Type: ${p.product_type}` : "",
            variantPrices ? `Variants & Price: ${variantPrices}` : "",
            p.tags ? `Tags: ${p.tags}` : "",
            bodyText ? `Product Description & Specs:\n${bodyText}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        } catch {
          return "";
        } finally {
          clearTimeout(timeout);
        }
      };

      const fetchDirectMetadata = async (): Promise<string> => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        try {
          const htmlRes = await fetch(trimmedInput, {
            signal: controller.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
            },
          });
          if (!htmlRes.ok) return "";
          const html = await htmlRes.text();
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          const titleText = titleMatch ? titleMatch[1].trim() : "";

          // Detect Cloudflare / PerimeterX / Akamai bot challenge pages
          if (isBotBlockText(titleText) || isBotBlockText(html.slice(0, 1200))) {
            return "";
          }

          const ogTitleMatch = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i) ||
                               html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:title["']/i);
          const ogDescMatch = html.match(/<meta\s+(?:property|name)=["']og:description["']\s+content=["']([^"']+)["']/i) ||
                              html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:description["']/i);
          const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) ||
                            html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
          const ldJsonMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
          const ldJsonText = ldJsonMatches.map((m) => m[1].trim()).join("\n").slice(0, 5000);

          // Extract embedded JSON specs (Next.js, Demandware, etc.) and visible HTML body text so materials & dimensions in tabs/accordions are captured
          const embeddedJsonSpecs = extractEmbeddedSpecJson(html);
          const cleanedBodyText = html
            .replace(/<script[\s\S]*?<\/script>/gi, "\n")
            .replace(/<style[\s\S]*?<\/style>/gi, "\n")
            .replace(/<svg[\s\S]*?<\/svg>/gi, "")
            .replace(/<(?:header|nav|footer)[\s\S]*?<\/(?:header|nav|footer)>/gi, "\n")
            .replace(/<[^>]+>/g, "\n")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/[ \t]+/g, " ")
            .replace(/\n\s*\n+/g, "\n")
            .trim();

          const bodySpecHighlights = extractSpecHighlights(cleanedBodyText);

          if (!ldJsonText && !ogDescMatch && !descMatch && !bodySpecHighlights) {
            return "";
          }

          const parts = [
            titleText ? `Page Title: ${titleText}` : "",
            ogTitleMatch ? `Product Title: ${ogTitleMatch[1].trim()}` : "",
            ogDescMatch ? `Product Description: ${ogDescMatch[1].trim()}` : "",
            descMatch ? `Description: ${descMatch[1].trim()}` : "",
            ldJsonText ? `Structured Data: ${ldJsonText}` : "",
            embeddedJsonSpecs ? `Embedded Product Specs JSON:\n${embeddedJsonSpecs}` : "",
            bodySpecHighlights ? `Highlighted Specs (Material / Dimensions) from HTML:\n${bodySpecHighlights}` : "",
            cleanedBodyText ? `HTML Body Text Excerpt:\n${cleanedBodyText.slice(0, 6000)}` : "",
          ].filter(Boolean);

          return parts.join("\n\n");
        } catch {
          return "";
        } finally {
          clearTimeout(timeout);
        }
      };

      try {
        // Run direct HTML metadata, Jina Reader, and Shopify JSON check in parallel
        const [directContent, readerContent, shopifyContent] = await Promise.all([
          fetchDirectMetadata(),
          fetchViaJinaReader(),
          fetchShopifyJson(),
        ]);
        const sections = [
          shopifyContent ? `[Shopify Product Data]\n${shopifyContent}` : "",
          directContent ? `[Direct HTML Metadata & Specs]\n${directContent}` : "",
          readerContent ? `[Rendered Page Content]\n${readerContent}` : "",
        ].filter(Boolean);

        if (sections.length > 0) {
          pageContext = `\n\n--- SOURCE WEBPAGE CONTENT ---\n${sections.join("\n\n")}\n--- END SOURCE WEBPAGE CONTENT ---\n`;
        }
      } catch (fetchErr) {
        console.warn("Page context extraction failed, continuing:", fetchErr);
      }
    }

    const prompt = `Extract accurate product info for: ${trimmedInput}.${pageContext}
${rateInstruction || "Find the current USD/JPY market exchange rate and use it for calculations."}

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
    "description": "Detailed 3-4 sentence product description in Japanese"
  }
}
CRITICAL REQUIREMENTS:
- PRIMARY PRODUCT ONLY: Extract ONLY the main product matching the URL / Page Title / main H1 heading. Ignore any "Add the essentials", "Related Products", "Complete the Look", or upsell items on the page.
- Do not use special characters or trademark symbols like "®", "™", or similar in any text fields.
- MATERIAL (VERY IMPORTANT): Search the entire page content, highlighted specs, bullet points, and product description carefully for any material, fabric, composition, shell, lining, hardware, or construction details (e.g., cotton, polyester, leather, faux leather, manmade materials, nylon, fleece, suede, rubber, stainless steel, polyethylene, etc.). Translate and list up to two main materials in Japanese (for example, "Manmade materials" -> "合成素材", "Faux leather" -> "合成皮革", "100% post-consumer recycled materials / fleece" -> "リサイクル素材（フリース）"). When analyzing shoes, specifically find the main material for the upper part and the bottom (sole) of the shoe. Only set "material" to "N/A" if there is truly zero mention of material or fabric anywhere.
- DIMENSIONS (VERY IMPORTANT): Search the entire page content, highlighted specs, bullet points, and description carefully for any measurements or dimensions (such as width, height, depth, length, diameter, exterior/interior dimensions, strap/handle drop, belt width, sole thickness, etc.). Always express dimensions ONLY in cm (centimeters) in Japanese — do NOT include inch values alongside cm. If the source dimensions are in inches or mm, convert them to cm (1 inch = 2.54 cm, 10 mm = 1 cm). All numbers must be rounded up to whole numbers (no decimals, e.g., 10.2 cm becomes 11 cm, 25.4 cm becomes 26 cm). Always include "約" in front of the dimensions in the "dimensions" field (e.g., 約W11 x H21 cm or 約65 x 41 x 40 cm). Only set "dimensions" to "N/A" if no numerical measurements exist for this product.
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

    // For URLs: always try urlContext first (which combines any extracted pageContext in the prompt with Google's URL index)
    if (isUrl) {
      try {
        response = await generateWithTools([{ urlContext: {} }]);
      } catch (err: any) {
        lastError = err;
      }
    }

    // Next, if non-URL or if urlContext failed, run direct prompt with extracted pageContext
    if (!response && (!isUrl || pageContext)) {
      try {
        response = await generateWithTools();
      } catch (err: any) {
        lastError = err;
      }
    }

    // Try googleSearch if needed
    if (!response) {
      try {
        response = await generateWithTools([{ googleSearch: {} }]);
      } catch (err: any) {
        lastError = err;
      }
    }

    // Final fallback to direct prompt if tools failed
    if (!response) {
      try {
        response = await generateWithTools();
      } catch (err: any) {
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
      if (!data.details || typeof data.details !== "object") {
        data.details = {};
      }
      const rawMaterial = typeof data.details.material === "string" ? data.details.material.trim() : "";
      data.details.material =
        !rawMaterial || /^(?:n\/?a|none|null|undefined|-|不明|なし|該当なし|情報なし)$/i.test(rawMaterial)
          ? "N/A"
          : rawMaterial;
      data.details.dimensions = roundUpDimensions(data.details.dimensions);

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
