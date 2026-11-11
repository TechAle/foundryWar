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
  DEFAULT_BATTLE_SIGMA,
  DEFAULT_DICE,
  DEFAULT_FORCE_COMPRESSION,
  DEFAULT_LOSS_CAP,
  DEFAULT_TOTAL_THRESHOLD,
  MIN_XP,
  isTotalVictory,
  simulateDistribution,
  totalVictoryProbability,
  totalVictoryRates,
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
const battleSigma = Number(args.battleSigma ?? DEFAULT_BATTLE_SIGMA);
const compression = Number(args.compression ?? DEFAULT_FORCE_COMPRESSION);
const rush = String(args.rush ?? "false") === "true";
const lossCap = Number(args.lossCap ?? DEFAULT_LOSS_CAP);
const totalThreshold = Number(args.totalThreshold ?? DEFAULT_TOTAL_THRESHOLD);
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
  battleSigma,
  compression,
  rush,
  lossCap,
  totalThreshold,
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
  battleSigma,
  forceCompression: compression,
  rush,
  lossCap,
  dice,
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
  `alpha=${alpha}  swing=${battleSigma}  compressione=${compression}  rush=${rush}  lossCap=${lossCap}  dice=${dice}  ` +
    `vittoria totale >= ${(totalThreshold * 100).toFixed(0)}% del vincitore\n`,
);
console.log(`Vittorie alleati: ${pct(distribution.allyWinRate)}`);
console.log(`Vittorie nemici:  ${pct(distribution.enemyWinRate)}`);
console.log(`Pari:             ${pct(distribution.drawRate)}`);
console.log(
  `Perdite medie:    alleati ${num(distribution.average?.allies.losses)} · nemici ${num(distribution.average?.enemies.losses)}`,
);
const totalRates = totalVictoryRates(distribution, totalThreshold);
console.log(
  `Vittoria totale:  alleati ${pct(totalRates.ally)} · nemici ${pct(totalRates.enemy)}`,
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
  .help {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    margin-left: 4px;
    border: 1px solid var(--border);
    border-radius: 50%;
    color: var(--muted);
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    vertical-align: middle;
    cursor: help;
    user-select: none;
  }
  .help:hover,
  .help:focus {
    color: var(--accent);
    border-color: var(--accent);
    outline: none;
  }
  .help-tip {
    position: fixed;
    display: none;
    max-width: 300px;
    padding: 10px 12px;
    background: #101217f5;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 12px;
    line-height: 1.4;
    box-shadow: 0 12px 30px #0009;
    z-index: 100;
    pointer-events: none;
  }
  .help-tip.visible { display: block; }
  .roll-btn {
    padding: 8px 12px;
    background: rgba(240,198,116,.14);
    border: 1px solid rgba(240,198,116,.55);
    color: var(--accent);
    border-radius: 8px;
    font-weight: 700;
    font-size: 14px;
    cursor: pointer;
  }
  .roll-btn:hover { background: rgba(240,198,116,.26); }
  .roll-result {
    margin: 0 0 14px;
    padding: 12px 14px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--muted);
    font-size: 13px;
  }
  .roll-result.total {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px rgba(240,198,116,.25);
  }
  .roll-head { color: var(--text); margin-bottom: 8px; }
  .roll-head b { color: var(--accent); }
  .roll-grid {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 3px 18px;
  }
  .roll-grid b { color: var(--text); font-weight: 600; }
  .zone-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .4px;
    text-transform: uppercase;
  }
  .marker-label {
    font-size: 11px;
    font-weight: 700;
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
    alpha ${settings.alpha} · swing ${settings.battleSigma} ·
    compressione ${settings.compression} · rush ${settings.rush ? "ON" : "OFF"} ·
    limite perdite ${settings.lossCap * 100}% ·
    vittoria totale ≥ ${(settings.totalThreshold * 100).toFixed(0)}% del vincitore
  </p>

  <section class="panel controls">
    <div class="control">
      <div class="label">
        <span>Truppe alleate
          <span class="help" tabindex="0" data-help="Numero di truppe (HP) del battaglione. Vengono convertite in truppe effettive: truppe × XP(CR) / 50.">?</span>
        </span>
        <output id="allyTroopsOut">10</output>
      </div>
      <input id="allyTroops" type="range" min="1" max="200" step="1" value="10">
    </div>
    <div class="control">
      <div class="label">
        <span>Truppe nemiche
          <span class="help" tabindex="0" data-help="Numero di truppe (HP) del battaglione. Vengono convertite in truppe effettive: truppe × XP(CR) / 50.">?</span>
        </span>
        <output id="enemyTroopsOut">10</output>
      </div>
      <input id="enemyTroops" type="range" min="1" max="200" step="1" value="10">
    </div>
    <div class="control">
      <div class="label">
        <span>CR alleati
          <span class="help" tabindex="0" data-help="Challenge Rating per truppa. Determina l'XP e quindi le truppe effettive: CR 1 = 4, CR 2 = 9, CR 5 = 36 per truppa.">?</span>
        </span>
        <output id="allyCROut">1</output>
      </div>
      <input id="allyCR" type="range" min="0" max="20" step="0.5" value="1">
    </div>
    <div class="control">
      <div class="label">
        <span>CR nemici
          <span class="help" tabindex="0" data-help="Challenge Rating per truppa. Determina l'XP e quindi le truppe effettive: CR 1 = 4, CR 2 = 9, CR 5 = 36 per truppa.">?</span>
        </span>
        <output id="enemyCROut">1</output>
      </div>
      <input id="enemyCR" type="range" min="0" max="20" step="0.5" value="1">
    </div>
    <div class="control">
      <div class="label">
        <span>Alpha (caos)
          <span class="help" tabindex="0" data-help="Caos per ogni singolo confronto. 0 = deterministico, 0.3 = default, 1 = molto casuale. Cambia le perdite, non chi vince.">?</span>
        </span>
        <output id="alphaOut">0.30</output>
      </div>
      <input id="alpha" type="range" min="0" max="1" step="0.05" value="0.3">
    </div>
    <div class="control">
      <div class="label">
        <span>Swing (imprevisto)
          <span class="help" tabindex="0" data-help="Imprevisto fisso per tutta la battaglia (morale, terreno, fortuna). Più è alto, meno contano i numeri. Default 0.12: 2:1 ≈ 75/25, 5:1 ≈ 93/7. CR1 vs CR2 ≈ 78/22, CR1 vs CR3 ≈ 88/12.">?</span>
        </span>
        <output id="swingOut">0.12</output>
      </div>
      <input id="swing" type="range" min="0" max="1" step="0.01" value="0.12">
    </div>
    <div class="control">
      <div class="label">
        <span>Soglia vittoria totale
          <span class="help" tabindex="0" data-help="Il margine del vincitore deve raggiungere questa percentuale delle SUE truppe iniziali. Default 85%: 10:1 dà circa 70% di vittorie totali.">?</span>
        </span>
        <output id="totalThresholdOut">85%</output>
      </div>
      <input id="totalThreshold" type="range" min="0.5" max="1" step="0.01" value="0.85">
    </div>
    <div class="control">
      <div class="label">
        <span>Compressione forze
          <span class="help" tabindex="0" data-help="Comprime il vantaggio numerico: più è alta, più truppe servono per ottenere lo stesso vantaggio. 0 = nessuna compressione, 0.5 rende un 10:1 circa 84/16.">?</span>
        </span>
        <output id="compressionOut">0.00</output>
      </div>
      <input id="compression" type="range" min="0" max="1" step="0.01" value="0">
    </div>
    <div class="control">
      <div class="label">
        <span>Rush
          <span class="help" tabindex="0" data-help="Se attivo, le perdite non sono limitate al 50%: si combatte fino allo sterminio di un lato.">?</span>
        </span>
      </div>
      <label class="inline"><input id="rush" type="checkbox"> perdite illimitate</label>
    </div>
    <div class="control">
      <div class="label">
        <span>Tiro dell'esito
          <span class="help" tabindex="0" data-help="Estrae un esito pesato sulla curva (percentile 0-100) e disegna la linea verticale dove è caduto.">?</span>
        </span>
      </div>
      <button id="rollBtn" class="roll-btn" type="button">
        <i>🎲</i> Tira 0–100
      </button>
    </div>
  </section>

  <div class="cards">
    <div class="card panel">
      <div class="k">Vittoria alleati
        <span class="help" tabindex="0" data-help="Probabilità che il tiro finisca in un esito vinto dagli alleati.">?</span>
      </div>
      <div class="v" id="allyWin">—</div>
    </div>
    <div class="card panel">
      <div class="k">Vittoria nemici
        <span class="help" tabindex="0" data-help="Probabilità che il tiro finisca in un esito vinto dai nemici.">?</span>
      </div>
      <div class="v" id="enemyWin">—</div>
    </div>
    <div class="card panel">
      <div class="k">Perdite medie (eff.)
        <span class="help" tabindex="0" data-help="Perdite medie in truppe effettive su tutte le battaglie simulate.">?</span>
      </div>
      <div class="v" id="avgLosses">—</div>
    </div>
    <div class="card panel">
      <div class="k">Truppe effettive
        <span class="help" tabindex="0" data-help="truppe × XP(CR) / 50. CR 1 = 4 per truppa, CR 2 = 9, CR 5 = 36.">?</span>
      </div>
      <div class="v" id="effective">—</div>
    </div>
    <div class="card panel">
      <div class="k">Vittoria totale
        <span class="help" tabindex="0" data-help="Probabilità che il margine raggiunga la soglia del vincitore. A = alleati, N = nemici.">?</span>
      </div>
      <div class="v" id="totalChance">—</div>
      <div class="k" id="totalThresholdLabel" style="margin-top:4px">≥ ${(settings.totalThreshold * 100).toFixed(0)}% del vincitore</div>
    </div>
  </div>

  <div class="roll-result" id="rollResult">
    Premi <b>Tira 0–100</b> per estrarre un esito dalla curva.
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
    La <b>zona dorata a destra</b> è la vittoria totale alleati; la <b>zona rossa a sinistra</b>
    è la vittoria totale nemici (sconfitta totale alleati). Soglia: margine ≥ 85% delle truppe
    iniziali <b>del vincitore</b>. <b>Tira 0–100</b> estrae un esito dalla curva e disegna la linea
    verticale dove è uscito (dorata o rossa se è vittoria totale).
    <b>Swing</b> è l'imprevisto di battaglia: a 0 i numeri dominano; col default 0.12 un 2:1
    vale circa 75/25 e un 5:1 circa 93/7. <b>Compressione</b>: più è alta, più truppe
    servono per ottenere lo stesso vantaggio (0 = off; 0.5 rende un 10:1 circa 85/15).
    Passa il mouse sul grafico per i valori esatti.
  </p>

<div class="help-tip" id="helpTip"></div>

<script>
(function () {
  "use strict";
  ${engineSource}
  window.FWEngine = {
    xpForCR: xpForCR,
    simulateBattle: simulateBattle,
    simulateDistribution: simulateDistribution,
    resolveBattle: resolveBattle,
    createRng: createRng,
    effectiveTroops: effectiveTroops,
    isTotalVictory: isTotalVictory,
    totalVictoryProbability: totalVictoryProbability,
    totalVictoryRates: totalVictoryRates
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
  var THRESHOLD = INITIAL.settings.totalThreshold;
  var lastDistribution = null;
  var lastRoll = null;

  var state = {
    allyTroops: INITIAL.ally.troops,
    enemyTroops: INITIAL.enemy.troops,
    allyCR: INITIAL.ally.cr,
    enemyCR: INITIAL.enemy.cr,
    alpha: INITIAL.settings.alpha,
    swing: INITIAL.settings.battleSigma,
    totalThreshold: INITIAL.settings.totalThreshold,
    compression: INITIAL.settings.compression,
    rush: INITIAL.settings.rush
  };

  var els = {
    allyTroops: document.getElementById("allyTroops"),
    enemyTroops: document.getElementById("enemyTroops"),
    allyCR: document.getElementById("allyCR"),
    enemyCR: document.getElementById("enemyCR"),
    alpha: document.getElementById("alpha"),
    swing: document.getElementById("swing"),
    totalThreshold: document.getElementById("totalThreshold"),
    compression: document.getElementById("compression"),
    rush: document.getElementById("rush"),
    allyTroopsOut: document.getElementById("allyTroopsOut"),
    enemyTroopsOut: document.getElementById("enemyTroopsOut"),
    allyCROut: document.getElementById("allyCROut"),
    enemyCROut: document.getElementById("enemyCROut"),
    alphaOut: document.getElementById("alphaOut"),
    swingOut: document.getElementById("swingOut"),
    totalThresholdOut: document.getElementById("totalThresholdOut"),
    totalThresholdLabel: document.getElementById("totalThresholdLabel"),
    compressionOut: document.getElementById("compressionOut"),
    allyWin: document.getElementById("allyWin"),
    enemyWin: document.getElementById("enemyWin"),
    avgLosses: document.getElementById("avgLosses"),
    effectiveOut: document.getElementById("effective"),
    totalChance: document.getElementById("totalChance"),
    rollBtn: document.getElementById("rollBtn"),
    rollResult: document.getElementById("rollResult"),
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
  els.swing.value = state.swing;
  els.totalThreshold.value = state.totalThreshold;
  els.compression.value = state.compression;
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
    els.swingOut.textContent = Number(state.swing).toFixed(2);
    els.totalThresholdOut.textContent = Math.round(state.totalThreshold * 100) + "%";
    els.compressionOut.textContent = Number(state.compression).toFixed(2);
  }

  function readState() {
    state.allyTroops = Number(els.allyTroops.value);
    state.enemyTroops = Number(els.enemyTroops.value);
    state.allyCR = Number(els.allyCR.value);
    state.enemyCR = Number(els.enemyCR.value);
    state.alpha = Number(els.alpha.value);
    state.swing = Number(els.swing.value);
    state.totalThreshold = Number(els.totalThreshold.value);
    THRESHOLD = state.totalThreshold;
    state.compression = Number(els.compression.value);
    state.rush = els.rush.checked;
  }

  function configFromState() {
    return {
      allies: [{ cr: state.allyCR, troops: state.allyTroops }],
      enemies: [{ cr: state.enemyCR, troops: state.enemyTroops }],
      alpha: state.alpha,
      battleSigma: state.swing,
      forceCompression: state.compression,
      rush: state.rush,
      lossCap: INITIAL.settings.lossCap,
      dice: INITIAL.settings.dice
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

  /*
   * KDE gaussiana: sparpaglia la probabilità di ogni bin sui margini vicini.
   * Smussa molto di più della media a 3 punti e riempie anche i "buchi"
   * tra un margine intero e l'altro.
   */
  function smoothProbabilities(bins, min, max) {
    var range = Math.max(1, max - min);
    var bandwidth = Math.max(2, range * 0.05);
    var radius = Math.ceil(bandwidth * 3);
    var grid = new Map();

    for (var v = Math.ceil(min); v <= Math.floor(max); v++) grid.set(v, 0);

    bins.forEach(function (bin) {
      var weights = [];
      var weightSum = 0;

      for (var d = -radius; d <= radius; d++) {
        var value = bin.value + d;
        if (!grid.has(value)) continue;
        var weight = Math.exp(-(d * d) / (2 * bandwidth * bandwidth));
        weights.push([value, weight]);
        weightSum += weight;
      }

      if (!weightSum) return;

      weights.forEach(function (pair) {
        grid.set(pair[0], grid.get(pair[0]) + (bin.probability * pair[1]) / weightSum);
      });
    });

    return Array.from(grid.entries())
      .sort(function (a, b) { return a[0] - b[0]; })
      .map(function (pair) {
        return { value: pair[0], probability: pair[1] };
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

    var smoothed = smoothProbabilities(bins, xMin, xMax);
    var probValues = smoothed.map(function (point) { return point.probability; });
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

    /* Zone e soglie di vittoria totale (base: truppe del vincitore) */
    var posThreshold = THRESHOLD * distribution.alliesInitial;
    var negThreshold = -THRESHOLD * distribution.enemiesInitial;

    function fmtThreshold(value) {
      return (value >= 0 ? "+" : "") +
        value.toLocaleString("it-IT", { maximumFractionDigits: 1 });
    }

    function drawTotalZone(from, to, color) {
      var x1 = Math.max(M.left, xScale(Math.max(Math.min(from, to), xMin)));
      var x2 = Math.min(W - M.right, xScale(Math.min(Math.max(from, to), xMax)));
      if (x2 - x1 < 2) return;

      svg.appendChild(el("rect", {
        x: x1, y: M.top, width: x2 - x1, height: H - M.top - M.bottom,
        fill: color, opacity: "0.08"
      }));
    }

    if (posThreshold < xMax) {
      drawTotalZone(Math.max(posThreshold, xMin), xMax, "#f0c674");
    }
    if (negThreshold > xMin) {
      drawTotalZone(xMin, Math.min(negThreshold, xMax), "#ff6b6b");
    }

    function drawThreshold(boundary, color, text, defaultStart) {
      if (boundary <= xMin || boundary >= xMax) return;

      var bx = xScale(boundary);
      svg.appendChild(el("line", {
        x1: bx, x2: bx, y1: M.top, y2: H - M.bottom,
        stroke: color, "stroke-width": "1",
        "stroke-dasharray": "4 4", opacity: "0.7"
      }));

      var anchor = defaultStart ? "start" : "end";
      var tx = bx + (defaultStart ? 6 : -6);

      if (anchor === "start" && tx > W - M.right - 190) {
        anchor = "end";
        tx = bx - 6;
      } else if (anchor === "end" && tx < M.left + 190) {
        anchor = "start";
        tx = bx + 6;
      }

      var label = el("text", {
        x: tx, y: M.top + 14,
        "text-anchor": anchor, "class": "zone-label", fill: color
      });
      label.textContent = text;
      svg.appendChild(label);
    }

    drawThreshold(
      posThreshold,
      "#f0c674",
      "Vittoria totale alleati ≥ " + fmtThreshold(posThreshold),
      true,
    );
    drawThreshold(
      negThreshold,
      "#ff6b6b",
      "Vittoria totale nemici ≤ " + fmtThreshold(negThreshold),
      false,
    );

    /* Probabilità: area + linea */
    var probPoints = smoothed.map(function (point) {
      return [xScale(point.value), yProb(point.probability)];
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

    /* Marker del tiro */
    if (lastRoll) {
      var isTotalRoll = Engine.isTotalVictory(
        lastRoll.bin.value,
        distribution.alliesInitial,
        distribution.enemiesInitial,
        THRESHOLD
      );
      var totalSide = isTotalRoll ? (lastRoll.bin.value > 0 ? "ally" : "enemy") : null;
      var markerColor =
        totalSide === "ally" ? "#f0c674" : totalSide === "enemy" ? "#ff6b6b" : "#ffffff";

      var markerX = xScale(lastRoll.bin.value);
      svg.appendChild(el("line", {
        x1: markerX, x2: markerX, y1: M.top, y2: H - M.bottom,
        stroke: markerColor,
        "stroke-width": "2", "stroke-dasharray": "3 3"
      }));
      var markerLabel = el("text", {
        x: Math.min(markerX + 5, W - M.right - 70),
        y: M.top + 12,
        "class": "marker-label",
        fill: markerColor
      });
      markerLabel.textContent = "Tiro " + (lastRoll.r * 100).toFixed(1);
      svg.appendChild(markerLabel);
    }

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

    var rates = Engine.totalVictoryRates(distribution, THRESHOLD);
    els.totalThresholdLabel.textContent =
      "≥ " + Math.round(THRESHOLD * 100) + "% del vincitore";
    els.totalChance.innerHTML =
      '<span style="color:var(--ally)" title="vittoria totale alleati">A ' +
        (rates.ally * 100).toFixed(1) + '%</span>' +
      ' <small>/</small> ' +
      '<span style="color:var(--enemy)" title="vittoria totale nemici">N ' +
        (rates.enemy * 100).toFixed(1) + '%</span>';
  }

  function recompute() {
    var distribution = Engine.simulateDistribution(configFromState(), RUNS, SEED);
    lastDistribution = distribution;
    updateCards(distribution);
    render(distribution);
    els.status.textContent =
      "Aggiornato: " + state.allyTroops + " vs " + state.enemyTroops +
      " truppe · " + RUNS.toLocaleString("it-IT") + " battaglie";
  }

  function doRoll() {
    if (!lastDistribution || !lastDistribution.bins.length) return;

    var r = Math.random();
    var acc = 0;
    var bin = lastDistribution.bins[lastDistribution.bins.length - 1];

    for (var i = 0; i < lastDistribution.bins.length; i++) {
      acc += lastDistribution.bins[i].probability;
      if (r <= acc) {
        bin = lastDistribution.bins[i];
        break;
      }
    }

    lastRoll = { r: r, bin: bin };
    render(lastDistribution);
    showRollResult(lastDistribution, lastRoll);
  }

  function showRollResult(distribution, roll) {
    var bin = roll.bin;
    var margin = bin.value;
    var winner = margin > 0 ? "Alleati" : margin < 0 ? "Nemici" : "Pareggio";
    var total = Engine.isTotalVictory(
      margin,
      distribution.alliesInitial,
      distribution.enemiesInitial,
      THRESHOLD
    );

    els.rollResult.className = "roll-result" + (total ? " total" : "");
    els.rollResult.innerHTML =
      '<div class="roll-head">Tiro <b>' + (roll.r * 100).toFixed(1) + '</b> / 100 → ' +
        'margine <b>' + (margin > 0 ? "+" : "") + margin.toLocaleString("it-IT") + '</b></div>' +
      '<div class="roll-grid">' +
        '<span>Esito</span><b>' + winner + '</b>' +
        '<span>Perdite alleate</span><b style="color:var(--ally)">' + bin.avgAllyLosses.toFixed(1) + '</b>' +
        '<span>Perdite nemiche</span><b style="color:var(--enemy)">' + bin.avgEnemyLosses.toFixed(1) + '</b>' +
        '<span>Probabilità di questo esito</span><b>' + (bin.probability * 100).toFixed(2) + '%</b>' +
        '<span>Vittoria totale</span><b style="color:' +
          (total ? (margin > 0 ? "var(--accent)" : "var(--enemy)") : "var(--text)") + '">' +
          (total ? "SÌ (" + (margin > 0 ? "alleati" : "nemici") + ")" : "NO") + '</b>' +
      '</div>';
  }

  var timer = null;

  function schedule() {
    readState();
    syncOutputs();
    els.status.textContent = "Calcolo…";
    lastRoll = null;
    els.rollResult.className = "roll-result";
    els.rollResult.innerHTML = "Premi <b>Tira 0–100</b> per estrarre un esito dalla curva.";
    clearTimeout(timer);
    timer = setTimeout(recompute, 90);
  }

  ["allyTroops", "enemyTroops", "allyCR", "enemyCR", "alpha", "swing", "totalThreshold", "compression"].forEach(function (key) {
    els[key].addEventListener("input", schedule);
  });
  els.rush.addEventListener("change", schedule);
  els.rollBtn.addEventListener("click", doRoll);

  /* Tooltip dei "?" */
  var helpTip = document.getElementById("helpTip");

  function showHelp(target) {
    var rect = target.getBoundingClientRect();
    var width = Math.min(300, window.innerWidth - 24);
    helpTip.textContent = target.dataset.help || "";
    helpTip.style.maxWidth = width + "px";
    helpTip.style.left =
      Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) + "px";
    helpTip.style.top = rect.bottom + 8 + "px";
    helpTip.classList.add("visible");
  }

  function hideHelp() {
    helpTip.classList.remove("visible");
  }

  document.addEventListener("mouseover", function (event) {
    var target = event.target.closest && event.target.closest(".help");
    if (target) showHelp(target);
  });
  document.addEventListener("mouseout", function (event) {
    var target = event.target.closest && event.target.closest(".help");
    if (target) hideHelp();
  });
  document.addEventListener("focusin", function (event) {
    var target = event.target.closest && event.target.closest(".help");
    if (target) showHelp(target);
  });
  document.addEventListener("focusout", function (event) {
    var target = event.target.closest && event.target.closest(".help");
    if (target) hideHelp();
  });
  document.addEventListener("click", function (event) {
    var target = event.target.closest && event.target.closest(".help");
    if (!target) return;
    event.preventDefault();
    if (helpTip.classList.contains("visible")) hideHelp();
    else showHelp(target);
  });
  window.addEventListener("scroll", hideHelp, { passive: true });
  window.addEventListener("resize", hideHelp);

  syncOutputs();
  recompute();
})();
</script>
</body>
</html>`;
}
