#!/usr/bin/env node
/**
 * Simulatore Foundry War (Node, senza Foundry).
 *
 * Genera un report HTML interattivo con:
 *  - slider per truppe alleate / nemiche
 *  - CR per lato
 *  - alpha e Rush
 *  - un grafico con probabilità e perdite medie alleate/nemiche
 *
 * Esempi:
 *   node sim/run.mjs
 *   node sim/run.mjs --ally "1x10" --enemy "1x10" --runs 20000
 *   node sim/run.mjs --ally "5x20" --enemy "2x15" --rush true
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ALPHA,
  DEFAULT_DICE,
  DEFAULT_DECISIVE_THRESHOLD,
  DEFAULT_LOSS_CAP,
  MIN_XP,
  simulateDistribution,
  xpForCR,
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

const runs = Math.max(1, Math.floor(Number(args.runs ?? 20000)));
const interactiveRuns = Math.min(runs, 8000);
const alpha = Number(args.alpha ?? DEFAULT_ALPHA);
const rush = String(args.rush ?? "false") === "true";
const lossCap = Number(args.lossCap ?? DEFAULT_LOSS_CAP);
const threshold = Number(args.threshold ?? DEFAULT_DECISIVE_THRESHOLD);
const dice = Number(args.dice ?? DEFAULT_DICE);
const outPath = resolve(String(args.out ?? "sim/out/report.html"));

function initialBattalion(spec, fallbackCR, fallbackTroops) {
  if (!spec) return { cr: fallbackCR, troops: fallbackTroops };
  const parsed = parseSpec(spec);
  if (!parsed.length) return { cr: fallbackCR, troops: fallbackTroops };
  if (parsed.length > 1) {
    console.warn(
      "[sim] Il report interattivo usa un solo battaglione per lato: uso la prima voce della specifica.",
    );
  }
  return parsed[0];
}

const ally = initialBattalion(args.ally, 1, 10);
const enemy = initialBattalion(args.enemy, 1, 10);

const settings = {
  runs: interactiveRuns,
  alpha,
  rush,
  lossCap,
  threshold,
  dice,
  seed: Number(args.seed ?? 12345),
};

/* -------------------------------------------------------------------------- */
/* Simulazione iniziale (riepilogo console)                                   */
/* -------------------------------------------------------------------------- */

const config = {
  allies: [{ cr: ally.cr, troops: ally.troops }],
  enemies: [{ cr: enemy.cr, troops: enemy.troops }],
  alpha,
  rush,
  lossCap,
  dice,
  decisiveThreshold: threshold,
};

const distribution = simulateDistribution(config, runs, settings.seed);

const pct = (value) => `${(value * 100).toFixed(1)}%`;
const num = (value) => (value == null ? "—" : value.toFixed(1));
const effective = (battalion) =>
  Math.floor((battalion.troops * xpForCR(battalion.cr)) / MIN_XP);

console.log(`\nFoundry War — ${runs.toLocaleString("it-IT")} battaglie`);
console.log(
  `Alleati: ${ally.troops} truppe CR ${ally.cr} (= ${effective(ally)} truppe effettive) · ` +
    `Nemici: ${enemy.troops} truppe CR ${enemy.cr} (= ${effective(enemy)} truppe effettive)`,
);
console.log(
  `alpha=${alpha}  rush=${rush}  lossCap=${lossCap}  dice=${dice}  soglia=${threshold}\n`,
);
console.log(`Vittorie alleati: ${pct(distribution.allyWinRate)}`);
console.log(`Vittorie nemici:  ${pct(distribution.enemyWinRate)}`);
console.log(`Pari:             ${pct(distribution.drawRate)}`);
console.log(
  `Perdite medie:    alleati ${num(distribution.average?.allies.losses)} · nemici ${num(distribution.average?.enemies.losses)}`,
);
console.log(
  `Esito:            ${distribution.decisive ? `SCHIACCIANTE (${distribution.decisive === "ally" ? "alleati" : "nemici"})` : "—"}`,
);

/* -------------------------------------------------------------------------- */
/* Report HTML                                                                */
/* -------------------------------------------------------------------------- */

const enginePath = fileURLToPath(new URL("../scripts/battle-engine.js", import.meta.url));
const engineSource = readFileSync(enginePath, "utf8").replace(/^export\s+/gm, "");

const html = buildReportHtml({
  engineSource,
  initial: { ally, enemy },
  settings,
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, "utf8");
writeFileSync(
  outPath.replace(/\.html?$/i, ".json"),
  JSON.stringify({ settings, initial: { ally, enemy }, distribution }, null, 2),
  "utf8",
);

console.log(`\nReport: ${outPath}`);
console.log("Apri il file nel browser: gli slider ricalcolano la curva in tempo reale.\n");

/* -------------------------------------------------------------------------- */
/* HTML                                                                       */
/* -------------------------------------------------------------------------- */

function buildReportHtml({ engineSource, initial, settings }) {
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
    --prob: #4cc9f0;
    --ally: #7bd88f;
    --enemy: #ff6b6b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: radial-gradient(1200px 600px at 20% -10%, #232a33 0%, var(--bg) 55%);
    color: var(--text);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 26px;
  }
  h1 { margin: 0 0 4px; font-size: 24px; letter-spacing: .2px; }
  h1 span { color: var(--accent); }
  .sub { color: var(--muted); margin: 0 0 20px; }
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .controls {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: 14px 22px;
    padding: 16px 18px;
    margin-bottom: 14px;
  }
  .control { display: flex; flex-direction: column; gap: 6px; }
  .control .label {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 12px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: .5px;
  }
  .control .label output {
    color: var(--text);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: none;
  }
  .control input[type="range"] { width: 100%; accent-color: var(--accent); }
  .control input[type="number"] {
    width: 90px;
    padding: 4px 8px;
    color: var(--text);
    background: #121419;
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .inline { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }
  .inline input[type="checkbox"] { accent-color: var(--accent); width: 16px; height: 16px; }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 12px;
    margin-bottom: 14px;
  }
  .card { padding: 12px 14px; }
  .card .k { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .6px; }
  .card .v { font-size: 22px; font-weight: 650; margin-top: 2px; }
  .card .v small { font-size: 12px; color: var(--muted); font-weight: 400; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
    background: rgba(240,198,116,.15); color: var(--accent); border: 1px solid rgba(240,198,116,.4);
  }
  .chart-wrap { position: relative; padding: 8px 12px 0; }
  svg { display: block; width: 100%; height: auto; }
  .axis text { fill: var(--muted); font-size: 11px; }
  .grid line { stroke: #2a2e36; stroke-width: 1; }
  .zero { stroke: #5a606b; stroke-dasharray: 4 4; stroke-width: 1; }
  .hover { stroke: #ffffff55; stroke-width: 1; pointer-events: none; }
  .legend { display: flex; flex-wrap: wrap; gap: 16px; padding: 10px 8px 6px; color: var(--muted); font-size: 12px; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .tooltip {
    position: absolute; min-width: 200px; max-width: 320px;
    background: #101217f2; border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 12px; font-size: 12px; pointer-events: none; opacity: 0;
    transform: translateY(-50%); box-shadow: 0 12px 30px #0009; z-index: 5;
  }
  .tooltip h4 { margin: 0 0 6px; font-size: 12px; }
  .tooltip .row { display: flex; justify-content: space-between; gap: 12px; color: var(--muted); }
  .tooltip .row b { color: var(--text); font-weight: 600; }
  .tooltip hr { border: 0; border-top: 1px solid var(--border); margin: 8px 0; }
  .note { color: var(--muted); font-size: 12px; margin: 12px 2px 0; }
  .status { color: var(--accent); font-size: 12px; min-height: 16px; margin: 8px 2px 0; }
  @media (max-width: 640px) { body { padding: 14px; } }
</style>
</head>
<body>
  <h1>Foundry War <span>— Simulazione</span></h1>
  <p class="sub">
    Muovi gli slider: la curva viene ricalcolata in tempo reale con
    ${settings.runs.toLocaleString("it-IT")} battaglie per punto.
    alpha ${settings.alpha} · rush ${settings.rush ? "ON" : "OFF"} ·
    limite perdite ${settings.lossCap * 100}% · soglia schiacciante ${settings.threshold * 100}%
  </p>

  <section class="panel controls">
    <div class="control">
      <div class="label"><span>Truppe alleate</span><output id="allyTroopsOut">10</output></div>
      <input id="allyTroops" type="range" min="1" max="200" step="1" value="10">
    </div>
    <div class="control">
      <div class="label"><span>Truppe nemiche</span><output id="enemyTroopsOut">10</output></div>
      <input id="enemyTroops" type="range" min="1" max="200" step="1" value="10">
    </div>
    <div class="control">
      <div class="label"><span>CR alleati</span><output id="allyCROut">1</output></div>
      <input id="allyCR" type="range" min="0" max="20" step="0.5" value="1">
    </div>
    <div class="control">
      <div class="label"><span>CR nemici</span><output id="enemyCROut">1</output></div>
      <input id="enemyCR" type="range" min="0" max="20" step="0.5" value="1">
    </div>
    <div class="control">
      <div class="label"><span>Alpha (caos)</span><output id="alphaOut">0.30</output></div>
      <input id="alpha" type="range" min="0" max="1" step="0.05" value="0.3">
    </div>
    <div class="control">
      <div class="label"><span>Rush</span></div>
      <label class="inline"><input id="rush" type="checkbox"> perdite illimitate</label>
    </div>
  </section>

  <div class="cards">
    <div class="card panel"><div class="k">Vittoria alleati</div><div class="v" id="allyWin">—</div></div>
    <div class="card panel"><div class="k">Vittoria nemici</div><div class="v" id="enemyWin">—</div></div>
    <div class="card panel"><div class="k">Perdite medie (eff.)</div><div class="v" id="avgLosses">—</div></div>
    <div class="card panel"><div class="k">Truppe effettive</div><div class="v" id="effective">—</div></div>
    <div class="card panel"><div class="k">Esito</div><div class="v" id="decisive">—</div></div>
  </div>

  <div class="panel chart-wrap">
    <svg id="chart" viewBox="0 0 1120 520" role="img" aria-label="Curva degli esiti"></svg>
    <div class="legend">
      <span><i class="swatch" style="background:var(--prob)"></i>Probabilità (asse sinistro)</span>
      <span><i class="swatch" style="background:var(--ally)"></i>Perdite alleate (asse destro)</span>
      <span><i class="swatch" style="background:var(--enemy)"></i>Perdite nemiche (asse destro)</span>
    </div>
    <div class="tooltip" id="tooltip"></div>
    <div class="status" id="status"></div>
  </div>

  <p class="note">
    Tutto è in <b>truppe effettive</b>: truppe × XP(CR) / 50. Esempio: CR 1 = 4 truppe effettive,
    CR 2 = 9, CR 5 = 36. Asse X: truppe effettive alleate rimaste − nemiche (positivo = vantaggio alleato).
    Le linee delle perdite mostrano la perdita media <b>condizionata</b> a quell'esito.
    Passa il mouse sul grafico per i valori esatti.
  </p>

<script>
(function () {
  "use strict";
  ${engineSource}
  window.FWEngine = {
    xpForCR: xpForCR,
    simulateBattle: simulateBattle,
    simulateDistribution: simulateDistribution,
    resolveBattle: resolveBattle,
    createRng: createRng
  };
})();
</script>

<script>
(function () {
  "use strict";

  var Engine = window.FWEngine;
  var INITIAL = ${JSON.stringify({ ally: initial.ally, enemy: initial.enemy, settings })};
  var RUNS = INITIAL.settings.runs;
  var SEED = INITIAL.settings.seed;

  var state = {
    allyTroops: INITIAL.ally.troops,
    enemyTroops: INITIAL.enemy.troops,
    allyCR: INITIAL.ally.cr,
    enemyCR: INITIAL.enemy.cr,
    alpha: INITIAL.settings.alpha,
    rush: INITIAL.settings.rush
  };

  var els = {
    allyTroops: document.getElementById("allyTroops"),
    enemyTroops: document.getElementById("enemyTroops"),
    allyCR: document.getElementById("allyCR"),
    enemyCR: document.getElementById("enemyCR"),
    alpha: document.getElementById("alpha"),
    rush: document.getElementById("rush"),
    allyTroopsOut: document.getElementById("allyTroopsOut"),
    enemyTroopsOut: document.getElementById("enemyTroopsOut"),
    allyCROut: document.getElementById("allyCROut"),
    enemyCROut: document.getElementById("enemyCROut"),
    alphaOut: document.getElementById("alphaOut"),
    allyWin: document.getElementById("allyWin"),
    enemyWin: document.getElementById("enemyWin"),
    avgLosses: document.getElementById("avgLosses"),
    effectiveOut: document.getElementById("effective"),
    decisive: document.getElementById("decisive"),
    status: document.getElementById("status"),
    svg: document.getElementById("chart"),
    tooltip: document.getElementById("tooltip")
  };

  /* Sync iniziale */
  els.allyTroops.value = state.allyTroops;
  els.enemyTroops.value = state.enemyTroops;
  els.allyCR.value = state.allyCR;
  els.enemyCR.value = state.enemyCR;
  els.alpha.value = state.alpha;
  els.rush.checked = state.rush;

  function fmtCR(value) {
    return Number(value).toFixed(1).replace(/\\.0$/, "");
  }

  function effectiveTroops(troops, cr) {
    return Math.floor((troops * Engine.xpForCR(cr)) / 50);
  }

  function syncOutputs() {
    els.allyTroopsOut.textContent =
      state.allyTroops + " → " + effectiveTroops(state.allyTroops, state.allyCR) + " eff.";
    els.enemyTroopsOut.textContent =
      state.enemyTroops + " → " + effectiveTroops(state.enemyTroops, state.enemyCR) + " eff.";
    els.allyCROut.textContent = fmtCR(state.allyCR);
    els.enemyCROut.textContent = fmtCR(state.enemyCR);
    els.alphaOut.textContent = Number(state.alpha).toFixed(2);
  }

  function readState() {
    state.allyTroops = Number(els.allyTroops.value);
    state.enemyTroops = Number(els.enemyTroops.value);
    state.allyCR = Number(els.allyCR.value);
    state.enemyCR = Number(els.enemyCR.value);
    state.alpha = Number(els.alpha.value);
    state.rush = els.rush.checked;
  }

  function configFromState() {
    return {
      allies: [{ cr: state.allyCR, troops: state.allyTroops }],
      enemies: [{ cr: state.enemyCR, troops: state.enemyTroops }],
      alpha: state.alpha,
      rush: state.rush,
      lossCap: INITIAL.settings.lossCap,
      dice: INITIAL.settings.dice,
      decisiveThreshold: INITIAL.settings.threshold
    };
  }

  var NS = "http://www.w3.org/2000/svg";
  var W = 1120, H = 520;
  var M = { top: 26, right: 76, bottom: 58, left: 70 };

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    }
    return node;
  }

  function smooth(bins, get) {
    return bins.map(function (bin, i) {
      var prev = bins[i - 1] ? get(bins[i - 1]) : get(bin);
      var next = bins[i + 1] ? get(bins[i + 1]) : get(bin);
      return (prev + get(bin) * 2 + next) / 4;
    });
  }

  var lastRender = null;

  function render(distribution) {
    var svg = els.svg;
    svg.replaceChildren();

    var bins = distribution.bins;
    if (!bins.length) return;

    var xValues = bins.map(function (b) { return b.value; });
    var xMin = Math.min.apply(null, xValues.concat([0])) - 1;
    var xMax = Math.max.apply(null, xValues.concat([0])) + 1;

    var probValues = smooth(bins, function (b) { return b.probability; });
    var lossValues = bins.map(function (b) {
      return Math.max(b.avgAllyLosses, b.avgEnemyLosses);
    });

    var probMax = Math.max.apply(null, probValues.concat([0.01])) * 1.18;
    var lossMax = Math.max.apply(null, lossValues.concat([1])) * 1.18;

    function xScale(v) {
      return M.left + ((v - xMin) / (xMax - xMin || 1)) * (W - M.left - M.right);
    }
    function yProb(p) {
      return H - M.bottom - (p / probMax) * (H - M.top - M.bottom);
    }
    function yLoss(l) {
      return H - M.bottom - (l / lossMax) * (H - M.top - M.bottom);
    }

    /* Griglia + asse sinistro (probabilità) */
    var grid = el("g", { "class": "grid" });
    for (var i = 0; i <= 5; i++) {
      var p = (probMax / 5) * i;
      var y = yProb(p);
      grid.appendChild(el("line", { x1: M.left, x2: W - M.right, y1: y, y2: y }));
      var lp = el("text", { x: M.left - 10, y: y + 4, "text-anchor": "end" });
      lp.textContent = (p * 100).toFixed(1) + "%";
      grid.appendChild(lp);

      var ll = el("text", { x: W - M.right + 10, y: y + 4, "text-anchor": "start" });
      ll.textContent = ((lossMax / 5) * i).toFixed(0);
      grid.appendChild(ll);
    }
    svg.appendChild(grid);

    /* Titoli assi */
    var leftTitle = el("text", { x: M.left - 10, y: M.top - 8, "text-anchor": "start", "class": "axis" });
    leftTitle.textContent = "probabilità";
    svg.appendChild(leftTitle);

    var rightTitle = el("text", { x: W - M.right + 10, y: M.top - 8, "text-anchor": "start", "class": "axis" });
    rightTitle.textContent = "perdite medie";
    svg.appendChild(rightTitle);

    /* Asse X */
    var axis = el("g", { "class": "axis" });
    var stepX = Math.max(1, Math.round((xMax - xMin) / 14));
    for (var v = Math.ceil(xMin); v <= xMax; v += stepX) {
      var tx = el("text", { x: xScale(v), y: H - M.bottom + 20, "text-anchor": "middle" });
      tx.textContent = v;
      axis.appendChild(tx);
    }
    var xTitle = el("text", {
      x: (M.left + W - M.right) / 2,
      y: H - 14,
      "text-anchor": "middle"
    });
    xTitle.textContent = "vantaggio truppe (alleati − nemici)";
    axis.appendChild(xTitle);
    svg.appendChild(axis);

    /* Zero */
    svg.appendChild(el("line", {
      "class": "zero",
      x1: xScale(0), x2: xScale(0), y1: M.top, y2: H - M.bottom
    }));

    /* Probabilità: area + linea */
    var probPoints = bins.map(function (bin, idx) {
      return [xScale(bin.value), yProb(probValues[idx])];
    });

    if (probPoints.length) {
      var line = probPoints.map(function (pt, idx) {
        return (idx ? "L" : "M") + pt[0] + "," + pt[1];
      }).join(" ");
      var area = line +
        " L" + probPoints[probPoints.length - 1][0] + "," + (H - M.bottom) +
        " L" + probPoints[0][0] + "," + (H - M.bottom) + " Z";

      svg.appendChild(el("path", { d: area, fill: "var(--prob)", opacity: "0.10" }));
      svg.appendChild(el("path", {
        d: line, fill: "none", stroke: "var(--prob)",
        "stroke-width": "2.4", "stroke-linejoin": "round", "stroke-linecap": "round"
      }));
    }

    /* Perdite: due linee sull'asse destro */
    function lossLine(key, color) {
      var pts = bins.map(function (bin) {
        return [xScale(bin.value), yLoss(bin[key])];
      });
      var d = pts.map(function (pt, idx) {
        return (idx ? "L" : "M") + pt[0] + "," + pt[1];
      }).join(" ");
      svg.appendChild(el("path", {
        d: d, fill: "none", stroke: color,
        "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round",
        "stroke-dasharray": "1 0"
      }));
    }

    lossLine("avgAllyLosses", "var(--ally)");
    lossLine("avgEnemyLosses", "var(--enemy)");

    /* Hover */
    var hoverLine = el("line", {
      "class": "hover", x1: 0, x2: 0, y1: M.top, y2: H - M.bottom, opacity: "0"
    });
    svg.appendChild(hoverLine);

    var chartWrap = svg.parentElement;

    function binAt(value) {
      for (var k = 0; k < bins.length; k++) {
        if (bins[k].value === value) return bins[k];
      }
      return null;
    }

    svg.onmousemove = function (event) {
      var rect = svg.getBoundingClientRect();
      var scale = W / rect.width;
      var svgX = (event.clientX - rect.left) * scale;
      var value = xMin + ((svgX - M.left) / (W - M.left - M.right)) * (xMax - xMin);
      var hovered = Math.round(value);

      hoverLine.setAttribute("x1", xScale(hovered));
      hoverLine.setAttribute("x2", xScale(hovered));
      hoverLine.setAttribute("opacity", "1");

      var bin = binAt(hovered);
      var html =
        '<div style="font-weight:700;margin-bottom:6px">Vantaggio ' + hovered + '</div>';

      if (!bin) {
        html += '<div class="row"><span>Probabilità</span><b>0.00%</b></div>';
      } else {
        html +=
          '<div class="row"><span>Probabilità</span><b>' + (bin.probability * 100).toFixed(2) + '%</b></div>' +
          '<div class="row"><span>Perdite alleate</span><b style="color:var(--ally)">' + bin.avgAllyLosses.toFixed(1) + '</b></div>' +
          '<div class="row"><span>Perdite nemiche</span><b style="color:var(--enemy)">' + bin.avgEnemyLosses.toFixed(1) + '</b></div>' +
          '<hr>' +
          '<div class="row"><span>Truppe alleate</span><b>' + bin.avgAllySurvivors.toFixed(1) + '</b></div>' +
          '<div class="row"><span>Truppe nemiche</span><b>' + bin.avgEnemySurvivors.toFixed(1) + '</b></div>';
      }

      els.tooltip.innerHTML = html;
      els.tooltip.style.opacity = "1";
      var wrapRect = chartWrap.getBoundingClientRect();
      var left = event.clientX - wrapRect.left + 18;
      var top = event.clientY - wrapRect.top;
      els.tooltip.style.left = Math.min(left, chartWrap.clientWidth - 340) + "px";
      els.tooltip.style.top = top + "px";
    };

    svg.onmouseleave = function () {
      hoverLine.setAttribute("opacity", "0");
      els.tooltip.style.opacity = "0";
    };

    lastRender = distribution;
  }

  function updateCards(distribution) {
    var avg = distribution.average;
    var allyEff = effectiveTroops(state.allyTroops, state.allyCR);
    var enemyEff = effectiveTroops(state.enemyTroops, state.enemyCR);

    els.allyWin.textContent = (distribution.allyWinRate * 100).toFixed(1) + "%";
    els.enemyWin.textContent = (distribution.enemyWinRate * 100).toFixed(1) + "%";
    els.effectiveOut.innerHTML =
      '<span style="color:var(--ally)" title="alleati">A ' + allyEff.toLocaleString("it-IT") + '</span>' +
      ' <small>/</small> ' +
      '<span style="color:var(--enemy)" title="nemici">N ' + enemyEff.toLocaleString("it-IT") + '</span>';
    els.avgLosses.innerHTML = avg
      ? '<span style="color:var(--ally)" title="alleati">A ' + avg.allies.losses.toFixed(1) + '</span>' +
        ' <small>/</small> ' +
        '<span style="color:var(--enemy)" title="nemici">N ' + avg.enemies.losses.toFixed(1) + '</span>'
      : "—";

    if (distribution.decisive) {
      els.decisive.innerHTML =
        '<span class="badge">' +
        (distribution.decisive === "ally" ? "Schiacciante alleati" : "Schiacciante nemici") +
        '</span>';
    } else {
      els.decisive.textContent = "—";
    }
  }

  function recompute() {
    var distribution = Engine.simulateDistribution(configFromState(), RUNS, SEED);
    updateCards(distribution);
    render(distribution);
    els.status.textContent =
      "Aggiornato: " + state.allyTroops + " vs " + state.enemyTroops +
      " truppe · " + RUNS.toLocaleString("it-IT") + " battaglie";
  }

  var timer = null;

  function schedule() {
    readState();
    syncOutputs();
    els.status.textContent = "Calcolo…";
    clearTimeout(timer);
    timer = setTimeout(recompute, 90);
  }

  ["allyTroops", "enemyTroops", "allyCR", "enemyCR", "alpha"].forEach(function (key) {
    els[key].addEventListener("input", schedule);
  });
  els.rush.addEventListener("change", schedule);

  syncOutputs();
  recompute();
})();
</script>
</body>
</html>`;
}
