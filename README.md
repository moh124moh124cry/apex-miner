# Apex Network ⛏️💎

A Web3 Telegram Mini App that allows users to mine `$APXN` points daily, complete social tasks, and invite friends to build a strong community in preparation for a token listing on CEX/DEX platforms (such as Gate.io).

## 🌟 Core Features

* **Cloud Mining:** A dynamic `$APXN` token mining system that operates programmatically based on each user's specific mining rate.
* **Daily & Social Tasks:** Dynamic daily tasks fetched from the database (Supabase) with time-validation controls to prevent manipulation, along with one-time social tasks (e.g., joining channels, following on X).
* **Viral Referral System:** Massive welcome bonuses for early pioneers (+10,000 points), a 5% mining speed boost for each *active* friend, and a country flag indicator feature to detect fake accounts/bots (Anti-Bot).
* **Web3 Wallet Connection:** Support for connecting Binance Smart Chain (BEP-20) wallets like MetaMask, Trust Wallet, Binance Web3, and OKX Web3 (manually and automatically).
* **Daily Check-in:** A cumulative daily login reward system; resets the streak to zero if the user misses a day.

## 🛠️ Tech Stack

* **Framework:** Next.js (App Router)
* **Database & Backend:** Supabase (PostgreSQL)
* **Styling:** Tailwind CSS
* **Environment:** Telegram WebApp API

## 📂 Project Structure

| Folder / File | Description |
|---|---|
| `app/` | Contains the application pages (App Router); includes the main interface `page.js`, layout `layout.js`, global styles `globals.css`, and backend API routes `api/`. |
| `lib/` | Contains configuration and connection files, specifically `supabase.js` for database connection and query management. |
| `public/` | Stores static assets and images like the project logo `logo2.png`, Binance logo `binance-logo-1.png`, and `tonconnect-manifest.json`. |
| `package.json` | Contains project dependencies, libraries, and runtime scripts. |
| `tailwind.config.js` | Configuration and customization for the app's Tailwind CSS theme and styles. |

## 🚀 Getting Started

**1. Install dependencies:**
```bash
npm install
