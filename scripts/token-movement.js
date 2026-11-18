/**
 * Foundry War — movimento token con frecce.
 *
 * - Due icone nel Token HUD: direzione (ciclica) e movimento in ft (ciclico).
 * - Un bottone nei Tile Controls muove tutti i token con una direzione.
 * - Se il percorso incontra un muro, il token rimbalza.
 *
 * I dati sono salvati nel flag `flags["foundry-war"].move = { dir, distance }`.
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

const DISTANCES = [0, 5, 10, 15, 20, 30, 40, 60, 90, 120];

const RayClass = globalThis.Ray ?? globalThis.foundry?.canvas?.geometry?.Ray;

function getMoveData(doc) {
  const raw = doc.getFlag(MODULE_ID, FLAG) ?? {};
  const dir = Math.max(0, Math.min(8, Number(raw.dir ?? 0)));
  const distance = Math.max(0, Number(raw.distance ?? 0));
  return { dir, distance };
}

async function setMoveData(doc, data) {
  await doc.setFlag(MODULE_ID, FLAG, data);
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

async function moveToken(token) {
  const doc = token?.document;
  if (!doc) return false;

  const data = getMoveData(doc);
  if (data.dir === 0 || data.distance <= 0) return false;

  const direction = directionInfo(data.dir);
  const len = Math.hypot(direction.dx, direction.dy) || 1;
  const pixels = data.distance * pixelsPerFoot();
  let dx = (direction.dx / len) * pixels;
  let dy = (direction.dy / len) * pixels;

  const origin = token.center.clone();
  const free = (mx, my) => {
    const target = new PIXI.Point(origin.x + mx, origin.y + my);
    return !wallBlocks(origin, target);
  };

  if (!free(dx, dy)) {
    if (free(dx, 0)) {
      dy = -dy;
    } else if (free(0, dy)) {
      dx = -dx;
    } else {
      dx = -dx;
      dy = -dy;
    }
    if (!free(dx, dy)) {
      ui.notifications.warn(
        game.i18n.format("FOUNDRY-WAR.move.blocked", { name: doc.name }),
      );
      return false;
    }
  }

  const newX = Math.round(origin.x + dx - token.w / 2);
  const newY = Math.round(origin.y + dy - token.h / 2);
  await doc.update({ x: newX, y: newY }, { animate: true });

  const newDir = closestDirection(dx, dy);
  if (newDir !== data.dir) {
    await setMoveData(doc, { ...data, dir: newDir });
  }
  return true;
}

async function moveAllTokens() {
  if (!game.user.isGM) return;

  const tokens = canvas.tokens?.placeables ?? [];
  const targets = tokens.filter((token) => {
    const data = getMoveData(token.document);
    return data.dir > 0 && data.distance > 0;
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
/* Token HUD: due icone                                                       */
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

  const distButton = document.createElement("div");
  distButton.className = "control-icon fw-move-dist";

  const refresh = () => {
    const data = getMoveData(doc);
    const info = directionInfo(data.dir);

    dirButton.innerHTML = `<i class="${info.icon}"></i>`;
    dirButton.dataset.tooltip = `${game.i18n.localize(
      "FOUNDRY-WAR.move.direction",
    )}: ${info.label}`;

    distButton.innerHTML = `<i class="fa-solid fa-shoe-prints"></i><span class="fw-move-dist-label">${data.distance}</span>`;
    distButton.dataset.tooltip = `${game.i18n.localize(
      "FOUNDRY-WAR.move.distance",
    )}: ${data.distance} ft`;
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

  distButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const data = getMoveData(doc);
    const index = DISTANCES.indexOf(data.distance);
    const next =
      index === -1
        ? DISTANCES.find((value) => value > data.distance) ?? 0
        : DISTANCES[(index + 1) % DISTANCES.length] ?? 0;
    await setMoveData(doc, { ...data, distance: next });
    refresh();
  });

  refresh();
  column.append(dirButton, distButton);
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
  arrow.text = ARROW_GLYPHS[data.dir] ?? "";
  arrow.visible = game.user.isGM && data.dir > 0;
  arrow.position.set(token.w / 2, -6);

  if (token.sortableChildren) arrow.zIndex = 9999;
}

Hooks.on("refreshToken", (token) => ensureMapArrow(token));

Hooks.on("updateToken", (doc, changes) => {
  if (!changes?.flags?.[MODULE_ID]?.move) return;
  const token = doc.object;
  if (token) ensureMapArrow(token);
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
});
