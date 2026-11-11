/**
 * Foundry War - pannello di guerra condiviso.
 *
 * - Stato salvato in una world setting (`warState`), quindi condiviso tra tutti
 *   i client. I giocatori senza permessi di modifica passano da socket al GM.
 * - Voci aggiunte/rimosse dal Token HUD (click destro su un token).
 * - CR effettivo calcolato solo qui: comandante (+1 CR agli alleati dello stesso
 *   schieramento) e arcieri (+2 CR a se stessi). Le schede non vengono toccate.
 */

import {
  DEFAULT_ALPHA,
  DEFAULT_BATTLE_SIGMA,
  DEFAULT_FORCE_COMPRESSION,
  DEFAULT_TOTAL_THRESHOLD,
  distributeLosses,
  isTotalVictory,
  simulateDistribution,
  totalVictoryRates,
  xpForCR,
} from "./battle-engine.js";

const MODULE_ID = "foundry-war";
const STATE_KEY = "warState";

// Stance globali per schieramento: bonus CR applicato a tutte le unità.
const STANCES = ["none", "flank", "encircle"];
const STANCE_CR = { none: 0, flank: 1, encircle: 2 };

/* -------------------------------------------------------------------------- */
/* Stato condiviso                                                            */
/* -------------------------------------------------------------------------- */

export function getWarState() {
  const state = game.settings.get(MODULE_ID, STATE_KEY);

  return {
    entries: { ...(state?.entries ?? {}) },
    stances: {
      ally: STANCES.includes(state?.stances?.ally) ? state.stances.ally : "none",
      enemy: STANCES.includes(state?.stances?.enemy) ? state.stances.enemy : "none",
    },
    rush: Boolean(state?.rush),
    battle: {
      active: Boolean(state?.battle?.active),
      roll: state?.battle?.roll
        ? {
            r: Number(state.battle.roll.r) || 0,
            value: Number(state.battle.roll.value) || 0,
            seed: Number(state.battle.roll.seed) || 0,
            signature: String(state.battle.roll.signature ?? ""),
          }
        : null,
    },
  };
}

/**
 * Salva lo stato. Il GM scrive direttamente la world setting; gli altri client
 * inviano la richiesta via socket al GM, che la applica per tutti.
 */
export async function commitWarState(next) {
  const payload = {
    entries: next?.entries ?? {},
    stances: {
      ally: STANCES.includes(next?.stances?.ally) ? next.stances.ally : "none",
      enemy: STANCES.includes(next?.stances?.enemy) ? next.stances.enemy : "none",
    },
    rush: Boolean(next?.rush),
    battle: {
      active: Boolean(next?.battle?.active),
      roll: next?.battle?.roll
        ? {
            r: Number(next.battle.roll.r) || 0,
            value: Number(next.battle.roll.value) || 0,
            seed: Number(next.battle.roll.seed) || 0,
            signature: String(next.battle.roll.signature ?? ""),
          }
        : null,
    },
  };

  if (game.user.isGM) {
    return game.settings.set(MODULE_ID, STATE_KEY, payload);
  }

  game.socket.emit(`module.${MODULE_ID}`, { type: "setWarState", state: payload });
  return null;
}

export function isTokenInWar(token) {
  const id = token?.document?.uuid;
  return Boolean(id && getWarState().entries[id]);
}

function createEntry(token) {
  const doc = token.document;
  return {
    tokenUuid: doc.uuid,
    actorUuid: token.actor?.uuid ?? "",
    name: doc.name ?? token.actor?.name ?? "?",
    img: doc.texture?.src ?? token.actor?.img ?? "icons/svg/mystery-man.svg",
    effects: { inspiration: true, ranged: true },
  };
}

/** Aggiunge o rimuove i token indicati dal pannello. */
export async function toggleTokensInWar(tokens) {
  const list = (tokens ?? []).filter((token) => token?.document?.uuid);
  if (!list.length) return;

  const state = getWarState();
  const allPresent = list.every((token) => state.entries[token.document.uuid]);
  const next = {
    ...state,
    entries: { ...state.entries },
    battle: { ...state.battle, roll: null },
  };

  for (const token of list) {
    const id = token.document.uuid;
    if (allPresent) delete next.entries[id];
    else if (!next.entries[id]) next.entries[id] = createEntry(token);
  }

  await commitWarState(next);

  const key = allPresent ? "FOUNDRY-WAR.notifications.removed" : "FOUNDRY-WAR.notifications.added";
  ui.notifications.info(game.i18n.format(key, { count: list.length }));
}

/* -------------------------------------------------------------------------- */
/* Lettura dati dagli attori                                                  */
/* -------------------------------------------------------------------------- */

async function safeFromUuid(uuid) {
  if (!uuid) return null;
  try {
    return await foundry.utils.fromUuid(uuid);
  } catch {
    return null;
  }
}

function toNumber(value) {
  if (value == null) return null;
  if (typeof value === "object") {
    value = value.value ?? value.cr ?? value.total ?? value.current ?? null;
  }
  if (typeof value === "string" && value.includes("/")) {
    const [a, b] = value.split("/").map(Number);
    return b ? a / b : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getCR(actor) {
  const system = actor?.system ?? {};
  const candidates = [
    system.details?.cr,
    system.cr,
    system.attributes?.cr,
    system.details?.level,
    system.attributes?.level,
    system.level,
  ];

  for (const candidate of candidates) {
    const value = toNumber(candidate);
    if (value != null) return value;
  }
  return 0;
}

function getHP(actor) {
  const system = actor?.system ?? {};
  const hp = system.attributes?.hp ?? system.hp ?? system.health;
  if (!hp) return null;

  const value = toNumber(hp.value ?? hp.current);
  const max = toNumber(hp.max ?? hp.maximum);
  if (value == null && max == null) return null;
  return { value, max };
}

async function setHP(actor, value) {
  const system = actor?.system ?? {};
  const rounded = Math.max(0, Math.round(value));

  if (system.attributes?.hp?.value != null) {
    return actor.update({ "system.attributes.hp.value": rounded });
  }
  if (system.hp?.value != null) {
    return actor.update({ "system.hp.value": rounded });
  }
  if (system.health?.value != null) {
    return actor.update({ "system.health.value": rounded });
  }
  return null;
}

function battleSettings() {
  return {
    alpha: Number(game.settings.get(MODULE_ID, "battleAlpha") ?? DEFAULT_ALPHA),
    swing: Number(game.settings.get(MODULE_ID, "battleSwing") ?? DEFAULT_BATTLE_SIGMA),
    compression: Number(
      game.settings.get(MODULE_ID, "battleCompression") ?? DEFAULT_FORCE_COMPRESSION,
    ),
    threshold: Number(
      game.settings.get(MODULE_ID, "battleTotalThreshold") ?? DEFAULT_TOTAL_THRESHOLD,
    ),
  };
}

function battleSignature(entries, state, settings) {
  return JSON.stringify({
    units: entries.map((entry) => [
      entry.id,
      entry.team,
      entry.name,
      entry.effectiveCR,
      entry.hp?.value ?? 0,
    ]),
    rush: state.rush,
    settings: [settings.alpha, settings.swing, settings.compression, settings.threshold],
  });
}

function normalizeType(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function troopKind(troopType) {
  const type = normalizeType(troopType);
  if (!type) return null;
  if (type.includes("comandant") || type.includes("commander") || type.includes("capo")) return "commander";
  if (type.includes("arcier") || type.includes("archer")) return "archer";
  return null;
}

function formatCR(cr) {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  if (Number.isInteger(cr)) return String(cr);
  return String(Number(cr.toFixed(2)));
}

/* -------------------------------------------------------------------------- */
/* Composizione delle righe del pannello                                      */
/* -------------------------------------------------------------------------- */

async function resolveEntries(state = getWarState()) {
  const entries = await Promise.all(
    Object.entries(state.entries).map(async ([id, entry]) => {
      const tokenDoc = await safeFromUuid(entry.tokenUuid);
      const actor = tokenDoc?.actor ?? (await safeFromUuid(entry.actorUuid));
      const war = actor?.getFlag(MODULE_ID, "war") ?? {};

      const troopType = war.troopType ?? "";
      const kind = troopKind(troopType);
      const effects = entry.effects ?? {};

      return {
        id,
        actor,
        tokenDoc,
        name: tokenDoc?.name ?? entry.name ?? actor?.name ?? "?",
        img: tokenDoc?.texture?.src ?? entry.img ?? actor?.img ?? "icons/svg/mystery-man.svg",
        team: war.team === "enemy" ? "enemy" : "ally",
        troopType,
        kind,
        cr: Number.isFinite(entry.cr) ? entry.cr : getCR(actor),
        hp: getHP(actor),
        effects: {
          inspiration: effects.inspiration ?? true,
          ranged: effects.ranged ?? true,
        },
      };
    }),
  );

  // Bonus dei comandanti, per schieramento.
  const commanderBonus = { ally: 0, enemy: 0 };
  for (const entry of entries) {
    if (entry.kind === "commander" && entry.effects.inspiration) {
      commanderBonus[entry.team] += 1;
    }
  }

  for (const entry of entries) {
    let bonus = commanderBonus[entry.team];
    if (entry.kind === "archer" && entry.effects.ranged) bonus += 2;

    // Bonus globale di schieramento (flank / encircle).
    const stanceBonus = STANCE_CR[state.stances[entry.team]] ?? 0;
    bonus += stanceBonus;

    entry.stanceBonus = stanceBonus;
    entry.bonus = bonus;
    entry.effectiveCR = entry.cr + bonus;
    entry.xp = xpForCR(entry.effectiveCR);
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

function renderHP(hp) {
  if (!hp) return "—";
  const value = hp.value ?? "?";
  const max = hp.max ?? "?";
  return `${value} / ${max}`;
}

function renderEffectButtons(entry) {
  const buttons = [];

  if (entry.kind === "commander") {
    buttons.push(`
      <button type="button" class="fw-effect${entry.effects.inspiration ? " active" : ""}"
              data-action="toggleEffect" data-entry-id="${entry.id}" data-effect="inspiration"
              aria-pressed="${entry.effects.inspiration}">
        <i class="fa-solid ${entry.effects.inspiration ? "fa-toggle-on" : "fa-toggle-off"}"></i>
        ${game.i18n.localize("FOUNDRY-WAR.effects.inspiration")}
      </button>
    `);
  }

  if (entry.kind === "archer") {
    buttons.push(`
      <button type="button" class="fw-effect${entry.effects.ranged ? " active" : ""}"
              data-action="toggleEffect" data-entry-id="${entry.id}" data-effect="ranged"
              aria-pressed="${entry.effects.ranged}">
        <i class="fa-solid ${entry.effects.ranged ? "fa-toggle-on" : "fa-toggle-off"}"></i>
        ${game.i18n.localize("FOUNDRY-WAR.effects.ranged")}
      </button>
    `);
  }

  if (!buttons.length) return "";
  return `<div class="fw-effects">${buttons.join("")}</div>`;
}

function renderCard(entry, escapeHTML) {
  const bonus =
    entry.bonus > 0
      ? ` <span class="fw-bonus">→ ${formatCR(entry.effectiveCR)}</span>`
      : "";

  return `
    <article class="fw-card" data-entry-id="${entry.id}">
      <img class="fw-token" src="${escapeHTML(entry.img)}" alt="${escapeHTML(entry.name)}">
      <div class="fw-body">
        <header class="fw-card-header">
          <span class="fw-name" title="${escapeHTML(entry.name)}">${escapeHTML(entry.name)}</span>
          <button type="button" class="fw-remove" data-action="removeEntry" data-entry-id="${entry.id}"
                  data-tooltip="${game.i18n.localize("FOUNDRY-WAR.panel.remove")}">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </header>
        <div class="fw-stats">
          <span class="fw-stat fw-cr" data-tooltip="${game.i18n.localize("FOUNDRY-WAR.panel.cr")}">
            <b>CR</b>
            <span class="fw-cr-control">
              <button type="button" class="fw-cr-btn" data-action="adjustCR" data-entry-id="${entry.id}" data-delta="-1"
                      data-tooltip="${game.i18n.localize("FOUNDRY-WAR.panel.crDecrease")}">−</button>
              <span class="fw-cr-value">${formatCR(entry.cr)}</span>
              <button type="button" class="fw-cr-btn" data-action="adjustCR" data-entry-id="${entry.id}" data-delta="1"
                      data-tooltip="${game.i18n.localize("FOUNDRY-WAR.panel.crIncrease")}">+</button>
            </span>
            ${bonus}
          </span>
          <span class="fw-stat" data-tooltip="${game.i18n.localize("FOUNDRY-WAR.panel.hp")}">
            <b>HP</b> ${renderHP(entry.hp)}
          </span>
          <span class="fw-stat fw-type" data-tooltip="${game.i18n.localize("FOUNDRY-WAR.panel.type")}">
            <b>${game.i18n.localize("FOUNDRY-WAR.panel.type")}</b>
            ${entry.troopType ? escapeHTML(entry.troopType) : "—"}
          </span>
        </div>
        ${renderEffectButtons(entry)}
      </div>
    </article>
  `;
}

function renderColumn(team, entries, stance, escapeHTML) {
  const label = game.i18n.localize(
    team === "ally" ? "FOUNDRY-WAR.panel.allies" : "FOUNDRY-WAR.panel.enemies",
  );

  const stanceButtons = ["flank", "encircle"]
    .map((value) => {
      const active = stance === value;
      const labelKey =
        value === "flank" ? "FOUNDRY-WAR.panel.flank" : "FOUNDRY-WAR.panel.encircle";
      return `
        <button type="button" class="fw-stance${active ? " active" : ""}"
                data-action="setStance" data-team="${team}" data-stance="${value}"
                aria-pressed="${active}">
          ${game.i18n.localize(labelKey)}
        </button>
      `;
    })
    .join("");

  const cards = entries.length
    ? entries.map((entry) => renderCard(entry, escapeHTML)).join("")
    : `<p class="fw-empty">${game.i18n.localize("FOUNDRY-WAR.panel.empty")}</p>`;

  return `
    <section class="fw-column fw-${team}">
      <h2 class="fw-column-title">
        <i class="fa-solid ${team === "ally" ? "fa-shield-halved" : "fa-skull"}"></i>
        ${label}
        <span class="fw-count">${entries.length}</span>
      </h2>
      <div class="fw-stances">${stanceButtons}</div>
      <div class="fw-list">${cards}</div>
    </section>
  `;
}

/* -------------------------------------------------------------------------- */
/* Battaglia: simulazione, grafo, tiro, applicazione                          */
/* -------------------------------------------------------------------------- */

function fmtPct(value) {
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function fmtNum(value) {
  return value == null ? "—" : Number(value).toFixed(1);
}

function buildBattle(entries, state) {
  const settings = battleSettings();
  const sides = { ally: [], enemy: [] };

  for (const entry of entries) {
    sides[entry.team].push({
      id: entry.id,
      name: entry.name,
      cr: entry.effectiveCR,
      troops: Math.max(0, Math.floor(entry.hp?.value ?? 0)),
      actor: entry.actor,
    });
  }

  if (!sides.ally.length || !sides.enemy.length) return { error: "empty" };

  const config = {
    allies: sides.ally.map(({ cr, troops }) => ({ cr, troops })),
    enemies: sides.enemy.map(({ cr, troops }) => ({ cr, troops })),
    alpha: settings.alpha,
    battleSigma: settings.swing,
    forceCompression: settings.compression,
    rush: state.rush,
    lossCap: 0.5,
    dice: 3,
  };

  const distribution = simulateDistribution(config, 8000, 12345);
  if (!distribution.alliesInitial || !distribution.enemiesInitial) {
    return { error: "empty" };
  }

  return {
    settings,
    sides,
    distribution,
    threshold: settings.threshold,
    signature: battleSignature(entries, state, settings),
    roll: null,
  };
}

function smoothBattleProbabilities(bins, min, max) {
  const range = Math.max(1, max - min);
  const bandwidth = Math.max(2, range * 0.05);
  const radius = Math.ceil(bandwidth * 3);
  const grid = new Map();
  const step = Math.max(1, Math.ceil((max - min) / 600));

  for (let value = Math.ceil(min); value <= Math.floor(max); value += step) {
    grid.set(value, 0);
  }

  for (const bin of bins) {
    const weights = [];
    let weightSum = 0;

    for (let d = -radius; d <= radius; d += 1) {
      const value = bin.value + d;
      if (!grid.has(value)) continue;
      const weight = Math.exp(-(d * d) / (2 * bandwidth * bandwidth));
      weights.push([value, weight]);
      weightSum += weight;
    }

    if (!weightSum) continue;

    for (const [value, weight] of weights) {
      grid.set(value, grid.get(value) + (bin.probability * weight) / weightSum);
    }
  }

  return [...grid.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([value, probability]) => ({ value, probability }));
}

function renderBattleGraph(battle) {
  const dist = battle.distribution;
  const bins = dist.bins;
  if (!bins.length) return "";

  const W = 920;
  const H = 360;
  const M = { top: 20, right: 96, bottom: 46, left: 58 };
  const values = bins.map((bin) => bin.value);
  const xMin = Math.min(...values, 0) - 1;
  const xMax = Math.max(...values, 0) + 1;
  const smoothed = smoothBattleProbabilities(bins, xMin, xMax);
  const probMax = Math.max(...smoothed.map((p) => p.probability), 0.01) * 1.18;
  const lossMax =
    Math.max(...bins.map((bin) => Math.max(bin.avgAllyLosses, bin.avgEnemyLosses)), 1) * 1.18;

  const sx = (v) => M.left + ((v - xMin) / (xMax - xMin || 1)) * (W - M.left - M.right);
  const syP = (p) => H - M.bottom - (p / probMax) * (H - M.top - M.bottom);
  const syL = (l) => H - M.bottom - (l / lossMax) * (H - M.top - M.bottom);

  const parts = [];
  parts.push(
    `<svg viewBox="0 0 ${W} ${H}" class="fw-battle-graph"
      data-xmin="${xMin}" data-xmax="${xMax}"
      data-plot-left="${M.left}" data-plot-right="${W - M.right}"
      data-width="${W}" role="img"
      aria-label="${game.i18n.localize("FOUNDRY-WAR.battle.title")}">`,
  );

  for (let i = 0; i <= 4; i += 1) {
    const probability = (probMax / 4) * i;
    const y = syP(probability);
    parts.push(
      `<line x1="${M.left}" x2="${W - M.right}" y1="${y}" y2="${y}" class="fw-graph-grid"></line>`,
      `<text x="${M.left - 8}" y="${y + 3}" text-anchor="end" class="fw-graph-axis">${(probability * 100).toFixed(1)}%</text>`,
      `<text x="${W - M.right + 8}" y="${y + 3}" text-anchor="start" class="fw-graph-axis">${((lossMax / 4) * i).toFixed(0)}</text>`,
    );
  }

  const step = Math.max(1, Math.round((xMax - xMin) / 12));
  for (let value = Math.ceil(xMin); value <= xMax; value += step) {
    parts.push(
      `<text x="${sx(value)}" y="${H - M.bottom + 16}" text-anchor="middle" class="fw-graph-axis">${value}</text>`,
    );
  }

  parts.push(
    `<text x="${M.left}" y="${M.top - 6}" class="fw-graph-axis">${game.i18n.localize("FOUNDRY-WAR.battle.probability")}</text>`,
    `<text x="${W - M.right}" y="${M.top - 6}" text-anchor="end" class="fw-graph-axis">${game.i18n.localize("FOUNDRY-WAR.battle.lossesAxis")}</text>`,
    `<text x="${(M.left + W - M.right) / 2}" y="${H - 8}" text-anchor="middle" class="fw-graph-axis">${game.i18n.localize("FOUNDRY-WAR.battle.axisX")}</text>`,
    `<line x1="${sx(0)}" x2="${sx(0)}" y1="${M.top}" y2="${H - M.bottom}" class="fw-graph-zero"></line>`,
  );

  const posThreshold = battle.threshold * dist.alliesInitial;
  const negThreshold = -battle.threshold * dist.enemiesInitial;

  const zone = (from, to, cls) => {
    const x1 = Math.max(M.left, sx(Math.max(Math.min(from, to), xMin)));
    const x2 = Math.min(W - M.right, sx(Math.min(Math.max(from, to), xMax)));
    if (x2 - x1 < 1) return;
    parts.push(
      `<rect x="${x1}" y="${M.top}" width="${x2 - x1}" height="${H - M.top - M.bottom}" class="${cls}"></rect>`,
    );
  };

  if (posThreshold < xMax) zone(Math.max(posThreshold, xMin), xMax, "fw-graph-zone-ally");
  if (negThreshold > xMin) zone(xMin, Math.min(negThreshold, xMax), "fw-graph-zone-enemy");

  const formatThreshold = (value) =>
    `${value >= 0 ? "+" : ""}${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}`;

  const thresholdLine = (value, cls, label) => {
    if (value <= xMin || value >= xMax) return;
    const x = sx(value);
    parts.push(
      `<line x1="${x}" x2="${x}" y1="${M.top}" y2="${H - M.bottom}" class="fw-graph-threshold ${cls}"></line>`,
    );
    const anchor = x > W - M.right - 150 ? "end" : "start";
    parts.push(
      `<text x="${x + (anchor === "end" ? -6 : 6)}" y="${M.top + 12}" text-anchor="${anchor}" class="fw-graph-threshold-label ${cls}">${label}</text>`,
    );
  };

  thresholdLine(
    posThreshold,
    "ally",
    `${game.i18n.localize("FOUNDRY-WAR.battle.totalAllies")} ≥ ${formatThreshold(posThreshold)}`,
  );
  thresholdLine(
    negThreshold,
    "enemy",
    `${game.i18n.localize("FOUNDRY-WAR.battle.totalEnemies")} ≤ ${formatThreshold(negThreshold)}`,
  );

  const probPoints = smoothed.map((point) => [sx(point.value), syP(point.probability)]);
  const probLine = probPoints
    .map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const probArea = `${probLine} L${probPoints[probPoints.length - 1][0].toFixed(1)},${H - M.bottom} L${probPoints[0][0].toFixed(1)},${H - M.bottom} Z`;

  parts.push(
    `<path d="${probArea}" class="fw-graph-prob-area"></path>`,
    `<path d="${probLine}" class="fw-graph-prob"></path>`,
  );

  const lossPath = (key, cls) => {
    const points = bins.map((bin) => [sx(bin.value), syL(bin[key])]);
    if (points.length < 2) return;
    const d = points
      .map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");
    parts.push(`<path d="${d}" class="${cls}"></path>`);
  };

  lossPath("avgAllyLosses", "fw-graph-loss-ally");
  lossPath("avgEnemyLosses", "fw-graph-loss-enemy");

  if (battle.roll) {
    const total = isTotalVictory(
      battle.roll.bin.value,
      dist.alliesInitial,
      dist.enemiesInitial,
      battle.threshold,
    );
    const side = total ? (battle.roll.bin.value > 0 ? "ally" : "enemy") : "neutral";
    const x = sx(battle.roll.bin.value);
    parts.push(
      `<line x1="${x}" x2="${x}" y1="${M.top}" y2="${H - M.bottom}" class="fw-graph-marker ${side}"></line>`,
      `<text x="${Math.min(x + 5, W - M.right - 60)}" y="${M.top + 12}" class="fw-graph-marker-label ${side}">${game.i18n.localize("FOUNDRY-WAR.battle.rollMarker")} ${(battle.roll.r * 100).toFixed(1)}</text>`,
    );
  }

  parts.push("</svg>");
  return parts.join("");
}

function renderBreakdownSide(title, rows, side, escapeHTML) {
  const head = `
    <div class="fw-battle-line head">
      <span>${game.i18n.localize("FOUNDRY-WAR.battle.name")}</span>
      <span>${game.i18n.localize("FOUNDRY-WAR.battle.cr")}</span>
      <span>${game.i18n.localize("FOUNDRY-WAR.battle.troops")}</span>
      <span>${game.i18n.localize("FOUNDRY-WAR.battle.losses")}</span>
      <span>${game.i18n.localize("FOUNDRY-WAR.battle.survivors")}</span>
    </div>
  `;

  const body = rows
    .map(
      (row) => `
        <div class="fw-battle-line">
          <span class="fw-unit-name" title="${escapeHTML(row.name)}">${escapeHTML(row.name)}</span>
          <span>${row.cr}</span>
          <span>${row.troops}</span>
          <span class="${side}">${row.troopLosses}</span>
          <span>${row.troopSurvivors}</span>
        </div>
      `,
    )
    .join("");

  return `<div class="fw-breakdown-side"><h4>${title}</h4>${head}${body}</div>`;
}

function renderBattleSection(battle) {
  if (!battle) return "";

  const escapeHTML = foundry.utils.escapeHTML;
  const dist = battle.distribution;
  const rates = totalVictoryRates(dist, battle.threshold);
  const average = dist.average ?? { allies: { losses: 0 }, enemies: { losses: 0 } };
  const roll = battle.roll;
  const total = roll
    ? isTotalVictory(roll.bin.value, dist.alliesInitial, dist.enemiesInitial, battle.threshold)
    : false;
  const winner = roll
    ? roll.bin.value > 0
      ? game.i18n.localize("FOUNDRY-WAR.battle.winAllies")
      : roll.bin.value < 0
        ? game.i18n.localize("FOUNDRY-WAR.battle.winEnemies")
        : game.i18n.localize("FOUNDRY-WAR.battle.draw")
    : "";

  const cards = `
    <div class="fw-battle-cards">
      <div class="fw-battle-card">
        <span>${game.i18n.localize("FOUNDRY-WAR.battle.winAllies")}</span>
        <b>${fmtPct(dist.allyWinRate)}</b>
      </div>
      <div class="fw-battle-card">
        <span>${game.i18n.localize("FOUNDRY-WAR.battle.winEnemies")}</span>
        <b>${fmtPct(dist.enemyWinRate)}</b>
      </div>
      <div class="fw-battle-card">
        <span>${game.i18n.localize("FOUNDRY-WAR.battle.avgLosses")}</span>
        <b><i class="ally">A ${fmtNum(average.allies.losses)}</i> / <i class="enemy">N ${fmtNum(average.enemies.losses)}</i></b>
      </div>
      <div class="fw-battle-card">
        <span>${game.i18n.localize("FOUNDRY-WAR.battle.totalChance")}</span>
        <b><i class="ally">A ${fmtPct(rates.ally)}</i> / <i class="enemy">N ${fmtPct(rates.enemy)}</i></b>
      </div>
    </div>
  `;

  let result = `<p class="fw-hint">${game.i18n.localize("FOUNDRY-WAR.battle.noRoll")}</p>`;
  let breakdown = "";

  if (roll) {
    const margin = `${roll.bin.value > 0 ? "+" : ""}${roll.bin.value.toLocaleString()}`;
    result = `
      <div class="fw-battle-result${total ? " total" : ""}">
        <div class="fw-battle-roll">
          ${game.i18n.format("FOUNDRY-WAR.battle.rollResult", {
            roll: (roll.r * 100).toFixed(1),
            margin,
          })}
        </div>
        <div class="fw-battle-winner">${winner}</div>
        <div class="fw-battle-losses">
          ${game.i18n.localize("FOUNDRY-WAR.battle.avgLosses")}:
          <b class="ally">A ${fmtNum(roll.bin.avgAllyLosses)}</b> /
          <b class="enemy">N ${fmtNum(roll.bin.avgEnemyLosses)}</b>
        </div>
        ${total ? `<div class="fw-battle-total">${game.i18n.localize("FOUNDRY-WAR.battle.totalYes")}</div>` : ""}
      </div>
    `;

    breakdown = `
      <h4 class="fw-breakdown-title">${game.i18n.localize("FOUNDRY-WAR.battle.breakdown")}</h4>
      <div class="fw-breakdown">
        ${renderBreakdownSide(game.i18n.localize("FOUNDRY-WAR.panel.allies"), roll.allyRows, "ally", escapeHTML)}
        ${renderBreakdownSide(game.i18n.localize("FOUNDRY-WAR.panel.enemies"), roll.enemyRows, "enemy", escapeHTML)}
      </div>
    `;
  }

  return `
    <section class="fw-battle">
      <h3>${game.i18n.localize("FOUNDRY-WAR.battle.title")}</h3>
      ${cards}
      <div class="fw-graph-wrap">
        ${renderBattleGraph(battle)}
        <div class="fw-graph-tooltip"></div>
      </div>
      <div class="fw-battle-actions">
        <button type="button" class="fw-roll" data-action="rollBattle">
          <i class="fa-solid fa-dice-d20"></i>
          ${game.i18n.localize("FOUNDRY-WAR.battle.roll")}
        </button>
        <button type="button" class="fw-apply" data-action="applyBattle" ${roll ? "" : "disabled"}>
          <i class="fa-solid fa-check"></i>
          ${game.i18n.localize("FOUNDRY-WAR.battle.apply")}
        </button>
      </div>
      ${result}
      ${breakdown}
    </section>
  `;
}

async function buildPanelElement(state = getWarState(), entries = null, battleState = null) {
  const currentState = state;
  const currentEntries = entries ?? (await resolveEntries(currentState));
  const { escapeHTML } = foundry.utils;

  const root = document.createElement("div");
  root.className = "fw-panel";
  root.innerHTML = `
    <div class="fw-columns">
      ${renderColumn("ally", currentEntries.filter((e) => e.team === "ally"), currentState.stances.ally, escapeHTML)}
      ${renderColumn("enemy", currentEntries.filter((e) => e.team === "enemy"), currentState.stances.enemy, escapeHTML)}
    </div>
    <footer class="fw-footer">
      <button type="button" class="fw-rush${currentState.rush ? " active" : ""}"
              data-action="toggleRush" aria-pressed="${currentState.rush}"
              data-tooltip="${game.i18n.localize("FOUNDRY-WAR.panel.rushHint")}">
        <i class="fa-solid fa-bolt"></i>
        ${game.i18n.localize("FOUNDRY-WAR.panel.rush")}
      </button>
      <button type="button" class="fw-simulate" data-action="simulateWar">
        <i class="fa-solid fa-dice-d20"></i>
        ${game.i18n.localize("FOUNDRY-WAR.panel.simulate")}
      </button>
    </footer>
    ${renderBattleSection(battleState)}
  `;

  return root;
}

/* -------------------------------------------------------------------------- */
/* ApplicationV2                                                              */
/* -------------------------------------------------------------------------- */

const { ApplicationV2 } = foundry.applications.api;

export class WarPanel extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "foundry-war-panel",
    classes: ["foundry-war-panel-app"],
    window: {
      title: "FOUNDRY-WAR.panel.title",
      icon: "fa-solid fa-flag",
      resizable: true,
    },
    position: { width: 980, height: 860 },
    actions: {
      simulateWar: WarPanel.onSimulateWar,
      rollBattle: WarPanel.onRollBattle,
      applyBattle: WarPanel.onApplyBattle,
      removeEntry: WarPanel.onRemoveEntry,
      toggleEffect: WarPanel.onToggleEffect,
      adjustCR: WarPanel.onAdjustCR,
      setStance: WarPanel.onSetStance,
      toggleRush: WarPanel.onToggleRush,
    },
  };

  async _renderHTML() {
    const state = getWarState();
    const entries = await resolveEntries(state);
    const settings = battleSettings();
    const signature = battleSignature(entries, state, settings);

    let battle = null;

    if (state.battle.active) {
      if (this.battleCache?.signature === signature) {
        battle = this.battleCache.battle;
      } else {
        const built = buildBattle(entries, state);

        if (!built.error) {
          battle = built;
          this.battleCache = { signature, battle };
        }
      }
    } else {
      this.battleCache = null;
    }

    if (battle) {
      battle.roll = null;

      const storedRoll = state.battle.roll;
      if (storedRoll && storedRoll.signature === signature) {
        const bin = battle.distribution.bins.find(
          (candidate) => candidate.value === storedRoll.value,
        );

        if (bin) {
          battle.roll = {
            r: storedRoll.r,
            bin,
            allyRows: distributeLosses(battle.sides.ally, bin.avgAllyLosses, {
              seed: storedRoll.seed,
            }),
            enemyRows: distributeLosses(battle.sides.enemy, bin.avgEnemyLosses, {
              seed: storedRoll.seed + 1,
            }),
          };
        }
      }
    }

    this.currentBattle = battle;
    return buildPanelElement(state, entries, battle);
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onRender(context, options) {
    super._onRender?.(context, options);

    const svg = this.element.querySelector(".fw-battle-graph");
    const tooltip = this.element.querySelector(".fw-graph-tooltip");
    const battle = this.currentBattle;

    if (!svg || !tooltip || !battle) return;

    const xMin = Number(svg.dataset.xmin);
    const xMax = Number(svg.dataset.xmax);
    const plotLeft = Number(svg.dataset.plotLeft);
    const plotRight = Number(svg.dataset.plotRight);
    const width = Number(svg.dataset.width);
    const bins = battle.distribution.bins;
    const range = Math.max(1, xMax - xMin);
    const bandwidth = Math.max(2, range * 0.05);

    const showTooltip = (event) => {
      const rect = svg.getBoundingClientRect();
      const svgX = ((event.clientX - rect.left) / rect.width) * width;
      const margin = xMin + ((svgX - plotLeft) / (plotRight - plotLeft)) * (xMax - xMin);

      let weightSum = 0;
      let probability = 0;
      let allyLoss = 0;
      let enemyLoss = 0;
      let allySurv = 0;
      let enemySurv = 0;

      for (const bin of bins) {
        const distance = bin.value - margin;
        const kernel = Math.exp(-(distance * distance) / (2 * bandwidth * bandwidth));
        const weight = bin.probability * kernel;
        if (weight <= 0) continue;

        weightSum += weight;
        probability += weight;
        allyLoss += bin.avgAllyLosses * weight;
        enemyLoss += bin.avgEnemyLosses * weight;
        allySurv += bin.avgAllySurvivors * weight;
        enemySurv += bin.avgEnemySurvivors * weight;
      }

      if (!weightSum) return;

      tooltip.innerHTML = `
        <div class="fw-graph-tooltip-title">${game.i18n.localize("FOUNDRY-WAR.battle.advantage")} ${Math.round(margin)}</div>
        <div><span>${game.i18n.localize("FOUNDRY-WAR.battle.probability")}</span><b>${(probability * 100).toFixed(2)}%</b></div>
        <div><span>${game.i18n.localize("FOUNDRY-WAR.battle.allyLosses")}</span><b class="ally">${(allyLoss / weightSum).toFixed(1)}</b></div>
        <div><span>${game.i18n.localize("FOUNDRY-WAR.battle.enemyLosses")}</span><b class="enemy">${(enemyLoss / weightSum).toFixed(1)}</b></div>
        <div><span>${game.i18n.localize("FOUNDRY-WAR.battle.allyTroops")}</span><b>${(allySurv / weightSum).toFixed(1)}</b></div>
        <div><span>${game.i18n.localize("FOUNDRY-WAR.battle.enemyTroops")}</span><b>${(enemySurv / weightSum).toFixed(1)}</b></div>
      `;

      tooltip.classList.add("visible");

      const wrap = svg.parentElement;
      const wrapRect = wrap.getBoundingClientRect();
      const left = event.clientX - wrapRect.left + 14;
      const top = event.clientY - wrapRect.top;

      tooltip.style.left = `${Math.min(left, wrap.clientWidth - 240)}px`;
      tooltip.style.top = `${top}px`;
    };

    svg.addEventListener("mousemove", showTooltip);
    svg.addEventListener("mouseleave", () => tooltip.classList.remove("visible"));
  }

  _onClose(options) {
    super._onClose(options);
    if (panelInstance === this) panelInstance = null;
  }

  /* ---------------------------------------------------------------------- */

  static async onRemoveEntry(_event, target) {
    const entryId = target.dataset.entryId;
    if (!entryId) return;

    const state = getWarState();
    const entries = { ...state.entries };
    delete entries[entryId];
    await commitWarState({
      ...state,
      entries,
      battle: { ...state.battle, roll: null },
    });
  }

  static async onSetStance(_event, target) {
    const { team, stance } = target.dataset;
    if (!["ally", "enemy"].includes(team) || !STANCES.includes(stance)) return;

    const state = getWarState();
    const nextStance = state.stances[team] === stance ? "none" : stance;

    await commitWarState({
      ...state,
      stances: { ...state.stances, [team]: nextStance },
      battle: { ...state.battle, roll: null },
    });
  }

  static async onToggleRush() {
    const state = getWarState();
    await commitWarState({
      ...state,
      rush: !state.rush,
      battle: { ...state.battle, roll: null },
    });
  }

  static async onToggleEffect(_event, target) {
    const { entryId, effect } = target.dataset;
    if (!entryId || !effect) return;

    const state = getWarState();
    const entry = state.entries[entryId];
    if (!entry) return;

    const effects = { ...(entry.effects ?? {}) };
    effects[effect] = !(effects[effect] ?? true);

    await commitWarState({
      ...state,
      entries: { ...state.entries, [entryId]: { ...entry, effects } },
      battle: { ...state.battle, roll: null },
    });
  }

  static async onAdjustCR(_event, target) {
    const entryId = target.dataset.entryId;
    const delta = Number(target.dataset.delta) || 0;
    if (!entryId || !delta) return;

    const state = getWarState();
    const entry = state.entries[entryId];
    if (!entry) return;

    let base = Number.isFinite(entry.cr) ? entry.cr : null;
    if (base == null) {
      const tokenDoc = await safeFromUuid(entry.tokenUuid);
      const actor = tokenDoc?.actor ?? (await safeFromUuid(entry.actorUuid));
      base = getCR(actor);
    }

    const cr = Math.max(0, Math.round((base + delta) * 1000) / 1000);

    await commitWarState({
      ...state,
      entries: { ...state.entries, [entryId]: { ...entry, cr } },
      battle: { ...state.battle, roll: null },
    });
  }

  static async onSimulateWar() {
    const state = getWarState();
    const entries = await resolveEntries(state);
    const battle = buildBattle(entries, state);

    if (battle.error) {
      ui.notifications.warn(game.i18n.localize("FOUNDRY-WAR.battle.emptySide"));
      return;
    }

    this.battleCache = { signature: battle.signature, battle };

    await commitWarState({
      ...state,
      battle: { active: true, roll: null },
    });
  }

  static async onRollBattle() {
    const state = getWarState();
    const entries = await resolveEntries(state);
    const settings = battleSettings();
    const signature = battleSignature(entries, state, settings);

    let battle =
      this.battleCache?.signature === signature ? this.battleCache.battle : null;

    if (!battle) {
      const built = buildBattle(entries, state);
      if (built.error) return;
      battle = built;
      this.battleCache = { signature, battle };
    }

    const bins = battle.distribution.bins;
    if (!bins.length) return;

    const random = Math.random();
    let cumulative = 0;
    let bin = bins[bins.length - 1];

    for (const candidate of bins) {
      cumulative += candidate.probability;
      if (random <= cumulative) {
        bin = candidate;
        break;
      }
    }

    const seed = Math.floor(Math.random() * 1e9);

    await commitWarState({
      ...state,
      battle: {
        active: true,
        roll: { r: random, value: bin.value, seed, signature },
      },
    });
  }

  static async onApplyBattle() {
    const state = getWarState();
    const storedRoll = state.battle.roll;
    if (!storedRoll) return;

    const entries = await resolveEntries(state);
    const settings = battleSettings();
    const signature = battleSignature(entries, state, settings);
    if (storedRoll.signature !== signature) return;

    const battle = buildBattle(entries, state);
    if (battle.error) return;

    const bin = battle.distribution.bins.find(
      (candidate) => candidate.value === storedRoll.value,
    );
    if (!bin) return;

    const allyRows = distributeLosses(battle.sides.ally, bin.avgAllyLosses, {
      seed: storedRoll.seed,
    });
    const enemyRows = distributeLosses(battle.sides.enemy, bin.avgEnemyLosses, {
      seed: storedRoll.seed + 1,
    });

    const applications = [
      ...allyRows.map((row, index) => ({ row, unit: battle.sides.ally[index] })),
      ...enemyRows.map((row, index) => ({ row, unit: battle.sides.enemy[index] })),
    ];

    // Se lo stesso attore compare su più token, sommo le perdite e applico
    // una sola volta alle sue HP.
    const byActor = new Map();

    for (const { row, unit } of applications) {
      if (!unit?.actor || !row.troopLosses) continue;

      const current = byActor.get(unit.actor.uuid) ?? { actor: unit.actor, loss: 0 };
      current.loss += row.troopLosses;
      byActor.set(unit.actor.uuid, current);
    }

    for (const { actor } of byActor.values()) {
      if (!actor.isOwner && !game.user.isGM) {
        ui.notifications.warn(game.i18n.localize("FOUNDRY-WAR.battle.noPermission"));
        return;
      }
    }

    const updates = [];
    for (const { actor, loss } of byActor.values()) {
      const hp = getHP(actor);
      if (!hp || hp.value == null) continue;
      updates.push({
        actor,
        value: Math.max(0, hp.value - loss),
      });
    }

    await Promise.all(updates.map(({ actor, value }) => setHP(actor, value)));

    // La simulazione resta attiva, ma il tiro viene consumato.
    await commitWarState({
      ...state,
      battle: { active: true, roll: null },
    });

    ui.notifications.info(game.i18n.localize("FOUNDRY-WAR.battle.applied"));
  }
}

/* -------------------------------------------------------------------------- */
/* Apertura / chiusura                                                        */
/* -------------------------------------------------------------------------- */

let panelInstance = null;

export function toggleWarPanel() {
  if (panelInstance?.rendered) {
    panelInstance.close();
    panelInstance = null;
    return;
  }

  panelInstance = new WarPanel();
  panelInstance.render({ force: true });
}

let panelRefreshTimer = null;

export function refreshWarPanel() {
  if (!panelInstance?.rendered) return;

  clearTimeout(panelRefreshTimer);
  panelRefreshTimer = setTimeout(() => {
    panelRefreshTimer = null;
    if (panelInstance?.rendered) panelInstance.render();
  }, 150);
}

/* -------------------------------------------------------------------------- */
/* Token HUD: click destro su un token -> aggiungi/rimuovi guerra             */
/* -------------------------------------------------------------------------- */

function getTargetTokens(token) {
  const controlled = canvas.tokens?.controlled ?? [];
  if (controlled.length > 1 && controlled.includes(token)) return controlled;
  return [token];
}

Hooks.on("renderTokenHUD", (hud, html) => {
  const token = hud.object;
  if (!token?.actor) return;

  const column = html.querySelector?.(".col.left");
  if (!column || html.querySelector(".foundry-war-hud")) return;

  const targets = getTargetTokens(token);
  const active = targets.every((target) => isTokenInWar(target));

  const button = document.createElement("div");
  button.className = `control-icon foundry-war-hud${active ? " active" : ""}`;
  button.dataset.tooltip = game.i18n.localize(
    active ? "FOUNDRY-WAR.hud.remove" : "FOUNDRY-WAR.hud.add",
  );
  button.innerHTML = '<i class="fa-solid fa-flag"></i>';

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await toggleTokensInWar(targets);
    await hud.render?.();
  });

  column.append(button);
});
