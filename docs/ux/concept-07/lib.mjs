import { ic as base } from "../mockups-f5/icons.mjs";
import { modes, ratio, pairs } from "./palette.mjs";
export { modes, ratio, pairs };

const X = {
  mask: '<path d="M18 11c-1.5 0-2.5.5-3 2"/><path d="M4 6a2 2 0 0 0-2 2v4a5 5 0 0 0 5 5 8 8 0 0 1 5 2 8 8 0 0 1 5-2 5 5 0 0 0 5-5V8a2 2 0 0 0-2-2h-3a8 8 0 0 0-5 2 8 8 0 0 0-5-2z"/><path d="M6 11c1.5 0 2.5.5 3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  phone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  userplus: '<path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path d="M19 16v6"/><path d="M22 19h-6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
};
export const ic = (n, s = 20) => X[n] ? `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${X[n]}</svg>` : base(n, s);

const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
export const av = (name, tag, dark, size = 44, badge = "") => {
  const h = hue(tag);
  return `<span class="av" style="width:${size}px;height:${size}px;background:${dark ? `hsl(${h} 32% 24%)` : `hsl(${h} 62% 91%)`};color:${dark ? `hsl(${h} 70% 82%)` : `hsl(${h} 52% 28%)`};font-size:${Math.round(size * 0.4)}px">${name[0].toUpperCase()}${badge}</span>`;
};
export const nameColor = (tag, dark) => `hsl(${hue(tag)} ${dark ? "70% 74%" : "55% 36%"})`;
const isDark = (m) => m === "dark" || m === "privDark" || m === "privLight";

const enc = (x) => encodeURIComponent(x).replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/'/g, "%27");
const maskTile = (col, op) => {
  const c = col;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'><g fill='none' stroke='${c}' stroke-opacity='${op}' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><g transform='translate(10 12) scale(1.3)'><path d='M18 11c-1.5 0-2.5.5-3 2'/><path d='M4 6a2 2 0 0 0-2 2v4a5 5 0 0 0 5 5 8 8 0 0 1 5 2 8 8 0 0 1 5-2 5 5 0 0 0 5-5V8a2 2 0 0 0-2-2h-3a8 8 0 0 0-5 2 8 8 0 0 0-5-2z'/><path d='M6 11c1.5 0 2.5.5 3 2'/></g><g transform='translate(58 56) rotate(-12 12 12) scale(1.1)'><path d='M18 11c-1.5 0-2.5.5-3 2'/><path d='M4 6a2 2 0 0 0-2 2v4a5 5 0 0 0 5 5 8 8 0 0 1 5 2 8 8 0 0 1 5-2 5 5 0 0 0 5-5V8a2 2 0 0 0-2-2h-3a8 8 0 0 0-5 2 8 8 0 0 0-5-2z'/><path d='M6 11c1.5 0 2.5.5 3 2'/></g></g></svg>`;
  return `url(data:image/svg+xml,${enc(svg)})`;
};
const latticeTile = (col, op) => {
  return `url(data:image/svg+xml,${enc(`<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'><path d='M0 28 28 0M-7 7 7-7M21 35 35 21' stroke='${col}' stroke-opacity='${op}' stroke-width='1'/></svg>`)})`;
};

const tok = (m) => `--bg:${m.bg};--card:${m.card};--fg:${m.fg};--mfg:${m.mfg};--muted:${m.muted};--border:${m.border};--primary:${m.primary};--pfg:${m.pfg};--inb:${m.inb};--infg:${m.infg};--ownb:${m.ownb};--ownfg:${m.ownfg};--okb:${m.okb};--okf:${m.okf};--pvb:${m.pvb};--pvf:${m.pvf};--nb:${m.nb};--nf:${m.nf};--warnb:${m.warnb};--warnf:${m.warnf};--danger:${m.danger};--link:${m.link}`;

export const CSS = `
@font-face{font-family:"Inter";src:url("../../../apps/pwa/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2") format("woff2");font-weight:100 900}
@font-face{font-family:"Source Code Pro";src:url("../../../apps/pwa/node_modules/@fontsource/source-code-pro/files/source-code-pro-latin-400-normal.woff2") format("woff2")}
*{box-sizing:border-box;margin:0}
body{font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#d5d9e2;color:#111;padding:28px 32px 60px}
.top{max-width:1500px;margin:0 auto 20px}.top h1{font:400 25px "Source Code Pro",ui-monospace,monospace}.top p{color:#4b5160;margin-top:6px;max-width:820px;line-height:1.5}.top a{color:#334;font-size:13px;margin-right:14px}
h2.s{font:400 18px "Source Code Pro",monospace;max-width:1700px;margin:30px auto 4px}.s+p{max-width:1700px;margin:0 auto 14px;color:#4b5160;font-size:13.5px;line-height:1.5}
.frames{display:flex;gap:26px;flex-wrap:wrap;justify-content:center;max-width:1750px;margin:0 auto 10px}
.cap{font:12px ui-monospace,monospace;color:#555;margin:0 0 8px 6px;max-width:375px}
.phone{width:375px;height:780px;border-radius:38px;overflow:hidden;box-shadow:0 0 0 9px #14151a,0 24px 50px #0006;position:relative;background:#000}
.card{background:#fff;border-radius:14px;padding:16px 18px;box-shadow:0 1px 3px #0002;max-width:1700px;margin:12px auto;font-size:13.5px;line-height:1.5}
.card table{border-collapse:collapse;width:100%}.card td,.card th{padding:5px 10px;text-align:left;border-bottom:1px solid #0001;font-size:13px}.card .ok{color:#15803d;font-weight:600}.card .no{color:#b91c1c;font-weight:600}
.sw{display:flex;gap:8px;flex-wrap:wrap}.sw span{font:11px ui-monospace,monospace;display:flex;align-items:center;gap:6px;background:#fff;border-radius:999px;padding:4px 10px 4px 4px}.sw i{width:20px;height:20px;border-radius:50%;border:1px solid #0003}
.app{height:100%;display:flex;flex-direction:column;position:relative;font-size:14px;line-height:1.35;background:var(--bg);color:var(--fg)}
.app.priv{background-color:var(--bg)}
.sb{height:30px;flex:none;display:flex;justify-content:space-between;align-items:flex-end;padding:0 24px 2px;font-size:12px;font-weight:600}
.hdr{flex:none;display:flex;align-items:center;gap:10px;padding:8px 16px;min-height:54px}
.title{font:400 19px "Source Code Pro",ui-monospace,monospace;flex:1}
.ibtn{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;flex:none}.ibtn.g{background:var(--muted)}
.av{display:inline-grid;place-items:center;font-weight:600;flex:none;position:relative;border-radius:50%}
.av .gb{position:absolute;right:-3px;bottom:-3px;width:18px;height:18px;border-radius:50%;background:var(--bg);color:var(--mfg);display:grid;place-items:center;border:1.5px solid var(--bg)}
.search{margin:2px 16px 8px;height:40px;border-radius:12px;background:var(--muted);display:flex;align-items:center;gap:8px;padding:0 12px;color:var(--mfg);flex:none}
.list{flex:1;overflow:hidden}
.row{display:flex;gap:12px;padding:10px 16px;align-items:center}
.row .mid{flex:1;min-width:0}.row .l1{display:flex;align-items:baseline;gap:6px}
.hdr .sub{font-size:12.5px;color:var(--mfg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.row .name{font-weight:600;font-size:15px;display:flex;align-items:center;gap:6px;white-space:nowrap}
.row .time{margin-left:auto;font-size:12px;color:var(--mfg)}
.row .l2{display:flex;align-items:center;gap:6px;margin-top:2px;color:var(--mfg);font-size:13.5px}
.row .pv{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}.row .pv b{font-weight:500;color:var(--fg)}
.badge{min-width:20px;height:20px;border-radius:10px;background:var(--primary);color:var(--pfg);font-size:11.5px;font-weight:700;display:grid;place-items:center;padding:0 6px;flex:none}
.typing{color:var(--link);font-weight:500}
.tabs{flex:none;display:flex;border-top:1px solid var(--border);background:var(--card);padding:6px 8px 20px}
.tabs div{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:11px;color:var(--mfg);padding:4px;position:relative;font-weight:500}
.tabs div.on{color:var(--link);font-weight:700}
.tabs .tb{position:absolute;top:0;left:calc(50% + 6px);min-width:17px;height:17px;border-radius:9px;background:var(--danger);color:#fff;font-size:10.5px;font-weight:700;display:grid;place-items:center;padding:0 4px}
.chip{display:inline-flex;gap:5px;align-items:center;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;background:var(--nb);color:var(--nf);white-space:nowrap}
.chip.ok{background:var(--okb);color:var(--okf)}.chip.pv{background:var(--pvb);color:var(--pvf)}.chip.warn{background:var(--warnb);color:var(--warnf)}
.chips{display:flex;gap:6px;padding:6px 16px;flex:none;flex-wrap:wrap}
.sec{padding:14px 16px 6px;font-size:12px;font-weight:700;color:var(--mfg);letter-spacing:.05em;text-transform:uppercase;display:flex;gap:8px;align-items:center}
.btn{height:44px;border-radius:12px;background:var(--primary);color:var(--pfg);display:grid;place-items:center;font-weight:600;padding:0 16px;font-size:14px}
.btn.s{height:34px;border-radius:10px;font-size:13px;padding:0 14px}.btn.o{background:transparent;color:var(--fg);border:1px solid var(--border)}.btn.d{background:transparent;color:var(--danger);border:1px solid var(--border)}
.btns{display:flex;gap:8px;margin-left:auto}
.seg{display:flex;background:var(--muted);border-radius:12px;padding:3px;margin:0 16px}.seg div{flex:1;text-align:center;padding:8px 0;border-radius:9px;font-weight:600;font-size:13px;color:var(--mfg);display:flex;gap:6px;justify-content:center;align-items:center}.seg div.on{background:var(--card);color:var(--fg);box-shadow:0 1px 2px #0003}
.setrow{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border)}.setrow .ic{width:34px;height:34px;border-radius:10px;background:var(--muted);display:grid;place-items:center;color:var(--link)}.setrow .t{flex:1;font-weight:500}.setrow .v{color:var(--mfg);font-size:13px}
.lay{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 6px 0 11px;border-radius:999px;background:var(--muted);color:var(--mfg);font-size:12.5px;font-weight:700;flex:none}
.lay .sw2{width:34px;height:20px;border-radius:10px;background:var(--border);position:relative}.lay .sw2:after{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:var(--card)}
.lay.lk{background:var(--warnb);color:var(--warnf);padding:0 12px}.lay.on{background:var(--pvb);color:var(--pvf)}.lay.on .sw2{background:var(--primary)}.lay.on .sw2:after{left:16px;background:var(--pfg)}
.chat{flex:1;overflow:hidden;padding:8px 14px;display:flex;flex-direction:column;justify-content:flex-end;gap:6px}
.sep{align-self:center;font-size:12px;color:var(--mfg);background:var(--muted);padding:3px 10px;border-radius:999px;margin:4px 0}
.divider{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:700;color:var(--pvf);margin:6px 0;line-height:1.3}.divider:before,.divider:after{content:"";flex:1;height:1px;background:color-mix(in srgb,var(--pvf) 35%,transparent)}.divider span{display:flex;gap:5px;align-items:center;text-align:center}
.divider.e{color:var(--mfg)}.divider.e:before,.divider.e:after{background:var(--border)}
.m{display:flex;gap:8px;align-items:flex-end;max-width:84%}.m.own{align-self:flex-end;flex-direction:row-reverse}
.b{padding:8px 11px;border-radius:17px;background:var(--inb);color:var(--infg);border-bottom-left-radius:5px;min-width:0}
.light .b,.dark .b{}
.own .b{background:var(--ownb);color:var(--ownfg);border-bottom-left-radius:17px;border-bottom-right-radius:5px}
.b .tx{font-size:14.5px}.b .meta{display:flex;gap:4px;justify-content:flex-end;align-items:center;font-size:11px;opacity:.78;margin-top:2px}
.rec{opacity:.62}
.pvb{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--primary) 40%,transparent)}
.vo{display:inline-flex;gap:3px;align-items:center;color:var(--warnf);font-weight:700;background:var(--warnb);border-radius:6px;padding:0 5px;opacity:1}
.burned{display:flex;gap:8px;align-items:center;font-style:italic;opacity:.8}
.comp{flex:none;display:flex;gap:8px;align-items:center;padding:8px 12px 20px;background:var(--bg)}
.comp .in{flex:1;height:44px;border-radius:22px;background:var(--muted);display:flex;align-items:center;gap:8px;padding:0 14px;color:var(--mfg);font-size:14px}
.comp .send{width:44px;height:44px;border-radius:50%;background:var(--primary);color:var(--pfg);display:grid;place-items:center;flex:none}
.comp.pv{border-top:1px solid var(--border);background:var(--card)}.comp.pv .in{background:var(--bg);box-shadow:inset 0 0 0 1.5px var(--primary);color:var(--mfg)}
.comp.lock .in{opacity:.5}.comp.lock .send{opacity:.35}
.vtg{width:26px;height:46px;border-radius:13px;background:var(--border);position:relative;flex:none;color:var(--pfg)}.vtg>svg{position:absolute;left:50%;transform:translateX(-50%);bottom:5px;color:var(--mfg);opacity:.0}.vtg:after{content:"";position:absolute;left:3px;bottom:3px;width:20px;height:20px;border-radius:50%;background:var(--card)}.vtg.on{background:var(--warnb);box-shadow:inset 0 0 0 1.5px var(--warnf)}.vtg.on:after{bottom:auto;top:3px;background:var(--warnf)}.vtg.on>svg{opacity:1;top:6px;bottom:auto;color:var(--warnb);z-index:1}.vlock{width:36px;height:36px;border-radius:50%;background:var(--muted);color:var(--mfg);display:grid;place-items:center;flex:none}
.tgl{width:36px;height:22px;border-radius:11px;background:var(--border);position:relative}.tgl:after{content:"";position:absolute;left:2px;top:2px;width:18px;height:18px;border-radius:50%;background:var(--card)}.tgl.on{background:var(--primary)}.tgl.on:after{left:16px;background:var(--pfg)}
.scrim{position:absolute;inset:0;background:#0009;z-index:5}
.sheet{position:absolute;left:0;right:0;bottom:0;z-index:6;background:var(--card);border-radius:24px 24px 0 0;padding:10px 20px 28px;box-shadow:0 -10px 40px #0005;color:var(--fg)}
.grab{width:40px;height:4px;border-radius:2px;background:var(--border);margin:0 auto 14px}
.sheet h3{font:400 18px "Source Code Pro",monospace;display:flex;gap:8px;align-items:center}
.ttl{display:flex;gap:8px;margin:8px 0}.ttl div{flex:1;text-align:center;padding:10px 0;border-radius:12px;background:var(--muted);font-weight:600}.ttl div.on{background:var(--primary);color:var(--pfg)}
.opt{display:flex;gap:12px;align-items:center;padding:10px 0}.opt .t{flex:1}.opt small{display:block;color:var(--mfg);font-size:12.5px}
.cb{width:22px;height:22px;border-radius:7px;border:2px solid var(--border);display:grid;place-items:center;color:var(--pfg)}.cb.on{background:var(--primary);border-color:var(--primary)}
.note{display:flex;gap:9px;font-size:12.5px;color:var(--mfg);line-height:1.45;background:var(--muted);border-radius:12px;padding:10px 12px;margin:6px 0 12px}.note svg{flex:none;margin-top:1px;color:var(--link)}
.sas{display:flex;justify-content:center;gap:10px;font-size:34px;padding:18px 8px;background:var(--muted);border-radius:16px;margin:14px 16px}
.center{flex:1;display:flex;flex-direction:column;align-items:center;padding:6px 22px;text-align:center;gap:6px}
.center h2{font:400 21px "Source Code Pro",monospace;margin-top:8px}.center p{color:var(--mfg);font-size:13.5px;line-height:1.5}
.banner{margin:6px 14px;padding:9px 12px;border-radius:12px;background:var(--warnb);color:var(--warnf);display:flex;gap:9px;font-size:12.5px;line-height:1.4;flex:none}
.banner.pvt{background:var(--pvb);color:var(--pvf)}.banner svg{flex:none;margin-top:1px}
.pcard{margin:6px 16px 10px;padding:14px;border-radius:16px;background:var(--card);border:1px solid var(--border);display:flex;gap:14px;align-items:center}
.vbadge{color:var(--link);display:inline-flex}
`;

const status = () => `<div class="sb"><span>9:41</span><span>5G ▮▮▮</span></div>`;
export const tabBar = (on, b = {}) => `<div class="tabs">${[["chat", "Chats", b.chats], ["users", "Contacts", b.contacts], ["cog", "Settings"]].map(([k, l, n], i) => `<div class="${i === on ? "on" : ""}">${ic(k, 22)}${l}${n ? `<span class="tb">${n}</span>` : ""}</div>`).join("")}</div>`;

export const app = (mode, inner, { bg = "mask" } = {}) => {
  const m = modes[mode];
  const priv = mode.startsWith("priv");
  const pat = priv ? (bg === "mask" ? `background-image:${maskTile(m.pattern, m.patternOp)}` : bg === "lattice" ? `background-image:${latticeTile(m.pattern, m.patternOp * 1.6)}` : `background-image:radial-gradient(120% 70% at 50% 0%,${m.card},${m.bg})`) : "";
  return `<div class="app ${priv ? "priv" : ""}" style="${tok(m)};${pat}">${status()}${inner}</div>`;
};
export const phone = (cap, html) => `<div><div class="cap">${cap}</div><div class="phone">${html}</div></div>`;

export const page = (title, intro, body, extraNav = "") => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title} — Concept 07</title><style>${CSS}</style><body>
<div class="top"><a href="index.html">← concept 07</a>${extraNav}<h1>${title}</h1><p>${intro}</p></div>${body}</body></html>`;
export const isDarkMode = isDark;
