# Guida per aggiungere una lezione

1. Copiare `content/il-rubicone.json` e assegnare un nuovo `id`.
2. Ogni blocco deve avere un `id` stabile e unico.
3. Creare il quiz corrispondente in `quiz/`.
4. Ogni domanda deve indicare il blocco di recupero con il campo `block`.
5. Aggiungere la lezione a `data/catalog.json`.
6. Aggiungere i nuovi file all’elenco `ASSETS` del Service Worker.

Il testo resta separato dal codice dell’interfaccia.
