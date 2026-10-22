# Analyzer — AI Product Extractor & JPY Pricing Tool (v2.0)

A full-stack, AI-powered web application designed to extract product specifications from international retail URLs or product names, translate them into natural Japanese for e-commerce listings, and calculate localized Japanese Yen (JPY) retail and reference prices using live market exchange rates.

## 🚀 Overview

**Analyzer** streamlines cross-border product listing workflows. Enter a product URL, brand/model name, or raw USD price, and the app automatically:
1. Extracts key product specifications (English & Japanese names, Color, Product ID/SKU, Material, Dimensions, and a 3–4 sentence Japanese summary).
2. Normalizes and rounds up product dimensions into whole centimeters (`約...cm`).
3. Fetches live USD/JPY exchange rates and calculates both the **Retail Price (JPY)** and **Conversion Price (JPY)** with a ready-to-copy Japanese reference price note.

## ✨ Key Features

### 1. Intelligent Product Extraction
- **URL & Metadata Parsing:** Pre-fetches webpage metadata (`<title>`, OpenGraph tags, meta descriptions, and `application/ld+json` structured data) and combines it with Gemini AI analysis (`urlContext` and `googleSearch` fallback) to accurately extract product details even from complex retail sites.
- **Product Name Lookup:** Enter any product brand and model name to extract specifications and current US retail pricing.
- **Quick Price Mode:** Enter a numeric USD value directly (e.g., `250`) to immediately calculate JPY retail and conversion prices without running a full product lookup.
- **Automatic Dimension Formatting:** Converts inch measurements into centimeters (`1 in = 2.54 cm`), rounds up all decimal values to the next whole number, and prefixes measurements with `約` (e.g., `約26cm × 15cm × 8cm`).

### 2. Advanced JPY Pricing Engine
- **Live USD/JPY Market Rates:** Fetches real-time USD to JPY exchange rates via financial market APIs (`open.er-api.com` / `frankfurter.app`) with AI fallback.
- **12-Hour Smart Caching & Manual Refresh:** Exchange rates are cached in `localStorage` for 12 hours for instant load times and can be refreshed on demand via the refresh button.
- **Custom Import Retail Formula:**
  ```text
  (((USD × 1.10) × (Exchange Rate + 10)) + 7,500) × 1.10 × 1.05
  ```
  - **Import Tax:** `10%` (`× 1.10` applied to USD price)
  - **Exchange Spread:** `+ ¥10` added to the market USD/JPY rate
  - **International Shipping:** `¥7,500` flat rate
  - **Profit Markup:** `10%` (`× 1.10`)
  - **Handling Fee:** `5%` (`× 1.05`)
  - **Market Rounding:** Rounds down the final digit to the nearest `¥10` (e.g., `¥12,345` → `¥12,340`).
- **Dynamic Price Adjustments:** Toggle between `20% OFF`, `10% OFF`, `Normal`, `10% UP`, and `20% UP` to preview discounted or marked-up retail prices.
- **Editable USD Price:** Adjust the extracted USD price inline to recalculate all JPY figures in real time.
- **Conversion Price & Reference Note:**
  - Displays the direct **Conversion Price (JPY)** (`USD × Exchange Rate`).
  - Includes a toggleable and one-click copyable Japanese reference note:
    `※上記参考価格は現地参考価格を1$＝{ExchangeRate}円で換算したものです。`

### 3. Productivity & UI/UX
- **One-Click Copy Everywhere:** Click any specification card, title, summary, price, or reference note to copy it directly to your clipboard with instant visual confirmation.
- **Light & Dark Themes:** Switch seamlessly between Light and Dark modes (persisted in `localStorage`) with glassmorphic panels and animated ambient background orbs.
- **Resilient AI Pipeline:** Built-in multi-model fallback (`gemini-3-flash-preview` and `gemini-2.5-flash`) with automatic retry and clear error recovery.

## 🛠 How It Works

1. **Input:** Paste a product URL, enter a product name, or type a USD amount into the search bar and click **Analyze**.
2. **Exchange Rate Check:** The client checks `localStorage` for a cached USD/JPY rate (< 12 hours old) or requests a fresh rate from `GET /api/exchange-rate`.
3. **Server-Side Extraction (`POST /api/analyze`):**
   - If the input is a URL, the Express server pre-fetches HTML metadata and JSON-LD product data, then prompts Gemini to extract structured JSON specifications.
   - Falls back to `urlContext` and `googleSearch` grounding if additional page context is required.
4. **Calculation & Formatting:** The frontend normalizes dimensions into whole centimeters and computes the Retail Price (JPY) and Conversion Price (JPY).

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js:** v18 or higher recommended.
- **Gemini API Key:** Obtain an API key from [Google AI Studio](https://aistudio.google.com/).

### 2. Installation
```bash
npm install
```

### 3. Environment Configuration
Create a `.env` file in the project root:
```env
GEMINI_API_KEY=your_api_key_here
```

### 4. Run the Development Server
Start the full-stack Express + Vite server:
```bash
npm run dev
```
The application will be available at `http://localhost:3000`.

### 5. Build & Run for Production
```bash
npm run build
npm start
```

## 📦 Tech Stack

- **Frontend:** React 19, TypeScript, Vite
- **Backend:** Node.js, Express (`server.ts`)
- **Styling:** Tailwind CSS v4
- **Animations:** Motion (`motion/react`)
- **AI Integration:** `@google/genai` (Gemini 3 Flash Preview & Gemini 2.5 Flash)
- **Icons:** Lucide React
