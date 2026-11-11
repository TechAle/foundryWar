/**
 * Foundry War - Economia del Forte Pernovo.
 *
 * Tutto lo stato è in una world setting (`economyState`), quindi condiviso.
 * I client senza permessi di modifica passano dal socket al GM.
 * Le spedizioni/battaglie arrivate diventano "pending": bloccano l'avanzamento
 * e si risolvono con gli input nel pannello.
 */

const MODULE_ID = "foundry-war";
const SETTING = "economyState";
const LOG_LIMIT = 200;

const DEFAULT_STATE = {
  day: 1,
  popTotal: 200,
  resources: {
    food: 20,
    wood: 80,
    ore: 350,
    equipment: 5,
    mounts: 0,
    defenses: 4,
    siege: 2,
    soldiers: 25,
  },
  damaged: { bridge: false, surroundings: false, inner: false, port: false },
  fortifications: { outerWall: 1, innerWall: 1, bridges: 1, port: 0, surroundings: 0 },
  siegeLocations: { surroundings: 0, port: 0, inner: 0, bridge: 0 },
  workers: { foodProducers: 135, woodProducers: 5, oreProducers: 10 },
  craftedToday: { equipment: 0, mounts: 0, defenses: 0, siege: 0 },
  trades: [],
  battles: [],
  logs: ["Forte Pernovo operativo. Popolazione 200 (25 inattivi), Presidio di 25 Soldati pronto."],
};

const RESOURCE_LABELS = {
  food: "Cibo",
  wood: "Legna",
  ore: "Minerali",
  equipment: "Equipaggiamento",
  mounts: "Cavalcature",
  defenses: "Fortificazioni",
  siege: "Macchine d'Assalto",
  soldiers: "Soldati",
  popTotal: "Popolazione",
};

const SITE_LABELS = {
  surroundings: "Zone Limitrofe",
  port: "Porto",
  inner: "Zone Interne",
  bridge: "Ponte",
  outerWall: "Muro Esterno",
  innerWall: "Muro Interno",
  bridges: "Ponti",
};

const WORKER_LABELS = {
  foodProducers: "Agricoltori",
  woodProducers: "Taglialegna",
  oreProducers: "Minatori",
};

const RECIPES = {
  equipment: { ore: 40, wood: 20, food: 0 },
  mounts: { ore: 10, wood: 0, food: 20 },
  defenses: { ore: 50, wood: 30, food: 0 },
  siege: { ore: 150, wood: 100, food: 0 },
};

/* -------------------------------------------------------------------------- */
/* Stato condiviso                                                            */
/* -------------------------------------------------------------------------- */

function cloneDefault() {
  return foundry.utils.deepClone(DEFAULT_STATE);
}

function normalizeTrade(trade) {
  return {
    ...trade,
    id: Number(trade.id) || Date.now() * 1000 + Math.floor(Math.random() * 1000),
    sentAmount: Number(trade.sentAmount) || 0,
    baseTargetReceive:
      Number(trade.baseTargetReceive) || Number(trade.expectedReturn) || 0,
    expectedReturn: Number(trade.expectedReturn) || 0,
    soldiersSent: Number(trade.soldiersSent) || 0,
    totalDays: Number(trade.totalDays) || Number(trade.daysRemaining) || 7,
    daysRemaining: Number(trade.daysRemaining) || 0,
    isRepeat: Boolean(trade.isRepeat),
    useMount: Boolean(trade.useMount),
    pendingArrival: Boolean(trade.pendingArrival),
  };
}

function normalizeBattle(battle) {
  return {
    ...battle,
    id: Number(battle.id) || Date.now() * 1000 + Math.floor(Math.random() * 1000),
    soldiersSent: Number(battle.soldiersSent) || 0,
    daysRemaining: Number(battle.daysRemaining) || 0,
    pendingEnd: Boolean(battle.pendingEnd),
  };
}

export function normalizeEconomyState(saved) {
  const base = cloneDefault();
  if (!saved || typeof saved !== "object") return base;

  const resources = { ...base.resources, ...(saved.resources || {}) };
  for (const key of Object.keys(resources)) {
    resources[key] = Number(resources[key]) || 0;
  }

  const workers = { ...base.workers, ...(saved.workers || {}) };
  for (const key of Object.keys(workers)) {
    workers[key] = Math.max(0, Math.floor(Number(workers[key]) || 0));
  }

  const fortifications = { ...base.fortifications, ...(saved.fortifications || {}) };
  for (const key of Object.keys(fortifications)) {
    fortifications[key] = Math.max(0, Math.floor(Number(fortifications[key]) || 0));
  }

  const siegeLocations = { ...base.siegeLocations, ...(saved.siegeLocations || {}) };
  for (const key of Object.keys(siegeLocations)) {
    siegeLocations[key] = Math.max(0, Math.floor(Number(siegeLocations[key]) || 0));
  }

  const craftedToday = { ...base.craftedToday, ...(saved.craftedToday || {}) };
  for (const key of Object.keys(craftedToday)) {
    craftedToday[key] = Math.max(0, Math.floor(Number(craftedToday[key]) || 0));
  }

  return {
    ...base,
    ...saved,
    day: Math.max(1, Math.floor(Number(saved.day) || 1)),
    popTotal: Math.max(0, Math.floor(Number(saved.popTotal) || 0)),
    resources,
    damaged: { ...base.damaged, ...(saved.damaged || {}) },
    fortifications,
    siegeLocations,
    workers,
    craftedToday,
    trades: Array.isArray(saved.trades) ? saved.trades.map(normalizeTrade) : [],
    battles: Array.isArray(saved.battles) ? saved.battles.map(normalizeBattle) : [],
    logs: Array.isArray(saved.logs) ? saved.logs : base.logs.slice(),
  };
}

export function getEconomyState() {
  return normalizeEconomyState(game.settings.get(MODULE_ID, SETTING));
}

export async function commitEconomyState(next) {
  const normalized = normalizeEconomyState(next);

  if (game.user.isGM) {
    return game.settings.set(MODULE_ID, SETTING, normalized);
  }

  game.socket.emit(`module.${MODULE_ID}`, {
    type: "setEconomyState",
    state: normalized,
  });
  return null;
}

/* -------------------------------------------------------------------------- */
/* Utility                                                                    */
/* -------------------------------------------------------------------------- */

function makeId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function getTotalAssignedForts(state) {
  const f = state.fortifications;
  return (f.outerWall || 0) + (f.innerWall || 0) + (f.bridges || 0) + (f.port || 0) + (f.surroundings || 0);
}

function getTotalAssignedSiege(state) {
  const s = state.siegeLocations;
  return (s.surroundings || 0) + (s.port || 0) + (s.inner || 0) + (s.bridge || 0);
}

function getUnassignedPop(state) {
  return (
    state.popTotal -
    (state.workers.foodProducers +
      state.workers.woodProducers +
      state.workers.oreProducers +
      state.resources.soldiers)
  );
}

function hasPending(state) {
  return (
    state.trades.some((trade) => trade.pendingArrival) ||
    state.battles.some((battle) => battle.pendingEnd)
  );
}

function logEconomy(state, message, type = "info") {
  const week = Math.floor((state.day - 1) / 7) + 1;
  const who = game.user?.name ? `[${game.user.name}] ` : "";
  state.logs.unshift({
    text: `[Giorno ${state.day} / Sett. ${week}] ${who}${message}`,
    type,
  });
  if (state.logs.length > LOG_LIMIT) state.logs.pop();
}

function autoAdjustWorkers(state) {
  const adjusted = { foodProducers: 0, woodProducers: 0, oreProducers: 0, soldiers: 0 };

  while (getUnassignedPop(state) < 0) {
    if (state.workers.foodProducers > 0) {
      state.workers.foodProducers -= 1;
      adjusted.foodProducers += 1;
    } else if (state.workers.oreProducers > 0) {
      state.workers.oreProducers -= 1;
      adjusted.oreProducers += 1;
    } else if (state.workers.woodProducers > 0) {
      state.workers.woodProducers -= 1;
      adjusted.woodProducers += 1;
    } else if (state.resources.soldiers > 0) {
      state.resources.soldiers -= 1;
      adjusted.soldiers += 1;
    } else {
      break;
    }
  }

  const parts = [];
  if (adjusted.foodProducers) parts.push(`-${adjusted.foodProducers} Agricoltori`);
  if (adjusted.oreProducers) parts.push(`-${adjusted.oreProducers} Minatori`);
  if (adjusted.woodProducers) parts.push(`-${adjusted.woodProducers} Taglialegna`);
  if (adjusted.soldiers) parts.push(`-${adjusted.soldiers} Soldati`);

  if (parts.length) {
    logEconomy(state, `Riorganizzazione automatica: ${parts.join(", ")}.`, "warn");
  }
}

function calculateTradeTaxRate(state, useMount) {
  let tax = useMount ? 0.05 : 0.1;
  if (state.damaged.port) tax += 0.1;
  if (state.damaged.bridge) tax += 0.05;
  if (state.damaged.surroundings) tax += 0.05;
  return tax;
}

function productionSummary(state) {
  const foodPerWorker = state.damaged.surroundings ? 0.75 : 1.5;
  const woodPerWorker = state.damaged.bridge ? 0.5 : 1;
  const orePerWorker = state.damaged.inner ? 3 : 6;

  const foodProd = state.workers.foodProducers * foodPerWorker;
  const woodProd = state.workers.woodProducers * woodPerWorker;
  const oreProd = state.workers.oreProducers * orePerWorker;
  const foodCons = state.popTotal;

  const tradeNet = { food: 0, wood: 0, ore: 0 };
  const singleIncoming = { food: 0, wood: 0, ore: 0 };

  for (const trade of state.trades) {
    if (trade.pendingArrival) continue;

    if (trade.isRepeat) {
      let weeks = (Number(trade.totalDays) || 7) / 7;
      if (!Number.isFinite(weeks) || weeks <= 0) weeks = 1;
      tradeNet[trade.sellRes] -= trade.sentAmount / weeks;
      tradeNet[trade.buyRes] += trade.expectedReturn / weeks;
    } else {
      singleIncoming[trade.buyRes] += trade.expectedReturn;
    }
  }

  return {
    foodPerWorker,
    woodPerWorker,
    orePerWorker,
    foodProd,
    woodProd,
    oreProd,
    foodCons,
    tradeNet,
    singleIncoming,
    foodDelta: foodProd - foodCons + tradeNet.food,
    woodDelta: woodProd + tradeNet.wood,
    oreDelta: oreProd + tradeNet.ore,
  };
}

/* -------------------------------------------------------------------------- */
/* Azioni                                                                     */
/* -------------------------------------------------------------------------- */

export function advanceEconomy(input, daysToAdvance) {
  const state = normalizeEconomyState(input);
  if (hasPending(state)) return { error: "pending" };

  const days = Number(daysToAdvance) || 1;
  const factor = days / 7;

  const foodPerWorker = state.damaged.surroundings ? 0.75 : 1.5;
  const woodPerWorker = state.damaged.bridge ? 0.5 : 1;
  const orePerWorker = state.damaged.inner ? 3 : 6;

  const foodProduced = state.workers.foodProducers * foodPerWorker * factor;
  const woodProduced = state.workers.woodProducers * woodPerWorker * factor;
  const oreProduced = state.workers.oreProducers * orePerWorker * factor;
  const foodConsumed = state.popTotal * factor;

  state.resources.food += foodProduced - foodConsumed;
  state.resources.wood += woodProduced;
  state.resources.ore += oreProduced;
  state.day += days;
  state.craftedToday = { equipment: 0, mounts: 0, defenses: 0, siege: 0 };

  if (state.resources.food < 0) {
    const shortage = Math.abs(state.resources.food);
    state.resources.food = 0;
    const dead = Math.ceil(shortage / 2) + 1;
    state.popTotal = Math.max(0, state.popTotal - dead);
    logEconomy(state, `CARESTIA! Sono morti ${dead} cittadini per mancanza di cibo.`, "warn");
    autoAdjustWorkers(state);
  } else {
    logEconomy(
      state,
      `Avanzamento di ${days} ${days === 1 ? "giorno" : "giorni"}: prodotti ${foodProduced.toFixed(1)} Cibo, ${woodProduced.toFixed(1)} Legna, ${oreProduced.toFixed(1)} Minerali. Consumati ${foodConsumed.toFixed(1)} Cibo.`,
    );
  }

  for (const trade of state.trades) {
    trade.daysRemaining -= days;
    if (trade.daysRemaining <= 0 && !trade.pendingArrival) {
      trade.pendingArrival = true;
      logEconomy(state, `SPEDIZIONE ARRIVATA: '${trade.name}' in attesa di rapporto.`, "warn");
    }
  }

  for (const battle of state.battles) {
    battle.daysRemaining -= days;
    if (battle.daysRemaining <= 0 && !battle.pendingEnd) {
      battle.pendingEnd = true;
      logEconomy(state, `BATTAGLIA TERMINATA: '${battle.name}' in attesa di rapporto.`, "warn");
    }
  }

  return { state };
}

export function resolveEconomyTrade(input, tradeId, returnedSoldiers) {
  const state = normalizeEconomyState(input);
  const trade = state.trades.find((entry) => entry.id === Number(tradeId));
  if (!trade || !trade.pendingArrival) return { error: "missing" };

  let returned = Math.floor(Number(returnedSoldiers));
  if (!Number.isFinite(returned) || returned < 0) returned = 0;
  returned = Math.min(returned, trade.soldiersSent);

  const allDead = trade.soldiersSent > 0 && returned === 0;

  if (allDead) {
    state.popTotal = Math.max(0, state.popTotal - trade.soldiersSent);
    logEconomy(
      state,
      `RAPPORTO SPEDIZIONE: '${trade.name}' sterminata! Nessun soldato tornato, risorse perdute.`,
      "warn",
    );
  } else {
    state.resources[trade.buyRes] += trade.expectedReturn;
    state.resources.soldiers += returned;

    const losses = trade.soldiersSent - returned;
    let recovered = 0;

    if (returned > 1 && losses > 0) {
      recovered = Math.floor(losses / 2);
      state.resources.equipment += recovered;
    }

    if (losses > 0) {
      state.popTotal = Math.max(0, state.popTotal - losses);
      logEconomy(
        state,
        `SPEDIZIONE ARRIVATA! '${trade.name}' ha consegnato +${trade.expectedReturn.toFixed(1)} ${RESOURCE_LABELS[trade.buyRes]}. Tornati ${returned}/${trade.soldiersSent} (${losses} caduti${recovered ? `, +${recovered} Equipaggiamento` : ""}).`,
        "warn",
      );
    } else if (trade.soldiersSent > 0) {
      logEconomy(
        state,
        `SPEDIZIONE ARRIVATA! '${trade.name}' ha consegnato +${trade.expectedReturn.toFixed(1)} ${RESOURCE_LABELS[trade.buyRes]}. Tutti i ${returned} soldati sono rientrati.`,
      );
    } else {
      logEconomy(
        state,
        `SPEDIZIONE ARRIVATA! '${trade.name}' ha consegnato +${trade.expectedReturn.toFixed(1)} ${RESOURCE_LABELS[trade.buyRes]} (nessuna scorta).`,
      );
    }
  }

  autoAdjustWorkers(state);

  if (allDead) {
    state.trades = state.trades.filter((entry) => entry.id !== trade.id);
  } else if (trade.isRepeat) {
    if (
      state.resources[trade.sellRes] < trade.sentAmount ||
      state.resources.soldiers < trade.soldiersSent
    ) {
      logEconomy(
        state,
        `ROTTA SOSPESA: '${trade.name}' interrotta per insufficienza di risorse o soldati.`,
        "warn",
      );
      state.trades = state.trades.filter((entry) => entry.id !== trade.id);
    } else {
      state.resources[trade.sellRes] -= trade.sentAmount;
      state.resources.soldiers -= trade.soldiersSent;

      let effectiveUseMount = false;
      if (trade.useMount) {
        if (state.resources.mounts >= 1) {
          state.resources.mounts -= 1;
          effectiveUseMount = true;
          logEconomy(state, `Rotta '${trade.name}': impiegata 1 Cavalcatura per il rinnovo.`);
        } else {
          logEconomy(state, `Rotta '${trade.name}': cavalcature esaurite, prosegue a piedi.`, "warn");
          trade.useMount = false;
        }
      }

      const cycleDays = effectiveUseMount ? 7 : 14;
      trade.daysRemaining = cycleDays + trade.daysRemaining;
      trade.totalDays = cycleDays;
      trade.expectedReturn =
        trade.baseTargetReceive * (1 - calculateTradeTaxRate(state, effectiveUseMount));
      trade.pendingArrival = false;

      logEconomy(
        state,
        `RINNOVO ROTTA: '${trade.name}' ripartita con ${trade.sentAmount.toFixed(1)} ${RESOURCE_LABELS[trade.sellRes]} e ${trade.soldiersSent} Soldati. Ciclo ${cycleDays} giorni.`,
      );
    }
  } else {
    state.trades = state.trades.filter((entry) => entry.id !== trade.id);
  }

  return { state };
}

export function resolveEconomyBattle(input, battleId, report) {
  const state = normalizeEconomyState(input);
  const battle = state.battles.find((entry) => entry.id === Number(battleId));
  if (!battle || !battle.pendingEnd) return { error: "missing" };

  let returned = Math.floor(Number(report.soldiers));
  if (!Number.isFinite(returned) || returned < 0) returned = 0;
  returned = Math.min(returned, battle.soldiersSent);

  const lootFood = Math.max(0, Number(report.food) || 0);
  const lootOre = Math.max(0, Number(report.ore) || 0);
  const lootWood = Math.max(0, Number(report.wood) || 0);

  if (returned === 0) {
    state.popTotal = Math.max(0, state.popTotal - battle.soldiersSent);
    logEconomy(
      state,
      `DISFATTA MILITARE: '${battle.name}' annientata. ${battle.soldiersSent} soldati caduti, loot perduto.`,
      "warn",
    );
  } else {
    state.resources.soldiers += returned;
    state.resources.food += lootFood;
    state.resources.ore += lootOre;
    state.resources.wood += lootWood;

    const losses = battle.soldiersSent - returned;
    let recovered = 0;

    if (returned >= 1 && losses > 0) {
      recovered = Math.floor(losses / 2);
      state.resources.equipment += recovered;
    }

    if (losses > 0) {
      state.popTotal = Math.max(0, state.popTotal - losses);
      logEconomy(
        state,
        `BATTAGLIA '${battle.name}': tornati ${returned}/${battle.soldiersSent} (${losses} caduti${recovered ? `, +${recovered} Equipaggiamento` : ""}). Bottino: +${lootFood} Cibo, +${lootWood} Legna, +${lootOre} Minerali.`,
        "warn",
      );
    } else {
      logEconomy(
        state,
        `VITTORIA! '${battle.name}': tutti i ${returned} soldati rientrati. Bottino: +${lootFood} Cibo, +${lootWood} Legna, +${lootOre} Minerali.`,
      );
    }
  }

  autoAdjustWorkers(state);
  state.battles = state.battles.filter((entry) => entry.id !== battle.id);

  return { state };
}

export function startEconomyTrade(input, data) {
  const state = normalizeEconomyState(input);
  const sellRes = data.sellRes;
  const buyRes = data.buyRes;
  const amountSend = Number(data.amountSend);
  const amountReceive = Number(data.amountReceive);
  const soldiersSend = Math.max(0, Math.floor(Number(data.soldiersSend) || 0));
  const useMount = Boolean(data.useMount);
  const isRepeat = Boolean(data.isRepeat);

  if (sellRes === buyRes) return { error: "sameResource" };
  if (!Number.isFinite(amountSend) || amountSend <= 0 || !Number.isFinite(amountReceive) || amountReceive <= 0) {
    return { error: "invalidAmounts" };
  }
  if (state.resources[sellRes] < amountSend) return { error: "insufficientResource" };
  if (state.resources.soldiers < soldiersSend) return { error: "insufficientSoldiers" };
  if (useMount && state.resources.mounts < 1) return { error: "insufficientMounts" };

  state.resources[sellRes] -= amountSend;
  state.resources.soldiers -= soldiersSend;
  if (useMount) state.resources.mounts -= 1;

  const tax = calculateTradeTaxRate(state, useMount);
  const expectedReturn = amountReceive * (1 - tax);
  const delay = useMount ? 7 : 14;
  const name = String(data.name || `Scambio ${RESOURCE_LABELS[sellRes]}`);

  state.trades.push({
    id: makeId(),
    name,
    sellRes,
    buyRes,
    sentAmount: amountSend,
    baseTargetReceive: amountReceive,
    expectedReturn,
    soldiersSent: soldiersSend,
    useMount,
    daysRemaining: delay,
    totalDays: delay,
    isRepeat,
    pendingArrival: false,
  });

  logEconomy(
    state,
    `Spedizione '${name}' avviata: inviati ${amountSend.toFixed(1)} ${RESOURCE_LABELS[sellRes]} con ${soldiersSend} Soldati. Attesi ${expectedReturn.toFixed(1)} ${RESOURCE_LABELS[buyRes]} in ${delay} giorni.`,
  );

  return { state };
}

export function startEconomyBattle(input, data) {
  const state = normalizeEconomyState(input);
  const soldiers = Math.max(0, Math.floor(Number(data.soldiers) || 0));
  const days = Math.max(1, Math.floor(Number(data.days) || 1));

  if (soldiers <= 0) return { error: "invalidSoldiers" };
  if (state.resources.soldiers < soldiers) return { error: "insufficientSoldiers" };
  if (state.resources.food < soldiers) return { error: "insufficientFood" };

  state.resources.soldiers -= soldiers;
  state.resources.food -= soldiers;

  const name = String(data.name || "Battaglia");
  state.battles.push({
    id: makeId(),
    name,
    soldiersSent: soldiers,
    daysRemaining: days,
    pendingEnd: false,
  });

  logEconomy(
    state,
    `CAMPAGNA AVVIATA: '${name}' con ${soldiers} soldati (rancio ${soldiers} Cibo), durata ${days} giorni.`,
  );

  return { state };
}

export function changeEconomyWorker(input, role, delta) {
  const state = normalizeEconomyState(input);
  const amount = Number(delta) || 0;
  if (!(role in state.workers)) return { error: "invalidRole" };
  if (amount > 0 && getUnassignedPop(state) <= 0) return { error: "noIdle" };
  if (state.workers[role] + amount < 0) return {};

  state.workers[role] += amount;
  logEconomy(
    state,
    `${WORKER_LABELS[role] || role}: ${state.workers[role]} (inattivi ${Math.max(0, getUnassignedPop(state))}).`,
  );
  return { state };
}

export function changeEconomyFort(input, site, delta) {
  const state = normalizeEconomyState(input);
  if (!(site in state.fortifications)) return { error: "invalidStructure" };

  const amount = Number(delta) || 0;
  const current = state.fortifications[site] || 0;

  if (amount > 0) {
    if (current >= 1) return { error: "maxFort" };
    if (getTotalAssignedForts(state) >= state.resources.defenses) return { error: "noForts" };
  } else if (current <= 0) {
    return {};
  }

  state.fortifications[site] = current + amount;
  logEconomy(
    state,
    `Fortificazioni a '${SITE_LABELS[site] || site}': ${state.fortifications[site]} (${getTotalAssignedForts(state)}/${state.resources.defenses}).`,
  );
  return { state };
}

export function changeEconomySiege(input, site, delta) {
  const state = normalizeEconomyState(input);
  if (!(site in state.siegeLocations)) return { error: "invalidStructure" };

  const amount = Number(delta) || 0;
  const current = state.siegeLocations[site] || 0;

  if (amount > 0) {
    if (getTotalAssignedSiege(state) >= state.resources.siege) return { error: "noSiege" };
  } else if (current <= 0) {
    return {};
  }

  state.siegeLocations[site] = current + amount;
  logEconomy(
    state,
    `Macchine d'assalto a '${SITE_LABELS[site] || site}': ${state.siegeLocations[site]}.`,
  );
  return { state };
}

export function craftEconomy(input, type) {
  const state = normalizeEconomyState(input);
  const recipe = RECIPES[type];
  if (!recipe) return { error: "invalidRecipe" };

  if (
    state.resources.ore < recipe.ore ||
    state.resources.wood < recipe.wood ||
    state.resources.food < recipe.food
  ) {
    return { error: "insufficientCraft" };
  }

  state.resources.ore -= recipe.ore;
  state.resources.wood -= recipe.wood;
  state.resources.food -= recipe.food;
  state.resources[type] += 1;
  state.craftedToday[type] = (state.craftedToday[type] || 0) + 1;

  logEconomy(state, `Prodotto 1x ${RESOURCE_LABELS[type]}. (Annullabile)`);
  return { state };
}

export function rollbackEconomyCraft(input, type) {
  const state = normalizeEconomyState(input);
  if (!state.craftedToday[type]) return { error: "nothingToRollback" };

  if (type === "defenses" && state.resources.defenses <= getTotalAssignedForts(state)) {
    return { error: "assignedForts" };
  }
  if (type === "siege" && state.resources.siege <= getTotalAssignedSiege(state)) {
    return { error: "assignedSiege" };
  }

  const recipe = RECIPES[type];
  state.resources.ore += recipe.ore;
  state.resources.wood += recipe.wood;
  state.resources.food += recipe.food;
  state.resources[type] -= 1;
  state.craftedToday[type] -= 1;

  logEconomy(state, `Annullata produzione di 1x ${RESOURCE_LABELS[type]}. Risorse rimborsate.`);
  return { state };
}

export function trainEconomySoldier(input) {
  const state = normalizeEconomyState(input);
  if (getUnassignedPop(state) <= 0) return { error: "noIdle" };
  if (state.resources.equipment <= 0) return { error: "noEquipment" };

  state.resources.soldiers += 1;
  state.resources.equipment -= 1;
  logEconomy(state, "Arruolato 1 Soldato (-1 Equipaggiamento).");
  return { state };
}

export function dismissEconomySoldier(input) {
  const state = normalizeEconomyState(input);
  if (state.resources.soldiers <= 0) return { error: "noSoldiers" };

  state.resources.soldiers -= 1;
  state.resources.equipment += 1;
  logEconomy(state, "Congedato 1 Soldato (+1 Equipaggiamento).");
  return { state };
}

export function toggleEconomyDamage(input, structure) {
  const state = normalizeEconomyState(input);
  if (!(structure in state.damaged)) return { error: "invalidStructure" };

  state.damaged[structure] = !state.damaged[structure];
  logEconomy(
    state,
    `Infrastruttura '${SITE_LABELS[structure] || structure}': ${state.damaged[structure] ? "danneggiata" : "integra"}.`,
    state.damaged[structure] ? "warn" : "info",
  );
  return { state };
}

export function repairEconomyStructure(input, structure) {
  const state = normalizeEconomyState(input);
  if (!(structure in state.damaged)) return { error: "invalidStructure" };

  const map = {
    bridge: "bridges",
    surroundings: "surroundings",
    inner: "innerWall",
    port: "port",
  };

  if (!state.damaged[structure]) return { error: "notDamaged" };
  if (state.resources.defenses <= 0) return { error: "noDefenses" };

  state.resources.defenses -= 1;
  if (state.fortifications[map[structure]] > 0) {
    state.fortifications[map[structure]] -= 1;
  }
  state.damaged[structure] = false;

  logEconomy(state, `Riparata '${SITE_LABELS[structure] || structure}' consumando 1 Fortificazione.`);
  return { state };
}

export function applyEconomyArbitrary(input, data) {
  const state = normalizeEconomyState(input);
  const type = data.type;
  const reason = String(data.reason || "Modifica del Master / Evento");

  if (type !== "popTotal" && type !== "soldiers" && !(type in state.resources)) {
    return { error: "invalidResource" };
  }

  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount === 0) return { error: "invalidAmount" };

  if (type === "popTotal") {
    state.popTotal = Math.max(0, state.popTotal + Math.floor(amount));
    autoAdjustWorkers(state);
  } else if (type === "soldiers") {
    const delta = Math.trunc(amount);
    state.resources.soldiers = Math.max(0, state.resources.soldiers + delta);
    state.popTotal = Math.max(0, state.popTotal + delta);
    autoAdjustWorkers(state);
  } else {
    state.resources[type] = Math.max(0, (state.resources[type] || 0) + amount);
  }

  logEconomy(
    state,
    `[MODIFICA EVENTO] ${amount >= 0 ? "+" : ""}${amount.toFixed(1)} ${RESOURCE_LABELS[type] || type}. Motivo: "${reason}"`,
    "dm",
  );
  return { state };
}

export function cancelEconomyTrade(input, tradeId) {
  const state = normalizeEconomyState(input);
  const trade = state.trades.find((entry) => entry.id === Number(tradeId));
  if (!trade) return { error: "missing" };

  state.resources[trade.sellRes] += trade.sentAmount;
  state.resources.soldiers += trade.soldiersSent;
  if (trade.useMount) state.resources.mounts += 1;

  logEconomy(
    state,
    `Spedizione '${trade.name}' annullata. Rimborsati ${trade.sentAmount.toFixed(1)} ${RESOURCE_LABELS[trade.sellRes]}, ${trade.soldiersSent} Soldati${trade.useMount ? " e 1 Cavalcatura" : ""}.`,
  );
  state.trades = state.trades.filter((entry) => entry.id !== trade.id);
  return { state };
}

export function cancelEconomyBattle(input, battleId) {
  const state = normalizeEconomyState(input);
  const battle = state.battles.find((entry) => entry.id === Number(battleId));
  if (!battle) return { error: "missing" };

  state.resources.soldiers += battle.soldiersSent;
  logEconomy(state, `Battaglia '${battle.name}' ritirata. Rimborsati ${battle.soldiersSent} soldati.`);
  state.battles = state.battles.filter((entry) => entry.id !== battle.id);
  return { state };
}

export function toggleEconomyRepeat(input, tradeId) {
  const state = normalizeEconomyState(input);
  const trade = state.trades.find((entry) => entry.id === Number(tradeId));
  if (!trade) return { error: "missing" };

  trade.isRepeat = !trade.isRepeat;
  logEconomy(state, `Rotta '${trade.name}': ripetizione ${trade.isRepeat ? "ATTIVA" : "DISATTIVATA"}.`);
  return { state };
}

export function resetEconomy() {
  const state = cloneDefault();
  logEconomy(state, "Reset ai valori predefiniti del forte.", "dm");
  return { state };
}

/* -------------------------------------------------------------------------- */
/* UI                                                                         */
/* -------------------------------------------------------------------------- */

const { ApplicationV2 } = foundry.applications.api;

function fmt(value, digits = 1) {
  return Number(value || 0).toFixed(digits);
}

function esc(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function pct(value) {
  return `${(Number(value) * 100).toFixed(0)}%`;
}

export class EconomyPanel extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "foundry-war-economy",
    classes: ["foundry-war-economy-app"],
    window: {
      title: "FOUNDRY-WAR.economy.title",
      icon: "fa-solid fa-coins",
      resizable: true,
    },
    position: { width: 980, height: 780 },
    actions: {
      advanceDay: EconomyPanel.onAdvanceDay,
      advanceWeek: EconomyPanel.onAdvanceWeek,
      reset: EconomyPanel.onReset,
      toggleDamage: EconomyPanel.onToggleDamage,
      repair: EconomyPanel.onRepair,
      changeWorker: EconomyPanel.onChangeWorker,
      changeFort: EconomyPanel.onChangeFort,
      changeSiege: EconomyPanel.onChangeSiege,
      craft: EconomyPanel.onCraft,
      rollback: EconomyPanel.onRollback,
      train: EconomyPanel.onTrain,
      dismiss: EconomyPanel.onDismiss,
      startTrade: EconomyPanel.onStartTrade,
      startBattle: EconomyPanel.onStartBattle,
      cancelTrade: EconomyPanel.onCancelTrade,
      cancelBattle: EconomyPanel.onCancelBattle,
      toggleRepeat: EconomyPanel.onToggleRepeat,
      resolveTrade: EconomyPanel.onResolveTrade,
      resolveBattle: EconomyPanel.onResolveBattle,
      applyArbitrary: EconomyPanel.onApplyArbitrary,
    },
  };

  async _renderHTML() {
    return renderEconomy(getEconomyState());
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onRender(context, options) {
    super._onRender?.(context, options);

    const receive = this.element.querySelector("#eco-trade-receive");
    const mount = this.element.querySelector("#eco-trade-mount");
    const repeat = this.element.querySelector("#eco-trade-repeat");
    const reminder = this.element.querySelector("#eco-trade-reminder");

    if (receive && mount && reminder) {
      const update = () => {
        const state = getEconomyState();
        const tax = calculateTradeTaxRate(state, mount.checked);
        const amount = Number(receive.value) || 0;
        const net = amount * (1 - tax);
        reminder.innerHTML = `
          Trattenuta attuale: <strong>${pct(tax)}</strong>.
          ${amount > 0 ? `Da <strong>${amount}</strong> riceverai <strong>${fmt(net)}</strong>.` : ""}
        `;
      };
      [receive, mount, repeat].forEach((el) => el.addEventListener("input", update));
      [receive, mount, repeat].forEach((el) => el.addEventListener("change", update));
      update();
    }
  }

  _onClose(options) {
    super._onClose(options);
    if (economyPanel === this) economyPanel = null;
  }

  async applyResult(result) {
    if (result?.error) {
      ui.notifications.warn(errorText(result.error));
      return;
    }
    if (!result?.state) return;
    await commitEconomyState(result.state);
  }

  static async onAdvanceDay() {
    this.applyResult(advanceEconomy(getEconomyState(), 1));
  }

  static async onAdvanceWeek() {
    this.applyResult(advanceEconomy(getEconomyState(), 7));
  }

  static async onReset() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Reset economia" },
      content: "<p>Ripristinare tutti i valori predefiniti del forte?</p>",
      rejectClose: false,
    });
    if (confirmed) this.applyResult(resetEconomy());
  }

  static async onToggleDamage(_event, target) {
    this.applyResult(toggleEconomyDamage(getEconomyState(), target.dataset.structure));
  }

  static async onRepair(_event, target) {
    this.applyResult(repairEconomyStructure(getEconomyState(), target.dataset.structure));
  }

  static async onChangeWorker(_event, target) {
    this.applyResult(
      changeEconomyWorker(getEconomyState(), target.dataset.role, Number(target.dataset.delta)),
    );
  }

  static async onChangeFort(_event, target) {
    this.applyResult(
      changeEconomyFort(getEconomyState(), target.dataset.site, Number(target.dataset.delta)),
    );
  }

  static async onChangeSiege(_event, target) {
    this.applyResult(
      changeEconomySiege(getEconomyState(), target.dataset.site, Number(target.dataset.delta)),
    );
  }

  static async onCraft(_event, target) {
    this.applyResult(craftEconomy(getEconomyState(), target.dataset.type));
  }

  static async onRollback(_event, target) {
    this.applyResult(rollbackEconomyCraft(getEconomyState(), target.dataset.type));
  }

  static async onTrain() {
    this.applyResult(trainEconomySoldier(getEconomyState()));
  }

  static async onDismiss() {
    this.applyResult(dismissEconomySoldier(getEconomyState()));
  }

  static async onStartTrade() {
    const value = (selector) => this.element.querySelector(selector);
    this.applyResult(
      startEconomyTrade(getEconomyState(), {
        name: value("#eco-trade-name")?.value.trim(),
        sellRes: value("#eco-trade-sell")?.value,
        buyRes: value("#eco-trade-buy")?.value,
        amountSend: Number(value("#eco-trade-send")?.value),
        amountReceive: Number(value("#eco-trade-receive")?.value),
        soldiersSend: Number(value("#eco-trade-soldiers")?.value),
        useMount: Boolean(value("#eco-trade-mount")?.checked),
        isRepeat: Boolean(value("#eco-trade-repeat")?.checked),
      }),
    );
  }

  static async onStartBattle() {
    const value = (selector) => this.element.querySelector(selector);
    this.applyResult(
      startEconomyBattle(getEconomyState(), {
        name: value("#eco-battle-name")?.value.trim(),
        soldiers: Number(value("#eco-battle-soldiers")?.value),
        days: Number(value("#eco-battle-days")?.value),
      }),
    );
  }

  static async onCancelTrade(_event, target) {
    this.applyResult(cancelEconomyTrade(getEconomyState(), target.dataset.id));
  }

  static async onCancelBattle(_event, target) {
    this.applyResult(cancelEconomyBattle(getEconomyState(), target.dataset.id));
  }

  static async onToggleRepeat(_event, target) {
    this.applyResult(toggleEconomyRepeat(getEconomyState(), target.dataset.id));
  }

  static async onResolveTrade(_event, target) {
    const form = target.closest(".eco-pending-form");
    const soldiers = Number(form?.querySelector('[data-field="soldiers"]')?.value);
    this.applyResult(resolveEconomyTrade(getEconomyState(), target.dataset.id, soldiers));
  }

  static async onResolveBattle(_event, target) {
    const form = target.closest(".eco-pending-form");
    const value = (field) => Number(form?.querySelector(`[data-field="${field}"]`)?.value) || 0;
    this.applyResult(
      resolveEconomyBattle(getEconomyState(), target.dataset.id, {
        soldiers: value("soldiers"),
        food: value("food"),
        ore: value("ore"),
        wood: value("wood"),
      }),
    );
  }

  static async onApplyArbitrary() {
    const value = (selector) => this.element.querySelector(selector);
    this.applyResult(
      applyEconomyArbitrary(getEconomyState(), {
        type: value("#eco-dm-type")?.value,
        amount: Number(value("#eco-dm-amount")?.value),
        reason: value("#eco-dm-reason")?.value.trim(),
      }),
    );
  }
}

function errorText(key) {
  const messages = {
    pending: "Ci sono spedizioni o battaglie arrivate: risolvile prima di avanzare.",
    missing: "Elemento non trovato.",
    sameResource: "Non puoi scambiare una risorsa con se stessa.",
    invalidAmounts: "Inserisci quantità valide per invio e ricezione.",
    insufficientResource: "Risorsa insufficiente per la spedizione.",
    insufficientSoldiers: "Soldati insufficienti.",
    insufficientMounts: "Serve almeno 1 Cavalcatura.",
    invalidSoldiers: "Devi inviare almeno 1 soldato in battaglia.",
    insufficientFood: "Cibo insufficiente per il rancio.",
    invalidRole: "Ruolo non valido.",
    noIdle: "Nessun cittadino inattivo disponibile.",
    maxFort: "Massimo 1 fortificazione per sito.",
    noForts: "Nessuna fortificazione disponibile.",
    noSiege: "Nessuna macchina d'assalto disponibile.",
    invalidRecipe: "Ricetta non valida.",
    insufficientCraft: "Risorse insufficienti per la produzione.",
    nothingToRollback: "Nessuna produzione da annullare.",
    assignedForts: "Rimuovi prima una fortificazione dalla mappa.",
    assignedSiege: "Rimuovi prima una macchina d'assalto dalla mappa.",
    noEquipment: "Nessun Equipaggiamento in magazzino.",
    noSoldiers: "Nessun soldato da congedare.",
    notDamaged: "L'infrastruttura non è danneggiata.",
    noDefenses: "Nessuna Fortificazione disponibile.",
    invalidAmount: "Inserisci una quantità valida.",
    invalidResource: "Risorsa non valida.",
    invalidStructure: "Struttura non valida.",
  };
  return messages[key] || key || "Operazione non valida.";
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

function renderResourceCard(label, value, delta, breakdown, cls) {
  const positive = delta >= 0;
  return `
    <div class="eco-resource ${cls}">
      <div class="eco-resource-title">${label}</div>
      <div class="eco-resource-value">${value}</div>
      <div class="eco-resource-delta ${positive ? "positive" : "negative"}">${positive ? "+" : ""}${fmt(delta)}/sett.</div>
      <div class="eco-resource-breakdown">${breakdown}</div>
    </div>
  `;
}

function renderPersonsCard(label, value, sub) {
  return `
    <div class="eco-resource">
      <div class="eco-resource-title">${label}</div>
      <div class="eco-resource-value">${value}</div>
      <div class="eco-resource-delta muted">${sub}</div>
    </div>
  `;
}

function renderWorkerRows(state) {
  return Object.entries(WORKER_LABELS)
    .map(
      ([role, label]) => `
        <div class="eco-row">
          <span>${label} <small>(${role === "foodProducers" ? "1.5 cibo" : role === "woodProducers" ? "1.0 legna" : "6.0 minerali"}/sett.)</small></span>
          <div class="eco-controls">
            <button class="eco-mini" data-action="changeWorker" data-role="${role}" data-delta="-1">−</button>
            <span class="eco-count">${state.workers[role]}</span>
            <button class="eco-mini" data-action="changeWorker" data-role="${role}" data-delta="1">+</button>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderFortRows(state) {
  return ["outerWall", "innerWall", "bridges", "port", "surroundings"]
    .map(
      (site) => `
        <div class="eco-row">
          <span>${SITE_LABELS[site]}</span>
          <div class="eco-controls">
            <button class="eco-mini" data-action="changeFort" data-site="${site}" data-delta="-1">−</button>
            <span class="eco-count">${state.fortifications[site] || 0}</span>
            <button class="eco-mini" data-action="changeFort" data-site="${site}" data-delta="1">+</button>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderSiegeRows(state) {
  return ["surroundings", "port", "inner", "bridge"]
    .map(
      (site) => `
        <div class="eco-row">
          <span>${SITE_LABELS[site]}</span>
          <div class="eco-controls">
            <button class="eco-mini" data-action="changeSiege" data-site="${site}" data-delta="-1">−</button>
            <span class="eco-count">${state.siegeLocations[site] || 0}</span>
            <button class="eco-mini" data-action="changeSiege" data-site="${site}" data-delta="1">+</button>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderCraftRows() {
  return Object.entries(RECIPES)
    .map(([type, recipe]) => {
      const cost = [
        recipe.ore ? `${recipe.ore} Minerali` : "",
        recipe.wood ? `${recipe.wood} Legna` : "",
        recipe.food ? `${recipe.food} Cibo` : "",
      ]
        .filter(Boolean)
        .join(", ");
      return `
        <div class="eco-action-row">
          <div class="eco-action-info">
            <strong>${RESOURCE_LABELS[type]}</strong>
            <span>Costo: ${cost}</span>
          </div>
          <button class="eco-btn" data-action="craft" data-type="${type}">Produci</button>
          <button class="eco-btn secondary" data-action="rollback" data-type="${type}" title="Annulla ultima produzione">↩</button>
        </div>
      `;
    })
    .join("");
}

function renderPendingTrade(trade) {
  return `
    <div class="eco-active-item pending">
      <div class="eco-active-main">
        <strong>${esc(trade.name)}</strong> <span class="eco-badge">ARRIVATA</span><br>
        <small>Invia: -${fmt(trade.sentAmount)} ${RESOURCE_LABELS[trade.sellRes]} · Scorta: ${trade.soldiersSent} soldati</small>
      </div>
      <div class="eco-pending-form">
        <label>Soldati tornati</label>
        <input type="number" min="0" max="${trade.soldiersSent}" value="${trade.soldiersSent}" data-field="soldiers">
        <button class="eco-btn" data-action="resolveTrade" data-id="${trade.id}">Invia</button>
      </div>
    </div>
  `;
}

function renderTradeRow(trade) {
  return `
    <div class="eco-active-item">
      <div class="eco-active-main">
        <strong>${esc(trade.name)}</strong>
        <span class="eco-badge ${trade.isRepeat ? "gold" : "muted"}">${trade.isRepeat ? "Ripetitiva" : "Singola"}</span>
        ${trade.useMount ? "🐴" : ""}<br>
        <small>-${fmt(trade.sentAmount)} ${RESOURCE_LABELS[trade.sellRes]} (scorta ${trade.soldiersSent}) ➔ +${fmt(trade.expectedReturn)} ${RESOURCE_LABELS[trade.buyRes]}</small>
      </div>
      <div class="eco-active-side">
        <span class="eco-days">${trade.daysRemaining} gg</span>
        <div class="eco-inline">
          <button class="eco-mini wide" data-action="toggleRepeat" data-id="${trade.id}">${trade.isRepeat ? "Rendi singola" : "Rendi ripetitiva"}</button>
          <button class="eco-mini wide danger" data-action="cancelTrade" data-id="${trade.id}">Annulla</button>
        </div>
      </div>
    </div>
  `;
}

function renderPendingBattle(battle) {
  return `
    <div class="eco-active-item pending">
      <div class="eco-active-main">
        <strong>${esc(battle.name)}</strong> <span class="eco-badge">TERMINATA</span><br>
        <small>Soldati schierati: ${battle.soldiersSent}</small>
      </div>
      <div class="eco-pending-form battle">
        <label>Soldati tornati</label>
        <input type="number" min="0" max="${battle.soldiersSent}" value="${battle.soldiersSent}" data-field="soldiers">
        <label>Cibo</label>
        <input type="number" min="0" value="0" data-field="food">
        <label>Minerali</label>
        <input type="number" min="0" value="0" data-field="ore">
        <label>Legna</label>
        <input type="number" min="0" value="0" data-field="wood">
        <button class="eco-btn" data-action="resolveBattle" data-id="${battle.id}">Invia</button>
      </div>
    </div>
  `;
}

function renderBattleRow(battle) {
  return `
    <div class="eco-active-item">
      <div class="eco-active-main">
        <strong>${esc(battle.name)}</strong><br>
        <small>Soldati in campo: ${battle.soldiersSent}</small>
      </div>
      <div class="eco-active-side">
        <span class="eco-days danger">${battle.daysRemaining} gg</span>
        <button class="eco-mini wide danger" data-action="cancelBattle" data-id="${battle.id}">Ritira</button>
      </div>
    </div>
  `;
}

function renderEconomy(state) {
  const summary = productionSummary(state);
  const pending = hasPending(state);
  const week = Math.floor((state.day - 1) / 7) + 1;
  const fortTotal = state.resources.defenses;
  const siegeTotal = state.resources.siege;
  const fortAssigned = getTotalAssignedForts(state);
  const siegeAssigned = getTotalAssignedSiege(state);
  const unassigned = Math.max(0, getUnassignedPop(state));

  const tradePending = state.trades.filter((trade) => trade.pendingArrival);
  const tradeActive = state.trades.filter((trade) => !trade.pendingArrival);
  const battlePending = state.battles.filter((battle) => battle.pendingEnd);
  const battleActive = state.battles.filter((battle) => !battle.pendingEnd);

  const logs = (state.logs || []).map((entry) => {
    const isObject = typeof entry === "object";
    return `<div class="eco-log-entry ${isObject ? entry.type : "info"}">${esc(isObject ? entry.text : entry)}</div>`;
  }).join("");

  const root = document.createElement("div");
  root.className = "fw-eco";
  root.innerHTML = `
    <header class="eco-header">
      <div>
        <h1>Forte Pernovo</h1>
        <small>Economia della città</small>
      </div>
      <div class="eco-header-actions">
        <div class="eco-day">Giorno <b>${state.day}</b> <span>(Sett. <b>${week}</b>)</span></div>
        <button class="eco-btn" data-action="advanceDay" ${pending ? "disabled title=\"Risolvi prima gli eventi in arrivo\"" : ""}>+1 Giorno</button>
        <button class="eco-btn" data-action="advanceWeek" ${pending ? "disabled title=\"Risolvi prima gli eventi in arrivo\"" : ""}>+1 Settimana</button>
        <button class="eco-btn secondary" data-action="reset">Reset</button>
      </div>
    </header>

    ${pending ? `<div class="eco-warning"><i class="fa-solid fa-triangle-exclamation"></i> Ci sono spedizioni o battaglie arrivate: compila gli input e premi <b>Invia</b> prima di avanzare.</div>` : ""}

    <section class="eco-resources">
      ${renderResourceCard(
        "Cibo",
        fmt(state.resources.food),
        summary.foodDelta,
        `Prod: +${fmt(summary.foodProd)} · Consumo: -${fmt(summary.foodCons)} · Tratte cont.: ${summary.tradeNet.food >= 0 ? "+" : ""}${fmt(summary.tradeNet.food)} · In arrivo: +${fmt(summary.singleIncoming.food)}`,
        "food",
      )}
      ${renderResourceCard(
        "Legna",
        fmt(state.resources.wood),
        summary.woodDelta,
        `Prod: +${fmt(summary.woodProd)} · Tratte cont.: ${summary.tradeNet.wood >= 0 ? "+" : ""}${fmt(summary.tradeNet.wood)} · In arrivo: +${fmt(summary.singleIncoming.wood)}`,
        "wood",
      )}
      ${renderResourceCard(
        "Minerali",
        fmt(state.resources.ore),
        summary.oreDelta,
        `Prod: +${fmt(summary.oreProd)} · Tratte cont.: ${summary.tradeNet.ore >= 0 ? "+" : ""}${fmt(summary.tradeNet.ore)} · In arrivo: +${fmt(summary.singleIncoming.ore)}`,
        "ore",
      )}
      ${renderPersonsCard("Popolazione", state.popTotal, `Inattivi: ${unassigned}`)}
    </section>

    <div class="eco-grid">
      <section class="eco-card">
        <h2>Infrastrutture e Danni</h2>
        ${["bridge", "surroundings", "inner", "port"]
          .map((structure) => {
            const names = { bridge: "Ponte", surroundings: "Zone Limitrofe", inner: "Zone Interne", port: "Porto" };
            return `
              <div class="eco-row">
                <span>${names[structure]}</span>
                <div class="eco-inline">
                  <button class="eco-toggle ${state.damaged[structure] ? "danger" : ""}" data-action="toggleDamage" data-structure="${structure}">
                    ${state.damaged[structure] ? "Danneggiato" : "Integro"}
                  </button>
                  <button class="eco-mini wide" data-action="repair" data-structure="${structure}">Ripara</button>
                </div>
              </div>
            `;
          })
          .join("")}
      </section>

      <section class="eco-card">
        <h2>Assegnazione Lavoratori</h2>
        ${renderWorkerRows(state)}
      </section>

      <section class="eco-card">
        <h2>Esercito e Difese</h2>
        <div class="eco-stats">
          <div><span>Soldati (x10)</span><b>${state.resources.soldiers}</b></div>
          <div><span>Equipaggiamento</span><b>${state.resources.equipment}</b></div>
          <div><span>Cavalcature</span><b>${state.resources.mounts}</b></div>
          <div><span>Fortificazioni</span><b>${fortTotal}</b></div>
          <div><span>Macchine d'Assalto</span><b>${siegeTotal}</b></div>
        </div>
        <div class="eco-action-row">
          <div class="eco-action-info"><strong>Arruola Soldato</strong><span>1 Pop. libera + 1 Equipaggiamento</span></div>
          <button class="eco-btn" data-action="train">Addestra</button>
        </div>
        <div class="eco-action-row">
          <div class="eco-action-info"><strong>Congeda Soldato</strong><span>Restituisce 1 Pop. + 1 Equipaggiamento</span></div>
          <button class="eco-btn secondary" data-action="dismiss">Congeda</button>
        </div>
      </section>

      <section class="eco-card">
        <h2>Mappa Fortificazioni <small>${fortAssigned}/${fortTotal}</small></h2>
        ${renderFortRows(state)}
      </section>

      <section class="eco-card">
        <h2>Mappa Macchine d'Assalto <small>${siegeAssigned}/${siegeTotal}</small></h2>
        ${renderSiegeRows(state)}
      </section>

      <section class="eco-card">
        <h2>Fabbrica e Cantiere</h2>
        ${renderCraftRows()}
      </section>

      <section class="eco-card">
        <h2>Commercio Multirisorsa</h2>
        <div class="eco-form">
          <label>Nome scambio / rotta</label>
          <input id="eco-trade-name" type="text" placeholder="es. Carovana">
          <div class="eco-form-row">
            <div>
              <label>Vendi (invia)</label>
              <select id="eco-trade-sell">
                <option value="ore">Minerali</option>
                <option value="wood">Legna</option>
                <option value="food">Cibo</option>
              </select>
            </div>
            <div>
              <label>Compra (ricevi)</label>
              <select id="eco-trade-buy">
                <option value="food">Cibo</option>
                <option value="wood">Legna</option>
                <option value="ore">Minerali</option>
              </select>
            </div>
          </div>
          <div class="eco-form-row">
            <div>
              <label>Quantità da inviare</label>
              <input id="eco-trade-send" type="number" min="1" placeholder="Invia">
            </div>
            <div>
              <label>Quantità da ricevere (base)</label>
              <input id="eco-trade-receive" type="number" min="1" placeholder="Ricevi">
            </div>
          </div>
          <label>Soldati di scorta</label>
          <input id="eco-trade-soldiers" type="number" min="0" value="0">
          <label class="eco-check"><input id="eco-trade-mount" type="checkbox"> Impiega 1 Cavalcatura (consumo x1)</label>
          <label class="eco-check"><input id="eco-trade-repeat" type="checkbox"> Spedizione ripetitiva</label>
          <div class="eco-reminder" id="eco-trade-reminder">Trattenuta attuale: <strong>${pct(calculateTradeTaxRate(state, false))}</strong>.</div>
          <button class="eco-btn" data-action="startTrade">Avvia Spedizione</button>
        </div>
      </section>

      <section class="eco-card">
        <h2>Campagna e Battaglie</h2>
        <div class="eco-form">
          <label>Nome battaglia / obiettivo</label>
          <input id="eco-battle-name" type="text" placeholder="es. Assalto all'avamposto">
          <div class="eco-form-row">
            <div>
              <label>Soldati da inviare</label>
              <input id="eco-battle-soldiers" type="number" min="1" value="5">
            </div>
            <div>
              <label>Durata (giorni)</label>
              <input id="eco-battle-days" type="number" min="1" value="3">
            </div>
          </div>
          <div class="eco-reminder">Il costo del rancio è pari ai soldati inviati. Loot e perdite si inseriscono alla fine.</div>
          <button class="eco-btn" data-action="startBattle">Inizia Battaglia</button>
        </div>
      </section>

      <section class="eco-card">
        <h2>Spedizioni in Corso</h2>
        <div class="eco-active-list">
          ${tradePending.length || tradeActive.length
            ? tradePending.map(renderPendingTrade).join("") + tradeActive.map(renderTradeRow).join("")
            : '<div class="eco-empty">Nessuna carovana attiva.</div>'}
        </div>
      </section>

      <section class="eco-card">
        <h2>Battaglie in Corso</h2>
        <div class="eco-active-list">
          ${battlePending.length || battleActive.length
            ? battlePending.map(renderPendingBattle).join("") + battleActive.map(renderBattleRow).join("")
            : '<div class="eco-empty">Nessuna battaglia attiva.</div>'}
        </div>
      </section>

      <section class="eco-card full">
        <h2>Gestione Arbitraria Risorse <small>DM / Eventi</small></h2>
        <div class="eco-form">
          <div class="eco-form-row">
            <div>
              <label>Risorsa</label>
              <select id="eco-dm-type">
                ${Object.entries(RESOURCE_LABELS)
                  .map(([key, label]) => `<option value="${key}">${label}</option>`)
                  .join("")}
              </select>
            </div>
            <div>
              <label>Quantità (+ o -)</label>
              <input id="eco-dm-amount" type="number" placeholder="es. +50 o -20">
            </div>
          </div>
          <label>Motivazione / nota</label>
          <input id="eco-dm-reason" type="text" placeholder="es. Frana, mercanti, attacco...">
          <button class="eco-btn secondary" data-action="applyArbitrary">Applica Modifica</button>
        </div>
      </section>

      <section class="eco-card full">
        <h2>Registro del Forte</h2>
        <div class="eco-log">${logs}</div>
      </section>
    </div>
  `;

  return root;
}

/* -------------------------------------------------------------------------- */
/* Apertura                                                                   */
/* -------------------------------------------------------------------------- */

let economyPanel = null;
let refreshTimer = null;

export function toggleEconomyPanel() {
  if (economyPanel?.rendered) {
    economyPanel.close();
    economyPanel = null;
    return;
  }

  economyPanel = new EconomyPanel();
  economyPanel.render({ force: true });
}

export function refreshEconomyPanel() {
  if (!economyPanel?.rendered) return;

  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (economyPanel?.rendered) economyPanel.render();
  }, 120);
}
