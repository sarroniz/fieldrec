// IndexedDB: sesiones, archivos de audio, protocolos importados y registro de auditoría.
const DB_NAME = 'fieldrec';
const DB_VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) {
        const s = db.createObjectStore('files', { keyPath: 'id' });
        s.createIndex('session', 'sessionId');
      }
      if (!db.objectStoreNames.contains('protocols')) db.createObjectStore('protocols', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audit')) db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transacción abortada'));
  }));
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  put: (store, value) => tx(store, 'readwrite', (s) => reqP(s.put(value))),
  get: (store, key) => tx(store, 'readonly', (s) => reqP(s.get(key))),
  all: (store) => tx(store, 'readonly', (s) => reqP(s.getAll())),
  del: (store, key) => tx(store, 'readwrite', (s) => reqP(s.delete(key))),
  filesForSession: (sessionId) => tx('files', 'readonly', (s) => reqP(s.index('session').getAll(sessionId))),
  // Metadatos de archivos sin cargar los blobs en la interfaz
  async fileMeta(sessionId) {
    const files = await this.filesForSession(sessionId);
    return files.map(({ blob, data, ...rest }) => rest);
  },
  async deleteSession(sessionId) {
    const files = await this.filesForSession(sessionId);
    await tx('files', 'readwrite', (s) => Promise.all(files.map((f) => reqP(s.delete(f.id)))));
    await this.del('sessions', sessionId);
    return files.length;
  },
  audit: (action, details = {}) =>
    tx('audit', 'readwrite', (s) => reqP(s.add({ time: new Date().toISOString(), action, ...details }))),
};
