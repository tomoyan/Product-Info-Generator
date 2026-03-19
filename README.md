# Product Info Extractor & JPY Pricing Tool

A sophisticated, AI-powered web application designed to streamline the process of extracting product information from international websites and calculating localized retail prices for the Japanese market.

## 🚀 Overview

This tool leverages the **Gemini 3 Flash** model to analyze product pages or search terms, extracting key specifications and translating them into professional Japanese. It automatically handles currency conversion with real-time market data and applies a specialized pricing formula tailored for import retail.

## ✨ Key Features

### 1. Intelligent Data Extraction
- **URL Analysis:** Paste any product URL, and the AI uses `urlContext` to "read" the page and extract details.
- **Search Integration:** Enter a product name, and the AI uses `googleSearch` to find the most relevant information.
- **Multilingual Output:** Automatically generates both English and Japanese product names and descriptions.

### 2. Advanced Pricing Engine
- **Real-time Exchange Rates:** Fetches the current USD/JPY market rate via AI-driven search.
- **Smart Caching:** Exchange rates are cached locally for **12 hours** to ensure high performance and reduce API overhead.
- **Custom Retail Formula:** Applies a comprehensive calculation:
  - `(((USD × 1.1) × (Exchange Rate + 10)) + 7,000) × 1.1 × 1.05`
  - **Formula Breakdown:**
    - **Import Tax:** 10% (applied to USD price)
    - **Exchange Spread:** ¥10 (added to market rate)
    - **International Shipping:** ¥7,000 (flat rate)
    - **Profit Markup:** 10%
    - **Handling Fee:** 5%
  - **Rounding:** The final price is rounded down to the nearest 10 (e.g., ¥12,345 → ¥12,340) for standard Japanese market pricing.
- **Dynamic Adjustments:** Apply instant discounts (10%/20% OFF) or markups (10%/20% UP) to see adjusted JPY totals.
- **Manual Overrides:** Fine-tune the extracted USD price to see immediate recalculations.

### 3. Productivity Tools
- **One-Tap Copy:** Every extracted field (ID, Material, Dimensions, Color, Summary, Prices) has a dedicated copy-to-clipboard button.
- **Progress Tracking:** A real-time progress bar with status messages keeps you informed during the multi-stage AI analysis.
- **Quick Price Check:** Simply enter a numeric USD value for an instant conversion without full product analysis.

## 🛠 How It Works

1.  **Input Phase:** The user provides a URL or product name.
2.  **Rate Verification:** The app checks `localStorage` for a valid USD/JPY rate. If expired or missing, it triggers a lightweight AI call to fetch the latest market rate.
3.  **AI Analysis:** 
    - If a URL is provided, the model uses the `urlContext` tool to parse the specific page.
    - If text is provided, the model uses `googleSearch` to find product details.
4.  **Data Structuring:** The AI returns a strictly formatted JSON object containing all product specifications.
5.  **Localization:** The app calculates the final JPY retail price using the internal formula and rounds the result for Japanese market standards (rounding down the last digit).

## 🚀 Getting Started

To run this application locally, follow these steps:

### 1. Prerequisites
- **Node.js:** Ensure you have Node.js installed (v18 or higher recommended).
- **Gemini API Key:** You will need a valid Gemini API key. You can get one from the [Google AI Studio](https://aistudio.google.com/).

### 2. Installation
Clone the repository and install the dependencies:
```bash
# Clone the repository (or download the source)
# cd into the project directory
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root of your project and add your Gemini API key:
```env
GEMINI_API_KEY=your_api_key_here
```

### 4. Run the Development Server
Start the Vite development server:
```bash
npm run dev
```
The application will be available at `http://localhost:3000`.

### 5. Build for Production
To create a production-ready build:
```bash
npm run build
```
The output will be in the `dist/` directory.

## 🎨 UI/UX Design

The application follows a **Modern Technical / Minimalist** aesthetic, prioritizing clarity and efficiency.

-   **Glassmorphism:** The header uses a subtle blurred transparency effect (`glass-panel`) for a premium, layered feel.
-   **Compact Card System:** Information is organized into clean, bordered cards with consistent spacing, making dense data easy to scan.
-   **Typography:** Uses a bold, uppercase tracking style for labels to evoke a "professional tool" or "dashboard" vibe.
-   **Interactive Feedback:** 
    - Smooth animations using `motion/react` for entry/exit of results.
    - Visual "Copied" states with green highlights to confirm user actions.
    - Color-coded pricing (Indigo for discounts, Rose for markups) to provide instant visual context.
-   **Mobile-First Layout:** The interface seamlessly transitions from a side-by-side view on desktop to a focused vertical stack on mobile devices.
-   **Iconography:** Utilizes `lucide-react` for crisp, recognizable visual cues for every data type.

## 📦 Tech Stack

-   **Frontend:** React (TypeScript)
-   **Styling:** Tailwind CSS
-   **Animations:** Motion (formerly Framer Motion)
-   **AI Integration:** @google/genai (Gemini 3 Flash Preview)
-   **Icons:** Lucide React
