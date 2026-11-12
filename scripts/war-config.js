/**
 * Foundry War - configurazione "War" delle schede Attore.
 *
 * Aggiunge le voci "Guerra" e "Gestione" nel menu "⋯" delle schede.
 * "Guerra" apre la configurazione del token (squadra + gruppo);
 * "Gestione" apre l'editor delle classi/abilità (solo GM).
 *
 * I token salvano solo il riferimento al gruppo:
 *   actor.flags["foundry-war"].war = { team, group, abilities }
 */

import { getGroup, getGroups, openGroupManager } from "./war-groups.js";
import { commitWarState, getWarState } from "./war-panel.js";

const MODULE_ID = "foundry-war";
const FLAG_KEY = "war";
const ACTION_ID = "foundry-war-configure";
const MANAGE_ACTION_ID = "foundry-war-manage";
const TEAMS = ["ally", "enemy"];

/* -------------------------------------------------------------------------- */
/* Dati                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Per i token non linkati `actor` è un attore sintetico: la configurazione va
 * salvata sull'attore base, altrimenti i nuovi token creati trascinando
 * l'attore sulla scena non la ereditano.
 */
function getBaseActor(actor) {
  if (!actor?.isToken) return actor;

  const tokenDoc = actor.token;
  return (
    tokenDoc?.baseActor ??
    (tokenDoc?.actorId ? game.actors?.get(tokenDoc.actorId) : null) ??
    actor
  );
}

/**
 * Rimuove l'override locale del token, così continua a seguire l'attore base.
 * Restituisce false se l'override non è stato rimosso.
 */
async function clearTokenWarOverride(actor) {
  const delta = actor?.token?.delta;
  if (!delta || delta.flags?.[MODULE_ID]?.[FLAG_KEY] === undefined) return true;

  try {
    await delta.unsetFlag(MODULE_ID, FLAG_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Legge la configurazione War di un attore, con valori di default. */
export function getWarData(actor) {
  const data = actor?.getFlag(MODULE_ID, FLAG_KEY) ?? {};

  return {
    team: TEAMS.includes(data.team) ? data.team : "ally",
    troopType: typeof data.troopType === "string" ? data.troopType : "",
    group: typeof data.group === "string" ? data.group : "",
    abilities:
      data.abilities && typeof data.abilities === "object"
        ? { ...data.abilities }
        : {},
  };
}

/** Salva la configurazione War di un attore. */
export async function setWarData(actor, { team, troopType, group }) {
  if (!actor) throw new Error(`${MODULE_ID}: attore mancante`);

  const baseActor = getBaseActor(actor);
  const baseWar = baseActor && baseActor !== actor
    ? baseActor.getFlag(MODULE_ID, FLAG_KEY)
    : null;
  const previous = getWarData(baseWar ? baseActor : actor);
  const nextGroup = getGroup(group);
  const abilities = {};

  if (nextGroup) {
    for (const ability of nextGroup.abilities ?? []) {
      const previousValue =
        previous.group === nextGroup.name
          ? previous.abilities?.[ability.id]
          : undefined;

      abilities[ability.id] = previousValue ?? ability.defaultActive;
    }
  }

  const data = {
    team: TEAMS.includes(team) ? team : "ally",
    troopType: typeof troopType === "string" ? troopType : previous.troopType,
    group: nextGroup?.name ?? "",
    abilities,
  };

  let savedOnBase = false;
  if (baseActor && baseActor !== actor) {
    try {
      await baseActor.setFlag(MODULE_ID, FLAG_KEY, data);
      savedOnBase = true;
    } catch (error) {
      console.warn(`${MODULE_ID} | impossibile salvare la configurazione sull'attore base`, error);
    }
  }

  if (baseActor && baseActor !== actor && savedOnBase) {
    // Se il token aveva un override locale (salvataggi precedenti), lo
    // rimuoviamo: così tutti i token dello stesso attore restano allineati.
    const cleared = await clearTokenWarOverride(actor);
    if (!cleared) await actor.setFlag(MODULE_ID, FLAG_KEY, data);
  } else {
    await actor.setFlag(MODULE_ID, FLAG_KEY, data);
  }

  if (baseActor && baseActor !== actor && !savedOnBase) {
    ui.notifications.warn(game.i18n.localize("FOUNDRY-WAR.warnings.tokenOnly"));
  }

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

  // Se l'attore base ha già una configurazione, mostriamo quella: è il valore
  // che verrà ereditato dai nuovi token creati dalla sidebar.
  const baseActor = getBaseActor(actor);
  const baseWar = baseActor && baseActor !== actor
    ? baseActor.getFlag(MODULE_ID, FLAG_KEY)
    : null;
  const configActor = baseWar ? baseActor : actor;

  const current = getWarData(configActor);
  const groups = Object.keys(getGroups()).sort((a, b) => a.localeCompare(b));

  if (current.group && !groups.includes(current.group)) {
    groups.push(current.group);
  }

  const { escapeHTML } = foundry.utils;

  const groupOptions = groups
    .map(
      (name) =>
        `<option value="${escapeHTML(name)}"${name === current.group ? " selected" : ""}>${escapeHTML(name)}</option>`,
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
        <label>${game.i18n.localize("FOUNDRY-WAR.dialog.group.name")}</label>
        <div class="form-fields">
          <select name="group">
            <option value="">${game.i18n.localize("FOUNDRY-WAR.dialog.group.none")}</option>
            ${groupOptions}
          </select>
        </div>
        <p class="hint">${game.i18n.localize("FOUNDRY-WAR.dialog.group.hint")}</p>
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
          group: button.form.elements.group.value,
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

  const state = getWarState();
  await commitWarState({
    ...state,
    battle: { ...state.battle, roll: null },
  });

  ui.notifications.info(
    game.i18n.format("FOUNDRY-WAR.dialog.saved", { name: actor.name }),
  );
}

/* -------------------------------------------------------------------------- */
/* Menu "⋯" delle schede (ApplicationV2)                                      */
/* -------------------------------------------------------------------------- */

Hooks.on("getHeaderControlsActorSheetV2", (app, controls) => {
  // L'array può essere riutilizzato: evitiamo voci duplicate.
  if (!controls.some((control) => control.action === ACTION_ID)) {
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
  }

  if (game.user.isGM && !controls.some((control) => control.action === MANAGE_ACTION_ID)) {
    controls.push({
      action: MANAGE_ACTION_ID,
      icon: "fa-solid fa-users-gear",
      label: game.i18n.localize("FOUNDRY-WAR.header.manage"),
      onClick: () => openGroupManager(),
    });
  }
});

/* -------------------------------------------------------------------------- */
/* Fallback per le schede legacy (ApplicationV1)                              */
/* -------------------------------------------------------------------------- */

Hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
  if (!buttons.some((button) => button.class === "foundry-war-config")) {
    buttons.unshift({
      class: "foundry-war-config",
      label: game.i18n.localize("FOUNDRY-WAR.header.war"),
      icon: "fas fa-flag",
      onclick: () => openWarConfig(app.actor),
    });
  }

  if (game.user.isGM && !buttons.some((button) => button.class === "foundry-war-manage")) {
    buttons.push({
      class: "foundry-war-manage",
      label: game.i18n.localize("FOUNDRY-WAR.header.manage"),
      icon: "fas fa-users-gear",
      onclick: () => openGroupManager(),
    });
  }
});
