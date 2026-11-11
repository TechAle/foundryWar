/**
 * Foundry War - modulo per Foundry VTT v13 (build 351).
 *
 * Questo file viene caricato come ES module (vedi "esmodules" in module.json).
 * - scripts/war-config.js  -> configurazione Guerra nelle schede Attore
 * - scripts/war-panel.js   -> pannello condiviso, Token HUD e simulazione XP
 */

import {
  getWarData,
  openWarConfig,
  setWarData,
} from "./war-config.js";

import {
  commitWarState,
  getWarState,
  refreshWarPanel,
  toggleTokensInWar,
  toggleWarPanel,
} from "./war-panel.js";

import { getGroups, openGroupManager } from "./war-groups.js";
import { refreshEconomyPanel, toggleEconomyPanel } from "./economy.js";

const MODULE_ID = "foundry-war";
const STATE_KEY = "warState";

/* -------------------------------------------------------------------------- */
/* init: impostazioni                                                         */
/* -------------------------------------------------------------------------- */
Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);

  game.settings.register(MODULE_ID, "enabled", {
    name: "FOUNDRY-WAR.settings.enabled.name",
    hint: "FOUNDRY-WAR.settings.enabled.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "warGroups", {
    scope: "world",
    config: false,
    type: Object,
    default: { groups: {} },
  });

  game.settings.register(MODULE_ID, "economyState", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.register(MODULE_ID, "battleAlpha", {
    name: "FOUNDRY-WAR.settings.battleAlpha.name",
    hint: "FOUNDRY-WAR.settings.battleAlpha.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 0.15,
    range: { min: 0, max: 1, step: 0.01 },
  });

  game.settings.register(MODULE_ID, "battleSwing", {
    name: "FOUNDRY-WAR.settings.battleSwing.name",
    hint: "FOUNDRY-WAR.settings.battleSwing.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 0.05,
    range: { min: 0, max: 1, step: 0.01 },
  });

  game.settings.register(MODULE_ID, "battleCompression", {
    name: "FOUNDRY-WAR.settings.battleCompression.name",
    hint: "FOUNDRY-WAR.settings.battleCompression.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 0.2,
    range: { min: 0, max: 1, step: 0.01 },
  });

  game.settings.register(MODULE_ID, "battleTotalThreshold", {
    name: "FOUNDRY-WAR.settings.battleTotalThreshold.name",
    hint: "FOUNDRY-WAR.settings.battleTotalThreshold.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 0.8,
    range: { min: 0.5, max: 1, step: 0.01 },
  });

  // Stato del pannello: world setting = condivisa con tutti i client.
  game.settings.register(MODULE_ID, STATE_KEY, {
    scope: "world",
    config: false,
    type: Object,
    default: { entries: {} },
  });
});

/* -------------------------------------------------------------------------- */
/* ready                                                                      */
/* -------------------------------------------------------------------------- */
Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);

  // API per macro.
  game.foundryWar = {
    version: game.modules.get(MODULE_ID)?.version ?? "dev",
    ping: () => ui.notifications.info(game.i18n.localize("FOUNDRY-WAR.notifications.pong")),
    openConfig: openWarConfig,
    getWarData,
    setWarData,
    togglePanel: toggleWarPanel,
    getPanelState: getWarState,
    setPanelState: commitWarState,
    toggleTokens: toggleTokensInWar,
    openGroupManager,
    getGroups,
    openEconomy: toggleEconomyPanel,
  };

  // I client senza permessi di modifica delegano le scritture al GM.
  game.socket.on(`module.${MODULE_ID}`, (payload) => {
    if (!game.user.isGM) return;

    if (payload?.type === "setWarState") {
      game.settings.set(MODULE_ID, STATE_KEY, payload.state);
    } else if (payload?.type === "setEconomyState") {
      game.settings.set(MODULE_ID, "economyState", payload.state);
    }
  });

  if (!game.settings.get(MODULE_ID, "enabled")) return;

  ui.notifications.info(game.i18n.localize("FOUNDRY-WAR.notifications.ready"));
});

/* -------------------------------------------------------------------------- */
/* Token controls: "Toggle War Panel"                                         */
/* -------------------------------------------------------------------------- */
Hooks.on("getSceneControlButtons", (controls) => {
  const tokenControls = controls?.tokens;
  if (!tokenControls?.tools) return;

  tokenControls.tools["foundry-war-panel"] = {
    name: "foundry-war-panel",
    title: "FOUNDRY-WAR.controls.togglePanel",
    icon: "fa-solid fa-flag",
    order: Object.keys(tokenControls.tools).length,
    button: true,
    visible: true,
    onChange: () => toggleWarPanel(),
  };

  tokenControls.tools["foundry-war-economy"] = {
    name: "foundry-war-economy",
    title: "FOUNDRY-WAR.economy.toggle",
    icon: "fa-solid fa-coins",
    order: Object.keys(tokenControls.tools).length,
    button: true,
    visible: true,
    onChange: () => toggleEconomyPanel(),
  };
});

/* -------------------------------------------------------------------------- */
/* Aggiornamenti condivisi -> ridisegna il pannello                           */
/* -------------------------------------------------------------------------- */
Hooks.on("updateSetting", (setting) => {
  const id = setting?._id ?? "";
  const key = setting?.key ?? "";
  const isWarState =
    id === `${MODULE_ID}.${STATE_KEY}` ||
    key === `${MODULE_ID}.${STATE_KEY}` ||
    key === STATE_KEY;
  const isWarGroups =
    id === `${MODULE_ID}.warGroups` ||
    key === `${MODULE_ID}.warGroups` ||
    key === "warGroups";
  const isEconomy =
    id === `${MODULE_ID}.economyState` ||
    key === `${MODULE_ID}.economyState` ||
    key === "economyState";

  if (isWarState || isWarGroups) refreshWarPanel();
  if (isEconomy) refreshEconomyPanel();
});

Hooks.on("updateActor", (_actor, changes) => {
  if (changes?.flags?.[MODULE_ID] || changes?.system) refreshWarPanel();
});

Hooks.on("deleteToken", () => refreshWarPanel());
