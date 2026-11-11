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
- `alpha` controlla il caos **per confronto**: `sigma = alpha × 0.6`.
  - `0` → deterministico
  - `0.15` → default
  - `1` → molto casuale
- `forceCompression` ("compressione") riduce l'impatto del vantaggio numerico:
  le truppe effettive usate nella simulazione sono `truppe^(1 - compressione × 0.8)`.
  Più è alta, più truppe servono per ottenere lo stesso vantaggio.
  - `0` → nessuna compressione
  - `0.2` → default
  - `0.5` → un 10:1 si comporta circa come un 5:1 (85/15)
  - `1` → compressione massima
- `battleSigma` ("swing") è l'imprevisto **di battaglia**: un fattore di
  fortuna/morale fisso per tutto lo scontro. Rende meno automatico il vantaggio
  numerico.
  - `0` → i numeri dominano (2:1 ≈ 99/1)
  - `0.05` → default (2:1 ≈ 74/26, 5:1 ≈ 93/7, 10:1 ≈ 98/2)
    - 10 CR1 vs 10 CR2 → CR2 vince ~78%
    - 10 CR1 vs 10 CR3 → CR3 vince ~87%
  - `0.5+` → molti upset, ma il lato con più truppe resta favorito
- Chi perde il confronto perde 1 truppa.
- `rush = false` limita le perdite cumulative al `lossCap` (default 50%): la
  battaglia può finire senza distruggere un lato. Il primo lato che raggiunge
  il limite si ritira.
- `rush = true` rimuove il limite: si continua fino allo sterminio.
- **Pareggio**: se il margine finale è entro `drawBand` (default 2 truppe
  effettive) e nessuno dei due è stato azzerato, l'esito è un pareggio. Con
  forze identiche succede circa il 14% delle volte. `0` disattiva i pareggi.
  Un pareggio **non è senza perdite**: è una battaglia con perdite simili da
  entrambi i lati (nel caso 40 vs 40, ~19 per parte contro 15 di media).
- **Vittoria totale**: il margine del vincitore è ≥ `totalThreshold`
  (default 80%) delle truppe iniziali **del vincitore**. In pratica il vincitore
  conserva quasi tutto il suo esercito e travolge il perdente. Non è un
  pre-check sulla probabilità di vittoria: è una proprietà dell'esito.
  - 2:1 → quasi mai
  - 5:1 → rara
  - 10:1 → circa 70%
- Il tiro `0–100` è un percentile della curva: seleziona un esito con la sua
  probabilità e il suo margine.

## Uso

```bash
# apre il report interattivo con i valori di default
node sim/run.mjs

# valori iniziali personalizzati
node sim/run.mjs --ally "1x10" --enemy "2x8" --runs 20000

# rush e soglia vittoria totale
node sim/run.mjs --ally "1x30" --enemy "1x10" --rush true --totalThreshold 0.85

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
| `--alpha` | `0.15` | caos per confronto (0–1) |
| `--battleSigma` | `0.05` | swing/imprevisto di battaglia (0–2) |
| `--compression` | `0.2` | compressione forze: più alta = più truppe per un vantaggio (0–1) |
| `--drawBand` | `2` | margine entro cui la battaglia è un pareggio (0 = mai) |
| `--rush` | `false` | perdite illimitate iniziali |
| `--lossCap` | `0.5` | limite perdite senza rush |
| `--totalThreshold` | `0.8` | vittoria totale: margine / truppe iniziali del vincitore |
| `--dice` | `3` | truppe schierate per round |
| `--seed` | `12345` | seed del RNG |
| `--out` | `sim/out/report.html` | report HTML |

## Report interattivo

In `sim/out/report.html` (passa o clicca sul **?** accanto a ogni voce per la spiegazione):

- **slider** per truppe alleate e nemiche (1–200)
- **slider** per il CR dei due lati (0–20)
- **slider** per alpha
- **slider** per lo swing (imprevisto di battaglia)
- **slider** per la soglia di vittoria totale
- **slider** per la compressione delle forze
- **slider** per la soglia di pareggio
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

Sul grafico:

- **zona dorata a destra**: vittoria totale alleati
  (margine ≥ soglia rispetto alle truppe iniziali nemiche)
- **zona rossa a sinistra**: vittoria totale nemici, cioè sconfitta totale alleati
- le due soglie sono disegnate come linee tratteggiate con il valore numerico
- il marker del tiro è dorato (vittoria totale alleati), rosso (vittoria totale
  nemici) o bianco (esito normale)

Hover: probabilità, perdite medie e truppe medie in quel preciso esito.
Sotto il grafico, il pannello del tiro mostra esito, perdite stimate e se è
stata vittoria totale.

Il file `sim/out/report.json` contiene i valori iniziali e la distribuzione.

Il report si apre nel browser:

```bash
open sim/out/report.html        # macOS
```

Oppure, per servirlo con un server locale Node (utile se il browser blocca
`file://` o vuoi ricaricare senza riaprire il file):

```bash
node sim/serve.mjs              # http://127.0.0.1:8765/report.html
node sim/serve.mjs 3000         # porta personalizzata
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
- Con forze effettive **identiche** il motore registra anche l'esito speculare
  di ogni battaglia (antithetic sampling): 40 vs 40 dà esattamente 50/50 e una
  curva simmetrica, senza rumore Monte Carlo.
- `sim/out/` è generata e ignorata da git.
