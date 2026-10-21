// Concept palette for variant 07 "Slate Tabs": four modes, explicit hex only,
// so every text/background pair can be contrast-checked (WCAG 2.x).
export const modes = {
  light: { label: "Light · public", bg: "#f8fafc", card: "#ffffff", fg: "#0f172a", mfg: "#53627a", muted: "#eef2f7", border: "#dbe3ee",
    primary: "#3b5bdb", pfg: "#ffffff", inb: "#ffffff", infg: "#0f172a", ownb: "#3b5bdb", ownfg: "#ffffff",
    okb: "#dcfce7", okf: "#14532d", pvb: "#ede9fe", pvf: "#4c1d95", nb: "#e6ecf5", nf: "#2b3a52", warnb: "#ffedd5", warnf: "#9a3412", danger: "#b91c1c", link: "#3b5bdb" },
  dark: { label: "Dark · public", bg: "#0b1220", card: "#111a2e", fg: "#e6ebf5", mfg: "#9aa8c4", muted: "#18233b", border: "#25345a",
    primary: "#8ea2f7", pfg: "#0b1220", inb: "#18233b", infg: "#e6ebf5", ownb: "#3b5bdb", ownfg: "#ffffff",
    okb: "#123524", okf: "#86efac", pvb: "#2b2160", pvf: "#d6ccff", nb: "#1f2b46", nf: "#cbd5e1", warnb: "#3a1d0c", warnf: "#fdba74", danger: "#f87171", link: "#8ea2f7" },
  privLight: { label: "Private · on light app", bg: "#1b1540", card: "#251d54", fg: "#f1edff", mfg: "#b9b0e0", muted: "#2f2670", border: "#41358a",
    primary: "#b79cff", pfg: "#1b1540", inb: "#2f2670", infg: "#f1edff", ownb: "#6f4fe6", ownfg: "#ffffff",
    okb: "#123524", okf: "#86efac", pvb: "#41358a", pvf: "#ece6ff", nb: "#3a2f7e", nf: "#e0daff", warnb: "#3a1d0c", warnf: "#fdba74", danger: "#fca5a5", link: "#b79cff", pattern: "#b79cff", patternOp: 0.08 },
  privDark: { label: "Private · on dark app", bg: "#07050f", card: "#100c20", fg: "#f4f0ff", mfg: "#aaa0cf", muted: "#1a1433", border: "#2c2256",
    primary: "#c4adff", pfg: "#07050f", inb: "#1a1433", infg: "#f4f0ff", ownb: "#6c47e6", ownfg: "#ffffff",
    okb: "#0f2c1d", okf: "#86efac", pvb: "#2c2256", pvf: "#e9e2ff", nb: "#241b46", nf: "#d9d0ff", warnb: "#3a1d0c", warnf: "#fdba74", danger: "#fca5a5", link: "#c4adff", pattern: "#c4adff", patternOp: 0.09 },
};
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export const blend = (fg, bg, a) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, "0")).join("");
export const pairs = (m) => [
  ["body text", m.fg, m.bg, 4.5], ["secondary text", m.mfg, m.bg, 4.5], ["secondary on card", m.mfg, m.card, 4.5],
  ["button label", m.pfg, m.primary, 4.5], ["link / accent on bg", m.link, m.bg, 4.5],
  ["incoming bubble", m.infg, m.inb, 4.5], ["own bubble", m.ownfg, m.ownb, 4.5],
  ["chip · verified", m.okf, m.okb, 4.5], ["chip · private", m.pvf, m.pvb, 4.5], ["chip · neutral", m.nf, m.nb, 4.5], ["chip · warning / view-once", m.warnf, m.warnb, 4.5],
  ["danger text", m.danger, m.bg, 4.5], ["recessed public (60%)", blend(m.infg, m.inb, 0.6), m.inb, 3],
];
if (process.argv[2] === "check") for (const [k, m] of Object.entries(modes)) { console.log("\n" + k); for (const [n, f, b, min] of pairs(m)) { const r = ratio(f, b); console.log((r >= min ? "ok  " : "FAIL"), r.toFixed(2).padStart(5), n); } }
