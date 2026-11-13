# Foundry War

Modulo per **Foundry VTT v13** che aggiunge un pannello di guerra condiviso,
classi e abilità personalizzabili, simulazione delle battaglie e un sistema
economico completo per il forte.

Lo stato è sincronizzato in tempo reale tra tutti i client, log compresi.

**Installazione rapida** — Incolla questo URL in Foundry VTT →
Add-on Modules → Install Module:

```
https://github.com/TechAle/foundryWar/releases/latest/download/module.json
```

Richiede Foundry VTT **v13** (verificato su 13.351).

## Funzionalità principali

- **Pannello di guerra condiviso**: alleati/nemici, CR, HP, gruppo e abilità.
- **Classi e abilità personalizzabili**: Taunt, Resistant, Buff/Debuff, Lucky,
  Evasive, Swarm e Fragile.
- **Simulazione battaglie**: grafico degli esiti, tiro 0–100, distribuzione e
  applicazione delle perdite.
- **Economia del forte**: risorse, lavoratori, esercito, fortificazioni,
  macchine d'assalto, commercio, spedizioni e battaglie.
- **Sincronizzazione**: world setting + socket, log inclusi.
- **Split token** e gestione rapida dal Token HUD.

## Cosa fa

- Aggiunge **Guerra** al menu `⋯` di ogni scheda Attore (PG e PNG).
- Il dialog di configurazione permette di scegliere:
  - **Squadra**: Alleato / Nemico
  - **Gruppo (classe)**: es. Comandante, con le sue abilità
- I dati sono salvati nei flag dell'attore:
  `actor.flags["foundry-war"].war = { team, group, abilities }`
- I gruppi e le abilità si gestiscono dal pulsante **Gestione** nel menu `⋯`
  della scheda (solo GM).
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
- Click destro su un token → icona **Split** (solo GM): dimezza le HP del token
  e crea un token adiacente con la metà per difetto; il token originale tiene
  l'eccesso.
- Il pannello è diviso in **Alleati** (sinistra) e **Nemici** (destra) e mostra
  per ogni unità token, CR, HP e gruppo (classe).
- Il **CR è modificabile a mano** con i pulsanti `−` / `+` su ogni card
  (parte dal CR dell'attore, minimo 0). Il valore manuale resta solo nel
  pannello e non tocca la scheda.
- Effetti per tipo (calcolati **solo** nel pannello, mai scritti sulla scheda):
  - **Comandante** → *Ispirazione da guerra*: +1 CR a tutte le unità dello
    stesso schieramento (attivo di default).
  - **Arciere** → *Attacco a distanza*: +2 CR a se stesso (attivo di default).

### Economia del Forte

- Nei **Token Controls** (colonna sinistra della scena) c'è il tool
  **Economia** (icona monete): apre il pannello con tutto il sistema
  economico del forte.
- Il pannello riporta:
  - **Risorse**: Cibo, Legna, Minerali e Popolazione, con produzione,
    consumo settimanale e tratte commerciali attive.
  - **Infrastrutture e Danni**: stato di Ponte, Zone Limitrofe, Zone Interne e
    Porto, con riparazione a costo di 1 Fortificazione.
  - **Lavoratori**: assegnazione di Agricoltori, Taglialegna e Minatori.
  - **Esercito e Difese**: soldati, equipaggiamento, cavalcature,
    fortificazioni e macchine d'assalto, con arruolamento e congedo.
  - **Mappe fortificazioni / macchine d'assalto**: assegnazione per sito
    (massimo 1 fortificazione per sito).
  - **Fabbrica e Cantiere**: produzione di equipaggiamento, cavalcature,
    fortificazioni e macchine d'assalto, con annullamento dell'ultima
    produzione.
  - **Commercio multirisorsa**: invio/ricezione tra risorse, trattenuta,
    cavalcatura, spedizioni singole o ripetitive.
  - **Campagne e battaglie**: invio di soldati con costo del rancio e durata.
  - **Gestione arbitraria**: modifiche manuali del GM o eventi eccezionali.
  - **Registro del Forte**: tutti gli eventi, condivisi tra i client.
- Spedizioni e battaglie arrivate diventano **in attesa**: il pannello mostra
  gli input per inserire i **soldati tornati** (e, per le battaglie, il loot di
  Cibo, Minerali e Legna) e il pulsante **Invia**. Finché ci sono eventi in
  attesa, i pulsanti **+1 Giorno** e **+1 Settimana** restano bloccati: niente
  più prompt bloccanti.
- Lo stato è nella world setting `economyState`, quindi è condiviso in tempo
  reale tra tutti i client (log compresi). I giocatori senza permessi di
  modifica passano la richiesta al GM via socket.
- API per macro: `game.foundryWar.openEconomy()`.

### Classi e abilità

- **Gestione** (menu `⋯` della scheda, solo GM) permette di creare, duplicare,
  rinominare ed eliminare i gruppi.
- Ogni gruppo ha un nome univoco e una lista di abilità. Ogni abilità ha nome,
  tipo, valore e stato predefinito.
- Tipi disponibili:
  - **Taunt**: il doppio probabile di essere colpito
  - **Resistente ai danni**: dimezza i danni subiti (passiva, non mostrata nel
    pannello)
  - **Buff alleati**: +CR a tutti gli alleati
  - **Buff se stesso**: +CR a se stesso
  - **Debuff nemici**: -CR a tutti i nemici
  - **Lucky**: 1dN di riduzione del danno
  - **Evasive**: metà probabile di perdere HP
  - **Swarm**: il CR totale (base + buff/debuff + stance) scende a 3/4 quando
    gli HP arrivano a 3/4 del massimo (arrotondato per difetto), a 1/2 a metà e
    a 1/4 a un quarto (es. CR 4 → 3 → 2 → 1; CR 2 → 1,5 → 1 → 0,5)
  - **Fragile**: le perdite di truppe contano il doppio (2 truppe perse → 4)
- I token salvano solo il **nome del gruppo**: modificando il gruppo cambiano
  tutte le unità che lo usano.
- Squadra e gruppo sono salvati sull'**attore base**: anche i token creati
  trascinando l'attore dalla sidebar sulla scena ereditano la configurazione.
- Nel pannello guerra le abilità del gruppo compaiono come checkbox; Taunt,
  Evasive e i buff sono attivi di default. Resistant è passiva.
- I buff/debuff e **Swarm** modificano il CR effettivo e quindi il grafico.
  Taunt, Evasive e Resistant modificano la distribuzione delle perdite per
  unità, Lucky la riduce e **Fragile** raddoppia le perdite di truppe subite
  (tabella e Applica).

- **Flank / Accerchia** (uno per schieramento): bonus globale di +1 CR / +2 CR
  a tutte le unità di quel lato. Sono mutuamente esclusivi e si disattivano
  ricliccando.
- **Rush** (toggle globale): senza Rush le perdite future saranno limitate al
  50% delle truppe; con Rush si applicheranno le perdite massime.
- **Simula guerra**: calcola la distribuzione degli esiti partendo da tutte le
  unità del pannello (CR effettivo, HP = truppe, effetti e stance inclusi).
  Sotto il pulsante compare:
  - il **grafico** con curva di probabilità, perdite medie e zone di
    vittoria totale
  - **Tira 0–100**: estrae un esito e mostra il segnaposto sul grafico
  - **Applica**: sottrae le perdite (in truppe) dalle HP degli attori
  - la tabella **Perdite per unità**: i CR bassi assorbono più danni, ma non
    tutti
  - **hover** sul grafico: probabilità, perdite e truppe rimaste in quel punto
- La simulazione e il tiro sono **condivisi** tra i client: il grafico è
  deterministico dagli stessi dati e il risultato del tiro viene salvato nello
  stato del pannello. Rush, effetti, CR, stance e roster aggiornano il grafico
  in tempo reale senza dover ripremere Simula guerra.
- XP: minimo **50**, arrotondato per difetto.
- Impostazioni GM del combattimento:
  - **Alpha** (caos per confronto): default `0.15`
  - **Swing** (imprevisto di battaglia): default `0.05`
  - **Compressione forze**: default `0.2`
  - **Soglia vittoria totale**: default `80%`
- Lo stato è una **world setting**, quindi condiviso in tempo reale tra tutti i
  client. I giocatori senza permessi di modifica passano la richiesta al GM via
  socket; il GM applica la modifica per tutti.

---

## Requisiti

- Foundry VTT **v13** (build 351)
- Node.js solo se in futuro vuoi usare TypeScript/Vite (per questa base non serve)
- Un account GitHub gratuito

---

## Licenza

MIT — vedi [LICENSE](LICENSE).
