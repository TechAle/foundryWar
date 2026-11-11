# Simulatore battaglie (Node)

Motore puro in `scripts/battle-engine.js`, runner CLI in `sim/run.mjs`.
Non richiede Foundry né dipendenze npm.

## Modello

- Ogni battaglione ha `troops` (le HP) e un `cr` per truppa.
- Le truppe vengono convertite in **truppe effettive**:
  `truppe effettive = truppe × XP(CR) / 50`.
  - CR 1 → 4 truppe effettive per truppa
  - CR 2 → 9
  - CR 5 → 36
  - CR 10 → 118
- Ogni truppa effettiva vale 1: il vantaggio di un CR alto è nel numero di truppe.
- Ogni round ogni lato schiera fino a `dice` truppe effettive (default 3).
- Ogni confronto usa un jitter log-normale troncato a ±2σ.
- `alpha` controlla il caos: `sigma = alpha × 0.6`.
  - `0` → deterministico
  - `0.3` → default
  - `1` → molto casuale
- Chi perde il confronto perde 1 truppa.
- `rush = false` limita le perdite cumulative al `lossCap` (default 50%): la
  battaglia può finire senza distruggere un lato. Il primo lato che raggiunge
  il limite si ritira.
- `rush = true` rimuove il limite: si continua fino allo sterminio.
- **Vittoria totale**: il margine del vincitore è ≥ `totalThreshold`
  (default 95%) delle truppe iniziali del perdente. Non è un pre-check sulla
  probabilità di vittoria: è una proprietà dell'esito estratto dal tiro.
  - 1,8:1 → capita solo nelle code (~5%)
  - 3:1 → praticamente sempre
- Il tiro `0–100` è un percentile della curva: seleziona un esito con la sua
  probabilità e il suo margine.

## Uso

```bash
# apre il report interattivo con i valori di default
node sim/run.mjs

# valori iniziali personalizzati
node sim/run.mjs --ally "1x10" --enemy "2x8" --runs 20000

# rush e soglia vittoria totale
node sim/run.mjs --ally "1x30" --enemy "1x10" --rush true --totalThreshold 0.95

# personalizza caos e limite perdite
node sim/run.mjs --ally "1x16" --enemy "1x10" --alpha 0.5 --lossCap 0.4
```

Sintassi unità: `CRxTRUPPE`. Esempio: `1x10` = 10 truppe CR 1.
Il report interattivo usa **un battaglione per lato**: se passi più voci,
viene usata la prima.

Opzioni:

| Opzione | Default | Descrizione |
| --- | --- | --- |
| `--ally` / `--enemy` | `1x10` | valori iniziali degli slider |
| `--runs` | `20000` | battaglie simulate (console); nel report max 8000 |
| `--alpha` | `0.3` | caos iniziale (0–1) |
| `--rush` | `false` | perdite illimitate iniziali |
| `--lossCap` | `0.5` | limite perdite senza rush |
| `--totalThreshold` | `0.95` | vittoria totale: margine / truppe iniziali del perdente |
| `--dice` | `3` | truppe schierate per round |
| `--seed` | `12345` | seed del RNG |
| `--out` | `sim/out/report.html` | report HTML |

## Report interattivo

In `sim/out/report.html`:

- **slider** per truppe alleate e nemiche (1–200)
- **slider** per il CR dei due lati (0–20)
- **slider** per alpha
- **checkbox** Rush
- pulsante **Tira 0–100**: estrae un esito dalla curva (pesato sulle
  probabilità) e disegna la linea verticale dove è uscito
- card **Truppe effettive**: mostra subito `truppe × XP(CR) / 50` per i due lati
- card **Vittoria totale**: probabilità complessiva che il tiro cada nella zona
  dorata
- il grafico si ricalcola in tempo reale (debounce ~90 ms)

Il grafico ha due assi:

- **sinistro**: probabilità dell'esito (curva azzurra, area)
- **destro**: perdite medie (linea verde = alleati, linea rossa = nemici)
- **asse X**: truppe alleate rimaste − truppe nemiche rimaste

La **zona dorata** sul grafico è la vittoria totale (margine ≥ soglia rispetto
al perdente). Il marker del tiro è dorato se sei caduto nella zona, bianco
altrimenti.

Hover: probabilità, perdite medie e truppe medie in quel preciso esito.
Sotto il grafico, il pannello del tiro mostra esito, perdite stimate e se è
stata vittoria totale.

Il file `sim/out/report.json` contiene i valori iniziali e la distribuzione.

Il report si apre nel browser:

```bash
open sim/out/report.html        # macOS
```

## Note

- Il grafico e la risoluzione usano lo **stesso** motore: il grafico non può
  mentire rispetto al risultato reale.
- Le curve sono smussate solo per la visualizzazione; il tooltip usa i valori
  reali dei bin.
- Per armate molto grandi (oltre 2000 truppe effettive) la simulazione scala
  **entrambi i lati dello stesso fattore**, così i rapporti restano identici ma
  la battaglia non dura decine di migliaia di round. Le perdite mostrate sono
  riportate alle truppe effettive reali.
- `sim/out/` è generata e ignorata da git.
