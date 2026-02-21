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

  function getAllBooks() {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = function () { resolve(request.result || []); };
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

        tx.oncomplete = async function () {
          // Sync to Firebase — await it so we know if it worked
          await syncToFirebase(bookData);
          resolve({ success: true });
        };
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

        tx.oncomplete = async function () {
          await syncToFirebase(book);
          resolve({ success: true });
        };
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

      tx.oncomplete = async function () {
        // Sync removal to Firebase
        if (window.BookFirebase && window.BookFirebase.getUser()) {
          try {
            await window.BookFirebase.removeBook(id);
          } catch (e) {
            console.warn('Firebase remove sync failed (book still removed locally):', e);
          }
        }
        resolve({ success: true });
      };
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

        tx.oncomplete = async function () {
          await syncToFirebase(book);
          resolve({ success: true });
        };
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

        tx.oncomplete = async function () {
          await syncToFirebase(book);
          resolve({ success: true });
        };
        tx.onerror = function () { reject(tx.error); };
      } catch (err) {
        reject(err);
      }
    });
  }

  // Helper: sync a book save to Firebase if signed in
  async function syncToFirebase(book) {
    if (window.BookFirebase && window.BookFirebase.getUser()) {
      try {
        await window.BookFirebase.saveBook(book);
      } catch (e) {
        console.warn('Firebase sync failed (data saved locally):', e);
      }
    }
  }

  // Replace all local books with data from Firestore (used on sign-in sync)
  function replaceAllBooks(books) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();

      books.forEach(function (book) {
        store.put(book);
      });

      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  // Upload all local books to Firestore (used on first sign-in when cloud is empty)
  function uploadAllToFirebase() {
    return getAllBooks().then(function (books) {
      if (!window.BookFirebase || !window.BookFirebase.getUser()) return;
      var promises = books.map(function (book) {
        return window.BookFirebase.saveBook(book);
      });
      return Promise.all(promises);
    });
  }

  return {
    init: init,
    getBooksByList: getBooksByList,
    getAllBooks: getAllBooks,
    getBook: getBook,
    bookExists: bookExists,
    addBook: addBook,
    moveBook: moveBook,
    removeBook: removeBook,
    getCounts: getCounts,
    updateNotes: updateNotes,
    updateRating: updateRating,
    replaceAllBooks: replaceAllBooks,
    uploadAllToFirebase: uploadAllToFirebase
  };
})();
