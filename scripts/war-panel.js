/**
 * Foundry War - pannello di guerra condiviso.
 *
 * - Stato salvato in una world setting (`warState`), quindi condiviso tra tutti
 *   i client. I giocatori senza permessi di modifica passano da socket al GM.
 * - Voci aggiunte/rimosse dal Token HUD (click destro su un token).
 * - CR effettivo calcolato solo qui: comandante (+1 CR agli alleati dello stesso
 *   schieramento) e arcieri (+2 CR a se stessi). Le schede non vengono toccate.
 */

const MODULE_ID = "foundry-war";
const STATE_KEY = "warState";

// XP minimo e arrotondamento per difetto.
const MIN_XP = 50;

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
  const next = { ...state, entries: { ...state.entries } };

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
/* Esperienza                                                                 */
/* -------------------------------------------------------------------------- */

const CR_XP = {
  0: 10,
  0.125: 25,
  0.25: 50,
  0.5: 100,
  1: 200,
  2: 450,
  3: 700,
  4: 1100,
  5: 1800,
  6: 2300,
  7: 2900,
  8: 3900,
  9: 5000,
  10: 5900,
  11: 7200,
  12: 8400,
  13: 10000,
  14: 11500,
  15: 13000,
  16: 15000,
  17: 18000,
  18: 20000,
  19: 22000,
  20: 25000,
  21: 33000,
  22: 41000,
  23: 50000,
  24: 62000,
  25: 75000,
  26: 90000,
  27: 105000,
  28: 120000,
  29: 135000,
  30: 155000,
};

export function xpForCR(cr) {
  const keys = Object.keys(CR_XP)
    .map(Number)
    .sort((a, b) => a - b);

  let best = keys[0];
  for (const key of keys) {
    if (cr + 1e-9 >= key) best = key;
    else break;
  }
  return Math.max(MIN_XP, Math.floor(CR_XP[best]));
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

async function buildPanelElement() {
  const state = getWarState();
  const entries = await resolveEntries(state);
  const { escapeHTML } = foundry.utils;

  const root = document.createElement("div");
  root.className = "fw-panel";
  root.innerHTML = `
    <div class="fw-columns">
      ${renderColumn("ally", entries.filter((e) => e.team === "ally"), state.stances.ally, escapeHTML)}
      ${renderColumn("enemy", entries.filter((e) => e.team === "enemy"), state.stances.enemy, escapeHTML)}
    </div>
    <footer class="fw-footer">
      <button type="button" class="fw-rush${state.rush ? " active" : ""}"
              data-action="toggleRush" aria-pressed="${state.rush}"
              data-tooltip="${game.i18n.localize("FOUNDRY-WAR.panel.rushHint")}">
        <i class="fa-solid fa-bolt"></i>
        ${game.i18n.localize("FOUNDRY-WAR.panel.rush")}
      </button>
      <button type="button" class="fw-simulate" data-action="simulateWar">
        <i class="fa-solid fa-dice-d20"></i>
        ${game.i18n.localize("FOUNDRY-WAR.panel.simulate")}
      </button>
    </footer>
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
    position: { width: 960, height: 620 },
    actions: {
      simulateWar: WarPanel.onSimulateWar,
      removeEntry: WarPanel.onRemoveEntry,
      toggleEffect: WarPanel.onToggleEffect,
      adjustCR: WarPanel.onAdjustCR,
      setStance: WarPanel.onSetStance,
      toggleRush: WarPanel.onToggleRush,
    },
  };

  async _renderHTML() {
    return buildPanelElement();
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
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
    await commitWarState({ ...state, entries });
  }

  static async onSetStance(_event, target) {
    const { team, stance } = target.dataset;
    if (!["ally", "enemy"].includes(team) || !STANCES.includes(stance)) return;

    const state = getWarState();
    const nextStance = state.stances[team] === stance ? "none" : stance;

    await commitWarState({
      ...state,
      stances: { ...state.stances, [team]: nextStance },
    });
  }

  static async onToggleRush() {
    const state = getWarState();
    await commitWarState({ ...state, rush: !state.rush });
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
    });
  }

  static async onSimulateWar() {
    const entries = await resolveEntries();
    const sum = (team) =>
      entries.filter((entry) => entry.team === team).reduce((total, entry) => total + entry.xp, 0);

    const allies = sum("ally");
    const enemies = sum("enemy");

    ui.notifications.info(
      game.i18n.format("FOUNDRY-WAR.simulate.allies", { xp: allies.toLocaleString() }),
    );
    ui.notifications.info(
      game.i18n.format("FOUNDRY-WAR.simulate.enemies", { xp: enemies.toLocaleString() }),
    );
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

export function refreshWarPanel() {
  if (panelInstance?.rendered) panelInstance.render();
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
