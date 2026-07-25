# Manuale Vivo — Il Rubicone

Prototipo PWA didattico autonomo, costruito a partire dalla dispensa `Cesare e Augusto`.

## Avvio locale

La PWA deve essere servita via HTTP, non aperta direttamente come file.

```bash
python3 -m http.server 8080
```

Poi aprire `http://localhost:8080`.

## Pubblicazione su GitHub Pages

1. Caricare il contenuto della cartella nel repository.
2. In **Settings → Pages**, scegliere il branch `main` e la cartella root.
3. Attendere il deploy.

## Funzioni incluse

- lezione dinamica caricata da JSON;
- quiz con distrattori e recupero specifico;
- appunti ed evidenziazioni in IndexedDB;
- ricerca globale;
- progresso e tempo di studio;
- modalità chiara/scura e dimensione testo;
- manifest e Service Worker per uso offline.

## Limite noto

I dati sono locali al browser. La sincronizzazione fra dispositivi richiede un backend e non è simulata.
