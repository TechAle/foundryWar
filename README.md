# Foundry War

Modulo di esempio per **Foundry VTT v13 (verificato su 13.351)**.

Serve come base minima e funzionante: manifest, codice ES module, stili,
localizzazione e release automatica su GitHub.

---

## 1. Requisiti

- Foundry VTT **v13** (build 351)
- Node.js solo se in futuro vuoi usare TypeScript/Vite (per questa base non serve)
- Un account GitHub gratuito

## 2. Provarlo in locale (senza zipping)

Foundry carica i moduli da `{userData}/Data/modules/<id>`.
Il modo più comodo è un symlink dalla repo alla cartella moduli.

**macOS**

```bash
ln -s "$(pwd)" "$HOME/Library/Application Support/FoundryVTT/Data/modules/foundry-war"
```

**Windows (PowerShell, eseguito come amministratore)**

```powershell
New-Item -ItemType SymbolicLink `
  -Path "$env:LOCALAPPDATA\FoundryVTT\Data\modules\foundry-war" `
  -Target "C:\percorso\alla\repo\foundryWar"
```

Poi:

1. Avvia Foundry, crea/apri un mondo.
2. `Configurazioni → Gestisci moduli` e attiva **Foundry War**.
3. Ricarica con `F5` dopo ogni modifica.
4. In chat scrivi `/war` per il test, oppure da console: `game.foundryWar.ping()`.

> Il nome della cartella dentro `Data/modules` **deve** essere uguale a `id` in `module.json`.

## 3. Pubblicare una versione (zip automatico)

GitHub Actions compila lo zip e crea la release. Non devi caricare nulla a mano.

```bash
git add .
git commit -m "Prima versione"
git push

git tag v0.1.0
git push origin v0.1.0
```

Dopo circa un minuto, in `Actions` vedrai il workflow **Release** e nella tab
`Releases` troverai:

- `module.json` — il manifest della release
- `module.zip` — il modulo installabile

Puoi anche lanciarlo a mano da `Actions → Release → Run workflow`.

### Installazione in Foundry

Incolla questo URL in `Add-on Modules → Install Module → Manifest URL`:

```
https://github.com/TUO-USER/foundryWar/releases/latest/download/module.json
```

Sostituisci `TUO-USER/foundryWar` con il tuo utente e repo.
Questo URL punta sempre all'ultima release, quindi gli aggiornamenti arrivano da soli.

## 4. Personalizzare

| Cosa cambiare | Dove |
| --- | --- |
| Nome, descrizione, autori | `module.json` |
| `id` del modulo (e nome cartella) | `module.json` + `MODULE_ID` in `scripts/module.js` |
| Logica del modulo | `scripts/module.js` |
| Stili | `styles/module.css` |
| Traduzioni | `lang/en.json`, `lang/it.json` |

Gli URL in `module.json` (`url`, `manifest`, `download`, `bugs`, `changelog`)
vengono sovrascritti automaticamente dal workflow con quelli reali del repo:
in locale puoi lasciare i segnaposto.

## 5. Note su Foundry v13

- Il manifest usa `"id"` (non più `"name"`) e `compatibility.minimum: "13"`.
- Il codice viene caricato con `"esmodules"`, non con `"scripts"`.
- Usa `foundry.applications.api.ApplicationV2` e `HandlebarsApplicationMixin`
  per le finestre: `Application` è deprecata in v13 e rimossa in v14.
- Le API sono namespaced: `foundry.utils`, `foundry.applications`, ecc.
- Gli hook principali restano `Hooks.once("init")` e `Hooks.once("ready")`.
- In v13 `game.modules.get(id)` restituisce il modulo con `.version`, `.api`, ecc.

## 6. Comandi utili

```bash
# valida manifest, traduzioni e file referenziati (gira anche in CI)
npm run check

# crea lo zip a mano (macOS/Linux)
npm run zip
```

## Licenza

MIT — vedi [LICENSE](LICENSE).
