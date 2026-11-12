/**
 * Foundry War - classi (gruppi) e abilità.
 *
 * I gruppi sono salvati in una world setting (`warGroups`), quindi condivisi.
 * I token salvano solo il nome del gruppo e lo stato delle abilità.
 */

const MODULE_ID = "foundry-war";
const SETTING = "warGroups";

export const ABILITY_TYPES = [
  { id: "taunt", labelKey: "FOUNDRY-WAR.groups.type.taunt" },
  { id: "resistant", labelKey: "FOUNDRY-WAR.groups.type.resistant" },
  { id: "buffAllies", labelKey: "FOUNDRY-WAR.groups.type.buffAllies" },
  { id: "buffSelf", labelKey: "FOUNDRY-WAR.groups.type.buffSelf" },
  { id: "debuffEnemies", labelKey: "FOUNDRY-WAR.groups.type.debuffEnemies" },
  { id: "lucky", labelKey: "FOUNDRY-WAR.groups.type.lucky" },
  { id: "evasive", labelKey: "FOUNDRY-WAR.groups.type.evasive" },
  { id: "swarm", labelKey: "FOUNDRY-WAR.groups.type.swarm" },
];

export function getGroups() {
  const data = game.settings.get(MODULE_ID, SETTING);
  return { ...(data?.groups ?? {}) };
}

export function getGroup(name) {
  if (!name) return null;
  return getGroups()[name] ?? null;
}

export async function saveGroups(groups) {
  return game.settings.set(MODULE_ID, SETTING, { groups });
}

function uniqueName(groups, base) {
  let name = base;
  let index = 2;
  while (groups[name]) {
    name = `${base} (${index})`;
    index += 1;
  }
  return name;
}

function newAbility() {
  return {
    id: foundry.utils.randomID(8),
    name: "Nuova abilità",
    type: "taunt",
    value: 0,
    defaultActive: true,
  };
}

async function eachTokenActor(callback) {
  const seen = new Set();

  for (const actor of game.actors) {
    seen.add(actor.uuid);
    await callback(actor);
  }

  for (const scene of game.scenes) {
    for (const tokenDoc of scene.tokens) {
      const actor = tokenDoc.actor;
      if (!actor || seen.has(actor.uuid)) continue;
      seen.add(actor.uuid);

      try {
        await callback(actor);
      } catch {
        // Token non aggiornabile (permessi/scena chiusa): ignora.
      }
    }
  }
}

async function migrateActors(oldName, newName) {
  await eachTokenActor(async (actor) => {
    const war = actor.getFlag(MODULE_ID, "war");
    if (war?.group !== oldName) return;
    await actor.setFlag(MODULE_ID, "war", { ...war, group: newName });
  });
}

async function clearActorsGroup(name) {
  await eachTokenActor(async (actor) => {
    const war = actor.getFlag(MODULE_ID, "war");
    if (war?.group !== name) return;
    await actor.setFlag(MODULE_ID, "war", {
      ...war,
      group: "",
      abilities: {},
    });
  });
}

const { ApplicationV2 } = foundry.applications.api;

export class GroupManager extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "foundry-war-groups",
    classes: ["foundry-war-groups-app"],
    window: {
      title: "FOUNDRY-WAR.groups.title",
      icon: "fa-solid fa-users-gear",
      resizable: true,
    },
    position: { width: 860, height: 620 },
    actions: {
      selectGroup: GroupManager.onSelectGroup,
      newGroup: GroupManager.onNewGroup,
      duplicateGroup: GroupManager.onDuplicateGroup,
      deleteGroup: GroupManager.onDeleteGroup,
      saveGroup: GroupManager.onSaveGroup,
      addAbility: GroupManager.onAddAbility,
      removeAbility: GroupManager.onRemoveAbility,
    },
  };

  selected = null;
  editing = null;

  _renderHTML() {
    const groups = getGroups();
    const names = Object.keys(groups).sort((a, b) => a.localeCompare(b));

    if ((!this.selected || !groups[this.selected]) && names.length) {
      this.selected = names[0];
      this.editing = foundry.utils.deepClone(groups[names[0]]);
    }

    const root = document.createElement("div");
    root.className = "fw-groups";

    const list = names.length
      ? names
          .map(
            (name) => `
              <button type="button" class="fw-group-item${name === this.selected ? " active" : ""}"
                      data-action="selectGroup" data-group="${foundry.utils.escapeHTML(name)}">
                ${foundry.utils.escapeHTML(name)}
              </button>
            `,
          )
          .join("")
      : `<p class="fw-hint">${game.i18n.localize("FOUNDRY-WAR.groups.empty")}</p>`;

    root.innerHTML = `
      <aside class="fw-groups-list">
        <button type="button" class="fw-groups-new" data-action="newGroup">
          <i class="fa-solid fa-plus"></i> ${game.i18n.localize("FOUNDRY-WAR.groups.new")}
        </button>
        <div class="fw-groups-items">${list}</div>
      </aside>
      <section class="fw-groups-editor">
        ${this.editing ? this.renderEditor() : `<p class="fw-hint">${game.i18n.localize("FOUNDRY-WAR.groups.select")}</p>`}
      </section>
    `;

    return root;
  }

  renderEditor() {
    const escape = foundry.utils.escapeHTML;

    const rows = (this.editing.abilities ?? [])
      .map(
        (ability) => `
          <div class="fw-group-ability" data-ability-id="${ability.id}">
            <input class="ab-name" type="text" value="${escape(ability.name)}" placeholder="${game.i18n.localize("FOUNDRY-WAR.groups.abilityName")}">
            <select class="ab-type">
              ${ABILITY_TYPES.map(
                (type) =>
                  `<option value="${type.id}"${type.id === ability.type ? " selected" : ""}>${game.i18n.localize(type.labelKey)}</option>`,
              ).join("")}
            </select>
            <input class="ab-value" type="number" min="0" step="1" value="${Number(ability.value) || 0}" title="${game.i18n.localize("FOUNDRY-WAR.groups.value")}">
            <label class="ab-default" title="${game.i18n.localize("FOUNDRY-WAR.groups.defaultActive")}">
              <input type="checkbox"${ability.defaultActive ? " checked" : ""}>
            </label>
            <button type="button" class="fw-group-remove" data-action="removeAbility" data-ability-id="${ability.id}">×</button>
          </div>
        `,
      )
      .join("");

    return `
      <div class="form-group">
        <label>${game.i18n.localize("FOUNDRY-WAR.groups.name")}</label>
        <div class="form-fields">
          <input name="groupName" type="text" value="${escape(this.editing.name)}">
        </div>
      </div>

      <div class="fw-group-abilities">
        <div class="fw-group-ability head">
          <span>${game.i18n.localize("FOUNDRY-WAR.groups.abilityName")}</span>
          <span>${game.i18n.localize("FOUNDRY-WAR.groups.abilityType")}</span>
          <span>${game.i18n.localize("FOUNDRY-WAR.groups.value")}</span>
          <span>${game.i18n.localize("FOUNDRY-WAR.groups.defaultActive")}</span>
          <span></span>
        </div>
        ${rows || `<p class="fw-hint">${game.i18n.localize("FOUNDRY-WAR.groups.noAbilities")}</p>`}
      </div>

      <div class="fw-groups-actions">
        <button type="button" data-action="addAbility">
          <i class="fa-solid fa-plus"></i> ${game.i18n.localize("FOUNDRY-WAR.groups.addAbility")}
        </button>
        <button type="button" data-action="saveGroup" class="fw-groups-save">
          <i class="fa-solid fa-floppy-disk"></i> ${game.i18n.localize("FOUNDRY-WAR.groups.save")}
        </button>
        <button type="button" data-action="duplicateGroup">
          <i class="fa-solid fa-copy"></i> ${game.i18n.localize("FOUNDRY-WAR.groups.duplicate")}
        </button>
        <button type="button" data-action="deleteGroup" class="fw-groups-danger">
          <i class="fa-solid fa-trash"></i> ${game.i18n.localize("FOUNDRY-WAR.groups.delete")}
        </button>
      </div>
    `;
  }

  readForm() {
    const name = this.element.querySelector("[name=groupName]")?.value.trim() ?? "";
    const rows = [...this.element.querySelectorAll(".fw-group-ability[data-ability-id]")];

    const abilities = rows
      .map((row) => ({
        id: row.dataset.abilityId,
        name: row.querySelector(".ab-name").value.trim(),
        type: row.querySelector(".ab-type").value,
        value: Number(row.querySelector(".ab-value").value) || 0,
        defaultActive: row.querySelector(".ab-default input").checked,
      }))
      .filter((ability) => ability.name);

    return { name, abilities };
  }

  async saveCurrent() {
    if (!this.editing) return false;

    const groups = getGroups();
    const oldName = this.editing.name;
    const form = this.readForm();

    if (!form.name) {
      ui.notifications.warn(game.i18n.localize("FOUNDRY-WAR.groups.invalidName"));
      return false;
    }

    if (form.name !== oldName && groups[form.name]) {
      ui.notifications.warn(game.i18n.localize("FOUNDRY-WAR.groups.duplicateName"));
      return false;
    }

    const group = { name: form.name, abilities: form.abilities };

    if (form.name !== oldName) {
      delete groups[oldName];
      await migrateActors(oldName, form.name);
    }

    groups[form.name] = group;
    await saveGroups(groups);

    this.selected = form.name;
    this.editing = foundry.utils.deepClone(group);
    return true;
  }

  static onSelectGroup(_event, target) {
    const name = target.dataset.group;
    const group = getGroup(name);
    if (!group) return;

    this.selected = name;
    this.editing = foundry.utils.deepClone(group);
    this.render();
  }

  static async onNewGroup() {
    const groups = getGroups();
    const name = uniqueName(groups, game.i18n.localize("FOUNDRY-WAR.groups.newName"));
    const group = { name, abilities: [] };

    groups[name] = group;
    await saveGroups(groups);

    this.selected = name;
    this.editing = foundry.utils.deepClone(group);
    this.render();
  }

  static async onDuplicateGroup() {
    if (!this.editing) return;

    if (!(await this.saveCurrent())) return;

    const groups = getGroups();
    const source = groups[this.selected];
    if (!source) return;

    const name = uniqueName(
      groups,
      `${game.i18n.localize("FOUNDRY-WAR.groups.copyPrefix")} ${source.name}`,
    );
    const group = {
      name,
      abilities: (source.abilities ?? []).map((ability) => ({
        ...ability,
        id: foundry.utils.randomID(8),
      })),
    };

    groups[name] = group;
    await saveGroups(groups);

    this.selected = name;
    this.editing = foundry.utils.deepClone(group);
    this.render();
  }

  static async onDeleteGroup() {
    if (!this.selected) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("FOUNDRY-WAR.groups.delete") },
      content: `<p>${game.i18n.format("FOUNDRY-WAR.groups.deleteConfirm", { name: foundry.utils.escapeHTML(this.selected) })}</p>`,
      rejectClose: false,
    });

    if (!confirmed) return;

    const name = this.selected;
    const groups = getGroups();
    delete groups[name];

    await clearActorsGroup(name);
    await saveGroups(groups);

    this.selected = Object.keys(groups).sort((a, b) => a.localeCompare(b))[0] ?? null;
    this.editing = this.selected
      ? foundry.utils.deepClone(groups[this.selected])
      : null;
    this.render();
  }

  static async onSaveGroup() {
    if (await this.saveCurrent()) {
      ui.notifications.info(game.i18n.localize("FOUNDRY-WAR.groups.saved"));
      this.render();
    }
  }

  static onAddAbility() {
    if (!this.editing) return;

    const form = this.readForm();
    this.editing = { ...form, abilities: [...form.abilities, newAbility()] };
    this.render();
  }

  static onRemoveAbility(_event, target) {
    if (!this.editing) return;

    const form = this.readForm();
    const abilityId = target.dataset.abilityId;
    this.editing = {
      ...form,
      abilities: form.abilities.filter((ability) => ability.id !== abilityId),
    };
    this.render();
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onClose(options) {
    super._onClose(options);
    if (managerInstance === this) managerInstance = null;
  }
}

/* -------------------------------------------------------------------------- */
/* Apertura                                                                   */
/* -------------------------------------------------------------------------- */

let managerInstance = null;

export function openGroupManager() {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("FOUNDRY-WAR.groups.gmOnly"));
    return;
  }

  if (!managerInstance?.rendered) managerInstance = new GroupManager();
  managerInstance.render({ force: true });
}
