/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from "react";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { Search, Loader2, ExternalLink, Package, Globe, Tag, Ruler, Layers, DollarSign, Copy, Check, JapaneseYen, Palette, FileText, RefreshCw, Sun, Moon } from "lucide-react";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const extractJson = (text: string) => {
  try {
    return JSON.parse(text);
  } catch (e) {
    const match = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```([\s\S]*?)```/);
    if (match) {
      try {
        return JSON.parse(match[1].trim());
      } catch (e2) {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
          return JSON.parse(text.substring(start, end + 1));
        }
      }
    } else {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        return JSON.parse(text.substring(start, end + 1));
      }
    }
    throw new Error("Failed to parse JSON from AI response");
  }
};

interface ProductInfo {
  englishName: string;
  japaneseName: string;
  usdPriceValue: number;
  exchangeRate: number;
  details: {
    price: string;
    id?: string;
    material?: string;
    dimensions?: string;
    color?: string;
    description?: string;
  };
}

const CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours in milliseconds

export default function App() {
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [productInfo, setProductInfo] = useState<ProductInfo | null>(null);
  const [discount, setDiscount] = useState<number>(0);
  const [manualUsdPrice, setManualUsdPrice] = useState<number>(0);
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  const refreshExchangeRate = async () => {
    if (loading) return;
    setLoading(true);
    setProgress(0);
    setProgressMessage("Refreshing exchange rate...");
    
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("TIMEOUT")), 120000)
      );

      const rateAiPromise = ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: "Find the current USD to JPY market exchange rate. Return the result as a JSON object with a single key 'exchangeRate' and the numeric value.",
        config: {
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              exchangeRate: { type: Type.NUMBER }
            },
            required: ["exchangeRate"]
          }
        },
      });

      const rateResponse: any = await Promise.race([rateAiPromise, timeoutPromise]);
      const rateText = rateResponse.text;
      if (rateText) {
        const rateData = extractJson(rateText);
        const newRate = rateData.exchangeRate;
        
        if (productInfo) {
          setProductInfo({
            ...productInfo,
            exchangeRate: newRate
          });
        }
        
        localStorage.setItem("usd_jpy_rate", newRate.toString());
        localStorage.setItem("usd_jpy_timestamp", Date.now().toString());
        
        setProgress(100);
        setProgressMessage("Rate updated!");
      }
    } catch (err: any) {
      console.error(err);
      setError("Failed to refresh exchange rate.");
    } finally {
      setTimeout(() => setLoading(false), 500);
    }
  };

  const startAnalysis = useCallback(async (value: string) => {
    const trimmedInput = value.trim();
    if (!trimmedInput) return;

    const usdValue = parseFloat(trimmedInput);
    const isPrice = !isNaN(usdValue) && /^\d+(\.\d+)?$/.test(trimmedInput);

    setLoading(true);
    setProgress(0);
    setError(null);
    setProductInfo(null);

    if (isPrice) {
      setProgressMessage("Fetching exchange rate...");
      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("TIMEOUT")), 120000)
        );

        // Check cache for exchange rate
        const cachedRate = localStorage.getItem("usd_jpy_rate");
        const cachedTimestamp = localStorage.getItem("usd_jpy_timestamp");
        const now = Date.now();
        const isCacheValid = cachedRate && cachedTimestamp && (now - parseInt(cachedTimestamp)) < CACHE_DURATION;
        
        let finalRate: number;

        if (isCacheValid) {
          finalRate = parseFloat(cachedRate!);
          setProgress(100);
          setProgressMessage("Check complete (cached)!");
        } else {
          const aiPromise = ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: "Find the current USD to JPY market exchange rate. Return the result as a JSON object with a single key 'exchangeRate' and the numeric value.",
            config: {
              tools: [{ googleSearch: {} }],
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  exchangeRate: { type: Type.NUMBER }
                },
                required: ["exchangeRate"]
              }
            },
          });

          const response: any = await Promise.race([aiPromise, timeoutPromise]);
          const text = response.text;
          if (text) {
            const data = extractJson(text);
            finalRate = data.exchangeRate;
            
            // Update cache
            localStorage.setItem("usd_jpy_rate", finalRate.toString());
            localStorage.setItem("usd_jpy_timestamp", Date.now().toString());
            
            setProgress(100);
            setProgressMessage("Check complete!");
          } else {
            throw new Error("Could not fetch exchange rate.");
          }
        }

        setProductInfo({
          englishName: "Quick Price Check",
          japaneseName: "クイック価格チェック",
          usdPriceValue: usdValue,
          exchangeRate: finalRate,
          details: {
            price: `$${usdValue.toFixed(2)}`,
            id: "-",
            material: "-",
            dimensions: "-",
            color: "-",
            description: "クイックチェックの結果です。詳細情報は含まれません。"
          }
        });
        setManualUsdPrice(usdValue);
      } catch (err: any) {
        console.error(err);
        if (err.message === "TIMEOUT") {
          setError("The request timed out. Please try again.");
        } else {
          setError(err.message || "An error occurred during quick check.");
        }
      } finally {
        setTimeout(() => setLoading(false), 500);
      }
    } else {
      setProgressMessage("Initializing AI...");
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev < 30) {
            setProgressMessage("Searching exchange rates...");
            return prev + Math.random() * 5;
          }
          if (prev < 60) {
            setProgressMessage("Analyzing product page...");
            return prev + Math.random() * 3;
          }
          if (prev < 90) {
            setProgressMessage("Generating Japanese translation...");
            return prev + Math.random() * 2;
          }
          return prev;
        });
      }, 400);

      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("TIMEOUT")), 120000)
        );

        // Check cache for exchange rate
        const cachedRate = localStorage.getItem("usd_jpy_rate");
        const cachedTimestamp = localStorage.getItem("usd_jpy_timestamp");
        const now = Date.now();
        const isCacheValid = cachedRate && cachedTimestamp && (now - parseInt(cachedTimestamp)) < CACHE_DURATION;
        
        const rateToUse: number | null = isCacheValid ? parseFloat(cachedRate!) : null;
        const isUrl = trimmedInput.startsWith("http");
        setProgressMessage(isUrl ? "Analyzing product page..." : "Searching product info...");
        
        const rateInstruction = rateToUse 
          ? `The current USD/JPY exchange rate is ${rateToUse}.` 
          : `Find the current USD/JPY market exchange rate and use it for calculations.`;

        const aiPromise = ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Extract product info from: ${trimmedInput}. ${rateInstruction}
          Return the result as a JSON object with the following structure:
          {
            "englishName": "Product name in English",
            "japaneseName": "Product name in Japanese",
            "usdPriceValue": 12.00,
            "exchangeRate": 150.5,
            "details": {
              "price": "$12.00",
              "id": "SKU if available",
              "material": "Material in Japanese",
              "dimensions": "Dimensions in cm in Japanese",
              "color": "Color in Japanese",
              "description": "Short 1-sentence summary in Japanese"
            }
          }
          IMPORTANT: Do not use special characters or symbols like "®", "™", or similar in any of the text fields.
          CRITICAL: Do not include the brand name in the English or Japanese product names.
          DIMENSIONS: Be extra careful and accurate with dimensions. Always add "約" in front of the dimensions in the "dimensions" field.`,
          config: {
            tools: [{ urlContext: {} }, { googleSearch: {} }],
            responseMimeType: "application/json",
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                englishName: { type: Type.STRING },
                japaneseName: { type: Type.STRING },
                usdPriceValue: { type: Type.NUMBER },
                exchangeRate: { type: Type.NUMBER },
                details: {
                  type: Type.OBJECT,
                  properties: {
                    price: { type: Type.STRING },
                    id: { type: Type.STRING },
                    material: { type: Type.STRING },
                    dimensions: { 
                      type: Type.STRING,
                      description: "Product dimensions in cm, prefixed with '約' (e.g., 約W10 x H20 cm)"
                    },
                    color: { type: Type.STRING },
                    description: { type: Type.STRING }
                  },
                  required: ["price", "description"]
                }
              },
              required: ["englishName", "japaneseName", "usdPriceValue", "exchangeRate", "details"]
            }
          },
        });

        let response: any;
        try {
          response = await Promise.race([aiPromise, timeoutPromise]);
        } catch (err: any) {
          const errorMsg = err?.message || "";
          // Check for the specific "page too large" error or generic invalid argument that often accompanies it
          if (errorMsg.includes("size() > 2621440") || errorMsg.includes("INVALID_ARGUMENT")) {
            setProgressMessage("Page too large for direct analysis. Falling back to search...");
            
            // Fallback: Try again using googleSearch instead of urlContext
            const fallbackAiPromise = ai.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: `Extract product info for this item: ${trimmedInput}. ${rateInstruction}
              Return the result as a JSON object with the following structure:
              {
                "englishName": "Product name in English",
                "japaneseName": "Product name in Japanese",
                "usdPriceValue": 12.00,
                "exchangeRate": 150.5,
                "details": {
                  "price": "$12.00",
                  "id": "SKU if available",
                  "material": "Material in Japanese",
                  "dimensions": "Dimensions in cm in Japanese",
                  "color": "Color in Japanese",
                  "description": "Short 1-sentence summary in Japanese"
                }
              }
              IMPORTANT: Do not use special characters or symbols like "®", "™", or similar in any of the text fields.
              CRITICAL: Do not include the brand name in the English or Japanese product names.
              DIMENSIONS: Be extra careful and accurate with dimensions. Always add "約" in front of the dimensions in the "dimensions" field.`,
              config: {
                tools: [{ googleSearch: {} }],
                responseMimeType: "application/json",
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    englishName: { type: Type.STRING },
                    japaneseName: { type: Type.STRING },
                    usdPriceValue: { type: Type.NUMBER },
                    exchangeRate: { type: Type.NUMBER },
                    details: {
                      type: Type.OBJECT,
                      properties: {
                        price: { type: Type.STRING },
                        id: { type: Type.STRING },
                        material: { type: Type.STRING },
                        dimensions: { 
                          type: Type.STRING,
                          description: "Product dimensions in cm, prefixed with '約' (e.g., 約W10 x H20 cm)"
                        },
                        color: { type: Type.STRING },
                        description: { type: Type.STRING }
                      },
                      required: ["price", "description"]
                    }
                  },
                  required: ["englishName", "japaneseName", "usdPriceValue", "exchangeRate", "details"]
                }
              },
            });
            
            response = await Promise.race([fallbackAiPromise, timeoutPromise]);
          } else {
            throw err;
          }
        }

        const text = response.text;
        if (text) {
          setProgress(100);
          setProgressMessage("Extraction complete!");
          const data = extractJson(text);
          
          // Update cache if we fetched a new rate or if the cached one was used
          if (data.exchangeRate) {
            localStorage.setItem("usd_jpy_rate", data.exchangeRate.toString());
            localStorage.setItem("usd_jpy_timestamp", Date.now().toString());
          }

          setProductInfo(data);
          setManualUsdPrice(data.usdPriceValue);
        } else {
          throw new Error("No information could be extracted from this URL.");
        }
      } catch (err: any) {
        console.error(err);
        if (err.message === "TIMEOUT") {
          setError("The analysis timed out. This can happen with complex product pages. Please try again or use the product name instead of a URL.");
        } else {
          setError(err.message || "An error occurred while extracting information.");
        }
      } finally {
        clearInterval(progressInterval);
        setTimeout(() => setLoading(false), 500);
      }
    }
  }, [discount]); // Added discount to dependencies if it impacts startAnalysis, though it mostly impacts retailPriceJpy

  const calculateRetailPrice = (usd: number, rate: number, discountPct: number = 0) => {
    const tax = 1.1; // 10%
    const spread = 10;
    const shipping = 7000;
    const markup = 1.1; // 10%
    const fee = 1.05; // 5%
    
    // Formula: (((USD×tax)×(rate+spread))+7000)×(markup)×fee
    const basePrice = (((usd * tax) * (rate + spread)) + shipping) * markup * fee;
    const discountedPrice = basePrice * (1 - discountPct / 100);
    
    // Round down the last digit (e.g., 1234 -> 1230)
    return Math.floor(discountedPrice / 10) * 10;
  };

  const copyToClipboard = async (key: string, value: string | number) => {
    try {
      await navigator.clipboard.writeText(value.toString());
      setCopiedStates((prev) => ({ ...prev, [key]: true }));
      setTimeout(() => setCopiedStates((prev) => ({ ...prev, [key]: false })), 2000);
    } catch (err) {
      console.error("Failed to copy!", err);
    }
  };

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    startAnalysis(inputValue);
  };

  const retailPriceJpy = productInfo ? calculateRetailPrice(manualUsdPrice, productInfo.exchangeRate, discount) : 0;

  return (
    <div className="min-h-screen flex flex-col font-sans relative overflow-hidden transition-colors duration-500">
      {/* Animated Background Orbs */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className={`absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full blur-[120px] animate-orb transition-colors duration-1000 ${theme === 'dark' ? 'bg-violet-600/20' : 'bg-violet-400/10'}`} />
        <div className={`absolute bottom-[10%] right-[-5%] w-[35%] h-[35%] rounded-full blur-[120px] animate-orb [animation-delay:2s] transition-colors duration-1000 ${theme === 'dark' ? 'bg-indigo-600/20' : 'bg-indigo-400/10'}`} />
        <div className={`absolute top-[40%] left-[30%] w-[25%] h-[25%] rounded-full blur-[120px] animate-orb [animation-delay:4s] transition-colors duration-1000 ${theme === 'dark' ? 'bg-fuchsia-600/10' : 'bg-fuchsia-400/5'}`} />
      </div>

      {/* Header */}
      <header className="glass-panel sticky top-0 z-20 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <Package size={20} strokeWidth={2.5} />
            </div>
            <h1 className={`text-lg font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r ${theme === 'dark' ? 'from-white to-white/60' : 'from-neutral-900 to-neutral-500'}`}>Analyzer</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className={`p-2.5 rounded-xl border transition-all ${
                theme === 'dark' 
                  ? 'bg-white/[0.05] border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.1]' 
                  : 'bg-black/[0.03] border-black/[0.05] text-neutral-500 hover:text-neutral-900 hover:bg-black/[0.05]'
              }`}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div className={`px-3 py-1 rounded-full border hidden sm:block ${
              theme === 'dark' ? 'bg-white/[0.05] border-white/[0.08]' : 'bg-black/[0.03] border-black/[0.05]'
            }`}>
              <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${theme === 'dark' ? 'text-white/40' : 'text-neutral-400'}`}>v2.0 • AI Premium</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-10 flex flex-col gap-8 relative z-10">
        {/* Input Section */}
        <section className="w-full">
          <form onSubmit={handleAction} className="relative flex gap-3">
            <div className="relative flex-1 group">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-white/20 group-focus-within:text-indigo-400 transition-colors">
                <Search size={20} />
              </div>
              <input
                type="text"
                placeholder="Paste URL or enter USD price..."
                value={inputValue}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setInputValue(e.target.value)}
                className={`w-full pl-12 pr-4 py-4 rounded-2xl text-sm input-focus shadow-2xl backdrop-blur-md transition-all border ${
                  theme === 'dark' 
                    ? 'bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/20 hover:bg-white/[0.05]' 
                    : 'bg-white/60 border-black/[0.05] text-neutral-900 placeholder:text-neutral-400 hover:bg-white/80'
                }`}
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading || !inputValue.trim()}
              className={`px-8 rounded-2xl text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-2 active:scale-95 border ${
                theme === 'dark'
                  ? 'bg-white text-black hover:bg-white/90 shadow-[0_0_20px_rgba(255,255,255,0.1)] border-transparent'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800 shadow-xl shadow-neutral-900/10 border-transparent'
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  <span>{Math.round(progress)}%</span>
                </>
              ) : (
                "Analyze"
              )}
            </button>
            {loading && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className={`px-5 rounded-2xl text-xs font-bold transition-all backdrop-blur-md border ${
                  theme === 'dark'
                    ? 'bg-white/[0.05] border-white/[0.08] text-white/60 hover:bg-white/[0.1]'
                    : 'bg-black/[0.03] border-black/[0.05] text-neutral-500 hover:bg-black/[0.05]'
                }`}
              >
                Cancel
              </button>
            )}
          </form>

          {/* Progress Bar */}
          <AnimatePresence>
            {loading && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-4 px-1"
              >
                <div className={`h-1.5 w-full rounded-full overflow-hidden border ${
                  theme === 'dark' ? 'bg-white/[0.05] border-white/[0.05]' : 'bg-black/[0.03] border-black/[0.03]'
                }`}>
                  <motion.div
                    className="h-full bg-gradient-to-r from-indigo-500 to-violet-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                  />
                </div>
                <div className="flex justify-between items-center mt-2.5">
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-white/30' : 'text-neutral-400'}`}>
                    {progress > 80 ? "Finalizing..." : progressMessage}
                  </p>
                  <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">
                    {Math.round(progress)}%
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Results Section */}
        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`p-5 border rounded-2xl text-xs font-medium flex flex-col gap-3 backdrop-blur-md ${
                theme === 'dark' 
                  ? 'bg-rose-500/10 border-rose-500/20 text-rose-200' 
                  : 'bg-rose-50 border-rose-100 text-rose-700'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shadow-[0_0_10px_rgba(244,63,94,0.5)]" />
                {error}
              </div>
            </motion.div>
          )}

          {productInfo && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8"
            >
              {/* Product Header & Details (Left) */}
              <div className="lg:col-span-7 space-y-8">
                <div className="compact-card p-8 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500" />
                  
                  <div className="flex items-start justify-between mb-8">
                    <div className="space-y-2">
                      <h3 className={`text-2xl font-bold tracking-tight leading-tight ${theme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>{productInfo.japaneseName}</h3>
                      <h4 className={`text-sm font-medium tracking-wide ${theme === 'dark' ? 'text-white/40' : 'text-neutral-400'}`}>{productInfo.englishName}</h4>
                    </div>
                    {inputValue.startsWith("http") && (
                      <a
                        href={inputValue}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`p-3 rounded-xl transition-all border ${
                          theme === 'dark'
                            ? 'text-white/30 hover:text-white hover:bg-white/10 border-white/5'
                            : 'text-neutral-400 hover:text-neutral-900 hover:bg-black/[0.03] border-black/[0.05]'
                        }`}
                      >
                        <ExternalLink size={20} />
                      </a>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-5">
                    {[
                      { label: "Color", value: productInfo.details.color, icon: Palette, key: "color" },
                      { label: "Product ID", value: productInfo.details.id, icon: Tag, key: "id" },
                      { label: "Material", value: productInfo.details.material, icon: Layers, key: "material" },
                      { label: "Dimensions", value: productInfo.details.dimensions, icon: Ruler, key: "dimensions" },
                    ].map((item) => item.value && (
                      <button
                        key={item.key}
                        onClick={() => copyToClipboard(item.key, item.value!)}
                        className={`p-4 text-left rounded-2xl border transition-all group relative overflow-hidden ${
                          copiedStates[item.key] 
                            ? "bg-indigo-500/20 border-indigo-500/40 ring-1 ring-indigo-500/40" 
                            : theme === 'dark'
                              ? "bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.08] hover:border-white/[0.15]"
                              : "bg-black/[0.02] border-black/[0.05] hover:bg-black/[0.04] hover:border-black/[0.1]"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <item.icon size={14} className={copiedStates[item.key] ? "text-indigo-400" : theme === 'dark' ? "text-white/20" : "text-neutral-300"} />
                            <span className={`text-[10px] font-bold uppercase tracking-[0.15em] ${copiedStates[item.key] ? "text-indigo-400" : theme === 'dark' ? "text-white/30" : "text-neutral-400"}`}>
                              {item.label}
                            </span>
                          </div>
                          {copiedStates[item.key] && (
                            <motion.span 
                              initial={{ opacity: 0, x: 5 }}
                              animate={{ opacity: 1, x: 0 }}
                              className="text-[9px] font-black text-indigo-400 uppercase tracking-tighter"
                            >
                              Copied
                            </motion.span>
                          )}
                        </div>
                        <p className={`text-xs font-semibold truncate ${copiedStates[item.key] ? (theme === 'dark' ? "text-white" : "text-indigo-900") : (theme === 'dark' ? "text-white/80" : "text-neutral-900")}`}>
                          {item.value}
                        </p>
                      </button>
                    ))}
                  </div>

                  {productInfo.details.description && (
                    <button
                      onClick={() => copyToClipboard("description", productInfo.details.description!)}
                      className={`mt-6 p-5 w-full text-left rounded-2xl relative group transition-all overflow-hidden border ${
                        copiedStates["description"]
                          ? "bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-500/20"
                          : theme === 'dark'
                            ? "bg-white/[0.03] border-white/[0.05] text-white/70 hover:bg-white/[0.06] hover:border-white/[0.1]"
                            : "bg-neutral-900 border-transparent text-white hover:bg-black"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <FileText size={14} className={copiedStates["description"] ? "text-indigo-200" : theme === 'dark' ? "text-white/20" : "text-white/40"} />
                          <span className={`text-[10px] font-bold uppercase tracking-[0.15em] ${copiedStates["description"] ? "text-indigo-100" : theme === 'dark' ? "text-white/30" : "text-white/40"}`}>
                            Summary
                          </span>
                        </div>
                        {copiedStates["description"] && (
                          <motion.span 
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="text-[9px] font-black text-indigo-200 uppercase tracking-widest"
                          >
                            Copied to clipboard
                          </motion.span>
                        )}
                      </div>
                      <p className={`text-[12px] leading-relaxed italic ${copiedStates["description"] ? "text-white" : theme === 'dark' ? "text-white/60" : "text-white/80"}`}>
                        {productInfo.details.description}
                      </p>
                    </button>
                  )}
                </div>
              </div>

              {/* Pricing & Controls (Right) */}
              <div className="lg:col-span-5 space-y-8">
                <div className="compact-card p-8 flex flex-col h-full relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500" />
                  
                  <div className="space-y-8 flex-1">
                    {/* USD Input */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-white/30' : 'text-neutral-400'}`}>Price (USD)</span>
                        <button
                          onClick={() => copyToClipboard("usd", manualUsdPrice)}
                          className={`text-[10px] font-bold transition-colors uppercase tracking-widest ${theme === 'dark' ? 'text-white/30 hover:text-indigo-400' : 'text-neutral-400 hover:text-indigo-600'}`}
                        >
                          {copiedStates["usd"] ? "COPIED" : "COPY"}
                        </button>
                      </div>
                      <div className="relative">
                        <span className={`absolute left-0 top-1/2 -translate-y-1/2 text-2xl font-bold ${theme === 'dark' ? 'text-white/20' : 'text-neutral-300'}`}>$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={manualUsdPrice}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setManualUsdPrice(parseFloat(e.target.value) || 0)}
                          className={`w-full pl-6 py-2 text-3xl font-bold bg-transparent focus:outline-none border-b transition-colors ${
                            theme === 'dark' 
                              ? 'border-white/[0.05] focus:border-indigo-500/50 text-white' 
                              : 'border-black/[0.05] focus:border-indigo-500/50 text-neutral-900'
                          }`}
                        />
                      </div>
                    </div>

                    {/* JPY Result */}
                    <div className={`p-6 rounded-3xl border space-y-6 backdrop-blur-md ${
                      theme === 'dark' ? 'bg-white/[0.02] border-white/[0.05]' : 'bg-black/[0.02] border-black/[0.05]'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <span className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-white/30' : 'text-neutral-400'}`}>Retail Price (JPY)</span>
                          <div className="flex items-baseline gap-3">
                            <span className={`text-4xl font-bold tracking-tight transition-all duration-500 ${
                              discount === 20 ? (theme === 'dark' ? "text-indigo-400 drop-shadow-[0_0_15px_rgba(129,140,248,0.3)]" : "text-indigo-600") :
                              discount === 10 ? (theme === 'dark' ? "text-blue-400 drop-shadow-[0_0_15px_rgba(96,165,250,0.3)]" : "text-blue-600") :
                              discount === -10 ? (theme === 'dark' ? "text-orange-400 drop-shadow-[0_0_15px_rgba(251,146,60,0.3)]" : "text-orange-600") :
                              discount === -20 ? (theme === 'dark' ? "text-rose-400 drop-shadow-[0_0_15px_rgba(251,113,133,0.3)]" : "text-rose-600") :
                              (theme === 'dark' ? "text-white" : "text-neutral-900")
                            }`}>
                              ¥{retailPriceJpy.toLocaleString()}
                            </span>
                            {discount !== 0 && (
                              <span className={`text-xs font-bold line-through ${theme === 'dark' ? 'text-white/10' : 'text-neutral-300'}`}>
                                ¥{calculateRetailPrice(manualUsdPrice, productInfo!.exchangeRate, 0).toLocaleString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => copyToClipboard("jpy", retailPriceJpy)}
                          className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-violet-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20 hover:scale-110 active:scale-95 transition-all"
                        >
                          {copiedStates["jpy"] ? <Check size={22} /> : <JapaneseYen size={22} />}
                        </button>
                      </div>

                      <div className="grid grid-cols-5 gap-1 pt-2">
                        {[
                          { label: "20% OFF", val: 20, color: theme === 'dark' ? "hover:bg-indigo-500/10 hover:text-indigo-400" : "hover:bg-indigo-50 hover:text-indigo-600", active: "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" },
                          { label: "10% OFF", val: 10, color: theme === 'dark' ? "hover:bg-blue-500/10 hover:text-blue-400" : "hover:bg-blue-50 hover:text-blue-600", active: "bg-blue-500 text-white shadow-lg shadow-blue-500/20" },
                          { label: "Normal", val: 0, color: theme === 'dark' ? "hover:bg-white/10" : "hover:bg-black/10", active: theme === 'dark' ? "bg-white text-black shadow-lg shadow-white/10" : "bg-neutral-900 text-white shadow-lg shadow-neutral-900/10" },
                          { label: "10% UP", val: -10, color: theme === 'dark' ? "hover:bg-orange-500/10 hover:text-orange-400" : "hover:bg-orange-50 hover:text-orange-600", active: "bg-orange-500 text-white shadow-lg shadow-orange-500/20" },
                          { label: "20% UP", val: -20, color: theme === 'dark' ? "hover:bg-rose-500/10 hover:text-rose-400" : "hover:bg-rose-50 hover:text-rose-600", active: "bg-rose-500 text-white shadow-lg shadow-rose-500/20" },
                        ].map((btn) => (
                          <button
                            key={btn.label}
                            onClick={() => setDiscount(btn.val)}
                            className={`py-2 rounded-lg text-[8px] font-black uppercase tracking-tighter transition-all border border-transparent whitespace-nowrap flex items-center justify-center ${
                              discount === btn.val ? btn.active : `${theme === 'dark' ? 'bg-white/[0.03] border-white/[0.05] text-white/40' : 'bg-black/[0.03] border-black/[0.05] text-neutral-400'} ${btn.color}`
                            }`}
                          >
                            {btn.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className={`mt-8 pt-5 border-t flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.2em] ${theme === 'dark' ? 'border-white/[0.05] text-white/20' : 'border-black/[0.05] text-neutral-400'}`}>
                    <div className="flex items-center gap-2">
                      <span>Market Rate</span>
                      <button 
                        onClick={refreshExchangeRate}
                        disabled={loading}
                        className="hover:text-indigo-400 transition-colors disabled:opacity-50 p-1"
                        title="Refresh exchange rate"
                      >
                        <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                      </button>
                    </div>
                    <span className={theme === 'dark' ? 'text-white/40' : 'text-neutral-600'}>¥{productInfo.exchangeRate} / USD</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {!productInfo && !loading && !error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`flex-1 flex flex-col items-center justify-center py-20 ${theme === 'dark' ? 'text-white/10' : 'text-neutral-200'}`}
            >
              <div className={`w-20 h-20 border rounded-3xl flex items-center justify-center mb-6 shadow-2xl backdrop-blur-md ${
                theme === 'dark' ? 'border-white/[0.05] bg-white/[0.02]' : 'border-black/[0.05] bg-black/[0.02]'
              }`}>
                <Search size={32} className={theme === 'dark' ? 'text-white/10' : 'text-neutral-200'} />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em]">Awaiting Input</p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className={`max-w-5xl w-full mx-auto px-6 py-10 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.2em] relative z-10 ${
        theme === 'dark' ? 'text-white/20' : 'text-neutral-400'
      }`}>
        <p>© 2026 Analyzer • Premium Edition</p>
        <div className="flex gap-8">
          <a href="#" className={`transition-colors ${theme === 'dark' ? 'hover:text-white' : 'hover:text-neutral-900'}`}>Privacy</a>
          <a href="#" className={`transition-colors ${theme === 'dark' ? 'hover:text-white' : 'hover:text-neutral-900'}`}>Terms</a>
        </div>
      </footer>
    </div>
  );
}
