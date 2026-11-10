/**
 * Foundry War - configurazione "War" delle schede Attore.
 *
 * Aggiunge la voce "War" nel menu "⋯" delle schede (ActorSheetV2 e legacy)
 * e apre un dialog con:
 *  - squadra: alleato / nemica
 *  - tipo di truppa: lista configurabile dalle impostazioni del modulo
 *
 * I dati vengono salvati nei flag dell'attore:
 *   actor.flags["foundry-war"].war = { team: "ally"|"enemy", troopType: "..." }
 */

const MODULE_ID = "foundry-war";
const FLAG_KEY = "war";
const ACTION_ID = "foundry-war-configure";
const TEAMS = ["ally", "enemy"];

/* -------------------------------------------------------------------------- */
/* Dati                                                                       */
/* -------------------------------------------------------------------------- */

/** Tipi di truppa configurati nelle impostazioni del modulo. */
export function getTroopTypes() {
  const raw = game.settings.get(MODULE_ID, "troopTypes") ?? "";
  const types = raw
    .split(",")
    .map((type) => type.trim())
    .filter(Boolean);

  return [...new Set(types)];
}

/** Legge la configurazione War di un attore, con valori di default. */
export function getWarData(actor) {
  const data = actor?.getFlag(MODULE_ID, FLAG_KEY) ?? {};

  return {
    team: TEAMS.includes(data.team) ? data.team : "ally",
    troopType: typeof data.troopType === "string" ? data.troopType : "",
  };
}

/** Salva la configurazione War di un attore. */
export async function setWarData(actor, { team, troopType }) {
  if (!actor) throw new Error(`${MODULE_ID}: attore mancante`);

  const data = {
    team: TEAMS.includes(team) ? team : "ally",
    troopType: typeof troopType === "string" ? troopType : "",
  };

  await actor.setFlag(MODULE_ID, FLAG_KEY, data);
  return data;
}

/* -------------------------------------------------------------------------- */
/* Dialog                                                                     */
/* -------------------------------------------------------------------------- */

/** Apre il dialog di configurazione per un attore. */
export async function openWarConfig(actor) {
  if (!actor) {
    ui.notifications.warn(game.i18n.localize("FOUNDRY-WAR.warnings.noActor"));
    return;
  }

  if (!actor.isOwner && !game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("FOUNDRY-WAR.warnings.noPermission"));
    return;
  }

  const current = getWarData(actor);
  const troopTypes = getTroopTypes();

  // Se il tipo salvato non è più nella lista, lo mostriamo comunque.
  if (current.troopType && !troopTypes.includes(current.troopType)) {
    troopTypes.push(current.troopType);
  }

  const { escapeHTML } = foundry.utils;

  const troopOptions = troopTypes
    .map(
      (type) =>
        `<option value="${escapeHTML(type)}"${type === current.troopType ? " selected" : ""}>${escapeHTML(type)}</option>`,
    )
    .join("");

  const content = `
    <div class="foundry-war-config">
      <div class="form-group">
        <label>${game.i18n.localize("FOUNDRY-WAR.dialog.team.name")}</label>
        <div class="form-fields">
          <select name="team">
            <option value="ally"${current.team === "ally" ? " selected" : ""}>${game.i18n.localize("FOUNDRY-WAR.dialog.team.ally")}</option>
            <option value="enemy"${current.team === "enemy" ? " selected" : ""}>${game.i18n.localize("FOUNDRY-WAR.dialog.team.enemy")}</option>
          </select>
        </div>
      </div>

      <div class="form-group">
        <label>${game.i18n.localize("FOUNDRY-WAR.dialog.troopType.name")}</label>
        <div class="form-fields">
          <select name="troopType">
            <option value="">${game.i18n.localize("FOUNDRY-WAR.dialog.troopType.none")}</option>
            ${troopOptions}
          </select>
        </div>
        <p class="hint">${game.i18n.localize("FOUNDRY-WAR.dialog.troopType.hint")}</p>
      </div>
    </div>
  `;

  const result = await foundry.applications.api.DialogV2.wait({
    window: {
      title: game.i18n.format("FOUNDRY-WAR.dialog.title", { name: actor.name }),
      icon: "fa-solid fa-flag",
    },
    content,
    rejectClose: false,
    modal: true,
    buttons: [
      {
        action: "save",
        label: game.i18n.localize("FOUNDRY-WAR.dialog.save"),
        icon: "fa-solid fa-floppy-disk",
        default: true,
        callback: (_event, button) => ({
          team: button.form.elements.team.value,
          troopType: button.form.elements.troopType.value,
        }),
      },
      {
        action: "cancel",
        label: game.i18n.localize("FOUNDRY-WAR.dialog.cancel"),
        icon: "fa-solid fa-xmark",
        callback: () => null,
      },
    ],
  });

  if (!result) return;

  await setWarData(actor, result);
  ui.notifications.info(
    game.i18n.format("FOUNDRY-WAR.dialog.saved", { name: actor.name }),
  );
}

/* -------------------------------------------------------------------------- */
/* Menu "⋯" delle schede (ApplicationV2)                                      */
/* -------------------------------------------------------------------------- */

Hooks.on("getHeaderControlsActorSheetV2", (app, controls) => {
  // L'array può essere riutilizzato: evitiamo voci duplicate.
  if (controls.some((control) => control.action === ACTION_ID)) return;

  controls.push({
    action: ACTION_ID,
    icon: "fa-solid fa-flag",
    label: game.i18n.localize("FOUNDRY-WAR.header.war"),
    ownership: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
    // `this` è l'istanza della scheda quando Foundry invoca il controllo.
    onClick: function () {
      const actor = this?.document ?? this?.actor ?? app?.document ?? app?.actor;
      openWarConfig(actor);
    },
  });
});

/* -------------------------------------------------------------------------- */
/* Fallback per le schede legacy (ApplicationV1)                              */
/* -------------------------------------------------------------------------- */

Hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
  if (buttons.some((button) => button.class === "foundry-war-config")) return;

  buttons.unshift({
    class: "foundry-war-config",
    label: game.i18n.localize("FOUNDRY-WAR.header.war"),
    icon: "fas fa-flag",
    onclick: () => openWarConfig(app.actor),
  });
});
