/**
 * Foundry War - motore di battaglia (puro, senza dipendenze da Foundry).
 *
 * Può essere importato sia da Node (sim/run.mjs) sia dal modulo Foundry.
 *
 * Modello:
 * - Ogni battaglione ha `troops` truppe (HP) e un `cr` per truppa.
 * - La forza di una truppa è l'XP del suo CR (minimo 50, arrotondato per difetto).
 * - Ogni round ogni lato schiera fino a `dice` truppe (le più forti).
 * - Ogni truppa confronta `forza * jitter`, con jitter log-normale troncato.
 * - Chi perde il confronto perde 1 truppa.
 * - `alpha` (0..1) regola il caos: 0 = deterministico, 1 = molto casuale.
 * - `rush = false` limita le perdite cumulative al `lossCap` (default 50%): la
 *   battaglia può finire senza distruggere un lato.
 * - `rush = true` rimuove il limite: si continua fino allo sterminio.
 * - Se la probabilità di vittoria di un lato è >= `decisiveThreshold`, la
 *   battaglia è "schiacciante" e viene risolta con l'esito medio, senza tirare.
 */

export const MIN_XP = 50;
export const SIGMA_MAX = 0.6;
export const DEFAULT_ALPHA = 0.3;
export const DEFAULT_DICE = 3;
export const DEFAULT_LOSS_CAP = 0.5;
export const DEFAULT_DECISIVE_THRESHOLD = 0.95;
export const DEFAULT_MAX_ROUNDS = 5000;

export const CR_XP = {
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

const CR_KEYS = Object.keys(CR_XP)
  .map(Number)
  .sort((a, b) => a - b);

/** XP di una truppa per un dato CR: minimo 50, arrotondato per difetto. */
export function xpForCR(cr) {
  const value = Number(cr);
  if (!Number.isFinite(value)) return MIN_XP;

  let best = CR_KEYS[0];
  for (const key of CR_KEYS) {
    if (value + 1e-9 >= key) best = key;
    else break;
  }
  return Math.max(MIN_XP, Math.floor(CR_XP[best]));
}

export function createRng(seed = 0x9e3779b9) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normal(rng) {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function truncatedNormal(rng, limit = 2) {
  for (let i = 0; i < 100; i++) {
    const z = normal(rng);
    if (Math.abs(z) <= limit) return z;
  }
  return 0;
}

function buildSide(battalions, bonus, lossCap) {
  const troops = [];

  for (const battalion of battalions ?? []) {
    const cr = Math.max(0, Number(battalion.cr ?? 0) + Number(bonus ?? 0));
    const power = xpForCR(cr);
    const count = Math.max(0, Math.floor(Number(battalion.troops ?? 0)));
    for (let i = 0; i < count; i++) troops.push({ power });
  }

  return {
    initial: troops.length,
    troops,
    losses: 0,
    cap: Math.ceil(troops.length * lossCap),
  };
}

function pickTop(troops, count) {
  const top = [];

  for (const troop of troops) {
    if (top.length < count) {
      top.push(troop);
      top.sort((a, b) => b.power - a.power);
    } else if (troop.power > top[top.length - 1].power) {
      top[top.length - 1] = troop;
      top.sort((a, b) => b.power - a.power);
    }
  }

  return top;
}

function removeTroops(troops, removed) {
  if (!removed.length) return troops;
  const set = new Set(removed);
  return troops.filter((troop) => !set.has(troop));
}

function compareSurvivors(allies, enemies) {
  if (allies.troops.length === enemies.troops.length) return "draw";
  return allies.troops.length > enemies.troops.length ? "ally" : "enemy";
}

/**
 * Simula una singola battaglia.
 *
 * @param {object} config
 * @param {Array<{cr:number,troops:number}>} config.allies
 * @param {Array<{cr:number,troops:number}>} config.enemies
 * @param {number} [config.alpha=0.3]
 * @param {boolean} [config.rush=false]
 * @param {number} [config.lossCap=0.5]
 * @param {number} [config.dice=3]
 * @param {number} [config.maxRounds=5000]
 * @param {number} [config.allyBonus=0] bonus CR globale (flank/encircle)
 * @param {number} [config.enemyBonus=0]
 * @param {Function} rng
 */
export function simulateBattle(config, rng) {
  const alpha = clamp(Number(config.alpha ?? DEFAULT_ALPHA), 0, 1);
  const sigma = alpha * SIGMA_MAX;
  const dice = Math.max(1, Math.floor(Number(config.dice ?? DEFAULT_DICE)));
  const rush = Boolean(config.rush);
  const lossCap = clamp(Number(config.lossCap ?? DEFAULT_LOSS_CAP), 0, 1);
  const maxRounds = Math.max(1, Math.floor(Number(config.maxRounds ?? DEFAULT_MAX_ROUNDS)));

  const allies = buildSide(config.allies, config.allyBonus, lossCap);
  const enemies = buildSide(config.enemies, config.enemyBonus, lossCap);

  let rounds = 0;
  let winner = null;

  while (allies.troops.length && enemies.troops.length && rounds < maxRounds) {
    rounds += 1;

    const alliedRolls = pickTop(allies.troops, dice)
      .map((troop) => ({ troop, value: troop.power * Math.exp(sigma * truncatedNormal(rng)) }))
      .sort((a, b) => b.value - a.value);

    const enemyRolls = pickTop(enemies.troops, dice)
      .map((troop) => ({ troop, value: troop.power * Math.exp(sigma * truncatedNormal(rng)) }))
      .sort((a, b) => b.value - a.value);

    const pairs = Math.min(alliedRolls.length, enemyRolls.length);
    let alliedLosses = [];
    let enemyLosses = [];

    for (let i = 0; i < pairs; i++) {
      const ally = alliedRolls[i];
      const enemy = enemyRolls[i];

      if (ally.value > enemy.value) enemyLosses.push(enemy.troop);
      else if (enemy.value > ally.value) alliedLosses.push(ally.troop);
      else {
        // Pareggio: perdono entrambi (con alpha=0 e forze identiche).
        alliedLosses.push(ally.troop);
        enemyLosses.push(enemy.troop);
      }
    }

    if (!rush) {
      const alliedAllowed = Math.max(0, allies.cap - allies.losses);
      const enemyAllowed = Math.max(0, enemies.cap - enemies.losses);
      alliedLosses = alliedLosses.slice(0, alliedAllowed);
      enemyLosses = enemyLosses.slice(0, enemyAllowed);
    }

    allies.troops = removeTroops(allies.troops, alliedLosses);
    enemies.troops = removeTroops(enemies.troops, enemyLosses);
    allies.losses += alliedLosses.length;
    enemies.losses += enemyLosses.length;

    if (!rush) {
      const alliedCapped = allies.losses >= allies.cap;
      const enemyCapped = enemies.losses >= enemies.cap;

      if (alliedCapped || enemyCapped) {
        if (alliedCapped && enemyCapped) winner = compareSurvivors(allies, enemies);
        else winner = alliedCapped ? "enemy" : "ally";
        break;
      }
    }

    if (!allies.troops.length || !enemies.troops.length) {
      winner = compareSurvivors(allies, enemies);
      break;
    }
  }

  if (!winner) {
    if (!allies.troops.length && !enemies.troops.length) winner = "draw";
    else if (!allies.troops.length) winner = "enemy";
    else if (!enemies.troops.length) winner = "ally";
    else winner = compareSurvivors(allies, enemies);
  }

  return {
    winner,
    rounds,
    allies: {
      initial: allies.initial,
      losses: allies.losses,
      survivors: allies.troops.length,
    },
    enemies: {
      initial: enemies.initial,
      losses: enemies.losses,
      survivors: enemies.troops.length,
    },
    margin: allies.troops.length - enemies.troops.length,
    decisive: false,
  };
}

function averageResults(results) {
  if (!results.length) return null;

  const sum = (get) => results.reduce((total, result) => total + get(result), 0) / results.length;

  return {
    rounds: sum((r) => r.rounds),
    allies: {
      losses: sum((r) => r.allies.losses),
      survivors: sum((r) => r.allies.survivors),
    },
    enemies: {
      losses: sum((r) => r.enemies.losses),
      survivors: sum((r) => r.enemies.survivors),
    },
    margin: sum((r) => r.margin),
  };
}

/**
 * Esegue `runs` battaglie e restituisce la distribuzione degli esiti.
 */
export function simulateDistribution(config, runs = 10000, seed = 0x1234abcd) {
  const totalRuns = Math.max(1, Math.floor(runs));
  const threshold = clamp(
    Number(config.decisiveThreshold ?? DEFAULT_DECISIVE_THRESHOLD),
    0.5,
    1,
  );

  const rng = createRng(seed);
  const results = [];
  const bins = new Map();

  for (let i = 0; i < totalRuns; i++) {
    const result = simulateBattle(config, rng);
    results.push(result);

    const key = result.margin;
    let bin = bins.get(key);
    if (!bin) {
      bin = {
        value: key,
        count: 0,
        allyLosses: 0,
        enemyLosses: 0,
        allySurvivors: 0,
        enemySurvivors: 0,
      };
      bins.set(key, bin);
    }

    bin.count += 1;
    bin.allyLosses += result.allies.losses;
    bin.enemyLosses += result.enemies.losses;
    bin.allySurvivors += result.allies.survivors;
    bin.enemySurvivors += result.enemies.survivors;
  }

  const allyWins = results.filter((result) => result.winner === "ally");
  const enemyWins = results.filter((result) => result.winner === "enemy");
  const draws = totalRuns - allyWins.length - enemyWins.length;

  const allyWinRate = allyWins.length / totalRuns;
  const enemyWinRate = enemyWins.length / totalRuns;

  let decisive = null;
  if (allyWinRate >= threshold) decisive = "ally";
  else if (enemyWinRate >= threshold) decisive = "enemy";

  const distributionBins = [...bins.values()]
    .sort((a, b) => a.value - b.value)
    .map((bin) => ({
      value: bin.value,
      count: bin.count,
      probability: bin.count / totalRuns,
      avgAllyLosses: bin.allyLosses / bin.count,
      avgEnemyLosses: bin.enemyLosses / bin.count,
      avgAllySurvivors: bin.allySurvivors / bin.count,
      avgEnemySurvivors: bin.enemySurvivors / bin.count,
    }));

  return {
    runs: totalRuns,
    threshold,
    decisive,
    allyWinRate,
    enemyWinRate,
    drawRate: draws / totalRuns,
    average: averageResults(results),
    winAverage: {
      ally: averageResults(allyWins),
      enemy: averageResults(enemyWins),
    },
    bins: distributionBins,
    config,
  };
}

/**
 * Risolve la battaglia "vera": se c'è una vittoria schiacciante usa l'esito
 * medio, altrimenti campiona una singola battaglia.
 */
export function resolveBattle(config, distribution, seed = 0xc0ffee) {
  if (distribution.decisive) {
    const side = distribution.decisive;
    const average = distribution.winAverage[side];
    if (average) {
      return {
        winner: side,
        decisive: true,
        rounds: Math.round(average.rounds),
        allies: {
          initial: null,
          losses: Math.round(average.allies.losses),
          survivors: Math.round(average.allies.survivors),
        },
        enemies: {
          initial: null,
          losses: Math.round(average.enemies.losses),
          survivors: Math.round(average.enemies.survivors),
        },
        margin: Math.round(average.margin),
      };
    }
  }

  return simulateBattle(config, createRng(seed));
}
