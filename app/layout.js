"use client";

import "./globals.css";
import {
  TonConnectButton,
  TonConnectUIProvider,
} from "@tonconnect/ui-react";
import { usePathname } from "next/navigation";

const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://apex-miner-rho.vercel.app";

const tonConnectManifestUrl =
  `${appUrl.replace(/\/$/, "")}/tonconnect-manifest.json`;

function TonWalletButton() {
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-[9px] font-black text-[#0098EA] uppercase tracking-wider pr-1">
        TON Wallet
      </span>

      <div className="origin-top-right scale-[0.85]">
        <TonConnectButton />
      </div>
    </div>
  );
}

export default function RootLayout({ children }) {
  const pathname = usePathname();

  return (
    <html lang="en">
      <head>
        <script
          src="https://telegram.org/js/telegram-web-app.js"
          async
        ></script>
      </head>

      <body className="relative">
        <TonConnectUIProvider
          manifestUrl={tonConnectManifestUrl}
        >
          {pathname === "/" && (
            <div className="absolute top-[70px] right-4 z-[70]">
              <TonWalletButton />
            </div>
          )}

          {children}
        </TonConnectUIProvider>
      </body>
    </html>
  );
}
