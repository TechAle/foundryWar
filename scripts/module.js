/**
 * Foundry War - modulo di esempio per Foundry VTT v13 (build 351).
 *
 * Questo file viene caricato come ES module (vedi "esmodules" in module.json).
 * La configurazione "War" delle schede Attore è in scripts/war-config.js.
 */

import {
  getWarData,
  openWarConfig,
  setWarData,
} from "./war-config.js";

const MODULE_ID = "foundry-war";

/* -------------------------------------------------------------------------- */
/* init: registra impostazioni, keybinding, tipi di dati, ecc.                */
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

  game.settings.register(MODULE_ID, "troopTypes", {
    name: "FOUNDRY-WAR.settings.troopTypes.name",
    hint: "FOUNDRY-WAR.settings.troopTypes.hint",
    scope: "world",
    config: true,
    type: String,
    default: "Fanteria, Cavalleria, Arcieri, Artiglieria, Mostro, Comandante",
  });
});

/* -------------------------------------------------------------------------- */
/* ready: il mondo è pronto, `game` e i documenti sono disponibili.            */
/* -------------------------------------------------------------------------- */
Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);

  // API pubblica del modulo, richiamabile da macro:
  //   game.foundryWar.openConfig(actor)
  //   game.foundryWar.getWarData(actor)
  game.foundryWar = {
    version: game.modules.get(MODULE_ID)?.version ?? "dev",
    ping: () => ui.notifications.info(game.i18n.localize("FOUNDRY-WAR.notifications.pong")),
    openConfig: openWarConfig,
    getWarData,
    setWarData,
  };

  if (!game.settings.get(MODULE_ID, "enabled")) return;

  ui.notifications.info(game.i18n.localize("FOUNDRY-WAR.notifications.ready"));
});

/* -------------------------------------------------------------------------- */
/* Comando chat "/war": apre la configurazione per il token selezionato.      */
/* -------------------------------------------------------------------------- */
Hooks.on("chatMessage", (_chatLog, message) => {
  if (message.trim() !== "/war") return true;
  if (!game.settings.get(MODULE_ID, "enabled")) return true;

  const actor =
    canvas.tokens?.controlled?.[0]?.actor ?? game.user.character ?? null;

  openWarConfig(actor);
  return false;
});
