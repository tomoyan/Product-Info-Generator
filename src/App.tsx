/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from "react";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { Search, Loader2, ExternalLink, Package, Globe, Tag, Ruler, Layers, DollarSign, Copy, Check, JapaneseYen, Palette, FileText } from "lucide-react";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
          setTimeout(() => reject(new Error("TIMEOUT")), 45000)
        );

        const aiPromise = ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: "Find the current USD to JPY market exchange rate. Return only the numeric value.",
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            tools: [{ googleSearch: {} }],
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                exchangeRate: { type: Type.NUMBER, description: "Current USD to JPY exchange rate" },
              },
              required: ["exchangeRate"],
            },
          },
        });

        const response: any = await Promise.race([aiPromise, timeoutPromise]);
        const text = response.text;
        if (text) {
          setProgress(100);
          setProgressMessage("Check complete!");
          const data = JSON.parse(text);
          
          setProductInfo({
            englishName: "Quick Price Check",
            japaneseName: "クイック価格チェック",
            usdPriceValue: usdValue,
            exchangeRate: data.exchangeRate,
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
        } else {
          throw new Error("Could not fetch exchange rate.");
        }
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
          setTimeout(() => reject(new Error("TIMEOUT")), 45000)
        );

        const aiPromise = ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Extract product info from ${trimmedInput} and find current USD/JPY rate.
          Return English name, Japanese name, and details (Japanese): price (USD), ID, material, dimensions (cm), color, and a very short summary description in Japanese (1 sentence).
          Include numeric USD price and exchange rate.`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            tools: [{ urlContext: {} }, { googleSearch: {} }],
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                englishName: { type: Type.STRING, description: "Product name in English" },
                japaneseName: { type: Type.STRING, description: "Product name in Japanese" },
                usdPriceValue: { type: Type.NUMBER, description: "Numeric value of the USD price (e.g., 12.00)" },
                exchangeRate: { type: Type.NUMBER, description: "Current USD to JPY exchange rate (e.g., 150.5)" },
                details: {
                  type: Type.OBJECT,
                  properties: {
                    price: { type: Type.STRING, description: "Price in US Dollars (e.g., $12.00)" },
                    id: { type: Type.STRING, description: "Product ID or SKU if available" },
                    material: { type: Type.STRING, description: "Product material in Japanese" },
                    dimensions: { type: Type.STRING, description: "Dimensions in cm in Japanese" },
                    color: { type: Type.STRING, description: "Product color in Japanese" },
                    description: { type: Type.STRING, description: "Short 1-sentence summary of the product in Japanese" },
                  },
                  required: ["price"],
                },
              },
              required: ["englishName", "japaneseName", "details", "usdPriceValue", "exchangeRate"],
            },
          },
        });

        const response: any = await Promise.race([aiPromise, timeoutPromise]);
        const text = response.text;
        if (text) {
          setProgress(100);
          setProgressMessage("Extraction complete!");
          const data = JSON.parse(text);
          setProductInfo(data);
          setManualUsdPrice(data.usdPriceValue);
        } else {
          throw new Error("No information could be extracted from this URL.");
        }
      } catch (err: any) {
        console.error(err);
        if (err.message === "TIMEOUT") {
          setError("The analysis is taking longer than usual. Please reload and try again.");
        } else {
          setError(err.message || "An error occurred while extracting information.");
        }
      } finally {
        clearInterval(progressInterval);
        setTimeout(() => setLoading(false), 500);
      }
    }
  }, [discount]); // Added discount to dependencies if it impacts startAnalysis, though it mostly impacts retailPriceJpy

  useEffect(() => {
    const retryValue = localStorage.getItem("retry_value");
    if (retryValue) {
      localStorage.removeItem("retry_value");
      setInputValue(retryValue);
      startAnalysis(retryValue);
    }
  }, [startAnalysis]);

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

  const handleReloadRetry = () => {
    if (inputValue.trim()) {
      localStorage.setItem("retry_value", inputValue.trim());
    }
    window.location.reload();
  };

  const retailPriceJpy = productInfo ? calculateRetailPrice(manualUsdPrice, productInfo.exchangeRate, discount) : 0;

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* Header */}
      <header className="glass-panel sticky top-0 z-20 px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center text-white shadow-lg shadow-black/10">
              <Package size={16} strokeWidth={2.5} />
            </div>
            <h1 className="text-sm font-bold tracking-tight uppercase">Extractor</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-[0.2em]">v2.0 • AI Analysis</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-6 flex flex-col gap-6">
        {/* Input Section */}
        <section className="w-full">
          <form onSubmit={handleAction} className="relative flex gap-2">
            <div className="relative flex-1 group">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-neutral-400 group-focus-within:text-black transition-colors">
                <Search size={18} />
              </div>
              <input
                type="text"
                placeholder="Paste URL or enter USD price..."
                value={inputValue}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setInputValue(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-white border border-neutral-200 rounded-xl text-sm input-focus shadow-sm"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading || !inputValue.trim()}
              className="px-6 bg-black text-white rounded-xl text-sm font-bold hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-lg shadow-black/5"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
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
                className="px-4 bg-white border border-neutral-200 text-neutral-500 rounded-xl text-xs font-bold hover:bg-neutral-50 transition-all shadow-sm"
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
                className="mt-3"
              >
                <div className="h-1 w-full bg-neutral-100 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-black"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                  />
                </div>
                <div className="flex justify-between items-center mt-1.5">
                  <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
                    {progress > 80 ? "Almost there..." : progressMessage}
                  </p>
                  <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
                    {Math.round(progress)}%
                  </p>
                </div>
                {progress > 50 && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-4 p-3 bg-neutral-50 border border-neutral-100 rounded-xl flex items-center justify-between"
                  >
                    <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Taking too long?</span>
                    <button
                      onClick={handleReloadRetry}
                      className="text-[10px] font-black text-black underline uppercase tracking-widest"
                    >
                      Reload & Retry
                    </button>
                  </motion.div>
                )}
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
              className="p-4 bg-red-50 border border-red-100 text-red-700 rounded-xl text-xs font-medium flex flex-col gap-3"
            >
              <div className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                {error}
              </div>
              <button
                onClick={handleReloadRetry}
                className="self-start px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors"
              >
                Reload App
              </button>
            </motion.div>
          )}

          {productInfo && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-6"
            >
              {/* Product Header & Details (Left) */}
              <div className="lg:col-span-7 space-y-6">
                <div className="compact-card p-6">
                  <div className="flex items-start justify-between mb-6">
                    <div className="space-y-1">
                      <h3 className="text-xl font-bold tracking-tight leading-tight">{productInfo.englishName}</h3>
                      <h4 className="text-sm font-medium text-neutral-500">{productInfo.japaneseName}</h4>
                    </div>
                    {inputValue.startsWith("http") && (
                      <a
                        href={inputValue}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 text-neutral-400 hover:text-black hover:bg-neutral-50 rounded-lg transition-all"
                      >
                        <ExternalLink size={18} />
                      </a>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: "Color", value: productInfo.details.color, icon: Palette, key: "color" },
                      { label: "Product ID", value: productInfo.details.id, icon: Tag, key: "id" },
                      { label: "Material", value: productInfo.details.material, icon: Layers, key: "material" },
                      { label: "Dimensions", value: productInfo.details.dimensions, icon: Ruler, key: "dimensions" },
                    ].map((item) => item.value && (
                      <button
                        key={item.key}
                        onClick={() => copyToClipboard(item.key, item.value!)}
                        className={`p-3 text-left rounded-xl border transition-all group relative overflow-hidden ${
                          copiedStates[item.key] 
                            ? "bg-green-50 border-green-200 ring-1 ring-green-200" 
                            : "bg-neutral-50/50 border-neutral-100 hover:bg-neutral-100/80 hover:border-neutral-200"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <item.icon size={12} className={copiedStates[item.key] ? "text-green-600" : "text-neutral-400"} />
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${copiedStates[item.key] ? "text-green-600" : "text-neutral-400"}`}>
                              {item.label}
                            </span>
                          </div>
                          {copiedStates[item.key] && (
                            <motion.span 
                              initial={{ opacity: 0, x: 5 }}
                              animate={{ opacity: 1, x: 0 }}
                              className="text-[9px] font-black text-green-600 uppercase tracking-tighter"
                            >
                              Copied
                            </motion.span>
                          )}
                        </div>
                        <p className={`text-xs font-semibold truncate ${copiedStates[item.key] ? "text-green-700" : "text-neutral-900"}`}>
                          {item.value}
                        </p>
                      </button>
                    ))}
                  </div>

                  {productInfo.details.description && (
                    <button
                      onClick={() => copyToClipboard("description", productInfo.details.description!)}
                      className={`mt-4 p-4 w-full text-left rounded-xl relative group transition-all overflow-hidden ${
                        copiedStates["description"]
                          ? "bg-green-600 text-white shadow-lg shadow-green-900/20"
                          : "bg-neutral-900 text-white hover:bg-black"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <FileText size={12} className={copiedStates["description"] ? "text-green-200" : "text-neutral-400"} />
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${copiedStates["description"] ? "text-green-100" : "text-neutral-400"}`}>
                            Summary
                          </span>
                        </div>
                        {copiedStates["description"] && (
                          <motion.span 
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="text-[9px] font-black text-green-200 uppercase tracking-widest"
                          >
                            Copied to clipboard
                          </motion.span>
                        )}
                      </div>
                      <p className={`text-[11px] leading-relaxed italic ${copiedStates["description"] ? "text-white" : "opacity-90"}`}>
                        {productInfo.details.description}
                      </p>
                    </button>
                  )}
                </div>
              </div>

              {/* Pricing & Controls (Right) */}
              <div className="lg:col-span-5 space-y-6">
                <div className="compact-card p-6 flex flex-col h-full">
                  <div className="space-y-6 flex-1">
                    {/* USD Input */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Price (USD)</span>
                        <button
                          onClick={() => copyToClipboard("usd", manualUsdPrice)}
                          className="text-[10px] font-bold text-neutral-400 hover:text-black transition-colors"
                        >
                          {copiedStates["usd"] ? "COPIED" : "COPY"}
                        </button>
                      </div>
                      <div className="relative">
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 text-lg font-bold text-neutral-400">$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={manualUsdPrice}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setManualUsdPrice(parseFloat(e.target.value) || 0)}
                          className="w-full pl-5 py-1 text-2xl font-semibold focus:outline-none border-b border-neutral-100 focus:border-black transition-colors"
                        />
                      </div>
                    </div>

                    {/* JPY Result */}
                    <div className="p-5 bg-neutral-50 rounded-2xl border border-neutral-100 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Retail Price (JPY)</span>
                          <div className="flex items-baseline gap-2">
                            <span className={`text-3xl font-semibold tracking-tight transition-colors ${
                              discount === 20 ? "text-indigo-600" :
                              discount === 10 ? "text-blue-600" :
                              discount === -10 ? "text-orange-600" :
                              discount === -20 ? "text-rose-600" :
                              "text-neutral-900"
                            }`}>
                              ¥{retailPriceJpy.toLocaleString()}
                            </span>
                            {discount !== 0 && (
                              <span className="text-xs font-bold text-neutral-300 line-through">
                                ¥{calculateRetailPrice(manualUsdPrice, productInfo!.exchangeRate, 0).toLocaleString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => copyToClipboard("jpy", retailPriceJpy)}
                          className="w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center shadow-lg shadow-black/10 hover:scale-105 active:scale-95 transition-all"
                        >
                          {copiedStates["jpy"] ? <Check size={18} /> : <JapaneseYen size={18} />}
                        </button>
                      </div>

                      <div className="flex flex-nowrap gap-1 pt-2 overflow-x-auto no-scrollbar">
                        {[
                          { label: "20% OFF", val: 20, color: "hover:bg-indigo-50 hover:text-indigo-600", active: "bg-indigo-600 text-white" },
                          { label: "10% OFF", val: 10, color: "hover:bg-blue-50 hover:text-blue-600", active: "bg-blue-600 text-white" },
                          { label: "Normal", val: 0, color: "hover:bg-neutral-200", active: "bg-neutral-900 text-white" },
                          { label: "10% UP", val: -10, color: "hover:bg-orange-50 hover:text-orange-600", active: "bg-orange-600 text-white" },
                          { label: "20% UP", val: -20, color: "hover:bg-rose-50 hover:text-rose-600", active: "bg-rose-600 text-white" },
                        ].map((btn) => (
                          <button
                            key={btn.label}
                            onClick={() => setDiscount(btn.val)}
                            className={`px-2 py-1 rounded-lg text-[8px] font-bold uppercase tracking-wider transition-all border border-transparent whitespace-nowrap flex-1 ${
                              discount === btn.val ? btn.active : `bg-white border-neutral-200 text-neutral-500 ${btn.color}`
                            }`}
                          >
                            {btn.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-6 pt-4 border-t border-neutral-100 flex items-center justify-between text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                    <span>Rate</span>
                    <span>¥{productInfo.exchangeRate} / USD</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {!productInfo && !loading && !error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex flex-col items-center justify-center text-neutral-300 py-12"
            >
              <div className="w-16 h-16 border border-neutral-200 rounded-2xl flex items-center justify-center mb-4 bg-white shadow-sm">
                <Search size={24} className="text-neutral-200" />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em]">Ready for Analysis</p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="max-w-5xl w-full mx-auto px-6 py-8 flex items-center justify-between text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
        <p>© 2026 Extractor</p>
        <div className="flex gap-6">
          <a href="#" className="hover:text-black transition-colors">Privacy</a>
          <a href="#" className="hover:text-black transition-colors">Terms</a>
        </div>
      </footer>
    </div>
  );
}
