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

/**
 * Roll data dell'oggetto con `item.uses` sempre completo.
 * dnd5e 5.x salva `spent` e calcola `value` solo alla fine della preparazione.
 */
function itemRollData(item) {
  const base = item.getRollData?.() ?? {};
  const system = item.system ?? {};
  const uses = { ...(system.uses ?? {}) };

  const max = Number(uses.max);
  const spent = Number(uses.spent);
  const value = Number(uses.value);

  uses.max = Number.isFinite(max) ? max : 0;
  uses.spent = Number.isFinite(spent) ? spent : 0;
  uses.value = Number.isFinite(value)
    ? value
    : Math.max(0, uses.max - uses.spent);

  const itemData = {
    ...(base.item ?? {}),
    ...system,
    system, // alias: accetta anche @item.system.uses.value
    uses,
    name: item.name,
    _id: item.id,
  };

  return { ...base, item: itemData };
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

      // Adotta la formula se il change ne contiene una (prima volta o modifica).
      if (isFormula(change) && change.value !== next[id]) {
        next[id] = change.value;
        dirty = true;
      }

      const formula = next[id];
      if (!formula) continue;

      const value = resolveFormula(formula, item);
      if (value === null) continue;

      if (change.value !== value) {
        change.value = value;
        dirty = true;
      }
    }

    if (!dirty) continue;

    try {
      await effect.update(
        {
          changes,
          [`flags.${MODULE_ID}.${FLAG}`]: next,
        },
        { render: false },
      );
    } catch (error) {
      console.warn(`${MODULE_ID} | impossibile aggiornare l'effetto ${effect.name}`, error);
    }
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

/** Report leggibile per capire cosa vede il modulo. */
function debugItem(item) {
  const report = {
    version: game.modules.get(MODULE_ID)?.version,
    isGM: game.user.isGM,
    item: item?.name ?? null,
    uses: item?.system?.uses ? { ...item.system.uses } : null,
    itemsUses: itemRollData(item).item?.uses ?? null,
    effects: [],
  };

  for (const effect of item?.effects ?? []) {
    report.effects.push({
      name: effect.name,
      disabled: effect.disabled,
      changes: (effect.changes ?? []).map((change) => ({
        _id: change._id,
        key: change.key,
        type: change.type,
        value: change.value,
      })),
      stored: effect.getFlag(MODULE_ID, FLAG) ?? null,
    });
  }

  console.log(`${MODULE_ID} | debug`, report);
  return report;
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
  game.foundryWar.syncItemUses = (target) => {
    if (target?.items) {
      for (const item of target.items) syncItem(item);
      return;
    }
    if (target) syncItem(target);
  };
  game.foundryWar.debugItemUses = debugItem;
});
