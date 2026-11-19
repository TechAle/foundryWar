/**
 * Foundry War — movimento token con frecce.
 *
 * - Due icone nel Token HUD: direzione (ciclica) e movimento in ft (ciclico).
 * - Un bottone nei Tile Controls muove tutti i token con una direzione.
 * - Se il percorso incontra un muro, il token rimbalza.
 * - Ogni rimbalzo costa 1 PF vero, preso dalla scheda. A 0 la freccia
 *   diventa una X e il token non si muove più. Non c'è nulla da attivare.
 * - I token senza HP sulla scheda non perdono vita (e non mostrano la X).
 *
 * I dati sono salvati nel flag `flags["foundry-war"].move = { dir }`.
 */

const MODULE_ID = "foundry-war";
const FLAG = "move";

const DIRECTIONS = [
  { key: 0, icon: "fa-solid fa-arrows-up-down-left-right", dx: 0, dy: 0, label: "—" },
  { key: 1, icon: "fa-solid fa-arrow-up", dx: 0, dy: -1, label: "↑" },
  { key: 2, icon: "fa-solid fa-arrow-up-right", dx: 1, dy: -1, label: "↗" },
  { key: 3, icon: "fa-solid fa-arrow-right", dx: 1, dy: 0, label: "→" },
  { key: 4, icon: "fa-solid fa-arrow-down-right", dx: 1, dy: 1, label: "↘" },
  { key: 5, icon: "fa-solid fa-arrow-down", dx: 0, dy: 1, label: "↓" },
  { key: 6, icon: "fa-solid fa-arrow-down-left", dx: -1, dy: 1, label: "↙" },
  { key: 7, icon: "fa-solid fa-arrow-left", dx: -1, dy: 0, label: "←" },
  { key: 8, icon: "fa-solid fa-arrow-up-left", dx: -1, dy: -1, label: "↖" },
];

// La distanza non si imposta a mano: si legge dalla scheda (walking speed).

const RayClass = globalThis.Ray ?? globalThis.foundry?.canvas?.geometry?.Ray;

function getMoveData(doc) {
  const raw = doc.getFlag(MODULE_ID, FLAG) ?? {};
  const dir = Math.max(0, Math.min(8, Number(raw.dir ?? 0)));
  return { dir };
}

async function setMoveData(doc, data) {
  await doc.setFlag(MODULE_ID, FLAG, { dir: data.dir });
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** HP veri dell'attore, se la scheda ne espone una (dnd5e e simili). */
function getActorHp(doc) {
  const system = doc?.actor?.system ?? {};
  const hp = system.attributes?.hp ?? system.hp ?? system.health;
  if (!hp) return null;

  const value = toNumber(hp.value ?? hp.current);
  if (value === null) return null;

  const max = toNumber(hp.max ?? hp.maximum);
  return { value, max: max ?? value };
}

async function setActorHp(doc, value) {
  const system = doc?.actor?.system ?? {};
  const rounded = Math.max(0, Math.floor(value));

  if (system.attributes?.hp?.value != null) {
    await doc.actor.update({ "system.attributes.hp.value": rounded });
    return true;
  }
  if (system.hp?.value != null) {
    await doc.actor.update({ "system.hp.value": rounded });
    return true;
  }
  if (system.health?.value != null) {
    await doc.actor.update({ "system.health.value": rounded });
    return true;
  }
  return false;
}

/** A 0 PF il token non si muove più e mostra la X. */
function isTokenDead(doc) {
  const hp = getActorHp(doc);
  return hp ? hp.value <= 0 : false;
}

function directionInfo(key) {
  return DIRECTIONS.find((entry) => entry.key === key) ?? DIRECTIONS[0];
}

function makeRay(origin, target) {
  if (RayClass) return new RayClass(origin, target);
  return { A: origin, B: target };
}

function wallBlocks(origin, target) {
  const ray = makeRay(origin, target);

  // API moderna (v10+): WallLayer#checkCollision.
  try {
    if (canvas.walls?.checkCollision) {
      return canvas.walls.checkCollision(ray, { type: "move", mode: "any" });
    }
  } catch (error) {
    console.warn(`${MODULE_ID} | checkCollision non disponibile`, error);
  }

  // API dei backend poligonali (v12+).
  try {
    const backend = CONFIG.Canvas?.polygonBackends?.move;
    if (backend?.testCollision) {
      return backend.testCollision(origin, target, {
        type: "move",
        mode: "any",
      });
    }
  } catch (error) {
    console.warn(`${MODULE_ID} | polygonBackends.move non disponibile`, error);
  }

  // Fallback legacy.
  try {
    if (canvas.walls?.checkCollision) return canvas.walls.checkCollision(ray);
  } catch (error) {
    console.warn(`${MODULE_ID} | collisione muri non disponibile`, error);
  }

  return false;
}

function closestDirection(dx, dy) {
  const length = Math.hypot(dx, dy);
  if (!length) return 0;
  const nx = dx / length;
  const ny = dy / length;
  let best = 0;
  let bestDot = -Infinity;
  for (const direction of DIRECTIONS) {
    if (direction.key === 0) continue;
    const len = Math.hypot(direction.dx, direction.dy) || 1;
    const dot = nx * (direction.dx / len) + ny * (direction.dy / len);
    if (dot > bestDot) {
      bestDot = dot;
      best = direction.key;
    }
  }
  return best;
}

function pixelsPerFoot() {
  const gridDistance =
    Number(canvas.grid?.distance ?? canvas.dimensions?.distance ?? 5) || 5;
  const gridSize =
    Number(canvas.grid?.size ?? canvas.dimensions?.size ?? 100) || 100;
  return gridSize / gridDistance;
}

/**
 * Legge la walking speed dalla scheda dell'attore.
 * Supporta dnd5e (attributes.movement.walk), vecchie schede (attributes.speed.value)
 * e Pathfinder 2e (attributes.speed.total). Fallback: 30 ft.
 */
function getWalkSpeed(doc) {
  const actor = doc?.actor;
  if (!actor) return 30;

  const system = actor.system ?? {};
  const raw =
    system.attributes?.movement?.walk ??
    system.attributes?.movement?.speed ??
    system.attributes?.speed?.walk ??
    system.attributes?.speed?.value ??
    system.attributes?.speed?.total ??
    system.speed?.walk ??
    system.speed?.value ??
    null;

  if (raw === null || raw === undefined) return 30;
  if (typeof raw === "number") return Math.max(0, raw);

  const match = String(raw).match(/-?\d+(?:[.,]\d+)?/);
  return match ? Math.max(0, Number(match[0].replace(",", "."))) : 30;
}

async function moveToken(token) {
  const doc = token?.document;
  if (!doc) return false;

  const data = getMoveData(doc);
  const distance = getWalkSpeed(doc);
  if (data.dir === 0 || distance <= 0) return false;
  if (isTokenDead(doc)) return false;

  const direction = directionInfo(data.dir);
  const length = Math.hypot(direction.dx, direction.dy) || 1;
  const ux = direction.dx / length;
  const uy = direction.dy / length;
  const total = distance * pixelsPerFoot();

  const origin = token.center.clone();
  const freeFrom = (from, mx, my) => {
    const target = new PIXI.Point(from.x + mx, from.y + my);
    return !wallBlocks(from, target);
  };
  const free = (mx, my) => freeFrom(origin, mx, my);

  let endX = origin.x;
  let endY = origin.y;
  let newDir = data.dir;
  let traveled = total;
  let bounced = false;
  let impactX = null;
  let impactY = null;

  if (free(ux * total, uy * total)) {
    endX += ux * total;
    endY += uy * total;
  } else {
    // Trova il punto massimo raggiungibile prima del muro.
    let lo = 0;
    let hi = total;
    for (let i = 0; i < 14; i += 1) {
      const mid = (lo + hi) / 2;
      if (free(ux * mid, uy * mid)) lo = mid;
      else hi = mid;
    }

    const forward = lo;
    const impact = new PIXI.Point(
      origin.x + ux * forward,
      origin.y + uy * forward,
    );
    const remaining = total - forward;

    endX = impact.x;
    endY = impact.y;
    newDir = closestDirection(-ux, -uy);
    traveled = forward;
    bounced = true;
    impactX = impact.x;
    impactY = impact.y;

    // Il movimento che avanza dopo il muro viene percorso all'indietro.
    if (remaining > 0.5) {
      let back = remaining;
      if (!freeFrom(impact, -ux * back, -uy * back)) {
        let loBack = 0;
        let hiBack = back;
        for (let i = 0; i < 14; i += 1) {
          const mid = (loBack + hiBack) / 2;
          if (freeFrom(impact, -ux * mid, -uy * mid)) {
            loBack = mid;
          } else {
            hiBack = mid;
          }
        }
        back = loBack;
      }
      endX += -ux * back;
      endY += -uy * back;
      traveled += back;
    }
  }

  if (traveled < 0.5) {
    ui.notifications.warn(
      game.i18n.format("FOUNDRY-WAR.move.blocked", { name: doc.name }),
    );
    return false;
  }

  // Ogni urto contro il muro costa 1 PF veri. A 0 si ferma sull'impatto.
  const hpBefore = getActorHp(doc);
  let hpAfter = hpBefore ? hpBefore.value : null;

  if (bounced && hpBefore) {
    hpAfter = Math.max(0, hpBefore.value - 1);
    if (hpAfter <= 0 && impactX !== null && impactY !== null) {
      endX = impactX;
      endY = impactY;
    }
  }

  const newX = Math.round(endX - token.w / 2);
  const newY = Math.round(endY - token.h / 2);
  await doc.update({ x: newX, y: newY }, { animate: true });

  if (newDir !== data.dir) {
    await setMoveData(doc, { dir: newDir });
  }

  if (bounced && hpAfter !== null) {
    await setActorHp(doc, hpAfter);
  }

  if (bounced && hpAfter === 0 && hpBefore.value > 0) {
    ui.notifications.info(
      game.i18n.format("FOUNDRY-WAR.move.ballDead", { name: doc.name }),
    );
  }

  return true;
}

async function moveAllTokens() {
  if (!game.user.isGM) return;

  const tokens = canvas.tokens?.placeables ?? [];
  const targets = tokens.filter((token) => {
    const data = getMoveData(token.document);
    return (
      data.dir > 0 &&
      getWalkSpeed(token.document) > 0 &&
      !isTokenDead(token.document)
    );
  });

  if (!targets.length) {
    ui.notifications.info(game.i18n.localize("FOUNDRY-WAR.move.none"));
    return;
  }

  let moved = 0;
  for (const token of targets) {
    if (await moveToken(token)) moved += 1;
  }

  ui.notifications.info(
    game.i18n.format("FOUNDRY-WAR.move.done", { count: moved }),
  );
}

/* -------------------------------------------------------------------------- */
/* Token HUD: direzione, movimento, palla                                      */
/* -------------------------------------------------------------------------- */
Hooks.on("renderTokenHUD", (hud, html) => {
  if (!game.user.isGM) return;

  const token = hud?.object;
  const doc = token?.document;
  if (!doc) return;

  const column = html.querySelector?.(".col.left");
  if (!column) return;
  if (html.querySelector(".fw-move-dir")) return;

  const dirButton = document.createElement("div");
  dirButton.className = "control-icon fw-move-dir";

  const refresh = () => {
    const data = getMoveData(doc);
    const info = directionInfo(data.dir);
    const speed = getWalkSpeed(doc);

    dirButton.innerHTML = `<i class="${info.icon}"></i>`;
    dirButton.dataset.tooltip = `${game.i18n.localize(
      "FOUNDRY-WAR.move.direction",
    )}: ${info.label} (${speed} ft)`;
  };

  dirButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const data = getMoveData(doc);
    await setMoveData(doc, {
      ...data,
      dir: (data.dir + 1) % DIRECTIONS.length,
    });
    refresh();
  });

  refresh();
  column.append(dirButton);
});

/* -------------------------------------------------------------------------- */
/* Tile Controls: "Muovi token con frecce"                                    */
/* -------------------------------------------------------------------------- */
Hooks.on("getSceneControlButtons", (controls) => {
  const tiles = controls?.tiles;
  if (!tiles?.tools) return;

  tiles.tools["foundry-war-move-tokens"] = {
    name: "foundry-war-move-tokens",
    title: "FOUNDRY-WAR.move.title",
    icon: "fa-solid fa-arrows-up-down-left-right",
    order: Object.keys(tiles.tools).length,
    button: true,
    visible: game.user.isGM,
    onChange: () => moveAllTokens(),
  };
});

/* -------------------------------------------------------------------------- */
/* Freccia permanente sopra il token                                          */
/* -------------------------------------------------------------------------- */
const ARROW_GLYPHS = ["", "↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];

function ensureMapArrow(token) {
  if (!token?.document) return;

  let arrow = token.children?.find((child) => child.name === "fw-move-arrow");
  if (!arrow) {
    arrow = new PIXI.Text("", {
      fontFamily: "Arial, Helvetica, sans-serif",
      fontSize: 30,
      fontWeight: "bold",
      fill: 0xffd54a,
      stroke: 0x1a1a1a,
      strokeThickness: 5,
      align: "center",
    });
    arrow.name = "fw-move-arrow";
    arrow.anchor.set(0.5, 1);
    arrow.zIndex = 9999;
    token.addChild(arrow);
  }

  const data = getMoveData(token.document);
  const dead = isTokenDead(token.document);

  arrow.text = dead ? "✕" : ARROW_GLYPHS[data.dir] ?? "";
  arrow.visible = dead || data.dir > 0;
  arrow.style.fill = dead ? 0xd23c3c : 0xffd54a;
  arrow.style.fontSize = dead ? 42 : 30;
  arrow.position.set(token.w / 2, -6);

  if (token.sortableChildren) arrow.zIndex = 9999;
}

Hooks.on("refreshToken", (token) => ensureMapArrow(token));

Hooks.on("updateToken", (doc, changes) => {
  if (!changes?.flags?.[MODULE_ID]?.move) return;
  const token = doc.object;
  if (token) ensureMapArrow(token);
});

// Gli HP dell'attore cambiano (rimbalzo, cura, danno): rinfresca la X.
Hooks.on("updateActor", (actor) => {
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.actor === actor) ensureMapArrow(token);
  }
});

Hooks.on("canvasReady", () => {
  for (const token of canvas.tokens?.placeables ?? []) ensureMapArrow(token);
});

/* API per macro */
Hooks.once("ready", () => {
  game.foundryWar ??= {};
  game.foundryWar.moveAllTokens = moveAllTokens;
  game.foundryWar.getTokenMoveData = (tokenOrDoc) =>
    getMoveData(tokenOrDoc?.document ?? tokenOrDoc);
  game.foundryWar.setTokenMoveData = (tokenOrDoc, data) =>
    setMoveData(tokenOrDoc?.document ?? tokenOrDoc, data);

  // Lettura comoda: game.foundryWar.getTokenHp(token) -> { value, max, dead }
  game.foundryWar.getTokenHp = (tokenOrDoc) => {
    const doc = tokenOrDoc?.document ?? tokenOrDoc;
    const hp = getActorHp(doc);
    return hp ? { ...hp, dead: hp.value <= 0 } : null;
  };
});
