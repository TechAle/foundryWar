import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const errors = [];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${path}: JSON non valido -> ${error.message}`);
    return null;
  }
}

function requireFile(path, label) {
  if (!existsSync(path)) errors.push(`${label}: file mancante "${path}"`);
}

const manifest = readJson("module.json");

if (manifest) {
  for (const key of ["id", "title", "version", "compatibility"]) {
    if (!manifest[key]) errors.push(`module.json: campo obbligatorio mancante "${key}"`);
  }

  if (manifest.name && !manifest.id) {
    errors.push('module.json: usa "id" invece di "name" (da Foundry v12+)');
  }

  if (manifest.id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.id)) {
    errors.push('module.json: "id" deve essere minuscolo, senza spazi, con trattini');
  }

  if (manifest.compatibility && !manifest.compatibility.minimum) {
    errors.push('module.json: "compatibility.minimum" è obbligatorio');
  }

  for (const file of manifest.esmodules ?? []) requireFile(file, "esmodules");
  for (const file of manifest.styles ?? []) requireFile(file, "styles");

  for (const language of manifest.languages ?? []) {
    requireFile(language.path, `languages.${language.lang}`);
    if (existsSync(language.path)) readJson(language.path);
  }

  if (manifest.readme) requireFile(manifest.readme, "readme");
  if (manifest.license) requireFile(manifest.license, "license");

  if (!(manifest.esmodules ?? []).length) {
    errors.push('module.json: aggiungi almeno un file in "esmodules"');
  }
}

if (existsSync("lang")) {
  for (const file of readdirSync("lang").filter((name) => name.endsWith(".json"))) {
    readJson(join("lang", file));
  }
}

if (errors.length) {
  console.error("Controlli falliti:\n");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`OK: ${manifest.title} v${manifest.version} (id: ${manifest.id})`);
