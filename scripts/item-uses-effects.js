/**
 * Foundry War — effetti che leggono le cariche dell'oggetto.
 *
 * Su Foundry v13 / dnd5e 5.x gli effetti passivi usano il roll data
 * dell'attore, quindi `@item.uses.value` non viene risolto.
 *
 * Qui il GM risolve la formula con il roll data dell'OGGETTO e scrive il
 * numero nel change. La formula originale resta in
 * `flags["foundry-war"].usesFormula`, così viene ricalcolata a ogni uso.
 *
 * IMPORTANTE: dnd5e 5.x salva `uses.spent` e calcola `uses.value` solo in
 * `prepareFinalData`. All'istante dell'hook `value` può essere ancora 0,
 * quindi il valore viene SEMPRE ricalcolato come `max - spent`.
 */

const MODULE_ID = "foundry-war";
const FLAG = "usesFormula";

function isFormula(change) {
  return typeof change.value === "string" && change.value.includes("@item.");
}

/**
 * Cariche calcolate dai campi persistenti, mai da `value`.
 * @returns {{value: number, max: number, spent: number, label: string, recovery: object[]}}
 */
function usesData(item) {
  const prepared = item.system?.uses ?? {};
  const source = item._source?.system?.uses ?? {};

  const maxRaw = prepared.max ?? source.max ?? 0;
  const max = Number(maxRaw);
  const spent = Number(prepared.spent ?? source.spent ?? 0);

  const value =
    Number.isFinite(max) && Number.isFinite(spent)
      ? Math.max(0, max - spent)
      : Math.max(0, Number(prepared.value) || 0);

  return {
    max: Number.isFinite(max) ? max : 0,
    spent: Number.isFinite(spent) ? spent : 0,
    value,
    label: prepared.label ?? "",
    recovery: prepared.recovery ?? [],
  };
}

/** Roll data con `item.uses` sempre allineato alle cariche reali. */
function itemRollData(item) {
  const base = item.getRollData?.() ?? {};
  const system = item.system ?? {};
  const uses = usesData(item);

  const itemData = {
    ...(base.item ?? {}),
    ...system,
    system, // alias per @item.system.uses.value
    uses, // @item.uses.value / .max / .spent
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
    const value = Roll.safeEval(replaced);
    return Number.isFinite(Number(value)) ? String(value) : null;
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

      // Adotta la formula quando il change ne contiene una.
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
      console.warn(`${MODULE_ID} | update effetto "${effect.name}" fallito`, error);
    }
  }
}

function syncAll() {
  if (!game.user.isGM) return;

  for (const actor of game.actors ?? []) {
    for (const item of actor.items ?? []) syncItem(item);
  }

  // Token non linkati: attori sintetici fuori da game.actors.
  for (const token of canvas.tokens?.placeables ?? []) {
    for (const item of token.actor?.items ?? []) syncItem(item);
  }
}

function debugItem(item) {
  const report = {
    version: game.modules.get(MODULE_ID)?.version,
    isGM: game.user.isGM,
    item: item?.name ?? null,
    computedUses: item ? usesData(item) : null,
    rollDataItem: item ? itemRollData(item).item?.uses ?? null : null,
    effects: [],
  };

  for (const effect of item?.effects ?? []) {
    report.effects.push({
      name: effect.name,
      changes: (effect.changes ?? []).map((change) => ({
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
  game.foundryWar.computeItemUses = (item) => usesData(item);
});
