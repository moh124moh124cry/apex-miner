"use client";

/**
 * APXN — native Telegram home-screen shortcut.
 * GitHub path: app/template.js
 * Branch: cloudflare-migration
 *
 * Replaces the old Chrome/PWA workaround with Telegram WebApp's official
 * addToHomeScreen() API (Bot API 8.0+). The shortcut launches the Mini App
 * in Telegram, preserving Telegram authentication for mining.
 *
 * This App Router template wraps the existing page automatically.
 * It does NOT edit app/page.js, app/layout.js, mining, balances, or Supabase.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const HOST_ID = "apxn-native-install-button-host";
const LOGO = "/logo2.png";
const TELEGRAM_MINI_APP = "https://t.me/ApxMinerBot?startapp";

const mainButton = {
  width: "100%",
  minHeight: 46,
  padding: "11px 14px",
  color: "#fff",
  fontSize: 14,
  fontWeight: 800,
  border: "1px solid rgba(156,168,255,.55)",
  borderRadius: 13,
  background: "linear-gradient(135deg,#2668f1,#7134d5)",
  cursor: "pointer",
};

function OldBrowserShortcutHelp() {
  return (
    <main style={{
      minHeight: "100dvh", padding: "36px 20px", boxSizing: "border-box",
      background: "linear-gradient(160deg,#172451,#090e23)", color: "white",
      fontFamily: "Arial,sans-serif", textAlign: "center", display: "flex",
      flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 20,
    }}>
      <img src={LOGO} width={92} height={92} alt="APXN" style={{ borderRadius: 23 }} />
      <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>Open APXN in Telegram</h1>
      <p style={{ maxWidth: 380, lineHeight: 1.6, color: "#dbe5ff" }}>
        This is an old Chrome shortcut. Remove it from your phone's home screen.
        To create the correct APXN icon, open the mining Mini App in Telegram
        and tap the new phone icon beside TOP 20.
      </p>
      <a href={TELEGRAM_MINI_APP} style={{ ...mainButton, maxWidth: 350, textDecoration: "none", display: "block" }}>
        ⛏️ Open APXN Mining in Telegram
      </a>
    </main>
  );
}

export default function APXNHomeScreenTemplate({ children }) {
  const [oldShortcut, setOldShortcut] = useState(false);
  const [ready, setReady] = useState(false);
  const [host, setHost] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [homeStatus, setHomeStatus] = useState("unknown");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOldShortcut(params.get("apxn_install") === "1");
    setReady(true);
  }, []);

  // Subscribe to Telegram's real home-screen status notifications.
  useEffect(() => {
    if (!ready || oldShortcut) return;
    const tg = window.Telegram?.WebApp;
    if (!tg?.onEvent) return;

    const onAdded = () => {
      setHomeStatus("added");
      setStatus("✅ APXN has been added to your home screen. Look for its icon!");
    };
    const onFailed = () => setStatus(
      "Telegram could not create the shortcut on this device. Update Telegram and try again."
    );
    const onChecked = (event) => {
      if (event?.status) setHomeStatus(event.status);
    };

    tg.onEvent("homeScreenAdded", onAdded);
    tg.onEvent("homeScreenFailed", onFailed);
    tg.onEvent("homeScreenChecked", onChecked);

    return () => {
      tg.offEvent?.("homeScreenAdded", onAdded);
      tg.offEvent?.("homeScreenFailed", onFailed);
      tg.offEvent?.("homeScreenChecked", onChecked);
    };
  }, [ready, oldShortcut]);

  // Put the icon beside TOP 20 without modifying the 5,000+ line page.js.
  useEffect(() => {
    if (!ready || oldShortcut) return;
    let active = true;
    let anchor = null;

    function placeInstallIcon() {
      if (!active) return;
      const existing = document.getElementById(HOST_ID);
      if (existing?.isConnected) {
        if (anchor !== existing) {
          anchor = existing;
          setHost(existing);
        }
        return;
      }
      const top20 = Array.from(document.querySelectorAll("button")).find(
        (button) => /TOP\s*20/i.test(button.textContent || "") &&
          !button.closest("[data-apxn-install-modal]")
      );
      if (!top20?.parentElement) return;

      const newHost = document.createElement("span");
      newHost.id = HOST_ID;
      newHost.style.cssText = "display:inline-flex;align-items:center;flex-shrink:0;margin-left:auto;margin-right:5px";
      top20.parentElement.insertBefore(newHost, top20);
      anchor = newHost;
      setHost(newHost);
    }

    placeInstallIcon();
    const observer = new MutationObserver(placeInstallIcon);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      active = false;
      observer.disconnect();
      setHost(null);
      if (anchor?.isConnected) anchor.remove();
    };
  }, [ready, oldShortcut]);

  useEffect(() => {
    if (!modalOpen) return;
    setStatus("");
    const tg = window.Telegram?.WebApp;
    if (typeof tg?.checkHomeScreenStatus === "function" &&
        typeof tg?.isVersionAtLeast === "function" &&
        tg.isVersionAtLeast("8.0")) {
      try {
        tg.checkHomeScreenStatus((result) => {
          if (result) setHomeStatus(result);
        });
      } catch (_) {
        setHomeStatus("unknown");
      }
    }
    function onEscape(event) {
      if (event.key === "Escape") setModalOpen(false);
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [modalOpen]);

  function handleAddToHomeScreen() {
    const tg = window.Telegram?.WebApp;
    const supported = typeof tg?.addToHomeScreen === "function" &&
      (typeof tg.isVersionAtLeast !== "function" || tg.isVersionAtLeast("8.0"));

    if (!supported) {
      setStatus(
        "This feature requires a recent Telegram app (Bot API 8.0+). Update Telegram, open APXN inside Telegram, and try again."
      );
      return;
    }

    try {
      // MUST be called directly from a user click. No Chrome or PWA needed.
      tg.addToHomeScreen();
      setStatus("Follow Telegram's confirmation. The APXN shortcut will open the Mini App in Telegram.");
    } catch (error) {
      console.error("APXN native home-screen shortcut failed:", error);
      setStatus("Telegram couldn't start the home-screen flow. Update Telegram and try again.");
    }
  }

  if (ready && oldShortcut) return <OldBrowserShortcutHelp />;

  return (
    <>
      {children}
      {host && createPortal(
        <button
          type="button"
          aria-label="Add APXN Mini App to phone home screen"
          title="Add APXN to Home Screen"
          onClick={() => setModalOpen(true)}
          style={{
            width: 35, height: 38, borderRadius: 10,
            background: "linear-gradient(135deg,#2b63f1,#722bd9)",
            border: "1px solid #8899ff", color: "white",
            boxShadow: "0 0 14px rgba(92,75,229,.35)",
            fontSize: 19, lineHeight: 1, cursor: "pointer",
          }}
        >
          📲
        </button>, host
      )}
      {host && modalOpen && createPortal(
        <div
          data-apxn-install-modal="true"
          role="presentation"
          onClick={() => setModalOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 2147483640,
            background: "rgba(0,0,0,.82)", display: "flex",
            justifyContent: "center", alignItems: "center", padding: 18,
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Add APXN to Home Screen"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "100%", maxWidth: 390, boxSizing: "border-box", padding: 22,
              borderRadius: 20, border: "1px solid #5963a5",
              background: "linear-gradient(145deg,#172553,#0b1129)",
              color: "white", textAlign: "center",
              display: "grid", gap: 14, fontFamily: "Arial,sans-serif",
            }}
          >
            <img src={LOGO} width={76} height={76} alt="APXN" style={{ margin: "0 auto", borderRadius: 18 }} />
            <strong style={{ fontSize: 21 }}>APXN on Your Home Screen</strong>
            <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0, color: "#d6dffc" }}>
              Tap the button below to add a direct APXN Mini App icon to your phone.
              The icon opens APXN through Telegram, where your existing account and mining work.
            </p>
            <button type="button" onClick={handleAddToHomeScreen} style={mainButton}>
              {homeStatus === "added" ? "✓ APXN is already on your phone" : "📲 Add APXN to Home Screen"}
            </button>
            {status && (
              <p role="status" style={{ fontSize: 13, lineHeight: 1.6, color: "#f6e2a6", margin: 0 }}>
                {status}
              </p>
            )}
            <button type="button" onClick={() => setModalOpen(false)}
              style={{ background: "transparent", padding: 10, color: "#d4dfff", border: 0, cursor: "pointer" }}>
              Close
            </button>
          </section>
        </div>, document.body
      )}
    </>
  );
}

