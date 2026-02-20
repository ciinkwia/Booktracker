window.BookFirebase = (function () {
  'use strict';

  var firebaseConfig = {
    apiKey: "AIzaSyBCGNg75Y4jRlro_TX5_Rk-pNW3XzZ4pNg",
    authDomain: "booktracker-574a6.firebaseapp.com",
    projectId: "booktracker-574a6",
    storageBucket: "booktracker-574a6.firebasestorage.app",
    messagingSenderId: "845709284863",
    appId: "1:845709284863:web:e1a0d0bf0800737c9183ca"
  };

  var app = null;
  var auth = null;
  var db = null;
  var currentUser = null;
  var onAuthChangeCallback = null;
  var onSyncCallback = null;
  var unsubscribeSnapshot = null;

  function init() {
    app = firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();

    // Enable offline persistence
    db.enablePersistence({ synchronizeTabs: true }).catch(function (err) {
      console.warn('Firestore persistence error:', err.code);
    });

    // Check for redirect result (from signInWithRedirect)
    auth.getRedirectResult().catch(function (err) {
      console.warn('Redirect result error:', err);
    });

    // Listen for auth changes
    auth.onAuthStateChanged(function (user) {
      currentUser = user;
      if (onAuthChangeCallback) onAuthChangeCallback(user);
      if (user) {
        listenToBooks();
      } else if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }
    });
  }

  function signIn() {
    var provider = new firebase.auth.GoogleAuthProvider();
    return auth.signInWithRedirect(provider);
  }

  function signOut() {
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }
    return auth.signOut();
  }

  function getUser() {
    return currentUser;
  }

  function onAuthChange(callback) {
    onAuthChangeCallback = callback;
  }

  function onSync(callback) {
    onSyncCallback = callback;
  }

  // Get the user's books collection reference
  function booksCollection() {
    if (!currentUser) return null;
    return db.collection('users').doc(currentUser.uid).collection('books');
  }

  // Listen for real-time changes from Firestore
  function listenToBooks() {
    if (unsubscribeSnapshot) unsubscribeSnapshot();

    var col = booksCollection();
    if (!col) return;

    unsubscribeSnapshot = col.onSnapshot(function (snapshot) {
      var books = [];
      snapshot.forEach(function (doc) {
        books.push(doc.data());
      });
      if (onSyncCallback) onSyncCallback(books);
    }, function (err) {
      console.error('Firestore listen error:', err);
    });
  }

  // Save a book to Firestore
  function saveBook(book) {
    var col = booksCollection();
    if (!col) return Promise.resolve();
    // Use the book id as the document id (replace / with _ for Firestore)
    var docId = sanitizeId(book.id);
    return col.doc(docId).set(book, { merge: true });
  }

  // Remove a book from Firestore
  function removeBook(id) {
    var col = booksCollection();
    if (!col) return Promise.resolve();
    var docId = sanitizeId(id);
    return col.doc(docId).delete();
  }

  // Get all books from Firestore (one-time fetch)
  function getAllBooks() {
    var col = booksCollection();
    if (!col) return Promise.resolve([]);
    return col.get().then(function (snapshot) {
      var books = [];
      snapshot.forEach(function (doc) {
        books.push(doc.data());
      });
      return books;
    });
  }

  // Firestore doc IDs can't contain /
  function sanitizeId(id) {
    return id.replace(/\//g, '_');
  }

  return {
    init: init,
    signIn: signIn,
    signOut: signOut,
    getUser: getUser,
    onAuthChange: onAuthChange,
    onSync: onSync,
    saveBook: saveBook,
    removeBook: removeBook,
    getAllBooks: getAllBooks
  };
})();