"use client";

import "./globals.css";
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
      </body>
    </html>
  );
}
