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
  const hasTools = Boolean(params.config?.tools && params.config.tools.length > 0);

  // When tools (urlContext / googleSearch) are requested, try at most 2 fast models with a 4s timeout so blocked URLs never stall
  const models: Array<{ name: string; thinkingLevel?: ThinkingLevel; timeoutMs: number }> = hasTools
    ? [
        { name: "gemini-flash-lite-latest", thinkingLevel: ThinkingLevel.MINIMAL, timeoutMs: 4000 },
        { name: "gemini-3.6-flash", thinkingLevel: ThinkingLevel.LOW, timeoutMs: 4000 },
      ]
    : [
        { name: "gemini-3.6-flash", thinkingLevel: ThinkingLevel.LOW, timeoutMs: 7500 },
        { name: "gemini-3.5-flash", thinkingLevel: ThinkingLevel.LOW, timeoutMs: 7500 },
        { name: "gemini-flash-lite-latest", thinkingLevel: ThinkingLevel.MINIMAL, timeoutMs: 7000 },
        { name: "gemini-3.1-flash-lite-preview", thinkingLevel: ThinkingLevel.MINIMAL, timeoutMs: 7000 },
        { name: "gemini-3.5-flash-lite", thinkingLevel: ThinkingLevel.MINIMAL, timeoutMs: 7000 },
      ];
  let lastErr: any = null;

  for (const modelSpec of models) {
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
      // Immediately advance to the next model on any error or timeout
    } finally {
      if (timer) clearTimeout(timer);
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

// Scans full-length text (including long paragraphs > 500 chars) specifically for Material, Fabric, Composition, and Construction details
const extractMaterialCandidates = (fullText: string): string => {
  if (!fullText) return "";
  const matched: string[] = [];

  // Break text into lines and sentences so long paragraphs (> 500 chars) are never skipped
  const segments = fullText
    .split(/[\n\r]+|(?<=[.!?])\s+|\s*[•\u2022]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const materialRegex =
    /(?:\b\d{1,3}\s*%\s*[a-zA-Z]+|\b(?:material|materials|fabric|fabrics|composition|construction|crafted\s+from|made\s+(?:from|of|with)|shell|lining|fill|insulation|trim|upper|outsole|midsole|insole|footbed|sockliner|leather|calfskin|lambskin|goatskin|cowhide|pebbled|saffiano|nappa|patent|suede|nubuck|shearling|sheepskin|vegan\s+leather|faux\s+leather|faux\s+fur|manmade|man-made|synthetic|canvas|cotton|organic\s+cotton|denim|chambray|corduroy|twill|linen|flax|hemp|jute|raffia|straw|silk|satin|velvet|velour|chiffon|lace|mesh|jersey|french\s+terry|terry|fleece|sherpa|wool|merino|cashmere|alpaca|mohair|polyester|recycled\s+polyester|nylon|polyamide|cordura|ripstop|gore-tex|primaloft|neoprene|spandex|elastane|lycra|rayon|viscose|modal|lyocell|tencel|cupro|acetate|acrylic|polyurethane|down|feather|rubber|vibram|vulcanized|eva|tpu|tpr|foam|cork|stainless\s+steel|steel|titanium|aluminum|aluminium|brass|copper|bronze|sterling\s+silver|silver|14k|18k|24k|gold\s+plated|platinum|rhodium|zinc|alloy|metal|hardware|ceramic|porcelain|enamel|glass|crystal|zirconia|pearl|silicone|polyethylene|polycarbonate|polypropylene|tritan|resin|abs|carbon\s+fiber|fiberglass|wood|bamboo)\b|素材|材質|生地|アッパー|アウトソール|裏地|本体|天然皮革|合成皮革|合成繊維|合成底|ゴム底|綿|ポリエステル|ナイロン|ウール|シルク|麻|牛革|羊革|山羊革|豚革)/i;

  const noiseRegex =
    /cookie|privacy\s+policy|privacy\s+preference|shipping\s+on\s+orders|reward\s+points|join\s+.*rewards|download\s+the\s+app|enable\s+accessibility|write\s+a\s+review|be\s+the\s+first\s+to\s+review|customer\s+rating|questions\s*&\s*answers|ask\s+owners|forgot\s+password|sign\s+in|log\s+in|subscribe|newsletter|terms\s+of\s+use|gift\s+card|store\s+locator|buy\s+now\s+pay\s+later|klarna|afterpay|affirm/i;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.length < 3 || noiseRegex.test(seg)) continue;

    if (materialRegex.test(seg)) {
      if (seg.length <= 450) {
        const prev = i > 0 && segments[i - 1].length < 100 && !noiseRegex.test(segments[i - 1]) ? segments[i - 1] : "";
        const next = i + 1 < segments.length && segments[i + 1].length < 140 && !noiseRegex.test(segments[i + 1]) ? segments[i + 1] : "";
        const combined = [prev, seg, next].filter(Boolean).join(" | ");
        if (!matched.includes(combined)) {
          matched.push(combined);
        }
      } else {
        // For very long segments, extract windows around every material match
        const globalMat = new RegExp(materialRegex.source, "gi");
        let m: RegExpExecArray | null;
        while ((m = globalMat.exec(seg)) !== null && matched.length < 40) {
          const start = Math.max(0, m.index - 120);
          const end = Math.min(seg.length, m.index + m[0].length + 180);
          const windowText = seg.slice(start, end).trim();
          if (!noiseRegex.test(windowText) && !matched.includes(windowText)) {
            matched.push(windowText);
          }
        }
      }
    }
    if (matched.length >= 40) break;
  }

  return matched.join("\n");
};

// Scans full-length text specifically for Dimensions, Measurements, and Numerical Sizes
const extractDimensionCandidates = (fullText: string): string => {
  if (!fullText) return "";
  const matched: string[] = [];

  const segments = fullText
    .split(/[\n\r]+|(?<=[.!?])\s+|\s*[•\u2022]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const dimRegex =
    /(?:\b(?:dimension|dimensions|measurement|measurements|exterior|interior|width|height|depth|length|diameter|circumference|handle\s+drop|strap\s+drop|belt\s+width|sole\s+height|heel\s+height|platform\s+height|inseam|waist|chest|capacity)\b|\d+(?:\.\d+)?\s*(?:cm|mm|in|inch|inches|["”″])\b|\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?|寸法|外寸|内寸|実寸|幅|高さ|奥行|マチ|全長|縦|横|厚み)/i;

  const noiseRegex =
    /cookie|privacy|shipping\s+on\s+orders|reward\s+points|write\s+a\s+review|customer\s+rating|ask\s+owners|forgot\s+password|sign\s+in|log\s+in|Model\s+is\s+\d/i;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.length < 3 || seg.length > 500 || noiseRegex.test(seg)) continue;
    if (dimRegex.test(seg)) {
      const prev = i > 0 && segments[i - 1].length < 100 && !noiseRegex.test(segments[i - 1]) ? segments[i - 1] : "";
      const next = i + 1 < segments.length && segments[i + 1].length < 140 && !noiseRegex.test(segments[i + 1]) ? segments[i + 1] : "";
      const combined = [prev, seg, next].filter(Boolean).join(" | ");
      if (!matched.includes(combined)) {
        matched.push(combined);
      }
    }
    if (matched.length >= 30) break;
  }

  return matched.join("\n");
};

// Extracts embedded JSON fields and fabric percentage strings from raw HTML (including <script> hydration state like __NEXT_DATA__, Shopify, Demandware)
const extractEmbeddedSpecJson = (html: string): string => {
  if (!html) return "";
  const boundedHtml = html.slice(0, 250000);
  const snippets: string[] = [];

  // 1. Direct JSON property matches for material/fabric/dimensions/specs
  const keyRegex =
    /"(?:material|materials|fabric|fabrics|composition|care|careInstructions|careAndMaterials|upperMaterial|soleMaterial|outsoleMaterial|liningMaterial|outerMaterial|shellMaterial|bodyMaterial|hardwareMaterial|dimensions|dimension|measurements|measurement|specifications|specs|sizeAndFit|features|bullets|detailBullets|productDetails| exteriorDimensions|interiorDimensions|width|height|depth|length)"\s*:\s*("[^"]{2,400}"|\[[^\]]{2,600}\]|\{[^{}]{2,600}\})/gi;
  let match: RegExpExecArray | null;
  while ((match = keyRegex.exec(boundedHtml)) !== null && snippets.length < 30) {
    const cleaned = match[0]
      .replace(/\\u002F/gi, "/")
      .replace(/\\u0026/gi, "&")
      .replace(/\\n|\\r|\\t/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!snippets.includes(cleaned)) {
      snippets.push(cleaned);
    }
  }

  // 2. Structured key/value attribute objects: match the attribute name token first, then grab surrounding 350 chars
  const attrKeyRegex =
    /"(?:name|label|title|key|header|heading|attribute_code)"\s*:\s*"(?:material|materials|fabric|composition|care\s*&\s*materials|details|specifications|dimensions|measurements|size\s*&\s*fit)"/gi;
  while ((match = attrKeyRegex.exec(boundedHtml)) !== null && snippets.length < 45) {
    const rawSlice = boundedHtml.slice(Math.max(0, match.index - 20), Math.min(boundedHtml.length, match.index + 380));
    const cleaned = rawSlice
      .replace(/\\n|\\r|\\t/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!snippets.includes(cleaned)) {
      snippets.push(cleaned);
    }
  }

  // 3. Explicit fabric composition percentages anywhere in HTML/scripts (e.g. "100% Cotton", "80% Recycled Polyester")
  const pctRegex =
    /\b\d{1,3}\s*%\s*(?:organic\s+|recycled\s+|post-consumer\s+)?(?:cotton|polyester|nylon|polyamide|wool|merino|cashmere|silk|linen|flax|viscose|rayon|modal|lyocell|tencel|elastane|spandex|lycra|leather|calfskin|lambskin|suede|acrylic|polyurethane|down|feather|hemp|jute|raffia|canvas|fleece|rubber|eva|silicone|polyethylene|stainless\s+steel)\b/gi;
  while ((match = pctRegex.exec(boundedHtml)) !== null && snippets.length < 60) {
    const start = Math.max(0, match.index - 40);
    const end = Math.min(boundedHtml.length, match.index + match[0].length + 80);
    const rawSlice = boundedHtml.slice(start, end).replace(/[<>{}"\n\r\\]/g, " ").replace(/\s+/g, " ").trim();
    if (rawSlice.length >= 6 && !snippets.includes(`Composition: ${rawSlice}`)) {
      snippets.push(`Composition: ${rawSlice}`);
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
    let aggregatedMaterialHints = "";
    let aggregatedDimensionHints = "";

    if (isUrl) {
      const isHardBotBlock = (sample: string): boolean =>
        /Access to this page has been denied|Access Denied|requiring CAPTCHA|confirm you are\s+a human|Press & Hold|Attention Required|Just a moment|Security Challenge|Pardon Our Interruption|Verify you are human|Robot or human/i.test(
          sample
        );

      const fetchViaJinaReader = async (): Promise<{ content: string; matHints: string; dimHints: string }> => {
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
          if (!readerRes.ok) return { content: "", matHints: "", dimHints: "" };
          const text = await readerRes.text();
          if (!text || text.length < 150) {
            return { content: "", matHints: "", dimHints: "" };
          }

          // Strip Jina's "Warning: ..." metadata lines, markdown link URLs [label](url) -> label, and trailing cookie preference banners
          const cleaned = text
            .replace(/^Warning:.*$/gm, "")
            .replace(/##\s*Privacy Preference Center[\s\S]*$/i, "")
            .replace(/\[([^\]]*)\]\([^)]+\)/g, "$1")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

          // Reject if it's a short block page or contains CAPTCHA challenge text without real product content
          if (cleaned.length < 250 || (cleaned.length < 1200 && isHardBotBlock(cleaned))) {
            return { content: "", matHints: "", dimHints: "" };
          }

          // Scan the FULL untruncated page text for Material and Dimension candidates so specs past char 14,000 are never lost
          const matHints = extractMaterialCandidates(cleaned);
          const dimHints = extractDimensionCandidates(cleaned);
          const bodySlice = cleaned.slice(0, 14000);
          return { content: bodySlice, matHints, dimHints };
        } catch {
          return { content: "", matHints: "", dimHints: "" };
        } finally {
          clearTimeout(timeout);
        }
      };

      const fetchShopifyJson = async (): Promise<{ content: string; matHints: string; dimHints: string }> => {
        if (!/\/products\/[^/?#]+/i.test(trimmedInput)) return { content: "", matHints: "", dimHints: "" };
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
          if (!r.ok) return { content: "", matHints: "", dimHints: "" };
          const data = await r.json();
          const p = data?.product;
          if (!p) return { content: "", matHints: "", dimHints: "" };
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
          const content = [
            p.title ? `Shopify Product Title: ${p.title}` : "",
            p.vendor ? `Brand: ${p.vendor}` : "",
            p.product_type ? `Type: ${p.product_type}` : "",
            variantPrices ? `Variants & Price: ${variantPrices}` : "",
            p.tags ? `Tags: ${p.tags}` : "",
            bodyText ? `Product Description & Specs:\n${bodyText}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          return {
            content,
            matHints: extractMaterialCandidates(content),
            dimHints: extractDimensionCandidates(content),
          };
        } catch {
          return { content: "", matHints: "", dimHints: "" };
        } finally {
          clearTimeout(timeout);
        }
      };

      const fetchDirectMetadata = async (): Promise<{ content: string; matHints: string; dimHints: string }> => {
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
          if (!htmlRes.ok) return { content: "", matHints: "", dimHints: "" };
          const html = await htmlRes.text();
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          const titleText = titleMatch ? titleMatch[1].trim() : "";

          // Detect Cloudflare / PerimeterX / Akamai bot challenge pages
          if (isHardBotBlock(titleText) || (html.length < 5000 && isHardBotBlock(html.slice(0, 1500)))) {
            return { content: "", matHints: "", dimHints: "" };
          }

          const ogTitleMatch = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i) ||
                               html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:title["']/i);
          const ogDescMatch = html.match(/<meta\s+(?:property|name)=["']og:description["']\s+content=["']([^"']+)["']/i) ||
                              html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:description["']/i);
          const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) ||
                            html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
          const ldJsonMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
          const ldJsonText = ldJsonMatches.map((m) => m[1].trim()).join("\n").slice(0, 5000);

          // Extract embedded JSON specs (Next.js, Demandware, etc.) and visible HTML body text
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

          const matHints = [
            embeddedJsonSpecs,
            extractMaterialCandidates(ldJsonText),
            extractMaterialCandidates(cleanedBodyText),
          ]
            .filter(Boolean)
            .join("\n");
          const dimHints = [
            extractDimensionCandidates(ldJsonText),
            extractDimensionCandidates(cleanedBodyText),
          ]
            .filter(Boolean)
            .join("\n");

          if (!ldJsonText && !ogDescMatch && !descMatch && !matHints && !dimHints) {
            return { content: "", matHints: "", dimHints: "" };
          }

          const parts = [
            titleText ? `Page Title: ${titleText}` : "",
            ogTitleMatch ? `Product Title: ${ogTitleMatch[1].trim()}` : "",
            ogDescMatch ? `Product Description: ${ogDescMatch[1].trim()}` : "",
            descMatch ? `Description: ${descMatch[1].trim()}` : "",
            ldJsonText ? `Structured Data: ${ldJsonText}` : "",
            cleanedBodyText ? `HTML Body Text Excerpt:\n${cleanedBodyText.slice(0, 6000)}` : "",
          ].filter(Boolean);

          return { content: parts.join("\n\n"), matHints, dimHints };
        } catch {
          return { content: "", matHints: "", dimHints: "" };
        } finally {
          clearTimeout(timeout);
        }
      };

      try {
        const [directRes, readerRes, shopifyRes] = await Promise.all([
          fetchDirectMetadata(),
          fetchViaJinaReader(),
          fetchShopifyJson(),
        ]);

        aggregatedMaterialHints = [shopifyRes.matHints, directRes.matHints, readerRes.matHints]
          .filter(Boolean)
          .join("\n")
          .slice(0, 5000);
        aggregatedDimensionHints = [shopifyRes.dimHints, directRes.dimHints, readerRes.dimHints]
          .filter(Boolean)
          .join("\n")
          .slice(0, 3500);

        const sections = [
          aggregatedMaterialHints
            ? `=== EXTRACTED MATERIAL & FABRIC CANDIDATES FROM PAGE (HIGH PRIORITY) ===\n${aggregatedMaterialHints}`
            : "",
          aggregatedDimensionHints
            ? `=== EXTRACTED DIMENSION & MEASUREMENT CANDIDATES FROM PAGE (HIGH PRIORITY) ===\n${aggregatedDimensionHints}`
            : "",
          shopifyRes.content ? `[Shopify Product Data]\n${shopifyRes.content}` : "",
          directRes.content ? `[Direct HTML Metadata]\n${directRes.content}` : "",
          readerRes.content ? `[Rendered Page Content]\n${readerRes.content}` : "",
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
- MATERIAL (HIGHEST PRIORITY): Carefully check the "EXTRACTED MATERIAL & FABRIC CANDIDATES FROM PAGE" section as well as the product title, bullet points, and description. Look for ANY fabric percentages (e.g. "100% Cotton", "80% Polyester"), leather types ("Faux leather", "Pebbled leather", "Suede"), synthetic/manmade materials ("Manmade materials", "Recycled materials", "Polyethylene", "EVA", "Rubber"), metals ("Stainless steel", "Brass", "Silver"), or garment/shoe parts (upper/outsole, shell/lining). Translate and list up to two main materials in Japanese (e.g. "Faux leather / Manmade materials" -> "合成皮革、合成素材", "100% Cotton" -> "コットン100%"). Even if the material is only mentioned inside the prose description (e.g. "Crafted from faux leather..." or "Made of 100% recycled polyester") or in the product name (e.g. "Fleece", "Leather", "Denim", "Canvas"), you MUST extract and translate that material into Japanese! Never output "N/A" if any material, fabric, or construction clue exists on the page.
- DIMENSIONS (HIGHEST PRIORITY): Carefully check the "EXTRACTED DIMENSION & MEASUREMENT CANDIDATES FROM PAGE" section and product details for any numerical measurements (width, height, depth, length, diameter, exterior/interior dimensions, strap/handle drop, belt width, sole height, etc.). Always express dimensions ONLY in cm (centimeters) in Japanese — do NOT include inch values alongside cm. Convert inches (1 in = 2.54 cm) or mm (10 mm = 1 cm) to cm and round ALL numbers up to whole numbers (e.g., 10.2 cm -> 11 cm, 25.4 cm -> 26 cm). Always prefix with "約" (e.g., 約W65 x D41 x H40 cm). Set "dimensions" to "N/A" ONLY if no numerical measurements exist for this product.
- Output valid JSON only. Do not add markdown introductory or concluding text outside the code block.`;

    let response: any = null;
    let lastError: any = null;
    let usedUrlContext = false;

    // Helper to generate content with fallback
    const generateWithTools = async (toolsConfig?: any[], customPrompt?: string) => {
      return await callGeminiWithFallback({
        contents: customPrompt || prompt,
        config: toolsConfig ? { tools: toolsConfig } : undefined,
      });
    };

    // If we have rich extracted pageContext (>= 500 chars), run direct prompt first so the model focuses 100% on the scraped page & material candidates
    if (!isUrl || (pageContext && pageContext.length >= 500)) {
      try {
        response = await generateWithTools();
      } catch (err: any) {
        lastError = err;
      }
    }

    // If URL and pageContext was empty/blocked (or direct prompt failed), use urlContext
    if (!response && isUrl) {
      try {
        usedUrlContext = true;
        response = await generateWithTools([{ urlContext: {} }]);
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

      const isMissingField = (val: any): boolean => {
        if (!val || typeof val !== "string") return true;
        const t = val.trim();
        return !t || /^(?:n\/?a|none|null|undefined|-|約?-|約?n\/?a|不明|なし|該当なし|情報なし|記載なし|サイズ表記なし)$/i.test(t);
      };

      const inferMaterialFromText = (sourceText: string): string => {
        if (!sourceText) return "";
        const found: string[] = [];
        const addMat = (jp: string) => {
          if (jp && !found.includes(jp) && found.length < 2) found.push(jp);
        };

        // 1. Check explicit percentage compositions first (e.g. "100% Cotton" -> "コットン100%")
        const pctMap: Array<[RegExp, string]> = [
          [/\b(\d{1,3})\s*%\s*(?:organic\s+)?cotton\b/i, "コットン"],
          [/\b(\d{1,3})\s*%\s*recycled\s+polyester\b/i, "リサイクルポリエステル"],
          [/\b(\d{1,3})\s*%\s*polyester\b/i, "ポリエステル"],
          [/\b(\d{1,3})\s*%\s*(?:nylon|polyamide)\b/i, "ナイロン"],
          [/\b(\d{1,3})\s*%\s*(?:merino\s+)?wool\b/i, "ウール"],
          [/\b(\d{1,3})\s*%\s*cashmere\b/i, "カシミヤ"],
          [/\b(\d{1,3})\s*%\s*silk\b/i, "シルク"],
          [/\b(\d{1,3})\s*%\s*(?:linen|flax)\b/i, "リネン（麻）"],
          [/\b(\d{1,3})\s*%\s*(?:viscose|rayon|modal|lyocell|tencel)\b/i, "レーヨン"],
          [/\b(\d{1,3})\s*%\s*(?:spandex|elastane|lycra)\b/i, "ポリウレタン（スパンデックス）"],
          [/\b(\d{1,3})\s*%\s*acrylic\b/i, "アクリル"],
          [/\b(\d{1,3})\s*%\s*leather\b/i, "レザー（本革）"],
          [/\b(\d{1,3})\s*%\s*(?:post-consumer\s+)?recycled\s+materials?\b/i, "リサイクル素材"],
        ];
        for (const [rx, jpName] of pctMap) {
          const m = sourceText.match(rx);
          if (m) addMat(`${jpName}${m[1]}%`);
        }

        // 2. Check material keywords in priority order
        const keywordMap: Array<[RegExp, string]> = [
          [/\b(?:faux\s+leather|vegan\s+leather|synthetic\s+leather|pu\s+leather|polyurethane\s+leather)\b|合皮|合成皮革|フェイクレザー/i, "合成皮革"],
          [/\b(?:full[- ]grain\s+leather|top[- ]grain\s+leather|pebbled\s+leather|saffiano\s+leather|nappa\s+leather|patent\s+leather|genuine\s+leather|calfskin|lambskin|goatskin|cowhide|leather)\b|天然皮革|本革|牛革|羊革|レザー/i, "レザー（本革）"],
          [/\b(?:suede|nubuck)\b|スエード|ヌバック/i, "スエード"],
          [/\b(?:primaloft|fleece|sherpa)\b|フリース/i, "フリース（ポリエステル）"],
          [/\b(?:recycled\s+polyester)\b|リサイクルポリエステル/i, "リサイクルポリエステル"],
          [/\b(?:organic\s+cotton|cotton|denim|chambray|corduroy|french\s+terry)\b|コットン|綿|デニム/i, "コットン"],
          [/\b(?:polyester)\b|ポリエステル/i, "ポリエステル"],
          [/\b(?:nylon|polyamide|cordura|ripstop)\b|ナイロン/i, "ナイロン"],
          [/\b(?:canvas)\b|キャンバス/i, "キャンバス"],
          [/\b(?:merino\s+wool|wool)\b|ウール|羊毛/i, "ウール"],
          [/\b(?:cashmere)\b|カシミヤ/i, "カシミヤ"],
          [/\b(?:silk|satin)\b|シルク|サテン/i, "シルク"],
          [/\b(?:linen|flax|hemp|jute|raffia|straw)\b|リネン|麻|ラフィア/i, "リネン・天然繊維"],
          [/\b(?:viscose|rayon|modal|lyocell|tencel)\b|レーヨン|モダール|テンセル/i, "レーヨン"],
          [/\b(?:spandex|elastane|lycra)\b|スパンデックス|ポリウレタン/i, "ポリウレタン"],
          [/\b(?:down|feather)\b|ダウン|フェザー/i, "ダウン"],
          [/\b(?:rubber|vibram|vulcanized)\b|ラバー|ゴム底|ゴム/i, "ラバー（ゴム）"],
          [/\b(?:eva|tpu|tpr|phylon)\b|EVA樹脂|合成底/i, "EVA・合成樹脂"],
          [/\b(?:stainless\s+steel|steel)\b|ステンレス/i, "ステンレススチール"],
          [/\b(?:sterling\s+silver|925\s+silver)\b|スターリングシルバー|シルバー925/i, "スターリングシルバー"],
          [/\b(?:brass|bronze|copper)\b|真鍮|ブラス|銅/i, "真鍮（ブラス）"],
          [/\b(?:aluminum|aluminium|titanium|alloy|metal)\b|アルミニウム|チタン|合金|金属/i, "メタル（金属）"],
          [/\b(?:polyethylene|rotomolded)\b|ポリエチレン/i, "ポリエチレン"],
          [/\b(?:polycarbonate|tritan|acrylic|abs|resin)\b|ポリカーボネート|アクリル|樹脂/i, "合成樹脂"],
          [/\b(?:silicone)\b|シリコン/i, "シリコン"],
          [/\b(?:ceramic|porcelain|stoneware)\b|セラミック|陶器|磁器/i, "セラミック（陶磁器）"],
          [/\b(?:glass|crystal)\b|ガラス|クリスタル/i, "ガラス・クリスタル"],
          [/\b(?:wood|bamboo|cork)\b|木製|バンブー|コルク/i, "ウッド（木製）"],
          [/\b(?:manmade\s+materials?|man-made\s+materials?|synthetic\s+materials?|synthetic)\b|合成素材|人工素材|合成繊維/i, "合成素材"],
          [/\b(?:recycled\s+materials?)\b|リサイクル素材|再生素材/i, "リサイクル素材"],
        ];

        for (const [rx, jpName] of keywordMap) {
          if (found.length >= 2) break;
          if (rx.test(sourceText) && !found.some((f) => f.startsWith(jpName.slice(0, 3)))) {
            addMat(jpName);
          }
        }

        return found.join("、");
      };

      let matMissing = isMissingField(data.details.material);
      let dimMissing = isMissingField(data.details.dimensions);

      // 1. Fast 0ms deterministic material inference from extracted page candidates & description if LLM left material as N/A
      if (matMissing) {
        const inferredMat = inferMaterialFromText(
          [aggregatedMaterialHints, data.englishName, data.details.description].filter(Boolean).join("\n")
        );
        if (inferredMat) {
          data.details.material = inferredMat;
          matMissing = false;
        }
      }

      // 2. If Material is STILL missing on a URL and we haven't queried urlContext yet, run a single urlContext lookup
      if (matMissing && isUrl && !usedUrlContext) {
        try {
          const recoveryPrompt = `Find the exact Material (in Japanese, up to 2 main materials) and Dimensions (in cm in Japanese, rounded up to whole numbers with 約) for this product URL: ${trimmedInput} (${data.englishName || ""}).
Return strictly JSON:
{
  "material": "Material in Japanese (or N/A if absent)",
  "dimensions": "Dimensions in cm in Japanese (or N/A if absent)"
}`;
          const urlRecoveryRes = await generateWithTools([{ urlContext: {} }], recoveryPrompt);
          const recoveryText = urlRecoveryRes?.text || urlRecoveryRes?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (recoveryText) {
            const recovered = extractJson(recoveryText);
            if (matMissing && !isMissingField(recovered?.material)) {
              data.details.material = recovered.material.trim();
              matMissing = false;
            }
            if (dimMissing && !isMissingField(recovered?.dimensions)) {
              data.details.dimensions = recovered.dimensions.trim();
              dimMissing = false;
            }
          }
        } catch {
          // Ignore recovery error
        }
      }

      data.details.material = isMissingField(data.details.material) ? "N/A" : data.details.material.trim();
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
