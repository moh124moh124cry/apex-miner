"use client";

import "./globals.css";
import Script from "next/script";
import { TonConnectUIProvider } from "@tonconnect/ui-react";

const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://apex-miner-rho.vercel.app";

const tonConnectManifestUrl =
  `${appUrl.replace(/\/$/, "")}/tonconnect-manifest.json`;

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script
          src="https://telegram.org/js/telegram-web-app.js"
          async
        ></script>
      </head>

      <body>
        <TonConnectUIProvider
          manifestUrl={tonConnectManifestUrl}
        >
          {children}
        </TonConnectUIProvider>

        <Script
          id="monetag-sdk"
          src="https://libtl.com/sdk.js"
          data-zone="11803132"
          data-sdk="show_11803132"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}

