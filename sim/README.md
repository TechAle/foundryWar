# Simulatore battaglie (Node)

Motore puro in `scripts/battle-engine.js`, runner CLI in `sim/run.mjs`.
Non richiede Foundry né dipendenze npm.

## Modello

- Ogni battaglione ha `troops` (le HP) e un `cr` per truppa.
- La forza di una truppa è l'XP del suo CR: minimo **50**, arrotondato per difetto.
- Ogni round ogni lato schiera fino a `dice` truppe (le più forti, default 3).
- Ogni truppa confronta `forza × jitter`, con jitter log-normale troncato a ±2σ.
- `alpha` controlla il caos: `sigma = alpha × 0.6`.
  - `0` → deterministico
  - `0.3` → default
  - `1` → molto casuale
- Chi perde il confronto perde 1 truppa.
- `rush = false` limita le perdite cumulative al `lossCap` (default 50%): la
  battaglia può finire senza distruggere un lato. Il primo lato che raggiunge
  il limite si ritira.
- `rush = true` rimuove il limite: si continua fino allo sterminio.
- Se un lato ha probabilità di vittoria ≥ `threshold` (default 0.95), è
  **vittoria schiacciante**: si usa l'esito medio condizionato alla vittoria,
  senza campionare.

## Uso

```bash
# apre il report interattivo con i valori di default
node sim/run.mjs

# valori iniziali personalizzati
node sim/run.mjs --ally "1x10" --enemy "2x8" --runs 20000

# rush e soglia schiacciante
node sim/run.mjs --ally "1x30" --enemy "1x10" --rush true --threshold 0.95

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
| `--threshold` | `0.95` | soglia vittoria schiacciante |
| `--dice` | `3` | truppe schierate per round |
| `--seed` | `12345` | seed del RNG |
| `--out` | `sim/out/report.html` | report HTML |

## Report interattivo

In `sim/out/report.html`:

- **slider** per truppe alleate e nemiche (1–200)
- **slider** per il CR dei due lati (0–20)
- **slider** per alpha
- **checkbox** Rush
- il grafico si ricalcola in tempo reale (debounce ~90 ms)

Il grafico ha due assi:

- **sinistro**: probabilità dell'esito (curva azzurra, area)
- **destro**: perdite medie (linea verde = alleati, linea rossa = nemici)
- **asse X**: truppe alleate rimaste − truppe nemiche rimaste

Hover: probabilità, perdite medie e truppe medie in quel preciso esito.

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
- `sim/out/` è generata e ignorata da git.
