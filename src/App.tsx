/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, Loader2, ExternalLink, Package, Tag, Ruler, Layers, DollarSign, Copy, Check, JapaneseYen, Palette, FileText, RefreshCw, Sun, Moon, Eye, EyeOff } from "lucide-react";

const fetchMarketRate = async (
  setProgressMsg?: (msg: string) => void
): Promise<number> => {
  if (setProgressMsg) setProgressMsg("Fetching market rate...");
  const timeoutPromise = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error("TIMEOUT")), 30000)
  );

  const fetchPromise = async () => {
    const response = await fetch("/api/exchange-rate");
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();
    if (typeof data?.exchangeRate === "number") return data.exchangeRate;
    throw new Error("Invalid exchange rate format");
  };

  return await Promise.race([fetchPromise(), timeoutPromise]);
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

  // If text does not contain cm/センチ and contains inch marks (e.g. 10.5" or 10.5 in or 10.5 inches),
  // convert inches to cm (1 in = 2.54 cm) and round up
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

  // Ensure "約" is added in front if not already present
  if (text && !text.includes("約")) {
    text = `約${text}`;
  }

  return text;
};

const formatMaterial = (raw?: string): string => {
  if (!raw) return "N/A";
  const text = raw.trim();
  if (!text || /^(?:n\/?a|none|null|undefined|-|不明|なし|該当なし|情報なし)$/i.test(text)) {
    return "N/A";
  }
  return text;
};

const CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours in milliseconds
const SHIPPING_COST = 7500;

const cleanErrorMessage = (raw: string): string => {
  if (!raw) return "An unexpected error occurred. Please try again.";
  try {
    const jsonMatch = raw.match(/\{[\s\S]*"error"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed?.error?.message) {
        if (parsed.error.code === 503 || parsed.error.status === "UNAVAILABLE" || parsed.error.message.includes("high demand")) {
          return "The AI model is currently experiencing temporary high demand. Please click Retry in a few moments, or try entering the product name directly.";
        }
        if (parsed.error.code === 429 || parsed.error.status === "RESOURCE_EXHAUSTED") {
          return "Rate limit reached. Please wait a moment and click Retry.";
        }
        return parsed.error.message;
      }
    }
  } catch {
    // ignore
  }
  if (raw.includes("503") || raw.includes("high demand") || raw.includes("UNAVAILABLE")) {
    return "The AI model is currently experiencing temporary high demand. Please click Retry below in a few moments, or try entering the product name directly.";
  }
  return raw;
};

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
  const [showReferenceNote, setShowReferenceNote] = useState<boolean>(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('theme') as 'dark' | 'light') || 'light';
    }
    return 'light';
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
      const newRate = await fetchMarketRate(setProgressMessage);
      
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
    } catch (err: any) {
      console.error("Exchange rate refresh error:", err);
      setError(`Failed to refresh rate: ${err.message || "Unknown error"}`);
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
          setTimeout(() => reject(new Error("TIMEOUT")), 180000)
        );

        // Check cache for exchange rate
        const cachedRate = localStorage.getItem("usd_jpy_rate");
        const cachedTimestamp = localStorage.getItem("usd_jpy_timestamp");
        const now = Date.now();
        const isCacheValid = cachedRate && cachedTimestamp && (now - parseInt(cachedTimestamp)) < CACHE_DURATION;
        
        let finalRate: number | null = null;

        if (isCacheValid) {
          finalRate = parseFloat(cachedRate!);
          setProgress(100);
          setProgressMessage("Check complete (cached)!");
        } else {
          try {
            finalRate = await fetchMarketRate(setProgressMessage);
            
            if (finalRate) {
              // Update cache
              localStorage.setItem("usd_jpy_rate", finalRate.toString());
              localStorage.setItem("usd_jpy_timestamp", Date.now().toString());
              
              setProgress(100);
              setProgressMessage("Check complete!");
            }
          } catch (fetchErr) {
            console.warn("Live exchange rate fetch failed after all attempts, checking for stale cache...", fetchErr);
          }

          // Fallback to stale cache if live fetch failed
          if (!finalRate && cachedRate) {
            finalRate = parseFloat(cachedRate);
            setProgress(100);
            setProgressMessage("Check complete (using stale rate)!");
          }
        }

        if (!finalRate) {
          throw new Error("Could not fetch exchange rate and no cached rate available.");
        }

        setProductInfo({
          englishName: "Quick Price Check",
          japaneseName: "クイック価格チェック",
          usdPriceValue: usdValue,
          exchangeRate: finalRate,
          details: {
            price: `$${usdValue.toFixed(2)}`,
            id: "N/A",
            material: "N/A",
            dimensions: "N/A",
            color: "N/A",
            description: "クイックチェックの結果です。詳細情報は含まれません。"
          }
        });
        setManualUsdPrice(usdValue);
      } catch (err: any) {
        console.error(err);
        if (err.message === "TIMEOUT") {
          setError("The request timed out while fetching exchange rates. Please check your connection and try again.");
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
            return prev + Math.random() * 6;
          }
          if (prev < 65) {
            setProgressMessage("Analyzing product page...");
            return prev + Math.random() * 5;
          }
          if (prev < 90) {
            setProgressMessage("Generating Japanese translation...");
            return prev + Math.random() * 3;
          }
          if (prev < 98) {
            setProgressMessage("Finalizing product details...");
            return Math.min(98, prev + 0.4);
          }
          return prev;
        });
      }, 350);

      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("TIMEOUT")), 180000)
        );

        // Check cache for exchange rate
        const cachedRate = localStorage.getItem("usd_jpy_rate");
        const cachedTimestamp = localStorage.getItem("usd_jpy_timestamp");
        const now = Date.now();
        const isCacheValid = cachedRate && cachedTimestamp && (now - parseInt(cachedTimestamp)) < CACHE_DURATION;
        
        // Start fetching the exchange rate in the background if not cached
        const ratePromise = isCacheValid 
          ? Promise.resolve(parseFloat(cachedRate!)) 
          : fetchMarketRate();

        const isUrl = trimmedInput.startsWith("http");
        setProgressMessage(isUrl ? "Analyzing product page..." : "Searching product info...");
        
        // If we have a cached rate, we can provide it to the AI to help with its internal math
        const rateToUse: number | null = isCacheValid ? parseFloat(cachedRate!) : null;
        const rateInstruction = rateToUse 
          ? `The current USD/JPY exchange rate is ${rateToUse}.` 
          : `Find the current USD/JPY market exchange rate and use it for calculations.`;

        const analyzePromise = (async () => {
          const res = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input: trimmedInput, rateInstruction }),
          });
          const json = await res.json();
          if (!res.ok) {
            throw new Error(json.error || `Server error: ${res.status}`);
          }
          return json.data;
        })();

        let finalLiveRate: number | null = null;
        let productData: any = null;

        const [aiData, liveRate] = await Promise.race([
          Promise.all([analyzePromise, ratePromise]),
          timeoutPromise as any
        ]);

        productData = aiData;
        finalLiveRate = liveRate;

        if (productData) {
          setProgress(100);
          setProgressMessage("Extraction complete!");

          // Prioritize the live rate we fetched in parallel for better accuracy
          if (finalLiveRate) {
            productData.exchangeRate = finalLiveRate;
          }

          // Ensure dimensions are rounded up to whole numbers in cm with 約
          if (productData?.details?.dimensions) {
            productData.details.dimensions = roundUpDimensions(productData.details.dimensions);
          }
          
          // Update cache
          if (productData.exchangeRate) {
            localStorage.setItem("usd_jpy_rate", productData.exchangeRate.toString());
            localStorage.setItem("usd_jpy_timestamp", Date.now().toString());
          }

          setProductInfo(productData);
          setManualUsdPrice(productData.usdPriceValue);
        } else {
          throw new Error("No information could be extracted from this URL or product. Please try searching by product name.");
        }
      } catch (err: any) {
        console.error(err);
        if (err.message === "TIMEOUT") {
          setError("The analysis timed out. This can happen with complex product pages or slow connections. Please try again or use the product name instead of a URL.");
        } else {
          setError(cleanErrorMessage(err.message || "An error occurred while extracting information."));
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
    const shipping = SHIPPING_COST;
    const markup = 1.1; // 10%
    const fee = 1.05; // 5%
    
    // Formula: (((USD×tax)×(rate+spread))+7500)×(markup)×fee
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
  const convertedPriceJpy = productInfo ? Math.round(manualUsdPrice * productInfo.exchangeRate) : 0;

  return (
    <div className="min-h-screen lg:h-screen lg:overflow-hidden flex flex-col font-sans relative overflow-x-hidden transition-colors duration-500">
      {/* Animated Background Orbs */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className={`absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full blur-[120px] animate-orb transition-colors duration-1000 ${theme === 'dark' ? 'bg-blue-600/15' : 'bg-blue-400/8'}`} />
        <div className={`absolute bottom-[10%] right-[-5%] w-[35%] h-[35%] rounded-full blur-[120px] animate-orb [animation-delay:2s] transition-colors duration-1000 ${theme === 'dark' ? 'bg-[#0f62fe]/10' : 'bg-cyan-400/8'}`} />
        <div className={`absolute top-[40%] left-[30%] w-[25%] h-[25%] rounded-full blur-[120px] animate-orb [animation-delay:4s] transition-colors duration-1000 ${theme === 'dark' ? 'bg-indigo-600/8' : 'bg-indigo-400/4'}`} />
      </div>

      {/* Header */}
      <header className="glass-panel sticky top-0 z-20 px-6 py-2.5 shrink-0">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-8">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-lg flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <Package size={17} strokeWidth={2.5} />
            </div>
            <h1 className={`text-base font-bold tracking-tight whitespace-nowrap bg-clip-text text-transparent bg-gradient-to-r ${theme === 'dark' ? 'from-white to-white/60' : 'from-slate-900 to-slate-500'}`}>Analyzer</h1>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className={`p-2 rounded-lg border transition-all cursor-pointer ${
                theme === 'dark' 
                  ? 'bg-white/[0.05] border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.1]' 
                  : 'bg-black/[0.03] border-black/[0.05] text-slate-500 hover:text-slate-900 hover:bg-black/[0.05]'
              }`}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 max-w-6xl w-full mx-auto px-6 py-4 flex flex-col gap-4 relative z-10">
        {/* Input Section */}
        <section className="w-full shrink-0">
          <form onSubmit={handleAction} className="relative flex gap-2.5">
            <div className="relative flex-1 group">
              <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-white/20 group-focus-within:text-blue-500 transition-colors">
                <Search size={18} />
              </div>
              <input
                type="text"
                placeholder="Paste URL, product name, or enter USD price..."
                value={inputValue}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setInputValue(e.target.value)}
                className={`w-full pl-10 pr-4 py-3 rounded-xl text-sm input-focus shadow-lg backdrop-blur-md transition-all border ${
                  theme === 'dark' 
                    ? 'bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/20 hover:bg-white/[0.05]' 
                    : 'bg-white/60 border-slate-200/50 text-slate-900 placeholder:text-slate-400 hover:bg-white/80'
                }`}
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading || !inputValue.trim()}
              className={`px-6 py-3 rounded-xl text-sm font-bold whitespace-nowrap shrink-0 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-2 active:scale-95 border cursor-pointer ${
                theme === 'dark'
                  ? 'bg-white text-black hover:bg-white/90 shadow-[0_0_20px_rgba(255,255,255,0.1)] border-transparent'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800 shadow-lg shadow-neutral-900/10 border-transparent'
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  <span className="tabular-nums">{Math.round(progress)}%</span>
                </>
              ) : (
                "Analyze"
              )}
            </button>
            {loading && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className={`px-4 py-3 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-all backdrop-blur-md border ${
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
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="mt-2.5 px-1"
              >
                <div className={`h-1.5 w-full rounded-full overflow-hidden border ${
                  theme === 'dark' ? 'bg-white/[0.05] border-white/[0.05]' : 'bg-black/[0.03] border-black/[0.03]'
                }`}>
                  <motion.div
                    className="h-full bg-gradient-to-r from-blue-600 to-cyan-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                  />
                </div>
                <div className="flex justify-between items-center mt-1.5">
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-white/30' : 'text-slate-400'}`}>
                    {progress > 80 ? "Finalizing..." : progressMessage}
                  </p>
                  <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest tabular-nums">
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
              className={`p-4 border rounded-xl text-xs font-medium flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 backdrop-blur-md shrink-0 ${
                theme === 'dark' 
                  ? 'bg-rose-500/10 border-rose-500/20 text-rose-200' 
                  : 'bg-rose-50 border-rose-100 text-rose-700'
              }`}
            >
              <div className="space-y-1">
                <p className="font-semibold leading-relaxed">{error}</p>
                {inputValue.startsWith("http") && (
                  <p className={`text-[11px] ${theme === 'dark' ? 'text-white/40' : 'text-slate-500'}`}>
                    Tip: If the website blocks automated scrapers, you can paste the product brand and model name directly.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => startAnalysis(inputValue)}
                disabled={loading || !inputValue.trim()}
                className={`px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-all active:scale-95 border cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-white/10 hover:bg-white/20 text-white border-white/10'
                    : 'bg-rose-600 hover:bg-rose-700 text-white border-transparent'
                }`}
              >
                Retry
              </button>
            </motion.div>
          )}

          {productInfo && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch"
            >
              {/* Product Header & Details (Left) */}
              <div className="lg:col-span-7 flex flex-col min-h-0">
                <div className="compact-card p-5 lg:p-6 flex flex-col justify-between h-full relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500" />
                  
                  <div className="flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1.5 min-w-0">
                        <div 
                          onClick={() => copyToClipboard("japaneseName", productInfo.japaneseName)}
                          className="group cursor-pointer relative"
                        >
                          <h3 className={`text-xl lg:text-2xl font-bold tracking-tight leading-snug transition-all group-hover:opacity-70 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                            {productInfo.japaneseName}
                          </h3>
                          {copiedStates["japaneseName"] && (
                            <motion.div 
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="absolute -top-5 left-0 px-2 py-0.5 rounded bg-blue-600 text-[9px] font-bold text-white uppercase tracking-widest"
                            >
                              Copied
                            </motion.div>
                          )}
                        </div>
                        
                        <div 
                          onClick={() => copyToClipboard("englishName", productInfo.englishName)}
                          className="group cursor-pointer relative"
                        >
                          <h4 className={`text-xs lg:text-sm font-medium tracking-wide transition-all group-hover:opacity-70 truncate ${theme === 'dark' ? 'text-white/40' : 'text-slate-400'}`}>
                            {productInfo.englishName}
                          </h4>
                          {copiedStates["englishName"] && (
                            <motion.div 
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="absolute -top-5 left-0 px-2 py-0.5 rounded bg-blue-600 text-[9px] font-bold text-white uppercase tracking-widest"
                            >
                              Copied
                            </motion.div>
                          )}
                        </div>
                      </div>
                      {inputValue.startsWith("http") && (
                        <a
                          href={inputValue}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`p-2.5 rounded-xl shrink-0 transition-all border ${
                            theme === 'dark'
                              ? 'text-white/30 hover:text-white hover:bg-white/10 border-white/5'
                              : 'text-slate-400 hover:text-slate-900 hover:bg-black/[0.03] border-black/[0.05]'
                          }`}
                        >
                          <ExternalLink size={18} />
                        </a>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "Color", value: productInfo.details.color?.trim() || "N/A", icon: Palette, key: "color" },
                        { label: "Product ID", value: productInfo.details.id?.trim() || "N/A", icon: Tag, key: "id" },
                        { label: "Material", value: formatMaterial(productInfo.details.material), icon: Layers, key: "material" },
                        { label: "Dimensions", value: roundUpDimensions(productInfo.details.dimensions), icon: Ruler, key: "dimensions" },
                      ].map((item) => item.value && (
                        <button
                          key={item.key}
                          onClick={() => copyToClipboard(item.key, item.value!)}
                          title={item.value}
                          className={`p-3.5 text-left rounded-xl border transition-all group relative overflow-hidden cursor-pointer ${
                            copiedStates[item.key] 
                              ? "bg-blue-500/20 border-blue-500/30 ring-1 ring-blue-500/30" 
                              : theme === 'dark'
                                ? "bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.08] hover:border-white/[0.15]"
                                : "bg-black/[0.02] border-black/[0.05] hover:bg-black/[0.04] hover:border-black/[0.1]"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <item.icon size={13} className={copiedStates[item.key] ? "text-blue-500" : theme === 'dark' ? "text-white/20" : "text-neutral-400"} />
                              <span className={`text-[10px] font-bold uppercase tracking-[0.15em] ${copiedStates[item.key] ? "text-blue-500" : theme === 'dark' ? "text-white/30" : "text-neutral-400"}`}>
                                {item.label}
                              </span>
                            </div>
                            {copiedStates[item.key] && (
                              <motion.span 
                                initial={{ opacity: 0, x: 5 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="text-[9px] font-black text-blue-500 uppercase tracking-tighter"
                              >
                                Copied
                              </motion.span>
                            )}
                          </div>
                          <p className={`text-xs font-semibold line-clamp-2 leading-snug ${copiedStates[item.key] ? (theme === 'dark' ? "text-white" : "text-blue-900") : (theme === 'dark' ? "text-white/80" : "text-slate-900")}`}>
                            {item.value}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {productInfo.details.description && (
                    <button
                      onClick={() => copyToClipboard("description", productInfo.details.description!)}
                      className={`mt-4 p-4 w-full text-left rounded-xl relative group transition-all overflow-hidden border cursor-pointer ${
                        copiedStates["description"]
                          ? "bg-blue-600 border-blue-400 text-white shadow-lg shadow-blue-500/20"
                          : theme === 'dark'
                            ? "bg-white/[0.03] border-white/[0.05] text-white/70 hover:bg-white/[0.06] hover:border-white/[0.1]"
                            : "bg-[#080F20] border-transparent text-white hover:bg-black"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <FileText size={13} className={copiedStates["description"] ? "text-blue-200" : theme === 'dark' ? "text-white/20" : "text-white/40"} />
                          <span className={`text-[10px] font-bold uppercase tracking-[0.15em] ${copiedStates["description"] ? "text-blue-100" : theme === 'dark' ? "text-white/30" : "text-white/40"}`}>
                            Summary
                          </span>
                        </div>
                        {copiedStates["description"] && (
                          <motion.span 
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="text-[9px] font-black text-blue-200 uppercase tracking-widest"
                          >
                            Copied to clipboard
                          </motion.span>
                        )}
                      </div>
                      <p className={`text-xs leading-relaxed ${copiedStates["description"] ? "text-white" : theme === 'dark' ? "text-white/60" : "text-white/80"}`}>
                        {productInfo.details.description}
                      </p>
                    </button>
                  )}
                </div>
              </div>

              {/* Pricing & Controls (Right) */}
              <div className="lg:col-span-5 flex flex-col min-h-0">
                <div className="compact-card p-5 lg:p-6 flex flex-col justify-between h-full relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500" />
                  
                  <div className="space-y-3.5">
                    {/* USD Input */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-white/30' : 'text-slate-400'}`}>Price (USD)</span>
                        <button
                          onClick={() => copyToClipboard("usd", manualUsdPrice)}
                          className={`text-[10px] font-bold transition-colors uppercase tracking-widest cursor-pointer ${theme === 'dark' ? 'text-white/30 hover:text-blue-500' : 'text-slate-400 hover:text-blue-600'}`}
                        >
                          {copiedStates["usd"] ? "COPIED" : "COPY"}
                        </button>
                      </div>
                      <div className="relative">
                        <span className={`absolute left-0 top-1/2 -translate-y-1/2 text-xl font-bold ${theme === 'dark' ? 'text-white/20' : 'text-neutral-300'}`}>$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={manualUsdPrice}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setManualUsdPrice(parseFloat(e.target.value) || 0)}
                          className={`w-full pl-5 py-1 text-2xl font-bold tabular-nums bg-transparent focus:outline-none border-b transition-colors ${
                            theme === 'dark' 
                              ? 'border-white/[0.05] focus:border-blue-500/50 text-white' 
                              : 'border-black/[0.05] focus:border-blue-500/50 text-slate-900'
                          }`}
                        />
                      </div>
                    </div>

                    {/* JPY Result */}
                    <div className={`p-4 rounded-2xl border space-y-3 backdrop-blur-md ${
                      theme === 'dark' ? 'bg-white/[0.02] border-white/[0.05]' : 'bg-black/[0.02] border-black/[0.05]'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <span className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-white/30' : 'text-slate-400'}`}>Retail Price (JPY)</span>
                          <div className="flex items-baseline gap-2.5">
                            <span className={`text-3xl font-bold tracking-tight tabular-nums transition-all duration-500 ${
                              discount === 20 ? (theme === 'dark' ? "text-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.3)]" : "text-cyan-600") :
                              discount === 10 ? (theme === 'dark' ? "text-blue-400 drop-shadow-[0_0_15px_rgba(96,165,250,0.3)]" : "text-blue-600") :
                              discount === -10 ? (theme === 'dark' ? "text-orange-400 drop-shadow-[0_0_15px_rgba(251,146,60,0.3)]" : "text-orange-600") :
                              discount === -20 ? (theme === 'dark' ? "text-rose-400 drop-shadow-[0_0_15px_rgba(251,113,133,0.3)]" : "text-rose-600") :
                              (theme === 'dark' ? "text-white" : "text-slate-900")
                            }`}>
                              ¥{retailPriceJpy.toLocaleString()}
                            </span>
                            {discount !== 0 && (
                              <span className={`text-xs font-bold line-through tabular-nums ${theme === 'dark' ? 'text-white/20' : 'text-slate-400'}`}>
                                ¥{calculateRetailPrice(manualUsdPrice, productInfo!.exchangeRate, 0).toLocaleString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => copyToClipboard("jpy", retailPriceJpy)}
                          className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20 hover:scale-105 active:scale-95 transition-all cursor-pointer shrink-0"
                        >
                          {copiedStates["jpy"] ? <Check size={18} /> : <JapaneseYen size={18} />}
                        </button>
                      </div>

                      <div className="grid grid-cols-5 gap-1">
                        {[
                          { label: "20% OFF", val: 20, color: theme === 'dark' ? "hover:bg-cyan-500/10 hover:text-cyan-400" : "hover:bg-cyan-50 hover:text-cyan-600", active: "bg-cyan-600 text-white shadow-md shadow-cyan-600/20" },
                          { label: "10% OFF", val: 10, color: theme === 'dark' ? "hover:bg-blue-500/10 hover:text-blue-400" : "hover:bg-blue-50 hover:text-blue-600", active: "bg-blue-600 text-white shadow-md shadow-blue-600/20" },
                          { label: "Normal", val: 0, color: theme === 'dark' ? "hover:bg-white/10" : "hover:bg-black/10", active: theme === 'dark' ? "bg-white text-black shadow-md shadow-white/10" : "bg-slate-900 text-white shadow-md shadow-slate-900/10" },
                          { label: "10% UP", val: -10, color: theme === 'dark' ? "hover:bg-orange-500/10 hover:text-orange-400" : "hover:bg-orange-50 hover:text-orange-600", active: "bg-orange-500 text-white shadow-md shadow-orange-500/20" },
                          { label: "20% UP", val: -20, color: theme === 'dark' ? "hover:bg-rose-500/10 hover:text-rose-400" : "hover:bg-rose-50 hover:text-rose-600", active: "bg-rose-500 text-white shadow-md shadow-rose-500/20" },
                        ].map((btn) => (
                          <button
                            key={btn.label}
                            onClick={() => setDiscount(btn.val)}
                            className={`py-1.5 rounded-lg text-[8px] font-black uppercase tracking-tighter transition-all border border-transparent whitespace-nowrap flex items-center justify-center cursor-pointer ${
                              discount === btn.val ? btn.active : `${theme === 'dark' ? 'bg-white/[0.03] border-white/[0.05] text-white/40' : 'bg-black/[0.03] border-black/[0.05] text-slate-400'} ${btn.color}`
                            }`}
                          >
                            {btn.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Conversion Price (USD to JPY) */}
                    <div className={`p-3.5 rounded-2xl border backdrop-blur-md transition-all ${
                      theme === 'dark' ? 'bg-white/[0.02] border-white/[0.05]' : 'bg-black/[0.02] border-black/[0.05]'
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-white/30' : 'text-slate-400'}`}>
                          Conversion Price (JPY)
                        </span>
                        <button
                          onClick={() => copyToClipboard("conversion", convertedPriceJpy)}
                          className={`text-[10px] font-bold transition-colors uppercase tracking-widest cursor-pointer ${
                            copiedStates["conversion"]
                              ? "text-blue-500 font-bold"
                              : theme === 'dark' ? 'text-white/30 hover:text-blue-500' : 'text-slate-400 hover:text-blue-600'
                          }`}
                        >
                          {copiedStates["conversion"] ? "COPIED" : "COPY"}
                        </button>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <div 
                          onClick={() => copyToClipboard("conversion", convertedPriceJpy)}
                          className="cursor-pointer group flex items-baseline gap-2"
                          title="Click to copy conversion price"
                        >
                          <span className={`text-xl font-bold tracking-tight tabular-nums transition-opacity group-hover:opacity-80 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                            ¥{convertedPriceJpy.toLocaleString()}
                          </span>
                        </div>
                        <span className={`text-[11px] font-medium tracking-wide tabular-nums ${theme === 'dark' ? 'text-white/30' : 'text-slate-400'}`}>
                          ${manualUsdPrice} × ¥{productInfo.exchangeRate}
                        </span>
                      </div>

                      <div className={`mt-2.5 pt-2.5 border-t transition-all ${
                        theme === 'dark' ? 'border-white/[0.05]' : 'border-black/[0.05]'
                      }`}>
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setShowReferenceNote(prev => !prev)}
                            className={`text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                              theme === 'dark' ? 'text-white/40 hover:text-white/80' : 'text-slate-400 hover:text-slate-700'
                            }`}
                            title={showReferenceNote ? "Hide reference note text" : "Show reference note text"}
                          >
                            {showReferenceNote ? <EyeOff size={12} /> : <Eye size={12} />}
                            <span>{showReferenceNote ? "Hide Note" : "Reference Note"}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => copyToClipboard("conversion_note", `※上記参考価格は現地参考価格を1$＝${productInfo.exchangeRate}円で換算したものです。`)}
                            className={`text-[10px] font-bold transition-colors uppercase tracking-widest flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                              copiedStates["conversion_note"]
                                ? "text-blue-500 font-bold"
                                : theme === 'dark' ? 'text-white/40 hover:text-blue-500' : 'text-slate-400 hover:text-blue-600'
                            }`}
                            title="Copy reference note text"
                          >
                            {copiedStates["conversion_note"] ? (
                              <>
                                <Check size={12} />
                                COPIED
                              </>
                            ) : (
                              <>
                                <Copy size={12} />
                                COPY
                              </>
                            )}
                          </button>
                        </div>

                        {showReferenceNote && (
                          <div
                            onClick={() => copyToClipboard("conversion_note", `※上記参考価格は現地参考価格を1$＝${productInfo.exchangeRate}円で換算したものです。`)}
                            className={`mt-2 px-2.5 py-2 rounded-xl cursor-pointer group transition-all select-none border ${
                              theme === 'dark'
                                ? 'bg-white/[0.02] border-white/[0.05] hover:border-white/10'
                                : 'bg-black/[0.02] border-black/[0.05] hover:border-black/10'
                            }`}
                            title="Click on text to copy"
                          >
                            <p className={`text-[11px] leading-snug transition-colors ${
                              copiedStates["conversion_note"]
                                ? "text-blue-500 font-medium"
                                : theme === 'dark'
                                ? "text-white/60 group-hover:text-white/90"
                                : "text-slate-600 group-hover:text-slate-900"
                            }`}>
                              ※上記参考価格は現地参考価格を1$＝{productInfo.exchangeRate}円で換算したものです。
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className={`mt-4 pt-3 border-t flex items-center justify-between gap-4 text-[10px] font-bold uppercase tracking-[0.15em] ${theme === 'dark' ? 'border-white/[0.05] text-white/30' : 'border-black/[0.05] text-slate-400'}`}>
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <span>Rate:</span>
                      <span className={`tabular-nums ${theme === 'dark' ? 'text-white/60' : 'text-neutral-700'}`}>¥{productInfo.exchangeRate}/USD</span>
                      <button 
                        onClick={refreshExchangeRate}
                        disabled={loading}
                        className="hover:text-blue-500 transition-colors disabled:opacity-50 p-0.5 cursor-pointer"
                        title="Refresh exchange rate"
                      >
                        <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <span>Shipping:</span>
                      <span className={`tabular-nums ${theme === 'dark' ? 'text-white/60' : 'text-neutral-700'}`}>¥{SHIPPING_COST.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {!productInfo && !loading && !error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex flex-col items-center justify-center py-8"
            >
              <div className={`w-16 h-16 border rounded-2xl flex items-center justify-center mb-4 shadow-xl backdrop-blur-md transition-all ${
                theme === 'dark' ? 'border-blue-500/20 bg-blue-950/25' : 'border-blue-200 bg-blue-50/50'
              }`}>
                <Search size={26} className={theme === 'dark' ? 'text-blue-400/70' : 'text-blue-600/60'} />
              </div>
              <p className={`text-[10px] font-bold uppercase tracking-[0.3em] transition-colors ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Awaiting Input</p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className={`max-w-6xl w-full mx-auto px-6 py-2.5 shrink-0 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.2em] relative z-10 ${
        theme === 'dark' ? 'text-white/20' : 'text-neutral-400'
      }`}>
        <p>© 2026 Analyzer</p>
        <div className="flex gap-6">
          <a href="#" className={`transition-colors ${theme === 'dark' ? 'hover:text-white' : 'hover:text-neutral-900'}`}>Privacy</a>
          <a href="#" className={`transition-colors ${theme === 'dark' ? 'hover:text-white' : 'hover:text-neutral-900'}`}>Terms</a>
        </div>
      </footer>
    </div>
  );
}
