/**
 * Foundry War - modulo di esempio per Foundry VTT v13 (build 351).
 *
 * Questo file viene caricato come ES module (vedi "esmodules" in module.json).
 * Qui puoi agganciarti agli hook di Foundry per aggiungere le tue funzioni.
 */

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
});

/* -------------------------------------------------------------------------- */
/* ready: il mondo è pronto, `game` e i documenti sono disponibili.            */
/* -------------------------------------------------------------------------- */
Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);

  // API pubblica del modulo, richiamabile da macro:
  //   game.foundryWar.ping()
  game.foundryWar = {
    version: game.modules.get(MODULE_ID)?.version ?? "dev",
    ping: () => ui.notifications.info(game.i18n.localize("FOUNDRY-WAR.notifications.pong")),
  };

  if (!game.settings.get(MODULE_ID, "enabled")) return;

  ui.notifications.info(game.i18n.localize("FOUNDRY-WAR.notifications.ready"));
});

/* -------------------------------------------------------------------------- */
/* Esempio: comando chat "/war" che tira 1d20.                                */
/* Restituire false blocca il messaggio originale in chat.                    */
/* -------------------------------------------------------------------------- */
Hooks.on("chatMessage", (_chatLog, message) => {
  if (message.trim() !== "/war") return true;
  if (!game.settings.get(MODULE_ID, "enabled")) return true;

  new Roll("1d20").toMessage({
    flavor: game.i18n.localize("FOUNDRY-WAR.chat.flavor"),
  });

  return false;
});
