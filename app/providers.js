"use client";
import { TonConnectUIProvider } from '@tonconnect/ui-react';

export function Providers({ children }) {
  return (
    <TonConnectUIProvider manifestUrl="https://apex-miner-rho.vercel.app/tonconnect-manifest.json">
      {children}
    </TonConnectUIProvider>
  );
}
