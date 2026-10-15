const DB = 'paperlens-files';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 2);
    request.onupgradeneeded = () => {
      for (const name of ['pdfs', 'images']) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(name, mode, operation) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const request = operation(tx.objectStore(name));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const savePdf = (id, blob) => transact('pdfs', 'readwrite', store => store.put(blob, id));
export const getPdf = id => transact('pdfs', 'readonly', store => store.get(id));
export const deletePdf = id => transact('pdfs', 'readwrite', store => store.delete(id));
export const saveImage = (id, blob) => transact('images', 'readwrite', store => store.put(blob, id));
export const getImage = id => transact('images', 'readonly', store => store.get(id));
export const deleteImage = id => transact('images', 'readwrite', store => store.delete(id));
