const DB_NAME = 'manuale-vivo-storia-ii-db';
const DB_VERSION = 1;
const STORES = ['progress','positions','sessions','attempts','highlights','notes','settings'];
let promise;

export function database() {
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!request.result.objectStoreNames.contains(name)) {
          request.result.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Impossibile aprire il salvataggio locale.'));
    request.onblocked = () => reject(new Error('Il salvataggio locale è bloccato da una vecchia scheda.'));
  });
  return promise;
}

function transaction(store, mode, action) {
  return database().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const result = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error || new Error(`Errore nel database: ${store}.`));
  }));
}

export const put = (store, value) => transaction(store, 'readwrite', os => os.put(value)).then(() => value);
export const remove = (store, id) => transaction(store, 'readwrite', os => os.delete(id));
export const clearStore = store => transaction(store, 'readwrite', os => os.clear());
export const get = async (store, id) => {
  const db = await database();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};
export const getAll = async store => {
  const db = await database();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
};
