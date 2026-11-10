#!/usr/bin/env node
/**
 * Simulatore Foundry War (Node, senza Foundry).
 *
 * Esempi:
 *   node sim/run.mjs
 *   node sim/run.mjs --ally "1x10,3x2" --enemy "2x8" --runs 20000 --alpha 0.3
 *   node sim/run.mjs --ally "1x16" --enemy "1x10" --rush true --threshold 0.95
 *
 * Opzioni:
 *   --ally "CRxTRUPPE,CRxTRUPPE"   es. "1x10,3x2"
 *   --enemy "CRxTRUPPE,..."
 *   --runs 20000                   numero di battaglie simulate
 *   --alpha 0.3                    caos (0 deterministico, 1 molto casuale)
 *   --rush true|false              perdite illimitate
 *   --lossCap 0.5                  limite perdite senza rush
 *   --threshold 0.95               soglia vittoria schiacciante
 *   --dice 3                       truppe schierate per lato per round
 *   --seed 12345
 *   --out sim/out/report.html
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_ALPHA,
  DEFAULT_DICE,
  DEFAULT_DECISIVE_THRESHOLD,
  DEFAULT_LOSS_CAP,
  simulateDistribution,
} from "../scripts/battle-engine.js";

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function parseSpec(spec) {
  return String(spec)
    .split(",")
    .map((part) => {
      const [cr, troops] = part.trim().split(/[x:]/);
      return { cr: Number(cr), troops: Number(troops) };
    })
    .filter((b) => Number.isFinite(b.cr) && Number.isFinite(b.troops) && b.troops > 0);
}

const args = parseArgs(process.argv);

const runs = Number(args.runs ?? 20000);
const alpha = Number(args.alpha ?? DEFAULT_ALPHA);
const rush = String(args.rush ?? "false") === "true";
const lossCap = Number(args.lossCap ?? DEFAULT_LOSS_CAP);
const threshold = Number(args.threshold ?? DEFAULT_DECISIVE_THRESHOLD);
const dice = Number(args.dice ?? DEFAULT_DICE);
const seed = Number(args.seed ?? 12345);
const outPath = resolve(String(args.out ?? "sim/out/report.html"));

const customAllies = args.ally ? parseSpec(args.ally) : null;
const customEnemies = args.enemy ? parseSpec(args.enemy) : null;

const scenarios = [
  {
    name: "Alleati 60%",
    color: "#e76f51",
    allies: [{ cr: 1, troops: 6 }],
    enemies: [{ cr: 1, troops: 10 }],
  },
  {
    name: "Pari",
    color: "#4cc9f0",
    allies: [{ cr: 1, troops: 10 }],
    enemies: [{ cr: 1, troops: 10 }],
  },
  {
    name: "Alleati 160%",
    color: "#2a9d8f",
    allies: [{ cr: 1, troops: 16 }],
    enemies: [{ cr: 1, troops: 10 }],
  },
  {
    name: "Alleati 300%",
    color: "#b388ff",
    allies: [{ cr: 1, troops: 30 }],
    enemies: [{ cr: 1, troops: 10 }],
  },
];

const activeScenarios =
  customAllies && customEnemies
    ? [
        {
          name: "Scenario personalizzato",
          color: "#4cc9f0",
          allies: customAllies,
          enemies: customEnemies,
        },
      ]
    : scenarios;

const baseConfig = {
  alpha,
  rush,
  lossCap,
  dice,
  decisiveThreshold: threshold,
};

/* -------------------------------------------------------------------------- */
/* Simulazione                                                                */
/* -------------------------------------------------------------------------- */

const results = activeScenarios.map((scenario, index) => {
  const config = {
    ...baseConfig,
    allies: scenario.allies,
    enemies: scenario.enemies,
  };

  const distribution = simulateDistribution(config, runs, seed + index * 7919);

  return {
    name: scenario.name,
    color: scenario.color,
    config,
    distribution,
  };
});

/* -------------------------------------------------------------------------- */
/* Output console                                                             */
/* -------------------------------------------------------------------------- */

const pct = (value) => `${(value * 100).toFixed(1)}%`;
const num = (value) => (value == null ? "—" : value.toFixed(1));

function pad(value, length) {
  return String(value).padEnd(length);
}

console.log(`\nFoundry War — ${runs.toLocaleString("it-IT")} battaglie per scenario`);
console.log(
  `alpha=${alpha}  rush=${rush}  lossCap=${lossCap}  dice=${dice}  soglia=${threshold}\n`,
);
console.log(
  `${pad("Scenario", 24)}${pad("Vitt. A", 10)}${pad("Vitt. N", 10)}${pad("Pari", 8)}${pad("Perdite A", 12)}${pad("Perdite N", 12)}Esito`,
);
console.log("-".repeat(86));

for (const result of results) {
  const d = result.distribution;
  const esito = d.decisive ? `SCHIACCIANTE (${d.decisive === "ally" ? "A" : "N"})` : "—";
  console.log(
    pad(result.name, 24) +
      pad(pct(d.allyWinRate), 10) +
      pad(pct(d.enemyWinRate), 10) +
      pad(pct(d.drawRate), 8) +
      pad(num(d.average?.allies.losses), 12) +
      pad(num(d.average?.enemies.losses), 12) +
      esito,
  );
}

/* -------------------------------------------------------------------------- */
/* Report HTML                                                                */
/* -------------------------------------------------------------------------- */

const reportData = {
  generatedAt: new Date().toISOString(),
  settings: {
    runs,
    alpha,
    rush,
    lossCap,
    threshold,
    dice,
  },
  scenarios: results.map((result) => ({
    name: result.name,
    color: result.color,
    distribution: result.distribution,
  })),
};

const html = buildReportHtml(reportData);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, "utf8");
writeFileSync(
  outPath.replace(/\.html?$/i, ".json"),
  JSON.stringify(reportData, null, 2),
  "utf8",
);

console.log(`\nReport: ${outPath}`);

/* -------------------------------------------------------------------------- */
/* HTML                                                                       */
/* -------------------------------------------------------------------------- */

function buildReportHtml(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Foundry War — Simulazione</title>
<style>
  :root {
    --bg: #14161a;
    --panel: #1d2026;
    --border: #30343d;
    --text: #e7e9ee;
    --muted: #9aa1ad;
    --accent: #f0c674;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: radial-gradient(1200px 600px at 20% -10%, #232a33 0%, var(--bg) 55%);
    color: var(--text);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 28px;
  }
  h1 { margin: 0 0 4px; font-size: 24px; letter-spacing: .2px; }
  h1 span { color: var(--accent); }
  .sub { color: var(--muted); margin: 0 0 22px; }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 12px;
    margin-bottom: 18px;
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
  }
  .card .k { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .6px; }
  .card .v { font-size: 22px; font-weight: 650; margin-top: 2px; }
  .card .v small { font-size: 12px; color: var(--muted); font-weight: 400; }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .4px;
    text-transform: uppercase;
    background: rgba(240, 198, 116, .15);
    color: var(--accent);
    border: 1px solid rgba(240, 198, 116, .4);
  }
  .chart-wrap {
    position: relative;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 10px 12px 4px;
  }
  svg { display: block; width: 100%; height: auto; }
  .axis text { fill: var(--muted); font-size: 11px; }
  .grid line { stroke: #2a2e36; stroke-width: 1; }
  .zero { stroke: #5a606b; stroke-dasharray: 4 4; stroke-width: 1; }
  .hover { stroke: #ffffff55; stroke-width: 1; pointer-events: none; }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    padding: 8px 6px 4px;
    color: var(--muted);
    font-size: 12px;
  }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .tooltip {
    position: absolute;
    min-width: 190px;
    max-width: 320px;
    background: #101217f2;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 12px;
    pointer-events: none;
    opacity: 0;
    transform: translateY(-50%);
    box-shadow: 0 12px 30px #0009;
    z-index: 5;
  }
  .tooltip h4 { margin: 0 0 6px; font-size: 12px; }
  .tooltip .row { display: flex; justify-content: space-between; gap: 12px; color: var(--muted); }
  .tooltip .row b { color: var(--text); font-weight: 600; }
  .tooltip hr { border: 0; border-top: 1px solid var(--border); margin: 7px 0; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 18px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    font-size: 13px;
  }
  th, td { padding: 9px 12px; text-align: right; border-bottom: 1px solid var(--border); }
  th:first-child, td:first-child { text-align: left; }
  th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  tr:last-child td { border-bottom: 0; }
  .note { color: var(--muted); font-size: 12px; margin-top: 14px; }
  @media (max-width: 640px) { body { padding: 16px; } }
</style>
</head>
<body>
  <h1>Foundry War <span>— Simulazione</span></h1>
  <p class="sub">
    ${runs.toLocaleString("it-IT")} battaglie per scenario ·
    alpha ${alpha} · rush ${rush ? "ON" : "OFF"} · limite perdite ${lossCap * 100}% ·
    ${dice} truppe per round · soglia schiacciante ${threshold * 100}%
  </p>

  <div class="cards" id="cards"></div>

  <div class="chart-wrap">
    <svg id="chart" viewBox="0 0 1120 470" role="img" aria-label="Curva degli esiti"></svg>
    <div class="legend" id="legend"></div>
    <div class="tooltip" id="tooltip"></div>
  </div>

  <table id="summary"></table>
  <p class="note">
    Asse X: truppe alleate rimaste meno truppe nemiche rimaste (positivo = vantaggio alleato).
    Asse Y: probabilità. Passa il mouse sul grafico per i dettagli.
    Le curve sono smussate per leggibilità; il tooltip usa i valori reali.
  </p>

<script>
const DATA = ${json};
const svg = document.getElementById("chart");
const tooltip = document.getElementById("tooltip");
const NS = "http://www.w3.org/2000/svg";

const W = 1120, H = 470;
const M = { top: 22, right: 26, bottom: 54, left: 66 };

const scenarios = DATA.scenarios;
const allBins = scenarios.flatMap(s => s.distribution.bins);

const xMinRaw = Math.min(...allBins.map(b => b.value));
const xMaxRaw = Math.max(...allBins.map(b => b.value));
const xMin = Math.min(xMinRaw, 0) - 1;
const xMax = Math.max(xMaxRaw, 0) + 1;

function smooth(bins) {
  return bins.map((bin, i) => {
    const prev = bins[i - 1]?.probability ?? bin.probability;
    const next = bins[i + 1]?.probability ?? bin.probability;
    return (prev + bin.probability * 2 + next) / 4;
  });
}

const yMax = Math.max(
  0.01,
  ...scenarios.flatMap(s => smooth(s.distribution.bins))
) * 1.18;

const xScale = v => M.left + ((v - xMin) / (xMax - xMin || 1)) * (W - M.left - M.right);
const yScale = p => H - M.bottom - (p / yMax) * (H - M.top - M.bottom);

function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/* Griglia */
const grid = el("g", { class: "grid" });
for (let i = 0; i <= 5; i++) {
  const p = (yMax / 5) * i;
  const y = yScale(p);
  grid.append(el("line", { x1: M.left, x2: W - M.right, y1: y, y2: y }));
  const label = el("text", { x: M.left - 10, y: y + 4, "text-anchor": "end" });
  label.textContent = (p * 100).toFixed(1) + "%";
  grid.append(label);
}
svg.append(grid);

/* Asse X */
const axis = el("g", { class: "axis" });
const stepX = Math.max(1, Math.round((xMax - xMin) / 14));
for (let v = Math.ceil(xMin); v <= xMax; v += stepX) {
  const label = el("text", { x: xScale(v), y: H - M.bottom + 20, "text-anchor": "middle" });
  label.textContent = v;
  axis.append(label);
}
const xTitle = el("text", { x: (M.left + W - M.right) / 2, y: H - 12, "text-anchor": "middle" });
xTitle.textContent = "vantaggio truppe (alleati − nemici)";
axis.append(xTitle);
svg.append(axis);

/* Zero */
svg.append(el("line", {
  class: "zero", x1: xScale(0), x2: xScale(0), y1: M.top, y2: H - M.bottom
}));

/* Curve */
scenarios.forEach((scenario, index) => {
  const bins = scenario.distribution.bins;
  const smoothed = smooth(bins);

  const points = bins.map((bin, i) => [xScale(bin.value), yScale(smoothed[i])]);
  if (!points.length) return;

  const line = points.map((p, i) => (i ? "L" : "M") + p[0] + "," + p[1]).join(" ");
  const area = line + " L" + points[points.length - 1][0] + "," + (H - M.bottom) +
               " L" + points[0][0] + "," + (H - M.bottom) + " Z";

  svg.append(el("path", {
    d: area,
    fill: scenario.color,
    opacity: "0.08",
  }));

  svg.append(el("path", {
    d: line,
    fill: "none",
    stroke: scenario.color,
    "stroke-width": index === 0 ? 2.4 : 2.2,
    "stroke-linejoin": "round",
    "stroke-linecap": "round",
  }));

  /* Punti campionati */
  for (const [x, y] of points) {
    const dot = el("circle", { cx: x, cy: y, r: 1.8, fill: scenario.color, opacity: "0.85" });
    svg.append(dot);
  }
});

/* Hover */
const hoverLine = el("line", {
  class: "hover", x1: 0, x2: 0, y1: M.top, y2: H - M.bottom, opacity: 0,
});
svg.append(hoverLine);

const chartWrap = svg.parentElement;

function binAt(bins, value) {
  return bins.find(bin => bin.value === value) ?? null;
}

svg.addEventListener("mousemove", event => {
  const rect = svg.getBoundingClientRect();
  const scale = W / rect.width;
  const svgX = (event.clientX - rect.left) * scale;

  const value = xMin + ((svgX - M.left) / (W - M.left - M.right)) * (xMax - xMin);
  const hoveredValue = Math.round(value);

  hoverLine.setAttribute("x1", xScale(hoveredValue));
  hoverLine.setAttribute("x2", xScale(hoveredValue));
  hoverLine.setAttribute("opacity", "1");

  const rows = [];
  for (const scenario of scenarios) {
    const bin = binAt(scenario.distribution.bins, hoveredValue);
    const header =
      '<hr><h4><span class="swatch" style="background:' + scenario.color + '"></span> ' +
      scenario.name + '</h4>';

    if (!bin) {
      rows.push(header + '<div class="row"><span>Probabilità</span><b>0.00%</b></div>');
      continue;
    }

    rows.push(
      header +
      '<div class="row"><span>Probabilità</span><b>' + (bin.probability * 100).toFixed(2) + '%</b></div>' +
      '<div class="row"><span>Perdite alleate</span><b>' + bin.avgAllyLosses.toFixed(1) + '</b></div>' +
      '<div class="row"><span>Perdite nemiche</span><b>' + bin.avgEnemyLosses.toFixed(1) + '</b></div>' +
      '<div class="row"><span>Truppe alleate</span><b>' + bin.avgAllySurvivors.toFixed(1) + '</b></div>' +
      '<div class="row"><span>Truppe nemiche</span><b>' + bin.avgEnemySurvivors.toFixed(1) + '</b></div>'
    );
  }

  if (rows.length) {
    tooltip.innerHTML =
      '<div style="font-weight:700;margin-bottom:4px">Vantaggio ' + hoveredValue + '</div>' +
      rows.join("");
    tooltip.style.opacity = "1";
    const left = event.clientX - chartWrap.getBoundingClientRect().left + 18;
    const top = event.clientY - chartWrap.getBoundingClientRect().top;
    tooltip.style.left = Math.min(left, chartWrap.clientWidth - 330) + "px";
    tooltip.style.top = top + "px";
  }
});

svg.addEventListener("mouseleave", () => {
  hoverLine.setAttribute("opacity", "0");
  tooltip.style.opacity = "0";
});

/* Legenda */
const legend = document.getElementById("legend");
for (const scenario of scenarios) {
  const item = document.createElement("span");
  item.innerHTML = '<span class="swatch" style="background:' + scenario.color + '"></span>' + scenario.name;
  legend.append(item);
}

/* Cards */
const cards = document.getElementById("cards");
for (const scenario of scenarios) {
  const d = scenario.distribution;
  const decisive = d.decisive
    ? '<div class="badge">Schiacciante ' + (d.decisive === "ally" ? "alleati" : "nemici") + '</div>'
    : '';
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML =
    '<div class="k">' + scenario.name + '</div>' +
    '<div class="v">' + (d.allyWinRate * 100).toFixed(1) + '% <small>vittoria alleati</small></div>' +
    '<div class="row" style="display:flex;justify-content:space-between;color:#9aa1ad;font-size:12px;margin-top:6px">' +
      '<span>Nemici ' + (d.enemyWinRate * 100).toFixed(1) + '%</span>' +
      '<span>Pari ' + (d.drawRate * 100).toFixed(1) + '%</span>' +
    '</div>' + decisive;
  cards.append(card);
}

/* Tabella */
const table = document.getElementById("summary");
table.innerHTML =
  '<thead><tr>' +
    '<th>Scenario</th><th>Vitt. alleati</th><th>Vitt. nemici</th><th>Pari</th>' +
    '<th>Perdite A</th><th>Perdite N</th><th>Esito</th>' +
  '</tr></thead><tbody>' +
  scenarios.map(scenario => {
    const d = scenario.distribution;
    const avg = d.average;
    const esito = d.decisive
      ? '<span class="badge">Schiacciante ' + (d.decisive === "ally" ? "A" : "N") + '</span>'
      : '—';
    return '<tr>' +
      '<td><span class="swatch" style="background:' + scenario.color + '"></span> ' + scenario.name + '</td>' +
      '<td>' + (d.allyWinRate * 100).toFixed(1) + '%</td>' +
      '<td>' + (d.enemyWinRate * 100).toFixed(1) + '%</td>' +
      '<td>' + (d.drawRate * 100).toFixed(1) + '%</td>' +
      '<td>' + (avg ? avg.allies.losses.toFixed(1) : '—') + '</td>' +
      '<td>' + (avg ? avg.enemies.losses.toFixed(1) : '—') + '</td>' +
      '<td>' + esito + '</td>' +
    '</tr>';
  }).join('') +
  '</tbody>';
</script>
</body>
</html>`;
}
