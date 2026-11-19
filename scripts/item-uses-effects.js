/**
 * Foundry War — effetti che leggono le cariche dell'oggetto.
 *
 * Su Foundry v13 / dnd5e 5.x gli effetti passivi vengono applicati con il
 * roll data dell'attore, quindi `@item.uses.value` non viene mai risolto.
 * Questo modulo lo rende possibile: se un change di un effetto ha come valore
 * una formula che contiene `@item.`, il GM la risolve con il roll data
 * dell'oggetto e scrive il numero nel change.
 *
 * La formula originale viene salvata in `flags["foundry-war"].usesFormula`
 * per poterla ricalcolare a ogni cambio di cariche.
 */

const MODULE_ID = "foundry-war";
const FLAG = "usesFormula";

function isFormula(change) {
  return typeof change.value === "string" && change.value.includes("@item.");
}

function itemRollData(item) {
  const data = item.getRollData?.() ?? {};
  const uses = data.item?.uses ?? item.system?.uses;

  // dnd5e 5.x salva `spent` e calcola `value` solo in prepareFinalData:
  // lo ricostruiamo per essere sicuri di averlo a disposizione.
  if (uses) {
    if (!Number.isFinite(Number(uses.value))) {
      const max = Number(uses.max) || 0;
      const spent = Number(uses.spent) || 0;
      uses.value = Math.max(0, max - spent);
    }
    if (data.item?.uses) data.item.uses.value = uses.value;
  }

  return data;
}

function resolveFormula(formula, item) {
  try {
    const rollData = itemRollData(item);
    const replaced = Roll.replaceFormulaData(formula, rollData, {
      missing: "0",
    });
    return String(Roll.safeEval(replaced));
  } catch (error) {
    console.warn(`${MODULE_ID} | formula non risolta: ${formula}`, error);
    return null;
  }
}

async function syncItem(item) {
  if (!game.user.isGM) return;
  if (!item?.parent) return;
  if (!item.effects?.size) return;

  for (const effect of item.effects) {
    const source = effect.toObject();
    const changes = source.changes ?? [];
    if (!changes.length) continue;

    const stored = effect.getFlag(MODULE_ID, FLAG) ?? {};
    const next = { ...stored };
    let dirty = false;

    for (const change of changes) {
      const id = change._id ?? change.key;

      // Adotta la formula se il change ne contiene una (prima volta o dopo una modifica).
      if (isFormula(change) && change.value !== next[id]) {
        next[id] = change.value;
        dirty = true;
      }

      const formula = next[id];
      if (!formula) continue;

      const value = resolveFormula(formula, item);
      if (value !== null && change.value !== value) {
        change.value = value;
        dirty = true;
      }
    }

    if (!dirty) continue;

    await effect.update(
      {
        changes,
        [`flags.${MODULE_ID}.${FLAG}`]: next,
      },
      { render: false },
    );
  }
}

function syncAll() {
  if (!game.user.isGM) return;

  for (const actor of game.actors ?? []) {
    for (const item of actor.items ?? []) syncItem(item);
  }

  // Token non linkati: gli attori sintetici non stanno in game.actors.
  for (const token of canvas.tokens?.placeables ?? []) {
    for (const item of token.actor?.items ?? []) syncItem(item);
  }
}

Hooks.once("ready", syncAll);

Hooks.on("createItem", (item) => syncItem(item));
Hooks.on("updateItem", (item) => syncItem(item));

Hooks.on("createActiveEffect", (effect) => {
  if (effect.parent?.documentName === "Item") syncItem(effect.parent);
});

Hooks.on("updateActiveEffect", (effect) => {
  if (effect.parent?.documentName === "Item") syncItem(effect.parent);
});

Hooks.once("ready", () => {
  game.foundryWar ??= {};
  game.foundryWar.syncItemUses = (itemOrActor) => {
    if (itemOrActor?.items) {
      for (const item of itemOrActor.items) syncItem(item);
      return;
    }
    if (itemOrActor) syncItem(itemOrActor);
  };
});
