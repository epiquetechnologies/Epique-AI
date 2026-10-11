'use dom';

import { useState, useRef, useEffect, useMemo, useCallback, memo, Component, Fragment } from "react";
import { createPortal } from "react-dom";
import { setActions, speechEvent, actions, installStorage, inHost } from "./native-bridge";
import { useDOMImperativeHandle } from "expo/dom";
import {
  Send, AudioLines, Plus, Copy, Check, RefreshCw, X, Mic, MicOff,
  ChevronDown, Square, Globe, Brain, MessageSquarePlus, Lightbulb, Compass, Sparkles,
  Sun, Moon, Cloud, CloudSun, CloudMoon, CloudRain, CloudDrizzle, CloudSnow, CloudLightning, CloudFog,
  Droplets, Wind, Thermometer, MapPin, Play, Pause, ExternalLink, Phone, Mail, Download, User,
  KeyRound, Music2, Image as ImageIcon, Navigation, MessageCircle, CalendarDays,
  BookOpen, Coins, Clock, Calculator, Wrench, SkipBack, SkipForward, Map as MapIcon, BarChart3, HelpCircle,
  Timer as TimerIcon, Volume2, Eye, WrapText, Maximize2, AlignLeft, Code, Menu, Search, Pin, MoreHorizontal,
  Pencil, Trash2, Settings2, Plug, Upload, ArrowDown, FileText, PanelLeft, SlidersHorizontal,
  Crown, LayoutGrid, Trophy, Newspaper, ListChecks, StickyNote, Bell, Link2, Vote, Hourglass, Rocket, Flag, UtensilsCrossed,
} from "lucide-react";

/* ── Config ─────────────────────────────────────────────────
   API key: put EXPO_PUBLIC_GEMINI_API_KEY=... in .env (then restart Expo),
   or paste it in the app (Model menu → API key). It is never hard-coded here. */
const NAME = "Epique AI";
let ENV_KEY = "";
try { ENV_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || ""; } catch (e) {}
const KEY_STORE = "epique.key", mem: any = { key: "" };
const getKey = () => {
  if (mem.key) return mem.key;
  try { const k = localStorage.getItem(KEY_STORE); if (k) return k; } catch (e) {}
  return ENV_KEY;
};
const saveKey = (k) => { mem.key = k; try { localStorage.setItem(KEY_STORE, k); } catch (e) {} };

const API = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_ATTEMPTS = 5;
// Each model lists fallbacks that later retry attempts move on to.
const MODELS = [
  { id: "flash", n: "Epique Flash", d: "Fast and capable for everyday work", api: ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-flash-latest"] },
  { id: "lite", n: "Epique Lite", d: "Lightest model, quickest replies", api: ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.1-flash-lite"] },
  { id: "pro", n: "Epique Pro", d: "Deeper reasoning for hard problems", api: ["gemini-3.1-pro-preview", "gemini-pro-latest", "gemini-3.8-flash"] },
];

const nowLine = () => { const n = new Date(), y = new Date(n.getTime() - 864e5), tz = Intl.DateTimeFormat().resolvedOptions().timeZone; return `Today is ${n.toDateString()}, local time ${n.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (${tz}). Yesterday was ${y.toDateString()}. Your training data is out of date for recent events: for news, scores, fixtures, results, prices or anything "latest/current/today/yesterday", call a tool (get_sports, get_news, google_search) before answering and never say you lack live data.`; };
const LIVE = /\b(today|tonight|yesterday|tomorrow|latest|current|currently|live|scores?|results?|fixtures?|matches|news|headlines?|nations league|champions league|premier league|standings|trending|this week|who won|update)\b/i;
const SYSTEM = () => `You are ${NAME}, a sharp, friendly assistant built by Epique Technologies. If asked who made you, say Epique Technologies. ${nowLine()}

STYLE
- Short-spoken but detailed: lead with the answer, then give only the details that matter. Plain, dense sentences. Default to about 120 words or fewer. No filler, no preamble, no restating the question, no closing recap.
- Go longer only when the task truly needs it (step-by-step working, code, deep explanations, plans), and even then stay tight.
- Markdown: **bold** key terms, short lists, tables for comparisons, fenced code with a language tag. No emojis unless the user uses them.
- Maths and science: LaTeX inside $...$ (inline) or $$...$$ (display), e.g. $\\frac{a}{b}$, $M_r$, $\\text{H}_2\\text{O}$, $\\ce{2H2 + O2 -> 2H2O}$. Never write LaTeX outside $ delimiters.

CARDS
When a visual card serves the request better than prose, add it as a fenced block whose language is ui:TYPE, containing one line of valid JSON. Always write a card as three lines: an opening fence with ui:TYPE, the JSON, then a closing fence. Never write ui:TYPE {...} as plain text. Use at most two cards per reply, with a short line of text around them, and don't repeat the card's contents in prose. The app fetches live data itself, so never invent temperatures, tracks or image links.
- ui:weather {"location":"Cape Town, South Africa","units":"c"} for weather, forecasts, "do I need a jacket".
- ui:music {"tracks":[{"title":"...","artist":"..."}]} (up to 6) or {"query":"artist, genre or mood"} or {"query":"Artist name","sort":"oldest|newest"} for an artist's earliest or latest releases for songs, artists, playlists. The app plays 30-second previews.
- ui:images {"query":"Victoria Falls","count":4} when seeing something helps (places, animals, objects, styles). Query: specific, 1 to 4 words, count 1 to 5.
- ui:contact {"name":"","role":"","org":"","phone":"+27...","email":"","website":"","address":""} only with details the user gave or you found by searching. Omit unknown fields, never guess.
- ui:place {"places":[{"name":"","area":"","note":"","tags":["",""]}]} for real, specific places worth visiting or recommending.
- ui:itinerary {"title":"","days":[{"label":"Day 1","items":[{"time":"09:00","title":"","note":""}]}]} for multi-day plans and schedules.
Never put a card inside a list or table.`;
const VOICE = " The user is speaking aloud, so reply in one to three short, natural sentences (under 45 words) with no Markdown, lists, symbols or cards.";

/* ── Gemini ─────────────────────────────────────────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class ApiError extends Error { status: any; constructor(m, status) { super(m); this.status = status; } }

const explain = (e) => {
  const s = e?.status;
  if (s === 401 || s === 403) return getKey() ? "The API key was rejected. Check that it is valid and enabled for the Gemini API." : "Add your Gemini API key to start chatting.";
  if (s === 429) return "Epique is being rate limited right now. Wait a moment and try again.";
  if (s === 404) return "The selected model isn't available for this key.";
  if (s === 400) return `The request was rejected: ${e.message}`;
  if (e?.name === "AbortError") return "The request timed out.";
  if (e instanceof TypeError) return "Couldn't reach Gemini. Check your connection, or whether this page is allowed to call external APIs.";
  return e?.message || "Something went wrong.";
};

/* ── Live tools (free, keyless, CORS-friendly APIs) ─────── */
const cache = new Map();
const once = (k, fn) => { if (!cache.has(k)) cache.set(k, fn().catch((e) => { cache.delete(k); throw e; })); return cache.get(k); };
const getJSON = async (url, ms = 10000) => {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
};
const jsonp = (url) => new Promise((res, rej) => {
  const cb = "ep_" + Math.random().toString(36).slice(2), s = document.createElement("script");
  const end = () => { clearTimeout(t); delete window[cb]; s.remove(); };
  const t = setTimeout(() => { end(); rej(new Error("timeout")); }, 9000);
  window[cb] = (d) => { end(); res(d); };
  s.onerror = () => { end(); rej(new Error("blocked")); };
  s.src = url + "&callback=" + cb; document.head.appendChild(s);
});

// Weather: Open-Meteo
const WMO = {
  0: ["Clear sky", "sun"], 1: ["Mostly clear", "sun"], 2: ["Partly cloudy", "psun"], 3: ["Overcast", "cloud"], 45: ["Fog", "fog"], 48: ["Rime fog", "fog"],
  51: ["Light drizzle", "drz"], 53: ["Drizzle", "drz"], 55: ["Heavy drizzle", "drz"], 56: ["Freezing drizzle", "drz"], 57: ["Freezing drizzle", "drz"],
  61: ["Light rain", "rain"], 63: ["Rain", "rain"], 65: ["Heavy rain", "rain"], 66: ["Freezing rain", "rain"], 67: ["Freezing rain", "rain"],
  71: ["Light snow", "snow"], 73: ["Snow", "snow"], 75: ["Heavy snow", "snow"], 77: ["Snow grains", "snow"],
  80: ["Light showers", "rain"], 81: ["Showers", "rain"], 82: ["Heavy showers", "rain"], 85: ["Snow showers", "snow"], 86: ["Snow showers", "snow"],
  95: ["Thunderstorm", "storm"], 96: ["Thunderstorm, hail", "storm"], 99: ["Thunderstorm, hail", "storm"],
};
const WI = { sun: [Sun, Moon], psun: [CloudSun, CloudMoon], cloud: [Cloud, Cloud], fog: [CloudFog, CloudFog], drz: [CloudDrizzle, CloudDrizzle], rain: [CloudRain, CloudRain], snow: [CloudSnow, CloudSnow], storm: [CloudLightning, CloudLightning] };
const wx = (code, day = 1) => { const [label, k] = WMO[code] || ["Unknown", "cloud"]; return { label, I: WI[k][day ? 0 : 1] }; };

const fetchWeather = (loc, f) => once(`w:${loc}:${f}`, async () => {
  const [name, ...rest] = loc.split(",").map((s) => s.trim());
  const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=8&language=en&format=json`);
  const hint = rest.join(" ").toLowerCase();
  const p = (g.results || []).find((r) => hint && ([r.country, r.admin1].some((x) => x && hint.includes(String(x).toLowerCase())) || (r.country_code || "").toLowerCase() === hint)) || g.results?.[0];
  if (!p) throw new Error(`Couldn't find "${loc}"`);
  const w = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=6&temperature_unit=${f ? "fahrenheit" : "celsius"}&wind_speed_unit=${f ? "mph" : "kmh"}`);
  return { p, w };
});

// Music: iTunes Search (30-second previews)
const fetchTracks = (spec) => once("m:" + JSON.stringify(spec), async () => {
  const q = async (term, limit, attr?) => {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=${limit}${attr ? "&attribute=" + attr : ""}`;
    let d; try { d = await getJSON(url); } catch (e) { d = await jsonp(url); }
    return (d.results || []).filter((r) => r.trackName);
  };
  const rows = Array.isArray(spec.tracks) && spec.tracks.length
    ? (await Promise.all(spec.tracks.slice(0, 6).map((t) => q(`${t.title || ""} ${t.artist || ""}`.trim(), 5).catch(() => [])))).map((a, i) => a.find((x) => (spec.tracks[i].artist ? x.artistName.toLowerCase().includes(String(spec.tracks[i].artist).toLowerCase().split(/[,&]/)[0].trim()) : true)) || a[0]).filter(Boolean)
    : spec.sort
      ? (() => { const nm = String(spec.artist || spec.query || "").toLowerCase(); return q(String(spec.artist || spec.query || ""), 200, "artistTerm").then((a) => { const f = a.filter((x) => x.releaseDate && x.artistName.toLowerCase().includes(nm.split(" ")[0])), sg = new Set(); return f.sort((x, y) => (new Date(x.releaseDate).getTime() - new Date(y.releaseDate).getTime()) * (/new|recent|latest/i.test(spec.sort) ? -1 : 1)).filter((x) => { const k = x.trackName.toLowerCase().replace(/\(.*?\)|\[.*?\]|- .*$/g, "").trim(); return !sg.has(k) && sg.add(k); }).slice(0, 6); }); })()
      : await q(String(spec.query || spec.title || ""), 6);
  const seen = new Set();
  const out = rows.filter((r) => !seen.has(r.trackId) && seen.add(r.trackId)).map((r) => ({
    id: r.trackId, title: r.trackName, artist: r.artistName, album: r.collectionName,
    art: (r.artworkUrl100 || "").replace("100x100", "240x240"), preview: r.previewUrl, url: r.trackViewUrl,
  }));
  if (!out.length) throw new Error("No matching tracks found");
  return out;
});

// Images: Wikimedia Commons
const fetchImages1 = (q, n) => once(`i1:${q}:${n}`, async () => {
  const d = await getJSON(`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=24&gsrsearch=${encodeURIComponent(q + " filetype:bitmap")}&prop=imageinfo&iiprop=url|mime&iiurlwidth=960`, 12000);
  let r = (Object.values(d.query?.pages || {}) as any[]).sort((a, b) => a.index - b.index).map((p) => {
    const i = p.imageinfo?.[0] || {};
    return { t: p.title.replace(/^File:/, "").replace(/\.\w+$/, "").replace(/_+/g, " "), src: i.thumburl, page: i.descriptionurl, mime: i.mime };
  }).filter((x) => x.src && /^image\/(jpeg|png|webp)$/.test(x.mime));
  const clean = r.filter((x) => !/\b(map|logo|flag|coat of arms|diagram|chart|icon|locator|plan|scan|screenshot)\b/i.test(x.t));
  if (clean.length >= n) r = clean;
  if (!r.length) throw new Error(`No photos found for "${q}"`);
  return r.slice(0, n);
});

function useFetch(fn, deps) {
  const [s, set] = useState<any>({ st: "load" }), [n, setN] = useState<any>(0);
  useEffect(() => {
    let off = false; set({ st: "load" });
    fn().then((v) => !off && set({ st: "ok", v }), (e) => !off && set({ st: "err", e }));
    return () => { off = true; };
  }, [...deps, n]); // eslint-disable-line
  return [s, () => setN((x) => x + 1)];
}

/* ── Storage, accounts, settings ────────────────────────── */
const LS = (() => {
  const m = new Map();
  return {
    get(k, d) { try { const v = localStorage.getItem(k); if (v != null) return JSON.parse(v); } catch (e) {} return m.has(k) ? m.get(k) : d; },
    set(k, v) { m.set(k, v); try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
})();
const rid = () => Math.random().toString(36).slice(2, 10);
let ENV_MAPS = ""; try { ENV_MAPS = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || ""; } catch (e) {}
// Demo Google Maps key supplied by the owner. In Google Cloud, restrict it to your site (HTTP referrer http://localhost:5173/*)
// and to the Maps Embed API and Places API (New), so it is useless if this file is ever shared. Override it in Settings or .env.local.
const MAPS_DEFAULT = "AIzaSyB-M-6P4BRFcbCtyJNW_JpZQQW3ZJMufZw";
const getMapsKey = () => { try { return localStorage.getItem("epique.maps") || mem.maps || ENV_MAPS || MAPS_DEFAULT; } catch (e) { return mem.maps || ENV_MAPS || MAPS_DEFAULT; } };
const saveMapsKey = (k) => { mem.maps = k; try { localStorage.setItem("epique.maps", k); } catch (e) {} };

const DEF_CFG = { model: "flash", think: true, search: false, agent: true, voice: "", tts: "Brian", rate: 1, theme: "dark", fs: "m", font: "inter", accent: "", calm: false, mcp: [] };
const COLORS = ["#ffffff", "#ff9ac1", "#9ee6b0", "#8ecbff", "#ffd28a", "#c8b6ff"];
const newProfile = (name = "") => ({ id: rid(), name, color: COLORS[0], about: "", mem: [], pin: "" });
const loadProfiles = () => { let p = LS.get("epique.profiles", null); if (!Array.isArray(p) || !p.length) { p = [newProfile()]; LS.set("epique.profiles", p); } return p; };
const chatKey = (pid) => "epique.chats." + pid;
const sha = async (s) => {
  try { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("epique:" + s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
  catch (e) { return "p:" + s; }
};
// Messages are saved without transient UI state or heavy attachment data.
const slim = (arr) => arr.filter((m) => m.state !== "think").map((m) => {
  const o: any = { id: m.id, role: m.role, text: m.text };
  if (m.role === "user") { if (m.ctx) o.ctx = m.ctx; if (m.att?.length) o.att = m.att.map((a) => ({ k: a.k, name: a.name, th: a.th })); if (m.voice) o.voice = 1; return o; }
  o.state = m.state === "error" ? "error" : "done";
  for (const k of ["err", "keyErr", "th", "sources", "queries"]) if (m[k] != null && m[k] !== "") o[k] = m[k];
  if (m.trace?.length) o.trace = m.trace.map((t) => ({ ...t, state: t.state === "err" ? "err" : "ok" }));
  return o;
});
const titleOf = (msgs) => { const t = (msgs.find((m) => m.role === "user")?.text || "New chat").replace(/\s+/g, " ").trim(); return t.length > 42 ? t.slice(0, 40).trim() + "…" : t; };
const aiTitle = async (u, a) => {
  const key = getKey(); if (!key) return "";
  const ms = MODELS[1].api.slice(0, 2), got = await rep(ms.length, async (i) => { const m = ms[i];
    try {
      const r = await fetch(`${API}/${m}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `Give this chat a title of 2 to 4 words. Reply with the title only, no quotes or punctuation.\n\nUser: ${u.slice(0, 300)}\nAssistant: ${a.slice(0, 300)}` }] }], generationConfig: { maxOutputTokens: 60, temperature: 0.3 } }) });
      if (!r.ok) return;
      const d = await r.json(), t = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").replace(/["'`*#.\n]/g, " ").replace(/\s+/g, " ").trim();
      if (t) return t.slice(0, 40);
    } catch (e) {}
  });
  return got || "";
};
const dayLabel = (ts) => {
  const d = new Date(ts), n = new Date(), s = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), diff = Math.round((s(n) - s(d)) / 864e5);
  return diff <= 0 ? "Today" : diff === 1 ? "Yesterday" : diff < 8 ? "Previous 7 days" : "Earlier";
};
const ago = (ts) => {
  const m = Math.max(0, (Date.now() - ts) / 6e4);
  return m < 1 ? "Just now" : m < 60 ? `${Math.round(m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : m < 10080 ? `${Math.round(m / 1440)}d ago` : new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/* ── MCP client (Streamable HTTP, browser side) ─────────────
   Remote servers must allow CORS for this origin. Tools found are handed to the model. */
const mcpState = new Map();
let mcpId = 0;
async function mcpRpc(srv, method, params, note?) {
  const st = mcpState.get(srv.url) || {}, id = note ? undefined : ++mcpId;
  const headers: any = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (srv.token) headers.Authorization = "Bearer " + srv.token;
  if (st.sid) headers["Mcp-Session-Id"] = st.sid;
  const c = new AbortController(), t = setTimeout(() => c.abort(), 20000);
  try {
    const res = await fetch(srv.url, { method: "POST", headers, signal: c.signal, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
    const sid = res.headers.get("mcp-session-id"); if (sid) st.sid = sid;
    mcpState.set(srv.url, st);
    if (note) return null;
    if (!res.ok) throw new Error(`Server replied ${res.status}`);
    let msg;
    if ((res.headers.get("content-type") || "").includes("event-stream")) {
      for (const ln of (await res.text()).split(/\r?\n/)) if (ln.startsWith("data:")) { try { const j = JSON.parse(ln.slice(5)); if (j.id === id) { msg = j; break; } } catch (e) {} }
    } else msg = await res.json();
    if (!msg) throw new Error("No reply from server");
    if (msg.error) throw new Error(msg.error.message || "MCP error");
    return msg.result;
  } finally { clearTimeout(t); }
}
async function mcpTools(srv) {
  const st = mcpState.get(srv.url);
  if (!st?.ready) {
    await mcpRpc(srv, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "epique", version: "2.0" } });
    await mcpRpc(srv, "notifications/initialized", {}, true).catch(() => {});
    mcpState.get(srv.url).ready = true;
  }
  return (await mcpRpc(srv, "tools/list", {})).tools || [];
}
const mcpCall = async (srv, name, args) => {
  const r = await mcpRpc(srv, "tools/call", { name, arguments: args || {} });
  const txt = (r.content || []).map((c) => c.text || (c.type ? `[${c.type}]` : "")).join("\n").slice(0, 9000);
  return r.isError ? { error: txt || "Tool failed" } : { result: txt };
};
const mcpCache = new Map();
async function mcpAll(list) {
  const out = [];
  await Promise.all((list || []).filter((s) => s.on && s.url).map(async (srv, si) => {
    try {
      let tl = mcpCache.get(srv.url);
      if (!tl) { tl = await Promise.race([mcpTools(srv), sleep(7000).then(() => { throw new Error("timeout"); })]); mcpCache.set(srv.url, tl); }
      tl.forEach((t) => out.push({ srv, tool: t, name: `mcp_${si}_${t.name}`.replace(/[^\w.-]/g, "_").slice(0, 64) }));
    } catch (e) {}
  }));
  return out;
}
// JSON Schema → Gemini function schema
const gSchema = (s) => {
  if (!s || typeof s !== "object") return { type: "STRING" };
  const t = (Array.isArray(s.type) ? s.type.find((x) => x !== "null") : s.type) || (s.properties ? "object" : "string"), o: any = { type: String(t).toUpperCase() };
  if (!["STRING", "NUMBER", "INTEGER", "BOOLEAN", "ARRAY", "OBJECT"].includes(o.type)) o.type = "STRING";
  if (s.description) o.description = String(s.description).slice(0, 400);
  if (s.enum && o.type === "STRING") o.enum = s.enum.map(String);
  if (o.type === "ARRAY") o.items = gSchema(s.items);
  if (o.type === "OBJECT") { o.properties = Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, gSchema(v)])); if (!Object.keys(o.properties).length) delete o.properties; if (s.required?.length) o.required = s.required; }
  return o;
};

/* ── Extra live data (all keyless) ──────────────────────── */
const fetchWiki = (q) => once("wk:" + q, async () => {
  const s = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(q)}&srlimit=1&format=json&origin=*`);
  const t = s.query?.search?.[0]?.title;
  if (!t) throw new Error(`No Wikipedia page for "${q}"`);
  const d = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${enc(t.replace(/ /g, "_"))}`);
  return { title: d.title, desc: d.description || "", text: d.extract || "", thumb: d.thumbnail?.source, url: d.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${enc(t)}` };
});
const fetchDefine = (w0) => once("df2:" + w0.toLowerCase(), async () => {
  const w = String(w0).trim().toLowerCase(), strip = (h) => String(h || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  const stems = [...new Set([w, w.replace(/ies$/, "y"), w.replace(/(es|s)$/, ""), w.replace(/ed$/, ""), w.replace(/ed$/, "e"), w.replace(/ing$/, ""), w.replace(/ing$/, "e"), w.replace(/(.)\1ing$/, "$1")])].filter((x) => x.length > 1);
  let e = null, hit = w;
  await rep(stems.length, async (i) => { const c = stems[i]; try { const d = await getJSON(`https://api.dictionaryapi.dev/v2/entries/en/${enc(c)}`, 8000); if (d?.[0]) { e = d[0]; hit = c; return 1; } } catch (x) {} });
  const dm = (rel) => getJSON(`https://api.datamuse.com/words?${rel}=${enc(hit)}&max=10`, 6000).then((r) => r.map((x) => x.word)).catch(() => []);
  const [syn, ant] = await Promise.all([dm("rel_syn"), dm("rel_ant")]);
  let v = null;
  if (e) {
    const ph = (e.phonetics || []).filter((p) => p.text || p.audio);
    v = { word: e.word, ph: e.phonetic || ph.find((p) => p.text)?.text || "", audio: ph.find((p) => p.audio)?.audio || "", origin: e.origin || "", src: "Free Dictionary",
      means: (e.meanings || []).slice(0, 5).map((m) => ({ pos: m.partOfSpeech, defs: m.definitions.slice(0, 3).map((x) => ({ d: x.definition, e: x.example })), syn: (m.synonyms || []).slice(0, 6) })) };
  } else {
    try {
      const d = await getJSON(`https://en.wiktionary.org/api/rest_v1/page/definition/${enc(w)}`, 9000);
      const means = (d.en || []).slice(0, 5).map((m) => ({ pos: (m.partOfSpeech || "").toLowerCase(), defs: (m.definitions || []).slice(0, 3).map((x) => ({ d: strip(x.definition), e: strip(x.examples?.[0]) })).filter((x) => x.d), syn: [] })).filter((m) => m.defs.length);
      if (means.length) v = { word: w, ph: "", audio: "", origin: "", src: "Wiktionary", means };
    } catch (x) {}
  }
  if (!v) {
    let sg = []; try { sg = (await getJSON(`https://api.datamuse.com/sug?s=${enc(w)}&max=6`, 6000)).map((x) => x.word); } catch (x) {}
    const err: any = new Error(`No definition for "${w0}"${sg.length ? ". Did you mean:" : "."}`); err.sugg = sg; throw err;
  }
  v.syn = [...new Set([...v.means.flatMap((m) => m.syn || []), ...syn])].filter((x) => x !== v.word).slice(0, 10); v.ant = ant.slice(0, 8);
  return v;
});
const fetchRate = (f, t) => once(`fx:${f}:${t}`, async () => {
  f = f.toUpperCase(); t = t.toUpperCase();
  let rate, date = "";
  try { const d = await getJSON(`https://open.er-api.com/v6/latest/${f}`); rate = d.rates?.[t]; date = (d.time_last_update_utc || "").slice(5, 16); } catch (e) {}
  if (!rate) { const d = await getJSON(`https://api.frankfurter.dev/v1/latest?base=${f}&symbols=${t}`); rate = d.rates?.[t]; date = d.date || ""; }
  if (!rate) throw new Error(`No rate for ${f} → ${t}`);
  return { rate, date };
});
const fetchGeo = (q) => once("geo:" + q, async () => {
  const d = await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&q=${enc(q)}`);
  if (!d.length) throw new Error(`Couldn't find "${q}"`);
  return d.map((x) => ({ name: x.display_name, lat: +x.lat, lon: +x.lon, bb: x.boundingbox.map(Number) }));
});
const here = () => new Promise((res, rej) => {
  if (!navigator.geolocation) return rej(new Error("Location isn't available here"));
  navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }), () => rej(new Error("Location permission was denied")), { timeout: 9000, maximumAge: 6e5 });
});
const placeName = (c) => once(`rg:${c.lat.toFixed(2)},${c.lon.toFixed(2)}`, async () => {
  const d = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${c.lat}&longitude=${c.lon}&localityLanguage=en`);
  return { city: d.city || d.locality || d.principalSubdivision || "", country: d.countryName || "" };
});
// Openverse widens image search beyond Wikimedia (objects, products, art, everyday scenes).
const fetchImages2 = (q, n) => once(`i2:${q}:${n}`, async () => {
  const d = await getJSON(`https://api.openverse.org/v1/images/?q=${enc(q)}&page_size=${n + 4}&mature=false`, 12000);
  return (d.results || []).map((x) => ({ t: x.title || q, src: x.thumbnail || x.url, page: x.foreign_landing_url })).filter((x) => x.src).slice(0, n);
});
const calc = (ex) => {
  const names = "sin cos tan asin acos atan sqrt cbrt log log10 log2 exp abs floor ceil round min max pow";
  let s = String(ex).replace(/\^/g, "**").replace(/\bpi\b/gi, "Math.PI").replace(new RegExp(`\\b(${names.split(" ").join("|")})\\b`, "g"), "Math.$1").replace(/\bln\b/g, "Math.log");
  if (!/^[\d\s+\-*/%().,eE]*$/.test(s.replace(/Math\.(?:PI|E|[a-z0-9]+)/g, ""))) throw new Error("Unsupported expression");
  const v = Function('"use strict";return(' + s + ")")();
  if (typeof v !== "number" || !isFinite(v)) throw new Error("Not a finite number");
  return v;
};

/* ── Agent tools (exposed to the model via function calling) ── */
const S = (d) => ({ type: "STRING", description: d });
const TOOLS = {
  google_search: {
    label: "Searching Google", I: Globe, d: "Search Google for current facts, news, prices, scores, people or anything recent. Returns a short answer plus sources.", p: { query: S("What to search for") },
    run: async ({ query }, o) => {
      const r = await callRetry(o, { systemInstruction: { parts: [{ text: `Answer factually and briefly using Google Search. Today is ${new Date().toDateString()}.` }] }, contents: [{ role: "user", parts: [{ text: String(query) }] }], tools: [{ google_search: {} }] }, { attempts: 3 });
      o.src.push(...r.sources); o.qs.push(...r.queries);
      return { answer: r.text, sources: r.sources.slice(0, 5).map((s) => s.title).filter(Boolean) };
    },
  },
  read_webpage: {
    label: "Reading a page", I: BookOpen, d: "Read the text of a web page from its URL (articles, docs, listings).", p: { url: S("Full http(s) URL") },
    run: async ({ url }) => {
      const c = new AbortController(), t = setTimeout(() => c.abort(), 15000);
      try { const r = await fetch("https://r.jina.ai/" + http(url), { signal: c.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return { text: (await r.text()).slice(0, 9000) }; } finally { clearTimeout(t); }
    },
  },
  get_weather: {
    label: "Checking the weather", I: Cloud, d: "Get live weather and a 6-day forecast for a city.", p: { location: S("City, Country e.g. Harare, Zimbabwe"), units: S("c or f") }, r: ["location"],
    run: async ({ location, units }) => {
      const f = /^f/i.test(units || ""), { p, w } = await fetchWeather(location, f), c = w.current, d = w.daily;
      return { place: [p.name, p.admin1, p.country].filter(Boolean).join(", "), now: { temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m, wind: c.wind_speed_10m, condition: wx(c.weather_code).label }, days: d.time.map((t, i) => ({ date: t, hi: d.temperature_2m_max[i], lo: d.temperature_2m_min[i], rain: d.precipitation_probability_max?.[i], condition: wx(d.weather_code[i]).label })) };
    },
  },
  search_images: {
    label: "Finding photos", I: ImageIcon, d: "Search for photos. Returns titles; use a ui:images card to show them to the user.", p: { query: S("Specific 1-4 word subject") },
    run: async ({ query }) => { let r = []; try { r = await fetchImages(query, 5); } catch (e) {} if (r.length < 3) { try { r = r.concat(await fetchImages2(query, 5)); } catch (e) {} } if (!r.length) throw new Error("No photos found"); return { photos: r.slice(0, 5).map((x) => x.t) }; },
  },
  create_file: {
    label: "Creating a file", I: FileText, d: "Create a downloadable file for the user. Formats: pdf, docx, md, txt, html, csv, json, ics, svg. For pdf/docx put markdown in content (# headings, - bullets, | tables |). After calling, show it with a ui:file card.",
    p: { filename: S("File name without extension"), format: S("pdf | docx | md | txt | html | csv | json | ics | svg"), title: S("Document title (pdf/docx)"), content: S("Full file content") }, r: ["filename", "format", "content"],
    run: async (a) => { const r = makeFile(a); return { created: r.name, bytes: r.size, next: `Now show it with ui:file {"name":"${r.name}"}` }; },
  },
  crypto_price: {
    label: "Checking crypto prices", I: Coins, d: "Live cryptocurrency prices and 24h change (CoinGecko).", p: { coins: S("Comma-separated CoinGecko ids, e.g. bitcoin,ethereum,solana"), vs: S("Fiat currency code, default usd") }, r: ["coins"],
    run: async ({ coins, vs }) => { const c = String(vs || "usd").toLowerCase(); const d = await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${enc(String(coins).toLowerCase().replace(/\s+/g, ""))}&vs_currencies=${c}&include_24hr_change=true&include_market_cap=true`, 10000); if (!Object.keys(d).length) throw new Error("Unknown coin id"); return d; },
  },
  country_info: {
    label: "Looking up a country", I: Globe, d: "Facts about a country: capital, population, languages, currency, region, timezones.", p: { name: S("Country name") }, r: ["name"],
    run: async ({ name }) => { const d = await getJSON(`https://restcountries.com/v3.1/name/${enc(name)}?fields=name,capital,population,region,subregion,languages,currencies,area,timezones,flags`, 10000); const c = d[0]; return { name: c.name.common, official: c.name.official, capital: c.capital, population: c.population, region: `${c.region}, ${c.subregion}`, area_km2: c.area, languages: Object.values(c.languages || {}), currencies: (Object.values(c.currencies || {}) as any[]).map((x) => x.name), timezones: c.timezones }; },
  },
  hacker_news: {
    label: "Reading Hacker News", I: Newspaper, d: "Current top Hacker News stories.", p: { count: S("How many, 1-15") },
    run: async ({ count }) => { const ids = (await getJSON("https://hacker-news.firebaseio.com/v0/topstories.json")).slice(0, Math.min(15, parseInt(count, 10) || 8)); return { stories: (await Promise.all(ids.map((i) => getJSON(`https://hacker-news.firebaseio.com/v0/item/${i}.json`)))).map((x) => ({ title: x.title, url: x.url || `https://news.ycombinator.com/item?id=${x.id}`, points: x.score, comments: x.descendants })) }; },
  },
  nasa_picture: {
    label: "Fetching NASA picture", I: Rocket, d: "NASA's Astronomy Picture of the Day (title, explanation, image url).", p: { date: S("Optional YYYY-MM-DD") },
    run: async ({ date }) => { const d = await getJSON(`https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY${date ? "&date=" + date : ""}`, 12000); return { title: d.title, date: d.date, explanation: String(d.explanation || "").slice(0, 700), url: d.hdurl || d.url, type: d.media_type }; },
  },
  search_music: {
    label: "Looking up music", I: Music2, d: "Look up real songs by artist, genre, mood or title. Returns real track names you can recommend.", p: { query: S("Artist, song, genre or mood"), sort: S("Optional: oldest or newest, to list an artist's earliest or latest releases") }, r: ["query"],
    run: async ({ query, sort }) => ({ tracks: (await fetchTracks(sort ? { query, artist: query, sort } : { query })).map((t) => ({ title: t.title, artist: t.artist, album: t.album })) }),
  },
  play_music: {
    label: "Playing music", I: Play, d: "Start playing 30-second previews right now in the app's player.", p: { query: S("Artist, song, genre or mood") },
    run: async ({ query }) => { const l = (await fetchTracks({ query })).filter((t) => t.preview); if (!l.length) throw new Error("No playable previews found"); player.toggle(l[0], l); return { playing: `${l[0].title} by ${l[0].artist}`, queued: l.length }; },
  },
  control_music: {
    label: "Music controls", I: Music2, d: "Control playback: pause, resume, next, previous or stop.", p: { action: S("pause | resume | next | previous | stop") },
    run: async ({ action }) => { const a = String(action).toLowerCase(), s = player.get(); if (a === "pause") player.pause(); else if (a === "resume") s.track && !s.playing && player.toggle(s.track); else if (a === "next") player.next(); else if (a === "previous") player.prev(); else if (a === "stop") player.stop(); else throw new Error("Unknown action"); return { ok: true }; },
  },
  wikipedia: {
    label: "Reading Wikipedia", I: BookOpen, d: "Look up a topic, person or place on Wikipedia for a reliable summary.", p: { query: S("Topic") },
    run: async ({ query }) => { const d = await fetchWiki(query); return { title: d.title, description: d.desc, summary: d.text.slice(0, 1400), url: d.url }; },
  },
  define_word: { label: "Looking up a word", I: BookOpen, d: "Dictionary definition of an English word.", p: { word: S("The word") }, run: async ({ word }) => ({ ...(await fetchDefine(word)), audio: undefined }) },
  convert_currency: {
    label: "Converting currency", I: Coins, d: "Convert money using live exchange rates.", p: { amount: { type: "NUMBER", description: "Amount" }, from: S("ISO code e.g. USD"), to: S("ISO code e.g. ZAR") },
    run: async ({ amount, from, to }) => { const r = await fetchRate(from, to), a = Number(amount) || 1; return { amount: a, from, to, result: +(a * r.rate).toFixed(4), rate: r.rate, asOf: r.date }; },
  },
  find_place: {
    label: "Finding the place", I: MapPin, d: "Geocode a place, address or landmark to coordinates.", p: { query: S("Place or address") },
    run: async ({ query }) => ({ matches: (await fetchGeo(query)).map((x) => ({ name: x.name, lat: x.lat, lon: x.lon })) }),
  },
  search_places: {
    label: "Searching places", I: MapPin, d: "Find real businesses and places (restaurants, shops, clinics, services) with address, rating and whether they are open. Pass lat and lon from get_location for 'near me'.",
    p: { query: S("What to find, e.g. coffee shops in Avondale, Harare"), lat: { type: "NUMBER", description: "Optional latitude" }, lon: { type: "NUMBER", description: "Optional longitude" } }, r: ["query"],
    run: async ({ query, lat, lon }) => {
      const key = getMapsKey(); if (!key) throw new Error("No Google Maps key set");
      const body: any = { textQuery: String(query), maxResultCount: 6 };
      if (Number.isFinite(lat) && Number.isFinite(lon)) body.locationBias = { circle: { center: { latitude: lat, longitude: lon }, radius: 5000 } };
      const r = await fetch("https://places.googleapis.com/v1/places:searchText", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.currentOpeningHours.openNow,places.googleMapsUri,places.nationalPhoneNumber,places.websiteUri" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error?.message || `Places search failed (${r.status})`);
      if (!d.places?.length) throw new Error("No places found");
      return { places: d.places.map((x) => ({ name: x.displayName?.text, address: x.formattedAddress, rating: x.rating, reviews: x.userRatingCount, openNow: x.currentOpeningHours?.openNow, phone: x.nationalPhoneNumber, website: x.websiteUri, maps: x.googleMapsUri })) };
    },
  },
  get_location: {
    label: "Getting your location", I: Navigation, d: "Get the user's current location (asks permission). Use for 'near me' questions.", p: {},
    run: async () => { const c: any = await here(); let n: any = {}; try { n = await placeName(c); } catch (e) {} return { ...c, ...n }; },
  },
  get_time: {
    label: "Checking the time", I: Clock, d: "Current date and time, optionally in an IANA time zone.", p: { timezone: S("e.g. Africa/Harare. Omit for the user's own zone") }, r: [],
    run: async ({ timezone }) => { const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone; return { timezone: tz, now: new Date().toLocaleString("en-GB", { timeZone: tz, dateStyle: "full", timeStyle: "short" }) }; },
  },
  get_sports: {
    label: "Checking scores", I: Trophy, d: "Live football (soccer) and other sports scores, fixtures or league table. League e.g. epl, la liga, bundesliga, serie a, uefa nations league, international friendlies, champions league, mls, psl, nfl, nba.", p: { league: S("League name"), team: S("Optional team name filter"), table: S("yes for the standings table"), date: S("today, yesterday, tomorrow or YYYY-MM-DD. Default today") }, r: ["league"],
    run: async ({ league, team, table, date }) => {
      const [sp, code, nm] = leagueOf(league);
      if (/^y/i.test(table || "") && sp === "soccer") { const t = await fetchTable(code); return { league: nm, table: t.slice(0, 20).map((r) => `${r.rank}. ${r.n} P${r.gp} GD${r.gd} Pts${r.pts}`) }; }
      const ev = await fetchDay(sp, code, date), f = team ? ev.filter((m) => (m.h.n + m.a.n).toLowerCase().includes(String(team).toLowerCase())) : [];
      if (!ev.length) return { league: nm, date: date || "today", matches: [], note: "No matches in this feed for that day. Verify with google_search." };
      return { league: nm, date: date || "today", matches: (f.length ? f : ev).slice(0, 24).map((m) => `${m.h.n} ${m.h.s}-${m.a.s} ${m.a.n} (${m.detail})`) };
    },
  },
  get_news: {
    label: "Reading the news", I: Newspaper, d: "Fetch recent headlines on a topic (default: world news).", p: { query: S("Topic, e.g. 'Zimbabwe economy'") }, r: [],
    run: async ({ query }) => { const a = await fetchNews(String(query || "world"), 6); return { stories: a.map((x) => `${x.t} (${x.dom || "source"}, ${agoD(x.at)})`) }; },
  },
  get_crypto: {
    label: "Checking prices", I: Coins, d: "Live cryptocurrency prices in USD with 24h change. Use CoinGecko ids like bitcoin, ethereum, solana.", p: { coins: S("Comma separated CoinGecko ids") },
    run: async ({ coins }) => { const ids = String(coins).toLowerCase().replace(/\s+/g, "").slice(0, 120), j = await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${enc(ids)}&vs_currencies=usd&include_24hr_change=true`); return Object.fromEntries((Object.entries(j) as [string, any][]).map(([k, v]) => [k, `$${v.usd} (${(v.usd_24h_change || 0).toFixed(2)}% 24h)`])); },
  },
  get_country: {
    label: "Looking up a country", I: Flag, d: "Facts about a country: capital, population, languages, currency, region, area.", p: { name: S("Country name") },
    run: async ({ name }) => { const j = (await getJSON(`https://restcountries.com/v3.1/name/${enc(name)}?fields=name,capital,population,region,subregion,languages,currencies,area,timezones`))[0]; return { name: j.name?.common, capital: j.capital?.[0], population: j.population, region: `${j.region}, ${j.subregion}`, area_km2: j.area, languages: Object.values(j.languages || {}), currencies: (Object.values(j.currencies || {}) as any[]).map((c) => c.name), timezones: j.timezones?.slice(0, 3) }; },
  },
  get_recipe: {
    label: "Finding a recipe", I: UtensilsCrossed, d: "Find a real recipe by dish name (ingredients and method).", p: { dish: S("Dish name") },
    run: async ({ dish }) => { const m = (await getJSON(`https://www.themealdb.com/api/json/v1/1/search.php?s=${enc(dish)}`)).meals?.[0]; if (!m) return { found: false }; const ing = []; for (let i = 1; i <= 20; i++) if (m["strIngredient" + i]?.trim()) ing.push(`${m["strMeasure" + i] || ""} ${m["strIngredient" + i]}`.trim()); return { name: m.strMeal, category: m.strCategory, cuisine: m.strArea, ingredients: ing, method: String(m.strInstructions || "").slice(0, 1200), image: m.strMealThumb }; },
  },
  search_books: {
    label: "Searching books", I: BookOpen, d: "Search Open Library for books by title, author or subject.", p: { query: S("Title, author or subject") },
    run: async ({ query }) => { const j = await getJSON(`https://openlibrary.org/search.json?q=${enc(query)}&limit=6&fields=title,author_name,first_publish_year`); return { books: (j.docs || []).map((b) => `${b.title} by ${(b.author_name || ["unknown"])[0]}${b.first_publish_year ? " (" + b.first_publish_year + ")" : ""}`) }; },
  },
  space_photo: {
    label: "Looking at space", I: Rocket, d: "NASA's astronomy picture of the day with its explanation.", p: {}, r: [],
    run: async () => { const j = await getJSON("https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY"); return { title: j.title, date: j.date, explanation: String(j.explanation || "").slice(0, 500), image: j.media_type === "image" ? j.url : "", url: j.url }; },
  },
  get_air_quality: {
    label: "Checking air quality", I: Wind, d: "Current air quality index (US AQI), PM2.5 and PM10 for a city.", p: { location: S("City, Country") },
    run: async ({ location }) => { const g = (await fetchGeo(String(location)))[0], j = await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${g.lat}&longitude=${g.lon}&current=us_aqi,pm2_5,pm10`); return { place: g.name.split(",").slice(0, 2).join(","), us_aqi: j.current?.us_aqi, pm2_5: j.current?.pm2_5, pm10: j.current?.pm10 }; },
  },
  run_code: {
    label: "Running code", I: Code, d: "Write and run Python in a sandbox for exact calculations, data processing, statistics, simulations or checking logic. Describe the task in plain words.", p: { task: S("What to compute, with any data") },
    run: async ({ task }, o) => { const r = await callRetry(o, { contents: [{ role: "user", parts: [{ text: String(task) }] }], tools: [{ code_execution: {} }] }, { attempts: 3 }); const out = (r.parts || []).filter((x) => x.codeExecutionResult).map((x) => x.codeExecutionResult.output).join("\n"); return { output: (out || "").slice(0, 1500), explanation: r.text.slice(0, 700) }; },
  },
  generate_image: {
    label: "Creating an image", I: ImageIcon, d: "Generate a new image from a text description with Gemini. Returns an id; show it with a ui:genimage card.", p: { prompt: S("Detailed description of the image") },
    run: async ({ prompt }, o) => {
      const r = await fetch(`${API}/gemini-2.5-flash-image:generateContent`, { method: "POST", signal: o.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": o.key }, body: JSON.stringify({ contents: [{ parts: [{ text: String(prompt).slice(0, 1500) }] }], generationConfig: { responseModalities: ["IMAGE", "TEXT"] } }) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error?.message || `Image generation failed (${r.status})`);
      const part = (j.candidates?.[0]?.content?.parts || []).find((x) => x.inlineData); if (!part) throw new Error("No image came back. Image generation may not be enabled for this key.");
      const id = rid(); GENIMG.set(id, `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`); return { id, next: "Show it with ui:genimage" };
    },
  },
  get_earthquakes: {
    label: "Checking earthquakes", I: Globe, d: "Significant earthquakes (M4.5+) in the last 24 hours worldwide (USGS).", p: {}, r: [],
    run: async () => { const j = await getJSON("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson"); return { quakes: (j.features || []).slice(0, 8).map((f) => `M${f.properties.mag} ${f.properties.place} (${agoD(f.properties.time)})`) }; },
  },
  get_holidays: {
    label: "Checking holidays", I: CalendarDays, d: "Upcoming public holidays for a country.", p: { country: S("ISO 2-letter code, e.g. ZA, US, GB"), year: S("Optional year") }, r: ["country"],
    run: async ({ country, year }) => { const y = parseInt(year, 10) || new Date().getFullYear(), j = await getJSON(`https://date.nager.at/api/v3/PublicHolidays/${y}/${String(country).toUpperCase().slice(0, 2)}`); const up = j.filter((h) => new Date(h.date) >= new Date(new Date().toDateString())); return { holidays: (up.length ? up : j).slice(0, 10).map((h) => `${h.date} ${h.name}`) }; },
  },
  get_trivia: {
    label: "Finding trivia", I: HelpCircle, d: "Real multiple-choice trivia questions to build a ui:quiz from.", p: { topic: S("Optional: general, science, history, geography, sports, music, film, computers") }, r: [],
    run: async ({ topic }) => { const cat = { general: 9, science: 17, computers: 18, music: 12, film: 11, sports: 21, geography: 22, history: 23 }[String(topic || "").toLowerCase()], j = await getJSON(`https://opentdb.com/api.php?amount=5&type=multiple&encode=url3986${cat ? "&category=" + cat : ""}`), u = decodeURIComponent; return { questions: (j.results || []).map((x) => ({ q: u(x.question), correct: u(x.correct_answer), wrong: x.incorrect_answers.map(u) })) }; },
  },
  calculate: { label: "Calculating", I: Calculator, d: "Evaluate a maths expression exactly (+ - * / % ^ and sqrt, sin, cos, log, pi...).", p: { expression: S("Expression") }, run: async ({ expression }) => ({ result: calc(expression) }) },
  remember: {
    label: "Saving to memory", I: Brain, d: "Save a durable fact or preference about the user (name, goals, tastes). Only when it will help in future chats.", p: { fact: S("Short fact in third person") },
    run: async ({ fact }, o) => { o.ctx.remember?.(String(fact).slice(0, 200)); return { saved: true }; },
  },
};
const toolDecls = () => Object.entries(TOOLS).map(([name, t]) => {
  const keys = Object.keys(t.p), d: any = { name, description: t.d };
  if (keys.length) d.parameters = { type: "OBJECT", properties: t.p, required: (t as any).r || keys };
  return d;
});

/* ── Gemini transport (single call, optional SSE streaming) ── */
// Sequential async retry without a for/while loop (loop guards time a whole loop, awaits included).
const rep = async (n, fn, i = 0) => { const r = await fn(i); return r !== undefined || i + 1 >= n ? r : rep(n, fn, i + 1); };
async function callModel(m, key, body, { stream, onText, signal }) {
  const ctl = new AbortController(), kill = () => ctl.abort();
  signal?.addEventListener("abort", kill);
  let to; const arm = () => { clearTimeout(to); to = setTimeout(kill, stream ? 45000 : 60000); }; arm();
  try {
    const res = await fetch(`${API}/${m}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`, {
      method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError((Array.isArray(d) ? d[0] : d)?.error?.message || `Request failed (${res.status})`, res.status); }
    const acc = { parts: [], sources: [], queries: [], block: "" };
    const eat = (data) => {
      if (data.promptFeedback?.blockReason) acc.block = data.promptFeedback.blockReason;
      const c = data.candidates?.[0]; if (!c) return;
      for (const p of c.content?.parts || []) { acc.parts.push(p); if (p.text && !p.thought) onText?.(p.text); }
      const gm = c.groundingMetadata;
      if (gm) { acc.sources.push(...(gm.groundingChunks || []).map((x) => x.web).filter(Boolean).map((w) => ({ title: w.title || "", url: w.uri }))); acc.queries.push(...(gm.webSearchQueries || [])); }
    };
    if (stream && res.body?.getReader) {
      const rd = res.body.getReader(), dec = new TextDecoder(); let buf = "";
      const pump = async () => {
        const { done, value } = await rd.read(); if (done) return; arm();
        buf += dec.decode(value, { stream: true });
        let mm; while ((mm = /\r?\n\r?\n/.exec(buf))) {
          const chunk = buf.slice(0, mm.index); buf = buf.slice(mm.index + mm[0].length);
          for (const ln of chunk.split(/\r?\n/)) if (ln.startsWith("data:")) { try { eat(JSON.parse(ln.slice(5))); } catch (e) {} }
        }
        return pump();
      };
      await pump();
    } else eat(await res.json());
    const text = acc.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join(""), calls = acc.parts.filter((p) => p.functionCall).map((p) => p.functionCall);
    if (!text.trim() && !calls.length) throw new ApiError(acc.block ? `Blocked: ${acc.block}` : "The model returned an empty reply", 0);
    const seen = new Set();
    return { parts: acc.parts, text: text.trim(), calls, sources: acc.sources.filter((s) => !seen.has(s.url) && seen.add(s.url)), queries: [...new Set(acc.queries)] };
  } catch (e) { if (signal?.aborted) throw new DOMException("Aborted", "AbortError"); throw e; }
  finally { clearTimeout(to); signal?.removeEventListener("abort", kill); }
}

// Retries with backoff; later attempts move to the model's fallbacks. Auth errors fail fast.
async function callRetry(o, body, { stream = false, onText, attempts = MAX_ATTEMPTS }: any = {}) {
  let last, got = false;
  const out = await rep(attempts, async (i) => {
    const a = i + 1;
    if (a > 1) { o.onRetry?.(a); await sleep(Math.min(6000, 500 * 2 ** (a - 2)) + Math.random() * 250); }
    if (o.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const idx = Math.min(o.pref.i + Math.floor((a - 1) / 2), o.model.api.length - 1);
    try {
      const r = await callModel(o.model.api[idx], o.key, body, { stream, signal: o.signal, onText: (t) => { got = true; onText?.(t); } });
      o.pref.i = idx; return r;
    } catch (e) {
      if (o.signal?.aborted || e?.name === "AbortError") throw new DOMException("Aborted", "AbortError");
      e.tries = a; last = e;
      if (e.status === 401 || e.status === 403 || got) throw e;
      if (e.status === 400 && body.tools?.[0]?.functionDeclarations) { delete body.tools; o.noTools = true; }
    }
  });
  if (out) return out;
  throw last;
}

const toContent = (h) => {
  const parts: any[] = [{ text: (h.text || "") + (h.ctx ? "\n\n" + h.ctx : "") || " " }];
  for (const a of h.att || []) {
    if (a.data && (a.k === "img" || a.k === "pdf")) parts.push({ inlineData: { mimeType: a.mime, data: a.data } });
    else if (a.k === "img") parts.push({ text: "[An image was attached earlier in this chat]" });
  }
  return { role: h.role, parts };
};

// Function-calling loop: the model can chain tools (search → read → answer) before replying.
async function runAgent(history, o) {
  o.pref = { i: 0 }; o.src = []; o.qs = [];
  const ext = o.agent ? await mcpAll(o.ctx.mcp) : [];
  const decls = o.agent ? [...toolDecls(), ...ext.map((x) => ({ name: x.name, description: `[${x.srv.name || "MCP"}] ${x.tool.description || x.tool.name}`.slice(0, 500), ...(Object.keys(x.tool.inputSchema?.properties || {}).length ? { parameters: gSchema(x.tool.inputSchema) } : {}) }))] : [];
  const sys = SYSTEM2(o.ctx, { voice: o.voice, think: o.think, search: o.search, tools: decls.length > 0 });
  const contents = history.map(toContent), trace = [];
  let acc = "";
  const done = await rep(8, async (step) => {
    const body: any = { systemInstruction: { parts: [{ text: sys }] }, contents };
    if (decls.length && step < 7 && !o.noTools) body.tools = [{ functionDeclarations: decls }];
    else if (o.search && !o.agent) body.tools = [{ google_search: {} }];
    const r = await callRetry(o, body, { stream: o.stream, onText: (t) => { acc += t; o.onDelta?.(acc); } });
    if (!r.calls.length || !body.tools) { o.src.push(...r.sources); o.qs.push(...r.queries); return { text: r.text || acc.trim(), sources: dedupe(o.src), queries: [...new Set(o.qs)], trace }; }
    if (r.text && o.stream) { acc += "\n"; }
    contents.push({ role: "model", parts: r.parts });
    const res = await Promise.all(r.calls.map(async (c) => {
      const ex = ext.find((x) => x.name === c.name), T = TOOLS[c.name], st = { id: rid(), name: c.name, label: ex ? `Using ${ex.srv.name || "MCP"}` : T?.label || c.name, state: "run" };
      trace.push(st); o.onStep?.(trace.map((t) => ({ ...t })));
      let out;
      try { out = ex ? await mcpCall(ex.srv, ex.tool.name, c.args) : T ? await T.run(c.args || {}, o) : { error: "Unknown tool" }; st.state = out?.error ? "err" : "ok"; }
      catch (e) { if (o.signal?.aborted) throw e; out = { error: e?.message || "Tool failed" }; st.state = "err"; }
      o.onStep?.(trace.map((t) => ({ ...t })));
      return { functionResponse: { name: c.name, response: out?.error ? out : { result: out?.result ?? out } } };
    }));
    contents.push({ role: "user", parts: res });
  });
  if (done) return done;
  throw new ApiError("The assistant used too many steps", 0);
}
const dedupe = (a) => { const s = new Set(); return a.filter((x) => x.url && !s.has(x.url) && s.add(x.url)); };

const SYSTEM2 = (ctx, f) => SYSTEM() + `

PROFILE (private background for you only. Never quote, repeat or mention the personal notes below, and never treat them as something said in the conversation. Use them silently to adjust tone and depth.)
Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.${ctx.name ? ` The user's name is ${ctx.name}.` : ""}${ctx.about ? ` The user says about themselves: ${ctx.about}` : ""}${ctx.mem?.length ? "\nThings you remember about the user:\n" + ctx.mem.map((x) => "- " + x).join("\n") : ""}

SAVED WIDGETS: ${(LS.get("epique.widgets", []).map((w) => w.name).slice(0, 20).join(", ")) || "none"}

MORE CARDS (same ui:TYPE one-line JSON format)
- ui:map {"query":"Eastgate Mall, Harare"} for one place, {"query":"coffee shops in Avondale, Harare","search":true} for many results, or {"origin":"","destination":"","mode":"driving|walking|transit|bicycling"} for directions.
- ui:wiki {"query":"Great Zimbabwe"} for a topic summary with a picture.
- ui:define {"word":"ephemeral"} for a dictionary entry.
- ui:currency {"amount":100,"from":"USD","to":"ZAR"} for live conversions.
- ui:chart {"type":"bar|line|pie","title":"","labels":["A","B"],"series":[{"name":"","values":[1,2]}],"unit":""} to chart numbers you provide or found.
- ui:quiz {"title":"","questions":[{"q":"","options":["","","",""],"answer":0,"why":""}]} (3 to 6 questions) when asked to test or quiz the user.
- ui:timer {"seconds":300,"label":"Tea"} for timers and countdowns.
- ui:clock {"zones":["Africa/Harare","Europe/London"]} for time in other places.
- ui:music also accepts "play":true to start the first track at once.
- ui:sports {"league":"epl","team":"","view":"scores|table","date":"today|yesterday|tomorrow|YYYY-MM-DD"} for football (soccer) scores, fixtures and league tables. Leagues: epl, la liga, bundesliga, serie a, ligue 1, nations league, international friendlies, euro qualifiers, champions league, europa league, mls, psl, afcon, world cup, plus nfl, nba, mlb, nhl. The app fetches live data.
- ui:news {"query":"topic","count":5} for headlines. Never invent stories.
- ui:card {"title":"","subtitle":"","icon":"sparkles|trophy|news|check|bell|clock|map|globe|chart|code|book|coins|music|cloud|link|flag|food|rocket","accent":"#8ecbff","sections":[...]} is a flexible template for anything without its own card. Section types: {"type":"text","text":""}, {"type":"stats","items":[{"label":"","value":"","sub":""}]}, {"type":"kv","items":[{"k":"","v":""}]}, {"type":"list","items":["" or {"title":"","note":""}]}, {"type":"steps","items":[""]}, {"type":"table","cols":[""],"rows":[[""]]}, {"type":"progress","label":"","value":60,"max":100}, {"type":"badges","items":[""]}, {"type":"links","items":[{"title":"","url":""}]}, {"type":"image","url":"","caption":""}, {"type":"quote","text":"","by":""}, {"type":"buttons","items":[{"label":"","ask":"message sent when tapped"}]}. Design it yourself: pick the sections that suit the content.
- ui:notes {"title":"","text":""} for an editable saved note. ui:checklist {"title":"","items":["",""]} and ui:tasks {"title":"","items":[{"t":"","due":"Fri","priority":"high|med|low"}]} for tickable lists the user can edit.
- ui:reminder {"text":"Call mum","minutes":30} or {"text":"","at":"ISO date-time"} sets a real reminder that alerts while the app is open.
- ui:progress {"title":"","value":60,"max":100,"steps":[{"label":"","state":"done|active|todo"}]} for progress and multi-step status.
- ui:links {"title":"","links":[{"title":"","url":"","note":""}]} for sites and resources. ui:apps {"apps":[{"name":"","url":"","desc":""}]} for apps and tools.
- ui:poll {"question":"","options":["",""]} for a vote. ui:ask {"question":"","options":["",""]} to ask the user a clarifying question with tappable answers (their pick is sent as their reply).
- ui:countdown {"label":"","date":"ISO date-time"} and ui:stopwatch {} for time tracking.
- ui:widget builds a custom widget when the user asks for one or wants something no card covers (trackers, counters, planners, dashboards, calculators, forms). Format: {"title":"","icon":"sparkles","accent":"#8ecbff","elements":[...]}. Element types (each may have an "id" so values persist): {"t":"heading","text":"","level":1|2|3}, {"t":"text","text":""}, {"t":"time","mode":"time|date|both","zone":"Africa/Harare","seconds":false}, {"t":"check","id":"a","label":""}, {"t":"toggle","id":"b","label":""}, {"t":"input","id":"c","label":"","placeholder":""}, {"t":"textarea","id":"d","label":""}, {"t":"counter","id":"e","label":"","step":1,"min":0}, {"t":"slider","id":"f","label":"","min":0,"max":10,"unit":""}, {"t":"select","id":"g","label":"","options":["",""]}, {"t":"button","label":"","ask":"message to send"} or with "reset":true, "inc":{"e":1}, "set":{"b":true}, {"t":"progress","label":"","of":"checks"} (or "of":"slider id" with "max", or "value"), {"t":"stat","label":"","value":"{{e}}"}, {"t":"badge","text":""}, {"t":"list","items":[""]}, {"t":"link","label":"","url":""}, {"t":"image","url":""}, {"t":"divider"}, {"t":"row","items":[...]}. Use {{id}} to show a value, and {{done}}, {{total}}, {{pct}} for checkbox counts. The card has a Save widget button. After you create a widget, end with one short line asking if they'd like to save it. If the SAVED WIDGETS list below has a fit, show it with {"saved":"name"}.
- ui:game {"game":"chess","level":"easy|normal|hard"} starts a playable chess game against you; offer it when the user is bored or wants a game. ui:genimage {"id":"from generate_image","alt":""} shows a generated image.
- ui:file {"name":"report.pdf"} shows a download card for a file you made with the create_file tool (pdf, docx, md, txt, html, csv, json, ics, svg). When asked for a document, report, CV, spreadsheet data or calendar file, call create_file first, then show the card. Extra tools: crypto_price, country_info, hacker_news, nasa_picture. ui:define also gives synonyms and antonyms.
- A fenced code block with the language html or svg gets a live preview and a full-screen canvas, so make small apps, pages and graphics as one self-contained html file.` + (f.tools ? `

TOOLS
You can call tools. Use them instead of guessing: google_search for anything current or uncertain, read_webpage to open a link, get_weather, search_music or play_music, wikipedia, convert_currency, find_place, search_places for real businesses (then a ui:place or ui:map card), get_location for "near me", calculate for exact math, get_sports for scores, fixtures and tables of any competition including the UEFA Nations League (pass date: today or yesterday), get_news for headlines, get_crypto for coin prices, get_country, get_recipe, search_books, space_photo, get_air_quality, run_code (Python sandbox for exact computation), generate_image (then a ui:genimage card), get_earthquakes, get_holidays, get_trivia (then a ui:quiz card)s, and remember to keep lasting facts about the user. Chain tools when useful, then answer. Real data from tools is shown to the user only if you add the matching ui: card, so add one when it helps.${f.search ? " The user turned on web search: call google_search before answering anything that could have changed." : ""}` : "") + (f.voice ? " In voice mode you may call play_music or control_music when the user asks for music." : "") + (f.think ? " Reason carefully before answering." : "") + (f.voice ? VOICE : "");


/* ── LaTeX → React (no dependencies) ────────────────────── */
const SYM = Object.fromEntries((
  "alpha=α beta=β gamma=γ delta=δ epsilon=ϵ varepsilon=ε zeta=ζ eta=η theta=θ vartheta=ϑ iota=ι kappa=κ lambda=λ mu=μ nu=ν xi=ξ pi=π varpi=ϖ rho=ρ varrho=ϱ sigma=σ varsigma=ς tau=τ upsilon=υ phi=ϕ varphi=φ chi=χ psi=ψ omega=ω " +
  "Gamma=Γ Delta=Δ Theta=Θ Lambda=Λ Xi=Ξ Pi=Π Sigma=Σ Upsilon=Υ Phi=Φ Psi=Ψ Omega=Ω " +
  "times=× div=÷ cdot=· pm=± mp=∓ leq=≤ le=≤ geq=≥ ge=≥ neq=≠ ne=≠ approx=≈ sim=∼ simeq=≃ cong=≅ equiv=≡ propto=∝ infty=∞ partial=∂ nabla=∇ forall=∀ exists=∃ in=∈ notin=∉ ni=∋ " +
  "subset=⊂ subseteq=⊆ supset=⊃ supseteq=⊇ cup=∪ cap=∩ emptyset=∅ varnothing=∅ to=→ rightarrow=→ leftarrow=← gets=← leftrightarrow=↔ Rightarrow=⇒ Leftarrow=⇐ Leftrightarrow=⇔ " +
  "implies=⟹ iff=⟺ longrightarrow=⟶ longleftarrow=⟵ rightleftharpoons=⇌ leftrightharpoons=⇋ uparrow=↑ downarrow=↓ mapsto=↦ ldots=… dots=… cdots=⋯ vdots=⋮ ddots=⋱ degree=° circ=∘ " +
  "angle=∠ perp=⊥ parallel=∥ therefore=∴ because=∵ hbar=ℏ ell=ℓ Re=ℜ Im=ℑ aleph=ℵ prime=′ ll=≪ gg=≫ star=⋆ bullet=• oplus=⊕ otimes=⊗ neg=¬ land=∧ lor=∨ wedge=∧ vee=∨ ast=∗ mid=∣ " +
  "langle=⟨ rangle=⟩ lfloor=⌊ rfloor=⌋ lceil=⌈ rceil=⌉ lbrace={ rbrace=} lbrack=[ rbrack=] vert=| Vert=‖ lvert=| rvert=| sum=∑ prod=∏ int=∫ iint=∬ oint=∮ " +
  "triangle=△ square=□ checkmark=✓ micro=µ euro=€ pounds=£ dagger=† ddagger=‡ AA=Å"
).split(" ").map((s) => { const i = s.indexOf("="); return [s.slice(0, i), s.slice(i + 1)]; }));
const FN = new Set("sin cos tan cot sec csc log ln lg exp lim max min sup inf det gcd arcsin arccos arctan sinh cosh tanh arg deg dim ker Pr mod".split(" "));
const RAWCMD = new Set(["text", "textrm", "textit", "textbf", "mbox", "mathrm", "mathsf", "mathtt", "operatorname", "ce", "pu"]);
const SPACE = { ",": 0.17, ":": 0.22, ">": 0.22, ";": 0.28, "!": 0, " ": 0.3 };

function lex(s) {
  const T = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      const m = /^[a-zA-Z]+/.exec(s.slice(i + 1));
      if (m) {
        const n = m[0]; i += 1 + n.length;
        if (RAWCMD.has(n)) {
          let j = i; while (s[j] === " ") j++;
          if (s[j] === "{") {
            let d = 1, k = j + 1;
            while (k < s.length && d) { if (s[k] === "{") d++; else if (s[k] === "}") d--; k++; }
            T.push({ k: "raw", c: n, v: s.slice(j + 1, k - 1) }); i = k; continue;
          }
        }
        T.push({ k: "cmd", v: n });
      } else {
        const e = s[i + 1] || ""; i += 2;
        if (e === "\\") T.push({ k: "nl" });
        else if (e && e in SPACE) T.push({ k: "sp", v: SPACE[e] });
        else if (e === "|") T.push({ k: "ch", v: "‖" });
        else if (e) T.push({ k: "ch", v: e });
      }
    } else if (c === "{") { T.push({ k: "{" }); i++; }
    else if (c === "}") { T.push({ k: "}" }); i++; }
    else if (c === "^" || c === "_" || c === "&") { T.push({ k: c }); i++; }
    else if (c === "~") { T.push({ k: "sp", v: 0.3 }); i++; }
    else if (/\s/.test(c)) i++;
    else { T.push({ k: "ch", v: c }); i++; }
  }
  return T;
}

function parseTeX(src) {
  const T = lex(src); let p = 0;
  const G = (c = []) => ({ t: "g", c });
  const isStop = (t) => !t || t.k === "}" || t.k === "&" || t.k === "nl" || (t.k === "cmd" && (t.v === "right" || t.v === "end"));
  const isCh = (v) => T[p] && T[p].k === "ch" && T[p].v === v;
  function seq() { const out = []; while (p < T.length && !isStop(T[p])) out.push(scripts()); return out; }
  function scripts() {
    const b = atom(); let sup, sub;
    while (T[p] && (T[p].k === "^" || T[p].k === "_")) { const k = T[p++].k, x = arg(); if (k === "^") sup = x; else sub = x; }
    return sup || sub ? { t: "sc", b, sup, sub } : b;
  }
  function arg() {
    const t = T[p];
    if (!t || t.k === "^" || t.k === "_" || t.k === "&" || t.k === "}" || t.k === "nl") return G();
    return atom();
  }
  function optArg() {
    if (!isCh("[")) return null;
    p++; const c = []; while (p < T.length && !isCh("]") && !isStop(T[p])) c.push(scripts()); p++; return G(c);
  }
  function atom() {
    const t = T[p++];
    if (!t) return G();
    switch (t.k) {
      case "{": { const c = seq(); if (T[p] && T[p].k === "}") p++; return G(c); }
      case "^": case "_": p--; return G();
      case "sp": return { t: "sp", w: t.v };
      case "raw": return { t: t.c === "ce" || t.c === "pu" ? "ce" : "tx", v: t.v, c: t.c };
      case "ch": return { t: "ch", v: t.v };
      case "cmd": return cmd(t.v);
      default: p--; return G();
    }
  }
  function delim() {
    const t = T[p++]; if (!t) return "";
    if (t.k === "ch") return t.v === "." ? "" : t.v;
    if (t.k === "cmd") return SYM[t.v] || "";
    return "";
  }
  function env() {
    let name = "";
    if (T[p] && T[p].k === "{") { p++; while (T[p] && T[p].k !== "}") name += T[p++].v || ""; p++; }
    if (name === "array" && T[p] && T[p].k === "{") { while (T[p] && T[p].k !== "}") p++; p++; }
    const rows = [];
    for (;;) {
      const row = [];
      for (;;) { row.push(seq()); if (T[p] && T[p].k === "&") { p++; continue; } break; }
      rows.push(row);
      if (T[p] && T[p].k === "nl") { p++; continue; }
      break;
    }
    if (T[p] && T[p].k === "cmd" && T[p].v === "end") { p++; if (T[p] && T[p].k === "{") { while (T[p] && T[p].k !== "}") p++; p++; } }
    const lastRow = rows[rows.length - 1];
    if (rows.length > 1 && lastRow.length === 1 && !lastRow[0].length) rows.pop();
    return { t: "mx", name: name.replace("*", ""), rows };
  }
  function cmd(n) {
    switch (n) {
      case "frac": case "dfrac": case "tfrac": case "cfrac": { const a = arg(), b = arg(); return { t: "fr", a, b }; }
      case "binom": case "dbinom": case "tbinom": { const a = arg(), b = arg(); return { t: "fr", a, b, bin: 1 }; }
      case "sqrt": { const i = optArg(); return { t: "sq", i, x: arg() }; }
      case "left": { const o = delim(), c = seq(); let cl = ""; if (T[p] && T[p].k === "cmd" && T[p].v === "right") { p++; cl = delim(); } return { t: "lr", o, c, cl }; }
      case "begin": return env();
      case "overline": case "bar": return { t: "ov", x: arg() };
      case "underline": return { t: "un", x: arg() };
      case "vec": case "overrightarrow": return { t: "acc", g: "→", x: arg() };
      case "hat": case "widehat": return { t: "acc", g: "^", x: arg() };
      case "tilde": case "widetilde": return { t: "acc", g: "~", x: arg() };
      case "dot": return { t: "acc", g: "˙", x: arg() };
      case "ddot": return { t: "acc", g: "¨", x: arg() };
      case "mathbf": case "boldsymbol": case "bm": return { t: "sty", s: "b", x: arg() };
      case "mathit": case "mathnormal": return { t: "sty", s: "i", x: arg() };
      case "mathcal": case "mathscr": case "mathfrak": return { t: "sty", s: "c", x: arg() };
      case "mathbb": return { t: "bb", x: arg() };
      case "boxed": return { t: "bx", x: arg() };
      case "cancel": case "sout": return { t: "cn", x: arg() };
      case "overset": { const a = arg(), b = arg(); return { t: "stk", top: a, x: b }; }
      case "underset": { const a = arg(), b = arg(); return { t: "stk", bot: a, x: b }; }
      case "xrightarrow": case "xlongrightarrow": case "xleftarrow": case "xrightleftharpoons": {
        const bot = optArg(), top = arg();
        return { t: "xa", top, bot, g: n === "xleftarrow" ? "←" : n === "xrightleftharpoons" ? "⇌" : "→" };
      }
      case "color": arg(); return arg();
      case "textcolor": arg(); return arg();
      case "quad": return { t: "sp", w: 1 };
      case "qquad": return { t: "sp", w: 2 };
      case "hspace": case "phantom": case "vphantom": case "hphantom": arg(); return { t: "sp", w: 0.5 };
      case "displaystyle": case "textstyle": case "scriptstyle": case "limits": case "nolimits": case "big": case "Big": case "bigg": case "Bigg":
      case "bigl": case "bigr": case "Bigl": case "Bigr": case "right": case "end": case "mathstrut": return G();
      default:
        if (n in SYM) return { t: "sy", v: SYM[n], n };
        if (FN.has(n)) return { t: "fn", v: n };
        return { t: "tx", v: n };
    }
  }
  const out = [];
  while (p < T.length) { out.push(...seq()); if (p < T.length) { if (T[p].k === "nl") out.push({ t: "sp", w: 0.6 }); p++; } }
  return out;
}

const CHEM = /^(?:[A-Z][a-z]?(?:_\{?\d+\}?|\d+)?|\((?:[A-Z][a-z]?(?:_\{?\d+\}?|\d+)?)+\)(?:_\{?\d+\}?|\d+)?)+(?:\^\{?\d*[+\-]\}?)?$/;
const texCache = new Map();
function texAst(src) {
  if (!texCache.has(src)) {
    if (texCache.size > 600) texCache.clear();
    texCache.set(src, src.length > 1 && CHEM.test(src) ? [{ t: "ce", v: src }] : parseTeX(src));
  }
  return texCache.get(src);
}

// mhchem-lite: \ce{H2O}, \ce{2H2 + O2 -> 2H2O}, \ce{SO4^2-}
function ceNodes(src) {
  const s = src.replace(/\\([a-zA-Z]+)/g, (m, a) => SYM[a] || ""), out = []; let i = 0, prev = "";
  while (i < s.length) {
    const c = s[i], rest = s.slice(i);
    let m;
    if (rest.startsWith("<=>")) { out.push(<span key={i} className="mo">⇌</span>); i += 3; prev = ""; continue; }
    if (rest.startsWith("<->")) { out.push(<span key={i} className="mo">⟷</span>); i += 3; prev = ""; continue; }
    if (rest.startsWith("->")) { out.push(<span key={i} className="mo">→</span>); i += 2; prev = ""; continue; }
    if (rest.startsWith("<-")) { out.push(<span key={i} className="mo">←</span>); i += 2; prev = ""; continue; }
    if ((m = /^\^\{?([0-9]*[+\-−]?)\}?/.exec(rest))) { out.push(<sup key={i}>{m[1].replace("-", "−")}</sup>); i += m[0].length; prev = "A"; continue; }
    if ((m = /^_\{?([^}\s]*)\}?/.exec(rest))) { out.push(<sub key={i}>{m[1]}</sub>); i += m[0].length; prev = "A"; continue; }
    if ((m = /^\((aq|s|l|g)\)/.exec(rest))) { out.push(<span key={i} className="ph">({m[1]})</span>); i += m[0].length; prev = ""; continue; }
    if ((m = /^\d+/.exec(rest))) { out.push(/[A-Za-z)\]]/.test(prev) ? <sub key={i}>{m[0]}</sub> : m[0]); i += m[0].length; prev = /[A-Za-z)\]]/.test(prev) ? "A" : "0"; continue; }
    if (c === "+" || c === "-") {
      const spaced = s[i - 1] === " ", after = s[i + 1];
      if (!spaced && /[A-Za-z)\]A0]/.test(prev) && (after === undefined || after === " " || after === ")" || after === ",")) { out.push(<sup key={i}>{c === "-" ? "−" : "+"}</sup>); prev = "A"; i++; continue; }
      out.push(<span key={i} className="mo">{c === "-" ? "−" : "+"}</span>); i++; prev = ""; continue;
    }
    if (c === " ") { i++; if (prev) prev = ""; continue; }
    out.push(c); prev = /[A-Za-z]/.test(c) ? "A" : c === ")" ? ")" : ""; i++;
  }
  return out;
}

const OPS_REL = new Set("=<>≤≥≠≈∼≃≅≡∝→←↔⇒⇐⇔⟹⟺⟶⟵⇌⇋↦∈∉∋⊂⊆⊃⊇≪≫".split(""));
const OPS_BIN = new Set("+−±∓×÷·∪∩∧∨⊕⊗∗∘".split(""));
const GREEK_LC = /[α-ωϑϕϖϱϵ]/, BB = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", P: "ℙ", H: "ℍ" };
const isOpNode = (n) => n && ((n.t === "ch" && (OPS_REL.has(n.v) || OPS_BIN.has(n.v === "-" ? "−" : n.v))) || (n.t === "sy" && (OPS_REL.has(n.v) || OPS_BIN.has(n.v))));
const body = (x) => (x && x.t === "g" ? x.c : x ? [x] : []);
const cleanRaw = (v) => v.replace(/\\([a-zA-Z]+)/g, (m, a) => SYM[a] || "").replace(/\\[,;: ]/g, " ").replace(/\\([%&_#${}])/g, "$1").replace(/[{}]/g, "");
const rawScripts = (s) => s.split(/([_^](?:\{[^}]*\}|[^\s{]))/).map((p, i) => /^[_^]/.test(p) ? (p[0] === "^" ? <sup key={i}>{p.slice(1).replace(/[{}]/g, "")}</sup> : <sub key={i}>{p.slice(1).replace(/[{}]/g, "")}</sub>) : p);
const hasTall = (ns) => ns.some((x) => x.t === "fr" || x.t === "sq" || x.t === "mx" || (x.t === "sc" && (x.b.t === "fr" || x.b.t === "sy" && x.b.big)) || x.t === "lr");

function R(ns) { return ns.map((n, i) => N(n, i, i > 0 && !isOpNode(ns[i - 1]))); }
function N(n, k, bin) {
  switch (n.t) {
    case "ch": {
      const v = n.v === "-" ? "−" : n.v === "*" ? "∗" : n.v;
      if (OPS_REL.has(v) || (OPS_BIN.has(v) && bin)) return <span key={k} className="mo">{v}</span>;
      if (/[A-Za-z]/.test(v)) return <i key={k}>{v}</i>;
      if (v === "'") return <sup key={k}>′</sup>;
      if (v === ",") return <span key={k} className="mc">,</span>;
      return v;
    }
    case "sy":
      if (OPS_REL.has(n.v) || (OPS_BIN.has(n.v) && bin)) return <span key={k} className="mo">{n.v}</span>;
      if (/^(sum|prod|int|iint|oint)$/.test(n.n)) return <span key={k} className="bg">{n.v}</span>;
      if (GREEK_LC.test(n.v)) return <i key={k}>{n.v}</i>;
      return n.v;
    case "fn": return <span key={k} className="mt fnx">{n.v}</span>;
    case "tx": {
      const st = n.c === "textbf" ? { fontWeight: 700 } : n.c === "textit" ? { fontStyle: "italic" } : undefined;
      return <span key={k} className="mt" style={st}>{rawScripts(cleanRaw(n.v))}</span>;
    }
    case "ce": return <span key={k} className="mt ce">{ceNodes(n.v)}</span>;
    case "sp": return <span key={k} style={{ display: "inline-block", width: Math.max(0, n.w) + "em" }} />;
    case "g": return <span key={k}>{R(n.c)}</span>;
    case "fr": {
      const f = <span className={"fr" + (n.bin ? " nb" : "")}><span className="nu">{R(body(n.a))}</span><span className="de">{R(body(n.b))}</span></span>;
      return n.bin ? <span key={k} className="lr tl"><span className="pn">(</span>{f}<span className="pn">)</span></span> : <span key={k}>{f}</span>;
    }
    case "sq": return (
      <span key={k} className="sq">
        {n.i && <sup className="si">{R(body(n.i))}</sup>}
        <span className="rd"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M0 60 L22 54 L48 100 L100 0" fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg></span>
        <span className="ra">{R(body(n.x))}</span>
      </span>
    );
    case "sc": {
      const b = n.b, sup = n.sup && R(body(n.sup)), sub = n.sub && R(body(n.sub));
      const lim = (b.t === "fn" && /^(lim|max|min|sup|inf)$/.test(b.v)) || (b.t === "sy" && (b.n === "sum" || b.n === "prod"));
      if (lim) return <span key={k} className="lm"><span className="ls">{sup}</span>{N(b, "b", false)}<span className="ls">{sub}</span></span>;
      const base = N(b, "b", bin);
      if (sup && sub) return <span key={k} className="ss">{base}<span className="sb"><sup>{sup}</sup><sub>{sub}</sub></span></span>;
      return <span key={k}>{base}{sup ? <sup>{sup}</sup> : <sub>{sub}</sub>}</span>;
    }
    case "lr": return <span key={k} className={"lr" + (hasTall(n.c) ? " tl" : "")}>{n.o && <span className="pn">{n.o}</span>}{R(n.c)}{n.cl && <span className="pn">{n.cl}</span>}</span>;
    case "ov": return <span key={k} className="ov">{R(body(n.x))}</span>;
    case "un": return <span key={k} className="un">{R(body(n.x))}</span>;
    case "acc": return <span key={k} className="ac"><span className="ag">{n.g}</span><span>{R(body(n.x))}</span></span>;
    case "sty": return <span key={k} className={"sty-" + n.s}>{R(body(n.x))}</span>;
    case "bb": { const c = body(n.x); return <span key={k}>{c.map((x) => (x.t === "ch" ? BB[x.v] || x.v : ""))}</span>; }
    case "bx": return <span key={k} className="bx">{R(body(n.x))}</span>;
    case "cn": return <span key={k} style={{ textDecoration: "line-through" }}>{R(body(n.x))}</span>;
    case "stk": return <span key={k} className="stk">{n.top && <small>{R(body(n.top))}</small>}<span>{R(body(n.x))}</span>{n.bot && <small>{R(body(n.bot))}</small>}</span>;
    case "xa": return (
      <span key={k} className="xa">
        <small>{R(body(n.top))}</small>
        {n.g === "⇌" ? <span className="xg">⇌</span> : <span className={"xl" + (n.g === "←" ? " lf" : "")} />}
        <small>{n.bot ? R(body(n.bot)) : null}</small>
      </span>
    );
    case "mx": {
      const cols = Math.max(1, ...n.rows.map((r) => r.length));
      const al = (ci) => (n.name === "cases" ? "left" : /align|split|gather/.test(n.name) ? (ci % 2 ? "left" : "right") : "center");
      return (
        <span key={k} className={"mxe " + n.name}>
          <span className="mxg" style={{ gridTemplateColumns: `repeat(${cols},auto)` }}>
            {n.rows.flatMap((r, ri) => r.map((c, ci) => <span key={ri + "-" + ci} className="mc2" style={{ textAlign: al(ci) }}>{R(c)}</span>))}
          </span>
        </span>
      );
    }
    default: return null;
  }
}

const Tex = memo(function Tex({ src, display }: any) {
  const ast = useMemo(() => { try { return texAst(src); } catch (e) { return null; } }, [src]);
  if (!ast) return <code className="ic">{src}</code>;
  return <span className={display ? "mx mxd" : "mx"}>{R(ast)}</span>;
});

/* ── Markdown ───────────────────────────────────────────── */
// NOTE (Expo): these are built with new RegExp(...) on purpose. Expo's Babel preset rewrites regex literals that use named groups for old Android WebViews, which strips the group names from `.source`.
const INL = new RegExp([
  new RegExp("(?<code>`[^`\\n]+`)"),
  new RegExp("(?<esc>\\\\[$%&#_{}])"),
  new RegExp("(?<math>\\$\\$[\\s\\S]+?\\$\\$|\\\\\\([\\s\\S]+?\\\\\\)|\\\\\\[[\\s\\S]+?\\\\\\]|\\$(?![\\s$])[^$\\n]*?[^\\s$\\\\]\\$(?!\\d))"),
  new RegExp("(?<bm>\\*\\*|__)(?=\\S)(?<b>[^\\n]+?)(?<=\\S)\\k<bm>"),
  new RegExp("(?<!\\*)\\*(?=[^\\s*])(?<i1>[^*\\n]+?)(?<=[^\\s*])\\*(?!\\*)"),
  new RegExp("(?<!\\w)_(?=[^\\s_])(?<i2>[^_\\n]+?)(?<=[^\\s_])_(?!\\w)"),
  new RegExp("~~(?<s>[^~\\n]+?)~~"),
  new RegExp("\\[(?<lt>[^\\]\\n]+)\\]\\((?<lu>https?:[^)\\s]+)\\)"),
  new RegExp("(?<au>https?:\\/\\/[^\\s<>()]*[^\\s<>().,;:!?'\"*_])"),
  new RegExp("\\\\(?<sy>[a-zA-Z]+)"),
].map((r) => r.source).join("|"), "g");

const texSrc = (m) => m.startsWith("$$") ? m.slice(2, -2) : m.startsWith("\\(") || m.startsWith("\\[") ? m.slice(2, -2) : m.slice(1, -1);
function inl(s, kp = "") {
  const out = []; let last = 0, n = 0;
  for (const m of s.matchAll(INL)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const g = m.groups, k = kp + n++;
    if (g.code) out.push(<code key={k} className="ic">{g.code.slice(1, -1)}</code>);
    else if (g.esc) out.push(g.esc[1]);
    else if (g.math) out.push(<Tex key={k} src={texSrc(g.math).trim()} />);
    else if (g.b) out.push(<strong key={k}>{inl(g.b, k)}</strong>);
    else if (g.i1 || g.i2) out.push(<em key={k}>{inl(g.i1 || g.i2, k)}</em>);
    else if (g.s) out.push(<del key={k}>{inl(g.s, k)}</del>);
    else if (g.lu) out.push(<a key={k} href={g.lu} target="_blank" rel="noopener noreferrer">{inl(g.lt, k)}</a>);
    else if (g.au) out.push(<a key={k} href={g.au} target="_blank" rel="noopener noreferrer">{g.au}</a>);
    else if (g.sy) out.push(SYM[g.sy] || m[0]);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const LI = /^(\s*)([-*•+]|\d+[.)])\s+(.*)$/;
const TSEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE1 = /^\s*```([\w:+#.\- ]*?)\s+(.+?)\s*```\s*$/;
const startsBlock = (l, nx?) => /^\s*```/.test(l) || /^#{1,6}\s/.test(l) || HR.test(l) || /^\s*>/.test(l) || LI.test(l) || /^\s*(\$\$|\\\[)/.test(l) || (l.includes("|") && nx !== undefined && TSEP.test(nx));
const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

function blocks(text) {
  const L = text.replace(/\r/g, "").split("\n"), out = [];
  let i = 0;
  while (i < L.length) {
    const l = L[i];
    if (!l.trim()) { i++; continue; }
    let m = FENCE1.exec(l);
    if (m) { out.push({ t: "code", lang: m[1].trim(), v: m[2] }); i++; continue; }
    if ((m = /^\s*```\s*([\w:+#.\-]*)/.exec(l))) {
      const rest = l.replace(/^\s*```\s*[\w:+#.\-]*/, ""), buf = rest.trim() ? [rest.trim()] : [];
      i++; while (i < L.length && !/^\s*```/.test(L[i])) buf.push(L[i++]);
      i++; out.push({ t: "code", lang: m[1], v: buf.join("\n") }); continue;
    }
    if (/^\s*(\$\$|\\\[)/.test(l)) {
      const close = /^\s*\$\$/.test(l) ? "$$" : "\\]";
      let buf = l.trim().slice(2);
      if (buf.includes(close)) buf = buf.slice(0, buf.indexOf(close));
      else { i++; while (i < L.length && !L[i].includes(close)) buf += "\n" + L[i++]; if (i < L.length) buf += "\n" + L[i].slice(0, L[i].indexOf(close)); }
      i++; out.push({ t: "math", v: buf.trim() }); continue;
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { out.push({ t: "h", n: m[1].length, v: m[2].replace(/\s#+\s*$/, "") }); i++; continue; }
    if (HR.test(l)) { out.push({ t: "hr" }); i++; continue; }
    if (/^\s*>/.test(l)) { const q = []; while (i < L.length && /^\s*>/.test(L[i])) q.push(L[i++].replace(/^\s*>\s?/, "")); out.push({ t: "q", c: blocks(q.join("\n")) }); continue; }
    if (l.includes("|") && i + 1 < L.length && TSEP.test(L[i + 1])) {
      const head = cells(l), al = cells(L[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : "left")), rows = [];
      i += 2; while (i < L.length && L[i].includes("|") && L[i].trim()) rows.push(cells(L[i++]));
      out.push({ t: "table", head, al, rows }); continue;
    }
    if (LI.test(l)) {
      const items = [];
      while (i < L.length) {
        const mm = LI.exec(L[i]);
        if (mm) { items.push({ ind: mm[1].replace(/\t/g, "  ").length, ord: /\d/.test(mm[2]), n: parseInt(mm[2], 10), text: mm[3] }); i++; continue; }
        if (!L[i].trim()) { let j = i; while (j < L.length && !L[j].trim()) j++; if (j < L.length && LI.test(L[j])) { i = j; continue; } break; }
        if (/^\s{2,}\S/.test(L[i]) && items.length && !startsBlock(L[i])) { items[items.length - 1].text += "\n" + L[i].trim(); i++; continue; }
        break;
      }
      out.push({ t: "list", tree: listTree(items) }); continue;
    }
    const buf = [];
    while (i < L.length && L[i].trim() && (!buf.length || !startsBlock(L[i], L[i + 1]))) buf.push(L[i++]);
    if (!buf.length) { buf.push(L[i++]); }
    out.push({ t: "p", v: buf });
  }
  return out;
}

function listTree(items) {
  const root = { ord: items[0].ord, start: items[0].n, kids: [] }, st = [{ ind: items[0].ind, list: root }];
  for (const it of items) {
    let top = st[st.length - 1];
    if (it.ind > top.ind + 0 && top.list.kids.length) {
      const last = top.list.kids[top.list.kids.length - 1], sub = { ord: it.ord, start: it.n, kids: [] };
      last.subs.push(sub); st.push({ ind: it.ind, list: sub }); top = st[st.length - 1];
    } else while (st.length > 1 && it.ind < top.ind) { st.pop(); top = st[st.length - 1]; }
    top.list.kids.push({ text: it.text, subs: [] });
  }
  return root;
}
const ListView = ({ l }: any) => {
  const Tg = l.ord ? "ol" : "ul";
  return (
    <Tg start={l.ord && l.start > 1 ? l.start : undefined}>
      {l.kids.map((it, i) => (
        <li key={i}>{it.text.split("\n").map((t, j) => <span key={j}>{j > 0 && <br />}{inl(t, `${i}.${j}.`)}</span>)}{it.subs.map((s, j) => <ListView key={j} l={s} />)}</li>
      ))}
    </Tg>
  );
};

function CopyBtn({ text }: any) {
  const [ok, setOk] = useState<any>(false);
  return (
    <button className="cpy" aria-label="Copy code" onClick={() => { try { navigator.clipboard?.writeText(text); } catch (e) {} setOk(true); setTimeout(() => setOk(false), 1400); }}>
      {ok ? <Check size={13} {...ico} /> : <Copy size={13} {...ico} />}{ok ? "Copied" : "Copy"}
    </button>
  );
}

function B({ b }: any) {
  switch (b.t) {
    case "code": {
      const u = /^ui[:\-_ ]?(\w+)/i.exec(b.lang || "");
      if (u) return <Safe><UiBlock kind={u[1]} raw={b.v} /></Safe>;
      return <CodeBlock lang={b.lang} v={b.v} />;
    }
    case "math": return <Tex src={b.v} display />;
    case "h": return <div className={"hd h" + Math.min(b.n, 3)}>{inl(b.v)}</div>;
    case "hr": return <div className="hr" />;
    case "q": return <blockquote>{b.c.map((x, i) => <B key={i} b={x} />)}</blockquote>;
    case "list": return <ListView l={b.tree} />;
    case "table": return (
      <div className="tbl"><table>
        <thead><tr>{b.head.map((c, i) => <th key={i} style={{ textAlign: b.al[i] }}>{inl(c, "h" + i)}</th>)}</tr></thead>
        <tbody>{b.rows.map((r, ri) => <tr key={ri}>{b.head.map((_, i) => <td key={i} style={{ textAlign: b.al[i] }}>{inl(r[i] || "", `${ri}.${i}.`)}</td>)}</tr>)}</tbody>
      </table></div>
    );
    default: return <p>{b.v.map((l, i) => <span key={i}>{i > 0 && <br />}{inl(l, i + ".")}</span>)}</p>;
  }
}
const fixCards = (t) => (typeof t === "string" && /\bui[:\-_ ]\w+\s*[{[]/i.test(t) ? t.replace(/^(.*?)`{0,3}\bui[:\-_ ](\w+)\s*([{[].*[}\]])\s*`{0,3}\s*$/gim, (m, pre, k, j) => (pre.trim() ? pre.trim() + "\n\n" : "") + "```ui:" + k + "\n" + j + "\n```") : t);
const Md = memo(function Md({ text }: any) {
  const bl = useMemo(() => blocks(fixCards(text)), [text]);
  return <>{bl.map((b, i) => <B key={i} b={b} />)}</>;
});

// Reveal text token by token so formulas, bold spans and cards appear whole.
const TOK = /```ui[\s\S]*?```|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$|\*\*[^\n]+?\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|\s+|\S+/g;
const tokEnds = (t) => { const e = []; let n = 0; for (const m of t.matchAll(TOK)) { n = m.index + m[0].length; e.push(n); } return e; };
const REDUCED = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function Typer({ m, onDone, prog }: any) {
  const active = m.state === "type";
  const ends = useMemo(() => (active ? tokEnds(m.text) : null), [m.id, active]); // eslint-disable-line
  const [n, setN] = useState<any>(1);
  useEffect(() => {
    if (!active) return;
    if (REDUCED || !ends.length) { onDone(m.id); return; }
    const t0 = performance.now(), cps = Math.max(220, m.text.length / 3.2);
    let raf, last = 0;
    const tick = (now) => {
      const chars = ((now - t0) / 1000) * cps;
      let lo = 0, hi = ends.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (ends[mid] <= chars) lo = mid + 1; else hi = mid; }
      const k = Math.max(1, lo);
      if (k !== last) { last = k; setN(k); prog.current[m.id] = ends[k - 1]; }
      if (lo >= ends.length) { onDone(m.id); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]); // eslint-disable-line
  return <Md text={active ? m.text.slice(0, ends[Math.min(n, ends.length) - 1] || 0) : m.text} />;
}

/* ── Generative UI cards ────────────────────────────────── */
const ico = { strokeWidth: 2.3 };
const Rich = ({ t }: any) => <>{inl(String(t ?? ""))}</>;
class Safe extends Component<any, any> {
  state = { e: 0 };
  static getDerivedStateFromError() { return { e: 1 }; }
  render() { return this.state.e ? <div className="kc pane"><div className="kerr">Couldn't show this card.</div></div> : this.props.children; }
}
// Models often write LaTeX inside JSON with single backslashes (\frac, \theta, \alpha); repair them before parsing.
const texFix = (s) => s.replace(/(?<!\\)\\(?=(?:frac|dfrac|tfrac|text\w*|times|theta|tau|tan|tilde|triangle|therefore|to|beta|bar|begin|binom|boxed|bullet|because|bm|bf|neq?|nu|nabla|notin|ni|neg|rho|right\w*|rangle|rbrace|rceil|rfloor|forall)\b)/g, "\\\\").replace(/\\(["\\/bfnrt]|u[0-9a-fA-F]{4})|\\/g, (m, ok) => (ok ? m : "\\\\"));
const parseJSON = (s) => {
  const t = texFix(s);
  try { return JSON.parse(t); } catch (e) {
    try { return JSON.parse(t.replace(/[\u201c\u201d]/g, '"').replace(/,\s*([}\]])/g, "$1")); } catch (e2) { return null; }
  }
};
const http = (u) => { const s = String(u || "").trim(); return /^https?:\/\//i.test(s) ? s : s ? "https://" + s.replace(/^\/+/, "") : ""; };
const enc = encodeURIComponent;

const Frame = ({ I, title, sub, children }: any) => (
  <div className="kc pane">
    <div className="kh"><span className="chip"><I size={15} {...ico} /></span><b>{typeof title === "string" ? <Rich t={title} /> : title}</b>{sub && <span>{sub}</span>}</div>
    {children}
  </div>
);
const Loading = () => <div className="skl" />;
const Err = ({ msg, retry }: any) => (
  <div className="kerr"><span>{msg}</span>{retry && <button className="tg" onClick={retry}><RefreshCw size={14} {...ico} />Retry</button>}</div>
);

function WeatherCard({ d }: any) {
  const f = /^f/i.test(d.units || ""), loc = String(d.location || "").trim();
  const [s, retry] = useFetch(() => (loc ? fetchWeather(loc, f) : Promise.reject(new Error("No location given"))), [loc, f]);
  let body;
  if (s.st === "load") body = <Loading />;
  else if (s.st === "err") body = <Err msg={s.e?.message || "Couldn't load the weather."} retry={retry} />;
  else {
    const { p, w } = s.v, c = w.current, dl = w.daily, cur = wx(c.weather_code, c.is_day);
    const lo = Math.min(...dl.temperature_2m_min), hi = Math.max(...dl.temperature_2m_max), span = hi - lo || 1, u = "°";
    body = (
      <div className="wx">
        <div className="wxt">
          <div><div className="wxn">{p.name}</div><div className="wxs">{[p.admin1, p.country].filter(Boolean).join(", ")}</div><div className="wxd">{Math.round(c.temperature_2m)}{u}</div></div>
          <div className="wxi"><cur.I size={62} strokeWidth={1.4} /><span>{cur.label}</span></div>
        </div>
        <div className="wxg">
          <div className="st"><Thermometer size={15} {...ico} />Feels<b>{Math.round(c.apparent_temperature)}{u}</b></div>
          <div className="st"><Droplets size={15} {...ico} />Humidity<b>{Math.round(c.relative_humidity_2m)}%</b></div>
          <div className="st"><Wind size={15} {...ico} />Wind<b>{Math.round(c.wind_speed_10m)} {f ? "mph" : "km/h"}</b></div>
          <div className="st"><CloudRain size={15} {...ico} />Rain<b>{dl.precipitation_probability_max?.[0] ?? 0}%</b></div>
        </div>
        {dl.time.map((t, i) => {
          const x = wx(dl.weather_code[i]), mn = dl.temperature_2m_min[i], mx = dl.temperature_2m_max[i];
          return (
            <div className="wxr" key={t}>
              <span>{i === 0 ? "Today" : new Date(t + "T12:00").toLocaleDateString(undefined, { weekday: "short" })}</span>
              <x.I size={18} {...ico} />
              <span className="lo">{Math.round(mn)}{u}</span>
              <div className="rb"><i style={{ left: ((mn - lo) / span) * 100 + "%", width: Math.max(8, ((mx - mn) / span) * 100) + "%" }} /></div>
              <span className="hi">{Math.round(mx)}{u}</span>
            </div>
          );
        })}
      </div>
    );
  }
  return <Frame I={Cloud} title="Weather" sub="Open-Meteo">{body}</Frame>;
}

/* ── Google image search: needs a Programmable Search key + engine id (VITE_GOOGLE_CSE_KEY / VITE_GOOGLE_CSE_CX, or localStorage epique.cse / epique.cx) ── */
let ENV_CSE = "", ENV_CX = ""; try { ENV_CSE = process.env.EXPO_PUBLIC_GOOGLE_CSE_KEY || ""; ENV_CX = process.env.EXPO_PUBLIC_GOOGLE_CSE_CX || ""; } catch (e) {}
const CSE = () => { let k = "", x = ""; try { k = localStorage.getItem("epique.cse") || ""; x = localStorage.getItem("epique.cx") || ""; } catch (e) {} return [k || ENV_CSE, x || ENV_CX]; };
const fetchImagesG = (q, n) => once(`ig:${q}:${n}`, async () => {
  const [k, cx] = CSE(); if (!k || !cx) throw new Error("Google search not set up");
  const d = await getJSON(`https://www.googleapis.com/customsearch/v1?key=${k}&cx=${cx}&searchType=image&safe=active&num=${Math.min(10, n + 3)}&q=${encodeURIComponent(q)}`, 12000);
  return (d.items || []).map((x) => ({ t: x.title || q, src: x.image?.thumbnailLink || x.link, page: x.image?.contextLink || x.link })).filter((x) => x.src).slice(0, n);
});
/* ── Image search: Google first (when configured), then Wikimedia, Openverse to fill the gaps ── */
/* ── Pro image search: 5 sources in parallel, de-duplicated, relevance-ranked, load-verified ── */
const fetchWikiImgs = (q, n) => once(`iw:${q}:${n}`, async () => {
  const d = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${enc(q)}&gsrlimit=10&prop=pageimages|info&piprop=thumbnail&pithumbsize=1000&inprop=url`, 10000);
  return (Object.values(d.query?.pages || {}) as any[]).sort((a, b) => a.index - b.index).filter((p) => p.thumbnail?.source).map((p) => ({ t: p.title, src: p.thumbnail.source, page: p.fullurl, w: p.thumbnail.width, h: p.thumbnail.height, from: "Wikipedia" }));
});
const probe = (src) => new Promise((res) => { const i = new Image(), t = setTimeout(() => res(null), 7000); i.referrerPolicy = "no-referrer"; i.onload = () => { clearTimeout(t); res(i); }; i.onerror = () => { clearTimeout(t); res(null); }; i.src = src; });
const fetchImagesPro = (q, n) => once(`ip:${q}:${n}`, async () => {
  const toks = q.toLowerCase().split(/\W+/).filter((x) => x.length > 2), W = { Google: 3, Wikipedia: 2.6, Wikimedia: 1.6, Openverse: 1 };
  const jobs = [[fetchImagesG(q, n * 2), "Google"], [fetchWikiImgs(q, n), "Wikipedia"], [fetchImages1(q, n * 4), "Wikimedia"], [fetchImages2(q, n * 4), "Openverse"], [fetchImages2(q + " photo", n * 2), "Openverse"]];
  const got = await Promise.allSettled(jobs.map((j) => j[0]));
  const seen = new Set(); let all = [];
  got.forEach((g, i) => { if (g.status === "fulfilled") for (const x of g.value) { const k = (x.src || "").replace(/\/\d+px-/, "/").replace(/\?.*$/, ""); if (!x.src || seen.has(k)) continue; seen.add(k); all.push({ ...x, from: x.from || jobs[i][1] }); } });
  all = all.map((x) => { const t = (x.t || "").toLowerCase(), hit = toks.filter((k) => t.includes(k)).length;
    return { ...x, sc: (W[x.from] || 1) + hit * 1.5 + (hit === toks.length && toks.length ? 1.5 : 0) - (/\b(logo|icon|map|diagram|chart|flag|svg|scan|poster|stamp|coat of arms)\b/.test(t) ? 3 : 0) + (x.w >= 800 ? 0.6 : 0) }; })
    .sort((a, b) => b.sc - a.sc);
  const pool = all.slice(0, n * 3 + 3), ok = [];
  const probed: any[] = await Promise.all(pool.map(async (x: any) => ({ x, im: await probe(x.src) as any })));
  for (const { x, im } of probed) if (im && im.naturalWidth >= 280 && im.naturalHeight >= 200) ok.push({ ...x, w: im.naturalWidth, h: im.naturalHeight, sc: x.sc + Math.min(1, im.naturalWidth / 1600) });
  const out = ok.sort((a, b) => b.sc - a.sc).slice(0, n);
  if (!out.length) throw new Error(`No photos found for "${q}"`);
  return out;
});
const fetchImages = (q, n) => fetchImagesPro(q, n);

/* ── Music player with a queue (one shared audio element) ── */
const player = (() => {
  const a = typeof Audio !== "undefined" ? new Audio() : null, subs = new Set<any>(), st: any = { id: null, playing: false, p: 0, track: null };
  let q = [], qi = -1;
  const emit = () => subs.forEach((fn) => fn({ ...st, n: q.length, i: qi }));
  const load = (i) => { const t = q[i]; if (!t || !a) return; qi = i; st.id = t.id; st.track = t; st.p = 0; a.src = t.preview; a.play().catch(() => {}); emit(); };
  if (a) {
    a.preload = "none";
    a.ontimeupdate = () => { st.p = a.duration ? a.currentTime / a.duration : 0; emit(); };
    a.onplay = () => { st.playing = true; emit(); };
    a.onpause = () => { st.playing = false; emit(); };
    a.onended = () => { st.playing = false; st.p = 0; if (qi < q.length - 1) load(qi + 1); else emit(); };
  }
  return {
    toggle(t, list?) {
      if (!a || !t.preview) return;
      if (st.id === t.id) { if (a.paused) a.play().catch(() => {}); else a.pause(); return; }
      q = (list || [t]).filter((x) => x.preview); load(Math.max(0, q.findIndex((x) => x.id === t.id)));
    },
    next() { if (qi < q.length - 1) load(qi + 1); },
    prev() { if (a && a.currentTime > 3) a.currentTime = 0; else if (qi > 0) load(qi - 1); },
    pause() { a?.pause(); },
    duck(v) { if (a) a.volume = v; },
    stop() { if (a) { a.pause(); a.removeAttribute("src"); } st.id = null; st.track = null; st.playing = false; st.p = 0; q = []; qi = -1; emit(); },
    sub(fn) { subs.add(fn); return () => subs.delete(fn); },
    get: () => ({ ...st, n: q.length, i: qi }),
  };
})();
const usePlayer = () => { const [s, set] = useState<any>(player.get()); useEffect(() => player.sub(set) as any, []); return s; };

function MusicCard({ d }: any) {
  const [s, retry] = useFetch(() => fetchTracks(d), [JSON.stringify(d)]);
  const pl = usePlayer();
  useEffect(() => { if (d.play && s.st === "ok" && !player.get().track) player.toggle(s.v.find((t) => t.preview) || s.v[0], s.v); }, [s.st]); // eslint-disable-line
  let body;
  if (s.st === "load") body = <Loading />;
  else if (s.st === "err") body = <Err msg={s.e?.message || "Couldn't load music."} retry={retry} />;
  else body = (
    <div className="trks">
      {s.v.map((t) => {
        const on = pl.id === t.id, playing = on && pl.playing;
        return (
          <div key={t.id} className={"trk" + (on ? " on" : "")} role="button" tabIndex={0} onClick={() => player.toggle(t, s.v)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); player.toggle(t, s.v); } }}>
            <div className="art" style={{ backgroundImage: t.art ? `url(${t.art})` : undefined }}>
              {t.preview ? (playing ? <Pause size={18} fill="currentColor" {...ico} /> : <Play size={18} fill="currentColor" {...ico} />) : <Music2 size={18} {...ico} />}
            </div>
            <div className="tm"><b>{t.title}</b><span>{t.artist}{t.album ? ` · ${t.album}` : ""}</span></div>
            {playing && <span className="eq"><i /><i /><i /></span>}
            {t.url && <a className="ib sm ghost" href={t.url} target="_blank" rel="noopener noreferrer" aria-label="Open in Apple Music" onClick={(e) => e.stopPropagation()}><ExternalLink size={14} {...ico} /></a>}
            {on && <div className="pg"><i style={{ transform: `scaleX(${pl.p})` }} /></div>}
          </div>
        );
      })}
    </div>
  );
  return <Frame I={Music2} title="Music" sub="30s previews">{body}</Frame>;
}

// Now-playing bar, shown above the composer whenever something is playing.
function MiniPlayer() {
  const p = usePlayer(), t = p.track;
  if (!t) return null;
  return (
    <div className="glass mini">
      <div className="art" style={{ backgroundImage: t.art ? `url(${t.art})` : undefined }}>{!t.art && <Music2 size={16} {...ico} />}</div>
      <div className="tm"><b>{t.title}</b><span>{t.artist}</span></div>
      <button className="ib sm" aria-label="Previous" onClick={() => player.prev()}><SkipBack size={16} fill="currentColor" {...ico} /></button>
      <button className="ib sm ghost" aria-label={p.playing ? "Pause" : "Play"} onClick={() => player.toggle(t)}>{p.playing ? <Pause size={16} fill="currentColor" {...ico} /> : <Play size={16} fill="currentColor" {...ico} />}</button>
      <button className="ib sm" aria-label="Next" onClick={() => player.next()}><SkipForward size={16} fill="currentColor" {...ico} /></button>
      <button className="ib sm" aria-label="Close player" onClick={() => player.stop()}><X size={16} {...ico} /></button>
      <div className="pg"><i style={{ transform: `scaleX(${p.p})` }} /></div>
    </div>
  );
}

/* ── More widgets ───────────────────────────────────────── */
const mapsLink = (d, q) => d.origin && d.destination
  ? `https://www.google.com/maps/dir/?api=1&origin=${enc(d.origin)}&destination=${enc(d.destination)}&travelmode=${enc(d.mode || "driving")}`
  : `https://www.google.com/maps/search/?api=1&query=${enc(q)}`;
function MapCard({ d }: any) {
  const [osm, setOsm] = useState<any>(false), key = osm ? "" : getMapsKey(), q = String(d.query || d.destination || d.q || "").trim(), dir = !!(d.origin && d.destination);
  const mode = ["driving", "walking", "transit", "bicycling"].includes(d.mode) ? d.mode : "driving";
  const [s, retry] = useFetch(() => (key || !q ? Promise.resolve(null) : fetchGeo(q)), [q, key]);
  let src = "";
  if (key) src = dir
    ? `https://www.google.com/maps/embed/v1/directions?key=${enc(key)}&origin=${enc(d.origin)}&destination=${enc(d.destination)}&mode=${mode}`
    : `https://www.google.com/maps/embed/v1/${d.search ? "search" : "place"}?key=${enc(key)}&q=${enc(q)}`;
  else if (s.st === "ok" && s.v) {
    const g = s.v[0], pad = 0.012, [s0, n0, w0, e0] = g.bb;
    src = `https://www.openstreetmap.org/export/embed.html?bbox=${Math.min(w0, g.lon - pad)},${Math.min(s0, g.lat - pad)},${Math.max(e0, g.lon + pad)},${Math.max(n0, g.lat + pad)}&layer=mapnik&marker=${g.lat},${g.lon}`;
  }
  let body;
  if (!q) body = <Err msg="No place given." />;
  else if (!key && s.st === "load") body = <Loading />;
  else if (!key && s.st === "err") body = <Err msg={s.e?.message || "Couldn't find that place."} retry={retry} />;
  else body = <div className="mapf"><iframe title={q} src={src} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen /></div>;
  return (
    <Frame I={MapIcon} title={dir ? "Directions" : "Map"} sub={key ? "Google Maps" : "OpenStreetMap"}>
      {body}
      <div className="mapc">{dir ? `${d.origin} → ${d.destination}` : q}</div>
      <div className="cact">
        <a className="tg on" href={mapsLink(d, q)} target="_blank" rel="noopener noreferrer"><Navigation size={14} {...ico} />{dir ? "Start" : "Open"} in Google Maps</a>
        {key ? <button className="tg" onClick={() => setOsm(true)}>Map not loading?</button> : <button className="tg" onClick={() => window.dispatchEvent(new CustomEvent("epique:settings"))}><KeyRound size={14} {...ico} />Maps key</button>}
      </div>
    </Frame>
  );
}

function WikiCard({ d }: any) {
  const q = String(d.query || d.title || "").trim(), [more, setMore] = useState<any>(false);
  const [s, retry] = useFetch(() => (q ? fetchWiki(q) : Promise.reject(new Error("No topic given"))), [q]);
  let body;
  if (s.st === "load") body = <Loading />;
  else if (s.st === "err") body = <Err msg={s.e?.message || "Couldn't load Wikipedia."} retry={retry} />;
  else { const v = s.v; body = (
    <>
      <div className="wk">
        {v.thumb && <img src={v.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        <div><b>{v.title}</b>{v.desc && <span>{v.desc}</span>}<p className={more ? "" : "clamp"} onClick={() => setMore(!more)}>{v.text}</p></div>
      </div>
      <div className="cact"><a className="tg on" href={v.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} {...ico} />Read on Wikipedia</a></div>
    </>
  ); }
  return <Frame I={BookOpen} title="Wikipedia">{body}</Frame>;
}

function DefineCard({ d }: any) {
  const w0 = String(d.word || d.query || "").trim(), [cur, setCur] = useState<any>(w0), w = cur || w0, [cp, setCp] = useState<any>(false);
  useEffect(() => { setCur(w0); }, [w0]);
  const [s, retry] = useFetch(() => (w ? fetchDefine(w) : Promise.reject(new Error("No word given"))), [w]);
  const Chips = ({ l, t }: any) => l?.length ? <div className="dfc"><small>{t}</small>{l.map((x) => <button key={x} className="tg" onClick={() => setCur(x)}>{x}</button>)}</div> : null;
  let body;
  if (s.st === "load") body = <Loading />;
  else if (s.st === "err") body = <div><Err msg={s.e?.message || "Couldn't find that word."} retry={retry} />{s.e?.sugg?.length > 0 && <div className="dfc">{s.e.sugg.map((x) => <button key={x} className="tg on" onClick={() => setCur(x)}>{x}</button>)}</div>}</div>;
  else { const v = s.v; body = (
    <div className="df">
      <div className="dft"><b>{v.word}</b>{v.ph && <span>{v.ph}</span>}
        {v.audio ? <button className="ib sm ghost" aria-label="Hear it" onClick={() => { try { new Audio(v.audio).play(); } catch (e) {} }}><Volume2 size={15} {...ico} /></button> : <button className="ib sm ghost" aria-label="Pronounce" onClick={() => { try { speechSynthesis.speak(new SpeechSynthesisUtterance(v.word)); } catch (e) {} }}><Volume2 size={15} {...ico} /></button>}
        <button className="ib sm ghost" aria-label="Copy" onClick={() => { try { navigator.clipboard.writeText(`${v.word}: ` + v.means.map((m) => `(${m.pos}) ${m.defs[0].d}`).join(" ")); setCp(true); setTimeout(() => setCp(false), 1500); } catch (e) {} }}>{cp ? <Check size={15} {...ico} /> : <Copy size={15} {...ico} />}</button></div>
      {v.means.map((m, i) => <div key={i} className="dfm"><em>{m.pos}</em>{m.defs.map((x, j) => <p key={j}>{m.defs.length > 1 ? `${j + 1}. ` : ""}{x.d}{x.e && <q>{x.e}</q>}</p>)}</div>)}
      {v.origin && <p className="hint"><b>Origin:</b> {v.origin}</p>}
      <Chips l={v.syn} t="Synonyms" /><Chips l={v.ant} t="Antonyms" />
      <small className="hint">Source: {v.src}. Tap a word to look it up.</small>
    </div>
  ); }
  return <Frame I={BookOpen} title="Dictionary">{body}</Frame>;
}

function CurrencyCard({ d }: any) {
  const [rev, setRev] = useState<any>(false), a0 = Number(d.amount) || 1, f0 = String(d.from || "USD").toUpperCase(), t0 = String(d.to || "EUR").toUpperCase();
  const f = rev ? t0 : f0, t = rev ? f0 : t0;
  const [s, retry] = useFetch(() => fetchRate(f, t), [f, t]);
  const nf = (v, m = 2) => v.toLocaleString(undefined, { maximumFractionDigits: v < 1 ? 4 : m });
  let body;
  if (s.st === "load") body = <Loading />;
  else if (s.st === "err") body = <Err msg={s.e?.message || "Couldn't load rates."} retry={retry} />;
  else body = (
    <div className="fx">
      <div className="fxa">{nf(a0)} {f} =</div>
      <div className="fxb">{nf(a0 * s.v.rate)} <small>{t}</small></div>
      <div className="fxc"><span>1 {f} = {nf(s.v.rate, 4)} {t}</span>{s.v.date && <span>{s.v.date}</span>}</div>
    </div>
  );
  return (
    <Frame I={Coins} title="Currency" sub="Live rates">
      {body}
      <div className="cact"><button className="tg" onClick={() => setRev(!rev)}><RefreshCw size={14} {...ico} />Swap</button></div>
    </Frame>
  );
}

const PAL = ["#ffffff", "#8ecbff", "#ff9ac1", "#9ee6b0", "#ffd28a", "#c8b6ff"];
const fmtN = (v) => { const a = Math.abs(v); return a >= 1e9 ? +(v / 1e9).toFixed(1) + "B" : a >= 1e6 ? +(v / 1e6).toFixed(1) + "M" : a >= 1e4 ? +(v / 1e3).toFixed(1) + "k" : String(+v.toFixed(2)); };
function ChartCard({ d }: any) {
  const labels = (Array.isArray(d.labels) ? d.labels : []).map(String).slice(0, 14);
  const series = (Array.isArray(d.series) ? d.series : []).map((s) => ({ name: String(s?.name || ""), values: (s?.values || []).map(Number).filter(Number.isFinite) })).filter((s) => s.values.length).slice(0, 4);
  const type = ["bar", "line", "pie"].includes(d.type) ? d.type : "bar", unit = d.unit ? String(d.unit) : "";
  if (!series.length || !labels.length) return <Frame I={BarChart3} title="Chart"><Err msg="No data to chart." /></Frame>;
  const W = 320, H = 176, L = 36, B = 24, T = 10, R = 8, n = Math.min(labels.length, Math.max(...series.map((s) => s.values.length)));
  const all = series.flatMap((s) => s.values), mx = Math.max(...all, 0), mn = Math.min(...all, 0), span = mx - mn || 1;
  const x = (i) => L + ((i + 0.5) / n) * (W - L - R), y = (v) => T + (1 - (v - mn) / span) * (H - T - B), ticks = [0, 1, 2, 3].map((k) => mn + (span * k) / 3);
  let svg;
  if (type === "pie") {
    const vals = series[0].values.slice(0, n).map((v) => Math.max(0, v)), tot = vals.reduce((a, b) => a + b, 0) || 1;
    let ang = -Math.PI / 2;
    svg = (
      <svg viewBox="0 0 320 150" className="chs">
        {vals.map((v, i) => {
          const a2 = ang + (v / tot) * Math.PI * 2, big = a2 - ang > Math.PI ? 1 : 0, c = (t) => [75 + 62 * Math.cos(t), 75 + 62 * Math.sin(t)], [x1, y1] = c(ang), [x2, y2] = c(a2); ang = a2;
          return v / tot > 0.999 ? <circle key={i} cx="75" cy="75" r="62" fill={PAL[i % 6]} /> : <path key={i} className="slc" style={{ animationDelay: `${i * 70}ms` }} d={`M75 75L${x1} ${y1}A62 62 0 ${big} 1 ${x2} ${y2}Z`} fill={PAL[i % 6]} stroke="#0a0a0a" strokeWidth="1.5" />;
        })}
        <circle cx="75" cy="75" r="30" fill="#0e0e0e" />
        {vals.slice(0, 7).map((v, i) => <g key={i} transform={`translate(160 ${14 + i * 19})`}><rect width="10" height="10" rx="3" fill={PAL[i % 6]} /><text x="16" y="9" className="chl">{labels[i].slice(0, 16)} · {Math.round((v / tot) * 100)}%</text></g>)}
      </svg>
    );
  } else {
    const bw = (((W - L - R) / n) * 0.72) / series.length;
    svg = (
      <svg viewBox={`0 0 ${W} ${H}`} className="chs">
        {ticks.map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="chg" /><text x={L - 5} y={y(t) + 3} textAnchor="end" className="chl">{fmtN(t)}</text></g>)}
        {labels.slice(0, n).map((l, i) => (n <= 8 || i % 2 === 0) && <text key={i} x={x(i)} y={H - 7} textAnchor="middle" className="chl">{l.slice(0, 7)}</text>)}
        {series.map((s, k) => type === "bar"
          ? s.values.slice(0, n).map((v, i) => <rect key={`${k}-${i}`} className="bar" style={{ animationDelay: `${i * 35}ms` }} x={x(i) - (bw * series.length) / 2 + k * bw} y={Math.min(y(v), y(0))} width={Math.max(2, bw - 1.5)} height={Math.max(1, Math.abs(y(v) - y(0)))} rx="2.5" fill={PAL[k]} />)
          : <g key={k} className="lnx"><polyline fill="none" stroke={PAL[k]} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" points={s.values.slice(0, n).map((v, i) => `${x(i)},${y(v)}`).join(" ")} />{s.values.slice(0, n).map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="2.8" fill={PAL[k]} />)}</g>)}
      </svg>
    );
  }
  return (
    <Frame I={BarChart3} title={d.title || "Chart"} sub={unit}>
      <div className="chw">{svg}</div>
      {type !== "pie" && series.length > 1 && <div className="tags chk">{series.map((s, i) => <em key={i}><i style={{ background: PAL[i] }} />{s.name || `Series ${i + 1}`}</em>)}</div>}
    </Frame>
  );
}

function QuizCard({ d }: any) {
  const qs = (Array.isArray(d.questions) ? d.questions : []).filter((x) => x && x.q && Array.isArray(x.options) && x.options.length > 1).slice(0, 8);
  const [i, setI] = useState<any>(0), [pick, setPick] = useState<any>(null), [score, setScore] = useState<any>(0);
  if (!qs.length) return <Frame I={HelpCircle} title="Quiz"><Err msg="No questions to show." /></Frame>;
  if (i >= qs.length) return (
    <Frame I={HelpCircle} title={d.title || "Quiz"}>
      <div className="qz done"><div className="qzs">{score}<small>/{qs.length}</small></div><p>{score === qs.length ? "Perfect score." : score >= qs.length / 2 ? "Solid. Review the ones you missed." : "Keep going. Ask me to explain any answer."}</p>
        <button className="tg on" onClick={() => { setI(0); setPick(null); setScore(0); }}><RefreshCw size={14} {...ico} />Try again</button></div>
    </Frame>
  );
  const q = qs[i], ans = Math.max(0, Math.min(q.options.length - 1, parseInt(q.answer, 10) || 0));
  return (
    <Frame I={HelpCircle} title={d.title || "Quiz"} sub={`${i + 1} of ${qs.length}`}>
      <div className="qz" key={i}>
        <p className="qq"><Rich t={q.q} /></p>
        {q.options.slice(0, 5).map((o, k) => (
          <button key={k} className={"qo" + (pick != null ? (k === ans ? " ok" : k === pick ? " no" : " dim") : "")} disabled={pick != null} onClick={() => { setPick(k); if (k === ans) setScore((s) => s + 1); }}>
            <span><Rich t={o} /></span>{pick != null && k === ans && <Check size={16} {...ico} />}{pick === k && k !== ans && <X size={16} {...ico} />}
          </button>
        ))}
        {pick != null && <>{q.why && <p className="qw"><Rich t={q.why} /></p>}<button className="tg on" onClick={() => { setI(i + 1); setPick(null); }}>{i + 1 < qs.length ? "Next" : "See score"}</button></>}
      </div>
    </Frame>
  );
}

const beep = () => { try { const c = new (window.AudioContext || (window as any).webkitAudioContext)(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.18, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 1.2); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 1.2); setTimeout(() => c.close?.(), 1500); } catch (e) {} try { navigator.vibrate?.([200, 100, 200]); } catch (e) {} };
function TimerCard({ d }: any) {
  const total = Math.max(1, Math.min(86400, parseInt(d.seconds, 10) || (parseInt(d.minutes, 10) || 5) * 60));
  const [left, setLeft] = useState<any>(total), [run, setRun] = useState<any>(false), end = useRef<any>(0);
  useEffect(() => {
    if (!run) return;
    const t = setInterval(() => { const l = Math.max(0, Math.ceil((end.current - Date.now()) / 1000)); setLeft(l); if (!l) { setRun(false); beep(); } }, 250);
    return () => clearInterval(t);
  }, [run]);
  const go = () => { if (run) { setRun(false); return; } if (!left) setLeft(total); end.current = Date.now() + (left || total) * 1000; setRun(true); };
  const m = Math.floor(left / 3600) ? `${Math.floor(left / 3600)}:${String(Math.floor((left % 3600) / 60)).padStart(2, "0")}` : String(Math.floor(left / 60)), ss = String(left % 60).padStart(2, "0"), C = 2 * Math.PI * 52;
  return (
    <Frame I={TimerIcon} title={d.label || "Timer"}>
      <div className="tmr">
        <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" className="tr0" /><circle cx="60" cy="60" r="52" className="tr1" strokeDasharray={C} strokeDashoffset={C * (1 - left / total)} /></svg>
        <div className="tmt">{m}:{ss}</div>
      </div>
      <div className="cact" style={{ justifyContent: "center" }}>
        <button className="tg on" onClick={go}>{run ? <Pause size={14} {...ico} /> : <Play size={14} {...ico} />}{run ? "Pause" : left === 0 || left === total ? "Start" : "Resume"}</button>
        <button className="tg" onClick={() => { setRun(false); setLeft(total); }}><RefreshCw size={14} {...ico} />Reset</button>
        <button className="tg" onClick={() => { end.current += 60000; setLeft((l) => l + 60); }}>+1 min</button>
      </div>
    </Frame>
  );
}

function ClockCard({ d }: any) {
  const zones = (Array.isArray(d.zones) ? d.zones : d.zone ? [d.zone] : []).slice(0, 6), [, tick] = useState<any>(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 15000); return () => clearInterval(t); }, []);
  const rows = zones.map((z) => { try { const now = new Date(), f = (o) => new Intl.DateTimeFormat("en-GB", { timeZone: z, ...o }).format(now), day = (x) => new Date(new Intl.DateTimeFormat("en-CA", { timeZone: x }).format(now)).getTime(); const dd = Math.round((day(z) - day(Intl.DateTimeFormat().resolvedOptions().timeZone)) / 864e5); return { z, t: f({ hour: "2-digit", minute: "2-digit" }), w: f({ weekday: "short" }), dd }; } catch (e) { return null; } }).filter(Boolean);
  if (!rows.length) return <Frame I={Clock} title="World clock"><Err msg="No valid time zones." /></Frame>;
  return (
    <Frame I={Clock} title="World clock">
      <div className="clk">{rows.map((r) => <div key={r.z} className="clr"><span>{r.z.split("/").pop().replace(/_/g, " ")}<small>{r.w}{r.dd ? ` · ${r.dd > 0 ? "+" : ""}${r.dd}d` : " · today"}</small></span><b>{r.t}</b></div>)}</div>
    </Frame>
  );
}

const trIcon = (n) => TOOLS[n]?.I || Wrench;
const Trace = ({ list }: any) => !list?.length ? null : (
  <div className="trace">{list.map((t) => { const I = trIcon(t.name); return <span key={t.id} className={"trc " + t.state}><I size={12} {...ico} />{t.label}</span>; })}</div>
);

// Overlays render at the app root so chat bubbles (which create stacking contexts) can't trap them under the header or composer.
function Portal({ children }: any) {
  const r = useRef<any>(undefined), [h, setH] = useState<any>(null);
  useEffect(() => { setH(r.current?.closest(".aura") || null); }, []);
  return <><span ref={r} style={{ display: "none" }} />{h && createPortal(children, h)}</>;
}

/* ── Code: dependency-free syntax highlighting + canvas ──── */
const KW = {
  js: "const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of this super null undefined true false yield static get set void delete",
  py: "def class return if elif else for while in not and or is import from as with try except finally raise lambda None True False pass break continue yield global nonlocal async await del assert self",
  sh: "if then else elif fi for while do done case esac function in echo cd ls export source sudo apt npm npx pnpm yarn pip python node git cat grep sed curl wget rm mv cp mkdir chmod exit return",
  c: "if else for while do switch case break continue return new class struct enum interface impl trait fn func def let var val const static public private protected void int long short float double char bool boolean string str null nil None true false this self super import package use using namespace extends implements async await try catch finally throw throws go defer chan type mut pub mod match where as in is typeof sizeof",
  sql: "select from where group by order having join left right inner outer full on as and or not null is in like between insert into values update set delete create table alter drop index primary key foreign references distinct limit offset union all case when then else end count sum avg min max with",
  json: "true false null", css: "",
};
const FSPEC = {
  js: { c: [/\/\/[^\n]*/, /\/\*[\s\S]*?\*\//], s: [/`(?:\\.|[^`\\])*`/, /"(?:\\.|[^"\\\n])*"/, /'(?:\\.|[^'\\\n])*'/] },
  c: { c: [/\/\/[^\n]*/, /\/\*[\s\S]*?\*\//], s: [/"(?:\\.|[^"\\\n])*"/, /'(?:\\.|[^'\\\n])*'/] },
  py: { c: [/#[^\n]*/], s: [/"""[\s\S]*?"""|'''[\s\S]*?'''/, /[rbfRBF]{0,2}"(?:\\.|[^"\\\n])*"/, /[rbfRBF]{0,2}'(?:\\.|[^'\\\n])*'/] },
  sh: { c: [/#[^\n]*/], s: [/"(?:\\.|[^"\\])*"/, /'[^']*'/] },
  sql: { c: [/--[^\n]*/, /\/\*[\s\S]*?\*\//], s: [/'(?:''|[^'])*'/, /"[^"\n]*"/] },
  json: { c: [], s: [/"(?:\\.|[^"\\\n])*"/], key: true },
  css: { c: [/\/\*[\s\S]*?\*\//], s: [/"(?:\\.|[^"\\\n])*"/, /'(?:\\.|[^'\\\n])*'/], css: true },
};
const FAM = { js: "js", jsx: "js", ts: "js", tsx: "js", javascript: "js", typescript: "js", mjs: "js", node: "js", json: "json", jsonc: "json", py: "py", python: "py", sh: "sh", bash: "sh", shell: "sh", zsh: "sh", console: "sh", termux: "sh", html: "ml", xml: "ml", svg: "ml", vue: "ml", css: "css", scss: "css", sql: "sql", c: "c", cpp: "c", "c++": "c", h: "c", java: "c", cs: "c", csharp: "c", go: "c", golang: "c", rust: "c", rs: "c", kotlin: "c", kt: "c", swift: "c", php: "c", dart: "c", scala: "c" };
const hlRe = {};
const hlReg = (f) => hlRe[f] || (hlRe[f] = (() => {
  const sp = FSPEC[f], parts = [];
  if (sp.key) parts.push(`(?<k>${sp.s[0].source}(?=\\s*:))`);
  if (sp.c.length) parts.push(`(?<c>${sp.c.map((r) => r.source).join("|")})`);
  parts.push(`(?<s>${sp.s.map((r) => r.source).join("|")})`);
  parts.push(sp.css ? "(?<n>#[\\da-f]{3,8}\\b|-?\\d[\\d.]*(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?)|(?<a>@[\\w-]+)|(?<i>[A-Za-z_-][\\w-]*)" : "(?<n>\\b(?:0x[\\da-f]+|\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?)\\b)|(?<i>[A-Za-z_$][\\w$]*)");
  return new RegExp(parts.join("|"), f === "sql" ? "gi" : "g");
})());
const R_ML = /(?<c><!--[\s\S]*?-->)|(?<t><\/?[A-Za-z][\w:.-]*)|(?<a>[\w:@.-]+)(?==)|(?<s>"[^"]*"|'[^']*')|(?<p>\/?>)/g;
const kwSets = {};
const guessLang = (c) => { const t = c.trimStart(); return /^</.test(t) ? "ml" : /^[{[]/.test(t) ? "json" : /^(def |import |from |print\()/m.test(t) ? "py" : /(=>|\bconst |\bfunction\b|\blet )/.test(t) ? "js" : /^(\$ |npm |git |cd |pkg )/m.test(t) ? "sh" : null; };
const famOf = (lang, code) => FAM[String(lang || "").toLowerCase().replace(/^language-/, "")] || guessLang(code);
const hlCache = new Map();
function hl(code, lang) {
  const f = famOf(lang, code);
  if (!f || code.length > 12000) return code;
  const key = f + "\0" + code;
  if (hlCache.has(key)) return hlCache.get(key);
  const out = []; let last = 0, n = 0;
  const put = (cls, s) => out.push(<span key={n++} className={cls}>{s}</span>);
  const kws = f === "ml" ? null : kwSets[f] || (kwSets[f] = new Set(KW[f].split(" ")));
  for (const m of code.matchAll(f === "ml" ? R_ML : hlReg(f))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const g = m.groups, s = m[0];
    if (g.c) put("tk-c", s);
    else if (g.k) put("tk-f", s);
    else if (g.s) put("tk-s", s);
    else if (g.n) put("tk-n", s);
    else if (g.t) put("tk-k", s);
    else if (g.a) put(f === "ml" ? "tk-f" : "tk-k", s);
    else if (g.p) put("tk-p", s);
    else if (g.i) {
      const w = f === "sql" ? s.toLowerCase() : s, after = code.slice(m.index + s.length, m.index + s.length + 24);
      if (kws.has(w)) put("tk-k", s);
      else if (f === "css") put(/^\s*:/.test(after) && !/^\s*::?\w/.test(after) ? "tk-f" : "tk-t", s);
      else if (/^[A-Z][A-Za-z0-9]*$/.test(s) && f !== "sh") put("tk-t", s);
      else if (/^\s*\(/.test(after)) put("tk-f", s);
      else out.push(s);
    }
    last = m.index + s.length;
  }
  if (last < code.length) out.push(code.slice(last));
  if (hlCache.size > 60) hlCache.clear();
  hlCache.set(key, out);
  return out;
}
const EXT = { js: "js", jsx: "jsx", ts: "ts", tsx: "tsx", javascript: "js", typescript: "ts", python: "py", py: "py", bash: "sh", sh: "sh", html: "html", svg: "svg", css: "css", json: "json", sql: "sql", java: "java", c: "c", cpp: "cpp", go: "go", rust: "rs", php: "php", markdown: "md" };
const downloadText = (name, text, type = "text/plain") => {
  const a = document.createElement("a"), url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
};
const previewDoc = (code, lang) => /svg/i.test(lang) && !/<html/i.test(code)
  ? `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#fff">${code}`
  : (/<meta[^>]+viewport/i.test(code) ? "" : '<meta name="viewport" content="width=device-width,initial-scale=1">') + code;

function CodeBlock({ lang, v }: any) {
  const [wrap, setWrap] = useState<any>(false), [prev, setPrev] = useState<any>(false), [full, setFull] = useState<any>(false), [tab, setTab] = useState<any>("code"), [fz, setFz] = useState<any>(13), [ln, setLn] = useState<any>(true), [dev, setDev] = useState<any>("full"), [rk, setRk] = useState<any>(0);
  const runnable = /^(html|svg)$/i.test(lang || "") || (!lang && /^\s*<!doctype html|^\s*<html/i.test(v));
  const lines = v.split("\n").length, tokens = useMemo(() => hl(v, lang), [v, lang]);
  useEffect(() => { if (!full) return; const k = (e) => e.key === "Escape" && setFull(false); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [full]);
  const name = "snippet." + (EXT[String(lang).toLowerCase()] || (runnable ? "html" : "txt"));
  const frame = (h, w?) => <iframe key={rk} className="pvf" style={{ height: h, width: w === "phone" ? 390 : w === "tablet" ? 768 : "100%", maxWidth: "100%", borderRadius: w === "phone" || w === "tablet" ? 14 : 0 }} title="Preview" sandbox="allow-scripts allow-forms allow-modals allow-popups" srcDoc={previewDoc(v, lang || "html")} />;
  const openTab = () => { try { window.open(URL.createObjectURL(new Blob([previewDoc(v, lang || "html")], { type: "text/html" })), "_blank", "noopener"); } catch (e) {} };
  return (
    <div className="cb">
      <div className="cbh">
        <span>{lang || "code"}<i>{lines} {lines === 1 ? "line" : "lines"}</i></span>
        <div className="cbt">
          {runnable && <button className={"cpy" + (prev ? " on" : "")} onClick={() => setPrev(!prev)}><Eye size={13} {...ico} />Preview</button>}
          <button className="cpy" aria-label="Wrap lines" onClick={() => setWrap(!wrap)}><WrapText size={13} {...ico} /></button>
          <CopyBtn text={v} />
          <button className="cpy" aria-label="Open canvas" onClick={() => { setTab(runnable ? "view" : "code"); setFull(true); }}><Maximize2 size={13} {...ico} /></button>
        </div>
      </div>
      {prev && frame(300)}
      <pre className={wrap ? "wr" : ""}><code>{tokens}</code></pre>
      {full && (
        <Portal><div className="cvs" role="dialog" aria-label="Code canvas">
          <div className="cvh">
            <b>{lang || "code"}</b>
            {runnable && <div className="cvt"><button className={tab === "code" ? "on" : ""} onClick={() => setTab("code")}>Code</button><button className={tab === "view" ? "on" : ""} onClick={() => setTab("view")}>Preview</button></div>}
            <span style={{ flex: 1 }} />
            {tab === "view" ? (<>
              <div className="cvt">{[["phone", "Phone"], ["tablet", "Tablet"], ["full", "Full"]].map(([k, n]) => <button key={k} className={dev === k ? "on" : ""} onClick={() => setDev(k)}>{n}</button>)}</div>
              <button className="cpy" aria-label="Reload preview" onClick={() => setRk(rk + 1)}><RefreshCw size={13} {...ico} /></button>
              <button className="cpy" aria-label="Open in new tab" onClick={openTab}><ExternalLink size={13} {...ico} /></button>
            </>) : (<>
              <button className="cpy" aria-label="Smaller text" onClick={() => setFz(Math.max(10, fz - 1))}>A−</button>
              <button className="cpy" aria-label="Larger text" onClick={() => setFz(Math.min(22, fz + 1))}>A+</button>
              <button className={"cpy" + (ln ? " on" : "")} aria-label="Line numbers" onClick={() => setLn(!ln)}>#</button>
              <button className={"cpy" + (wrap ? " on" : "")} aria-label="Wrap lines" onClick={() => setWrap(!wrap)}><WrapText size={13} {...ico} /></button>
            </>)}
            <CopyBtn text={v} />
            <button className="cpy" aria-label="Download" onClick={() => downloadText(name, v)}><Download size={13} {...ico} /></button>
            <button className="ib sm ghost" aria-label="Close canvas" onClick={() => setFull(false)}><X size={16} {...ico} /></button>
          </div>
          {tab === "view" ? <div className="cvstage">{frame("100%", dev)}</div> : <pre className={"cvp" + (wrap ? " wr" : "")} style={{ fontSize: fz }}>{ln && !wrap && <span className="gut" aria-hidden="true">{Array.from({ length: lines }, (_, i) => i + 1).join("\n")}</span>}<code>{tokens}</code></pre>}
        </div></Portal>
      )}
    </div>
  );
}

function ImagesCard({ d }: any) {
  const q = String(d.query || d.q || "").trim(), n = Math.max(1, Math.min(5, parseInt(d.count, 10) || 4));
  const [s, retry] = useFetch(() => (q ? fetchImages(q, n) : Promise.reject(new Error("No search given"))), [q, n]);
  const [big, setBig] = useState<any>(null), [bad, setBad] = useState<any>({}), [ld, setLd] = useState<any>({});
  useEffect(() => {
    if (!big) return;
    const k = (e) => e.key === "Escape" && setBig(null);
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [big]);
  let body;
  if (s.st === "load") body = <Loading />;
  else if (s.st === "err") body = <Err msg={s.e?.message || "Couldn't load photos."} retry={retry} />;
  else {
    let list = s.v.filter((x) => !bad[x.src]);
    if (list.length === 4) list = list.slice(0, 4); else if (list.length > 3 && list.length % 2 === 0) list = list.slice(0, list.length - 1);
    const lay = list.length === 1 ? "l1" : list.length === 2 || list.length === 4 ? "l2" : "l3";
    body = (
      <div className={"gal " + lay}>
        {list.map((x) => (
          <figure key={x.src} onClick={() => setBig(x)}>
            <img src={x.src} alt={x.t} loading="lazy" decoding="async" referrerPolicy="no-referrer" className={ld[x.src] ? "ld" : ""}
              onLoad={() => setLd((o) => ({ ...o, [x.src]: 1 }))} onError={() => setBad((o) => ({ ...o, [x.src]: 1 }))} />
            <figcaption>{x.t}</figcaption>
          </figure>
        ))}
      </div>
    );
  }
  return (
    <Frame I={ImageIcon} title={q ? q[0].toUpperCase() + q.slice(1) : "Photos"} sub={(CSE()[0] && CSE()[1] ? "Google · " : "") + "Wikipedia · Wikimedia · Openverse"}>
      {body}
      {q && <a className="tg gl" href={`https://www.google.com/search?tbm=isch&q=${enc(q)}`} target="_blank" rel="noopener noreferrer"><Search size={14} {...ico} />More on Google Images</a>}
      {big && (
        <Portal><div className="lbx" onClick={() => setBig(null)}>
          <button className="ib glass lbx-x" aria-label="Close"><X size={20} {...ico} /></button>
          <img src={big.src} alt={big.t} referrerPolicy="no-referrer" onClick={(e) => e.stopPropagation()} />
          <div className="cact" style={{ justifyContent: "center" }} onClick={(e) => e.stopPropagation()}>
            <button className="tg" onClick={() => { const l = s.v || [], i = l.findIndex((z) => z.src === big.src); setBig(l[(i - 1 + l.length) % l.length]); }}>‹ Prev</button>
            <a className="tg" href={big.src} download target="_blank" rel="noopener noreferrer"><Download size={14} {...ico} />Save</a>
            <button className="tg" onClick={() => { const l = s.v || [], i = l.findIndex((z) => z.src === big.src); setBig(l[(i + 1) % l.length]); }}>Next ›</button>
          </div>
          {big.from && <small className="hint">via {big.from}{big.w ? ` · ${big.w}×${big.h}` : ""}</small>}
          <a className="tg on" href={big.page} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}><ExternalLink size={14} {...ico} />{big.t.length > 44 ? big.t.slice(0, 44) + "…" : big.t}</a>
        </div></Portal>
      )}
    </Frame>
  );
}

const vcf = (c) => {
  const e = (s) => String(s || "").replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");
  return ["BEGIN:VCARD", "VERSION:3.0", `FN:${e(c.name)}`, c.org && `ORG:${e(c.org)}`, c.role && `TITLE:${e(c.role)}`, c.phone && `TEL;TYPE=CELL:${c.phone}`, c.email && `EMAIL:${c.email}`, c.website && `URL:${http(c.website)}`, c.address && `ADR:;;${e(c.address)};;;;`, "END:VCARD"].filter(Boolean).join("\r\n");
};
const saveVcf = (c) => {
  const a = document.createElement("a"), url = URL.createObjectURL(new Blob([vcf(c)], { type: "text/vcard" }));
  a.href = url; a.download = (c.name || "contact").replace(/\W+/g, "_") + ".vcf";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
};

function ContactCard({ d }: any) {
  const c = { name: String(d.name || "Contact"), role: d.role, org: d.org || d.company, phone: d.phone, email: d.email, website: d.website, address: d.address };
  const [ok, setOk] = useState<any>(false);
  const tel = String(c.phone || "").replace(/[^\d+]/g, ""), mailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email || "");
  const init = c.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const rows = [
    tel && { I: Phone, v: c.phone, h: "tel:" + tel },
    mailOk && { I: Mail, v: c.email, h: "mailto:" + c.email },
    c.website && { I: Globe, v: String(c.website).replace(/^https?:\/\//, ""), h: http(c.website) },
    c.address && { I: MapPin, v: c.address, h: `https://www.google.com/maps/search/?api=1&query=${enc(c.address)}` },
  ].filter(Boolean);
  return (
    <Frame I={User} title="Contact">
      <div className="cc"><div className="av">{init || <User size={22} {...ico} />}</div><div className="cn"><b>{c.name}</b><span>{[c.role, c.org].filter(Boolean).join(" · ")}</span></div></div>
      {rows.length > 0 && <div className="cl">{rows.map((r, i) => <a key={i} className="cr2" href={r.h} target={r.h.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer"><r.I size={16} {...ico} /><span>{r.v}</span></a>)}</div>}
      <div className="cact">
        {tel && <a className="tg on" href={"tel:" + tel}><Phone size={14} {...ico} />Call</a>}
        {tel.startsWith("+") && <a className="tg" href={"https://wa.me/" + tel.replace(/\D/g, "")} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} {...ico} />WhatsApp</a>}
        {mailOk && <a className="tg" href={"mailto:" + c.email}><Mail size={14} {...ico} />Email</a>}
        <button className="tg" onClick={() => saveVcf(c)}><Download size={14} {...ico} />Save</button>
        <button className="tg" onClick={() => { try { navigator.clipboard?.writeText([c.name, c.phone, c.email].filter(Boolean).join("\n")); } catch (e) {} setOk(true); setTimeout(() => setOk(false), 1400); }}>{ok ? <Check size={14} {...ico} /> : <Copy size={14} {...ico} />}{ok ? "Copied" : "Copy"}</button>
      </div>
    </Frame>
  );
}

function PlaceCard({ d }: any) {
  const list = (Array.isArray(d.places) ? d.places : d.name ? [d] : []).filter((p) => p && p.name).slice(0, 6);
  if (!list.length) return <Frame I={MapPin} title="Places"><Err msg="No places to show." /></Frame>;
  return (
    <Frame I={MapPin} title={list.length > 1 ? "Places" : "Place"}>
      <div className="pls">
        {list.map((p, i) => (
          <div className="pl" key={i}>
            <div className="pl-t"><div><b>{p.name}</b>{p.area && <span>{p.area}</span>}</div>
              <a className="ib sm ghost" href={`https://www.google.com/maps/search/?api=1&query=${enc([p.name, p.area].filter(Boolean).join(" "))}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${p.name} in Maps`}><Navigation size={14} {...ico} /></a></div>
            {p.note && <p><Rich t={p.note} /></p>}
            {Array.isArray(p.tags) && p.tags.length > 0 && <div className="tags">{p.tags.slice(0, 4).map((t) => <em key={t}>{t}</em>)}</div>}
          </div>
        ))}
      </div>
    </Frame>
  );
}

function ItineraryCard({ d }: any) {
  const days = (Array.isArray(d.days) ? d.days : []).filter((x) => x && Array.isArray(x.items)).slice(0, 7), [a, setA] = useState<any>(0);
  if (!days.length) return <Frame I={CalendarDays} title="Itinerary"><Err msg="No plan to show." /></Frame>;
  const day = days[Math.min(a, days.length - 1)];
  return (
    <Frame I={CalendarDays} title={d.title || "Itinerary"}>
      {days.length > 1 && <div className="tabs">{days.map((x, i) => <button key={i} className={"tg" + (i === a ? " on" : "")} onClick={() => setA(i)}>{x.label || `Day ${i + 1}`}</button>)}</div>}
      <div className="tl" key={a}>
        {day.items.slice(0, 12).map((it, i) => (
          <div className="stp" key={i}>
            <time>{it.time || ""}</time><span className="dt" />
            <div><b><Rich t={it.title} /></b>{it.note && <p><Rich t={it.note} /></p>}</div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ── Agentic UI kit: sports, news, template card, productivity ── */
const agoD = (d) => { const s = (Date.now() - new Date(d).getTime()) / 1000; return !isFinite(s) || s < 0 ? "" : s < 90 ? "just now" : s < 3600 ? Math.round(s / 60) + "m ago" : s < 86400 ? Math.round(s / 3600) + "h ago" : Math.round(s / 86400) + "d ago"; };
const hsh = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const askAI = (t) => window.dispatchEvent(new CustomEvent("epique:ask", { detail: String(t) }));
const hexOk = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : "");
function usePersist(key, init) {
  const k = "epique.cs." + key, [v, setV] = useState<any>(() => LS.get(k, init));
  const set = useCallback((f) => setV((p) => { const n = typeof f === "function" ? f(p) : f; LS.set(k, n); return n; }), [k]);
  return [v, set];
}
const Bar = ({ v }: any) => <div className="pbar"><i style={{ width: Math.max(0, Math.min(100, v || 0)) + "%" }} /></div>;
const Pad = ({ children, c }: any) => <div className={"kb " + (c || "")}>{children}</div>;

/* Sports (ESPN public scoreboard, keyless) */
const LEAGUES: any[] = [
  [/concacaf.*nations/, ["soccer", "concacaf.nations.league", "CONCACAF Nations League"]], [/nations/, ["soccer", "uefa.nations", "UEFA Nations League"]],
  [/friendl/, ["soccer", "fifa.friendly", "International Friendlies"]], [/euro.*qual/, ["soccer", "uefa.euroq", "Euro Qualifying"]],
  [/conference/, ["soccer", "uefa.europa.conf", "Conference League"]], [/fa cup/, ["soccer", "eng.fa", "FA Cup"]], [/carabao|league cup/, ["soccer", "eng.league_cup", "League Cup"]],
  [/championship/, ["soccer", "eng.2", "Championship"]], [/eredivisie|dutch/, ["soccer", "ned.1", "Eredivisie"]], [/portug/, ["soccer", "por.1", "Liga Portugal"]],
  [/premier|epl|english/, ["soccer", "eng.1", "Premier League"]], [/la ?liga|spanish/, ["soccer", "esp.1", "La Liga"]],
  [/bundesliga|german/, ["soccer", "ger.1", "Bundesliga"]], [/serie ?a|italian/, ["soccer", "ita.1", "Serie A"]],
  [/ligue|french/, ["soccer", "fra.1", "Ligue 1"]], [/champions|ucl/, ["soccer", "uefa.champions", "Champions League"]],
  [/europa/, ["soccer", "uefa.europa", "Europa League"]], [/mls/, ["soccer", "usa.1", "MLS"]], [/psl|south africa/, ["soccer", "rsa.1", "PSL"]],
  [/world cup/, ["soccer", "fifa.world", "World Cup"]], [/afcon|africa/, ["soccer", "caf.nations", "AFCON"]],
  [/nfl/, ["football", "nfl", "NFL"]], [/nba/, ["basketball", "nba", "NBA"]], [/mlb/, ["baseball", "mlb", "MLB"]], [/nhl/, ["hockey", "nhl", "NHL"]],
];
const leagueOf = (q) => { const k = String(q || "").toLowerCase().trim(); if (/^[a-z]+\.[a-z0-9]+$/.test(k)) return ["soccer", k, k]; return (LEAGUES.find(([r]) => r.test(k)) || [0, ["soccer", "all", "All football"]])[1]; };
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const dayOf = (v) => { const k = String(v || "").toLowerCase().trim(), d = new Date(); d.setHours(12, 0, 0, 0); if (/^y/.test(k)) d.setDate(d.getDate() - 1); else if (/^tom/.test(k)) d.setDate(d.getDate() + 1); else { const m = k.replace(/-/g, "").match(/^(\d{4})(\d\d)(\d\d)$/); if (m) d.setFullYear(+m[1], +m[2] - 1, +m[3]); } return d; };
const tmOf = (x) => ({ n: x?.team?.shortDisplayName || x?.team?.displayName || "", ab: x?.team?.abbreviation || "", logo: x?.team?.logo || "", s: x?.score ?? "", w: !!x?.winner });
const fetchScores = (sport, code, date) => once(`sc:${sport}/${code}/${date || ""}/${Math.floor(Date.now() / 60000)}`, async () => {
  const j = await getJSON(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${code}/scoreboard${date ? "?dates=" + enc(date) : ""}`);
  return (j.events || []).map((e) => {
    const c = e.competitions?.[0], t = c?.competitors || [], h = t.find((x) => x.homeAway === "home") || t[0], a = t.find((x) => x.homeAway === "away") || t[1], st = e.status?.type || {};
    return { id: e.id, date: e.date, state: st.state, detail: st.shortDetail || st.detail || "", clock: e.status?.displayClock, h: tmOf(h), a: tmOf(a) };
  });
});
const fetchDay = (sport, code, v) => { const d = dayOf(v), a = new Date(d), b = new Date(d); a.setDate(a.getDate() - 1); b.setDate(b.getDate() + 1); return fetchScores(sport, code, `${ymd(a)}-${ymd(b)}`).then((l) => l.filter((m) => ymd(new Date(m.date)) === ymd(d))); };
const fetchTable = (code) => once(`tb:${code}:${Math.floor(Date.now() / 300000)}`, async () => {
  const j = await getJSON(`https://site.api.espn.com/apis/v2/sports/soccer/${code}/standings`), en = j.children?.[0]?.standings?.entries || [];
  if (!en.length) throw new Error("No table for this competition.");
  const sv = (e, n) => { const x = e.stats?.find((y) => y.name === n); return x ? (x.displayValue ?? x.value) : ""; };
  return en.map((e, i) => ({ n: e.team?.shortDisplayName || e.team?.displayName, logo: e.team?.logos?.[0]?.href || "", rank: +sv(e, "rank") || i + 1, gp: sv(e, "gamesPlayed"), w: sv(e, "wins"), d: sv(e, "ties"), l: sv(e, "losses"), gd: sv(e, "pointDifferential"), pts: sv(e, "points") })).sort((a, b) => a.rank - b.rank);
});
const Crest = ({ src }: any) => (src ? <img className="crest" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} /> : <span className="crest" />);
function SportsCard({ d }: any) {
  const [sport, code, name] = leagueOf(d.league), soccer = sport === "soccer", team = String(d.team || "").toLowerCase();
  const [tab, setTab] = useState<any>(d.view === "table" && soccer ? "table" : "scores");
  const [day, setDay] = useState<any>(d.date ? String(d.date) : "today");
  const [s, retry] = useFetch(() => (tab === "table" ? fetchTable(code) : fetchDay(sport, code, day)), [code, tab, day]);
  let body;
  if (s.st === "load") body = <Loading />;
  else if (s.st === "err") body = <Err msg={s.e?.message?.startsWith("No table") ? s.e.message : "Couldn't load scores right now."} retry={retry} />;
  else if (tab === "table") body = (
    <div className="sptb"><div className="sptr hd"><span>#</span><span>Team</span><span>P</span><span>W</span><span>D</span><span>L</span><span>GD</span><span>Pts</span></div>
      {s.v.map((r) => <div key={r.n} className={"sptr" + (team && r.n.toLowerCase().includes(team) ? " me" : "")}><span>{r.rank}</span><span className="tn"><Crest src={r.logo} />{r.n}</span><span>{r.gp}</span><span>{r.w}</span><span>{r.d}</span><span>{r.l}</span><span>{r.gd}</span><b>{r.pts}</b></div>)}</div>
  );
  else {
    let l = s.v; const f = team ? l.filter((m) => (m.h.n + m.a.n).toLowerCase().includes(team)) : []; if (f.length) l = f;
    l = [...l].sort((a, b) => (a.state === "in" ? 0 : 1) - (b.state === "in" ? 0 : 1));
    body = !l.length ? <div className="kerr"><span>No matches on this day.</span></div> : (
      <div className="spl">{l.slice(0, 24).map((m) => (
        <div key={m.id} className={"spm " + m.state}>
          <div className="spt"><Crest src={m.h.logo} /><span>{m.h.n}</span></div>
          <b className="sps">{m.state === "pre" ? new Date(m.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : `${m.h.s} - ${m.a.s}`}</b>
          <div className="spt r"><span>{m.a.n}</span><Crest src={m.a.logo} /></div>
          <em className="spb">{m.state === "in" ? `LIVE ${m.clock || m.detail}` : m.state === "pre" ? new Date(m.date).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }) : m.detail}</em>
        </div>))}</div>
    );
  }
  return (
    <Frame I={Trophy} title={name} sub={tab === "table" ? "Table" : "Scores"}>
      <div className="cact" style={{ paddingBottom: 4 }}>
        {["yesterday", "today", "tomorrow"].map((k) => <button key={k} className={"tg" + (tab === "scores" && day === k ? " on" : "")} onClick={() => { setTab("scores"); setDay(k); }}>{k[0].toUpperCase() + k.slice(1)}</button>)}
        {soccer && <button className={"tg" + (tab === "table" ? " on" : "")} onClick={() => setTab("table")}>Table</button>}
        <button className="tg" aria-label="Refresh" onClick={retry}><RefreshCw size={14} {...ico} /></button>
      </div>
      {body}
    </Frame>
  );
}

/* News (GDELT, then Google News RSS as fallback; both keyless) */
const fetchNews = (q, n) => once(`nw:${q}:${n}:${Math.floor(Date.now() / 600000)}`, async () => {
  const seen = new Set(), clean = (a) => a.filter((x) => x.t && x.u && !seen.has(x.t.toLowerCase()) && seen.add(x.t.toLowerCase())).slice(0, n);
  try {
    const j = await getJSON(`https://api.gdeltproject.org/api/v2/doc/doc?query=${enc(q + " sourcelang:english")}&mode=artlist&maxrecords=${n + 6}&format=json&sort=datedesc&timespan=3d`, 9000);
    const a = clean((j.articles || []).map((x) => ({ t: x.title, u: x.url, dom: x.domain, img: x.socialimage, at: (x.seendate || "").replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, "$1-$2-$3T$4:$5:$6Z") })));
    if (a.length) return a;
  } catch (e) {}
  const j = await getJSON(`https://api.rss2json.com/v1/api.json?rss_url=${enc("https://news.google.com/rss/search?q=" + enc(q) + "&hl=en-US&gl=US&ceid=US:en")}`, 10000);
  const a = clean((j.items || []).map((x) => ({ t: String(x.title || "").replace(/\s-\s[^-]+$/, ""), u: x.link, dom: (String(x.title || "").match(/\s-\s([^-]+)$/) || [])[1] || "", img: x.thumbnail || x.enclosure?.link || "", at: x.pubDate ? x.pubDate.replace(" ", "T") + "Z" : "" })));
  if (!a.length) throw new Error("No recent stories found.");
  return a;
});
function NewsCard({ d }: any) {
  const q = String(d.query || d.topic || "world").slice(0, 80), n = Math.max(2, Math.min(8, parseInt(d.count, 10) || 5));
  const [s, retry] = useFetch(() => fetchNews(q, n), [q, n]);
  let body;
  if (s.st === "load") body = <Loading />;
  else if (s.st === "err") body = <Err msg={s.e?.message || "Couldn't load the news."} retry={retry} />;
  else body = (
    <div className="nw">{s.v.map((a, i) => (
      <a key={a.u} className={"nwr" + (i === 0 && a.img ? " top" : "")} href={a.u} target="_blank" rel="noopener noreferrer">
        {a.img && <img src={a.img} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
        <div><b>{a.t}</b><span>{[a.dom, agoD(a.at)].filter(Boolean).join(" · ")}</span></div>
      </a>))}</div>
  );
  return <Frame I={Newspaper} title={q === "world" ? "Top stories" : q} sub="News">{body}</Frame>;
}

/* Template card: the model composes its own layout from sections */
const ICONS = { sparkles: Sparkles, star: Sparkles, trophy: Trophy, news: Newspaper, check: ListChecks, bell: Bell, clock: Clock, map: MapPin, globe: Globe, chart: BarChart3, code: Code, book: BookOpen, coins: Coins, music: Music2, cloud: Cloud, link: Link2, flag: Flag, food: UtensilsCrossed, rocket: Rocket, timer: TimerIcon, wind: Wind };
const items = (s) => (Array.isArray(s.items) ? s.items.slice(0, 24) : []);
const Sec = ({ s }: any) => {
  const t = String(s.type || "text").toLowerCase();
  if (t === "text") return <p className="gtx"><Rich t={s.text || ""} /></p>;
  if (t === "stats") return <div className="gst">{items(s).slice(0, 8).map((x, i) => <div key={i}><b><Rich t={x.value ?? ""} /></b><span><Rich t={x.label || ""} /></span>{x.sub && <small><Rich t={x.sub} /></small>}</div>)}</div>;
  if (t === "kv") return <div className="gkv">{items(s).map((x, i) => <div key={i}><span><Rich t={x.k ?? x.label ?? ""} /></span><b><Rich t={x.v ?? x.value ?? ""} /></b></div>)}</div>;
  if (t === "list" || t === "steps") return <div className="gls">{items(s).map((x, i) => { const o = typeof x === "object" ? x : { title: x }; return <div key={i}><i>{t === "steps" ? i + 1 : ""}</i><div><b><Rich t={o.title ?? o.t ?? ""} /></b>{o.note && <span><Rich t={o.note} /></span>}</div></div>; })}</div>;
  if (t === "table") { const cols = Array.isArray(s.cols) ? s.cols : [], rows = Array.isArray(s.rows) ? s.rows.slice(0, 30) : []; return <div className="gtb"><table><thead><tr>{cols.map((c, i) => <th key={i}><Rich t={c} /></th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{(Array.isArray(r) ? r : [r]).map((c, j) => <td key={j}><Rich t={c ?? ""} /></td>)}</tr>)}</tbody></table></div>; }
  if (t === "progress") { const v = ((+s.value || 0) / (+s.max || 100)) * 100; return <div className="gpr"><div><span><Rich t={s.label || ""} /></span><b>{Math.round(v)}%</b></div><Bar v={v} /></div>; }
  if (t === "badges") return <div className="gbd">{items(s).map((x, i) => <span key={i}><Rich t={x} /></span>)}</div>;
  if (t === "links") return <div className="glk">{items(s).map((x, i) => <a key={i} href={http(x.url)} target="_blank" rel="noopener noreferrer"><Link2 size={14} {...ico} /><Rich t={x.title || x.url} /></a>)}</div>;
  if (t === "image" && s.url) return <figure className="gim"><img src={http(s.url)} alt={String(s.caption || "")} loading="lazy" referrerPolicy="no-referrer" onError={(e) => { (e.currentTarget.parentNode as any).style.display = "none"; }} />{s.caption && <figcaption><Rich t={s.caption} /></figcaption>}</figure>;
  if (t === "quote") return <blockquote className="gq"><Rich t={s.text || ""} />{s.by && <cite><Rich t={s.by} /></cite>}</blockquote>;
  if (t === "buttons") return <div className="cact" style={{ padding: 0 }}>{items(s).map((x, i) => x.url ? <a key={i} className="tg" href={http(x.url)} target="_blank" rel="noopener noreferrer"><Rich t={x.label} /></a> : <button key={i} className="tg" onClick={() => askAI(x.ask || x.label)}><Rich t={x.label} /></button>)}</div>;
  if (t === "divider") return <hr className="gdv" />;
  return null;
};
function GenericCard({ d }: any) {
  const secs = (Array.isArray(d.sections) ? d.sections : []).slice(0, 10), ac = hexOk(d.accent);
  return (
    <div style={ac ? ({ "--ka": ac } as any) : undefined}>
      <Frame I={ICONS[String(d.icon || "").toLowerCase()] || Sparkles} title={String(d.title || "Details")} sub={d.subtitle ? String(d.subtitle) : ""}>
        <Pad c="gen">{secs.map((s, i) => <Sec key={i} s={s || {}} />)}</Pad>
      </Frame>
    </div>
  );
}

/* Notes, checklists and tasks (saved on this device) */
function NotesCard({ d }: any) {
  const id = hsh("n" + (d.id || d.title || "") + String(d.text || "").slice(0, 60)), [v, set] = usePersist(id, { text: String(d.text || "") });
  return (
    <Frame I={StickyNote} title={d.title || "Note"} sub="Saved">
      <Pad><textarea className="nta" rows={Math.min(10, Math.max(3, v.text.split("\n").length + 1))} value={v.text} placeholder="Write something…" onChange={(e) => set({ text: e.target.value })} />
        <div className="cact" style={{ padding: 0 }}><CopyBtn text={v.text} /><button className="tg" onClick={() => downloadText((d.title || "note").replace(/\W+/g, "-") + ".txt", v.text)}><Download size={14} {...ico} />Save</button></div></Pad>
    </Frame>
  );
}
function ListCard({ d, tasks }: any) {
  const base = (Array.isArray(d.items) ? d.items : []).slice(0, 30).map((x) => (typeof x === "string" ? { t: x } : { t: String(x.t || x.title || x.text || ""), done: !!x.done, due: x.due, pri: x.priority || x.pri }));
  const id = hsh((tasks ? "t" : "c") + (d.title || "") + base.map((x) => x.t).join("|")), [v, set] = usePersist(id, { items: base.map((x) => ({ ...x, id: rid() })) });
  const [nw, setNw] = useState<any>(""), list = v.items || [], done = list.filter((x) => x.done).length, pct = list.length ? Math.round((done / list.length) * 100) : 0, rank = { high: 0, med: 1, medium: 1, low: 2 };
  const up = (fn) => set((p) => ({ ...p, items: fn(p.items || []) }));
  const add = () => { const t = nw.trim(); if (!t) return; up((l) => [...l, { id: rid(), t: t.slice(0, 160) }]); setNw(""); };
  const shown = tasks ? [...list].sort((a, b) => (+!!a.done - +!!b.done) || ((rank[a.pri] ?? 3) - (rank[b.pri] ?? 3))) : list;
  return (
    <Frame I={tasks ? ListChecks : Check} title={d.title || (tasks ? "Tasks" : "Checklist")} sub={`${done}/${list.length}`}>
      <Pad>
        <Bar v={pct} />
        <div className="tks">{shown.map((x) => (
          <div key={x.id} className={"tk" + (x.done ? " done" : "")}>
            <button className="ck" aria-label="Toggle" onClick={() => up((l) => l.map((y) => (y.id === x.id ? { ...y, done: !y.done } : y)))}>{x.done && <Check size={13} {...ico} />}</button>
            <span><Rich t={x.t} /></span>{x.pri && <i className={"pri " + String(x.pri).toLowerCase()} title={x.pri} />}{x.due && <em>{String(x.due)}</em>}
            <button className="ib sm ghost" aria-label="Remove" onClick={() => up((l) => l.filter((y) => y.id !== x.id))}><X size={13} {...ico} /></button>
          </div>))}</div>
        <input className="kin" value={nw} placeholder={tasks ? "Add a task" : "Add an item"} onChange={(e) => setNw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      </Pad>
    </Frame>
  );
}

/* Reminders (checked every few seconds while the app is open) */
const nextClock = (hhmm) => { const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/); if (!m) return NaN; const t = new Date(); t.setHours(+m[1], +m[2], 0, 0); if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1); return t.getTime(); };
const remList = () => LS.get("epique.rem", []);
function useReminders(onFire) {
  const cb = useRef<any>(onFire); cb.current = onFire;
  useEffect(() => {
    const t = setInterval(() => {
      const l = remList(); let ch = false;
      const n = l.map((r) => { if (!r.fired && r.at <= Date.now()) { ch = true; cb.current(r); return { ...r, fired: true }; } return r; });
      if (ch) LS.set("epique.rem", n);
    }, 4000);
    return () => clearInterval(t);
  }, []);
}
function ReminderCard({ d }: any) {
  const id = hsh("r" + JSON.stringify(d)), [, tick] = useState<any>(0);
  useEffect(() => {
    const l = remList();
    if (!l.some((x) => x.id === id)) { let at = d.at ? new Date(d.at).getTime() : d.time ? nextClock(d.time) : Date.now() + (parseFloat(d.minutes) || 10) * 60000; if (!isFinite(at)) at = Date.now() + 600000; LS.set("epique.rem", [...l, { id, text: String(d.text || "Reminder").slice(0, 200), at, fired: false }]); }
    const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t);
  }, [id]); // eslint-disable-line
  const r = remList().find((x) => x.id === id), left = r ? Math.max(0, Math.round((r.at - Date.now()) / 1000)) : 0;
  const fmt = left >= 3600 ? `${Math.floor(left / 3600)}h ${Math.floor((left % 3600) / 60)}m` : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  const edit = (fn) => { LS.set("epique.rem", remList().map((x) => (x.id === id ? fn(x) : x))); tick((x) => x + 1); };
  const canN = typeof Notification !== "undefined" && Notification.permission === "default";
  return (
    <Frame I={Bell} title="Reminder" sub={!r ? "Cancelled" : r.fired ? "Done" : new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}>
      <Pad c="rem"><div className="remt">{r?.text || String(d.text || "Reminder")}</div>
        {r && !r.fired && <div className="remc">{fmt}</div>}
        <div className="cact" style={{ padding: 0 }}>
          {r && <button className="tg" onClick={() => edit((x) => ({ ...x, at: Math.max(Date.now(), x.at) + 300000, fired: false }))}>+5 min</button>}
          {r && !r.fired && <button className="tg" onClick={() => { LS.set("epique.rem", remList().filter((x) => x.id !== id)); tick((x) => x + 1); }}>Cancel</button>}
          {canN && <button className="tg" onClick={() => Notification.requestPermission().then(() => tick((x) => x + 1))}><Bell size={14} {...ico} />Allow alerts</button>}
        </div></Pad>
    </Frame>
  );
}

/* Progress, links, apps, polls, questions, countdown, stopwatch */
function ProgressCard({ d }: any) {
  const st = Array.isArray(d.steps) ? d.steps.slice(0, 10) : [], pctS = st.length ? (st.filter((x) => x.state === "done").length / st.length) * 100 : 0;
  const v = d.value != null ? ((+d.value || 0) / (+d.max || 100)) * 100 : pctS;
  return (
    <Frame I={BarChart3} title={d.title || "Progress"} sub={d.status || `${Math.round(v)}%`}>
      <Pad><Bar v={v} />{d.label && <p className="gtx"><Rich t={d.label} /></p>}
        {st.length > 0 && <div className="pst">{st.map((x, i) => <div key={i} className={x.state || "todo"}><i>{x.state === "done" ? <Check size={11} {...ico} /> : ""}</i><span><Rich t={x.label || x.title} /></span></div>)}</div>}</Pad>
    </Frame>
  );
}
function LinksCard({ d, grid }: any) {
  const l = (Array.isArray(d.links) ? d.links : Array.isArray(d.sites) ? d.sites : Array.isArray(d.apps) ? d.apps : []).slice(0, 12);
  const host = (u) => { try { return new URL(http(u)).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
  return (
    <Frame I={grid ? Rocket : Link2} title={d.title || (grid ? "Apps" : "Links")}>
      <Pad c={grid ? "apg" : "lnk"}>{l.map((x, i) => { const u = http(x.url), h = host(x.url); return (
        <a key={i} className="lk" href={u} target="_blank" rel="noopener noreferrer"><Fav d={h} /><div><b>{String(x.title || x.name || h)}</b><span>{String(x.note || x.desc || h)}</span></div>{!grid && <ExternalLink size={14} {...ico} />}</a>); })}</Pad>
    </Frame>
  );
}
const AppsCard = (p) => <LinksCard {...p} grid />;
function PollCard({ d }: any) {
  const opts = (Array.isArray(d.options) ? d.options : []).slice(0, 8).map(String), id = hsh("p" + d.question + opts.join("|"));
  const [v, set] = usePersist(id, { pick: -1, n: opts.map((_, i) => +(d.votes?.[i]) || 0) });
  const tot = v.n.reduce((a, b) => a + b, 0), vote = (i) => set((p) => { const n = [...p.n]; if (p.pick >= 0) n[p.pick] = Math.max(0, n[p.pick] - 1); if (p.pick !== i) n[i] += 1; return { pick: p.pick === i ? -1 : i, n }; });
  return (
    <Frame I={Vote} title={d.question || "Poll"} sub={tot ? `${tot} vote${tot === 1 ? "" : "s"}` : ""}>
      <Pad c="pol">{opts.map((o, i) => { const p = tot ? Math.round((v.n[i] / tot) * 100) : 0; return (
        <button key={i} className={"po" + (v.pick === i ? " on" : "")} onClick={() => vote(i)}><i style={{ width: (v.pick >= 0 || tot ? p : 0) + "%" }} /><span>{o}</span>{(v.pick >= 0 || tot > 0) && <b>{p}%</b>}</button>); })}</Pad>
    </Frame>
  );
}
function ChoicesCard({ d }: any) {
  const opts = (Array.isArray(d.options) ? d.options : []).slice(0, 8).map(String), id = hsh("q" + d.question + opts.join("|")), [v, set] = usePersist(id, { pick: "" }), [o, setO] = useState<any>("");
  const go = (t) => { if (v.pick || !t.trim()) return; set({ pick: t }); askAI(t); };
  return (
    <Frame I={HelpCircle} title={d.question || "Quick question"}>
      <Pad c="pol">{opts.map((x, i) => <button key={i} className={"po" + (v.pick === x ? " on" : "")} disabled={!!v.pick && v.pick !== x} onClick={() => go(x)}><span>{x}</span>{v.pick === x && <Check size={15} {...ico} />}</button>)}
        {d.other !== false && !v.pick && <div className="inl"><input className="kin" value={o} placeholder="Something else…" onChange={(e) => setO(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go(o)} /><button className="tg on" onClick={() => go(o)}><Send size={14} {...ico} /></button></div>}</Pad>
    </Frame>
  );
}
function CountdownCard({ d }: any) {
  const t = new Date(d.date).getTime(), [, tick] = useState<any>(0);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  if (!isFinite(t)) return <Frame I={Hourglass} title="Countdown"><Err msg="That date isn't valid." /></Frame>;
  const s = Math.max(0, Math.floor((t - Date.now()) / 1000)), u = [[Math.floor(s / 86400), "days"], [Math.floor((s % 86400) / 3600), "hrs"], [Math.floor((s % 3600) / 60), "min"], [s % 60, "sec"]];
  return <Frame I={Hourglass} title={d.label || "Countdown"} sub={new Date(t).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}><Pad><div className="cdn">{s ? u.map(([n, l]) => <div key={l}><b>{String(n).padStart(2, "0")}</b><span>{l}</span></div>) : <b className="cdd">It's time</b>}</div></Pad></Frame>;
}
function StopwatchCard({ d }: any) {
  const [ms, setMs] = useState<any>(0), [run, setRun] = useState<any>(false), [laps, setLaps] = useState<any>([]), t0 = useRef<any>(0), base = useRef<any>(0);
  useEffect(() => { if (!run) return; const i = setInterval(() => setMs(base.current + Date.now() - t0.current), 50); return () => clearInterval(i); }, [run]);
  const f = (x) => `${String(Math.floor(x / 60000)).padStart(2, "0")}:${String(Math.floor((x % 60000) / 1000)).padStart(2, "0")}.${String(Math.floor((x % 1000) / 10)).padStart(2, "0")}`;
  const go = () => { if (run) { base.current = ms; setRun(false); } else { t0.current = Date.now(); setRun(true); } };
  return (
    <Frame I={TimerIcon} title={d.label || "Stopwatch"}>
      <Pad c="swc"><div className="swt">{f(ms)}</div>
        <div className="cact" style={{ justifyContent: "center", padding: 0 }}>
          <button className="tg on" onClick={go}>{run ? <Pause size={14} {...ico} /> : <Play size={14} {...ico} />}{run ? "Pause" : ms ? "Resume" : "Start"}</button>
          <button className="tg" disabled={!ms} onClick={() => (run ? setLaps((l) => [ms, ...l].slice(0, 8)) : (setMs(0), base.current = 0, setLaps([])))}>{run ? "Lap" : "Reset"}</button>
        </div>
        {laps.length > 0 && <div className="lps">{laps.map((l, i) => <span key={i}>Lap {laps.length - i} · {f(l)}</span>)}</div>}</Pad>
    </Frame>
  );
}
const TableK = ({ d }: any) => <SportsCard d={{ ...d, view: "table" }} />;

/* ── Widget builder: the AI composes widgets from elements; users can save them ── */
const WKEY = "epique.widgets", GENIMG = new Map();
const tOf = (e) => String(e?.t || e?.type || "text").toLowerCase();
function WTime({ e }: any) {
  const [n, set] = useState<any>(new Date());
  useEffect(() => { const i = setInterval(() => set(new Date()), e.seconds ? 1000 : 15000); return () => clearInterval(i); }, []); // eslint-disable-line
  const z = e.zone ? { timeZone: e.zone } : {}; let tm = "", dt = "";
  try { tm = n.toLocaleTimeString([], { ...z, hour: "2-digit", minute: "2-digit", ...(e.seconds ? { second: "2-digit" } : {}) }); dt = n.toLocaleDateString([], { ...z, weekday: "long", day: "numeric", month: "long" }); } catch (x) { tm = n.toLocaleTimeString(); dt = n.toLocaleDateString(); }
  const m = e.mode || "both";
  return <div className="wtm">{m !== "date" && <b>{tm}</b>}{m !== "time" && <span>{dt}</span>}{e.label && <small>{String(e.label)}</small>}</div>;
}
function WidgetView({ spec, sid }: any) {
  let k = 0; const wid = (e) => ({ ...(e || {}), _id: e?.id || "e" + k++ });
  const tree = (Array.isArray(spec.elements) ? spec.elements : Array.isArray(spec.items) ? spec.items : []).slice(0, 40).map((e) => (tOf(e) === "row" ? { ...e, t: "row", items: (e.items || []).slice(0, 5).map(wid) } : wid(e)));
  const flat = tree.flatMap((e) => (tOf(e) === "row" ? e.items : [e])), init = {};
  flat.forEach((e) => { const ty = tOf(e), id = e._id; if (ty === "check" || ty === "checkbox" || ty === "toggle") init[id] = !!e.value; else if (ty === "counter" || ty === "slider") init[id] = +e.value || +e.min || 0; else if (ty === "input" || ty === "textarea" || ty === "select") init[id] = e.value ?? (ty === "select" ? String((e.options || [])[0] ?? "") : ""); });
  const [st, setSt] = usePersist("w" + sid, init), val = (id) => st[id] ?? init[id], set = (id, v) => setSt((p) => ({ ...p, [id]: v }));
  const checks = flat.filter((e) => /^check/.test(tOf(e))), done = checks.filter((e) => val(e._id)).length, info = { done, total: checks.length, pct: checks.length ? Math.round((done / checks.length) * 100) : 0 };
  const T = (t) => String(t ?? "").replace(/\{\{(\w+)\}\}/g, (m, q) => (q in info ? info[q] : val(q) ?? ""));
  const act = (e) => {
    if (e.reset) setSt(init);
    if (e.set && typeof e.set === "object") setSt((p) => ({ ...p, ...e.set }));
    if (e.inc && typeof e.inc === "object") setSt((p) => { const n = { ...p }; for (const [a, b] of Object.entries(e.inc)) n[a] = (+(n[a] ?? init[a]) || 0) + (+b || 0); return n; });
    if (e.ask) askAI(T(e.ask));
    if (e.url) window.open(http(e.url), "_blank", "noopener");
  };
  const El = ({ e }: any) => {
    const ty = tOf(e), id = e._id;
    switch (ty) {
      case "heading": case "h": case "title": return <div className={"wh h" + (e.level || 2)}><Rich t={T(e.text)} /></div>;
      case "text": case "p": case "paragraph": return <p className="gtx"><Rich t={T(e.text)} /></p>;
      case "time": case "clock": case "date": return <WTime e={ty === "date" ? { ...e, mode: "date" } : e} />;
      case "check": case "checkbox": return <button className={"wck" + (val(id) ? " on" : "")} onClick={() => set(id, !val(id))}><span className="ck">{val(id) && <Check size={13} {...ico} />}</span><Rich t={T(e.label)} /></button>;
      case "toggle": return <button className="swr" role="switch" aria-checked={!!val(id)} onClick={() => set(id, !val(id))}><div><b><Rich t={T(e.label)} /></b></div><i className={"sw" + (val(id) ? " on" : "")}><u /></i></button>;
      case "input": return <label className="wfl"><Rich t={e.label} /><input className="kin" value={val(id)} placeholder={e.placeholder || ""} onChange={(x) => set(id, x.target.value)} /></label>;
      case "textarea": return <label className="wfl"><Rich t={e.label} /><textarea className="nta" rows={3} value={val(id)} placeholder={e.placeholder || ""} onChange={(x) => set(id, x.target.value)} /></label>;
      case "counter": { const stp = +e.step || 1; return <div className="wcn"><span><Rich t={T(e.label)} /></span><div><button className="ib sm" aria-label="Less" onClick={() => set(id, Math.max(e.min ?? -1e9, val(id) - stp))}>−</button><b>{val(id)}</b><button className="ib sm" aria-label="More" onClick={() => set(id, Math.min(e.max ?? 1e9, val(id) + stp))}>+</button></div></div>; }
      case "slider": return <label className="wfl"><Rich t={T(e.label)} /><b className="wsv">{val(id)}{e.unit || ""}</b><input className="rng" type="range" min={e.min ?? 0} max={e.max ?? 100} step={e.step ?? 1} value={val(id)} onChange={(x) => set(id, +x.target.value)} /></label>;
      case "select": return <label className="wfl"><Rich t={e.label} /><select className="sel" value={val(id)} onChange={(x) => set(id, x.target.value)}>{(e.options || []).map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}</select></label>;
      case "button": return <button className="tg on" onClick={() => act(e)}><Rich t={T(e.label)} /></button>;
      case "progress": { const mx = +e.max || 100, v = e.of && e.of !== "checks" ? ((+val(e.of) || 0) / mx) * 100 : e.value != null && !e.of ? (+e.value / mx) * 100 : info.pct; return <div className="gpr"><div><span><Rich t={T(e.label)} /></span><b>{Math.round(v)}%</b></div><Bar v={v} /></div>; }
      case "stat": return <div className="wst"><b><Rich t={T(e.value)} /></b><span><Rich t={T(e.label)} /></span></div>;
      case "badge": return <span className="wbd"><Rich t={T(e.text || e.label)} /></span>;
      case "divider": return <hr className="gdv" />;
      case "link": return <a className="tg" href={http(e.url)} target="_blank" rel="noopener noreferrer"><Link2 size={14} {...ico} /><Rich t={T(e.label || e.url)} /></a>;
      case "image": return e.url ? <img className="gimg" src={http(e.url)} alt={String(e.label || "")} loading="lazy" referrerPolicy="no-referrer" onError={(x) => { x.currentTarget.style.display = "none"; }} /> : null;
      case "list": return <ul className="wls">{(e.items || []).slice(0, 20).map((x, i) => <li key={i}><Rich t={T(x)} /></li>)}</ul>;
      default: return null;
    }
  };
  return <div className="wv">{tree.map((e, i) => (tOf(e) === "row" ? <div key={i} className="wrow">{e.items.map((x) => <Fragment key={x._id}>{El({ e: x })}</Fragment>)}</div> : <Fragment key={e._id}>{El({ e })}</Fragment>))}</div>;
}
function WidgetCard({ d }: any) {
  const [lib, setLib] = useState<any>(() => LS.get(WKEY, [])), [ask, setAsk] = useState<any>(false);
  const saved = d.saved ? lib.find((w) => w.name.toLowerCase() === String(d.saved).toLowerCase()) : null, spec = saved ? saved.spec : d, sid = hsh(JSON.stringify(spec)), mine = lib.find((w) => w.sid === sid);
  const [nm, setNm] = useState<any>(String(spec.title || spec.name || "My widget").slice(0, 40)), ac = hexOk(spec.accent);
  if (d.saved && !saved) return <Frame I={LayoutGrid} title="Widget"><Err msg={`No saved widget called "${d.saved}".`} /></Frame>;
  const put = (n) => { LS.set(WKEY, n); setLib(n); };
  return (
    <div style={ac ? ({ "--ka": ac } as any) : undefined}>
      <Frame I={ICONS[String(spec.icon || "").toLowerCase()] || LayoutGrid} title={String(spec.title || "Widget")} sub={mine ? "Saved" : "New"}>
        <Pad c="wg"><WidgetView spec={spec} sid={sid} />
          <div className="cact" style={{ padding: 0 }}>
            {mine ? <button className="tg" onClick={() => put(lib.filter((w) => w.id !== mine.id))}><Trash2 size={14} {...ico} />Remove</button>
              : ask ? <div className="inl" style={{ flex: 1 }}><input className="kin" value={nm} autoFocus onChange={(e) => setNm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && put([...lib, { id: rid(), sid, name: nm.trim() || "My widget", spec, ts: Date.now() }])} /><button className="tg on" onClick={() => { put([...lib, { id: rid(), sid, name: nm.trim() || "My widget", spec, ts: Date.now() }]); setAsk(false); }}>Save</button><button className="tg" onClick={() => setAsk(false)}>Cancel</button></div>
                : <button className="tg" onClick={() => setAsk(true)}><Plus size={14} {...ico} />Save widget</button>}
          </div></Pad>
      </Frame>
    </div>
  );
}
function GenImageCard({ d }: any) {
  const src = GENIMG.get(String(d.id));
  return <Frame I={ImageIcon} title="Image" sub={d.alt ? String(d.alt).slice(0, 36) : ""}>{src ? <Pad><img className="gimg" src={src} alt={String(d.alt || "Generated image")} /><div className="cact" style={{ padding: 0 }}><a className="tg" href={src} download="epique-image.png"><Download size={14} {...ico} />Download</a></div></Pad> : <Err msg="That image is no longer in memory. Ask me to make it again." />}</Frame>;
}

/* ── Chess: complete rules, small search AI, no heavy rendering ── */
const PV = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }, N8 = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]], DD = [[1, 1], [1, -1], [-1, 1], [-1, -1]], DR = [[1, 0], [-1, 0], [0, 1], [0, -1]], D8 = [...DD, ...DR];
const GL = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" }, isW = (p) => p === p.toUpperCase();
const chessStart = () => ({ b: "rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR".split("").map((c) => (c === "." ? "" : c)), t: "w", c: "KQkq", ep: -1 });
const att = (b, sq, by) => {
  const r = sq >> 3, c = sq & 7, W = by === "w", own = (p) => p && isW(p) === W, pr = W ? r + 1 : r - 1;
  for (const dc of [-1, 1]) { const cc = c + dc; if (pr >= 0 && pr < 8 && cc >= 0 && cc < 8 && b[pr * 8 + cc] === (W ? "P" : "p")) return true; }
  for (const [dr, dc] of N8) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === (W ? "N" : "n")) return true; }
  for (const [dr, dc] of D8) for (let rr = r + dr, cc = c + dc, n = 0; rr >= 0 && rr < 8 && cc >= 0 && cc < 8; rr += dr, cc += dc, n++) {
    const p = b[rr * 8 + cc]; if (!p) continue; const u = p.toUpperCase();
    if (own(p) && (u === "Q" || (dr && dc ? u === "B" : u === "R") || (n === 0 && u === "K"))) return true; break;
  }
  return false;
};
const gen = (s) => {
  const { b, c, ep } = s, W = s.t === "w", out = [], en = W ? "b" : "w", mine = (p) => p && isW(p) === W;
  for (let i = 0; i < 64; i++) {
    const p = b[i]; if (!mine(p)) continue;
    const u = p.toUpperCase(), r = i >> 3, f = i & 7, add = (t: any, x?: any) => out.push({ f: i, t, ...x });
    if (u === "P") {
      const d = W ? -1 : 1, r1 = r + d, pm = r1 === (W ? 0 : 7) ? { pm: 1 } : {};
      if (r1 >= 0 && r1 < 8) {
        if (!b[r1 * 8 + f]) { add(r1 * 8 + f, pm); if (r === (W ? 6 : 1) && !b[(r + 2 * d) * 8 + f]) add((r + 2 * d) * 8 + f, { dp: 1 }); }
        for (const dc of [-1, 1]) { const cc = f + dc; if (cc < 0 || cc > 7) continue; const to = r1 * 8 + cc, q = b[to]; if (q && !mine(q)) add(to, pm); else if (to === ep) add(to, { ep: 1 }); }
      }
    } else if (u === "N" || u === "K") {
      for (const [dr, dc] of u === "N" ? N8 : D8) { const rr = r + dr, cc = f + dc; if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue; if (!mine(b[rr * 8 + cc])) add(rr * 8 + cc); }
      const home = W ? 60 : 4;
      if (u === "K" && i === home && !att(b, home, en)) {
        const R = W ? "R" : "r";
        if (c.includes(W ? "K" : "k") && !b[home + 1] && !b[home + 2] && b[home + 3] === R && !att(b, home + 1, en) && !att(b, home + 2, en)) add(home + 2, { ca: 1 });
        if (c.includes(W ? "Q" : "q") && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === R && !att(b, home - 1, en) && !att(b, home - 2, en)) add(home - 2, { ca: -1 });
      }
    } else {
      for (const [dr, dc] of u === "B" ? DD : u === "R" ? DR : D8) for (let rr = r + dr, cc = f + dc; rr >= 0 && rr < 8 && cc >= 0 && cc < 8; rr += dr, cc += dc) { const q = b[rr * 8 + cc]; if (mine(q)) break; add(rr * 8 + cc); if (q) break; }
    }
  }
  return out;
};
const cApply = (s, m) => {
  const b = s.b.slice(), p = b[m.f], W = isW(p); b[m.t] = m.pm ? (W ? "Q" : "q") : p; b[m.f] = "";
  if (m.ep) b[m.t + (W ? 8 : -8)] = "";
  if (m.ca) { if (m.ca > 0) { b[m.t - 1] = b[m.t + 1]; b[m.t + 1] = ""; } else { b[m.t + 1] = b[m.t - 2]; b[m.t - 2] = ""; } }
  let c = s.c; const strip = (x) => { for (const ch of x) c = c.replace(ch, ""); };
  if (p === "K") strip("KQ"); if (p === "k") strip("kq");
  for (const q of [m.f, m.t]) { if (q === 63) strip("K"); if (q === 56) strip("Q"); if (q === 7) strip("k"); if (q === 0) strip("q"); }
  return { b, t: W ? "b" : "w", c, ep: m.dp ? (m.f + m.t) / 2 : -1 };
};
const legal = (s) => { const W = s.t === "w", k = W ? "K" : "k", en = W ? "b" : "w"; return gen(s).filter((m) => { const n = cApply(s, m); return !att(n.b, n.b.indexOf(k), en); }); };
const inChk = (s) => att(s.b, s.b.indexOf(s.t === "w" ? "K" : "k"), s.t === "w" ? "b" : "w");
const mvv = (s) => (m) => (s.b[m.t] ? PV[s.b[m.t].toLowerCase()] * 10 - PV[s.b[m.f].toLowerCase()] : m.ep ? 900 : 0) + (m.pm ? 800 : 0);
const evalB = (b) => {
  let v = 0, bw = 0, bb = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i]; if (!p) continue; const u = p.toLowerCase(), w = isW(p), r = i >> 3, f = i & 7, cen = 7 - Math.abs(f - 3.5) - Math.abs(r - 3.5);
    const x = PV[u] + (u === "p" ? (w ? 6 - r : r - 1) * 8 + (f > 1 && f < 6 ? 4 : 0) : u === "n" || u === "b" ? cen * 6 : u === "q" ? cen : u === "k" ? (w ? (r === 7 ? 12 : -10) : (r === 0 ? 12 : -10)) : u === "r" ? ((w ? r === 1 : r === 6) ? 18 : 0) : 0);
    v += w ? x : -x; if (u === "b") w ? bw++ : bb++;
  }
  return v + (bw > 1 ? 30 : 0) - (bb > 1 ? 30 : 0);
};
let CDL = 0;
const qsearch = (s, a, bt, d) => {
  if (CDL && performance.now() > CDL) return 0;
  const st = (s.t === "w" ? 1 : -1) * evalB(s.b); if (st >= bt) return bt; if (st > a) a = st; if (d <= 0) return a;
  const o = mvv(s), ms = legal(s).filter((m) => s.b[m.t] || m.ep).sort((x, y) => o(y) - o(x));
  for (const m of ms) { const v = -qsearch(cApply(s, m), -bt, -a, d - 1); if (v >= bt) return bt; if (v > a) a = v; }
  return a;
};
const csearch = (s, d, a, bt) => {
  if (CDL && performance.now() > CDL) return 0;
  const ms = legal(s); if (!ms.length) return inChk(s) ? -99999 - d : 0; if (!d) return qsearch(s, a, bt, 4);
  const o = mvv(s); ms.sort((x, y) => o(y) - o(x));
  for (const m of ms) { const v = -csearch(cApply(s, m), d - 1, -bt, -a); if (v >= bt) return bt; if (v > a) a = v; }
  return a;
};
const cPick = (s, lv) => {
  const ms = legal(s); CDL = performance.now() + 220; let best = null;
  for (let d = 1; d <= lv; d++) {
    let b = null, bv = -1e9;
    for (const m of ms) { const v = -csearch(cApply(s, m), d - 1, -1e9, 1e9) + Math.random() * (lv === 1 ? 160 : 6); if (performance.now() > CDL) { b = null; break; } if (v > bv) { bv = v; b = m; } }
    if (!b) break; best = b;
  }
  CDL = 0; return best || ms[0] || null;
};

/* Stockfish (WebAssembly/asm.js build from cdnjs, run in a Web Worker). Falls back to the built-in engine if it can't load. */
const sq = (i) => "abcdefgh"[i & 7] + (8 - (i >> 3));
const toFen = (s) => {
  const rows = []; for (let r = 0; r < 8; r++) { let o = "", e = 0; for (let f = 0; f < 8; f++) { const p = s.b[r * 8 + f]; if (!p) e++; else { if (e) o += e; e = 0; o += p; } } rows.push(o + (e || "")); }
  return `${rows.join("/")} ${s.t} ${s.c || "-"} ${s.ep >= 0 ? sq(s.ep) : "-"} 0 1`;
};
let SFP = null;
const sfEngine = () => SFP || (SFP = (async () => {
  const r = await fetch("https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js"); if (!r.ok) throw new Error("no engine");
  const w = new Worker(URL.createObjectURL(new Blob([await r.text()], { type: "text/javascript" })));
  let cb = null; w.onmessage = (e) => cb && cb(String(e.data));
  const send = (c) => w.postMessage(c);
  send("uci");
  const go = (fen, skill, ms) => new Promise((res, rej) => {
    let cp = null, mate = null; const to = setTimeout(() => { cb = null; rej(new Error("timeout")); }, ms + 9000);
    cb = (l) => { const m = l.match(/score (cp|mate) (-?\d+)/); if (m) { if (m[1] === "cp") { cp = +m[2]; mate = null; } else mate = +m[2]; }
      if (l.startsWith("bestmove")) { clearTimeout(to); cb = null; res({ uci: l.split(" ")[1], cp, mate }); } };
    send("ucinewgame"); send(`setoption name Skill Level value ${skill}`); send("position fen " + fen); send(`go movetime ${ms}`);
  });
  return { go };
})().catch((e) => { SFP = null; throw e; }));

const LVL = [[1, "Beginner", 1, 200], [2, "Casual", 6, 500], [3, "Club", 13, 1100], [4, "Master", 20, 2500]];
const PIECE = (p) => `https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/piece/cburnett/${isW(p) ? "w" : "b"}${p.toUpperCase()}.svg`;
const START_N = { p: 8, n: 2, b: 2, r: 2, q: 1 };
function ChessCard({ d }: any) {
  const [g, setG] = useState<any>(() => ({ s: chessStart(), h: [], last: null, mv: [], ev: 0 })), [sel, setSel] = useState<any>(-1), [flip, setFlip] = useState<any>(false), [hint, setHint] = useState<any>(null), [nopc, setNopc] = useState<any>(false), [eng, setEng] = useState<any>("");
  const [lv, setLv] = useState<any>(d.level === "easy" ? 1 : d.level === "hard" ? 3 : d.level === "master" ? 4 : 2);
  const ms = useMemo(() => legal(g.s), [g.s]), chk = useMemo(() => inChk(g.s), [g.s]);
  const over = !ms.length ? (chk ? (g.s.t === "w" ? "Checkmate. I win." : "Checkmate. You win!") : "Stalemate. A draw.") : "", busy = g.s.t === "b" && !over;
  const play = (m, ev?) => setG((x) => ({ s: cApply(x.s, m), h: [...x.h, x.s], last: m, mv: [...x.mv, `${x.s.b[m.f].toUpperCase() === "P" ? "" : x.s.b[m.f].toUpperCase()}${x.s.b[m.t] || m.ep ? "x" : ""}${sq(m.t)}`], ev: ev ?? x.ev }));
  useEffect(() => {
    if (!busy) return; let dead = false; const t0 = Date.now(), L = LVL[lv - 1];
    (async () => {
      let m = null, ev = null;
      try { const E = await sfEngine(), r = await E.go(toFen(g.s), L[2], L[3]); m = ms.find((x) => sq(x.f) + sq(x.t) === (r.uci || "").slice(0, 4));
        ev = r.mate != null ? (r.mate > 0 ? -1 : 1) * 1500 : r.cp != null ? -r.cp : null; setEng("Stockfish"); } catch (e) { setEng("Built-in engine"); }
      if (!m) m = cPick(g.s, Math.min(lv, 3));
      await new Promise((r) => setTimeout(r, Math.max(0, 800 - (Date.now() - t0)))); // play at a human pace
      if (!dead && m) play(m, ev);
    })(); return () => { dead = true; };
  }, [g.s]); // eslint-disable-line
  const tg = sel >= 0 ? ms.filter((m) => m.f === sel).map((m) => m.t) : [];
  const tap = (i) => {
    if (over || busy) return; setHint(null); const p = g.s.b[i];
    if (sel >= 0) { const m = ms.find((x) => x.f === sel && x.t === i); if (m) { play(m); setSel(-1); return; } }
    setSel(p && isW(p) ? i : -1);
  };
  const undo = () => { if (busy) return; setSel(-1); setHint(null); setG((x) => { const n = x.s.t === "w" ? 2 : 1; return x.h.length < n ? x : { s: x.h[x.h.length - n], h: x.h.slice(0, -n), last: null, mv: x.mv.slice(0, -n), ev: x.ev }; }); };
  const getHint = async () => { if (busy || over) return; try { const r = await (await sfEngine()).go(toFen(g.s), 20, 700), m = ms.find((x) => sq(x.f) + sq(x.t) === r.uci.slice(0, 4)); if (m) { setHint(m); setSel(m.f); } } catch (e) { const m = cPick(g.s, 2); if (m) { setHint(m); setSel(m.f); } } };
  const cnt = {}; g.s.b.forEach((p) => { if (p) cnt[p] = (cnt[p] || 0) + 1; });
  const lost = (W) => Object.keys(START_N).flatMap((k) => Array(Math.max(0, START_N[k] - (cnt[W ? k.toUpperCase() : k] || 0))).fill(k));
  const wp = 50 + 50 * Math.tanh(g.ev / 450), idx = (i) => (flip ? 63 - i : i), shown = Array.from({ length: 64 }, (_, i) => idx(i));
  const rows = []; for (let i = 0; i < g.mv.length; i += 2) rows.push(`${i / 2 + 1}. ${g.mv[i]}${g.mv[i + 1] ? " " + g.mv[i + 1] : ""}`);
  return (
    <Frame I={Crown} title="Chess" sub={over || (busy ? "Thinking…" : chk ? "Check!" : hint ? `Hint: ${sq(hint.f)}→${sq(hint.t)}` : "Your move")}>
      <Pad c="chs">
        <div className="chcap">{lost(false).map((k, i) => <span key={i} className="pw2">{GL[k]}</span>)}</div>
        <div className="chx">
          <div className="chev" title={`Evaluation ${(g.ev / 100).toFixed(1)}`}><i style={{ height: wp + "%" }} /></div>
          <div className="chb chc">{shown.map((i, k) => { const p = g.s.b[i];
            return (
              <button key={i} aria-label={`${sq(i)}${p ? " " + p : ""}`} className={"chq" + (((i >> 3) + (i & 7)) % 2 ? " d" : "") + (sel === i ? " s" : "") + (g.last && (g.last.f === i || g.last.t === i) ? " l" : "") + (hint && (hint.t === i) ? " h" : "") + (chk && p === (g.s.t === "w" ? "K" : "k") ? " k" : "")} onClick={() => tap(i)}>
                {k % 8 === 0 && <em className="rk">{8 - (i >> 3)}</em>}{k >= 56 && <em className="fl">{"abcdefgh"[i & 7]}</em>}
                {p && (nopc ? <span className={isW(p) ? "pw" : "pb"}>{GL[p.toLowerCase()] + "\uFE0E"}</span> : <img src={PIECE(p)} alt="" draggable={false} onError={() => setNopc(true)} />)}
                {tg.includes(i) && <i className={p ? "cap" : "dot"} />}
              </button>); })}</div>
        </div>
        <div className="chcap">{lost(true).map((k, i) => <span key={i} className="pb2">{GL[k]}</span>)}</div>
        {rows.length > 0 && <div className="chmv">{rows.slice(-6).join("   ")}</div>}
        <div className="cact" style={{ padding: 0, justifyContent: "center" }}>
          <button className="tg on" onClick={() => { setSel(-1); setHint(null); setG({ s: chessStart(), h: [], last: null, mv: [], ev: 0 }); }}><RefreshCw size={14} {...ico} />New game</button>
          <button className="tg" disabled={busy || g.h.length < 1} onClick={undo}>Undo</button>
          <button className="tg" disabled={busy || !!over} onClick={getHint}><Lightbulb size={14} {...ico} />Hint</button>
          <button className="tg" onClick={() => setFlip((f) => !f)}>Flip</button>
        </div>
        <div className="cact" style={{ padding: 0, justifyContent: "center" }}>
          {LVL.map(([k, n]) => <button key={k} className={"tg" + (lv === k ? " on" : "")} onClick={() => setLv(k)}>{n}</button>)}
        </div>
        {eng && <small className="hint" style={{ textAlign: "center" }}>Engine: {eng}</small>}
      </Pad>
    </Frame>
  );
}

/* ── File creation: PDF, DOCX, Markdown, TXT, HTML, CSV, JSON, ICS, SVG — all built in the browser ── */
const FILES = new Map();
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return (u) => { let c = ~0; for (let i = 0; i < u.length; i++) c = t[(c ^ u[i]) & 255] ^ (c >>> 8); return ~c >>> 0; }; })();
const zipStore = (files) => {
  const enc8 = new TextEncoder(), parts = [], cd = []; let off = 0;
  const u16 = (v) => [v & 255, (v >> 8) & 255], u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  for (const [name, data] of files) {
    const nb = enc8.encode(name), c = CRC(data), h = new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(nb.length), 0, 0]);
    parts.push(h, nb, data); cd.push(new Uint8Array([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(c), ...u32(data.length), ...u32(data.length), ...u16(nb.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(off)]), nb);
    off += h.length + nb.length + data.length;
  }
  const cs = cd.reduce((a, b) => a + b.length, 0);
  return new Blob([...parts, ...cd, new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(cs), ...u32(off), 0, 0])], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
};
const mdLines = (md) => String(md || "").replace(/\r/g, "").split("\n").map((l) => {
  const t = l.replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  let m; if ((m = t.match(/^(#{1,3})\s+(.*)/))) return { k: "h" + m[1].length, t: m[2] };
  if ((m = t.match(/^\s*[-*•]\s+(.*)/))) return { k: "li", t: m[1] };
  if ((m = t.match(/^\s*(\d+)[.)]\s+(.*)/))) return { k: "li", t: m[1] + ". " + m[2] };
  if (/^\s*\|?\s*:?-{2,}/.test(t)) return { k: "skip" };
  if (/^\s*\|.*\|\s*$/.test(t)) return { k: "p", t: t.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join("   |   ") };
  return { k: t.trim() ? "p" : "gap", t: t.trim() };
}).filter((x) => x.k !== "skip");
const mkPdf = (title, md) => {
  const W = 595, H = 842, M = 54, L1 = { h1: [22, 1], h2: [16, 1], h3: [13, 1], p: [11, 0], li: [11, 0] }, pages = [[]]; let y = H - M;
  const clean = (s) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...").replace(/•/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?").replace(/([\\()])/g, "\\$1");
  const put = (t, sz, b, x) => { if (y < M + sz) { pages.push([]); y = H - M; } pages[pages.length - 1].push(`BT /F${b ? 2 : 1} ${sz} Tf ${x} ${y.toFixed(1)} Td (${clean(t)}) Tj ET`); y -= sz * 1.45; };
  const wrap = (t, sz, w) => { const cw = sz * 0.5, mx = Math.floor(w / cw), out = []; let cur = ""; for (const wd of t.split(" ")) { if ((cur + " " + wd).trim().length > mx) { out.push(cur); cur = wd; } else cur = (cur + " " + wd).trim(); } out.push(cur); return out; };
  if (title) { put(title, 24, 1, M); y -= 6; }
  for (const l of mdLines(md)) {
    if (l.k === "gap") { y -= 6; continue; } const [sz, b] = L1[l.k] || L1.p; if (l.k.startsWith("h")) y -= 6;
    wrap(l.t, sz, W - 2 * M - (l.k === "li" ? 16 : 0)).forEach((ln, i) => put((l.k === "li" && i === 0 ? "- " : l.k === "li" ? "  " : "") + ln, sz, b, M + (l.k === "li" ? 12 : 0)));
  }
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"];
  pages.forEach((p, i) => { const s = p.join("\n"); objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`, `<< /Length ${s.length} >>\nstream\n${s}\nendstream`); });
  let out = "%PDF-1.4\n"; const offs = []; objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return new Blob([Uint8Array.from(out, (c) => c.charCodeAt(0) & 255)], { type: "application/pdf" });
};
const mkDocx = (title, md) => {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), e = new TextEncoder(), SZ = { h1: 40, h2: 32, h3: 26 };
  const para = (l) => l.k === "gap" ? "<w:p/>" : `<w:p>${l.k === "li" ? '<w:pPr><w:ind w:left="500" w:hanging="250"/></w:pPr>' : ""}<w:r><w:rPr>${SZ[l.k] ? `<w:b/><w:sz w:val="${SZ[l.k]}"/>` : ""}</w:rPr><w:t xml:space="preserve">${esc((l.k === "li" ? "• " : "") + l.t)}</w:t></w:r></w:p>`;
  const body = ((title ? [{ k: "h1", t: title }] : []) as any[]).concat(mdLines(md)).map(para).join("");
  return zipStore([
    ["[Content_Types].xml", e.encode('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')],
    ["_rels/.rels", e.encode('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')],
    ["word/document.xml", e.encode(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)],
  ]);
};
const MIME = { md: "text/markdown", txt: "text/plain", html: "text/html", csv: "text/csv", json: "application/json", ics: "text/calendar", svg: "image/svg+xml" };
const makeFile = ({ filename, format, title, content }) => {
  const f = String(format || filename?.split(".").pop() || "txt").toLowerCase().replace(".", ""), base = String(filename || title || "document").replace(/\.\w+$/, "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "document", name = `${base}.${f}`;
  const blob = f === "pdf" ? mkPdf(title, content) : f === "docx" ? mkDocx(title, content) : new Blob([String(content || "")], { type: (MIME[f] || "text/plain") + ";charset=utf-8" });
  const old = FILES.get(name); if (old) URL.revokeObjectURL(old.url);
  const rec = { name, blob, url: URL.createObjectURL(blob), size: blob.size, f }; FILES.set(name, rec); return rec;
};
function FileCard({ d }: any) {
  const [rec, setRec] = useState<any>(() => FILES.get(d.name) || (d.content ? makeFile(d) : null));
  if (!rec) return <Frame I={FileText} title="File"><Err msg={`"${d.name || "file"}" isn't available in this session. Ask me to create it again.`} /></Frame>;
  const dl = () => { const a = document.createElement("a"); a.href = rec.url; a.download = rec.name; document.body.appendChild(a); a.click(); a.remove(); };
  return (
    <Frame I={FileText} title={rec.name} sub={`${rec.f.toUpperCase()} · ${rec.size > 1024 ? (rec.size / 1024).toFixed(1) + " KB" : rec.size + " B"}`}>
      <div className="cact" style={{ padding: 0 }}>
        <button className="tg on" onClick={dl}><Download size={14} {...ico} />Download</button>
        {["pdf", "html", "svg", "txt", "md"].includes(rec.f) && <button className="tg" onClick={() => window.open(rec.url, "_blank")}><ExternalLink size={14} {...ico} />Open</button>}
      </div>
    </Frame>
  );
}

const MCP_PRESETS = [["DeepWiki (GitHub repo docs)", "https://mcp.deepwiki.com/mcp"], ["Context7 (library docs)", "https://mcp.context7.com/mcp"], ["Hugging Face", "https://huggingface.co/mcp"], ["Cloudflare Docs", "https://docs.mcp.cloudflare.com/mcp"], ["Linear", "https://mcp.linear.app/mcp"], ["Notion", "https://mcp.notion.com/mcp"], ["Sentry", "https://mcp.sentry.dev/mcp"], ["GitHub", "https://api.githubcopilot.com/mcp/"]];
const KINDS = { sports: SportsCard, football: SportsCard, soccer: SportsCard, scores: SportsCard, match: SportsCard, standings: TableK, table: TableK, news: NewsCard, headlines: NewsCard, card: GenericCard, custom: GenericCard, template: GenericCard, panel: GenericCard, dashboard: GenericCard, info: GenericCard, note: NotesCard, notes: NotesCard, checklist: ListCard, todo: ListCard, tasks: (p) => <ListCard {...p} tasks />, task: (p) => <ListCard {...p} tasks />, reminder: ReminderCard, reminders: ReminderCard, alarm: ReminderCard, progress: ProgressCard, status: ProgressCard, links: LinksCard, link: LinksCard, sites: LinksCard, resources: LinksCard, apps: AppsCard, poll: PollCard, vote: PollCard, survey: PollCard, ask: ChoicesCard, question: ChoicesCard, questions: ChoicesCard, choices: ChoicesCard, countdown: CountdownCard, stopwatch: StopwatchCard, widget: WidgetCard, widgets: WidgetCard, mywidget: WidgetCard, builder: WidgetCard, game: ChessCard, chess: ChessCard, genimage: GenImageCard, weather: WeatherCard, music: MusicCard, images: ImagesCard, image: ImagesCard, photos: ImagesCard, contact: ContactCard, place: PlaceCard, places: PlaceCard, itinerary: ItineraryCard, trip: ItineraryCard, plan: ItineraryCard, map: MapCard, maps: MapCard, directions: MapCard, wiki: WikiCard, wikipedia: WikiCard, define: DefineCard, file: FileCard, files: FileCard, document: FileCard, pdf: FileCard, dictionary: DefineCard, currency: CurrencyCard, convert: CurrencyCard, chart: ChartCard, graph: ChartCard, quiz: QuizCard, timer: TimerCard, clock: ClockCard, time: ClockCard };
function UiBlock({ kind, raw }: any) {
  const d = useMemo(() => parseJSON(raw.trim()), [raw]), K = KINDS[kind.toLowerCase()];
  if (!K || !d || typeof d !== "object") return <div className="cb"><div className="cbh"><span>ui:{kind}</span></div><pre><code>{raw}</code></pre></div>;
  return <K d={d} />;
}

// Search grounding results from Gemini → source cards.
const domainOf = (t) => (/^[\w-]+(\.[\w-]+)+$/.test(t || "") ? t : "");
function Fav({ d }: any) {
  const [bad, setBad] = useState<any>(false);
  return d && !bad
    ? <img className="fv" src={`https://www.google.com/s2/favicons?sz=64&domain=${enc(d)}`} alt="" loading="lazy" onError={() => setBad(true)} />
    : <span className="fv"><Globe size={14} {...ico} /></span>;
}
function Sources({ list, queries }: any) {
  const seen = new Set(), items = (list || []).filter((s) => s.url && !seen.has(s.title + s.url) && seen.add(s.title + s.url)).slice(0, 8);
  if (!items.length && !queries?.length) return null;
  return (
    <div className="src">
      {queries?.length > 0 && <div className="sqr"><Globe size={13} {...ico} /><span>Searched</span>{queries.slice(0, 3).map((q) => <em key={q}>{q}</em>)}</div>}
      {items.length > 0 && (
        <div className="srow">
          {items.map((s, i) => (
            <a key={i} className="pane scd" href={s.url} target="_blank" rel="noopener noreferrer">
              <Fav d={domainOf(s.title)} />
              <div><b>{s.title || "Source"}</b><span>Source {i + 1}</span></div>
              <ExternalLink size={13} {...ico} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

const hr = new Date().getHours();
const GREET = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
const Mark = ({ size = 18, fast }: any) => (
  <svg className={"lg" + (fast ? " fast" : "")} width={size} height={size} viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">
    <circle className="b" cx="50" cy="50" r="19" style={{ "--d": "5.2s", "--l": "0s", "--x": "4px" } as any} fillOpacity={1} />
    <circle className="b" cx="23" cy="27" r="11" style={{ "--d": "4.4s", "--l": "0.6s", "--x": "-3px" } as any} fillOpacity={0.85} />
    <circle className="b" cx="77" cy="24" r="8" style={{ "--d": "3.8s", "--l": "1.1s", "--x": "3px" } as any} fillOpacity={0.7} />
    <circle className="b" cx="79" cy="71" r="13" style={{ "--d": "4.8s", "--l": "0.3s", "--x": "-4px" } as any} fillOpacity={0.9} />
    <circle className="b" cx="27" cy="76" r="9" style={{ "--d": "4.1s", "--l": "1.5s", "--x": "3px" } as any} fillOpacity={0.75} />
    <circle className="b" cx="54" cy="88" r="5" style={{ "--d": "3.5s", "--l": "0.9s", "--x": "-2px" } as any} fillOpacity={0.6} />
    <circle className="b" cx="10" cy="55" r="4" style={{ "--d": "3.2s", "--l": "1.8s", "--x": "2px" } as any} fillOpacity={0.5} />
  </svg>
);
const FONTS = [
  { id: "inter", n: "Inter", css: "'Inter',system-ui,sans-serif", g: "" },
  { id: "system", n: "System", css: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif", g: "" },
  { id: "dmsans", n: "DM Sans", css: "'DM Sans',system-ui,sans-serif", g: "DM+Sans:wght@400;500;600;700" },
  { id: "nunito", n: "Nunito", css: "'Nunito',system-ui,sans-serif", g: "Nunito:wght@400;500;600;700" },
  { id: "lexend", n: "Lexend", css: "'Lexend',system-ui,sans-serif", g: "Lexend:wght@400;500;600;700" },
  { id: "atkinson", n: "Atkinson Hyperlegible", css: "'Atkinson Hyperlegible',system-ui,sans-serif", g: "Atkinson+Hyperlegible:wght@400;700" },
  { id: "serif", n: "Source Serif", css: "'Source Serif 4',Georgia,serif", g: "Source+Serif+4:wght@400;500;600;700" },
  { id: "mono", n: "JetBrains Mono", css: "'JetBrains Mono',ui-monospace,Menlo,monospace", g: "JetBrains+Mono:wght@400;500;600" },
];
const fontOf = (id) => FONTS.find((f) => f.id === id) || FONTS[0];
/** A slanted sheet of paper with a pen writing on it: the New chat icon. */
const NewChatIcon = ({ size = 19 }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <g transform="rotate(-9 10 12)"><rect x="3" y="3.6" width="12.6" height="16.4" rx="2.6" /><path d="M6.4 8.6h5.8M6.4 12h3.6" /></g>
    <g transform="translate(9.4 7.6) scale(.62)" strokeWidth="2.9"><path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z" /></g>
  </svg>
);
const Ring = () => <span className="ring"><i /></span>;

/* ── Styles ─────────────────────────────────────────────── */
const CSS = `
.aura,.aura *,.aura *::before,.aura *::after{box-sizing:border-box}
.aura{--fr:255,255,255;--gr:16,16,16;--fg:#fff;--bg:#050505;--s1:#0a0a0a;--s2:#141414;--cs:dark;position:absolute;inset:0;overflow:hidden;background:var(--bg);color:var(--fg);color-scheme:var(--cs);text-align:left;font:400 16px/normal 'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:-.011em;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;touch-action:manipulation;overscroll-behavior:none;isolation:isolate}
/* Neutralise host-app styles (e.g. the Vite template's index.css / App.css) */
:where(.aura) :is(button,input,textarea){all:unset;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:where(.aura) button{cursor:pointer}
:where(.aura) :is(h1,h2,h3,h4,p,ul,ol,li,pre,blockquote,figure,table,hr){margin:0;padding:0;border:0;font-size:inherit;font-weight:inherit;line-height:inherit}
:where(.aura) a{color:inherit;text-decoration:none}
.aura :focus-visible{outline:2px solid rgba(var(--fr),.7);outline-offset:2px}
.aura ::selection{background:rgba(var(--fr),.25)}

.spot{position:absolute;left:0;top:0;width:520px;height:520px;background:radial-gradient(closest-side,rgba(var(--fr),.07),transparent);transform:translate3d(30vw,8vh,0);pointer-events:none;will-change:transform}
.blob{position:absolute;border-radius:50%;background:radial-gradient(closest-side,rgba(var(--fr),.09),transparent);animation:drift 28s ease-in-out infinite;pointer-events:none;will-change:transform}
@keyframes drift{0%,100%{transform:translate3d(0,0,0) scale(1)}33%{transform:translate3d(60px,-40px,0) scale(1.15)}66%{transform:translate3d(-50px,50px,0) scale(.92)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes shim{to{background-position:-200% 0}}
@keyframes rise{from{opacity:0;transform:translate3d(0,14px,0)}to{opacity:1;transform:none}}
@keyframes pop{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:none}}
@keyframes bob{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-8px,0)}}
@keyframes dot{0%,80%,100%{transform:translateY(0);opacity:.35}40%{transform:translateY(-5px);opacity:1}}
@keyframes blink{50%{opacity:0}}
@keyframes fadein{from{opacity:0}to{opacity:1}}
@keyframes pulse{0%,100%{opacity:.35;transform:scale(.8)}50%{opacity:1;transform:scale(1.1)}}
@keyframes menu{from{opacity:0;transform:translate3d(0,-8px,0) scale(.94)}to{opacity:1;transform:none}}
@keyframes twinkle{0%,100%{transform:scale(1) rotate(0)}50%{transform:scale(.72) rotate(90deg)}}
@keyframes skp{50%{opacity:.45}}
@keyframes eq{0%,100%{transform:scaleY(.25)}50%{transform:scaleY(1)}}
@keyframes glint{0%,100%{transform:rotate(-25deg) translate3d(0,0,0)}50%{transform:rotate(-25deg) translate3d(8px,4px,0)}}

/* glass = fixed chrome only (blur is costly); pane = cheap surface for scrolling content */
.glass{position:relative;background:linear-gradient(160deg,rgba(var(--fr),.085),rgba(var(--fr),.025));backdrop-filter:blur(22px) saturate(150%);-webkit-backdrop-filter:blur(22px) saturate(150%);box-shadow:inset 0 1px 0 rgba(var(--fr),.22),inset 0 -6px 14px rgba(0,0,0,.25),0 10px 34px rgba(0,0,0,.55)}
.glass::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;background:linear-gradient(155deg,rgba(var(--fr),.4),rgba(var(--fr),.04) 38%,rgba(var(--fr),0) 62%,rgba(var(--fr),.18));-webkit-mask:linear-gradient(#ffffff 0 0) content-box,linear-gradient(#ffffff 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#ffffff 0 0) content-box exclude,linear-gradient(#ffffff 0 0);pointer-events:none}
.pane{background:linear-gradient(160deg,rgba(var(--fr),.08),rgba(var(--fr),.03));box-shadow:inset 0 0 0 1px rgba(var(--fr),.09),inset 0 1px 0 rgba(var(--fr),.13)}
@media(pointer:coarse){.glass{backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%)}.blob:nth-of-type(3){display:none}}
@media(hover:hover){.hov:hover{background-image:radial-gradient(180px circle at var(--px,50%) var(--py,50%),rgba(var(--fr),.13),transparent 70%),linear-gradient(160deg,rgba(var(--fr),.085),rgba(var(--fr),.025))}}

/* rotating border: transform-only, runs only while focused */
.ring{position:absolute;inset:0;border-radius:inherit;padding:1.5px;overflow:hidden;pointer-events:none;opacity:.5;transition:opacity .21s;-webkit-mask:linear-gradient(#ffffff 0 0) content-box,linear-gradient(#ffffff 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#ffffff 0 0) content-box exclude,linear-gradient(#ffffff 0 0)}
.ring i{position:absolute;left:50%;top:50%;width:130%;aspect-ratio:1;margin:-65% 0 0 -65%;background:conic-gradient(rgba(var(--fr),.04),rgba(var(--fr),.85),rgba(var(--fr),.04) 40%,rgba(var(--fr),.4) 70%,rgba(var(--fr),.04));animation:spin 6s linear infinite;animation-play-state:paused}
.open .ring,.lpanel .ring{opacity:1}.open .ring i,.lpanel .ring i{animation-play-state:running}

.ib{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;flex:none;cursor:pointer;transition:transform .15s cubic-bezier(.34,1.56,.64,1)}
@media(hover:hover){.ib:hover{transform:scale(1.09)}}
.ib:active{transform:scale(.9,.94)}
.sm{width:32px;height:32px}
.ghost{background:rgba(var(--fr),.07);box-shadow:inset 0 1px 0 rgba(var(--fr),.16)}

.fade-t,.fade-b{position:absolute;left:0;right:0;z-index:20;pointer-events:none}
.fade-t{top:0;height:110px;background:linear-gradient(to bottom,var(--bg) 30%,transparent)}
.fade-b{bottom:var(--kb,0px);height:210px;background:linear-gradient(to top,var(--bg) 40%,transparent)}

.head{position:absolute;top:0;left:0;right:0;z-index:30;display:flex;align-items:center;justify-content:space-between;padding:calc(12px + env(safe-area-inset-top,0px)) 14px 12px}
.model{display:flex;align-items:center;gap:8px;height:40px;padding:0 12px 0 18px;border-radius:999px;font-weight:600;font-size:15px;cursor:pointer;transition:transform .15s cubic-bezier(.34,1.56,.64,1)}
.model:active{transform:scale(.96)}
.menu{position:absolute;top:calc(60px + env(safe-area-inset-top,0px));left:14px;width:min(300px,calc(100% - 28px));padding:6px;border-radius:24px;z-index:40;transform-origin:top left;animation:menu .13s cubic-bezier(.2,.9,.3,1.1) both}
.mi{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;padding:11px 14px;border-radius:18px;text-align:left;cursor:pointer;transition:background .12s}
.mi:hover,.mi:active{background:rgba(var(--fr),.07)}
.mi b{display:block;font-size:14.5px;font-weight:600}.mi span{font-size:12.5px;color:rgba(var(--fr),.5)}
.msep{height:1px;margin:4px 12px;background:rgba(var(--fr),.08)}

.scroll{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:96px 16px 220px;scrollbar-width:thin;scrollbar-color:rgba(var(--fr),.12) transparent;transition:padding-bottom .21s cubic-bezier(.22,1,.36,1)}
.wrap{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:24px}

.aimark{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;flex:none;margin-top:1px;background:linear-gradient(160deg,rgba(var(--fr),.18),rgba(var(--fr),.04));box-shadow:inset 0 1px 0 rgba(var(--fr),.35),inset 0 -4px 8px rgba(0,0,0,.35),0 0 18px rgba(var(--fr),.07)}
.aimark svg{filter:drop-shadow(0 0 5px rgba(var(--fr),.55))}
.aimark.fast svg{animation:twinkle 1.5s ease-in-out infinite}

.hero{display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:4vh;gap:10px}
.drop{position:relative;width:104px;height:104px;margin-bottom:14px;border-radius:50%;background:radial-gradient(circle at 34% 28%,var(--fg),#bcbcbc 46%,#2c2c2c 100%);box-shadow:0 0 54px rgba(var(--fr),.2),inset 0 -12px 24px rgba(0,0,0,.5);animation:bob 6s ease-in-out infinite}
.drop::before{content:"";position:absolute;width:46%;height:28%;left:15%;top:11%;border-radius:50%;background:radial-gradient(closest-side,rgba(var(--fr),.95),transparent);transform:rotate(-25deg);animation:glint 6s ease-in-out infinite}
.hero h1{font-size:clamp(32px,8vw,46px);line-height:1.1;font-weight:600;letter-spacing:-.035em;background:linear-gradient(180deg,var(--fg) 35%,rgba(var(--fr),.4));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{font-size:16px;color:rgba(var(--fr),.5)}
.sug{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;width:100%;max-width:560px;margin-top:24px}
@media(max-width:560px){.sug{grid-template-columns:1fr}}
.card{display:flex;align-items:center;gap:12px;padding:12px 16px 12px 12px;border-radius:22px;text-align:left;cursor:pointer;animation:rise .23s cubic-bezier(.2,.8,.2,1) both;transition:transform .17s cubic-bezier(.34,1.56,.64,1)}
@media(hover:hover){.card:hover{transform:translateY(-3px)}}
.card:active{transform:scale(.97)}
.chip{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;flex:none;background:rgba(var(--fr),.07);box-shadow:inset 0 1px 0 rgba(var(--fr),.25),0 4px 12px rgba(0,0,0,.4)}
.card b{display:block;font-size:14.5px;font-weight:600}.card span:not(.chip){font-size:13px;color:rgba(var(--fr),.48)}

.msg{animation:rise .19s cubic-bezier(.2,.8,.2,1) both}
.row-r{display:flex;justify-content:flex-end}
.ub{max-width:84%;padding:11px 18px;border-radius:22px 22px 6px 22px;font-size:15px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
.ai{display:flex;gap:12px}
.aitext{font-size:15.5px;line-height:1.7;color:rgba(var(--fr),.9);overflow-wrap:anywhere}
.caret{display:inline-block;width:7px;height:17px;margin-left:3px;vertical-align:-3px;border-radius:4px;background:var(--fg);animation:blink .8s infinite}
.think{display:flex;align-items:center;gap:10px;padding-top:5px;font-size:14.5px}
.shim{background:linear-gradient(90deg,rgba(var(--fr),.25),var(--fg),rgba(var(--fr),.25));background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shim 1.8s linear infinite}
.dots{display:flex;gap:4px}
.dots i{width:5px;height:5px;border-radius:50%;background:var(--fg);animation:dot 1.2s infinite}
.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.13s}
.thought{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 12px 0 9px;margin-bottom:10px;border-radius:999px;font-size:12.5px;color:rgba(var(--fr),.55);background:rgba(var(--fr),.05);box-shadow:inset 0 1px 0 rgba(var(--fr),.12)}
.acts{display:flex;gap:6px;margin-top:12px;animation:fadein .21s both}
.err{color:rgba(var(--fr),.6)}

.dock{position:absolute;left:0;right:0;bottom:var(--kb,0px);z-index:30;padding:0 clamp(12px,4vw,30px) calc(14px + env(safe-area-inset-bottom,0px))}
.composer{max-width:380px;margin:0 auto;border-radius:28px;outline:0;transition:max-width .25s cubic-bezier(.22,1,.36,1)}
.composer.open{max-width:720px}
.cr,.xp{display:grid;transition:grid-template-rows .21s cubic-bezier(.22,1,.36,1),opacity .15s,visibility 0s}
.cr>div,.xp>div{min-height:0;overflow:hidden}
.cr{grid-template-rows:1fr}
.xp{grid-template-rows:0fr;opacity:0;visibility:hidden;transition-delay:0s,.1s,.21s}
.open .cr{grid-template-rows:0fr;opacity:0;visibility:hidden;transition-delay:0s,0s,.21s}
.open .xp{grid-template-rows:1fr;opacity:1;visibility:visible;transition-delay:0s,.1s,0s}
.crow{display:flex;align-items:center;gap:8px;padding:8px}
.lbl{flex:1;min-width:0;height:40px;display:flex;align-items:center;padding:0 6px;font-size:15px;font-weight:500;color:rgba(var(--fr),.45);cursor:text;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xin{padding:14px 12px 10px 18px;min-width:0}
.composer textarea{display:block;width:100%;min-width:0;resize:none;overflow-y:auto;white-space:pre-wrap;overflow-wrap:anywhere;caret-color:var(--fg);background:transparent;color:var(--fg);font:500 16px/1.5 'Inter',system-ui,sans-serif;padding:2px 4px 0;max-height:140px;text-align:left}
.composer textarea::placeholder{color:rgba(var(--fr),.38)}
.composer textarea:focus-visible{outline:0}
.tools{display:flex;align-items:center;gap:8px;margin-top:10px}
.tg{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px 0 11px;border-radius:999px;background:rgba(var(--fr),.07);box-shadow:inset 0 1px 0 rgba(var(--fr),.12);font-size:13.5px;font-weight:500;color:rgba(var(--fr),.7);cursor:pointer;white-space:nowrap;flex:none;transition:background .13s,color .13s,box-shadow .13s}
.tg:hover{background:rgba(var(--fr),.12);color:var(--fg)}
.tg.on{background:var(--fg);color:var(--bg);box-shadow:0 0 22px rgba(var(--fr),.26)}
.send{background:var(--fg)!important;color:var(--bg)!important;box-shadow:0 0 26px rgba(var(--fr),.35),inset 0 -3px 6px rgba(0,0,0,.22)!important;animation:pop .17s cubic-bezier(.34,1.56,.64,1)}
.send svg{transform:translate(-1px,1px)}
.pop{animation:pop .17s cubic-bezier(.34,1.56,.64,1)}
.note{text-align:center;font-size:12px;color:rgba(var(--fr),.3);margin-top:10px;opacity:0;transition:opacity .21s}
.open+.note{opacity:1}

.lpanel{max-width:720px;margin:0 auto;padding:14px 16px;border-radius:30px;animation:rise .23s cubic-bezier(.22,1,.36,1) both}
.ltop{display:flex;align-items:center;gap:10px;height:28px;padding-left:4px;font-size:14px;font-weight:500}
.pdot{width:7px;height:7px;border-radius:50%;background:var(--fg);animation:pulse 1.6s infinite}
.wave{display:block;width:100%;height:110px}
.lcap{min-height:22px;text-align:center;font-size:14.5px;color:rgba(var(--fr),.8);padding:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lcap.dim{color:rgba(var(--fr),.42)}
.lctl{display:flex;justify-content:center;gap:10px;margin-top:12px}
.lctl .ib{width:48px;height:48px}
.endbtn{display:flex;align-items:center;gap:8px;height:48px;padding:0 24px 0 20px;border-radius:999px;font-size:15px;font-weight:600;cursor:pointer}
.endbtn:active{transform:scale(.94)}

.scrim{position:absolute;inset:0;z-index:35}
.sheet{position:absolute;left:50%;top:50%;z-index:60;width:min(380px,calc(100% - 32px));padding:18px;border-radius:28px;transform:translate(-50%,-50%);animation:menu .13s cubic-bezier(.2,.9,.3,1.1) both}
.sheet h3{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:600}
.sheet p{margin:8px 0 14px;font-size:13px;line-height:1.5;color:rgba(var(--fr),.55)}
.sheet input{display:block;width:100%;height:46px;padding:0 16px;border-radius:16px;background:rgba(var(--fr),.07);box-shadow:inset 0 0 0 1px rgba(var(--fr),.12);font:500 16px 'Inter',system-ui,sans-serif;color:var(--fg)}
.sheet input:focus-visible{outline:0;box-shadow:inset 0 0 0 1.5px rgba(var(--fr),.55)}
.sheet .sa{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.sheet-bg{position:absolute;inset:0;z-index:55;background:rgba(0,0,0,.55);animation:fadein .12s both}

/* markdown */
.aitext p{margin:0 0 .8em}
.aitext>*:last-child{margin-bottom:0}
.hd{margin:1.1em 0 .4em;font-weight:600;line-height:1.35}.h1{font-size:19px}.h2{font-size:17.5px}.h3{font-size:16px}
.aitext ul,.aitext ol{margin:0 0 .8em;padding-left:1.35em}.aitext ul{list-style:disc}.aitext ol{list-style:decimal}
.aitext li{margin:.28em 0;padding-left:.15em}.aitext li::marker{color:rgba(var(--fr),.5)}
.aitext li>ul,.aitext li>ol{margin:.3em 0 .1em}.aitext li>ul{list-style:circle}
.aitext strong{font-weight:600;color:var(--fg)}
.aitext em{font-style:italic;color:rgba(var(--fr),.82)}
.aitext del{opacity:.6}
.aitext a{color:var(--fg);text-decoration:underline;text-decoration-color:rgba(var(--fr),.35);text-underline-offset:3px;overflow-wrap:anywhere}
.aitext blockquote{margin:0 0 .8em;padding:.2em 0 .2em 14px;border-left:2px solid rgba(var(--fr),.25);color:rgba(var(--fr),.7)}
.hr{height:1px;margin:1.2em 0;background:linear-gradient(90deg,transparent,rgba(var(--fr),.28),transparent)}
.ic{padding:.12em .4em;border-radius:7px;background:rgba(var(--fr),.08);font:13px ui-monospace,Menlo,monospace}
.cb{margin:0 0 .85em;border-radius:16px;overflow:hidden;background:rgba(var(--fr),.05);box-shadow:inset 0 0 0 1px rgba(var(--fr),.08)}
.cbh{display:flex;justify-content:space-between;align-items:center;padding:7px 8px 7px 14px;font-size:12px;color:rgba(var(--fr),.5);background:rgba(var(--fr),.04)}
.cpy{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:99px;font-size:12px;color:rgba(var(--fr),.7);background:rgba(var(--fr),.06);cursor:pointer}
.cb pre{display:block;padding:12px 14px;overflow-x:auto;font:13px/1.6 ui-monospace,Menlo,monospace;white-space:pre;tab-size:2}
.tbl{margin:0 0 .85em;overflow-x:auto;border-radius:14px;box-shadow:inset 0 0 0 1px rgba(var(--fr),.1)}
.tbl table{border-collapse:collapse;width:100%;font-size:14px}
.tbl th,.tbl td{padding:8px 12px;white-space:nowrap}.tbl th{font-weight:600;background:rgba(var(--fr),.06)}
.tbl tr+tr td{border-top:1px solid rgba(var(--fr),.07)}

/* maths */
.mx{font-family:'STIX Two Text','Latin Modern Math','Cambria Math','Times New Roman',serif;font-size:1.08em;line-height:1.25;white-space:nowrap;letter-spacing:0}
.mx i{font-style:italic}
.mx .mt{font-family:'Inter',system-ui,sans-serif;font-style:normal;font-size:.92em;white-space:pre;letter-spacing:-.01em}
.mx .ce{font-family:'STIX Two Text','Times New Roman',serif;font-size:1em}
.mx .fnx{margin-right:.17em}
.mx .mo{margin:0 .24em}.mx .mc{margin-right:.17em}.mx .ph{margin-left:.1em;font-size:.85em}
.mx sup,.mx sub{font-size:.7em;line-height:0;position:relative;vertical-align:baseline}
.mx sup{top:-.52em}.mx sub{top:.3em}
.mxd{display:block;margin:.6em 0 .9em;padding:.3em 0;font-size:1.2em;text-align:center;overflow-x:auto;overflow-y:hidden;max-width:100%}
.mx .bg{font-size:1.5em;line-height:1;vertical-align:-.12em}
.mx .fr{display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;margin:0 .1em;font-size:.94em;text-align:center}
.mx .fr>span{display:block;padding:0 .2em;line-height:1.3}
.mx .fr>.nu{border-bottom:1.4px solid currentColor}
.mx .fr.nb>.nu{border-bottom:0}
.mx .sq{display:inline-flex;align-items:stretch;vertical-align:middle}
.mx .rd{display:block;flex:none;width:.8em;margin-right:-.02em}.mx .rd svg{display:block;width:100%;height:100%;overflow:visible}
.mx .ra{border-top:1.5px solid currentColor;padding:.1em .15em 0 .08em;margin-top:.1em}
.mx .si{align-self:flex-start;margin-right:-.5em;position:static}
.mx .ss{display:inline-flex;align-items:center}
.mx .sb{display:inline-flex;flex-direction:column;font-size:.72em;line-height:1.1;margin-left:.04em}
.mx .sb sup,.mx .sb sub{position:static;font-size:1em;vertical-align:baseline}
.mx .lm{display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;text-align:center}
.mx .ls{font-size:.7em;line-height:1.1}.mx .ls:empty{display:none}
.mx .lr{display:inline-flex;align-items:center}
.mx .tl>.pn{font-size:1.7em;font-weight:300;line-height:.6}
.mx .ov{display:inline-block;border-top:1.4px solid currentColor;line-height:1.1}
.mx .un{display:inline-block;border-bottom:1.4px solid currentColor}
.mx .ac{display:inline-flex;flex-direction:column;align-items:center;line-height:1;vertical-align:baseline}
.mx .ag{font-size:.7em;line-height:.5;height:.55em}
.mx .sty-b{font-weight:700}.mx .sty-c{font-family:'Snell Roundhand','Apple Chancery',cursive;font-style:italic}
.mx .bx{display:inline-block;padding:.1em .35em;border:1.5px solid currentColor;border-radius:4px}
.mx .stk{display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;line-height:1.1}.mx .stk small{font-size:.7em}
.mx .xa{display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;margin:0 .3em;min-width:2.4em;line-height:1.15}
.mx .xa small{font-size:.72em;min-height:.9em}
.mx .xl{position:relative;align-self:stretch;height:.9em}
.mx .xl::before{content:"";position:absolute;left:0;right:.05em;top:50%;height:1.5px;background:currentColor}
.mx .xl::after{content:"";position:absolute;right:.02em;top:50%;width:.34em;height:.34em;border-top:1.5px solid currentColor;border-right:1.5px solid currentColor;transform:translateY(-50%) rotate(45deg)}
.mx .xl.lf{transform:scaleX(-1)}.mx .xg{font-size:1.5em;line-height:.8}
.mx .mxe{display:inline-block;vertical-align:middle;padding:.1em .45em;margin:0 .15em}
.mx .mxg{display:inline-grid;gap:.25em 1em}.mx .mc2{white-space:nowrap}
.mx .pmatrix{border-left:1.5px solid currentColor;border-right:1.5px solid currentColor;border-radius:.7em/50%}
.mx .vmatrix,.mx .Vmatrix{border-left:1.5px solid currentColor;border-right:1.5px solid currentColor}
.mx .Vmatrix{box-shadow:-.2em 0 0 -.1em currentColor}
.mx .bmatrix,.mx .Bmatrix{border-left:1.5px solid currentColor;border-right:1.5px solid currentColor;background:linear-gradient(currentColor,currentColor) left top/.3em 1.5px no-repeat,linear-gradient(currentColor,currentColor) left bottom/.3em 1.5px no-repeat,linear-gradient(currentColor,currentColor) right top/.3em 1.5px no-repeat,linear-gradient(currentColor,currentColor) right bottom/.3em 1.5px no-repeat}
.mx .cases{border-left:1.5px solid currentColor;border-radius:.6em 0 0 .6em/45% 0 0 45%;padding-left:.7em}

/* cards */
.kc{margin:8px 0 14px;border-radius:24px;overflow:hidden;max-width:100%;animation:rise .21s cubic-bezier(.2,.8,.2,1) both}
.kh{display:flex;align-items:center;gap:9px;padding:12px 16px 4px 12px;font-size:13px;color:rgba(var(--fr),.5)}
.kh b{font-weight:600;color:rgba(var(--fr),.88);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kh .chip{width:28px;height:28px}.kh>span:last-child:not(.chip){margin-left:auto;font-size:11.5px;opacity:.7;white-space:nowrap}
.kerr{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px 16px;font-size:13.5px;color:rgba(var(--fr),.6)}
.skl{margin:10px 16px 16px;height:96px;border-radius:16px;background:rgba(var(--fr),.07);animation:skp 1.3s ease-in-out infinite}
.wx{padding:6px 16px 12px}
.wxt{display:flex;justify-content:space-between;align-items:center;gap:12px}
.wxn{font-size:17px;font-weight:600}.wxs{font-size:12.5px;color:rgba(var(--fr),.5);margin-top:1px}
.wxd{font-size:60px;font-weight:300;letter-spacing:-.05em;line-height:1;margin-top:8px}
.wxi{display:flex;flex-direction:column;align-items:center;gap:6px;max-width:42%;font-size:13px;text-align:center;color:rgba(var(--fr),.72)}
.wxi svg{animation:bob 5s ease-in-out infinite;filter:drop-shadow(0 0 14px rgba(var(--fr),.35))}
.wxg{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:14px 0 8px}
.st{display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 4px;border-radius:14px;background:rgba(var(--fr),.05);font-size:11px;color:rgba(var(--fr),.5);text-align:center}
.st b{font-size:13.5px;color:var(--fg);font-weight:600;white-space:nowrap}
.wxr{display:grid;grid-template-columns:42px 22px 30px 1fr 30px;align-items:center;gap:8px;padding:8px 0;font-size:13.5px;border-top:1px solid rgba(var(--fr),.06)}
.wxr .lo{text-align:right;color:rgba(var(--fr),.5)}.wxr .hi{font-weight:600}
.rb{position:relative;height:5px;border-radius:9px;background:rgba(var(--fr),.08)}
.rb i{position:absolute;top:0;bottom:0;border-radius:9px;background:linear-gradient(90deg,rgba(var(--fr),.4),var(--fg))}
.trks{padding:4px 0 8px}
.trk{position:relative;display:flex;align-items:center;gap:12px;padding:8px 12px;cursor:pointer;transition:background .12s}
.trk:hover,.trk.on{background:rgba(var(--fr),.06)}
.art{position:relative;display:grid;place-items:center;width:48px;height:48px;flex:none;border-radius:12px;overflow:hidden;background:rgba(var(--fr),.08) center/cover no-repeat}
.art::before{content:"";position:absolute;inset:0;background:rgba(0,0,0,.3)}.art svg{position:relative}
.tm{flex:1;min-width:0}.tm b{display:block;font-size:14.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tm span{display:block;font-size:12.5px;color:rgba(var(--fr),.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eq{display:flex;align-items:flex-end;gap:2px;height:14px;flex:none}
.eq i{width:3px;height:100%;border-radius:2px;background:var(--fg);transform-origin:bottom;animation:eq .9s ease-in-out infinite}
.eq i:nth-child(2){animation-delay:-.3s}.eq i:nth-child(3){animation-delay:-.6s}
.pg{position:absolute;left:12px;right:12px;bottom:2px;height:2px;border-radius:2px;background:rgba(var(--fr),.08);overflow:hidden}
.pg i{display:block;height:100%;background:var(--fg);transform-origin:left;transform:scaleX(0)}
.gal{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px 10px 10px}
.gal figure{position:relative;aspect-ratio:1;border-radius:16px;overflow:hidden;background:rgba(var(--fr),.06);cursor:zoom-in}
.gal.l1 figure,.gal.l3 figure:first-child{grid-column:1/-1;aspect-ratio:16/10}
.gal.l1{grid-template-columns:1fr}
.gal img{display:block;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .21s}.gal img.ld{opacity:1}
.gal figcaption{position:absolute;left:0;right:0;bottom:0;padding:22px 10px 8px;font-size:11px;color:rgba(var(--fr),.85);background:linear-gradient(transparent,rgba(0,0,0,.7));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
.lbx{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:18px;background:rgba(0,0,0,.9);animation:fadein .12s both;cursor:zoom-out}
.lbx img{max-width:100%;max-height:78%;border-radius:14px;object-fit:contain}
.lbx-x{position:absolute;top:calc(14px + env(safe-area-inset-top,0px));right:14px}
.cc{display:flex;align-items:center;gap:14px;padding:8px 16px 6px}
.av{display:grid;place-items:center;width:56px;height:56px;flex:none;border-radius:50%;font-size:19px;font-weight:600;background:linear-gradient(160deg,rgba(var(--fr),.22),rgba(var(--fr),.05));box-shadow:inset 0 1px 0 rgba(var(--fr),.35)}
.cn{min-width:0}.cn b{display:block;font-size:17px;font-weight:600}.cn span{font-size:13px;color:rgba(var(--fr),.55)}
.cl{display:flex;flex-direction:column;padding:4px 8px}
.cr2{display:flex;align-items:center;gap:12px;padding:9px 10px;border-radius:14px;font-size:14px;min-width:0}
.cr2:hover{background:rgba(var(--fr),.05)}.cr2 svg{opacity:.6;flex:none}.cr2 span{min-width:0;overflow-wrap:anywhere}
.cact{display:flex;flex-wrap:wrap;gap:8px;padding:6px 14px 14px}
.pls{padding:4px 6px 8px}
.pl{padding:10px 10px 12px;border-radius:16px}.pl+.pl{border-top:1px solid rgba(var(--fr),.06)}
.pl-t{display:flex;align-items:center;justify-content:space-between;gap:10px}
.pl-t b{display:block;font-size:15px;font-weight:600}.pl-t span{font-size:12.5px;color:rgba(var(--fr),.5)}
.pl p{margin:6px 0 0;font-size:13.5px;line-height:1.55;color:rgba(var(--fr),.72)}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.tags em{font-style:normal;padding:3px 10px;border-radius:99px;font-size:11.5px;background:rgba(var(--fr),.07);color:rgba(var(--fr),.7)}
.tabs{display:flex;gap:6px;padding:8px 14px 2px;overflow-x:auto;scrollbar-width:none}
.tl{padding:10px 16px 8px 8px;animation:fadein .13s both}
.stp{position:relative;display:flex;gap:10px;padding-bottom:16px}
.stp time{flex:none;width:44px;padding-top:2px;text-align:right;font-size:12px;color:rgba(var(--fr),.5);font-variant-numeric:tabular-nums}
.stp .dt{position:relative;flex:none;width:9px;margin-top:6px}
.stp .dt::before{content:"";display:block;width:9px;height:9px;border-radius:50%;background:var(--fg);box-shadow:0 0 12px rgba(var(--fr),.5)}
.stp .dt::after{content:"";position:absolute;left:4px;top:14px;bottom:-22px;width:1px;background:rgba(var(--fr),.14)}
.stp:last-child .dt::after{display:none}
.stp b{display:block;font-size:14.5px;font-weight:600}.stp p{margin:3px 0 0;font-size:13px;line-height:1.5;color:rgba(var(--fr),.6)}
.stp>div:last-child{min-width:0}
.src{margin-top:14px;display:flex;flex-direction:column;gap:9px}
.sqr{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:12px;color:rgba(var(--fr),.5)}
.sqr em{font-style:normal;padding:3px 10px;border-radius:99px;background:rgba(var(--fr),.06);color:rgba(var(--fr),.75)}
.srow{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none;scroll-snap-type:x proximity}
.scd{flex:none;display:flex;align-items:center;gap:10px;width:196px;padding:10px 12px;border-radius:16px;scroll-snap-align:start}
.scd>div{flex:1;min-width:0}.scd b{display:block;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.scd span:not(.fv){display:block;font-size:11.5px;color:rgba(var(--fr),.45)}.scd>svg{opacity:.45;flex:none}
.fv{display:grid;place-items:center;width:26px;height:26px;flex:none;border-radius:8px;background:rgba(var(--fr),.08)}
@media(prefers-reduced-motion:reduce){.aura *,.aura *::before,.aura *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;

/* ── Speech: streamed text-to-speech and dictation ──────── */
const getSR = (): any => (typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null) || null;
const cleanSpeech = (t) => t.replace(/```[\s\S]*?(```|$)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/\bui:\w+\s*\{.*\}/g, " ").replace(/\$[^$]*\$/g, " ").replace(/[*_`#>~|]/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s+/g, " ").trim();
// Speaks a queue of sentences one after another (long utterances get cut off on Android, so we keep them short).
/* Text-to-speech: ElevenLabs first, optional Coqui server as backup. No browser voices; failures are reported to the UI. */
const EL_MODELS = [["eleven_flash_v2_5", "Flash v2.5 · fastest"], ["eleven_turbo_v2_5", "Turbo v2.5"], ["eleven_multilingual_v2", "Multilingual v2 · best quality"], ["eleven_v3", "v3 · expressive"]];
const DEF_VOICE = "JBFqnCBsd6RMkjVDRZzb";
let ENV_EL = ""; try { ENV_EL = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY || ""; } catch (e) {}
const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
const cleanKey = (k) => String(k || "").replace(/^\s*(xi-api-key\s*[:=]\s*|bearer\s+)/i, "").replace(/["'\s\u200b-\u200d\ufeff]/g, "");
const elKey = () => cleanKey(lsGet("epique.el") || ENV_EL), elVoice = () => lsGet("epique.elv") || DEF_VOICE, elModel = () => lsGet("epique.elm") || EL_MODELS[0][0], coquiUrl = () => lsGet("epique.coqui");
const saveLS = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
let ttsSink: any = null, lastTtsErr: any = [0, ""];
const reportTts = (m) => { const n = Date.now(); if (lastTtsErr[1] === m && n - lastTtsErr[0] < 4000) return; lastTtsErr = [n, m]; ttsSink?.(m); };
const brief = (t, n = 450) => { if (t.length <= n) return t; const c = t.slice(0, n), i = Math.max(c.lastIndexOf(". "), c.lastIndexOf("! "), c.lastIndexOf("? ")); return i > 120 ? c.slice(0, i + 1) : c; };
const blobAudio = async (r) => { const u = URL.createObjectURL(await r.blob()), a = new Audio(u); a.addEventListener("ended", () => URL.revokeObjectURL(u)); return a; };
const elFail = async (r, m?) => {
  let st = "", msg = ""; try { const j = await r.json(), d = j?.detail; st = d?.status || ""; msg = d?.message || (typeof d === "string" ? d : ""); } catch (e) {}
  const hint = st === "quota_exceeded" ? "You've used all your ElevenLabs credits." : st === "detected_unusual_activity" ? "ElevenLabs paused the free plan for this connection (VPN or proxy). Turn it off or upgrade." : st === "missing_permissions" || /permission/i.test(msg) ? "This key lacks access. Turn on Text to Speech and Voices (read) for the key." : r.status === 401 ? "ElevenLabs didn't accept this key. Copy it again from elevenlabs.io (Developers > API Keys)." : r.status === 429 ? "Too many requests. Wait a moment." : "";
  return new Error(`ElevenLabs ${r.status}${st ? " · " + st : ""}${m ? " on " + m : ""}. ${hint || msg}`.trim());
};
const elAudio = async (t) => {
  const k = elKey(), m = elModel();
  if (!k) throw new Error("ElevenLabs key missing. Add it in Settings, or clear the Coqui address to use your phone\u2019s voice.");
  let r;
  try { r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elVoice()}?output_format=mp3_44100_64`, { method: "POST", signal: AbortSignal.timeout?.(20000), headers: { "xi-api-key": k, "Content-Type": "application/json", Accept: "audio/mpeg" }, body: JSON.stringify({ text: t, model_id: m }) }); }
  catch (e) { throw new Error(e?.name === "TimeoutError" ? `ElevenLabs timed out (${m}).` : `Could not reach ElevenLabs: ${e?.message || e}`); }
  if (!r.ok) throw await elFail(r, m);
  return blobAudio(r);
};
const coquiAudio = async (t) => {
  const r = await fetch(`${coquiUrl().replace(/\/+$/, "")}/api/tts?text=${encodeURIComponent(t)}`, { signal: AbortSignal.timeout?.(25000) });
  if (!r.ok) throw new Error(`Coqui ${r.status}`);
  return blobAudio(r);
};
/* The phone's own voice: used whenever no cloud voice (ElevenLabs / Coqui) is configured, so replies are always spoken and no key is ever required. */
const cloudVoice = () => !!(elKey() || coquiUrl());
const deviceSpeak = (text: string, rate?: number): Promise<void> => {
  if (actions.tts) return actions.tts({ op: "speak", text, rate: rate || 1, lang: navigator.language || "en-US" }).catch(() => {});
  return new Promise<void>((res) => { try { const u = new SpeechSynthesisUtterance(text); u.rate = rate || 1; u.onend = () => res(); u.onerror = () => res(); speechSynthesis.speak(u); } catch (e) { res(); } });
};
const deviceStop = () => { try { if (actions.tts) { actions.tts({ op: "stop" }).catch(() => {}); } else if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); } catch (e) {} };
const getAudio = async (t) => {
  try { return await elAudio(t); }
  catch (e) { if (!coquiUrl()) throw e; try { return await coquiAudio(t); } catch (e2) { throw new Error(`${e.message} Coqui backup also failed: ${e2.message}`); } }
};
const tts = (() => {
  let a = null, id = 0, end = null;
  const parts = (t) => { const o = []; let c = ""; for (const x of t.match(/[^.!?\n]+[.!?]*\s*/g) || [t]) { if ((c + x).length > 260 && c) { o.push(c); c = ""; } c += x; } if (c.trim()) o.push(c); return o; };
  const stop = () => { id++; try { a?.pause(); } catch (e) {} a = null; deviceStop(); const f = end; end = null; f?.(); };
  const play = (text, rate, done?) => {
    stop(); const my = id, list = parts(brief(cleanSpeech(text))); end = done;
    const fin = () => { if (my === id) { end = null; done?.(); } };
    if (!cloudVoice()) { (async () => { for (const part of list) { if (my !== id) return; await deviceSpeak(part, rate); } fin(); })(); return; }
    const pre = [], get = (i) => pre[i] || (pre[i] = getAudio(list[i]), pre[i].catch(() => {}), pre[i]);
    const next = async (i) => {
      if (my !== id) return; if (i >= list.length) return fin();
      let au; try { au = await get(i); } catch (e) { if (my === id) { reportTts(e.message); fin(); } return; }
      if (my !== id) return; a = au; if (list[i + 1]) get(i + 1);
      const bad = (e?) => { if (my !== id) return; reportTts(e?.message ? "Audio playback failed: " + e.message : "Audio playback failed."); fin(); };
      au.playbackRate = rate || 1; au.onended = () => next(i + 1); au.onerror = () => bad(); au.play().catch(bad);
    };
    next(0);
  };
  return { play, stop };
})();
function makeSpeaker(cfg) {
  let q = [], busy = false, dead = false, gen = 0, waiters = [], au = null;
      const idle = () => { if (!busy && !q.length) { waiters.forEach((r) => r()); waiters = []; } };
  const pump = () => {
    if (busy || dead) return;
    const t = q.shift(); if (!t) return idle();
    busy = true; const g = gen; let tm;
    const done = () => { if (g !== gen || !busy) return; clearTimeout(tm); try { au?.pause(); } catch (e) {} busy = false; pump(); };
    tm = setTimeout(done, Math.min(25000, 3000 + t.length * 90));
    if (!cloudVoice()) { deviceSpeak(t, cfg.rate).then(done, done); return; }
    const bad = (e?) => { if (g !== gen) return; reportTts(e?.message || "Audio playback failed."); done(); };
    getAudio(t).then((x) => { if (g !== gen) return; au = x; au.playbackRate = cfg.rate || 1; au.onended = done; au.onerror = () => bad(); return au.play(); }).catch(bad);
  };
  return {
    say(t) { t = cleanSpeech(t); if (t) { q.push(t); pump(); } },
    stop() { gen++; q = []; busy = false; try { au?.pause(); } catch (e) {} deviceStop(); idle(); },
    idle() { return !busy && !q.length ? Promise.resolve() : new Promise((r) => waiters.push(r)); },
    kill() { dead = true; this.stop(); },
  };
}
// Turns a growing reply into whole sentences so speech can start before the reply finishes.
function sentenceFeeder(say) {
  let done = 0, first = true;
  return (full, final) => {
    const rest = full.slice(done), re = /[.!?…]+["')\]]*(?=\s)|\n+/g; let cut = -1, m;
    while ((m = re.exec(rest))) cut = m.index + m[0].length;
    if (final) cut = rest.length;
    if (cut > (first ? 8 : 26) || (final && cut > 0)) { say(rest.slice(0, cut)); done += cut; first = false; }
  };
}
function useDictation(getText, setText) {
  const [on, setOn] = useState<any>(false), r = useRef<any>({});
  const stop = useCallback(() => { r.current.on = false; try { r.current.rec?.abort(); } catch (e) {} setOn(false); }, []);
  const start = useCallback(() => {
    const SR = getSR(); if (!SR) return;
    const s = r.current; s.on = true; s.base = getText(); setOn(true);
    const go = () => {
      if (!s.on) return;
      const rec = new SR(); rec.lang = navigator.language || "en-US"; rec.interimResults = true; rec.continuous = false; s.rec = rec;
      rec.onresult = (e) => {
        let fin = "", it = ""; for (let i = 0; i < e.results.length; i++) { const x = e.results[i]; if (x.isFinal) fin += x[0].transcript; else it += x[0].transcript; }
        setText(s.base + (s.base && !/\s$/.test(s.base) ? " " : "") + (fin + it).trimStart());
      };
      rec.onerror = (e) => { if (/not-allowed|service-not-allowed|audio-capture/.test(e.error)) { s.on = false; setOn(false); } };
      rec.onend = () => { if (!s.on) return; s.base = getText(); setTimeout(go, 120); };
      try { rec.start(); } catch (e) {}
    };
    go();
  }, []); // eslint-disable-line
  useEffect(() => () => stop(), [stop]);
  return { on, toggle: () => (on ? stop() : start()), stop, ok: !!getSR() };
}

/* ── Live voice: hands-free, live transcript, streamed replies ── */
const LAYERS = [
  { f: 1.5, v: 0.0021, p: 0, a: 1, al: 0.95 },
  { f: 2.3, v: -0.0028, p: 1.7, a: 0.72, al: 0.5 },
  { f: 3.1, v: 0.0034, p: 3.1, a: 0.5, al: 0.32 },
  { f: 1.1, v: -0.0016, p: 4.6, a: 0.9, al: 0.2 },
];
const LABEL = { listening: "Listening", thinking: "Thinking", speaking: `${NAME} is speaking` };

function Live({ onTurn, onAbort, onClose, cfg, assistant }: any) {
  const cv = useRef<any>(undefined);
  const S = useRef<any>({ phase: "listening", lvl: 0, act: 0, muted: false });
  const [phase, setPhase] = useState<any>("listening"), [muted, setMuted] = useState<any>(false), [cap, setCap] = useState<any>(""), [err, setErr] = useState<any>(null);

  useEffect(() => {
    const s = S.current, sp = makeSpeaker(cfg), coarse = !!window.matchMedia?.("(pointer:coarse)").matches;
    let raf, ac, an, stream, data, dead = false, fails = 0, col = "255,255,255", colT = -1e9;
    const go = (p) => { s.phase = p; setPhase(p); player.duck(p === "listening" ? 0.18 : 0.4); };

    const turn = async (text) => {
      setCap(""); fails = 0; go("thinking");
      const feed = sentenceFeeder((x) => sp.say(x)); let seen = "";
      const out = await onTurn(text, { onDelta: (full) => { if (dead) return; seen = full; if (s.phase === "thinking") go("speaking"); feed(full, false); } });
      if (dead) return;
      const spoken = seen.length >= (out || "").length ? seen : out;
      if (spoken) { if (s.phase === "thinking") go("speaking"); feed(spoken, true); }
      await sp.idle(); if (dead) return;
      await sleep(250); if (dead) return;
      go("listening"); listen();
    };
    s.interrupt = () => { sp.stop(); onAbort(); };

    const listen = () => {
      const SR = getSR(); if (!SR || dead || s.fatal || s.muted || s.phase !== "listening") return;
      const rec = new SR(), t0 = Date.now(); let fin = "", it = "";
      rec.lang = navigator.language || "en-US"; rec.interimResults = true; rec.continuous = false;
      rec.onspeechstart = () => { s.act = 1; };
      rec.onresult = (e) => {
        fin = ""; it = ""; for (let i = 0; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) fin += r[0].transcript; else it += r[0].transcript; }
        s.act = 1; setCap((fin + it).trim());
      };
      rec.onerror = (e) => {
        const c = e.error;
        if (c === "not-allowed") { s.fatal = true; setErr(e.message === "blocked" ? { k: "blocked", m: "Microphone is turned off for " + NAME + "." } : { k: "perm", m: "Allow the microphone to start talking." }); }
        else if (c === "service-not-allowed") { s.fatal = true; setErr({ k: "svc", m: "Speech recognition isn't available on this phone. Enable the Google app's voice service." }); }
        else if (c === "language-not-supported") { s.fatal = true; setErr({ k: "svc", m: "Your language isn't supported by the speech service." }); }
        else if (c === "audio-capture") { s.fatal = true; setErr({ k: "mic", m: "No microphone was found." }); }
        else if (c === "network") { s.fatal = true; setErr({ k: "net", m: "Speech recognition needs an internet connection." }); }
      };
      rec.onend = () => {
        if (dead || s.fatal || s.muted || s.phase !== "listening") return;
        const heard = (fin || it).trim();
        if (heard) turn(heard);
        else { fails = Date.now() - t0 < 700 ? fails + 1 : 0; if (fails > 6) { s.fatal = true; setErr({ k: "mic", m: "Can't hear anything. Tap the mic to try again." }); } else setTimeout(listen, 200); }
      };
      s.rec = rec; try { rec.start(); } catch (e) {}
    };
    s.listen = listen;
    if (!getSR()) setErr({ k: "svc", m: "Voice recognition isn't supported here." });
    // Desktop only: a second mic stream drives the level meter. On phones it fights speech recognition, so we animate from speech events instead.
    if (!coarse && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then((st) => {
        if (dead) { st.getTracks().forEach((t) => t.stop()); return; }
        stream = st; ac = new (window.AudioContext || (window as any).webkitAudioContext)(); an = ac.createAnalyser(); an.fftSize = 512; data = new Uint8Array(an.fftSize); ac.createMediaStreamSource(st).connect(an);
      }).catch(() => {});
    }
    go("listening"); listen();

    // A horizontal chain of bubbles (the logo, stretched out). Each bubble swells with your voice and the swell travels along the chain.
    const t0 = performance.now();
    const frame = (now) => {
      const t = now - t0; let g = 0;
      if (s.phase === "listening") {
        if (an && !s.muted) { an.getByteTimeDomainData(data); let q = 0; for (let i = 0; i < data.length; i++) { const d = (data[i] - 128) / 128; q += d * d; } g = Math.min(1, Math.sqrt(q / data.length) * 7); }
        else if (!s.muted) { g = s.act * (0.3 + 0.4 * Math.abs(Math.sin(t / 95) * Math.sin(t / 260 + 1))); s.act *= 0.96; }
      } else if (s.phase === "thinking") g = 0.08;
      else g = 0.3 + 0.4 * Math.abs(Math.sin(t / 150) * Math.sin(t / 430 + 1));
      s.lvl += (g - s.lvl) * 0.22;
      const c = cv.current;
      if (c) {
        const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
        if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
        const x = c.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
        if (now - colT > 600) { colT = now; const m = (getComputedStyle(c).color || "").match(/[\d.]+/g); if (m && m.length >= 3) col = m.slice(0, 3).join(","); }
        const n = Math.max(11, Math.min(27, Math.round(w / 20))) | 1, pad = 16, step = (w - pad * 2) / (n - 1), mid = (n - 1) / 2, ent = Math.min(1, t / 380);
        for (let i = 0; i < n; i++) {
          const u = (i - mid) / mid, bell = Math.exp(-u * u * 1.7), ph = i * 0.62 - t * 0.0075;
          const wv = 0.5 + 0.5 * Math.sin(ph) * Math.sin(i * 0.27 + t * 0.0021);
          let r = 2.4 + bell * 2.8 + s.lvl * bell * (4 + 13 * wv);
          if (s.phase === "thinking") r += (0.5 + 0.5 * Math.sin(t * 0.006 - i * 0.55)) * 3 * bell;
          r = Math.min(r * ent, step * 0.86);
          const y = h / 2 + Math.sin(ph * 0.9) * s.lvl * h * 0.15 * bell, a = Math.min(1, 0.3 + bell * 0.4 + s.lvl * 0.45);
          x.fillStyle = `rgba(${col},${a.toFixed(2)})`; x.beginPath(); x.arc(pad + i * step, y, Math.max(1.5, r), 0, 6.2832); x.fill();
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      dead = true; cancelAnimationFrame(raf); sp.kill(); player.duck(1);
      try { s.rec?.abort(); } catch (e) {}
      stream?.getTracks().forEach((t) => t.stop()); ac?.close?.();
    };
  }, []); // eslint-disable-line

  const retry = () => { const s = S.current; s.fatal = false; setErr(null); s.muted = false; setMuted(false); s.listen?.(); };
  const toggleMute = () => {
    const s = S.current;
    if (s.fatal && getSR()) return retry();
    s.muted = !s.muted; setMuted(s.muted);
    if (s.muted) { try { s.rec?.abort(); } catch (e) {} setCap(""); } else s.listen?.();
  };
  const busy = phase !== "listening";
  const line = err ? err.m : cap || (muted && !busy ? "Mic muted" : phase === "speaking" ? "Tap to interrupt" : LABEL[phase]);
  return (
    <div className="lv">
      <div className="lvcard">
        <div className={"lvc" + (cap && !err ? "" : " dim")} key={err ? "e" : cap ? "c" : phase}>{line}</div>
        {err && <div className="lvact">{err.k === "blocked" && <button className="tg on" onClick={() => actions.openSettings?.()}>Open settings</button>}<button className={"tg" + (err.k === "blocked" ? "" : " on")} onClick={retry}>Try again</button></div>}
        <div className="lvmid" onClick={() => busy && S.current.interrupt?.()}><canvas className="lvw" ref={cv} /></div>
        <div className="lvbtns">
          <button className={"ib ghost lvb" + (muted ? " lit" : "")} aria-label="Toggle microphone" onClick={toggleMute}>{muted ? <MicOff size={19} {...ico} /> : <Mic size={19} {...ico} />}</button>
          <button className="ib ghost lvb" aria-label="End live voice" onClick={onClose}><X size={19} {...ico} /></button>
        </div>
      </div>
    </div>
  );
}

/* ── Home ───────────────────────────────────────────────── */
const TRY = [
  { I: Crown, t: "Play chess", s: "A quick game with me", q: "Let's play chess" },
  { I: LayoutGrid, t: "Build a widget", s: "Trackers, counters, planners", q: "Build me a habit tracker widget with checkboxes and a progress bar" },
  { I: Trophy, t: "Sports", s: "Latest scores and results", q: "Show me the latest sports scores and results" },
  { I: Newspaper, t: "Top news", s: "Fresh headlines", q: "What's in the news today?" },
  { I: ListChecks, t: "Plan my day", s: "Tasks and a reminder", q: "Make me a task list for a productive day and remind me to drink water in 30 minutes" },
  { I: Lightbulb, t: "Explain with maths", s: "The mole concept, worked", q: "Explain the mole concept with a worked example" },
  { I: Globe, t: "Search the web", s: "Today's tech headlines", q: "What are the biggest tech news stories today? Search the web." },
  { I: MapIcon, t: "Find a place", s: "Coffee near me, on a map", q: "Find good coffee shops near me and show them on a map" },
  { I: Music2, t: "Play music", s: "Afrobeats to start the day", q: "Play me some good Afrobeats" },
  { I: Code, t: "Build something", s: "A tiny app with live preview", q: "Build a clean pomodoro timer as a single HTML file so I can preview it" },
  { I: HelpCircle, t: "Quiz me", s: "Five questions on any topic", q: "Quiz me on O-Level chemistry" },
];
const useClock = () => { const [t, set] = useState<any>(new Date()); useEffect(() => { const i = setInterval(() => set(new Date()), 20000); return () => clearInterval(i); }, []); return t; };
function HomeWx() {
  const [s, set] = useState<any>(() => (LS.get("epique.geo", null) ? { st: "load" } : { st: "idle" }));
  const load = async (c) => {
    set({ st: "load" });
    try {
      const [w, n] = await Promise.all([once(`hw:${c.lat.toFixed(1)},${c.lon.toFixed(1)}`, () => getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,weather_code,is_day&timezone=auto`)), placeName(c).catch(() => ({}))]);
      set({ st: "ok", w: w.current, n });
    } catch (e) { set({ st: "err" }); }
  };
  useEffect(() => { const c = LS.get("epique.geo", null); if (c) load(c); }, []); // eslint-disable-line
  const ask = async () => { set({ st: "load" }); try { const c = await here(); LS.set("epique.geo", c); load(c); } catch (e) { set({ st: "err" }); } };
  if (s.st === "ok") { const x = wx(s.w.weather_code, s.w.is_day); return <span className="wxp"><x.I size={14} {...ico} />{Math.round(s.w.temperature_2m)}° {x.label}{s.n.city ? ` · ${s.n.city}` : ""}</span>; }
  return <button className="wxp ask" onClick={ask}><MapPin size={13} {...ico} />{s.st === "load" ? "Locating…" : s.st === "err" ? "Try location again" : "Show local weather"}</button>;
}
function Home({ prof, recent, model, onTry, onOpen }: any) {
  const now = useClock(), [k, setK] = useState<any>(0), [ph, setPh] = useState<any>(0);
  useEffect(() => { setPh(0); const t = setTimeout(() => setPh(1), 2600); return () => clearTimeout(t); }, [k]);
  const chips = ["Top news", "Plan my day", "Play music", "Build something"].map((n) => TRY.find((x) => x.t === n)).filter(Boolean);
  return (
    <div className="home">
      <button className="hlogo" aria-label="Replay" onClick={() => setK(k + 1)}><Mark size={84} fast={ph === 0} /></button>
      <div className="hline"><h1 key={k + ":" + ph} className={ph ? "mod" : ""}>{ph === 0 ? `Hello${prof.name ? `, ${prof.name}` : ""}` : model}</h1></div>
      <div className="glance" key={"g" + k}>
        <span>{now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span><i className="hdot" />
        <span>{now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span><HomeWx />
      </div>
      <div className="hchips" key={"c" + k}>{chips.map(({ I, t, q }, i) => <button key={t} style={{ animationDelay: `${0.25 + i * 0.05}s` }} onClick={() => onTry(q)}><I size={15} {...ico} />{t}</button>)}</div>
      {recent[0] && <button className="hrec" onClick={() => onOpen(recent[0].id)}>Continue · {recent[0].title}</button>}
    </div>
  );
}

/* ── Shared modal pieces ────────────────────────────────── */
const ensureFont = (f: any) => {
  if (!f?.g || typeof document === "undefined") return;
  const id = "epique-font-" + f.id; if (document.getElementById(id)) return;
  const l = document.createElement("link"); l.id = id; l.rel = "stylesheet"; l.href = `https://fonts.googleapis.com/css2?family=${f.g}&display=swap`; document.head.appendChild(l);
};
const plain = (t: any) => String(t || "").replace(/```[\s\S]*?```/g, " ").replace(/\$\$?[^$]*\$\$?/g, " ").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#*_`>|~]/g, "").replace(/\s+/g, " ").trim();
const preview = (c: any) => { const m = [...(c.msgs || [])].reverse().find((x: any) => x.role !== "user" && x.text) || (c.msgs || [])[c.msgs.length - 1]; return plain(m?.text).slice(0, 96); };

/** A key field with an explicit Save button and a visible saved / not set state. */
function KeyField({ label, hint, has, builtIn, onSave, onClear, onSaved }: any) {
  const [v, setV] = useState<any>(""), [ok, setOk] = useState<any>(false), [saved, setSaved] = useState<any>(!!has);
  const t = v.trim();
  const commit = () => { if (!t) return; onSave(t); setV(""); setSaved(true); setOk(true); setTimeout(() => setOk(false), 1800); onSaved?.(t); };
  return (
    <div className="kf">
      <div className="kfh"><span>{label}</span><em className={ok || saved || builtIn ? "ok" : ""}>{ok ? "Saved" : saved ? "Saved on this device" : builtIn ? "Built in" : "Not set"}</em></div>
      <div className="kfr">
        <input type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={v} placeholder={saved || builtIn ? "Paste a new key to replace" : "Paste your key"}
          onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
        <button className={"kbtn" + (t ? " go" : "")} disabled={!t} onClick={commit}>{ok ? <Check size={16} {...ico} /> : "Save"}</button>
      </div>
      {hint && <p className="mhint">{hint}</p>}
      {saved && <button className="klink" onClick={() => { onClear(); setSaved(false); }}>Remove key</button>}
    </div>
  );
}

/* ── Settings (minimal modal) ───────────────────────────── */
const Seg = ({ value, opts, on }: any) => <div className="mseg">{opts.map(([k, n]) => <button key={k} className={value === k ? "on" : ""} onClick={() => on(k)}>{n}</button>)}</div>;
function SettingsModal({ prof, cfg, setCfg, onProfile, onClose, onClearChats }: any) {
  const [vl, setVl] = useState<any>([]), [vv, setVv] = useState<any>(elVoice()), [vopen, setVopen] = useState<any>(false), [vq, setVq] = useState<any>(""), [msg, setMsg] = useState<any>(""), [sure, setSure] = useState<any>(false), [busy, setBusy] = useState<any>(false), [hasEl, setHasEl] = useState<any>(() => !!elKey());
  useEffect(() => { const prev = ttsSink; ttsSink = (m) => setMsg(m); return () => { ttsSink = prev; }; }, []);
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  useEffect(() => { FONTS.forEach(ensureFont); }, []);
  const loadVoices = async () => {
    const k = elKey(); if (!k) return setMsg("Add your ElevenLabs key first.");
    setBusy(true);
    try {
      let r = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100&sort=name&sort_direction=asc", { headers: { "xi-api-key": k } });
      if (r.status === 404) r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": k } });
      if (!r.ok) throw await elFail(r, "voices");
      const j = await r.json();
      setVl((j.voices || []).map((v) => ({ id: v.voice_id, name: v.name + (v.labels?.accent ? " · " + v.labels.accent : "") }))); setMsg("");
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };
  useEffect(() => { if (elKey()) loadVoices(); }, []); // eslint-disable-line
  const pickFont = (f) => { ensureFont(f); setCfg({ font: f.id }); };
  const cur = vl.find((v) => v.id === vv)?.name || (vv === DEF_VOICE ? "George" : "Custom voice");
  const f = vq.trim().toLowerCase(), vlist = vl.filter((v) => !f || v.name.toLowerCase().includes(f));
  return (
    <>
      <div className="mscrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-label="Settings">
        <div className="mh"><h3>Settings</h3><button className="ib sm ghost" aria-label="Close" onClick={onClose}><X size={16} {...ico} /></button></div>
        <div className="mb">
          <div className="ms">Appearance</div>
          <div className="mr"><span>Theme</span><Seg value={cfg.theme} opts={[["dark", "Dark"], ["light", "Light"]]} on={(k) => setCfg({ theme: k })} /></div>
          <div className="mr"><span>Text size</span><Seg value={cfg.fs || "m"} opts={[["s", "S"], ["m", "M"], ["l", "L"]]} on={(k) => setCfg({ fs: k })} /></div>
          <div className="mr col"><span>Font</span><div className="fgrid">{FONTS.map((x) => <button key={x.id} className={"fchip" + ((cfg.font || "inter") === x.id ? " on" : "")} style={{ fontFamily: x.css }} onClick={() => pickFont(x)}>{x.n}</button>)}</div></div>

          <div className="ms">Keys</div>
          <KeyField label="Gemini" has={!!lsGet(KEY_STORE) || !!mem.key} builtIn={!!ENV_KEY} onSave={(t) => saveKey(t)} onClear={() => saveKey("")} />
          <KeyField label="ElevenLabs (optional)" hint="Not needed. Without it, replies are read in your phone's voice." has={!!lsGet("epique.el")} builtIn={!!ENV_EL} onSave={(t) => { saveLS("epique.el", cleanKey(t)); setMsg(""); setHasEl(true); }} onClear={() => { saveLS("epique.el", ""); setVl([]); setVopen(false); setHasEl(!!ENV_EL); }} onSaved={() => setTimeout(loadVoices, 50)} />

          <div className="ms">Voice</div>
          {hasEl ? <button className="mr pick" aria-expanded={vopen} onClick={() => setVopen(!vopen)}><span>Voice</span><b>{cur}</b><ChevronDown size={15} {...ico} style={{ transition: "transform .2s ease", transform: vopen ? "rotate(180deg)" : "none" }} /></button>
            : <div className="mr"><span>Voice</span><b className="mval">Phone voice</b></div>}
          {hasEl && vopen && (
            <div className="vbox">
              <input className="vs" value={vq} placeholder={vl.length ? "Search voices" : busy ? "Loading voices…" : "Voices load once your key is saved"} autoCapitalize="none" onChange={(e) => setVq(e.target.value)} />
              <div className="vlist">
                {!vl.length && <button className="vi on" onClick={() => { setVv(DEF_VOICE); saveLS("epique.elv", DEF_VOICE); setVopen(false); }}><span>George (default)</span><Check size={14} {...ico} /></button>}
                {vlist.map((v) => <button key={v.id} className={"vi" + (v.id === vv ? " on" : "")} onClick={() => { setVv(v.id); saveLS("epique.elv", v.id); setVopen(false); }}><span>{v.name}</span>{v.id === vv && <Check size={14} {...ico} />}</button>)}
                {!!vl.length && !vlist.length && <div className="mhint">No voices match.</div>}
              </div>
            </div>
          )}
          <label className="mr col"><span>Speed <b>{cfg.rate.toFixed(1)}×</b></span><input className="mrange" type="range" min="0.7" max="1.5" step="0.1" value={cfg.rate} onChange={(e) => setCfg({ rate: +e.target.value })} /></label>
          <button className="mbtn" onClick={() => { setMsg(""); tts.play("Good evening. All systems are online and ready.", cfg.rate); }}><Volume2 size={15} {...ico} />Play a sample</button>
          {msg && <p className="merr" role="alert">{msg}</p>}

          <div className="ms">You</div>
          <label className="mf"><span>Name</span><input value={prof.name} placeholder="What should I call you?" onChange={(e) => onProfile({ name: e.target.value })} /></label>
          <label className="mf"><span>About you</span><textarea rows={3} value={prof.about} placeholder="e.g. Form 4 student in Harare. Explain simply." onChange={(e) => onProfile({ about: e.target.value.slice(0, 600) })} /></label>
          {prof.mem.length > 0 && <div className="mems2">{prof.mem.map((m, i) => <div key={i} className="mem2"><span>{m}</span><button aria-label="Forget" onClick={() => onProfile({ mem: prof.mem.filter((_, j) => j !== i) })}><X size={13} {...ico} /></button></div>)}</div>}

          <div className="ms">Data</div>
          <button className={"mbtn" + (sure ? " danger" : "")} onClick={() => { if (sure) { setSure(false); onClearChats(); onClose(); } else { setSure(true); setTimeout(() => setSure(false), 3000); } }}><Trash2 size={15} {...ico} />{sure ? "Tap again to delete all chats" : "Clear chat history"}</button>
        </div>
      </div>
    </>
  );
}

/* ── Chats + models (one panel, two tabs) ───────────────── */
function Panel({ tab, setTab, chats, cid, model, onModel, onOpen, onNew, onRename, onDelete, onPin, onClose }: any) {
  const [q, setQ] = useState<any>(""), [act, setAct] = useState<any>(null), [edit, setEdit] = useState<any>(null), [val, setVal] = useState<any>(""), [sure, setSure] = useState<any>(null);
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const f = q.trim().toLowerCase(), list = chats.filter((c) => !f || c.title.toLowerCase().includes(f) || preview(c).toLowerCase().includes(f)).sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || b.ts - a.ts);
  const groups: any[] = []; for (const c of list) { const g = c.pin ? "Pinned" : dayLabel(c.ts); let x = groups.find((y) => y[0] === g); if (!x) { x = [g, []]; groups.push(x); } x[1].push(c); }
  return (
    <>
      <div className="mscrim" onClick={onClose} />
      <div className="modal tall" role="dialog" aria-label="Chats and models">
        <div className="mh">
          <div className="mtabs">{[["chats", "Chats"], ["models", "Models"]].map(([k, n]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{n}</button>)}</div>
          <button className="ib sm ghost" aria-label="Close" onClick={onClose}><X size={16} {...ico} /></button>
        </div>
        {tab === "models" ? (
          <div className="mb">{MODELS.map((m) => <button key={m.id} className={"epModel" + (m.id === model ? " on" : "")} onClick={() => onModel(m.id)}><div><b>{m.n}</b><span>{m.d}</span></div>{m.id === model && <Check size={17} {...ico} />}</button>)}</div>
        ) : (
          <>
            <div className="ctop">
              <div className="csr"><Search size={15} {...ico} /><input value={q} placeholder="Search chats" autoCapitalize="none" onChange={(e) => setQ(e.target.value)} /></div>
              <button className="cnew" aria-label="New chat" onClick={onNew}><NewChatIcon size={18} /><span>New</span></button>
            </div>
            <div className="mb clist2">
              {!list.length && <div className="cempty"><MessageCircle size={26} {...ico} /><b>{f ? "No matches" : "No chats yet"}</b><span>{f ? "Try a different word." : "Your conversations will appear here."}</span></div>}
              {groups.map(([g, items]) => (
                <div key={g} className="cg">
                  <div className="cgl">{g}</div>
                  {items.map((c) => (
                    <div key={c.id} className={"cit" + (c.id === cid ? " cur" : "")}>
                      <div className="cir">
                        {edit === c.id
                          ? <input className="cedit" autoFocus value={val} onChange={(e) => setVal(e.target.value)} onBlur={() => { onRename(c.id, val); setEdit(null); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setEdit(null); } }} />
                          : <button className="cmain2" onClick={() => onOpen(c.id)}><span className="ct">{c.pin && <Pin size={11} {...ico} />}<i>{c.title}</i><time>{ago(c.ts)}</time></span>{preview(c) && <span className="cp">{preview(c)}</span>}</button>}
                        <button className="ib sm" aria-label="More" onClick={() => { setAct(act === c.id ? null : c.id); setSure(null); }}><MoreHorizontal size={16} {...ico} /></button>
                      </div>
                      {act === c.id && (
                        <div className="cacts">
                          <button onClick={() => { onPin(c.id); setAct(null); }}><Pin size={13} {...ico} />{c.pin ? "Unpin" : "Pin"}</button>
                          <button onClick={() => { setEdit(c.id); setVal(c.title); setAct(null); }}><Pencil size={13} {...ico} />Rename</button>
                          <button className={sure === c.id ? "danger" : ""} onClick={() => (sure === c.id ? (onDelete(c.id), setAct(null)) : setSure(c.id))}><Trash2 size={13} {...ico} />{sure === c.id ? "Confirm" : "Delete"}</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

const CSS2 = `
/* host-proofing + fixes */
.aura input[type=file]{display:none}
.sheet{left:50%;top:50%;transform:none;translate:-50% -50%}
.scroll{padding:calc(76px + env(safe-area-inset-top,0px)) 16px calc(var(--dh,150px) + var(--kb,0px) + 36px)}
.fade-b{height:calc(var(--dh,120px) + 64px)}
.dock{display:flex;flex-direction:column;gap:8px}
.composer,.mini{width:100%}
.mini{align-self:center}
.dock .mini{max-width:380px}.dock.wide .mini{max-width:720px}
.note{margin-top:2px;font-size:11.5px;line-height:15px;height:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.note.show{opacity:1}
@media(pointer:coarse){.note{display:none}}
.head .hl{display:flex;align-items:center;gap:8px;min-width:0}
.fab{position:absolute;right:16px;bottom:calc(var(--dh,130px) + var(--kb,0px) + 14px);z-index:31}
.ib.lit{background:var(--fg)!important;color:var(--bg)!important;box-shadow:0 0 18px rgba(var(--fr),.35)!important}

/* composer rows */
.tools{gap:6px}
.tgs{display:flex;align-items:center;gap:6px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none}
.tgs::-webkit-scrollbar{display:none}
.tend{display:flex;align-items:center;gap:6px;flex:none;margin-left:auto}
@media(max-width:520px){.tgs .tg{width:38px;padding:0;justify-content:center}.tgs .tl2{display:none}.lbl{font-size:14.5px}}
.atts{display:flex;gap:6px;overflow-x:auto;padding:12px 14px 0 16px;scrollbar-width:none}
.att{flex:none;display:inline-flex;align-items:center;gap:7px;max-width:176px;height:38px;padding:0 6px 0 6px;border-radius:13px;background:rgba(var(--fr),.07);font-size:12.5px}
.att img{width:26px;height:26px;border-radius:8px;object-fit:cover}
.att em{font-style:normal;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.att button{display:grid;place-items:center;flex:none;width:20px;height:20px;border-radius:50%;background:rgba(var(--fr),.12);cursor:pointer}
.uatt{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;margin-bottom:6px}
.uatt img{width:76px;height:76px;border-radius:14px;object-fit:cover}
.uatt span{display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:12px;background:rgba(var(--fr),.07);font-size:12.5px}
.trace{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.trc{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px 0 9px;border-radius:999px;font-size:12.5px;color:rgba(var(--fr),.6);background:rgba(var(--fr),.05);box-shadow:inset 0 1px 0 rgba(var(--fr),.12)}
.trc.run{color:var(--fg);animation:skp 1.2s ease-in-out infinite}.trc.err{opacity:.5}

/* now playing */
.mini{position:relative;display:flex;align-items:center;gap:6px;padding:8px 8px 10px 8px;border-radius:22px;animation:rise .17s cubic-bezier(.2,.8,.2,1) both}
.mini .art{width:40px;height:40px;border-radius:11px}.mini .tm{padding:0 4px}
.mini .ib.sm{width:34px;height:34px}.mini .pg{left:14px;right:14px;bottom:4px}

/* home */
.home{display:flex;flex-direction:column;padding-top:min(6vh,48px);animation:fadein .25s both}
.hmark{position:relative;width:46px;height:46px;margin-bottom:22px;border-radius:50%;background:radial-gradient(circle at 34% 28%,var(--fg),#bcbcbc 46%,#2c2c2c 100%);box-shadow:0 0 40px rgba(var(--fr),.18),inset 0 -8px 16px rgba(0,0,0,.5);animation:bob 6s ease-in-out infinite}
.hmark i{position:absolute;width:46%;height:28%;left:15%;top:11%;border-radius:50%;background:radial-gradient(closest-side,rgba(var(--fr),.95),transparent);transform:rotate(-25deg)}
.home h1{font-size:clamp(34px,9.5vw,50px);line-height:1.05;font-weight:600;letter-spacing:-.04em;background:linear-gradient(180deg,var(--fg) 40%,rgba(var(--fr),.45));-webkit-background-clip:text;background-clip:text;color:transparent;padding-bottom:.06em}
.hsub{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin-top:12px;font-size:14px;color:rgba(var(--fr),.5)}
.hdot{width:3px;height:3px;border-radius:50%;background:rgba(var(--fr),.3)}
.wxp{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px 0 10px;border-radius:99px;background:rgba(var(--fr),.06);box-shadow:inset 0 1px 0 rgba(var(--fr),.12);font-size:12.5px;color:rgba(var(--fr),.75);white-space:nowrap}
.wxp.ask{cursor:pointer}.wxp.ask:active{transform:scale(.96)}
.hsec{margin:30px 0 10px 2px;font-size:13px;font-weight:500;color:rgba(var(--fr),.4)}
.rec{display:flex;flex-direction:column}
.rrow{display:flex;align-items:center;justify-content:space-between;gap:14px;width:100%;padding:12px 2px;border-top:1px solid rgba(var(--fr),.07);font-size:15px;text-align:left;cursor:pointer;animation:rise .21s cubic-bezier(.2,.8,.2,1) both}
.rrow:first-child{border-top:0}.rrow span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rrow time{flex:none;font-size:12.5px;color:rgba(var(--fr),.38)}
.try{display:grid;grid-template-columns:1fr 1fr;gap:8px}
@media(max-width:560px){.try{grid-template-columns:1fr}}
.trow{display:flex;align-items:center;gap:12px;padding:11px 14px 11px 11px;border-radius:20px;text-align:left;cursor:pointer;background:rgba(var(--fr),.04);box-shadow:inset 0 0 0 1px rgba(var(--fr),.07);animation:rise .21s cubic-bezier(.2,.8,.2,1) both;transition:transform .15s cubic-bezier(.34,1.56,.64,1),background .12s}
.trow:active{transform:scale(.97);background:rgba(var(--fr),.08)}
@media(hover:hover){.trow:hover{background:rgba(var(--fr),.08)}}
.trow>div{min-width:0}.trow b{display:block;font-size:14.5px;font-weight:600}.trow span:not(.chip){display:block;font-size:13px;color:rgba(var(--fr),.48)}
.caps{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:26px;font-size:12px;color:rgba(var(--fr),.34)}
.caps span{display:inline-flex;align-items:center;gap:6px}.caps i{width:5px;height:5px;border-radius:50%;background:rgba(var(--fr),.2)}
.caps .on{color:rgba(var(--fr),.62)}.caps .on i{background:var(--fg);box-shadow:0 0 8px rgba(var(--fr),.6)}

/* history drawer */
.dscrim{position:absolute;inset:0;z-index:70;background:rgba(0,0,0,.55);opacity:0;visibility:hidden;transition:opacity .13s,visibility 0s .13s}
.dscrim.on{opacity:1;visibility:visible;transition-delay:0s}
.drawer{position:absolute;top:0;bottom:0;left:0;z-index:71;width:min(330px,86%);display:flex;flex-direction:column;padding:calc(14px + env(safe-area-inset-top,0px)) 12px calc(14px + env(safe-area-inset-bottom,0px));background:var(--s1);box-shadow:1px 0 0 rgba(var(--fr),.08),20px 0 60px rgba(0,0,0,.6);transform:translate3d(-104%,0,0);visibility:hidden;transition:transform .16s cubic-bezier(.22,1,.36,1),visibility 0s .16s}
.drawer.open{transform:none;visibility:visible;transition-delay:0s}
.dtop{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
.dprof{display:flex;align-items:center;gap:10px;flex:1;min-width:0;padding:5px 10px 5px 5px;border-radius:16px;text-align:left;cursor:pointer}
.dprof:active{background:rgba(var(--fr),.06)}
.dprof>div{min-width:0}.dprof b{display:block;font-size:14.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dprof span:not(.av2){font-size:12px;color:rgba(var(--fr),.45)}
.av2{display:grid;place-items:center;width:34px;height:34px;flex:none;border-radius:50%;color:var(--bg);font-weight:700;font-size:15px}
.av2.lg{width:76px;height:76px;font-size:30px}
.newc{display:flex;align-items:center;gap:10px;height:44px;padding:0 16px;border-radius:14px;background:var(--fg);color:var(--bg);font-weight:600;font-size:14.5px;cursor:pointer}
.newc:active{transform:scale(.98)}
.dsr{display:flex;align-items:center;gap:8px;height:40px;margin:10px 0 2px;padding:0 12px;border-radius:12px;background:rgba(var(--fr),.06);color:rgba(var(--fr),.5)}
.dsr input{flex:1;min-width:0;font:500 15px 'Inter',system-ui,sans-serif;color:var(--fg)}
.dlist{flex:1;overflow-y:auto;overscroll-behavior:contain;margin:0 -4px;padding:0 4px 20px;scrollbar-width:none}
.dgrp{margin:16px 8px 6px;font-size:12px;font-weight:500;color:rgba(var(--fr),.38)}
.drow{position:relative;display:flex;align-items:center;border-radius:12px}
.drow.cur{background:rgba(var(--fr),.08)}
@media(hover:hover){.drow:hover{background:rgba(var(--fr),.05)}.drow.cur:hover{background:rgba(var(--fr),.09)}}
.dmain{flex:1;min-width:0;display:flex;align-items:center;gap:7px;padding:11px 6px 11px 12px;text-align:left;cursor:pointer;font-size:14.5px}
.dmain span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dmain svg{flex:none;opacity:.55}
.drow .ib{width:32px;height:32px;margin-right:2px;opacity:.6}
.dact{position:absolute;right:6px;top:100%;z-index:3;min-width:156px;padding:5px;border-radius:14px;background:var(--s2);box-shadow:inset 0 0 0 1px rgba(var(--fr),.12),0 12px 30px rgba(0,0,0,.6);animation:menu .12s both}
.dact button{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border-radius:10px;font-size:14px;cursor:pointer}
.dact button:active{background:rgba(var(--fr),.08)}.dact .warn{color:#ff9a9a}
.dedit{flex:1;min-width:0;margin:4px 6px;padding:8px 10px;border-radius:10px;background:rgba(var(--fr),.1);font:500 14.5px 'Inter',system-ui,sans-serif;color:var(--fg)}
.dempty{padding:30px 14px;text-align:center;font-size:13.5px;color:rgba(var(--fr),.4)}

/* settings */
.sheet.big{width:min(470px,calc(100% - 20px));max-height:calc(100% - 36px);display:flex;flex-direction:column;padding:0;overflow:hidden}
.shd{display:flex;align-items:center;justify-content:space-between;padding:16px 14px 8px 20px}
.sbody{overflow-y:auto;overscroll-behavior:contain;padding:0 14px 18px;scrollbar-width:thin;scrollbar-color:rgba(var(--fr),.12) transparent}
.sbody details{padding:0 6px;border-top:1px solid rgba(var(--fr),.08)}
.sbody summary{display:flex;align-items:center;justify-content:space-between;padding:15px 4px;font-size:14.5px;font-weight:600;cursor:pointer;list-style:none}
.sbody summary::-webkit-details-marker{display:none}
.sbody summary::after{content:"+";font-size:18px;font-weight:400;color:rgba(var(--fr),.45)}
.sbody details[open] summary::after{content:"\\2212"}
.sbody details[open]{padding-bottom:12px}
.fld{display:flex;flex-direction:column;gap:7px;margin:10px 0;font-size:12.5px;color:rgba(var(--fr),.55)}
.fld input,.fld textarea,.sel{display:block;width:100%;min-height:44px;padding:10px 14px;border-radius:14px;background:rgba(var(--fr),.07);box-shadow:inset 0 0 0 1px rgba(var(--fr),.1);font:500 15px/1.4 'Inter',system-ui,sans-serif;color:var(--fg)}
.fld input,.fld textarea{height:auto}
.fld textarea{resize:vertical;white-space:pre-wrap;overflow-wrap:anywhere;-webkit-user-select:text;user-select:text}
.fld input:focus-visible,.fld textarea:focus-visible,.sel:focus-visible{outline:0;box-shadow:inset 0 0 0 1.5px rgba(var(--fr),.55)}
.fld::placeholder,.fld input::placeholder,.fld textarea::placeholder{color:rgba(var(--fr),.3)}
.inl{display:flex;align-items:center;gap:8px}.inl input{flex:1;min-width:0}.inl.wrapi{flex-wrap:wrap}
.hint{margin:4px 0 8px;font-size:12.5px;line-height:1.5;color:rgba(var(--fr),.45)}
.plist{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 8px}
.pchip{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 14px 0 4px;border-radius:99px;background:rgba(var(--fr),.07);font-size:13.5px;cursor:pointer}
.pchip.on{box-shadow:inset 0 0 0 1.5px var(--fg)}.pchip:not(:has(.av2)){padding-left:12px}
.pchip .av2{width:30px;height:30px;font-size:13px}
.cols{display:flex;gap:10px}
.cols button{width:30px;height:30px;border-radius:50%;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(0,0,0,.25)}
.cols .on{box-shadow:0 0 0 2px var(--s2),0 0 0 4px var(--fg)}
.swr{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;padding:11px 4px;text-align:left;cursor:pointer}
.swr b{display:block;font-size:14.5px;font-weight:600}.swr span{display:block;margin-top:2px;font-size:12.5px;line-height:1.4;color:rgba(var(--fr),.5)}
.sw{position:relative;display:block;flex:none;width:44px;height:26px;border-radius:99px;background:rgba(var(--fr),.14);transition:background .12s;cursor:pointer}
.sw u{position:absolute;left:3px;top:3px;width:20px;height:20px;border-radius:50%;background:var(--fg);text-decoration:none;transition:transform .13s cubic-bezier(.34,1.56,.64,1)}
.sw.on{background:var(--fg)}.sw.on u{transform:translateX(18px);background:var(--bg)}
.mems{display:flex;flex-direction:column;gap:6px}
.mem{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 6px 6px 14px;border-radius:12px;background:rgba(var(--fr),.05);font-size:13.5px;color:var(--fg)}
.mcp{margin:8px 0;padding:12px;border-radius:16px;background:rgba(var(--fr),.05)}
.mcpt{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
.mcpt>div{min-width:0}.mcpt b{display:block;font-size:14px}.mcpt span{display:block;font-size:12px;color:rgba(var(--fr),.45);overflow-wrap:anywhere}
.rng{height:30px!important;min-height:0!important;padding:0!important;background:none!important;box-shadow:none!important;-webkit-appearance:none;appearance:none}
.rng::-webkit-slider-runnable-track{height:4px;border-radius:4px;background:rgba(var(--fr),.2)}
.rng::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;margin-top:-9px;border-radius:50%;background:var(--fg)}
.rng::-moz-range-track{height:4px;border-radius:4px;background:rgba(var(--fr),.2)}
.rng::-moz-range-thumb{width:22px;height:22px;border:0;border-radius:50%;background:var(--fg)}
.toast{position:absolute;left:50%;bottom:16px;translate:-50% 0;padding:9px 16px;border-radius:99px;background:var(--fg);color:var(--bg);font-size:13px;font-weight:600;white-space:nowrap;animation:rise .13s both;z-index:5}
.toast.tf{position:fixed;bottom:calc(var(--dh,130px) + var(--kb,0px) + 18px);z-index:90}

/* app lock */
.lock{position:absolute;inset:0;z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;background:var(--bg);text-align:center}
.lock h2{font-size:24px;font-weight:600;letter-spacing:-.03em}
.pins{display:flex;gap:12px}.pins i{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 1.5px rgba(var(--fr),.4);transition:background .12s}.pins i.on{background:var(--fg)}
.pins.bad{animation:shake .17s}@keyframes shake{25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
.pinin{display:block;width:190px;height:48px;border-radius:16px;background:rgba(var(--fr),.07);box-shadow:inset 0 0 0 1px rgba(var(--fr),.12);text-align:center;font:600 18px 'Inter',system-ui,sans-serif;letter-spacing:.3em;color:var(--fg)}
.pinin::placeholder{font-size:15px;letter-spacing:0;color:rgba(var(--fr),.35)}

/* live voice */
.live{position:absolute;inset:0;z-index:48;display:flex;flex-direction:column;padding:calc(10px + env(safe-area-inset-top,0px)) 16px calc(16px + env(safe-area-inset-bottom,0px));background:var(--bg);animation:fadein .15s both}
.lhead{display:flex;align-items:center;gap:10px;width:100%;max-width:720px;height:44px;margin:0 auto;font-size:14px;font-weight:500}
.lstage{position:relative;flex:0 0 auto;display:grid;place-items:center;width:100%;max-width:720px;height:clamp(150px,28vh,250px);margin:0 auto;cursor:pointer}
.lstage.big{flex:1;height:auto}
.orb{position:relative;z-index:1;width:92px;height:92px;border-radius:50%;background:radial-gradient(circle at 34% 28%,var(--fg),#bcbcbc 46%,#2c2c2c 100%);box-shadow:0 0 70px rgba(var(--fr),.22),inset 0 -10px 20px rgba(0,0,0,.5);will-change:transform}
.orb i{position:absolute;inset:-14px;border-radius:50%;border:1px solid rgba(var(--fr),.18);animation:pulse 2.4s ease-in-out infinite}
.live .wave{position:absolute;left:0;top:50%;width:100%;height:110px;margin-top:-55px;opacity:.85;pointer-events:none}
.ltr{display:flex;flex-direction:column;gap:10px;flex:1;min-height:0;width:100%;max-width:720px;margin:0 auto;padding:14px 2px 10px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;-webkit-mask-image:linear-gradient(transparent,#000 26px);mask-image:linear-gradient(transparent,#000 26px)}
.lt{max-width:90%;font-size:15.5px;line-height:1.55;overflow-wrap:anywhere}
.lt.user{align-self:flex-end;padding:9px 15px;border-radius:20px 20px 6px 20px;background:rgba(var(--fr),.09)}
.lt.ai{align-self:flex-start;color:rgba(var(--fr),.88)}.lt.dim{opacity:.55}
.lhint{margin:auto;padding:0 20px;text-align:center;font-size:14.5px;line-height:1.5;color:rgba(var(--fr),.45)}
.live .lcap{width:100%;max-width:720px;margin:0 auto}
.live .lctl{margin-top:8px}.live .lctl .ib{width:52px;height:52px}

/* widgets */
.mapf{position:relative;margin:6px 10px 0;aspect-ratio:4/3;border-radius:16px;overflow:hidden;background:rgba(var(--fr),.05)}
.mapf iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.mapc{padding:8px 16px 0;font-size:13px;color:rgba(var(--fr),.6);overflow-wrap:anywhere}
.wk{display:flex;gap:12px;padding:6px 16px 4px}.wk img{flex:none;width:84px;height:84px;border-radius:14px;object-fit:cover}
.wk>div{min-width:0}.wk b{display:block;font-size:16px;font-weight:600}.wk span{display:block;margin-top:1px;font-size:12.5px;color:rgba(var(--fr),.5)}
.wk p{margin:8px 0 0;font-size:13.5px;line-height:1.55;color:rgba(var(--fr),.75);cursor:pointer}
.wk p.clamp{display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
.df{padding:4px 16px 12px}.dft{display:flex;align-items:center;gap:10px}.dft b{font-size:22px;font-weight:600;letter-spacing:-.02em}.dft span{font-size:14px;color:rgba(var(--fr),.5)}
.dfm{margin-top:10px}.dfm em{font-size:13px;font-style:italic;color:rgba(var(--fr),.5)}
.dfm p{margin:4px 0 0;font-size:14px;line-height:1.55;color:rgba(var(--fr),.85)}.dfm q{display:block;margin-top:2px;font-size:13px;color:rgba(var(--fr),.5);quotes:none}
.fx{padding:6px 18px 4px}.fxa{font-size:13.5px;color:rgba(var(--fr),.55)}.fxb{margin-top:2px;font-size:38px;font-weight:300;letter-spacing:-.04em}
.fxb small{font-size:16px;font-weight:500;letter-spacing:0;color:rgba(var(--fr),.55)}
.fxc{display:flex;justify-content:space-between;gap:10px;margin-top:6px;font-size:12px;color:rgba(var(--fr),.45)}
.chw{padding:4px 12px 8px}.chs{display:block;width:100%;height:auto;overflow:visible}
.chl{font:9.5px 'Inter',system-ui,sans-serif;fill:rgba(var(--fr),.5)}.chg{stroke:rgba(var(--fr),.08);stroke-width:1}
.bar{transform-box:fill-box;transform-origin:bottom;animation:grow .25s cubic-bezier(.2,.8,.2,1) both}
@keyframes grow{from{transform:scaleY(0)}to{transform:none}}
.slc,.lnx{animation:fadein .25s both}
.chk{margin:0;padding:0 16px 12px}.chk em i{display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:50%}
.qz{display:flex;flex-direction:column;gap:8px;padding:6px 14px 14px;animation:fadein .13s both}
.qq{margin:2px 2px 4px;font-size:15px;font-weight:600;line-height:1.45}
.qo{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:12px 14px;border-radius:14px;background:rgba(var(--fr),.06);box-shadow:inset 0 0 0 1px rgba(var(--fr),.08);font-size:14.5px;text-align:left;cursor:pointer;transition:background .12s}
.qo:disabled{cursor:default}.qo:not(:disabled):active{transform:scale(.98)}
.qo.ok{background:rgba(120,255,160,.14);box-shadow:inset 0 0 0 1.5px rgba(150,255,180,.7)}
.qo.no{background:rgba(255,110,110,.14);box-shadow:inset 0 0 0 1.5px rgba(255,140,140,.7)}.qo.dim{opacity:.5}
.qw{margin:4px 2px;font-size:13.5px;line-height:1.55;color:rgba(var(--fr),.65)}.qz .tg{align-self:flex-start}
.qz.done{align-items:center;padding:14px;text-align:center}.qz.done .tg{align-self:center}
.qzs{font-size:52px;font-weight:300;letter-spacing:-.04em}.qzs small{font-size:20px;color:rgba(var(--fr),.5)}
.tmr{position:relative;width:150px;height:150px;margin:6px auto 4px}.tmr svg{width:100%;height:100%;transform:rotate(-90deg)}
.tr0,.tr1{fill:none;stroke-width:5}.tr0{stroke:rgba(var(--fr),.1)}.tr1{stroke:var(--fg);stroke-linecap:round;transition:stroke-dashoffset .13s linear}
.tmt{position:absolute;inset:0;display:grid;place-items:center;font-size:34px;font-weight:300;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.clk{padding:2px 16px 12px}.clr{display:flex;align-items:center;justify-content:space-between;padding:11px 0;border-top:1px solid rgba(var(--fr),.07);font-size:15px}
.clr:first-child{border-top:0}.clr small{display:block;margin-top:1px;font-size:12px;color:rgba(var(--fr),.45)}
.clr b{font-size:26px;font-weight:300;letter-spacing:-.03em;font-variant-numeric:tabular-nums}

/* code: syntax colours + canvas */
.tk-c{color:#6f7b8c;font-style:italic}.tk-k{color:#ff9ac1}.tk-s{color:#9ee6b0}.tk-n{color:#ffd28a}.tk-f{color:#8ecbff}.tk-t{color:#c8b6ff}.tk-p{color:rgba(var(--fr),.45)}
.cbh i{margin-left:10px;font-style:normal;opacity:.6}
.cbt{display:flex;align-items:center;gap:6px}
.cpy.on{background:var(--fg);color:var(--bg)}
.cb pre.wr,.cvp.wr{white-space:pre-wrap;overflow-wrap:anywhere}
.pvf{display:block;width:100%;border:0;background:#ffffff}
.cvs{position:fixed;inset:0;z-index:120;display:flex;flex-direction:column;background:var(--s1);animation:fadein .12s both}
.cvh{display:flex;align-items:center;gap:8px;padding:calc(10px + env(safe-area-inset-top,0px)) 12px 10px 16px;background:var(--s2);box-shadow:0 1px 0 rgba(var(--fr),.08)}
.cvh b{font-size:14px;font-weight:600}
.cvt{display:flex;gap:2px;margin-left:8px;padding:3px;border-radius:99px;background:rgba(var(--fr),.07)}
.cvt button{padding:5px 12px;border-radius:99px;font-size:12.5px;color:rgba(var(--fr),.6);cursor:pointer}.cvt .on{background:var(--fg);color:var(--bg)}
.cvp{flex:1;min-height:0;margin:0;padding:14px 16px calc(14px + env(safe-area-inset-bottom,0px));overflow:auto;font:13px/1.65 ui-monospace,Menlo,monospace;white-space:pre;tab-size:2}
.cvs .pvf{flex:1;min-height:0}

/* polish */
.tgs .tg.on{box-shadow:none}
.cbh>span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.cbt{flex:none}.cbt .cpy{flex:none;white-space:nowrap}
@media(max-width:480px){.cbh i{display:none}.cbt{gap:4px}.cbt .cpy{padding:0 9px}}
@media(max-height:720px){.trow:nth-child(n+5),.caps{display:none}}

.sheet.big{background:linear-gradient(160deg,var(--s2),var(--s1))}
`;

const CSS4 = `
/* ── v4: widgets, chess, fixes ── */
.msg.row-r{display:flex;justify-content:flex-end;width:100%}
.msg.row-r>div{display:flex;flex-direction:column;align-items:flex-end;max-width:86%;min-width:0;margin-left:auto}
.msg.row-r .ub{max-width:100%;width:fit-content;margin-left:auto;text-align:left}
.uatt{justify-content:flex-end}
.wv{display:flex;flex-direction:column;gap:12px}.wrow{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.wrow>*{flex:1 1 0;min-width:100px}
.wh{font-weight:700;letter-spacing:-.02em;line-height:1.2}.wh.h1{font-size:22px}.wh.h2{font-size:17px}.wh.h3{font-size:14px;color:rgba(var(--fr),.7)}
.wtm{display:flex;flex-direction:column;gap:2px}.wtm b{font-size:36px;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1.05}.wtm span{font-size:13.5px;color:rgba(var(--fr),.6)}.wtm small{font-size:11.5px;color:rgba(var(--fr),.4)}
.wck{display:flex;align-items:center;gap:10px;width:100%;padding:8px 2px;text-align:left;font-size:14.5px}.wck.on{opacity:.5}.wck.on{text-decoration:line-through}.wck.on .ck{background:var(--fg);color:var(--bg)}
.wfl{display:flex;flex-direction:column;gap:6px;font-size:12px;color:rgba(var(--fr),.55)}.wsv{align-self:flex-end;margin-top:-18px;color:var(--fg);font-size:13px}
.wcn{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:14px}.wcn>div{display:flex;align-items:center;gap:6px}.wcn b{min-width:34px;text-align:center;font-size:20px;font-variant-numeric:tabular-nums}.wcn .ib{width:34px;height:34px;font-size:18px;background:rgba(var(--fr),.08)}
.wst{padding:12px 14px;border-radius:14px;background:rgba(var(--fr),.06)}.wst b{display:block;font-size:24px;font-weight:700;letter-spacing:-.02em;color:var(--ka,var(--fg))}.wst span{font-size:12px;color:rgba(var(--fr),.55)}
.wbd{align-self:flex-start;padding:5px 11px;border-radius:99px;font-size:12px;font-weight:600;background:rgba(var(--fr),.09)}
.wls{margin:0;padding-left:18px;font-size:14px;line-height:1.6}.gimg{display:block;width:100%;border-radius:16px}
.wv .swr{width:100%}.wv .sel,.wv .kin{width:100%}
.chs{align-items:center}
.chb{container-type:inline-size;display:grid;grid-template-columns:repeat(8,1fr);width:min(100%,380px);aspect-ratio:1;border-radius:14px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(var(--fr),.12)}
.chq{position:relative;display:grid;place-items:center;background:rgba(var(--fr),.05);font-size:clamp(20px,8.5vw,38px);line-height:1;cursor:pointer;min-width:0}.chq.d{background:rgba(var(--fr),.17)}
.chq.l{box-shadow:inset 0 0 0 100px rgba(255,210,138,.26)}.chq.s{box-shadow:inset 0 0 0 100px rgba(142,203,255,.42)}.chq.k{box-shadow:inset 0 0 0 100px rgba(255,107,107,.55)}
.chq .pw,.chq .pb{font-size:11cqw;transition:transform .12s}.chq .pw{color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.75),0 0 1px #000}.chq .pb{color:#17171c;text-shadow:0 1px 1px rgba(255,255,255,.4)}.chq.s .pw,.chq.s .pb{transform:scale(1.12)}
.chq .dot{position:absolute;width:26%;height:26%;border-radius:50%;background:rgba(var(--fr),.38)}.chq .cap{position:absolute;inset:5%;border-radius:50%;box-shadow:inset 0 0 0 3px rgba(255,107,107,.8)}
.chx{display:flex;gap:6px;width:min(100%,400px);align-items:stretch}.chev{width:10px;border-radius:5px;background:#403d39;position:relative;overflow:hidden;flex:none}.chev i{position:absolute;left:0;right:0;bottom:0;background:#f0f0f0;transition:height .21s}
.chb.chc{flex:1;width:auto;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.35)}.chq{background:#ebecd0!important}.chq.d{background:#779556!important}
.chq.l,.chq.s{box-shadow:none!important;background-image:linear-gradient(rgba(255,255,51,.5),rgba(255,255,51,.5))}.chq.h{box-shadow:inset 0 0 0 3px #4aa3ff!important}.chq.k{box-shadow:none!important;background-image:radial-gradient(circle,#ff2a2a 10%,rgba(255,42,42,.6) 45%,transparent 75%)}
.chq img{width:100%;height:100%;display:block;pointer-events:none;filter:drop-shadow(0 1px 1px rgba(0,0,0,.25));transition:transform .15s}.chq.s img{transform:scale(1.08)}
.chq .dot{width:30%!important;height:30%!important;background:rgba(0,0,0,.18)!important}.chq .cap{inset:0!important;border-radius:50%;box-shadow:inset 0 0 0 5px rgba(0,0,0,.2)!important}
.chq em{position:absolute;font:700 clamp(8px,2.6cqw,11px)/1 system-ui;font-style:normal;pointer-events:none;color:#779556}.chq.d em{color:#ebecd0}.chq em.rk{top:3px;left:3px}.chq em.fl{bottom:2px;right:3px}
.chcap{min-height:18px;width:min(100%,400px);font-size:15px;letter-spacing:-3px;opacity:.85}.chcap .pw2{color:#fff;text-shadow:0 0 2px #000}.chcap .pb2{color:#222}.chmv{font:11px/1.5 ui-monospace,monospace;opacity:.7;width:min(100%,400px);white-space:pre-wrap}
.dfc{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}.dfc small{opacity:.6;margin-right:2px}.dfc .tg{padding:3px 10px}
.cvs .cpy,.cvh .cvt button{transition:background .12s}

/* ── v3: kit, live bar, minimal settings, header fade, canvas ── */
.pbar{height:6px;border-radius:99px;background:rgba(var(--fr),.1);overflow:hidden}.pbar i{display:block;height:100%;border-radius:99px;background:var(--ka,var(--fg));transition:width .29s cubic-bezier(.2,.9,.3,1)}
.kb{padding:4px 14px 14px;display:flex;flex-direction:column;gap:10px}
.kin{display:block;width:100%;height:38px;padding:0 14px;border-radius:12px;background:rgba(var(--fr),.07);box-shadow:inset 0 0 0 1px rgba(var(--fr),.1);font:500 14px 'Inter',system-ui,sans-serif;color:var(--fg)}
.kin::placeholder{color:rgba(var(--fr),.35)}.kin:focus-visible{outline:0;box-shadow:inset 0 0 0 1.5px rgba(var(--fr),.5)}
.kb .inl{display:flex;gap:8px;align-items:center}
.nta{display:block;width:100%;padding:12px 14px;border-radius:14px;background:rgba(var(--fr),.06);box-shadow:inset 0 0 0 1px rgba(var(--fr),.09);font:400 14.5px/1.55 'Inter',system-ui,sans-serif;color:var(--fg);resize:vertical;white-space:pre-wrap;overflow-wrap:anywhere;-webkit-user-select:text;user-select:text}
.nta:focus-visible{outline:0;box-shadow:inset 0 0 0 1.5px rgba(var(--fr),.45)}
.crest{width:22px;height:22px;object-fit:contain;flex:none;display:inline-block}
.spl{display:flex;flex-direction:column;gap:6px;padding:4px 12px 14px}
.spm{position:relative;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;padding:12px 12px 22px;border-radius:16px;background:rgba(var(--fr),.05);animation:rise .19s both}
.spt{display:flex;align-items:center;gap:8px;min-width:0;font-size:13.5px;font-weight:600}.spt span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.spt.r{justify-content:flex-end;text-align:right}
.sps{font-size:17px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;min-width:58px;text-align:center}
.spb{position:absolute;left:0;right:0;bottom:6px;text-align:center;font-style:normal;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:rgba(var(--fr),.45)}
.spm.in .spb{color:#ff6b6b;font-weight:700}.spm.in{box-shadow:inset 0 0 0 1px rgba(255,107,107,.35)}
.sptb{padding:2px 8px 12px;font-size:12.5px;font-variant-numeric:tabular-nums}
.sptr{display:grid;grid-template-columns:22px 1fr repeat(5,28px) 32px;align-items:center;gap:2px;padding:7px 6px;border-radius:10px;text-align:center;color:rgba(var(--fr),.7)}
.sptr.hd{font-size:11px;color:rgba(var(--fr),.4)}.sptr .tn{display:flex;align-items:center;gap:7px;text-align:left;min-width:0;overflow:hidden;white-space:nowrap;font-weight:600;color:var(--fg)}.sptr b{color:var(--fg)}.sptr.me{background:rgba(var(--fr),.1)}
.nw{display:flex;flex-direction:column;gap:2px;padding:2px 8px 12px}
.nwr{display:flex;gap:12px;align-items:center;padding:10px 8px;border-radius:14px;transition:background .12s}.nwr:hover{background:rgba(var(--fr),.05)}
.nwr img{width:64px;height:64px;border-radius:12px;object-fit:cover;flex:none;background:rgba(var(--fr),.06)}
.nwr b{display:block;font-size:14px;line-height:1.35;font-weight:600;color:var(--fg)}.nwr span{display:block;margin-top:3px;font-size:11.5px;color:rgba(var(--fr),.45)}
.nwr.top{flex-direction:column;align-items:stretch;gap:10px}.nwr.top img{width:100%;height:auto;aspect-ratio:16/9;border-radius:16px}.nwr.top b{font-size:16px}
.gtx{font-size:14px;line-height:1.55;color:rgba(var(--fr),.82)}
.gst{display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:8px}.gst>div{padding:12px;border-radius:14px;background:rgba(var(--fr),.06)}
.gst b{display:block;font-size:20px;font-weight:700;letter-spacing:-.02em;color:var(--ka,var(--fg))}.gst span{display:block;margin-top:2px;font-size:11.5px;color:rgba(var(--fr),.55)}.gst small{display:block;margin-top:2px;font-size:11px;color:rgba(var(--fr),.4)}
.gkv>div{display:flex;justify-content:space-between;gap:12px;padding:8px 0;font-size:13.5px;border-bottom:1px solid rgba(var(--fr),.06)}.gkv span{color:rgba(var(--fr),.5)}.gkv b{font-weight:600;text-align:right}
.gls{display:flex;flex-direction:column;gap:8px}.gls>div{display:flex;gap:10px;align-items:flex-start}.gls i{flex:none;min-width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-size:11px;font-weight:700;background:var(--ka,var(--fg));color:var(--bg)}
.gls i:empty{min-width:6px;width:6px;height:6px;margin:8px 8px 0 4px}.gls b{display:block;font-size:14px;font-weight:600}.gls span{display:block;font-size:12.5px;color:rgba(var(--fr),.55);line-height:1.45}
.gtb{overflow-x:auto;border-radius:12px;box-shadow:inset 0 0 0 1px rgba(var(--fr),.08)}.gtb table{width:100%;border-collapse:collapse;font-size:13px}.gtb th{text-align:left;padding:9px 12px;font-size:11.5px;color:rgba(var(--fr),.5);background:rgba(var(--fr),.05)}.gtb td{padding:9px 12px;border-top:1px solid rgba(var(--fr),.06)}
.gpr>div{display:flex;justify-content:space-between;margin-bottom:6px;font-size:12.5px;color:rgba(var(--fr),.6)}.gpr b{color:var(--fg)}
.gbd{display:flex;flex-wrap:wrap;gap:6px}.gbd span{padding:5px 11px;border-radius:99px;font-size:12px;font-weight:600;background:rgba(var(--fr),.08)}
.glk{display:flex;flex-direction:column;gap:6px}.glk a{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;font-size:13.5px;font-weight:600;background:rgba(var(--fr),.06)}
.gim img{display:block;width:100%;border-radius:14px}.gim figcaption{margin-top:6px;font-size:12px;color:rgba(var(--fr),.5)}
.gq{padding:4px 0 4px 14px;border-left:2px solid var(--ka,var(--fg));font-size:15px;line-height:1.5;font-style:italic}.gq cite{display:block;margin-top:6px;font-size:12px;font-style:normal;color:rgba(var(--fr),.5)}.gdv{border:0;height:1px;background:rgba(var(--fr),.1)}
.tks{display:flex;flex-direction:column;gap:2px}.tk{display:flex;align-items:center;gap:10px;padding:7px 2px;font-size:14px}.tk span{flex:1;min-width:0;overflow-wrap:anywhere}.tk.done span{opacity:.4;text-decoration:line-through}
.tk em{font-style:normal;font-size:11.5px;color:rgba(var(--fr),.5)}.tk .ib{width:28px;height:28px;opacity:.4}
.ck{width:22px;height:22px;border-radius:50%;flex:none;display:grid;place-items:center;box-shadow:inset 0 0 0 1.6px rgba(var(--fr),.35);color:var(--bg);transition:background .12s,transform .13s cubic-bezier(.34,1.56,.64,1)}.tk.done .ck{background:var(--fg);transform:scale(1.05)}
.pri{width:8px;height:8px;border-radius:50%;flex:none;background:#8ecbff}.pri.high{background:#ff6b6b}.pri.med,.pri.medium{background:#ffd28a}.pri.low{background:#9ee6b0}
.remt{font-size:16px;font-weight:600;line-height:1.4}.remc{font-size:34px;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.pst{display:flex;flex-direction:column;gap:8px}.pst>div{display:flex;align-items:center;gap:10px;font-size:13.5px;color:rgba(var(--fr),.5)}.pst i{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;box-shadow:inset 0 0 0 1.5px rgba(var(--fr),.3);color:var(--bg)}
.pst .done{color:rgba(var(--fr),.85)}.pst .done i{background:var(--fg)}.pst .active{color:var(--fg);font-weight:600}.pst .active i{box-shadow:inset 0 0 0 1.5px var(--fg);animation:pulse 1.4s ease-in-out infinite}
.lnk,.apg{gap:6px}.apg{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}
.lk{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:rgba(var(--fr),.05);min-width:0;transition:background .12s,transform .13s cubic-bezier(.34,1.56,.64,1)}.lk:hover{background:rgba(var(--fr),.09)}.lk:active{transform:scale(.97)}
.lk div{flex:1;min-width:0}.lk b{display:block;font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lk span{display:block;font-size:11.5px;color:rgba(var(--fr),.45);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.apg .lk{flex-direction:column;text-align:center;padding:14px 8px}.apg .lk .fv{width:32px;height:32px}
.pol{gap:8px}.po{position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:42px;padding:0 14px;border-radius:14px;overflow:hidden;text-align:left;font-size:14px;font-weight:500;background:rgba(var(--fr),.06);transition:transform .13s cubic-bezier(.34,1.56,.64,1),box-shadow .12s}
.po i{position:absolute;left:0;top:0;bottom:0;background:rgba(var(--fr),.14);transition:width .25s cubic-bezier(.2,.9,.3,1)}.po span,.po b,.po svg{position:relative}.po.on{box-shadow:inset 0 0 0 1.5px var(--fg)}.po:active:not(:disabled){transform:scale(.98)}.po:disabled{opacity:.4;cursor:default}
.cdn{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.cdn>div{padding:12px 4px;border-radius:14px;text-align:center;background:rgba(var(--fr),.06)}.cdn b{display:block;font-size:26px;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums}.cdn span{font-size:11px;color:rgba(var(--fr),.5)}.cdd{grid-column:1/-1;font-size:20px}
.swt{text-align:center;font-size:40px;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums}.lps{display:flex;flex-direction:column;gap:3px;font-size:12.5px;color:rgba(var(--fr),.5);text-align:center}

/* header icons fade when idle */
.aura .head .ib{transition:opacity .25s ease,transform .15s cubic-bezier(.34,1.56,.64,1)}
.aura .head.dim .ib{opacity:0;pointer-events:none}

/* live: waves bar replaces the input */
.aura.islive .dock{opacity:0;pointer-events:none;transform:translateY(18px);transition:opacity .13s,transform .17s}
.lv{position:absolute;left:0;right:0;bottom:0;z-index:48;display:flex;flex-direction:column;align-items:center;gap:8px;padding:0 12px calc(14px + env(safe-area-inset-bottom,0px));pointer-events:none}.lv>*{pointer-events:auto}
.lvc{max-width:92%;padding:6px 14px;border-radius:99px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:rgba(var(--fr),.75);background:rgba(var(--gr),.6);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);animation:rise .19s both}.lvc.dim{color:rgba(var(--fr),.5)}
.lvbar{display:flex;align-items:center;gap:2px;width:min(560px,100%);height:76px;padding:0 8px;border-radius:99px;background:rgba(var(--gr),.8);-webkit-backdrop-filter:blur(26px);backdrop-filter:blur(26px);box-shadow:inset 0 0 0 1px rgba(var(--fr),.1),0 18px 50px rgba(0,0,0,.55);animation:lvIn .25s cubic-bezier(.2,.9,.3,1.12) both}
.lvmid{position:relative;flex:1;height:100%;cursor:pointer}.lvw{position:absolute;inset:0;width:100%;height:100%}
.lvlogo{position:absolute;left:50%;top:50%;width:40px;height:40px;margin:-20px 0 0 -20px;color:var(--lc,var(--fg));filter:drop-shadow(0 0 14px rgba(var(--fr),.4));will-change:transform}
.lvb{animation:pop .21s .13s both}.lvb.r{animation-delay:.17s}
@keyframes lvIn{from{opacity:0;transform:translateY(26px) scale(.86)}to{opacity:1;transform:none}}

/* settings: minimal side panel */
.aura .sheet.big{left:auto;right:0;top:0;bottom:0;translate:none;transform:none;width:min(380px,100%);max-width:100%;height:100%;max-height:none;padding:0;border-radius:0;display:flex;flex-direction:column;background:var(--s1);-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:-1px 0 0 rgba(var(--fr),.08);animation:slideR .17s cubic-bezier(.2,.9,.3,1) both}
@keyframes slideR{from{opacity:0;transform:translateX(36px)}to{opacity:1;transform:none}}
.aura .sheet.big .shd{padding:calc(18px + env(safe-area-inset-top,0px)) 14px 8px 20px}.aura .sheet.big .shd h3{font-size:15px}.aura .sheet.big .shd h3 svg{display:none}
.aura .sbody{flex:1;min-height:0;padding:0 12px calc(24px + env(safe-area-inset-bottom,0px))}
.aura .sbody details{border-top:0;margin-bottom:4px;border-radius:14px}.aura .sbody details[open]{background:rgba(var(--fr),.035)}
.aura .sbody summary{padding:13px 4px;font-size:14px;font-weight:500;color:rgba(var(--fr),.85)}
.aura .sbody .hint:not([role=alert]){display:none}.aura .sbody .fld{margin:8px 0;font-size:12px}

/* code canvas */
.cvstage{flex:1;min-height:0;display:flex;justify-content:center;background:var(--s1)}.cvstage .pvf{flex:0 1 auto}
.cvp .gut{display:inline-block;position:sticky;left:0;margin-right:16px;padding-right:14px;text-align:right;white-space:pre;user-select:none;color:rgba(var(--fr),.28);background:var(--s1);box-shadow:1px 0 0 rgba(var(--fr),.07);vertical-align:top}.cvp code{display:inline-block;vertical-align:top}
.cpy.on{background:rgba(var(--fr),.16)}
.dmain span{flex:1;text-align:left}.dmain time{flex:none;font-size:11px;color:rgba(var(--fr),.38)}.clist{margin-top:6px;max-height:300px;overflow-y:auto;scrollbar-width:none}.sheet.big .drow .ib{width:28px;height:28px}
`;

/* ── Attachments ────────────────────────────────────────── */
const CSS3 = `
.head{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:calc(22px + var(--sat,0px)) 10px 8px}
.head>.ib{justify-self:start}
.model.tt{background:none;box-shadow:none;border:0;color:var(--fg);height:36px;padding:0 12px;gap:7px;letter-spacing:-.02em;transition:background .13s,transform .15s cubic-bezier(.34,1.56,.64,1)}
.model.tt:hover{background:rgba(var(--fr),.07)}
.menu{left:50%;translate:-50% 0;transform-origin:top center;top:calc(60px + var(--sat,0px))}
.scroll{padding-top:calc(66px + var(--sat,0px))}.fade-t{height:84px}
.lg .b{transform-box:fill-box;transform-origin:center;animation:bubF var(--d,4s) ease-in-out infinite;animation-delay:var(--l,0s)}
.lg.fast .b{animation-duration:calc(var(--d,4s) * .35)}
.lg{color:var(--lc,var(--fg))}
@keyframes bubF{0%,100%{transform:translate(0,0) scale(1)}30%{transform:translate(var(--x,3px),-5px) scale(1.14)}65%{transform:translate(calc(var(--x,3px) * -1),3px) scale(.86)}}
.aimark{background:none;box-shadow:none;width:26px;height:26px}.aimark svg{filter:none}.aimark.fast svg{animation:none}
.aura .ib{transition:transform .15s cubic-bezier(.34,1.56,.64,1),background .12s,color .12s,opacity .12s}.aura .ib:active{transform:scale(.88)}
.aura .acts .ib{opacity:.55}.aura .acts .ib:hover,.aura .acts .ib.lit{opacity:1}
.tg.gl{margin-top:10px;font-size:13px;text-decoration:none}
.msg{animation:msgin .21s cubic-bezier(.22,1,.36,1) both}
@keyframes msgin{from{opacity:0;transform:translateY(12px) scale(.985)}}
.home{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:calc(48px + var(--sat,0px)) 24px calc(var(--dh,130px) + 20px);text-align:center;animation:fadein .34s both}
.hlogo{display:grid;place-items:center;width:112px;height:112px;border-radius:50%;cursor:pointer;color:var(--fg);filter:drop-shadow(0 0 30px rgba(var(--fr),.2));animation:bob 6s ease-in-out infinite;transition:transform .17s cubic-bezier(.34,1.56,.64,1)}
.hlogo:active{transform:scale(.92)}.hlogo .lg{width:84px;height:84px}
.hline{height:44px;margin-top:14px;display:grid;place-items:center}
.hline h1{background:none;-webkit-text-fill-color:var(--fg);color:var(--fg);font-size:clamp(26px,7vw,34px);font-weight:600;letter-spacing:-.04em;padding:0;animation:hl .42s cubic-bezier(.22,1,.36,1) both}
.hline h1.mod{font-size:16px;font-weight:500;letter-spacing:-.01em;-webkit-text-fill-color:rgba(var(--fr),.55)}
@keyframes hl{from{opacity:0;filter:blur(10px);transform:translateY(8px)}}
.glance{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px 10px;margin-top:12px;font-size:13px;color:rgba(var(--fr),.5);animation:glance 9s ease both}
.hchips{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:26px;max-width:440px;animation:glance 14s .21s both}
@keyframes glance{0%{opacity:0;transform:translateY(8px)}7%{opacity:1;transform:none}85%{opacity:1}100%{opacity:0;visibility:hidden}}
.hchips button{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 15px 0 12px;border-radius:99px;font-size:13.5px;font-weight:500;cursor:pointer;background:rgba(var(--fr),.05);box-shadow:inset 0 0 0 1px rgba(var(--fr),.08);animation:rise .23s cubic-bezier(.2,.8,.2,1) both;transition:transform .13s cubic-bezier(.34,1.56,.64,1),background .12s}
.hchips button:active{transform:scale(.94);background:rgba(var(--fr),.1)}
.hrec{margin-top:22px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:rgba(var(--fr),.38);cursor:pointer;transition:color .12s}.hrec:hover{color:rgba(var(--fr),.7)}
.tp{position:absolute;top:calc(60px + var(--sat,0px));left:0;right:0;margin:0 auto;max-height:calc(100% - 76px - var(--sat,0px));overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;width:min(340px,calc(100% - 24px));padding:8px;border-radius:26px;z-index:40;background:rgba(var(--gr),.86);backdrop-filter:blur(28px) saturate(160%);-webkit-backdrop-filter:blur(28px) saturate(160%);box-shadow:inset 0 0 0 1px rgba(var(--fr),.09),0 24px 60px rgba(0,0,0,.65);transform-origin:top center;animation:tpin .17s cubic-bezier(.2,.9,.3,1.1) both}
@keyframes tpin{from{opacity:0;transform:translateY(-10px) scale(.94)}}
.tseg{position:relative;display:grid;grid-template-columns:repeat(2,minmax(88px,auto));width:max-content;max-width:100%;padding:3px;margin:0 auto 8px;border-radius:99px;background:rgba(var(--fr),.07);box-shadow:inset 0 0 0 1px rgba(var(--fr),.08)}
.tseg button{position:relative;z-index:1;height:28px;padding:0 16px;display:grid;place-items:center;border-radius:99px;font-size:12.5px;letter-spacing:.01em;font-weight:600;color:rgba(var(--fr),.5);cursor:pointer;transition:color .13s}.tseg button.on{color:var(--bg)}
.tseg i{position:absolute;top:3px;bottom:3px;left:3px;width:calc(50% - 3px);border-radius:99px;background:var(--fg);box-shadow:0 2px 8px rgba(0,0,0,.35);transition:transform .19s cubic-bezier(.34,1.3,.64,1)}.tseg.r i{transform:translateX(100%)}
.tpb{animation:fadein .15s both}
.trw{display:flex;align-items:center;gap:12px;width:100%;padding:11px 12px;border-radius:16px;font-size:14.5px;font-weight:500;text-align:left;cursor:pointer;transition:background .12s}.trw:active,.trw:hover{background:rgba(var(--fr),.07)}
.trw svg{opacity:.7;flex:none}.trw.sm{font-size:14px}.trw.sm span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.trw time{flex:none;font-size:12px;color:rgba(var(--fr),.38)}
.sw{margin-left:auto;position:relative;flex:none;width:38px;height:22px;border-radius:99px;background:rgba(var(--fr),.14);transition:background .13s}
.sw::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--fg);transition:transform .17s cubic-bezier(.34,1.56,.64,1),background .13s}.sw.on{background:var(--fg)}.sw.on::after{background:var(--bg);transform:translateX(16px)}
.drawer{width:min(318px,84%);padding:calc(18px + var(--sat,0px)) 14px calc(12px + env(safe-area-inset-bottom,0px));border-radius:0 28px 28px 0;background:rgba(var(--gr),.93);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);box-shadow:inset -1px 0 0 rgba(var(--fr),.07),30px 0 80px rgba(0,0,0,.7)}
.dbrand{display:flex;align-items:center;gap:10px;padding-left:6px;font-size:16px;font-weight:600;letter-spacing:-.02em}
.newc{height:46px;border-radius:16px;background:rgba(var(--fr),.06);color:var(--fg);box-shadow:inset 0 0 0 1px rgba(var(--fr),.08);transition:background .12s,transform .13s cubic-bezier(.34,1.56,.64,1)}.newc:hover{background:rgba(var(--fr),.1)}
.dsr{height:42px;margin-top:8px;border-radius:16px;background:none;box-shadow:inset 0 0 0 1px rgba(var(--fr),.08)}
.dgrp{margin:20px 10px 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase}
.drow{border-radius:14px;transition:background .12s}.drow:hover{background:rgba(var(--fr),.05)}.drow.cur{background:rgba(var(--fr),.09)}
.dfoot{flex:none;width:100%;margin-top:6px;padding:12px 8px 4px;border-top:1px solid rgba(var(--fr),.07);border-radius:0}
@media (prefers-reduced-motion:reduce){.lg,.lg *,.msg,.glance,.hchips,.hlogo{animation:none}}
.hlogo{color:var(--lc,var(--fg))}
.aura.calm .blob,.aura.calm .lg .b,.aura.calm .hlogo{animation:none}
.aura.fs-s .scroll{zoom:.92}.aura.fs-l .scroll{zoom:1.12}
.aura.light{--fr:24,24,30;--gr:255,255,255;--fg:#17171b;--bg:#f4f4f1;--s1:#ffffff;--s2:#ecece8;--cs:light}
.aura.light .glass,.aura.light .pane{box-shadow:inset 0 0 0 1px rgba(var(--fr),.1),0 6px 24px rgba(20,20,30,.08)}
.aura.light .toast{box-shadow:0 8px 24px rgba(20,20,30,.2)}
`;
const CSS5 = `
/* ===== v2: minimal, fast, calm ===== */
.blob,.spot,.ring{display:none!important}
.aura{font-family:var(--ff,'Inter'),system-ui,-apple-system,'Segoe UI',sans-serif}
.aura :is(textarea,input,select,button),.aura .composer textarea,.sheet input,.fld input,.fld textarea,.sel,.dsr input{font-family:inherit}

/* top pill: chats on its own side, model in the middle, new chat + settings on the right */
.head{display:block;padding:calc(10px + var(--sat,0px)) 12px 4px}
.pillbar{display:flex;align-items:center;justify-content:space-between;gap:4px;height:46px;max-width:480px;margin:0 auto;padding:0 5px;border-radius:999px;transition:opacity .2s}
.head.dim .pillbar{opacity:.55}
.pgrp{display:flex;align-items:center;gap:2px;width:80px}.pgrp.r{justify-content:flex-end}
.pbtn{display:grid;place-items:center;flex:none;width:38px;height:38px;border-radius:50%;color:var(--fg);cursor:pointer;transition:background .15s,transform .15s}
.pbtn:hover{background:rgba(var(--fr),.08)}.pbtn:active{transform:scale(.92)}
.pillbar .model.tt{height:38px;padding:0 10px;font-size:14.5px}
.tp{top:calc(64px + var(--sat,0px))}
.scroll{padding-top:calc(72px + var(--sat,0px))}

/* chats panel */
.dscrim{transition:opacity .16s,visibility 0s .16s}.drawer{transition:transform .2s cubic-bezier(.2,.9,.3,1),visibility 0s .2s}
.dtop{padding:0 2px 8px 6px}.drawer .newc{display:none}

/* composer: centred and narrow with side margins, widens when pressed; no moving glow */
.aura .dock{padding:0 clamp(30px,11vw,64px) calc(16px + env(safe-area-inset-bottom,0px));transition:padding .2s cubic-bezier(.2,.9,.3,1)}
.aura .dock.wide{padding:0 clamp(10px,3vw,24px) calc(14px + env(safe-area-inset-bottom,0px))}
.aura .dock .composer{width:100%;max-width:330px;margin:0 auto;border-radius:26px;transition:max-width .2s cubic-bezier(.2,.9,.3,1)}
.aura .dock .composer.open{max-width:720px;border-radius:24px}
.composer.glass::before{opacity:.45}
.tgs{overflow:visible}
.aura .tgs .tg{width:auto;padding:0 12px 0 10px;justify-content:center}.aura .tgs .tl2{display:inline}
.optp{position:absolute;left:50%;bottom:calc(100% + 2px);translate:-50% 0;width:min(310px,calc(100% - 20px));padding:6px;border-radius:22px;z-index:5;animation:optin .16s both;transform-origin:bottom center}
@keyframes optin{from{opacity:0;transform:translateY(6px) scale(.97)}}
.orow{display:flex;align-items:center;gap:12px;width:100%;padding:10px;border-radius:16px;text-align:left;cursor:pointer}
.orow:hover{background:rgba(var(--fr),.06)}
.orow>div{flex:1;min-width:0;display:flex;flex-direction:column}.orow b{font-size:14px;font-weight:600}.orow span{font-size:12px;color:rgba(var(--fr),.5)}

/* settings: flat, quiet, scannable */
.sheet.big{width:min(440px,calc(100% - 20px))}
.sbody{padding:0 18px 22px}
.sg{margin:22px 2px 6px;font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:rgba(var(--fr),.38)}
.srow{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:0 2px;font-size:15px}
.seg{display:flex;padding:3px;border-radius:12px;background:rgba(var(--fr),.07)}
.seg button{padding:6px 14px;border-radius:9px;font-size:13.5px;color:rgba(var(--fr),.6);cursor:pointer;transition:background .15s,color .15s}
.seg button.on{background:var(--fg);color:var(--bg);font-weight:600}
.sbody details{padding:0;border-top:0}
.sbody details>summary{height:48px;padding:0 2px;font-size:15px;font-weight:500}
.sbody details[open]{padding-bottom:6px}
.sbody details details{padding-left:10px;border-left:1px solid rgba(var(--fr),.08);margin-left:2px}
.sbody details details>summary{font-size:14px;color:rgba(var(--fr),.75)}
.swr{padding:6px 2px;min-height:48px}.swr b{font-size:15px;font-weight:500}
.fld{margin:8px 0}
.dd{position:relative}
.ddb{display:flex;align-items:center;gap:8px;height:38px;padding:0 12px;border-radius:12px;background:rgba(var(--fr),.07);font-size:14px;max-width:220px;cursor:pointer}
.ddb span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddscrim{position:fixed;inset:0;z-index:60}
.ddl{position:absolute;right:0;top:calc(100% + 6px);z-index:61;min-width:210px;max-height:250px;overflow-y:auto;padding:6px;border-radius:16px;background:var(--s2);box-shadow:0 0 0 1px rgba(var(--fr),.1),0 14px 40px rgba(0,0,0,.45);animation:optin .14s both;scrollbar-width:none}
.ddl button{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:9px 10px;border-radius:10px;font-size:14px;text-align:left;cursor:pointer}
.ddl button:hover,.ddl button.on{background:rgba(var(--fr),.08)}
.inl .vq{display:block;height:40px;padding:0 14px;border-radius:12px;background:rgba(var(--fr),.07);box-shadow:inset 0 0 0 1px rgba(var(--fr),.1);font-size:14.5px;color:var(--fg)}

/* live: one card, a horizontal chain of bubbles */
.lv{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;padding:0 14px calc(16px + env(safe-area-inset-bottom,0px));pointer-events:none;z-index:48}
.lvcard{pointer-events:auto;width:min(420px,100%);display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px 16px 14px;border-radius:30px;background:rgba(var(--gr),.86);-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px);box-shadow:0 0 0 1px rgba(var(--fr),.08),0 16px 50px rgba(0,0,0,.45);animation:lvIn .2s cubic-bezier(.2,.9,.3,1) both}
.lvc{max-width:100%;min-height:22px;padding:0 8px;background:none;-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:none;border-radius:0;font-size:14.5px;line-height:1.4;text-align:center;color:var(--fg);white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;animation:fadein .15s both}
.lvc.dim{color:rgba(var(--fr),.5)}
.lvact{display:flex;gap:8px}
.lvmid{position:relative;width:100%;height:92px;cursor:pointer}
.lvw{position:absolute;inset:0;width:100%;height:100%;color:var(--lc,var(--fg))}
.lvbtns{display:flex;gap:14px}
.lvbtns .ib{width:44px;height:44px;background:rgba(var(--fr),.08);animation:none}
.aura.islive .dock{transition:opacity .15s,transform .2s}

/* assistant gesture: only the live card, over the user's real screen */
.aura.asst{background:transparent}
.aura.asst :is(.scroll,.head,.dock,.fade-t,.fade-b,.drawer,.dscrim){display:none!important}
.aura.asst .lv{inset:0;padding:0;align-items:stretch}
.aura.asst .lvcard{width:100%;height:100%;justify-content:center;border-radius:0;background:var(--s1);-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:none;animation:none;padding:20px 18px 16px}

/* light theme: flat and solid, no glass */
.aura.light .glass,.aura.light .pane,.aura.light .lvcard,.aura.light .drawer,.aura.light .sheet,.aura.light .tp{background:#fff;-webkit-backdrop-filter:none;backdrop-filter:none}
.aura.light .glass{box-shadow:0 0 0 1px rgba(20,20,30,.07),0 6px 22px rgba(20,20,30,.07)}
.aura.light .glass::before{display:none}
.aura.light .pane{box-shadow:0 0 0 1px rgba(20,20,30,.07)}
.aura.light .lvcard{box-shadow:0 0 0 1px rgba(20,20,30,.07),0 12px 40px rgba(20,20,30,.12)}
.aura.light .drawer{box-shadow:0 0 0 1px rgba(20,20,30,.07),20px 0 60px rgba(20,20,30,.12)}
.aura.light .sheet.big{background:#fff}
.aura.light .ddl{background:#fff;box-shadow:0 0 0 1px rgba(20,20,30,.08),0 12px 32px rgba(20,20,30,.14)}
.aura.light .seg button.on,.aura.light .tg.on{box-shadow:none}
.aura.light.asst .lvcard{background:#fff}
`;
const CSS6 = `
/* ── v2: smooth + minimal ───────────────────────────────── */
.aura{--ease:cubic-bezier(.22,1,.36,1);--mbg:#111113;--gbg:linear-gradient(160deg,#1d1d21,#131315)}
.aura.light{--mbg:#ffffff;--gbg:#ffffff}
/* Blur is the main reason WebViews stutter: drop it everywhere and use solid surfaces instead. */
.aura *,.aura *::before,.aura *::after{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
.glass{background:var(--gbg)!important;box-shadow:inset 0 0 0 1px rgba(var(--fr),.1),0 8px 24px rgba(0,0,0,.4)!important}
.glass::before{display:none!important}
.aura.light .glass{box-shadow:inset 0 0 0 1px rgba(20,20,30,.08),0 6px 20px rgba(20,20,30,.08)!important}
.aura :is(button,input,textarea,select){font-family:inherit!important}
.aura button{-webkit-tap-highlight-color:transparent}
.aura .scroll{overscroll-behavior:contain;-webkit-overflow-scrolling:touch}

/* header: no pill, no background. Just icons that fade away when idle.
   (class names are unique on purpose: .hd / .hr are the Markdown heading and rule styles) */
.eptBar{position:absolute;top:0;left:0;right:0;z-index:30;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;margin:0;padding:calc(20px + var(--sat,0px)) 10px 4px;background:none;box-shadow:none;border:0;pointer-events:none}
.eptBar>*{pointer-events:auto}
.eptL{justify-self:start;display:flex;align-items:center}
.eptR{justify-self:end;display:flex;align-items:center;gap:0}
.hb{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;color:rgba(var(--fr),.88);background:transparent;box-shadow:none;transition:opacity .5s ease,transform .2s var(--ease),background .2s ease}
.hb:active{transform:scale(.86);background:rgba(var(--fr),.1)}
.htitle{display:flex;align-items:center;gap:8px;height:42px;padding:0 12px;border-radius:999px;font-size:15px;font-weight:600;color:var(--fg);background:transparent;box-shadow:none;transition:opacity .5s ease,transform .2s var(--ease),background .2s ease}
.htitle:active{transform:scale(.96);background:rgba(var(--fr),.08)}
.eptBar.dim .hb{opacity:0}
.eptBar.dim .htitle{opacity:.5}
.aura.asst .eptBar{display:none!important}

/* modals (settings, chats, key) */
@keyframes mfade{from{opacity:0}to{opacity:1}}
@keyframes mpop{from{opacity:0;transform:translate3d(0,14px,0) scale(.97)}to{opacity:1;transform:none}}
@keyframes mrise{from{opacity:0;transform:translate3d(0,8px,0)}to{opacity:1;transform:none}}
.mscrim{position:absolute;inset:0;z-index:80;background:rgba(0,0,0,.55);animation:mfade .22s ease both}
.aura.light .mscrim{background:rgba(20,20,30,.28)}
.modal{position:absolute;inset:0;margin:auto;z-index:81;width:min(calc(100% - 28px),420px);height:fit-content;max-height:min(calc(100% - 40px),680px);display:flex;flex-direction:column;overflow:hidden;border-radius:28px;background:var(--mbg);color:var(--fg);box-shadow:inset 0 0 0 1px rgba(var(--fr),.09),0 24px 60px rgba(0,0,0,.5);animation:mpop .3s var(--ease) both}
.modal.tall{height:min(calc(100% - 40px),640px)}
.modal.sm{max-height:none}
.aura.light .modal{box-shadow:inset 0 0 0 1px rgba(20,20,30,.08),0 24px 60px rgba(20,20,30,.18)}
.mh{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 14px 8px 20px;flex:none}
.mh h3{font-size:18px;font-weight:650;letter-spacing:-.02em}
.mb{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:2px 20px 20px;display:flex;flex-direction:column}
.mb>*{flex:none}
.ms{margin:22px 0 8px;font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:rgba(var(--fr),.42)}
.ms:first-child{margin-top:8px}
.mr{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:46px;font-size:15px;font-weight:500;width:100%;text-align:left}
.mr.col{flex-direction:column;align-items:stretch;gap:10px;padding:8px 0}
.mr.col>span{display:flex;justify-content:space-between;color:rgba(var(--fr),.8)}
.mr.col>span b{font-weight:600;color:var(--fg)}
.mr.pick{padding:0;cursor:pointer}
.mr .mval{font-weight:500;color:rgba(var(--fr),.55)}
.mr.pick b{margin-left:auto;font-weight:500;color:rgba(var(--fr),.55);max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mseg{display:flex;padding:3px;border-radius:999px;background:rgba(var(--fr),.07)}
.mseg button,.mtabs button{height:30px;padding:0 15px;border-radius:999px;font-size:13px;font-weight:600;color:rgba(var(--fr),.6);transition:background .22s var(--ease),color .22s ease}
.mseg button.on,.mtabs button.on{background:var(--fg);color:var(--bg)}
.mtabs{display:flex;gap:4px;padding:3px;border-radius:999px;background:rgba(var(--fr),.07)}
.fgrid{display:flex;flex-wrap:wrap;gap:8px}
.fchip{height:38px;padding:0 15px;border-radius:999px;font-size:14px;background:rgba(var(--fr),.06);box-shadow:inset 0 0 0 1px rgba(var(--fr),.08);color:var(--fg);transition:transform .15s var(--ease),background .2s ease}
.fchip:active{transform:scale(.95)}
.fchip.on{background:var(--fg);color:var(--bg);box-shadow:none}
.modal input:not([type=range]):not([type=checkbox]),.modal textarea{display:block;width:100%;min-width:0;height:46px;padding:0 14px;border-radius:14px;background:rgba(var(--fr),.06);box-shadow:inset 0 0 0 1px rgba(var(--fr),.1);color:var(--fg);caret-color:var(--fg);font-size:15px;font-weight:500;line-height:1.4;transition:box-shadow .2s ease}
.modal textarea{height:auto;min-height:76px;padding:12px 14px;resize:none;white-space:pre-wrap;overflow-wrap:anywhere}
.modal input:not([type=range]):focus,.modal textarea:focus{box-shadow:inset 0 0 0 1.5px rgba(var(--fr),.5)}
.modal input::placeholder,.modal textarea::placeholder{color:rgba(var(--fr),.36)}
.mf{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.mf>span{font-size:13px;font-weight:500;color:rgba(var(--fr),.6)}
.kf{margin-bottom:14px}
.kfh{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:7px;font-size:14px;font-weight:600}
.kfh em{font-style:normal;font-size:12px;font-weight:500;color:rgba(var(--fr),.4)}
.kfh em.ok{color:#7ddc9a}
.aura.light .kfh em.ok{color:#1f9d55}
.kfr{display:flex;gap:8px}
.kbtn{flex:none;min-width:66px;height:46px;padding:0 16px;display:grid;place-items:center;border-radius:14px;font-size:14px;font-weight:650;background:rgba(var(--fr),.07);color:rgba(var(--fr),.4);transition:background .2s ease,color .2s ease,transform .15s var(--ease)}
.kbtn.go{background:var(--fg);color:var(--bg)}
.kbtn:active{transform:scale(.95)}
.klink{margin-top:8px;font-size:12.5px;font-weight:500;color:rgba(var(--fr),.5);text-decoration:underline;text-underline-offset:3px}
.mhint{margin:8px 0 0;font-size:12.5px;line-height:1.45;color:rgba(var(--fr),.5)}
.merr{margin:10px 0 0;font-size:13px;line-height:1.45;color:#ff8a8a}
.aura.light .merr{color:#c62828}
.mbtn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:46px;margin-top:10px;border-radius:14px;font-size:14.5px;font-weight:600;background:rgba(var(--fr),.07);color:var(--fg);transition:transform .15s var(--ease),background .2s ease,color .2s ease}
.mbtn:active{transform:scale(.97)}
.mbtn.go{background:var(--fg);color:var(--bg)}
.mbtn:disabled{opacity:.4}
.mbtn.danger{background:#ff5d5d;color:#fff}
.vbox{margin:2px 0 8px;display:flex;flex-direction:column;gap:8px;animation:mrise .22s var(--ease) both}
.vlist{max-height:210px;overflow-y:auto;overscroll-behavior:contain;border-radius:16px;background:rgba(var(--fr),.045);padding:4px}
.vi{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:42px;padding:0 12px;border-radius:12px;font-size:14px;text-align:left;color:var(--fg)}
.vi span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vi.on{background:rgba(var(--fr),.12);font-weight:600}
.vi:active{background:rgba(var(--fr),.1)}
.mrange{-webkit-appearance:none;appearance:none;width:100%;height:28px;background:transparent;cursor:pointer}
.mrange::-webkit-slider-runnable-track{height:4px;border-radius:9px;background:rgba(var(--fr),.2)}
.mrange::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;margin-top:-9px;border-radius:50%;background:var(--fg);box-shadow:0 2px 8px rgba(0,0,0,.4)}
.mems2{display:flex;flex-direction:column;gap:6px}
.mem2{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 8px 9px 14px;border-radius:14px;background:rgba(var(--fr),.05);font-size:13.5px;line-height:1.4}
.mem2 button{flex:none;width:28px;height:28px;display:grid;place-items:center;border-radius:50%;color:rgba(var(--fr),.55)}

/* models */
.epModel{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:13px 16px;margin-bottom:8px;border-radius:18px;text-align:left;background:rgba(var(--fr),.045);color:var(--fg);transition:background .2s ease,transform .15s var(--ease)}
.epModel:active{transform:scale(.98)}
.epModel.on{background:rgba(var(--fr),.11);box-shadow:inset 0 0 0 1px rgba(var(--fr),.16)}
.epModel div{display:flex;flex-direction:column;gap:2px;min-width:0}
.epModel b{font-size:15px;font-weight:600}
.epModel span{font-size:12.5px;color:rgba(var(--fr),.52)}

/* chats */
.ctop{display:flex;gap:8px;padding:0 20px 12px;flex:none}
.csr{flex:1;min-width:0;display:flex;align-items:center;gap:8px;height:42px;padding:0 14px;border-radius:999px;background:rgba(var(--fr),.06);color:rgba(var(--fr),.5)}
.csr input{flex:1;min-width:0;width:auto!important;height:auto!important;padding:0!important;background:transparent!important;box-shadow:none!important;border-radius:0!important;font-size:14.5px!important}
.cnew{flex:none;display:flex;align-items:center;gap:7px;height:42px;padding:0 16px 0 13px;border-radius:999px;font-size:14px;font-weight:650;background:var(--fg);color:var(--bg);transition:transform .15s var(--ease)}
.cnew:active{transform:scale(.95)}
.clist2{padding-top:0}
.cg{margin-bottom:10px}
.cgl{margin:8px 4px 8px;font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:rgba(var(--fr),.4)}
.cit{margin-bottom:8px;border-radius:20px;background:rgba(var(--fr),.045);animation:mrise .28s var(--ease) both;transition:background .2s ease}
.cit.cur{background:rgba(var(--fr),.1);box-shadow:inset 0 0 0 1px rgba(var(--fr),.15)}
.cir{display:flex;align-items:center;padding-right:6px}
.cmain2{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;padding:13px 6px 13px 16px;text-align:left;color:var(--fg)}
.cmain2:active{opacity:.7}
.ct{display:flex;align-items:center;gap:6px;font-size:14.5px;font-weight:600}
.ct i{font-style:normal;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ct time{flex:none;font-size:11px;font-weight:500;color:rgba(var(--fr),.4)}
.cp{font-size:12.5px;line-height:1.4;color:rgba(var(--fr),.5);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cedit{flex:1}
.cacts{display:flex;gap:6px;padding:0 12px 12px;animation:mrise .2s var(--ease) both}
.cacts button{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;height:36px;border-radius:12px;font-size:13px;font-weight:600;background:rgba(var(--fr),.07);color:var(--fg)}
.cacts button.danger{background:#ff5d5d;color:#fff}
.cempty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:48px 20px;text-align:center;color:rgba(var(--fr),.45)}
.cempty b{font-size:15px;color:var(--fg);margin-top:6px}
.cempty span{font-size:13px}

/* assistant card without a key */
.anokey{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px;text-align:center}
.anokey b{font-size:16px;font-weight:650}
.anokey span{font-size:13px;line-height:1.45;color:rgba(var(--fr),.55);max-width:300px}
.anokey .mbtn{width:auto;padding:0 22px}

/* a little calmer motion on phones */
@media(pointer:coarse){.ring i{animation:none!important}}
`;

const readAtt = (f) => new Promise((res, rej) => {
  if (f.type.startsWith("image/")) {
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const draw = (max, q) => { const s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s)); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", q); };
      const src = draw(1280, 0.82), th = draw(96, 0.6); URL.revokeObjectURL(url);
      res({ k: "img", mime: "image/jpeg", data: src.split(",")[1], th, name: f.name || "photo" });
    };
    img.onerror = () => rej(new Error("Couldn't read that image"));
    img.src = url;
  } else if (f.type === "application/pdf") {
    if (f.size > 8e6) return rej(new Error("PDFs must be under 8 MB"));
    const r = new FileReader(); r.onload = () => res({ k: "pdf", mime: "application/pdf", data: String(r.result).split(",")[1], name: f.name }); r.onerror = () => rej(new Error("Couldn't read that PDF")); r.readAsDataURL(f);
  } else {
    if (f.size > 600000) return rej(new Error("Text files must be under 600 KB"));
    const r = new FileReader(); r.onload = () => res({ k: "txt", text: String(r.result).slice(0, 40000), name: f.name }); r.onerror = () => rej(new Error("Couldn't read that file")); r.readAsText(f);
  }
});

/* ── One chat row (memoised so typing only re-renders its own row) ── */
const Row = memo(function Row({ m, last, copied, sp, api }: any) {
  if (m.role === "user") return (
    <div className="msg row-r"><div>
      {m.att?.length > 0 && <div className="uatt">{m.att.map((a, i) => a.th ? <img key={i} src={a.th} alt={a.name} /> : <span key={i}><FileText size={14} {...ico} />{a.name}</span>)}</div>}
      <div className="pane ub">{m.voice ? <Mic size={13} {...ico} style={{ marginRight: 7, opacity: 0.6, verticalAlign: -1 }} /> : null}{m.text}</div>
    </div></div>
  );
  return (
    <div className="msg ai">
      <div className={"aimark" + (m.state === "think" || m.state === "type" || m.state === "live" ? " fast" : "")}><Mark size={15} fast={m.state === "think" || m.state === "type" || m.state === "live"} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {m.state === "think" ? (
          <>
            <Trace list={m.trace} />
            <div className="think">
              <span className="shim">{m.step ? m.step : m.mode === "search" ? "Searching the web" : m.mode === "think" ? "Thinking" : "Working on it"}</span>
              <span className="dots"><i /><i /><i /></span>
            </div>
          </>
        ) : m.state === "error" ? (
          <>
            <div className="aitext err">{m.err}</div>
            <div className="acts">
              {m.keyErr && <button className="tg on" onClick={() => api.current.askKey()}><KeyRound size={15} {...ico} />Set API key</button>}
              <button className="tg" onClick={() => api.current.regen(m.id)}><RefreshCw size={15} {...ico} />Try again</button>
            </div>
          </>
        ) : (
          <>
            <Trace list={m.trace} />
            {m.th && <div className="thought"><Brain size={14} {...ico} />Thought for {m.th}s</div>}
            <div className="aitext">{m.state === "live" ? <Md text={m.text} /> : <Typer m={m} onDone={api.current.finish} prog={api.current.prog} />}{(m.state === "type" || m.state === "live") && <span className="caret" />}</div>
            {m.state === "done" && <Sources list={m.sources} queries={m.queries} />}
          </>
        )}
        {m.state === "done" && (
          <div className="acts">
            <button className="ib sm ghost" aria-label="Copy" onClick={() => api.current.copy(m)}>{copied ? <Check size={15} {...ico} /> : <Copy size={15} {...ico} />}</button>
            <button className={"ib sm ghost" + (sp ? " lit" : "")} aria-label={sp ? "Stop reading" : "Read aloud"} onClick={() => api.current.speak(m)}>{sp ? <Square size={13} fill="currentColor" {...ico} /> : <Volume2 size={15} {...ico} />}</button>
            {last && <button className="ib sm ghost" aria-label="Regenerate" onClick={() => api.current.regen(m.id)}><RefreshCw size={15} {...ico} /></button>}
          </div>
        )}
      </div>
    </div>
  );
});

/* ── Main component ─────────────────────────────────────── */
function App({ assistant = false, onExit }: any) {
  const [profiles, setProfiles] = useState<any>(loadProfiles);
  const [pid, setPid] = useState<any>(() => { const a = LS.get("epique.active", ""), p = loadProfiles(); return p.some((x) => x.id === a) ? a : p[0].id; });
  const prof = profiles.find((p) => p.id === pid) || profiles[0];
  const [cfg, setCfgS] = useState<any>(() => ({ ...DEF_CFG, ...LS.get("epique.cfg", {}) }));
  const setCfg = (patch) => setCfgS((c) => { const n = { ...c, ...patch }; LS.set("epique.cfg", n); return n; });
  const model = MODELS.find((m) => m.id === cfg.model) || MODELS[0];
  const [chats, setChats] = useState<any>(() => LS.get(chatKey(pid), []));
  const [cid, setCid] = useState<any>(null);
  const [msgs, setMsgs] = useState<any>([]);
  const [input, setInput] = useState<any>("");
  const [atts, setAtts] = useState<any>([]);
  const [busy, setBusy] = useState<any>(false);
  const [live, setLive] = useState<any>(false);
  // The header icons show on any touch / scroll / keypress and fade away on their own after a short idle.
  const [hv, setHv] = useState<any>(true), hvT = useRef<any>(undefined), hvRef = useRef<any>(true), wasDim = useRef<any>(false);
  const poke = useCallback(() => { hvRef.current = true; setHv(true); clearTimeout(hvT.current); hvT.current = setTimeout(() => { hvRef.current = false; setHv(false); }, 2800); }, []);
  useEffect(() => {
    poke(); const el = scroll.current, r = root.current;
    const down = () => { wasDim.current = !hvRef.current; poke(); };
    el?.addEventListener("scroll", poke, { passive: true }); r?.addEventListener("pointerdown", down, { capture: true, passive: true } as any); r?.addEventListener("keydown", poke);
    return () => { el?.removeEventListener("scroll", poke); r?.removeEventListener("pointerdown", down, { capture: true } as any); r?.removeEventListener("keydown", poke); clearTimeout(hvT.current); };
  }, [poke]); // eslint-disable-line
  const askRef = useRef<any>(undefined);
  const [open, setOpen] = useState<any>(false);
  const [panel, setPanel] = useState<any>(false), [optOpen, setOptOpen] = useState<any>(false), [noKey, setNoKey] = useState<any>(false);
  const [settings, setSettings] = useState<any>(false);
  
  const [copied, setCopied] = useState<any>(null);
  const [speaking, setSpeaking] = useState<any>(null);
  useEffect(() => () => tts.stop(), []);
  const [keyOpen, setKeyOpen] = useState<any>(false);
  const [keyVal, setKeyVal] = useState<any>("");
  const [far, setFar] = useState<any>(false);
  const [toast, setToast] = useState<any>("");
  const root = useRef<any>(undefined), scroll = useRef<any>(undefined), wrap = useRef<any>(undefined), spot = useRef<any>(undefined), ta = useRef<any>(undefined), comp = useRef<any>(undefined), dock = useRef<any>(undefined), fileRef = useRef<any>(undefined);
  const ctl = useRef<any>(null), uid = useRef<any>(0), msgsRef = useRef<any>([]), turnRef = useRef<any>(undefined), api = useRef<any>({}), inputRef = useRef<any>("");
  const prog = useRef<any>({}), waiters = useRef<any>({}), stick = useRef<any>(true), pend = useRef<any>(null), mv = useRef<any>(0);
  const nid = () => ++uid.current;
  msgsRef.current = msgs; inputRef.current = input;
  const dict = useDictation(() => inputRef.current, (t) => { setInput(t); if (ta.current) { ta.current.style.height = "auto"; ta.current.style.height = Math.min(ta.current.scrollHeight, 140) + "px"; } });
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), m.length > 40 ? 5000 : 2200); };
  useEffect(() => { const prev = ttsSink; ttsSink = (m) => { setSpeaking(null); flash(m); }; return () => { ttsSink = prev; }; }, []);

  useEffect(() => { ensureFont(fontOf(cfg.font)); }, [cfg.font]);

  // Fonts live in the page head (a shadow root can't register @font-face), and the page itself must never scroll.
  useEffect(() => {
    if (!document.getElementById("epique-fonts")) {
      const l = document.createElement("link"); l.id = "epique-fonts"; l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=STIX+Two+Text:ital,wght@0,400;0,600;1,400&display=swap"; document.head.appendChild(l);
    }
    const h = document.documentElement, b = document.body, o = [h.style.overflow, b.style.overflow, b.style.background];
    h.style.overflow = b.style.overflow = "hidden"; b.style.background = assistant ? "transparent" : "#050505"; if (assistant) h.style.background = "transparent";
    return () => { h.style.overflow = o[0]; b.style.overflow = o[1]; b.style.background = o[2]; };
  }, []);
  useEffect(() => { const f = () => setSettings(true); window.addEventListener("epique:settings", f); return () => window.removeEventListener("epique:settings", f); }, []);

  // Keep pinned to the bottom while content grows (typing, cards and photos loading).
  useEffect(() => {
    const el = scroll.current, w = wrap.current;
    if (!el || !w) return;
    let raf = 0;
    const onS = () => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setFar(el.scrollHeight - el.scrollTop - el.clientHeight > 380)); };
    el.addEventListener("scroll", onS, { passive: true });
    const ro = new ResizeObserver(() => { if (!msgsRef.current.length) el.scrollTop = 0; else if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(w);
    return () => { el.removeEventListener("scroll", onS); ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  // Track the dock height (composer, mini player) so content and fades always clear it.
  useEffect(() => {
    const d = dock.current; if (!d) return;
    const ro = new ResizeObserver(() => root.current?.style.setProperty("--dh", d.offsetHeight + "px"));
    ro.observe(d); return () => ro.disconnect();
  }, []);

  // Lift the composer above the on-screen keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let raf;
    const upd = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => root.current?.style.setProperty("--kb", Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) + "px")); };
    vv.addEventListener("resize", upd); vv.addEventListener("scroll", upd); upd();
    return () => { cancelAnimationFrame(raf); vv.removeEventListener("resize", upd); vv.removeEventListener("scroll", upd); };
  }, []);

  useEffect(() => { if (!open) return; const t = setTimeout(() => ta.current?.focus(), 120); return () => clearTimeout(t); }, [open]);

  // Save the conversation once a reply has finished.
  useEffect(() => {
    if (busy || !msgs.some((m) => m.role === "user")) return;
    const t = setTimeout(() => {
      let id = cid; if (!id) { id = rid(); setCid(id); }
      setChats((cs) => { const old = cs.find((c) => c.id === id), sm = slim(msgs); if (old && old.msgs.length === sm.length && old.msgs[sm.length - 1]?.text === sm[sm.length - 1]?.text) return cs; return [{ id, title: old?.title || titleOf(msgs), pin: !!old?.pin, ai: !!old?.ai, ts: Date.now(), msgs: sm }, ...cs.filter((c) => c.id !== id)].slice(0, 100); });
    }, 400);
    return () => clearTimeout(t);
  }, [msgs, busy]); // eslint-disable-line
  const titled = useRef<any>(new Set());
  useEffect(() => {
    if (busy || !cid || titled.current.has(cid)) return;
    const u = msgs.find((m) => m.role === "user"), a = msgs.find((m) => m.role !== "user" && m.state === "done" && m.text), c = chats.find((x) => x.id === cid);
    if (!u || !a || !c || c.ai || c.title !== titleOf(msgs)) return;
    titled.current.add(cid);
    aiTitle(u.text, a.text).then((t) => t && setChats((cs) => cs.map((x) => (x.id === cid && !x.ai ? { ...x, title: t, ai: true } : x))));
  }, [chats, busy, cid, msgs]); // eslint-disable-line
  useEffect(() => {
    let arr = chats; while (!LS.set(chatKey(pid), arr) && arr.length > 1) arr = arr.slice(0, Math.ceil(arr.length * 0.8));
    if (arr.length !== chats.length) setChats(arr);
  }, [chats]); // eslint-disable-line

  const toHist = (arr) => arr.filter((x) => x.role === "user" || x.state === "done")
    .map((x) => ({ role: x.role === "user" ? "user" : "model", text: x.text, ctx: x.ctx, att: x.att }));

  const finish = useCallback((id) => {
    setMsgs((m) => m.map((x) => (x.id === id && x.state === "type" ? { ...x, state: "done" } : x)));
    waiters.current[id]?.(); delete waiters.current[id];
  }, []);

  const saveProfiles = (arr) => { setProfiles(arr); LS.set("epique.profiles", arr); };
  const updateProfile = (patch) => saveProfiles(profiles.map((p) => (p.id === prof.id ? { ...p, ...patch } : p)));
  const remember = (fact) => setProfiles((ps) => { const n = ps.map((p) => (p.id === pid && !p.mem.includes(fact) ? { ...p, mem: [...p.mem, fact].slice(-30) } : p)); LS.set("epique.profiles", n); return n; });

  // Runs the agent (tools, retries, optional streaming) and types the reply into the chat.
  const run = async (history, { voice = false, onDelta }: any = {}) => {
    const id = nid(), t0 = performance.now(), c = new AbortController();
    ctl.current = c; setBusy(true); stick.current = true;
    const patch = (o) => setMsgs((m) => m.map((x) => (x.id === id ? { ...x, ...o } : x)));
    setMsgs((m) => [...m, { id, role: "ai", text: "", state: "think", mode: cfg.search ? "search" : cfg.think ? "think" : "work" }]);
    try {
      const needLive = LIVE.test(history[history.length - 1]?.text || "");
      const r = await runAgent(history, {
        model, key: getKey(), signal: c.signal, voice, stream: voice, think: cfg.think, search: cfg.search || needLive, agent: cfg.agent || needLive,
        ctx: { name: prof.name, about: prof.about, mem: prof.mem, mcp: cfg.mcp, remember },
        onRetry: (n) => patch({ retry: n }),
        onStep: (tr) => patch({ trace: tr, step: tr.filter((x) => x.state === "run").pop()?.label || "" }),
        onDelta: voice ? (t) => { patch({ text: t, state: "live" }); onDelta?.(t); } : undefined,
      });
      if (voice) { patch({ text: r.text, sources: r.sources, queries: r.queries, trace: r.trace, state: "done", retry: 0, step: "" }); return r.text; }
      r.text = fixCards(r.text);
      const th = cfg.think ? ((performance.now() - t0) / 1000).toFixed(1) : null;
      const fin = new Promise((res) => { waiters.current[id] = res; });
      patch({ th, text: r.text, sources: r.sources, queries: r.queries, trace: r.trace, state: "type", retry: 0, step: "" });
      const stop = () => {
        patch({ state: "done", text: r.text.slice(0, prog.current[id] ?? r.text.length).trim() || "Stopped." });
        waiters.current[id]?.(); delete waiters.current[id];
      };
      c.signal.addEventListener("abort", stop, { once: true });
      await fin;
      c.signal.removeEventListener("abort", stop);
      return r.text;
    } catch (e) {
      if (e?.name === "AbortError") setMsgs((m) => m.map((x) => (x.id === id ? { ...x, state: "done", text: x.text || "Stopped." } : x)));
      else {
        const msg = explain(e);
        patch({ state: "error", err: msg, keyErr: e.status === 401 || e.status === 403 });
        if (voice) onDelta?.(explain(e));
      }
      return null;
    } finally { setBusy(false); }
  };

  const send = (t?) => {
    const text = (t ?? input).trim();
    if ((!text && !atts.length) || busy) return;
    if (!getKey()) { pend.current = text; setKeyOpen(true); return; }
    const a = atts, ctx = a.filter((x) => x.k === "txt").map((x) => `[File: ${x.name}]\n\`\`\`\n${x.text}\n\`\`\``).join("\n\n");
    const um = { id: nid(), role: "user", text: text || "Here's an attachment.", ...(ctx ? { ctx } : {}), ...(a.length ? { att: a.map(({ k, name, mime, data, th }) => ({ k, name, mime, data, th })) } : {}) };
    dict.stop(); setInput(""); setAtts([]);
    if (ta.current) ta.current.style.height = "auto";
    setMsgs((m) => [...m, um]);
    run([...toHist(msgsRef.current), um]);
  };

  const regen = (id) => {
    if (busy) return;
    const idx = msgsRef.current.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const hist = toHist(msgsRef.current.slice(0, idx));
    setMsgs((m) => m.slice(0, idx));
    run(hist);
  };

  const voiceTurn = (text, hooks) => {
    const um = { id: nid(), role: "user", text, voice: 1 };
    setMsgs((m) => [...m, um]);
    return run([...toHist(msgsRef.current), um], { voice: true, onDelta: hooks?.onDelta });
  };
  turnRef.current = voiceTurn;
  askRef.current = send;
  useEffect(() => { const f = (e) => askRef.current?.(e.detail); window.addEventListener("epique:ask", f); return () => window.removeEventListener("epique:ask", f); }, []);
  useReminders((r) => { flash("Reminder: " + r.text); beep(); try { if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Reminder", { body: r.text }); } catch (e) {} });

  const startLive = () => { if (!getKey()) { if (assistant) setNoKey(true); else setKeyOpen(true); return; } dict.stop(); setOpen(false); setLive(true); };
  useEffect(() => { if (assistant) startLive(); }, []); // eslint-disable-line

  /* history */
  const newChat = () => { tts.stop(); ctl.current?.abort(); setBusy(false); if (scroll.current) scroll.current.scrollTop = 0; setMsgs([]); setCid(null); setInput(""); setAtts([]); };
  const openChat = (id) => {
    const c = chats.find((x) => x.id === id); if (!c) return;
    ctl.current?.abort(); setBusy(false);
    uid.current = Math.max(uid.current, ...c.msgs.map((m) => m.id || 0));
    stick.current = true; setMsgs(c.msgs.map((m) => (m.role === "user" ? m : { ...m, state: m.state || "done" }))); setCid(id);
  };
  const delChat = (id) => { setChats((cs) => cs.filter((c) => c.id !== id)); if (id === cid) newChat(); };

  /* accounts */
  const switchProfile = (id) => {
    ctl.current?.abort(); setBusy(false);
    setPid(id); LS.set("epique.active", id); setChats(LS.get(chatKey(id), [])); setMsgs([]); setCid(null); setSettings(false);
  };
  const addProfile = () => { const p = newProfile("New profile"); saveProfiles([...profiles, p]); switchProfile(p.id); };
  const delProfile = (id) => { const rest = profiles.filter((p) => p.id !== id); if (!rest.length) return; LS.set(chatKey(id), []); saveProfiles(rest); switchProfile(rest[0].id); };
  const exportAll = () => downloadText(`epique-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ v: 1, profiles, chats: Object.fromEntries(profiles.map((p) => [p.id, p.id === pid ? chats : LS.get(chatKey(p.id), [])])) }), "application/json");
  const importAll = (d) => {
    if (!d || !Array.isArray(d.profiles)) throw new Error("bad");
    const have = new Set(profiles.map((p) => p.id)), add = d.profiles.filter((p) => p?.id && !have.has(p.id)).map((p) => ({ ...newProfile(p.name), ...p, mem: p.mem || [] }));
    saveProfiles([...profiles, ...add]);
    for (const [k, v] of Object.entries(d.chats || {})) {
      if (!Array.isArray(v)) continue;
      if (k === pid) setChats((cs) => { const ids = new Set(cs.map((c) => c.id)); return [...cs, ...v.filter((c) => !ids.has(c.id))].sort((a, b) => b.ts - a.ts).slice(0, 100); });
      else { const cur = LS.get(chatKey(k), []), ids = new Set(cur.map((c) => c.id)); LS.set(chatKey(k), [...cur, ...v.filter((c) => !ids.has(c.id))]); }
    }
  };

  const addFiles = async (list) => {
    const out = [];
    const fl = [...list].slice(0, 6 - atts.length); if (fl.length) await rep(fl.length, async (i) => { try { out.push(await readAtt(fl[i])); } catch (e) { flash(e.message); } });
    if (out.length) { setAtts((a) => [...a, ...out].slice(0, 6)); setOpen(true); }
  };

  api.current = {
    regen, finish, prog,
    askKey: () => { setKeyVal(""); setKeyOpen(true); },
    copy: (m) => { try { navigator.clipboard?.writeText(m.text); } catch (e) {} setCopied(m.id); setTimeout(() => setCopied(null), 1600); },
    speak: (m) => { if (speaking === m.id) return tts.stop(); tts.play(m.text, cfg.rate, () => setSpeaking(null)); setSpeaking(m.id); },
  };

  const submitKey = () => {
    const k = keyVal.trim();
    if (!k) return;
    saveKey(k); setKeyOpen(false); setKeyVal("");
    if (pend.current) { const t = pend.current; pend.current = null; send(t); }
  };

  const onMove = (e) => {
    if (mv.current) return;
    const x = e.clientX, y = e.clientY, tg = e.target;
    mv.current = requestAnimationFrame(() => {
      mv.current = 0;
      if (spot.current) spot.current.style.transform = `translate3d(${x - 260}px,${y - 260}px,0)`;
      const h = tg.closest?.(".hov");
      if (h) { const b = h.getBoundingClientRect(); h.style.setProperty("--px", x - b.left + "px"); h.style.setProperty("--py", y - b.top + "px"); }
    });
  };
  const onBlur = (e) => { if (!e.currentTarget.contains(e.relatedTarget) && !input.trim() && !atts.length && !busy && !optOpen) setOpen(false); };
  const mcpN = cfg.mcp.filter((s) => s.on).length, canSend = !!input.trim() || atts.length > 0;

  return (
    <div className={"aura" + (cfg.theme === "light" ? " light" : "") + (cfg.calm ? " calm" : "") + (live ? " islive" : "") + (assistant ? " asst" : "") + " fs-" + (cfg.fs || "m")} style={{ ...(cfg.accent && cfg.accent !== "#ffffff" ? { "--lc": cfg.accent } : {}), "--ff": fontOf(cfg.font).css } as any} ref={root}>
      <style>{CSS + CSS2 + CSS3 + CSS4 + CSS5 + CSS6}</style>


      <div className="scroll" ref={scroll}>
        <div className="wrap" ref={wrap}>
          {msgs.length === 0 && <Home prof={prof} recent={chats.slice(0, 3)} model={model.n} onTry={(q) => send(q)} onOpen={openChat} />}
          {msgs.map((m, i) => <Row key={m.id} m={m} last={i === msgs.length - 1} copied={copied === m.id} sp={speaking === m.id} api={api} />)}
        </div>
      </div>

      <div className="fade-t" />
      <div className="fade-b" />
      {far && msgs.length > 0 && <button className="glass ib fab pop" aria-label="Scroll to latest" onClick={() => { stick.current = true; scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" }); }}><ArrowDown size={18} {...ico} /></button>}

      <header className={"eptBar" + (hv || panel ? "" : " dim")} onClickCapture={(e) => { if (wasDim.current) { wasDim.current = false; e.stopPropagation(); e.preventDefault(); } }}>
        <div className="eptL"><button className="hb" aria-label="Chats" onClick={() => { setPanel("chats"); }}><PanelLeft size={20} {...ico} /></button></div>
        <button className="htitle" aria-label="Models" onClick={() => setPanel("models")}><Mark size={15} /><span>{model.n}</span><ChevronDown size={15} {...ico} /></button>
        <div className="eptR">
          <button className="hb" aria-label="New chat" onClick={newChat}><NewChatIcon size={20} /></button>
          <button className="hb" aria-label="Settings" onClick={() => { setPanel(false); setSettings(true); }}><Settings2 size={20} {...ico} /></button>
        </div>
      </header>

      {panel && <Panel tab={panel} setTab={setPanel} chats={chats} cid={cid} model={model.id} onModel={(id) => { setCfg({ model: id }); setPanel(false); }}
        onOpen={(id) => { openChat(id); setPanel(false); }} onNew={() => { newChat(); setPanel(false); }}
        onRename={(id, t) => t.trim() && setChats((cs) => cs.map((c) => (c.id === id ? { ...c, title: t.trim().slice(0, 80), ai: true } : c)))}
        onDelete={delChat} onPin={(id) => setChats((cs) => cs.map((c) => (c.id === id ? { ...c, pin: !c.pin } : c)))} onClose={() => setPanel(false)} />}

      {settings && <SettingsModal prof={prof} cfg={cfg} setCfg={setCfg} onProfile={updateProfile} onClose={() => setSettings(false)} onClearChats={() => { setChats([]); newChat(); }} />}

      {keyOpen && (
        <>
          <div className="mscrim" onClick={() => { setKeyOpen(false); pend.current = null; }} />
          <div className="modal sm" role="dialog" aria-label="Gemini API key">
            <div className="mh"><h3>Gemini API key</h3><button className="ib sm ghost" aria-label="Close" onClick={() => { setKeyOpen(false); pend.current = null; }}><X size={16} {...ico} /></button></div>
            <div className="mb">
              <p className="mhint">Paste your Gemini key to start chatting. It's saved on this device only.</p>
              <input className="vs" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Paste your key" value={keyVal} autoFocus
                onChange={(e) => setKeyVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitKey(); }} />
              <button className={"mbtn go"} disabled={!keyVal.trim()} onClick={submitKey}>Save key</button>
            </div>
          </div>
        </>
      )}

      <input ref={fileRef} type="file" hidden multiple accept="image/*,application/pdf,text/*,.md,.json,.csv,.js,.jsx,.ts,.tsx,.py,.html,.css,.sql" onChange={(e) => { const f = e.target.files; if (f?.length) addFiles(f); e.target.value = ""; }} />

      <div className={"dock" + (open ? " wide" : "")} ref={dock}>
        <MiniPlayer />
        {/* mousedown on buttons must not steal focus from the textarea (keeps the composer open on touch) */}
        {optOpen && open && (
          <div className="optp glass" onMouseDown={(e) => e.preventDefault()}>
            {([[Globe, "Search", "Look things up on the web", "search"], [Brain, "Think", "Reason before answering", "think"], [Wrench, "Tools", "Maps, weather, music and more", "agent"]] as any[]).map(([I, n, d, k]) => (
              <button key={k} className="orow" role="switch" aria-checked={!!cfg[k]} onClick={() => setCfg({ [k]: !cfg[k] })}><I size={16} {...ico} /><div><b>{n}</b><span>{d}</span></div><i className={"sw" + (cfg[k] ? " on" : "")}><u /></i></button>
            ))}
          </div>
        )}
        <div className={"glass composer" + (open ? " open" : "")} ref={comp} tabIndex={-1} onBlur={onBlur}
          onMouseDown={(e) => { if ((e.target as any).closest("button")) e.preventDefault(); }}>
          <div className="cr"><div>
            <div className="crow">
              <button className="ib ghost" aria-label="Attach" onClick={() => fileRef.current?.click()}><Plus size={20} {...ico} /></button>
              <button className="lbl" onClick={() => setOpen(true)}>{atts.length ? `${atts.length} attached · ` : ""}Ask {NAME} anything</button>
              <button className="ib ghost" aria-label="Start live voice" onClick={startLive}><AudioLines size={20} {...ico} /></button>
            </div>
          </div></div>
          <div className="xp"><div>
            {atts.length > 0 && <div className="atts">{atts.map((a, i) => <span className="att" key={i}>{a.th ? <img src={a.th} alt="" /> : <FileText size={15} {...ico} />}<em>{a.name}</em><button aria-label="Remove attachment" onClick={() => setAtts((x) => x.filter((_, j) => j !== i))}><X size={12} {...ico} /></button></span>)}</div>}
            <div className="xin">
              <textarea
                ref={ta} rows={1} value={input} placeholder={`Ask ${NAME} anything`} enterKeyHint="send"
                onChange={(e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px"; }}
                onPaste={(e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); addFiles(f); } }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              />
              <div className="tools">
                <button className="ib ghost" aria-label="Attach" onClick={() => fileRef.current?.click()}><Plus size={20} {...ico} /></button>
                <div className="tgs">
                  <button className={"tg" + (optOpen ? " on" : "")} aria-label="Options" aria-expanded={optOpen} onClick={() => setOptOpen(!optOpen)}><SlidersHorizontal size={15} {...ico} /><span className="tl2">{[cfg.search && "Search", cfg.think && "Think"].filter(Boolean).join(" · ") || "Options"}</span><ChevronDown size={13} {...ico} style={{ transition: "transform .15s", transform: optOpen ? "rotate(180deg)" : "none" }} /></button>
                </div>
                <div className="tend">
                  {dict.ok && <button className={"ib ghost" + (dict.on ? " lit" : "")} aria-label={dict.on ? "Stop dictation" : "Dictate"} onClick={dict.toggle}><Mic size={19} {...ico} /></button>}
                  {busy ? (
                    <button key="stop" className="ib send" aria-label="Stop" onClick={() => ctl.current?.abort()}><Square size={15} fill="currentColor" {...ico} style={{ transform: "none" }} /></button>
                  ) : canSend ? (
                    <button key="send" className="ib send" aria-label="Send" onClick={() => send()}><Send size={18} {...ico} /></button>
                  ) : (
                    <button key="live" className="ib ghost pop" aria-label="Start live voice" onClick={startLive}><AudioLines size={20} {...ico} /></button>
                  )}
                </div>
              </div>
            </div>
          </div></div>
        </div>
        <div className={"note" + (open ? " show" : "")}>{NAME} can make mistakes. Enter to send, Shift + Enter for a new line.</div>
      </div>

      {assistant && noKey && !live && (
        <div className="anokey">
          <b>Add your Gemini key first</b>
          <span>Open Epique AI once and paste it in Settings. Then this card works from anywhere.</span>
          <button className="mbtn go" onClick={() => actions.openApp?.()}>Open Epique AI</button>
        </div>
      )}
      {live && <Live cfg={cfg} assistant={assistant} onTurn={(t, h) => turnRef.current(t, h)} onAbort={() => ctl.current?.abort()} onClose={() => (assistant ? onExit?.() : setLive(false))} />}
      {toast && <div className="toast tf">{toast}</div>}
    </div>
  );
}

// Everything renders inside a Shadow DOM so host CSS can't leak in. The app is a bottom sheet: drag the bar
// (or tap it) to glide between snap heights up to full screen. The assistant gesture shows only a small voice card.
const SNAPS = [0.42, 0.68, 1];
type HostProps = {
  dom?: import("expo/dom").DOMProps;
  ref?: any;
  /** Native-side actions (Expo DOM "native actions"). All optional: the component also runs as plain web. */
  speech?: (c: { op: string; id: number; lang?: string; interim?: boolean; continuous?: boolean }) => Promise<void>;
  permissions?: (p: { audio?: boolean; video?: boolean }) => Promise<boolean>;
  tts?: (c: { op: string; text?: string; rate?: number; lang?: string }) => Promise<void>;
  close?: () => Promise<void>;
  openSettings?: () => Promise<void>;
  openApp?: () => Promise<void>;
  /** Snapshot of everything saved last time (JSON) and the action that saves a key; together they make settings persist. */
  store?: string;
  persist?: (key: string, value: string | null) => Promise<void>;
  /** true when shown by the Android assistant gesture. */
  assistant?: boolean;
};
const SHEET_CSS = "@keyframes epSheetIn{from{transform:translate3d(0,16%,0);opacity:0}to{transform:none;opacity:1}}";
/** Hands the page its native actions and its saved settings BEFORE anything reads them; inside the app it waits for the saved snapshot. */
export default function EpiqueChat(props: HostProps) {
  setActions({ speech: props.speech, permissions: props.permissions, tts: props.tts, close: props.close, openSettings: props.openSettings, openApp: props.openApp, persist: props.persist });
  const ready = installStorage(props.store);
  if (inHost && !ready) return null;
  return <EpiqueSheet {...props} />;
}
function EpiqueSheet({ ref: hostRef, assistant }: HostProps) {
  useDOMImperativeHandle(hostRef, () => ({ speechEvent: (id: any, type: any, json: any) => speechEvent(id, type, json) }), []);
  const ref = useRef<any>(undefined), st = useRef<any>({}), [sr, setSr] = useState<any>(null), [h, setH] = useState<any>(SNAPS[1]), [drag, setDrag] = useState<any>(false);
  // The page is created once; sheet drags re-render only the wrapper, never the whole chat.
  const appEl = useMemo(() => (assistant ? <App assistant onExit={() => { actions.close?.(); }} /> : <App />), [assistant]);
  useEffect(() => {
    const el = ref.current; setSr(el.shadowRoot || (el.attachShadow ? el.attachShadow({ mode: "open" }) : el));
    const tog = () => setH((x) => (x > 0.95 ? SNAPS[1] : 1)), fi = (e) => { if (e.composedPath()[0]?.tagName === "TEXTAREA") setH(1); };
    el.addEventListener("epique-size", tog); el.addEventListener("focusin", fi);
    return () => { el.removeEventListener("epique-size", tog); el.removeEventListener("focusin", fi); };
  }, []);
  const vh = () => window.innerHeight || 800;
  const down = (e) => { e.currentTarget.setPointerCapture(e.pointerId); st.current = { on: 1, y: e.clientY, h, last: e.clientY, v: 0, moved: 0 }; setDrag(true); };
  const move = (e) => { const t = st.current; if (!t.on) return; t.v = e.clientY - t.last; t.last = e.clientY; t.moved = Math.max(t.moved, Math.abs(e.clientY - t.y)); setH(Math.max(0.2, Math.min(1, t.h + (t.y - e.clientY) / vh()))); };
  const up = () => {
    const t = st.current; if (!t.on) return; t.on = 0; setDrag(false);
    if (t.moved < 6) return setH((x) => (x > 0.95 ? SNAPS[1] : 1));
    setH((x) => { const p = x - t.v * 0.01; return SNAPS.reduce((a, b) => (Math.abs(b - p) < Math.abs(a - p) ? b : a)); });
  };
  const full = h > 0.98;
  if (assistant) return (
    <div style={{ all: "initial", position: "absolute", inset: 0, display: "block", background: "#0a0a0a" }}>
      <div ref={ref} style={{ all: "initial", position: "absolute", inset: 0, display: "block" }}>{sr && createPortal(appEl, sr)}</div>
    </div>
  );
  return (
    <div style={{ all: "initial", position: "fixed", inset: 0, display: "block", zIndex: 2147483000 }}>
      <style>{SHEET_CSS}</style>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, margin: "0 auto", width: full ? "100%" : "min(100%, 680px)", height: `${h * 100}%`, borderRadius: `${full ? 0 : 28}px ${full ? 0 : 28}px 0 0`, overflow: "hidden", contain: "layout paint", willChange: drag ? "height" : "auto", background: "#050505", boxShadow: "0 0 0 1px rgba(255,255,255,.08)", animation: "epSheetIn .4s cubic-bezier(.22,1,.36,1) both", transition: drag ? "none" : "height .3s cubic-bezier(.22,1,.36,1), border-radius .2s ease, width .2s ease", "--sat": full ? "env(safe-area-inset-top,0px)" : "0px" } as any}>
        <div ref={ref} style={{ all: "initial", position: "absolute", inset: 0, display: "block" }}>{sr && createPortal(appEl, sr)}</div>
        <div onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Drag to resize" style={{ position: "absolute", top: 0, left: "50%", width: 132, marginLeft: -66, height: 24, zIndex: 5, display: "grid", placeItems: "center", touchAction: "none", cursor: "grab" }}>
          <i style={{ width: drag ? 56 : 40, height: 5, borderRadius: 9, background: drag ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.28)", transition: "width .25s ease, background .25s" }} />
        </div>
      </div>
    </div>
  );
}
