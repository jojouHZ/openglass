// Concept 07 "Slate Tabs" — static design concept. Run: node build.mjs
import { writeFileSync } from "node:fs";
import { app, av, ic, isDarkMode, modes, nameColor, page, pairs, phone, ratio, tabBar } from "./lib.mjs";

const D = (mode) => isDarkMode(mode);
const A = (mode, n, t, s = 44, badge = "") => av(n, t, D(mode), s, badge);

// ---------- shared pieces ----------
const lay = (state) => state === "lock" ? `<div class="lay lk" title="Verify Bob to enable private sessions">${ic("lock", 15)}Verify</div>` : `<div class="lay ${state === "on" ? "on" : ""}">${ic("mask", 16)}Private<span class="sw2"></span></div>`;
const hdr = (mode, { layer = "off", sub = "bob#4031", back = true } = {}) =>
  `<div class="hdr">${back ? `<div class="ibtn">${ic("back", 22)}</div>` : ""}${A(mode, "Bob", "bob#4031", 36)}<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:16px">Bob</div><div class="sub">${sub}</div></div>${lay(layer)}<div class="ibtn">${ic("dots", 22)}</div></div>`;
const bub = (t, o = {}) => `<div class="m ${o.own ? "own" : ""} ${o.rec ? "rec" : ""}"><div class="b ${o.pv ? "pvb" : ""}"><div class="tx">${t}</div><div class="meta">${o.vo ? `<span class="vo">${ic("flame", 12)}view once</span>` : ""}${o.pv ? ic("mask", 13) : ""}${o.time}${o.own ? ic(o.read ? "checks" : "check", 14) : ""}</div></div></div>`;
const pubHist = (rec) => `<div class="sep">Today</div>${bub("Sent you the invoice", { time: "13:58", rec })}${bub("Got it, thanks", { own: true, read: true, time: "14:01", rec })}`;
const comp = (kind) => {
  if (kind === "pv") return `<div class="comp pv"><div class="ibtn" style="color:var(--mfg)">${ic("clip", 22)}</div><div class="in">${ic("mask", 17)}Private message</div><div class="vtg on" title="view once (on)">${ic("flame", 13)}</div><div class="send">${ic("up", 22)}</div></div>`;
  if (kind === "lock") return `<div class="comp lock"><div class="ibtn" style="color:var(--mfg)">${ic("clip", 22)}</div><div class="in">${ic("lock", 16)}Verify to unlock</div><div class="vlock" title="view once unlocks after verification">${ic("lock", 17)}</div><div class="send">${ic("up", 22)}</div></div>`;
  return `<div class="comp"><div class="ibtn" style="color:var(--mfg)">${ic("clip", 22)}</div><div class="in">Message</div><div class="send">${ic("up", 22)}</div></div>`;
};
const chips = (...c) => `<div class="chips">${c.join("")}</div>`;
const chip = (k, icon, t) => `<span class="chip ${k}">${ic(icon, 13)}${t}</span>`;

const row = (mode, c) => `<div class="row">${A(mode, c.n, c.t, 52, c.g ? `<i class="gb">${ic("users", 10)}</i>` : "")}<div class="mid"><div class="l1"><span class="name">${c.n}${c.pv ? `<span class="chip pv">${ic("mask", 11)}private</span>` : ""}</span><span class="time">${c.time}</span></div><div class="l2"><span class="pv">${c.typing ? `<span class="typing">typing…</span>` : (c.own ? `<b>you:</b> ` : c.who ? `<b>${c.who}:</b> ` : "") + (c.text ?? "")}</span>${c.u ? `<span class="badge">${c.u}</span>` : ""}</div></div></div>`;
const chatRows = [
  { n: "ops room", t: "ops room", g: 1, who: "Carol", text: "Deploy window moved to 18:00", time: "12:44", u: 3 },
  { n: "Bob", t: "bob#4031", pv: 1, typing: 1, time: "10:02" },
  { n: "Carol", t: "carol#3785", own: 1, text: "see you there", time: "11:20" },
  { n: "ops2", t: "ops2", g: 1, who: "Dima", text: "runbook.pdf", time: "Mon" },
  { n: "Dima", t: "dima#5150", text: "Photo", time: "Sun", u: 1 },
];

// ---------- root screens (tab bar visible) ----------
const chatsRoot = (mode) => app(mode, `<div class="hdr"><span class="title">Chats</span><div class="ibtn g">${ic("plus", 20)}</div>${A(mode, "Alice", "alice#3454", 38)}</div>
<div class="search">${ic("search", 18)}Search chats and people</div><div class="list">${chatRows.map((c) => row(mode, c)).join("")}</div>${tabBar(0, { contacts: 2 })}`);

const contactsRoot = (mode) => app(mode, `<div class="hdr"><span class="title">Contacts</span><div class="ibtn g">${ic("userplus", 20)}</div></div>
<div class="search">${ic("search", 18)}Find by tag, e.g. name#1234</div>
<div class="sec">Requests <span class="chip warn">2</span></div>
${[["Mira", "mira#8812"], ["Oleg", "oleg#1170"]].map(([n, t]) => `<div class="row" style="padding:7px 16px">${A(mode, n, t, 44)}<div class="mid"><div class="name">${n}</div><div style="font-size:12.5px;color:var(--mfg)">${t}</div></div><div class="btns"><div class="btn s">Accept</div><div class="btn s o">Decline</div></div></div>`).join("")}
<div class="sec">Sent</div><div class="row" style="padding:7px 16px">${A(mode, "Anna", "anna#2207", 44)}<div class="mid"><div class="name">Anna <span class="chip">pending</span></div><div style="font-size:12.5px;color:var(--mfg)">anna#2207</div></div><div class="btns"><div class="btn s o">Resend</div></div></div>
<div class="sec">All contacts · 3</div><div class="list">${[["Bob", "bob#4031", "verified Oct 12", 1], ["Carol", "carol#3785", "not verified", 0], ["Dima", "dima#5150", "not verified", 0]].map(([n, t, v, ok]) => `<div class="row" style="padding:7px 16px">${A(mode, n, t, 44)}<div class="mid"><div class="name">${n}${ok ? `<span class="vbadge">${ic("shield", 15)}</span>` : ""}</div><div style="font-size:12.5px;color:var(--mfg)">${t} · ${v}</div></div></div>`).join("")}</div>${tabBar(1, { contacts: 2 })}`);

const settingsRoot = (mode, theme = "light") => app(mode, `<div class="hdr"><span class="title">Settings</span></div>
<div class="pcard">${A(mode, "Alice", "alice#3454", 58)}<div style="flex:1"><div style="font-weight:600;font-size:17px">Alice</div><div style="color:var(--mfg);font-size:13px">alice#3454</div><div style="margin-top:6px"><span class="chip">${ic("lock", 12)}tag can't change</span></div></div></div>
<div class="sec">Appearance</div><div class="seg">${[["sun", "Light", "light"], ["moon", "Dark", "dark"], ["phone", "System", "sys"]].map(([i, l, k]) => `<div class="${theme === k ? "on" : ""}">${ic(i, 16)}${l}</div>`).join("")}</div>
<div class="sec">Security</div>${[["phone", "Devices & sessions", "3 active"], ["shield", "Private session defaults", "15 min"]].map(([i, t, v]) => `<div class="setrow"><span class="ic">${ic(i, 18)}</span><span class="t">${t}</span><span class="v">${v}</span>${ic("chevron", 16)}</div>`).join("")}
<div class="setrow"><span class="ic" style="color:var(--danger)">${ic("logout", 18)}</span><span class="t" style="color:var(--danger)">Sign out this device</span></div>
<div class="sec">About</div><div class="setrow"><span class="ic">${ic("info", 18)}</span><span class="t">Instance</span><span class="v">openglass.local</span></div><div style="flex:1"></div>${tabBar(2, { contacts: 2 })}`);

const chatOpen = (mode) => app(mode, `${hdr(mode)}<div class="chat">${pubHist(false)}</div>${comp("pub")}`);

// ---------- private flow ----------
const sheet = (mode) => app(mode, `${hdr(mode)}<div class="chat">${pubHist(false)}</div>${comp("pub")}<div class="scrim"></div>
<div class="sheet"><div class="grab"></div><h3>${ic("mask", 20)}Start private session</h3><div style="color:var(--mfg);font-size:13px;margin:4px 0 10px">with Bob · bob#4031</div>
<div style="font-size:12px;font-weight:700;color:var(--mfg);text-transform:uppercase;letter-spacing:.05em">Session lifetime</div><div class="ttl"><div>5 min</div><div class="on">15 min</div><div>1 hour</div></div>
<div class="opt"><div class="t">Strict mode<small>Any disconnect ends the session instantly</small></div><span class="tgl"></span></div>
<div class="opt"><div class="t">Remember these settings<small>Skip this step next time</small></div><span class="cb on">${ic("check", 14)}</span></div>
<div class="note">${ic("lock", 15)}<span>The server sees that a session exists, its timing and size — never the content. Your devices are already verified, so the session starts encrypted right away.</span></div>
<div style="display:flex;gap:10px"><div class="btn o" style="flex:1">Cancel</div><div class="btn" style="flex:1.4">Send invite</div></div></div>`);

const waiting = (mode) => app(mode, `${hdr(mode, { layer: "wait", sub: "waiting for Bob…" })}<div class="chat">${pubHist(false)}<div class="divider e"><span>${ic("mask", 13)}Invite sent · expires in 2:00</span></div></div>
<div class="banner" style="margin-bottom:6px">${ic("timer", 16)}<span>Private session requested. Messaging stays public until Bob accepts.</span></div>${comp("pub")}`);


const ritual = (mode) => app(mode, `${hdr(mode, { layer: "lock", sub: "bob#4031 · not verified" })}
<div class="chat" style="justify-content:flex-start;gap:0"><div style="opacity:.55">${pubHist(true)}</div>
<div class="pcard" style="flex-direction:column;align-items:stretch;gap:6px;margin:10px 4px"><div style="display:flex;gap:8px;align-items:center;font-weight:600;font-size:16px">${ic("shield", 18)}Verify Bob</div>
<div class="sas" style="margin:6px 0">🦊 🌵 🚀 🎲 🔑</div>
<div style="color:var(--mfg);font-size:13px;line-height:1.5">Compare these five symbols out loud or in person. <b style="color:var(--fg)">Never send them in this chat.</b> Or scan a QR when you meet.</div>
<div style="display:flex;gap:8px;margin-top:6px"><div class="btn" style="flex:1">They match</div><div class="btn d" style="flex:1">Don't match</div></div>
<div class="note" style="margin:6px 0 0">${ic("phone", 15)}<span>Binds <b>this device</b> ↔ <b>Bob's Chrome</b>. Stored on this device only — never sent to the server. A new device needs its own check.</span></div></div></div>${comp("pub")}`);

const verify = (mode) => app(mode, `${hdr(mode, { layer: "on", sub: "verify to unlock" })}${chips(chip("warn", "shield", "Not verified yet"), chip("", "timer", "14:50 left"))}
<div class="chat" style="justify-content:flex-start;gap:0"><div style="opacity:.5">${pubHist(true)}</div><div class="divider"><span>${ic("mask", 13)}Private session started 14:12</span></div>
<div style="text-align:center;margin-top:6px;font-weight:600;font-size:16px">Compare with Bob</div><div class="sas">🦊 🌵 🚀 🎲 🔑</div>
<div style="text-align:center;color:var(--mfg);font-size:13px;line-height:1.5;padding:0 18px">Read these five symbols out loud or in person. <b style="color:var(--fg)">Never send them in this chat</b> — an attacker could rewrite them.</div>
<div style="display:flex;flex-direction:column;gap:8px;padding:16px 16px 0"><div class="btn">They match</div><div class="btn d">They don't match — end session</div></div>
<div style="text-align:center;margin-top:12px"><span class="chip">${ic("timer", 12)}Bob hasn't confirmed yet</span></div></div>${comp("lock")}`);

const active = (mode, bg = "mask") => app(mode, `${hdr(mode, { layer: "on", sub: "bob#4031" })}${chips(chip("ok", "lock", "Verified"), chip("", "timer", "14:32 left"), chip("", "flame", "strict"))}
<div class="chat"><div style="opacity:.6">${pubHist(true)}</div><div class="divider"><span>${ic("mask", 13)}Private session · only you and Bob · not stored</span></div>
${bub("Sending the credentials now", { pv: 1, time: "14:13" })}${bub("Ready", { pv: 1, own: 1, read: 1, time: "14:13" })}${bub("•••••••••• tap to reveal", { pv: 1, vo: 1, time: "14:14" })}
<div class="m own"><div class="b pvb burned">${ic("flame", 15)}Burned after reading · 14:15</div></div></div>${comp("pv")}`, { bg });

const ended = (mode) => app(mode, `${hdr(mode)}<div class="chat">${pubHist(false)}<div class="divider e"><span>${ic("mask", 13)}Private session ended 14:27 · 4 private messages erased</span></div></div>
<div class="banner" style="background:var(--nb);color:var(--nf);margin-bottom:8px">${ic("info", 16)}<span>Private messages live in memory only. They are gone for both of you — nothing to recover.</span></div>${comp("pub")}`);

const listPriv = (mode) => chatsRoot(mode);

// ---------- pages ----------
const lightRow = (...f) => `<div class="frames">${f.join("")}</div>`;
const sw = (m) => `<div class="sw">${[["bg", m.bg], ["card", m.card], ["fg", m.fg], ["muted fg", m.mfg], ["primary", m.primary], ["own bubble", m.ownb], ["in bubble", m.inb], ["chip ok", m.okb], ["chip private", m.pvb], ["chip warn", m.warnb], ["border", m.border]].map(([n, c]) => `<span><i style="background:${c}"></i>${n} ${c}</span>`).join("")}</div>`;
const table = () => {
  const modesK = Object.keys(modes);
  const names = pairs(modes.light).map((p) => p[0]);
  return `<table><tr><th>Pair (min ratio)</th>${modesK.map((k) => `<th>${modes[k].label}</th>`).join("")}</tr>${names.map((n, i) => `<tr><td>${n} <small>(≥${pairs(modes.light)[i][3]})</small></td>${modesK.map((k) => { const [, f, b, min] = pairs(modes[k])[i]; const r = ratio(f, b); return `<td class="${r >= min ? "ok" : "no"}">${r.toFixed(2)} ${r >= min ? "✓" : "✗"}</td>`; }).join("")}</tr>`).join("")}</table>`;
};

const out = {};
out["index"] = page("Concept 07 · Slate Tabs", "Brainstorm concept — not implementation. Base: 07 Slate Tabs. Adds: tab bar nav, private layer inside the same chat window, dark theme with a distinct private palette in both themes. Data shapes follow the backend contract (Contact.verifiedAt, ChatSummary, Message, session TTL/strict).",
`<div class="card"><b>Pages</b><br>${[["01-palette", "Four palettes + WCAG contrast table (chips re-tuned)"], ["02-navigation", "Tab bar on root screens only; Chats / Contacts (F1 requests) / Settings; light + dark"], ["03-private-flow", "Same-window private session: toggle → settings sheet → waiting → verify (5 symbols) → active → ended"], ["04-dark", "Dark app theme and how the private layer stays distinct from it"], ["05-bg-options", "Three private background treatments (mask pattern / lattice / plain) × both themes"]].map(([h, t]) => `<a href="${h}.html">${h}</a> — ${t}<br>`).join("")}</div>
<div class="card"><b>Decisions proposed</b><ol style="margin:6px 0 0 18px"><li><b>Mask = layer identity</b> (toggle, bubble marker, background pattern). <b>Lock = encryption status</b> (verified chip, composer lock). Reverses F-5 partially — needs your OK.</li><li>Layer must never rely on colour alone: every private bubble carries the mask glyph; the composer shows a mask + violet ring; a divider marks where the session started.</li><li>Palette flips <b>when the peer accepts</b> (verification itself happens inside the private chrome). Public history stays visible but recessed (60%).</li><li>In private mode the composer sends <b>private only</b>; to write publicly you switch the layer off — prevents posting secrets to the server-readable layer.</li><li>Private violet hue is used nowhere else, in light and in dark.</li></ol></div>
<div class="card"><b>Open questions</b><ol style="margin:6px 0 0 18px"><li>Tab bar on Settings root: shown (proposed) or hidden?</li><li>Mask vs lock for the toggle icon — confirm roles above.</li><li>Background pattern: A mask / B lattice / C plain (see 05).</li><li>Should the palette flip at invite-accept (proposed) or only after both verify?</li></ol></div>`);

out["01-palette"] = page("01 · Palette & contrast", "Four modes share structure (slate base, one blue primary) and differ in surface. Private modes use a violet hue that appears nowhere in public modes, so the layer is readable in light AND dark app themes. Every text pair is checked against WCAG AA.",
`<div class="frames" style="flex-direction:column;align-items:stretch">${Object.entries(modes).map(([k, m]) => `<div class="card"><b>${m.label}</b><div style="margin-top:8px">${sw(m)}</div></div>`).join("")}</div><div class="card"><b>WCAG contrast (text ≥ 4.5, recessed history ≥ 3)</b><div style="margin-top:8px">${table()}</div></div>`);

out["02-navigation"] = page("02 · Navigation", "Bottom tab bar on root screens only (Chats, Contacts, Settings). It is hidden inside an open chat and inside detail/sub-screens (group info, devices & sessions, verification). Contacts shows incoming requests (F1) and verified badge from Contact.verifiedAt. Badge on the tab = pending requests.",
`<h2 class="s">Light</h2>${lightRow(phone("Chats — root (bar visible)", chatsRoot("light")), phone("Contacts — root (requests, sent, verified)", contactsRoot("light")), phone("Settings — root (theme switch)", settingsRoot("light", "light")), phone("Open chat — bar hidden", chatOpen("light")))}
<h2 class="s">Dark</h2>${lightRow(phone("Chats — dark", chatsRoot("dark")), phone("Contacts — dark", contactsRoot("dark")), phone("Settings — dark selected", settingsRoot("dark", "dark")))}`);

out["03-private-flow"] = page("03 · Private session in the same window", "The conversation never changes screen. For an unverified contact the header shows a lock instead of the switch; tapping it runs the device-bound verification ritual (5 symbols / QR). Once verified, the switch appears and opens a settings sheet (not a new screen); after the peer accepts, the chrome flips to the private palette, the 5-symbol check unlocks messaging and the view-once switch (a lock sits in its place until then), and ending the session erases private bubbles in place.",
`${lightRow(phone("1 · Unverified contact: lock in the header (tap → ritual)", app("light", `${hdr("light", { layer: "lock", sub: "bob#4031 · not verified" })}<div class="chat">${pubHist(false)}</div>${comp("pub")}`)), phone("2 · Verification ritual (device ↔ device, stored locally)", ritual("light")), phone("3 · Verified contact: switch appears", app("light", `${hdr("light", { layer: "off", sub: "bob#4031 · verified" })}<div class="chat">${pubHist(false)}</div>${comp("pub")}`)), phone("4 · Switch → settings sheet", sheet("light")), phone("5 · Waiting for Bob (still public chrome)", waiting("light")), phone("6 · Accepted: private palette, auto-verified (pinned key)", active("privLight")), phone("7 · Session ended: private bubbles erased", ended("light")))}`);

out["04-dark"] = page("04 · Dark theme", "Dark app theme is blue-navy; the private layer in dark goes near-black violet with a stronger pattern, so 'darker' is not the signal — hue, glyph, pattern and ring are. Compare 'public dark' and 'private on dark' side by side.",
`${lightRow(phone("Public chat — dark", app("dark", `${hdr("dark")}<div class="chat">${pubHist(false)}</div>${comp("pub")}`)), phone("Settings sheet — dark", sheet("dark")), phone("Private on dark app", active("privDark")), phone("Private on LIGHT app (for comparison)", active("privLight")))}`);

out["05-bg-options"] = page("05 · Private background options", "A: tiled mask pattern (your original idea) — strongest identity; B: diagonal lattice — calmer; C: plain gradient — most readable. Pattern opacity is capped at ~8–9% so text contrast stays ≥ AA.",
`<h2 class="s">On light app</h2>${lightRow(phone("A · mask pattern", active("privLight", "mask")), phone("B · lattice", active("privLight", "lattice")), phone("C · plain", active("privLight", "plain")))}<h2 class="s">On dark app</h2>${lightRow(phone("A · mask pattern", active("privDark", "mask")), phone("B · lattice", active("privDark", "lattice")), phone("C · plain", active("privDark", "plain")))}`);

for (const [k, v] of Object.entries(out)) writeFileSync(`${k}.html`, v);
console.log("built", Object.keys(out).length);
