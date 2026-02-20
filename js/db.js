window.BookDB = (function () {
  'use strict';

  const DB_NAME = 'BookTrackerDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'books';
  let db = null;

  function init() {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function (event) {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('list', 'list', { unique: false });
          store.createIndex('dateAdded', 'dateAdded', { unique: false });
        }
      };

      request.onsuccess = function (event) {
        db = event.target.result;
        resolve(db);
      };

      request.onerror = function (event) {
        reject(event.target.error);
      };
    });
  }

  function getBooksByList(listName) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('list');
      const request = index.getAll(listName);

      request.onsuccess = function () {
        const books = request.result || [];
        books.sort(function (a, b) { return b.dateAdded - a.dateAdded; });
        resolve(books);
      };
      request.onerror = function () { reject(request.error); };
    });
  }

  function getBook(id) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = function () { resolve(request.result || null); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function bookExists(id) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = function () {
        if (request.result) {
          resolve({ exists: true, list: request.result.list });
        } else {
          resolve({ exists: false, list: null });
        }
      };
      request.onerror = function () { reject(request.error); };
    });
  }

  function addBook(bookData) {
    return new Promise(async function (resolve, reject) {
      try {
        const existing = await bookExists(bookData.id);
        if (existing.exists) {
          resolve({ success: false, reason: 'exists', existingList: existing.list });
          return;
        }

        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.add(bookData);

        tx.oncomplete = function () { resolve({ success: true }); };
        tx.onerror = function () { reject(tx.error); };
      } catch (err) {
        reject(err);
      }
    });
  }

  function moveBook(id, newList) {
    return new Promise(async function (resolve, reject) {
      try {
        const book = await getBook(id);
        if (!book) {
          resolve({ success: false, reason: 'not_found' });
          return;
        }

        book.list = newList;
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(book);

        tx.oncomplete = function () { resolve({ success: true }); };
        tx.onerror = function () { reject(tx.error); };
      } catch (err) {
        reject(err);
      }
    });
  }

  function removeBook(id) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);

      tx.oncomplete = function () { resolve({ success: true }); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function getCounts() {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const counts = { wantToRead: 0, read: 0, own: 0 };

      const request = store.openCursor();
      request.onsuccess = function (event) {
        const cursor = event.target.result;
        if (cursor) {
          const list = cursor.value.list;
          if (counts.hasOwnProperty(list)) {
            counts[list]++;
          }
          cursor.continue();
        } else {
          resolve(counts);
        }
      };
      request.onerror = function () { reject(request.error); };
    });
  }

  function updateNotes(id, notes) {
    return new Promise(async function (resolve, reject) {
      try {
        const book = await getBook(id);
        if (!book) {
          resolve({ success: false, reason: 'not_found' });
          return;
        }

        book.notes = notes;
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(book);

        tx.oncomplete = function () { resolve({ success: true }); };
        tx.onerror = function () { reject(tx.error); };
      } catch (err) {
        reject(err);
      }
    });
  }

  function updateRating(id, rating) {
    return new Promise(async function (resolve, reject) {
      try {
        const book = await getBook(id);
        if (!book) {
          resolve({ success: false, reason: 'not_found' });
          return;
        }

        book.rating = rating;
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(book);

        tx.oncomplete = function () { resolve({ success: true }); };
        tx.onerror = function () { reject(tx.error); };
      } catch (err) {
        reject(err);
      }
    });
  }

  return {
    init: init,
    getBooksByList: getBooksByList,
    getBook: getBook,
    bookExists: bookExists,
    addBook: addBook,
    moveBook: moveBook,
    removeBook: removeBook,
    getCounts: getCounts,
    updateNotes: updateNotes,
    updateRating: updateRating
  };
})();