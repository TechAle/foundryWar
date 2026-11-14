/**
 * Utility per mantenere la posizione di scorrimento dei pannelli Foundry
 * quando il contenuto viene ridisegnato dopo un aggiornamento condiviso.
 */

const SCROLL_CONTAINERS = [
  ".window-content",
  ".fw-list",
  ".eco-active-list",
  ".eco-log",
];

/** Salva la posizione di tutti i contenitori scrollabili presenti nel pannello. */
export function captureScrollPositions(root) {
  if (!root) return [];

  const positions = [];

  for (const selector of SCROLL_CONTAINERS) {
    root.querySelectorAll(selector).forEach((element, index) => {
      if (element.scrollTop > 0) {
        positions.push({ selector, index, scrollTop: element.scrollTop });
      }
    });
  }

  return positions;
}

/** Ripristina le posizioni salvate dopo un nuovo render. */
export function restoreScrollPositions(root, positions) {
  if (!root || !positions?.length) return;

  for (const { selector, index, scrollTop } of positions) {
    const element = root.querySelectorAll(selector)[index];
    if (element) element.scrollTop = scrollTop;
  }
}
