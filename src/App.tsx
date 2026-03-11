/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
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
    if (!inputValue.trim()) return;

    const trimmedInput = inputValue.trim();
    const usdValue = parseFloat(trimmedInput);
    // If it's a pure number (optional decimal), treat as price. Otherwise, treat as URL.
    const isPrice = !isNaN(usdValue) && /^\d+(\.\d+)?$/.test(trimmedInput);

    setLoading(true);
    setProgress(0);
    setError(null);
    setProductInfo(null);

    if (isPrice) {
      setProgressMessage("Fetching exchange rate...");
      try {
        const response = await ai.models.generateContent({
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
        setError(err.message || "An error occurred during quick check.");
      } finally {
        setTimeout(() => setLoading(false), 500);
      }
    } else {
      // Extract Info Logic
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
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Extract product info from ${inputValue} and find current USD/JPY rate.
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
        setError(err.message || "An error occurred while extracting information.");
      } finally {
        clearInterval(progressInterval);
        setTimeout(() => setLoading(false), 500);
      }
    }
  };

  const retailPriceJpy = productInfo ? calculateRetailPrice(manualUsdPrice, productInfo.exchangeRate, discount) : 0;

  return (
    <div className="min-h-screen bg-[#F5F5F4] text-[#1C1917] font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
              <Package size={18} />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">Product Extractor</h1>
          </div>
          <div className="text-xs font-medium text-stone-500 uppercase tracking-widest">
            AI Powered Analysis
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 pt-6 pb-12">
        {/* Input Section */}
        <section className="mb-8">
          <form onSubmit={handleAction} className="relative group">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-stone-400 group-focus-within:text-emerald-600 transition-colors">
              <Search size={20} />
            </div>
            <input
              type="text"
              placeholder="Paste product URL or enter USD Price..."
              value={inputValue}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setInputValue(e.target.value)}
              className="w-full pl-12 pr-32 py-4 bg-white border border-stone-200 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-lg"
              required
            />
            <button
              type="submit"
              disabled={loading || !inputValue.trim()}
              className="absolute right-2 top-2 bottom-2 px-6 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 overflow-hidden min-w-[110px] justify-center"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="animate-spin" size={18} />
                  <span>{Math.round(progress)}%</span>
                </div>
              ) : (
                "Analyze"
              )}
            </button>
          </form>

          {/* Progress Bar */}
          <AnimatePresence>
            {loading && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 overflow-hidden"
              >
                <div className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">{progressMessage}</span>
                    <span className="text-xs font-bold text-emerald-600">{Math.round(progress)}%</span>
                  </div>
                  <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-emerald-600"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Results Section */}
        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="p-4 bg-red-50 border border-red-100 text-red-700 rounded-xl mb-8 flex items-center gap-3"
            >
              <div className="w-2 h-2 rounded-full bg-red-500" />
              {error}
            </motion.div>
          )}

          {productInfo && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {/* Main Info Card */}
              <div className="bg-white border border-stone-200 rounded-3xl overflow-hidden shadow-sm">
                <div className="p-8 border-b border-stone-100 bg-stone-50/50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <h3 className="text-2xl font-bold leading-tight">{productInfo.englishName}</h3>
                      <h4 className="text-xl font-medium text-stone-600 leading-tight">{productInfo.japaneseName}</h4>
                    </div>
                    <div className="flex items-center gap-2">
                      {inputValue.startsWith("http") && (
                        <a
                          href={inputValue}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-stone-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                        >
                          <ExternalLink size={20} />
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                    {/* Left Column: Physical Details */}
                    <div className="space-y-8">
                      {/* Color */}
                      {productInfo.details.color && (
                        <div className="flex items-start gap-4">
                          <button
                            onClick={() => copyToClipboard("color", productInfo.details.color!)}
                            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                              copiedStates["color"] ? "bg-emerald-600 text-white" : "bg-stone-50 text-stone-400 hover:bg-stone-100 hover:text-emerald-600"
                            }`}
                            title="Copy color"
                          >
                            {copiedStates["color"] ? <Check size={20} /> : <Palette size={20} />}
                          </button>
                          <div>
                            <div className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Color</div>
                            <div className="text-lg font-medium">{productInfo.details.color}</div>
                          </div>
                        </div>
                      )}

                      {/* ID */}
                      {productInfo.details.id && (
                        <div className="flex items-start gap-4">
                          <button
                            onClick={() => copyToClipboard("id", productInfo.details.id!)}
                            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                              copiedStates["id"] ? "bg-emerald-600 text-white" : "bg-stone-50 text-stone-400 hover:bg-stone-100 hover:text-emerald-600"
                            }`}
                            title="Copy product ID"
                          >
                            {copiedStates["id"] ? <Check size={20} /> : <Tag size={20} />}
                          </button>
                          <div>
                            <div className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Product ID</div>
                            <div className="text-xl font-semibold">{productInfo.details.id}</div>
                          </div>
                        </div>
                      )}

                      {/* Material */}
                      {productInfo.details.material && (
                        <div className="flex items-start gap-4">
                          <button
                            onClick={() => copyToClipboard("material", productInfo.details.material!)}
                            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                              copiedStates["material"] ? "bg-emerald-600 text-white" : "bg-stone-50 text-stone-400 hover:bg-stone-100 hover:text-emerald-600"
                            }`}
                            title="Copy material"
                          >
                            {copiedStates["material"] ? <Check size={20} /> : <Layers size={20} />}
                          </button>
                          <div>
                            <div className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Material</div>
                            <div className="text-lg font-medium">{productInfo.details.material}</div>
                          </div>
                        </div>
                      )}

                      {/* Dimensions */}
                      {productInfo.details.dimensions && (
                        <div className="flex items-start gap-4">
                          <button
                            onClick={() => copyToClipboard("dimensions", productInfo.details.dimensions!)}
                            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                              copiedStates["dimensions"] ? "bg-emerald-600 text-white" : "bg-stone-50 text-stone-400 hover:bg-stone-100 hover:text-emerald-600"
                            }`}
                            title="Copy dimensions"
                          >
                            {copiedStates["dimensions"] ? <Check size={20} /> : <Ruler size={20} />}
                          </button>
                          <div>
                            <div className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Dimensions</div>
                            <div className="text-lg font-medium">{productInfo.details.dimensions}</div>
                          </div>
                        </div>
                      )}

                      {/* Summary */}
                      {productInfo.details.description && (
                        <div className="flex items-start gap-4">
                          <button
                            onClick={() => copyToClipboard("description", productInfo.details.description!)}
                            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                              copiedStates["description"] ? "bg-emerald-600 text-white" : "bg-stone-50 text-stone-400 hover:bg-stone-100 hover:text-emerald-600"
                            }`}
                            title="Copy summary"
                          >
                            {copiedStates["description"] ? <Check size={20} /> : <FileText size={20} />}
                          </button>
                          <div>
                            <div className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Summary</div>
                            <div className="text-[11px] text-stone-600 leading-relaxed italic pr-4">
                              {productInfo.details.description}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right Column: Pricing Details */}
                    <div className="space-y-8">
                      {/* Price USD */}
                      <div className="flex items-start gap-4">
                        <button
                          onClick={() => copyToClipboard("usd", manualUsdPrice)}
                          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                            copiedStates["usd"] ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                          }`}
                          title="Copy USD price"
                        >
                          {copiedStates["usd"] ? <Check size={20} /> : <DollarSign size={20} />}
                        </button>
                        <div className="flex-1">
                          <div className="mb-1 text-xs font-bold tracking-wider uppercase text-stone-400">Price (USD)</div>
                          <div className="relative group/input">
                            <span className="absolute left-0 text-xl font-semibold text-stone-900">$</span>
                            <input
                              type="number"
                              step="0.01"
                              value={manualUsdPrice}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => setManualUsdPrice(parseFloat(e.target.value) || 0)}
                              className="w-full pl-4 text-xl font-semibold transition-all bg-transparent border-b border-transparent border-stone-200 focus:outline-none focus:border-emerald-500 hover:border-stone-300"
                            />
                          </div>
                          <div className="mt-1 text-[10px] text-stone-400">Editable value</div>
                        </div>
                      </div>

                      {/* Retail Price JPY */}
                      <div className="flex items-start gap-4">
                        <button
                          onClick={() => copyToClipboard("jpy", retailPriceJpy)}
                          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                            copiedStates["jpy"] ? "bg-emerald-700 text-white" : "bg-emerald-600 text-white hover:bg-emerald-700"
                          }`}
                          title="Copy JPY price"
                        >
                          {copiedStates["jpy"] ? <Check size={20} /> : <JapaneseYen size={20} />}
                        </button>
                        <div className="flex-1">
                          <div className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Retail Price (JPY)</div>
                          <div className="flex items-baseline gap-2">
                            <div className="text-xl font-bold text-emerald-600">¥{retailPriceJpy.toLocaleString()}</div>
                            {discount !== 0 && (
                              <div className="text-xs font-medium text-stone-400 line-through">
                                ¥{calculateRetailPrice(manualUsdPrice, productInfo!.exchangeRate, 0).toLocaleString()}
                              </div>
                            )}
                          </div>
                          <div className="text-[10px] text-stone-400 mt-1 mb-3">Rate: ¥{productInfo.exchangeRate} / USD</div>
                          
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-1">
                              {[
                                { label: "20% OFF", val: 20, color: "bg-indigo-600", border: "border-indigo-600", hover: "hover:text-indigo-600 hover:border-indigo-600" },
                                { label: "10% OFF", val: 10, color: "bg-blue-600", border: "border-blue-600", hover: "hover:text-blue-600 hover:border-blue-600" },
                                { label: "Normal", val: 0, color: "bg-emerald-600", border: "border-emerald-600", hover: "hover:text-emerald-600 hover:border-emerald-600" },
                                { label: "10% UP", val: -10, color: "bg-orange-600", border: "border-orange-600", hover: "hover:text-orange-600 hover:border-orange-600" },
                                { label: "20% UP", val: -20, color: "bg-rose-600", border: "border-rose-600", hover: "hover:text-rose-600 hover:border-rose-600" },
                              ].map((btn) => (
                                <button
                                  key={btn.label}
                                  onClick={() => setDiscount(btn.val)}
                                  className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all border whitespace-nowrap ${
                                    discount === btn.val
                                      ? `${btn.color} ${btn.border} text-white shadow-sm`
                                      : `bg-white border-stone-200 text-stone-500 ${btn.hover}`
                                  }`}
                                >
                                  {btn.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Raw Data Preview (Optional, for transparency) */}
              <div className="text-center">
                <p className="text-xs text-stone-400">
                  Information extracted using Gemini 3 Flash. Accuracy may vary based on website structure.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto px-6 py-12 border-t border-stone-200 mt-20">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-stone-500">
          <p>© 2026 Product Info Extractor. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <a href="#" className="hover:text-emerald-600 transition-colors">Privacy</a>
            <a href="#" className="hover:text-emerald-600 transition-colors">Terms</a>
            <a href="#" className="hover:text-emerald-600 transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
