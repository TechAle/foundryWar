# Foundry War

Modulo di esempio per **Foundry VTT v13 (verificato su 13.351)**.

Serve come base minima e funzionante: manifest, codice ES module, stili,
localizzazione e release automatica su GitHub.

## Cosa fa

- Aggiunge **Guerra** al menu `⋯` di ogni scheda Attore (PG e PNG).
- Il dialog di configurazione permette di scegliere:
  - **Squadra**: Alleato / Nemico
  - **Tipo di truppa**: lista configurabile dalle impostazioni del modulo
- I dati sono salvati nei flag dell'attore:
  `actor.flags["foundry-war"].war = { team, troopType }`
- La lista predefinita è `Fanteria, Cavalleria, Arcieri, Artiglieria, Mostro, Comandante`
  e si modifica in `Configurazioni → Impostazioni modulo → Tipi di truppa`.
- Comando chat `/war`: apre la configurazione per il token selezionato
  (o per il personaggio associato all'utente).
- API per macro: `game.foundryWar.getWarData(actor)`,
  `game.foundryWar.setWarData(actor, data)`, `game.foundryWar.openConfig(actor)`.

### Pannello di guerra

- Nei **Token Controls** (colonna sinistra della scena) c'è il tool
  **Mostra/nascondi pannello guerra**.
- Click destro su un token → icona bandiera nel Token HUD:
  aggiunge o rimuove il token dal pannello. Con più token selezionati
  l'operazione vale per tutta la selezione.
- Il pannello è diviso in **Alleati** (sinistra) e **Nemici** (destra) e mostra
  per ogni unità token, CR, HP e tipo di truppa.
- Effetti per tipo (calcolati **solo** nel pannello, mai scritti sulla scheda):
  - **Comandante** → *Ispirazione da guerra*: +1 CR a tutte le unità dello
    stesso schieramento (attivo di default).
  - **Arciere** → *Attacco a distanza*: +2 CR a se stesso (attivo di default).
- **Simula guerra**: scrive in chat "Trasforma il CR di tutti quanti in
  esperienza" e mostra due notifiche con gli XP totali di alleati e nemici.
- Lo stato è una **world setting**, quindi condiviso in tempo reale tra tutti i
  client. I giocatori senza permessi di modifica passano la richiesta al GM via
  socket; il GM applica la modifica per tutti.

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
4. Apri la scheda di un attore, clicca `⋯` in alto a destra e scegli **Guerra**.
5. Da console puoi verificare con `game.foundryWar.ping()`, oppure in chat `/war` con un token selezionato.

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
https://github.com/TechAle/foundryWar/releases/latest/download/module.json
```

Questo URL punta sempre all'ultima release, quindi gli aggiornamenti arrivano da soli.

Il `module.json` dentro la release ha `manifest` verso `releases/latest/download/module.json`
e `download` verso lo zip della versione specifica: Foundry può quindi accorgersi delle
versioni successive senza reinstallare.

> Se subito dopo una release `releases/latest` restituisce ancora la versione precedente,
> è la cache di GitHub: basta attendere qualche minuto. In alternativa installa
> dall'URL versionato `releases/download/v0.2.1/module.json`.

> ⚠️ **Non usare l'URL della pagina GitHub** (`https://github.com/TechAle/foundryWar/blob/main/module.json`).
> Quello restituisce HTML, non JSON, e Foundry dà `error parsing ... unexpected token '<'`.
>
> URL corretti:
> - installazione/aggiornamento → `https://github.com/TechAle/foundryWar/releases/latest/download/module.json`
> - file raw del branch (solo per debug) → `https://raw.githubusercontent.com/TechAle/foundryWar/main/module.json`
>
> Se `releases/latest/download/module.json` dà 404, significa che non hai ancora pubblicato una release: crea un tag `v0.1.0` e pushalo.

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
