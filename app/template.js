"use client";

/**
 * APEX NETWORK — install-to-home-screen entry point.
 * GitHub path: app/template.js
 * Branch: cloudflare-migration
 *
 * This is a Next.js App Router file convention: a root template wraps app/page.js
 * automatically. No edits to app/page.js or app/layout.js are required.
 *
 * It does NOT replace Telegram login, create an APK, or change mining rewards.
 * Android Chrome / iOS Safari can add the install-help page to the home screen.
 * Where a native PWA prompt is available, this page uses it.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

const BOT_URL = "https://t.me/ApxMinerBot";
const ICON_URL = "/logo2.png";
const HOST_ID = "apxn-home-install-button-host";

const actionStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 44,
  padding: "11px 18px",
  background: "linear-gradient(135deg,#2869f3,#6c31cf)",
  border: "1px solid rgba(173,198,255,.48)",
  borderRadius: 13,
  color: "#fff",
  fontWeight: 800,
  fontSize: 14,
  textAlign: "center",
  cursor: "pointer",
  textDecoration: "none",
};

function installPageUrl() {
  // Do not copy Telegram's private query parameters to an external browser.
  return `${window.location.origin}/?apxn_install=1`;
}

function addLinkIfAbsent(rel, href) {
  if (document.querySelector(`link[rel="${rel}"][href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = rel;
  link.href = href;
  link.setAttribute("data-apxn-install", "true");
  document.head.appendChild(link);
}

function openExternalInstallPage() {
  const url = installPageUrl();
  const telegram = window.Telegram?.WebApp;
  if (telegram?.openLink) {
    try {
      telegram.openLink(url, { try_instant_view: false });
      return;
    } catch (error) {
      console.warn("APXN: Telegram could not open external browser", error);
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function InstallGuide() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [helpVisible, setHelpVisible] = useState(true);
  const [copied, setCopied] = useState(false);
  const [platform, setPlatform] = useState("android");

  useEffect(() => {
    const ua = window.navigator.userAgent || "";
    setPlatform(/iPhone|iPad|iPod/i.test(ua) ? "ios" : "android");
    document.title = "Install APXN — Apex Network";

    const onBeforeInstall = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // Home-screen launching should take the miner back to Telegram, where
    // authentication and point balances already work.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone === true;
    if (standalone) {
      window.location.replace(BOT_URL);
    }

    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  async function handleInstall() {
    if (installPrompt) {
      try {
        await installPrompt.prompt();
        await installPrompt.userChoice;
        setInstallPrompt(null);
        return;
      } catch (error) {
        console.warn("APXN install prompt unavailable", error);
      }
    }
    setHelpVisible(true);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(installPageUrl());
      setCopied(true);
    } catch {
      window.prompt("Copy this link and open it in Chrome or Safari", installPageUrl());
    }
  }

  const panelStyle = {
    width: "100%",
    maxWidth: 440,
    background: "#121c36",
    border: "1px solid rgba(117,155,245,.3)",
    boxShadow: "0 16px 45px rgba(0,0,0,.25)",
    padding: 20,
    borderRadius: 20,
  };

  return (
    <main
      data-apxn-install-page="true"
      style={{
        minHeight: "100dvh",
        padding: "36px 18px",
        background: "radial-gradient(circle at 50% 0%,#263c7c 0%,#0a1026 65%)",
        color: "white",
        fontFamily: "Arial,Helvetica,sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 18,
        boxSizing: "border-box",
      }}
    >
      <img
        src={ICON_URL}
        alt="APXN logo"
        width="92"
        height="92"
        style={{ borderRadius: 23, boxShadow: "0 0 27px rgba(115,96,255,.4)", objectFit: "cover" }}
      />
      <h1 style={{ margin: 0, textAlign: "center", fontSize: 26, fontWeight: 900 }}>
        Install APXN on your phone
      </h1>
      <p style={{ margin: 0, maxWidth: 420, textAlign: "center", color: "#cbd6f9", lineHeight: 1.6 }}>
        Add the APXN icon to your phone's home screen. Your account and mining stay inside Telegram.
      </p>
      <section style={{ ...panelStyle, display: "grid", gap: 12 }}>
        <button type="button" onClick={handleInstall} style={{ ...actionStyle, width: "100%" }}>
          📲 Install APXN / Add to Home Screen
        </button>
        {helpVisible && (
          <div style={{ color: "#d8e4ff", fontSize: 14, lineHeight: 1.7 }}>
            {platform === "ios" ? (
              <>
                <strong>iPhone (Safari):</strong>
                <p style={{ margin: "8px 0" }}>1. Open this page in Safari.</p>
                <p style={{ margin: "8px 0" }}>2. Tap Share, then Add to Home Screen.</p>
                <p style={{ margin: "8px 0" }}>3. Tap Add.</p>
              </>
            ) : (
              <>
                <strong>Android (Chrome):</strong>
                <p style={{ margin: "8px 0" }}>1. Open this page in Chrome (not Telegram's built-in browser).</p>
                <p style={{ margin: "8px 0" }}>2. Tap ⋮ and select Add to Home screen or Install app.</p>
                <p style={{ margin: "8px 0" }}>3. Confirm Add / Install.</p>
              </>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={copyLink}
          style={{ ...actionStyle, background: "#202e53", width: "100%" }}
        >
          {copied ? "✓ Link copied" : "Copy installation page link"}
        </button>
      </section>
      <section style={{ ...panelStyle, display: "grid", gap: 10 }}>
        <strong style={{ fontSize: 17 }}>⛏️ Start mining APXN</strong>
        <p style={{ color: "#cbd6f9", margin: 0, lineHeight: 1.5, fontSize: 14 }}>
          APXN mining uses your Telegram account. Use the button below to open the real Mini App.
        </p>
        <a href={BOT_URL} style={{ ...actionStyle, width: "100%" }}>
          Open APXN Mining in Telegram
        </a>
      </section>
    </main>
  );
}

export default function APXNInstallTemplate({ children }) {
  const [isGuide, setIsGuide] = useState(false);
  const [ready, setReady] = useState(false);
  const [host, setHost] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setIsGuide(query.get("apxn_install") === "1");
    setReady(true);
    addLinkIfAbsent("icon", ICON_URL);
    addLinkIfAbsent("apple-touch-icon", ICON_URL);
  }, []);

  useEffect(() => {
    if (!ready || isGuide) return;
    let anchor = null;

    function placeButton() {
      const old = document.getElementById(HOST_ID);
      if (old && old.isConnected) {
        if (anchor !== old) {
          anchor = old;
          setHost(old);
        }
        return;
      }
      // The top bar is rendered by the existing app/page.js. Insert a sibling
      // portal host; React keeps ownership of the actual APXN button.
      const top20 = Array.from(document.querySelectorAll("button")).find(
        (button) => /TOP\s*20/i.test(button.textContent || "") &&
          !button.closest("[data-apxn-install-root]")
      );
      if (!top20?.parentElement) return;

      anchor = document.createElement("span");
      anchor.id = HOST_ID;
      anchor.style.display = "inline-flex";
      anchor.style.alignItems = "center";
      anchor.style.flexShrink = "0";
      anchor.style.marginLeft = "auto";
      anchor.style.marginRight = "5px";
      top20.parentElement.insertBefore(anchor, top20);
      setHost(anchor);
    }

    placeButton();
    const observer = new MutationObserver(placeButton);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      // Leave React to clean up its portal subtree before removing the host.
      if (anchor?.isConnected) anchor.remove();
    };
  }, [ready, isGuide]);

  useEffect(() => {
    if (!modalOpen) return;
    const onEscape = (event) => {
      if (event.key === "Escape") setModalOpen(false);
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [modalOpen]);

  const copyInstallLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(installPageUrl());
      setCopied(true);
    } catch {
      window.prompt("Copy the link and open in Chrome", installPageUrl());
    }
  }, []);

  if (ready && isGuide) return <InstallGuide />;

  return (
    <>
      {children}
      {host && createPortal(
        <button
          type="button"
          title="Install APXN on your phone"
          aria-label="Install APXN on your phone"
          onClick={() => setModalOpen(true)}
          style={{
            width: 35,
            height: 38,
            background: "linear-gradient(135deg,#315af1,#6d2ed4)",
            border: "1px solid #8495ff",
            borderRadius: 10,
            boxShadow: "0 0 14px rgba(98,76,227,.35)",
            color: "white",
            fontSize: 19,
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          📲
        </button>, host
      )}
      {host && modalOpen && createPortal(
        <div
          data-apxn-install-root="true"
          role="presentation"
          onClick={() => setModalOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 2147483640,
            background: "rgba(0,0,0,.80)", display: "flex",
            alignItems: "center", justifyContent: "center", padding: 18,
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Install Apex Network"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "100%", maxWidth: 390, padding: 22,
              borderRadius: 20, border: "1px solid #5357a2",
              background: "linear-gradient(145deg,#16244e,#0b112a)",
              color: "white", textAlign: "center", display: "grid", gap: 14,
            }}
          >
            <img src={ICON_URL} width="75" height="75" alt="APXN logo"
              style={{ margin: "0 auto", borderRadius: 18 }} />
            <strong style={{ fontSize: 21 }}>Install APXN on your phone</strong>
            <p style={{ color: "#d5dcfa", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
              Create an APXN home-screen icon on your phone. Mining will still open through Telegram.
            </p>
            <button type="button" style={actionStyle} onClick={openExternalInstallPage}>
              📲 Open installation page
            </button>
            <button type="button" style={{ ...actionStyle, background: "#263457" }}
              onClick={copyInstallLink}>
              {copied ? "✓ Link copied" : "Copy link for Chrome / Safari"}
            </button>
            <button type="button" onClick={() => setModalOpen(false)}
              style={{ background: "transparent", border: 0, padding: 10, color: "#d9e3ff", cursor: "pointer" }}>
              Close
            </button>
          </section>
        </div>, document.body
      )}
    </>
  );
}

