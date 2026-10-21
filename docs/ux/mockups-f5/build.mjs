// Generates the 10 static HTML design mockups. Run: node build.mjs
import { writeFileSync } from "node:fs";
import { ic } from "./icons.mjs";
import { me, users, chats, msgs, members, rightLabels } from "./data.mjs";
import { themes } from "./themes.mjs";

const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const av = (u, t, size = 44, extra = "") => {
  const h = hue(u.tag ?? u.title ?? u.displayName);
  const bg = t.dark ? `hsl(${h} 32% 24%)` : `hsl(${h} 62% 91%)`;
  const fg = t.dark ? `hsl(${h} 70% 80%)` : `hsl(${h} 52% 28%)`;
  const ch = (u.displayName ?? u.title)[0].toUpperCase();
  return `<span class="av" style="width:${size}px;height:${size}px;background:${bg};color:${fg};font-size:${Math.round(size * 0.4)}px">${ch}${extra}</span>`;
};
const nameColor = (u, t) => `hsl(${hue(u.tag)} ${t.dark ? "70% 72%" : "55% 36%"})`;

const FONT = `
@font-face{font-family:"Inter";src:url("../../../apps/pwa/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2") format("woff2");font-weight:100 900}
@font-face{font-family:"Source Code Pro";src:url("../../../apps/pwa/node_modules/@fontsource/source-code-pro/files/source-code-pro-latin-400-normal.woff2") format("woff2");font-weight:400}`;

const css = (t) => {
  const v = t.v;
  return `${FONT}
*{box-sizing:border-box;margin:0}
body{font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#d8dbe2;color:#111;padding:28px 32px 56px}
.top{max-width:1500px;margin:0 auto 22px}
.top h1{font:400 26px "Source Code Pro",ui-monospace,monospace}
.top p{color:#4b5160;margin-top:6px;max-width:760px;line-height:1.5}
.top a{color:#334;font-size:13px}
.sw{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
.sw span{display:flex;align-items:center;gap:8px;font:12px ui-monospace,monospace;background:#fff;border-radius:999px;padding:5px 12px 5px 5px;color:#333}
.sw i{width:22px;height:22px;border-radius:50%;border:1px solid #0002}
.frames{display:flex;gap:26px;flex-wrap:wrap;justify-content:center;max-width:1700px;margin:0 auto}
.cap{font:12px ui-monospace,monospace;color:#555;margin:0 0 8px 6px}
.phone{width:375px;height:780px;border-radius:38px;overflow:hidden;box-shadow:0 0 0 9px #14151a,0 24px 50px #0006;position:relative;background:#000}
.desk{width:1180px;height:720px;border-radius:14px;overflow:hidden;box-shadow:0 0 0 1px #0003,0 24px 60px #0004}
.app{--bg:${v.bg};--fg:${v.fg};--card:${v.card};--muted:${v.muted};--mfg:${v.mfg};--border:${v.border};--primary:${v.primary};--pfg:${v.pfg};--inb:${v.inb};--infg:${v.infg};--ownb:${v.ownb};--ownfg:${v.ownfg};--ring:${v.ring};--r:${v.radius}px;--layer:${v.layer ?? v.privacc};--priv:${v.priv};--privfg:${v.privfg};--privacc:${v.privacc};
 background:${t.glass ? "radial-gradient(120% 70% at 10% 0%,#dfe6ff 0%,#f4e8ff 45%,#e6f3ff 100%)" : "var(--bg)"};color:var(--fg);height:100%;display:flex;flex-direction:column;position:relative;font-size:14px;line-height:1.35}
.app.private{--bg:var(--priv);--fg:var(--privfg);--card:color-mix(in srgb,var(--priv) 88%,#fff);--muted:color-mix(in srgb,var(--priv) 84%,#fff);--mfg:color-mix(in srgb,var(--privfg) 58%,transparent);--border:color-mix(in srgb,var(--priv) 78%,#fff);--primary:var(--privacc);--pfg:var(--priv);--inb:color-mix(in srgb,var(--priv) 82%,#fff);--infg:var(--privfg);--ownb:var(--privacc);--ownfg:var(--priv);background:var(--priv)}
.app h1,.app .title{font-family:"Source Code Pro",ui-monospace,monospace;font-weight:400}
.sb{height:30px;flex:none;display:flex;justify-content:space-between;align-items:flex-end;padding:0 24px 2px;font-size:12px;font-weight:600}
.hdr{flex:none;display:flex;align-items:center;gap:10px;padding:10px 16px;min-height:56px}
.hdr .title{font-size:19px;flex:1}
.head-filled .hdr,.head-filled .sb{background:var(--primary);color:var(--pfg)}
.head-filled .hdr .title{color:var(--pfg)}
.head-glass .hdr,.head-glass .sb{background:#ffffff66;backdrop-filter:blur(14px);border-bottom:1px solid #ffffff99}
.ibtn{width:38px;height:38px;border-radius:calc(var(--r) - 2px);display:grid;place-items:center;color:inherit;flex:none}
.ibtn.ghost{background:var(--muted)}
.av{display:inline-grid;place-items:center;font-weight:600;flex:none;position:relative}
.circle .av{border-radius:50%}.squircle .av{border-radius:32%}.square .av{border-radius:4px}
.av .gb{position:absolute;right:-3px;bottom:-3px;width:18px;height:18px;border-radius:50%;background:var(--bg);color:var(--mfg);display:grid;place-items:center;border:1.5px solid var(--bg)}
.search{margin:2px 16px 8px;height:40px;border-radius:calc(var(--r) - 2px);background:var(--muted);display:flex;align-items:center;gap:8px;padding:0 12px;color:var(--mfg);font-size:14px;flex:none}
.list{flex:1;overflow:hidden}
.row{display:flex;gap:12px;padding:10px 16px;align-items:center;position:relative}
.compact .row{padding:7px 16px;gap:10px}
.row.sel{background:var(--muted)}
.row .mid{flex:1;min-width:0}
.row .l1{display:flex;align-items:baseline;gap:6px}
.row .name{font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px}
.row .time{margin-left:auto;font-size:12px;color:var(--mfg);flex:none}
.row .l2{display:flex;align-items:center;gap:6px;margin-top:2px;color:var(--mfg);font-size:13.5px}
.row .pv{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
.row .pv b{font-weight:500;color:var(--fg)}
.badge{min-width:20px;height:20px;border-radius:10px;background:var(--primary);color:var(--pfg);font-size:11.5px;font-weight:600;display:grid;place-items:center;padding:0 6px;flex:none}
.typing{color:var(--primary);font-weight:500}
.lockchip{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;color:var(--layer);background:color-mix(in srgb,var(--layer) 12%,transparent);padding:1px 6px;border-radius:6px}
.fab{position:absolute;right:18px;bottom:22px;width:56px;height:56px;border-radius:calc(var(--r) + 4px);background:var(--primary);color:var(--pfg);display:grid;place-items:center;box-shadow:0 8px 20px #0003}
.tabs{flex:none;display:flex;border-top:1px solid var(--border);background:var(--card);padding:6px 8px 18px}
.tabs div{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:11px;color:var(--mfg);padding:4px}
.tabs div.on{color:var(--primary);font-weight:600}
.chat{flex:1;overflow:hidden;padding:10px 14px;display:flex;flex-direction:column;justify-content:flex-end;gap:6px}
.sep{align-self:center;font-size:12px;color:var(--mfg);background:var(--muted);padding:3px 10px;border-radius:999px;margin:4px 0}
.m{display:flex;gap:8px;align-items:flex-end;max-width:84%}
.m.own{align-self:flex-end;flex-direction:row-reverse}
.b{padding:8px 11px;border-radius:calc(var(--r) + 2px);background:var(--inb);color:var(--infg);position:relative;min-width:0}
.glass .b{backdrop-filter:blur(8px);border:1px solid #fff9}
.own .b{background:var(--ownb);color:var(--ownfg)}
.tail .b{border-bottom-left-radius:4px}.tail .own .b{border-bottom-left-radius:calc(var(--r) + 2px);border-bottom-right-radius:4px}
.sqb .b{border-radius:4px}
.b .who{font-size:12.5px;font-weight:600;margin-bottom:2px}
.b .tx{font-size:14.5px;white-space:pre-wrap}
.b .meta{display:flex;gap:4px;justify-content:flex-end;align-items:center;font-size:11px;opacity:.7;margin-top:2px}
.quote{border-left:3px solid var(--primary);background:color-mix(in srgb,currentColor 8%,transparent);border-radius:6px;padding:4px 8px;margin-bottom:5px;font-size:12.5px}
.quote b{display:block;font-weight:600;color:var(--primary)}
.own .quote b{color:inherit;opacity:.85}
.photo{width:210px;height:128px;border-radius:calc(var(--r) - 2px);background:linear-gradient(135deg,color-mix(in srgb,var(--primary) 28%,#fff),color-mix(in srgb,var(--primary) 8%,#fff));display:grid;place-items:center;color:color-mix(in srgb,var(--primary) 60%,#000);margin-bottom:4px}
.file{display:flex;gap:10px;align-items:center;padding:6px;border-radius:calc(var(--r) - 2px);background:color-mix(in srgb,currentColor 10%,transparent);margin-bottom:4px;min-width:200px}
.file .fi{width:38px;height:38px;border-radius:10px;background:color-mix(in srgb,currentColor 16%,transparent);display:grid;place-items:center}
.file small{display:block;opacity:.7;font-size:11.5px}
.pinbar{display:flex;gap:8px;align-items:center;padding:7px 16px;background:var(--card);border-bottom:1px solid var(--border);font-size:13px;flex:none}
.pinbar svg{color:var(--primary)}.pinbar b{font-weight:600}
.typingln{font-size:12.5px;color:var(--primary);padding:0 16px 4px;font-weight:500}
.comp{flex:none;display:flex;gap:8px;align-items:center;padding:8px 12px 20px;background:${t.glass ? "#ffffff66" : "var(--bg)"}}
.comp .in{flex:1;height:44px;border-radius:calc(var(--r) + 6px);background:var(--muted);display:flex;align-items:center;padding:0 14px;color:var(--mfg)}
.comp .send{width:44px;height:44px;border-radius:50%;background:var(--primary);color:var(--pfg);display:grid;place-items:center;flex:none}
.sub{font-size:12.5px;color:var(--mfg)}
.head-filled .sub{color:#ffffffb8}
.login{flex:1;padding:0 26px;display:flex;flex-direction:column;justify-content:center;gap:10px}
.login .logo{width:56px;height:56px;border-radius:calc(var(--r) + 4px);background:var(--primary);color:var(--pfg);display:grid;place-items:center;margin-bottom:6px}
.login h1{font-size:28px}.login .tag{color:var(--mfg);margin-bottom:14px}
.login label{font-size:12.5px;font-weight:600;margin-top:4px;display:flex;gap:6px;align-items:baseline}
.login label em{font-weight:400;color:var(--mfg);font-style:normal}
.login .field{height:46px;border-radius:calc(var(--r) - 2px);border:1px solid var(--border);background:var(--card);display:flex;align-items:center;padding:0 14px;color:var(--mfg)}
.login .field.f{color:var(--fg);border-color:var(--primary);box-shadow:0 0 0 3px var(--ring)}
.btn{height:48px;border-radius:calc(var(--r) - 2px);background:var(--primary);color:var(--pfg);display:grid;place-items:center;font-weight:600;margin-top:10px}
.note{display:flex;gap:8px;font-size:12px;color:var(--mfg);line-height:1.45;margin-top:14px}
.note svg{flex:none;margin-top:1px;color:var(--layer)}
.banner{margin:8px 14px 2px;padding:9px 12px;border-radius:calc(var(--r) - 2px);background:color-mix(in srgb,var(--privacc) 14%,transparent);border:1px solid color-mix(in srgb,var(--privacc) 35%,transparent);display:flex;gap:9px;font-size:12.5px;line-height:1.4;color:var(--fg);flex:none}
.banner svg{flex:none;color:var(--privacc);margin-top:1px}
.chips{display:flex;gap:6px;padding:6px 16px;flex:none;flex-wrap:wrap}
.chip{font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;background:var(--muted);color:var(--fg);display:inline-flex;gap:5px;align-items:center}
.chip.ok{background:color-mix(in srgb,#22c55e 18%,transparent);color:${t.dark ? "#86efac" : "#15803d"}}
.chip.pv{background:color-mix(in srgb,var(--privacc) 20%,transparent);color:var(--privacc)}
.app.private .hdr,.app.private .sb,.app.private .comp{background:transparent;backdrop-filter:none;border-color:transparent}.app.private .b{backdrop-filter:none;border:0}
.private .own .b{background:var(--privacc);color:var(--priv)}
.vo{display:inline-flex;gap:4px;align-items:center;font-size:11px;color:#f97316;font-weight:600}
.toggle{width:40px;height:24px;border-radius:12px;background:var(--privacc);position:relative;flex:none}
.toggle:after{content:"";position:absolute;right:2px;top:2px;width:20px;height:20px;border-radius:50%;background:var(--priv)}
.sec{padding:14px 16px 6px;font-size:12px;font-weight:600;color:var(--mfg);letter-spacing:.04em;text-transform:uppercase}
.rights{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}
.rights .chip{font-size:10.5px;padding:1px 7px;font-weight:500}
.role{font-size:11px;font-weight:600;color:var(--primary);background:color-mix(in srgb,var(--primary) 12%,transparent);padding:1px 7px;border-radius:6px}
.danger{color:#dc2626;font-weight:600;padding:14px 16px}
.act{display:flex;gap:10px;padding:0 16px 8px}
.act div{flex:1;background:var(--muted);border-radius:calc(var(--r) - 2px);padding:10px 4px;text-align:center;font-size:12px;display:flex;flex-direction:column;gap:5px;align-items:center;color:var(--primary);font-weight:600}
.sas{display:flex;gap:6px;font-size:26px;padding:6px 16px}
.side{display:flex;height:100%}
.side .col{display:flex;flex-direction:column;min-width:0}
.side .l{width:330px;border-right:1px solid var(--border);background:var(--card)}
.side .c{flex:1;background:var(--bg)}
.side .r{width:290px;border-left:1px solid var(--border);background:var(--card)}
.side .app{height:100%}
.pane{height:100%;display:flex;flex-direction:column}
`;
};

const ticks = (s, t) =>
  s === "read" ? `<span style="color:${t.dark ? "#7dd3fc" : "currentColor"}">${ic("checks", 14)}</span>` : s === "sent" ? ic("check", 14) : "";

const row = (c, t, sel = false) => {
  const peer = c.peer ?? { displayName: c.title, tag: c.title };
  const gbadge = c.type === "group" ? `<i class="gb">${ic("users", 10)}</i>` : c.type === "saved" ? `<i class="gb">${ic("pin", 10)}</i>` : "";
  const preview = c.typing
    ? `<span class="typing">typing…</span>`
    : c.att === "photo"
      ? `${ic("image", 14)} Photo`
      : c.att
        ? `${ic("file", 14)} ${c.att}`
        : `${c.own ? "<b>you:</b> " : c.who ? `<b>${c.who}:</b> ` : ""}${c.text ?? ""}`;
  const right = c.unread ? `<span class="badge">${c.unread}</span>` : c.pinned ? `<span style="color:var(--mfg)">${ic("pin", 16)}</span>` : "";
  return `<div class="row${sel ? " sel" : ""}">${av(peer, t, t.density === "compact" ? 40 : 52, gbadge)}
  <div class="mid"><div class="l1"><span class="name">${c.title}${c.private ? `<span class="lockchip">${ic("lock", 11)}private</span>` : ""}</span><span class="time">${c.time}</span></div>
  <div class="l2"><span class="pv">${c.own ? ticks(c.state, t) + " " : ""}${preview}</span>${c.unread && c.pinned ? `<span style="color:var(--mfg)">${ic("pin", 14)}</span>` : ""}${right}</div></div></div>`;
};
const chatRows = (t, selIdx = -1) => chats.map((c, i) => row(i === 2 ? { ...c, private: true } : c, t, i === selIdx)).join("");

const status = () => `<div class="sb"><span>9:41</span><span>5G ▮▮▮</span></div>`;
const tabbar = (on = 0) => `<div class="tabs">${["chat:Chats", "users:Contacts", "user:Settings"].map((x, i) => { const [k, l] = x.split(":"); return `<div class="${i === on ? "on" : ""}">${ic(k, 22)}${l}</div>`; }).join("")}</div>`;

const wrap = (t, inner, cls = "") =>
  `<div class="app ${t.avatar} ${t.density} head-${t.head} ${t.bubble === "tail" ? "tail" : ""} ${t.bubble === "square" ? "sqb" : ""} ${t.glass ? "glass" : ""} ${cls}">${inner}</div>`;

const login = (t) =>
  wrap(t, `${status()}<div class="login"><div class="logo">${ic("shield", 28)}</div><h1>OpenGlass</h1><div class="tag">Self-hosted messenger with two privacy layers.</div>
<label>Invite code <em>new accounts only</em></label><div class="field">XXXX-XXXX</div>
<label>Email</label><div class="field f">alice@mail.com</div><div class="btn">Request code</div>
<div class="note">${ic("lock", 15)}<span>Public chats are readable by your server admin. Private sessions are end-to-end encrypted between you and your contact.</span></div></div>`);

const list = (t) => {
  const top = t.nav === "top" ? `<div class="ibtn ghost">${ic("plus", 20)}</div>` : "";
  return wrap(t, `${status()}<div class="hdr"><span class="title">Chats</span>${top}${av(me, t, 38)}</div>
${t.search ? `<div class="search">${ic("search", 18)}Search chats and people</div>` : ""}
<div class="list">${chatRows(t)}</div>${t.nav === "fab" ? `<div class="fab">${ic("plus", 26)}</div>` : ""}${t.nav === "tabs" ? tabbar(0) : ""}`);
};

const bubble = (m, t) => {
  const own = !!m.own;
  const u = m.from;
  const body = `${!own && u ? `<div class="who" style="color:${nameColor(u, t)}">${u.displayName}</div>` : ""}
${m.reply ? `<div class="quote"><b>${m.reply.who}</b>${m.reply.text}</div>` : ""}
${m.photo ? `<div class="photo">${ic("image", 34)}</div><div style="font-size:12.5px;opacity:.8">${m.photo.name} · ${m.photo.size}</div>` : ""}
${m.file ? `<div class="file"><div class="fi">${ic("file", 20)}</div><div><b style="font-weight:600">${m.file.name}</b><small>${m.file.size}</small></div></div>` : ""}
${m.text ? `<div class="tx">${m.text}</div>` : ""}
<div class="meta">${m.edited ? "edited · " : ""}${m.time}${own ? ticks(m.state, t) : ""}</div>`;
  return `<div class="m ${own ? "own" : ""}">${!own && u ? av(u, t, 30) : ""}<div class="b">${body}</div></div>`;
};
const msgList = (t) => msgs.map((m) => (m.sep ? `<div class="sep">${m.sep}</div>` : bubble(m, t))).join("");

const chatHeader = (t, sub = "4 members") =>
  `<div class="hdr"><div class="ibtn">${ic("back", 22)}</div><div style="flex:1;min-width:0"><div class="title" style="font-size:17px;display:flex;gap:6px;align-items:center">ops room <span style="opacity:.5">${ic("chevron", 14)}</span></div><div class="sub">${sub}</div></div>
<div class="ibtn ghost" title="start private session">${ic("lock", 19)}</div><div class="ibtn">${ic("dots", 22)}</div></div>`;
const composer = () => `<div class="comp"><div class="ibtn" style="color:var(--mfg)">${ic("clip", 22)}</div><div class="in">Message</div><div class="send">${ic("up", 22)}</div></div>`;

const chat = (t) =>
  wrap(t, `${status()}${chatHeader(t)}<div class="pinbar">${ic("pin", 15)}<span><b>Pinned</b> · Deploy window moved to 18:00</span></div>
<div class="chat">${msgList(t)}</div><div class="typingln">Dima is typing…</div>${composer()}`);

const priv = (t) =>
  wrap(t, `${status()}<div class="hdr"><div class="ibtn">${ic("back", 22)}</div>${av(users.bob, { ...t, dark: true }, 36)}<div style="flex:1"><div class="title" style="font-size:16px">Bob</div><div class="sub">bob#4031</div></div><div class="chip pv">${ic("lock", 13)}Private</div></div>
<div class="chips"><span class="chip ok">${ic("shield", 13)}Verified</span><span class="chip">${ic("timer", 13)}14:32 left</span><span class="chip">strict</span></div>
<div class="banner">${ic("lock", 17)}<span>End-to-end encrypted, never stored. The server sees only that a session exists, timing and size.</span></div>
<div class="chat"><div class="sep">session started 14:12</div>
<div class="m"><div class="b"><div class="tx">Sending the credentials now</div><div class="meta">14:13</div></div></div>
<div class="m own"><div class="b"><div class="tx">Ready</div><div class="meta">14:13 ${ic("checks", 14)}</div></div></div>
<div class="m"><div class="b"><div class="tx">••••••••••</div><div class="meta"><span class="vo">${ic("flame", 13)}view once</span> 14:14</div></div></div></div>
<div class="comp"><div class="ibtn" style="color:var(--mfg)">${ic("clip", 22)}</div><div class="in">Private message</div><div class="toggle" title="view once"></div><div class="send">${ic("up", 22)}</div></div>`, "private");

const group = (t) =>
  wrap(t, `${status()}<div class="hdr"><div class="ibtn">${ic("back", 22)}</div><span class="title" style="font-size:17px">Group info</span></div>
<div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:6px 16px 14px">${av({ title: "ops room", tag: "ops room" }, t, 76, `<i class="gb" style="width:24px;height:24px">${ic("users", 13)}</i>`)}<div style="font-size:19px;font-weight:600">ops room</div><div class="sub">4 members · created Oct 12</div></div>
<div class="act"><div>${ic("plus", 20)}Invite</div><div>${ic("search", 20)}Search</div><div>${ic("pin", 20)}Pinned</div></div>
<div class="sec">Members</div><div class="list">${members.map((m) => `<div class="row">${av(m.u, t, 42)}<div class="mid"><div class="l1"><span class="name">${m.u.displayName}${m.role === "owner" ? `<span class="role">owner</span>` : ""}</span></div><div class="sub">${m.u.tag}</div>${m.rights?.length ? `<div class="rights">${m.rights.map((r) => `<span class="chip">${rightLabels[r]}</span>`).join("")}</div>` : ""}</div><span style="color:var(--mfg)">${ic("chevron", 18)}</span></div>`).join("")}</div>
<div class="danger">Leave group</div>`);

const desktop = (t, privMode = false) => {
  const listPane = `<div class="col l"><div class="hdr"><span class="title">Chats</span><div class="ibtn ghost">${ic("plus", 20)}</div>${av(me, t, 36)}</div>${t.search ? `<div class="search">${ic("search", 18)}Search</div>` : ""}<div class="list">${chatRows(t, privMode ? 2 : 0)}</div></div>`;
  const center = privMode
    ? `<div class="col c"><div class="pane">${(priv(t).replace(/<div class="sb">.*?<\/div>/, ""))}</div></div>`
    : `<div class="col c"><div class="pane">${chatHeader(t).replace('<div class="ibtn">' + ic("back", 22) + "</div>", "")}<div class="pinbar">${ic("pin", 15)}<span><b>Pinned</b> · Deploy window moved to 18:00</span></div><div class="chat">${msgList(t)}</div><div class="typingln">Dima is typing…</div>${composer()}</div></div>`;
  const right = privMode
    ? `<div class="col r"><div class="sec">Session</div><div class="chips"><span class="chip ok">${ic("shield", 13)}Verified</span><span class="chip">strict</span></div><div class="sec">Verify out loud</div><div class="sas">🦊🌵🚀🎲🔑</div><div class="sub" style="padding:0 16px">Compare these five symbols in person or by voice. Never send them in a chat.</div><div class="sec">Ends in</div><div style="padding:0 16px;font-size:24px" class="title">14:32</div><div class="danger">Burn session</div></div>`
    : `<div class="col r"><div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:20px 16px 12px">${av({ title: "ops room", tag: "ops room" }, t, 72)}<div style="font-size:18px;font-weight:600">ops room</div><div class="sub">4 members</div></div><div class="sec">Members</div>${members.map((m) => `<div class="row" style="padding:7px 16px">${av(m.u, t, 34)}<div class="mid"><div class="name" style="font-size:14px">${m.u.displayName}${m.role === "owner" ? `<span class="role">owner</span>` : ""}</div><div class="sub">${m.u.tag}</div></div></div>`).join("")}</div>`;
  return wrap(t, `<div class="side">${listPane}${center}${right}</div>`, privMode ? "" : "");
};

const swatch = (t) => [["primary", t.v.primary], ["bg", t.v.bg], ["own bubble", t.v.ownb], ["in bubble", t.v.inb], ["private", t.v.priv], ["private accent", t.v.privacc]].map(([n, c]) => `<span><i style="background:${c}"></i>${n} ${c.slice(0, 7)}</span>`).join("");

const page = (t, i) => {
  const mob = (cap, html, p = true) => `<div><div class="cap">${cap}</div><div class="phone">${html}</div></div>`;
  const frames = t.desktop
    ? `<div><div class="cap">Desktop ≥1024px — public split view</div><div class="desk">${desktop(t)}</div></div>
       <div><div class="cap">Desktop — private session (dark pane + verification panel)</div><div class="desk">${desktop(t, true)}</div></div>
       ${mob("Mobile — chat list (same tokens, single pane)", list(t))}${mob("Mobile — login", login(t))}`
    : `${mob("S1 · Login / onboarding", login(t))}${mob("S4 · Chat list", list(t))}${mob("S5 · Group chat", chat(t))}${mob("S12 · Private session", priv(t))}${mob("S9a · Group info & rights", group(t))}`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${t.name} — OpenGlass mockup</title><style>${css(t)}</style>
<body><div class="top"><a href="index.html">← all 10 variants</a><h1>${t.id.slice(0, 2)} · ${t.name}</h1><p>${t.idea}</p><div class="sw">${swatch(t)}</div></div><div class="frames">${frames}</div></body></html>`;
};

themes.forEach((t, i) => writeFileSync(`${t.id}.html`, page(t, i)));
writeFileSync("index.html", `<!doctype html><meta charset="utf-8"><title>OpenGlass F5 mockups</title><style>body{font:15px Inter,system-ui,sans-serif;background:#eceef2;padding:36px;max-width:1100px;margin:auto}h1{font:400 26px ui-monospace,monospace}a.c{display:block;background:#fff;border-radius:14px;padding:16px 18px;text-decoration:none;color:#111;box-shadow:0 1px 3px #0002}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;margin-top:20px}b{display:block;font-size:16px;margin-bottom:4px}span{color:#555;font-size:13px;line-height:1.4}i{display:inline-block;width:14px;height:14px;border-radius:50%;margin-right:3px;vertical-align:-2px;border:1px solid #0002}</style>
<h1>OpenGlass — F5 design mockups (10 variants)</h1><p style="color:#555;margin-top:8px">Static HTML, shadcn-style semantic tokens. Data shapes follow the backend contract (User, ChatSummary, Message, GroupMember). Mockups only — not wired to the app.</p><div class="g">${themes.map((t) => `<a class="c" href="${t.id}.html"><b>${t.id.slice(0, 2)} · ${t.name}</b><span>${t.idea}</span><div style="margin-top:8px"><i style="background:${t.v.primary}"></i><i style="background:${t.v.bg}"></i><i style="background:${t.v.ownb}"></i><i style="background:${t.v.priv}"></i><i style="background:${t.v.privacc}"></i></div></a>`).join("")}</div>`);
console.log("built", themes.length);
