/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { Search, Loader2, ExternalLink, Package, Globe, Tag, Ruler, Layers, DollarSign, Copy, Check, JapaneseYen } from "lucide-react";

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
  };
}

export default function App() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productInfo, setProductInfo] = useState<ProductInfo | null>(null);
  const [discount, setDiscount] = useState<number>(0);
  const [manualUsdPrice, setManualUsdPrice] = useState<number>(0);
  const [priceCopied, setPriceCopied] = useState(false);

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

  const copyPrice = async (price: number) => {
    try {
      await navigator.clipboard.writeText(Math.round(price).toString());
      setPriceCopied(true);
      setTimeout(() => setPriceCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy price!", err);
    }
  };

  const extractInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setLoading(true);
    setError(null);
    setProductInfo(null);

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `1. Search for the current USD to JPY market exchange rate.
        2. Extract product information from this URL: ${url}. 
        Provide the English product name, Japanese product name, and details in Japanese including price (required, in US Dollars), ID, material, and dimensions in cm.
        Also provide the numeric value of the USD price and the current USD/JPY exchange rate you found.`,
        config: {
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
      setLoading(false);
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
          <form onSubmit={extractInfo} className="relative group">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-stone-400 group-focus-within:text-emerald-600 transition-colors">
              <Search size={20} />
            </div>
            <input
              type="url"
              placeholder="https://example.com/product/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full pl-12 pr-32 py-4 bg-white border border-stone-200 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-lg"
              required
            />
            <button
              type="submit"
              disabled={loading || !url}
              className="absolute right-2 top-2 bottom-2 px-6 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : "Extract"}
            </button>
          </form>
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
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 text-stone-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                      >
                        <ExternalLink size={20} />
                      </a>
                    </div>
                  </div>
                </div>

                <div className="p-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Price */}
                    <div className="flex items-start gap-4">
                      <div className="flex items-center justify-center w-10 h-10 shrink-0 rounded-xl bg-emerald-50 text-emerald-600">
                        <DollarSign size={20} />
                      </div>
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
                      <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shrink-0">
                        <JapaneseYen size={20} />
                      </div>
                      <div className="flex-1">
                        <div className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Retail Price (JPY)</div>
                        <div className="flex items-baseline gap-2">
                          <div className="text-xl font-bold text-emerald-600">¥{retailPriceJpy.toLocaleString()}</div>
                          <button
                            onClick={() => copyPrice(retailPriceJpy)}
                            className="p-1 text-stone-400 hover:text-emerald-600 transition-colors"
                            title="Copy price"
                          >
                            {priceCopied ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                          {discount > 0 && (
                            <div className="text-xs font-medium text-stone-400 line-through">
                              ¥{calculateRetailPrice(manualUsdPrice, productInfo!.exchangeRate, 0).toLocaleString()}
                            </div>
                          )}
                        </div>
                        <div className="text-[10px] text-stone-400 mt-1 mb-3">Rate: ¥{productInfo.exchangeRate} / USD</div>
                        
                        <div className="flex gap-2">
                          {[0, 10, 20].map((val) => (
                            <button
                              key={val}
                              onClick={() => setDiscount(val)}
                              className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
                                discount === val
                                  ? "bg-emerald-600 border-emerald-600 text-white shadow-sm"
                                  : "bg-white border-stone-200 text-stone-500 hover:border-emerald-500 hover:text-emerald-600"
                              }`}
                            >
                              {val === 0 ? "Normal" : `${val}% OFF`}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* ID */}
                    {productInfo.details.id && (
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-xl bg-stone-50 flex items-center justify-center text-stone-400 shrink-0">
                          <Tag size={20} />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Product ID</div>
                          <div className="text-xl font-semibold">{productInfo.details.id}</div>
                        </div>
                      </div>
                    )}

                    {/* Material */}
                    {productInfo.details.material && (
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-xl bg-stone-50 flex items-center justify-center text-stone-400 shrink-0">
                          <Layers size={20} />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Material</div>
                          <div className="text-lg font-medium">{productInfo.details.material}</div>
                        </div>
                      </div>
                    )}

                    {/* Dimensions */}
                    {productInfo.details.dimensions && (
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-xl bg-stone-50 flex items-center justify-center text-stone-400 shrink-0">
                          <Ruler size={20} />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Dimensions</div>
                          <div className="text-lg font-medium">{productInfo.details.dimensions}</div>
                        </div>
                      </div>
                    )}
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

          {!productInfo && !loading && !error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-20 text-stone-300"
            >
              <div className="w-20 h-20 border-2 border-dashed border-stone-200 rounded-full flex items-center justify-center mb-4">
                <Search size={32} />
              </div>
              <p className="text-sm font-medium">Ready to analyze your product URL</p>
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
