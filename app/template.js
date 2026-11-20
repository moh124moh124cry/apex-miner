"use client";

/**
 * APEX NETWORK (APXN) — Home-screen shortcut + daily article task.
 * GITHUB PATH: app/template.js
 * BRANCH: cloudflare-migration
 *
 * This complete replacement PRESERVES the original Telegram native home-screen
 * button beside TOP 20, and adds the independent Article task beside the
 * existing YouTube daily task without modifying the large app/page.js file.
 *
 * REQUIRED SERVER SETUP (already completed separately):
 *   POST /api/tasks/article/route.js
 *   Supabase RPC apex_claim_article_task + users.article_last_claim_date
 *   Cloudflare variable DAILY_APXN_ARTICLE_URL
 *
 * Once per UTC day, APXN grants 50 POINTS only when the server confirms the
 * claim. Opening an article is not proof of reading it. The 3-step UI uses
 * GO -> CONFIRM -> CONFIRM AGAIN, as with existing social tasks.
 *
 * IMPORTANT: Paste this complete source in GitHub as app/template.js.
 * Do NOT name the GitHub file .txt and do NOT edit app/page.js.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const HOME_HOST_ID = "apxn-native-install-button-host";
const ARTICLE_HOST_ID = "apxn-daily-article-task-host";
const LOGO = "/logo2.png";
const TELEGRAM_MINI_APP = "https://t.me/ApxMinerBot?startapp";
const ARTICLE_ENDPOINT = "/api/tasks/article";

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

// Validate even though the server already restricts links to apxn.network.
// This prevents accidental opening of unexpected URLs from malformed data.
function isOfficialArticleUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      (parsed.hostname === "apxn.network" || parsed.hostname === "www.apxn.network") &&
      !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function DailyArticleTask() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [done, setDone] = useState(false);
  const [stage, setStage] = useState(0);
  const [notice, setNotice] = useState("");
  const [balance, setBalance] = useState(null);
  const [today, setToday] = useState("");
  const claimLock = useRef(false);
  const previousDay = useRef("");
  const previousUrl = useRef("");

  const loadArticleStatus = useCallback(async (signal) => {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) {
      setLoading(false);
      setNotice("Open APXN inside Telegram to use this task.");
      return;
    }

    try {
      const response = await fetch(ARTICLE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, action: "status" }),
        cache: "no-store",
        signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Article task unavailable");
      if (signal?.aborted) return;
      const validUrl = isOfficialArticleUrl(data.articleUrl) ? data.articleUrl : "";
      setUrl(validUrl);
      setDone(Boolean(data.articleDone));
      setToday(data.today || "");
      // Do not reset GO -> CONFIRM when returning from the article.
      // Reset only on a new UTC day, a changed article, or a completed claim.
      if ((previousDay.current && previousDay.current !== data.today) ||
          (previousUrl.current && previousUrl.current !== validUrl) ||
          data.articleDone) {
        setStage(0);
      }
      previousDay.current = data.today || "";
      previousUrl.current = validUrl;
      setNotice(validUrl ? "" : "New article coming soon");
    } catch (error) {
      if (signal?.aborted) return;
      setUrl("");
      setNotice(error.message || "Unable to load the article task");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadArticleStatus(controller.signal);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !claimLock.current) {
        void loadArticleStatus(controller.signal);
      }
    };
    // After opening a link in the external browser, refresh the status when
    // users return. This also catches changes made in Cloudflare.
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadArticleStatus]);

  // Long-running Mini Apps should reset their daily status at UTC midnight.
  useEffect(() => {
    if (!today) return;
    const timer = window.setInterval(() => {
      const utcToday = new Date().toISOString().slice(0, 10);
      if (utcToday !== today && !claimLock.current) void loadArticleStatus();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [today, loadArticleStatus]);

  function openArticle() {
    if (!isOfficialArticleUrl(url)) {
      setNotice("New article coming soon");
      return;
    }
    try {
      const tg = window.Telegram?.WebApp;
      if (typeof tg?.openLink === "function") {
        tg.openLink(url, { try_instant_view: false });
      } else {
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (!opened) {
          setNotice("Please enable opening links, then try again.");
          return;
        }
      }
      setStage(1);
      setNotice("After visiting the article, return to APXN and confirm.");
    } catch (error) {
      console.error("APXN article opening failed:", error);
      setNotice("Could not open the article. Please try again.");
    }
  }

  async function claimArticle() {
    if (claimLock.current || busy || done) return;
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) {
      setNotice("Please open APXN inside Telegram.");
      return;
    }
    claimLock.current = true;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(ARTICLE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, action: "claim" }),
        cache: "no-store",
      });
      const data = await response.json();
      if (response.status === 409 && data.completed) {
        setDone(true);
        setStage(0);
        if (Number.isFinite(Number(data.balance))) setBalance(Number(data.balance));
        setNotice("Today's 50 APXN Points were already claimed.");
        return;
      }
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to claim article points");
      }
      setDone(true);
      setStage(0);
      if (Number.isFinite(Number(data.balance))) setBalance(Number(data.balance));
      setNotice("✅ 50 APXN Points added to your balance! Refresh the app to update the main balance display.");
    } catch (error) {
      setNotice(error.message || "Please try again.");
    } finally {
      claimLock.current = false;
      setBusy(false);
    }
  }

  function handleTaskClick() {
    if (loading || busy || done || !url) return;
    if (stage === 0) {
      openArticle();
    } else if (stage === 1) {
      setStage(2);
      setNotice("Confirm again to claim your 50 APXN Points.");
    } else {
      void claimArticle();
    }
  }

  const inactive = loading || busy || done || !url;
  const label = done ? "Done ✓" : loading || busy ? "Wait..." : !url ? "SOON" :
    stage === 0 ? "GO" : stage === 1 ? "CONFIRM" : "CONFIRM AGAIN";

  return (
    <div data-apxn-article-task="true" className="bg-slate-900/80 border border-cyan-500/30 rounded-2xl p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-bold text-white text-lg flex items-center gap-2">
          <span aria-hidden="true" className="text-2xl">📰</span>
          Visit Today's APXN Article
        </h3>
        <p className="text-yellow-400 text-xs">+50 APXN Points</p>
        {notice && (
          <p role="status" className="text-cyan-200 text-[11px] mt-2 leading-4">
            {notice}
          </p>
        )}
        {balance !== null && (
          <p className="text-slate-400 text-[10px] mt-1">
            Saved APXN Points balance: {balance.toLocaleString("en-US", { maximumFractionDigits: 4 })}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={handleTaskClick}
        disabled={inactive}
        className={`${done ? "bg-green-600" : inactive ? "bg-slate-700" : "bg-cyan-600"} px-3 py-2 rounded-xl text-white text-sm font-bold active:scale-95 transition-colors min-w-[90px] shrink-0`}
      >
        {label}
      </button>
    </div>
  );
}

export default function APXNHomeScreenTemplate({ children }) {
  const [oldShortcut, setOldShortcut] = useState(false);
  const [ready, setReady] = useState(false);
  const [homeHost, setHomeHost] = useState(null);
  const [articleHost, setArticleHost] = useState(null);
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

  // The existing TOP 20 button and YouTube daily task are in app/page.js.
  // Add portal hosts only as needed, without modifying that large file.
  useEffect(() => {
    if (!ready || oldShortcut) return;
    let active = true;
    let homeAnchor = null;
    let articleAnchor = null;
    let observedHome = null;
    let observedArticle = null;

    function placeButtons() {
      if (!active) return;

      // Preserve the original phone button next to TOP 20.
      const oldHome = document.getElementById(HOME_HOST_ID);
      if (oldHome?.isConnected) {
        homeAnchor = oldHome;
        if (observedHome !== oldHome) {
          observedHome = oldHome;
          setHomeHost(oldHome);
        }
      } else {
        const top20 = Array.from(document.querySelectorAll("button")).find(
          (button) => /TOP\s*20/i.test(button.textContent || "") &&
            !button.closest("[data-apxn-install-modal]")
        );
        if (top20?.parentElement) {
          const el = document.createElement("span");
          el.id = HOME_HOST_ID;
          el.style.cssText = "display:inline-flex;align-items:center;flex-shrink:0;margin-left:auto;margin-right:5px";
          top20.parentElement.insertBefore(el, top20);
          homeAnchor = el;
          observedHome = el;
          setHomeHost(el);
        } else if (observedHome !== null) {
          observedHome = null;
          setHomeHost(null);
        }
      }

      // Match the actual existing Daily Tasks heading, not our new card.
      const oldArticle = document.getElementById(ARTICLE_HOST_ID);
      if (oldArticle?.isConnected) {
        articleAnchor = oldArticle;
        if (observedArticle !== oldArticle) {
          observedArticle = oldArticle;
          setArticleHost(oldArticle);
        }
      } else {
        const youtubeHeading = Array.from(document.querySelectorAll("h3")).find(
          (heading) => /Watch Today's YouTube Video/i.test(heading.textContent || "") &&
            !heading.closest("[data-apxn-article-task]")
        );
        const youtubeCard = youtubeHeading?.closest("div.rounded-2xl");
        if (youtubeCard?.parentElement) {
          const el = document.createElement("div");
          el.id = ARTICLE_HOST_ID;
          el.setAttribute("data-apxn-article-host", "true");
          youtubeCard.insertAdjacentElement("afterend", el);
          articleAnchor = el;
          observedArticle = el;
          setArticleHost(el);
        } else if (observedArticle !== null) {
          observedArticle = null;
          setArticleHost(null);
        }
      }
    }

    placeButtons();
    const observer = new MutationObserver(placeButtons);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      active = false;
      observer.disconnect();
      setHomeHost(null);
      setArticleHost(null);
      if (homeAnchor?.isConnected) homeAnchor.remove();
      if (articleAnchor?.isConnected) articleAnchor.remove();
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
      {homeHost && createPortal(
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
        </button>, homeHost
      )}
      {articleHost && createPortal(<DailyArticleTask />, articleHost)}
      {homeHost && modalOpen && createPortal(
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

