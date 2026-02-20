(async function () {
  'use strict';

  var currentList = 'wantToRead';
  var searchDebounceTimer = null;
  var DEBOUNCE_MS = 400;

  // ---- Init ----
  async function init() {
    await BookDB.init();
    BookFirebase.init();
    registerServiceWorker();
    setupEventListeners();
    setupFirebaseSync();
    await refreshCurrentList();
    await refreshCounts();
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.error('SW registration failed:', err);
      });
    }
  }

  // ---- Firebase Auth & Sync ----
  function setupFirebaseSync() {
    BookFirebase.onAuthChange(function (user) {
      updateAuthUI(user);
      if (user) {
        handleSignedIn();
      }
    });

    // Real-time sync: when Firestore data changes, update local DB and refresh UI
    BookFirebase.onSync(async function (cloudBooks) {
      if (cloudBooks.length > 0) {
        await BookDB.replaceAllBooks(cloudBooks);
        await refreshCurrentList();
        await refreshCounts();
        showSyncBar('Synced');
      }
    });
  }

  async function handleSignedIn() {
    showSyncBar('Syncing...');
    try {
      var cloudBooks = await BookFirebase.getAllBooks();
      var localBooks = await BookDB.getAllBooks();

      if (cloudBooks.length === 0 && localBooks.length > 0) {
        // First sign-in: upload local books to cloud
        await BookDB.uploadAllToFirebase();
        showSyncBar('Uploaded to cloud');
      } else if (cloudBooks.length > 0) {
        // Cloud has data: merge cloud into local
        // Cloud is the source of truth, but preserve any local-only books
        var cloudIds = {};
        cloudBooks.forEach(function (b) { cloudIds[b.id] = true; });

        // Find local books not in cloud and upload them
        var localOnly = localBooks.filter(function (b) { return !cloudIds[b.id]; });
        for (var i = 0; i < localOnly.length; i++) {
          await BookFirebase.saveBook(localOnly[i]);
        }

        // Merge: cloud books + local-only books
        var merged = cloudBooks.concat(localOnly);
        await BookDB.replaceAllBooks(merged);
        await refreshCurrentList();
        await refreshCounts();
        showSyncBar('Synced');
      }
    } catch (err) {
      console.error('Sync error:', err);
      showSyncBar('Sync error');
    }
  }

  function updateAuthUI(user) {
    var avatar = document.getElementById('auth-avatar');
    var icon = document.getElementById('auth-icon-signedout');

    if (user) {
      avatar.src = user.photoURL || '';
      avatar.classList.remove('hidden');
      icon.classList.add('hidden');
    } else {
      avatar.classList.add('hidden');
      icon.classList.remove('hidden');
    }
  }

  function showSyncBar(text) {
    var bar = document.getElementById('sync-bar');
    var textEl = document.getElementById('sync-text');
    textEl.textContent = text;
    bar.classList.remove('hidden');
    clearTimeout(bar._hideTimer);
    bar._hideTimer = setTimeout(function () {
      bar.classList.add('hidden');
    }, 2500);
  }

  // ---- Event Listeners ----
  function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTab(btn.dataset.list);
      });
    });

    // Search open/close
    document.getElementById('search-open-btn').addEventListener('click', openSearch);
    document.getElementById('search-close-btn').addEventListener('click', closeSearch);

    // Auth button
    document.getElementById('auth-btn').addEventListener('click', async function () {
      if (BookFirebase.getUser()) {
        if (confirm('Sign out? Your data is saved in the cloud.')) {
          await BookFirebase.signOut();
          BookUI.showToast('Signed out');
        }
      } else {
        try {
          await BookFirebase.signIn();
          BookUI.showToast('Signed in');
        } catch (err) {
          console.error('Sign-in error:', err);
          if (err.code === 'auth/unauthorized-domain') {
            BookUI.showToast('Domain not authorized in Firebase');
          } else if (err.code !== 'auth/popup-closed-by-user' &&
                     err.code !== 'auth/cancelled-popup-request') {
            BookUI.showToast('Sign-in error: ' + (err.code || err.message));
          }
        }
      }
    });

    // Search input
    document.getElementById('search-input').addEventListener('input', function (e) {
      clearTimeout(searchDebounceTimer);
      var query = e.target.value;
      var resultsEl = document.getElementById('search-results');
      var statusEl = document.getElementById('search-status');

      if (!query.trim()) {
        resultsEl.innerHTML = '';
        statusEl.textContent = '';
        return;
      }

      statusEl.innerHTML = '<div class="spinner"></div>';
      searchDebounceTimer = setTimeout(function () {
        performSearch(query);
      }, DEBOUNCE_MS);
    });

    // Handle Enter key in search (immediate search)
    document.getElementById('search-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        clearTimeout(searchDebounceTimer);
        var query = e.target.value;
        if (query.trim()) {
          document.getElementById('search-status').innerHTML = '<div class="spinner"></div>';
          performSearch(query);
        }
      }
    });

    // Book list clicks (event delegation)
    document.getElementById('list-container').addEventListener('click', handleListClick);

    // Search result clicks (event delegation)
    document.getElementById('search-results').addEventListener('click', handleSearchResultClick);

    // Modal backdrop close
    document.querySelector('.modal-backdrop').addEventListener('click', function () {
      BookUI.hideDetail();
    });

    // Modal action clicks (event delegation)
    document.getElementById('book-detail-body').addEventListener('click', handleDetailAction);

    // Back button handling for search overlay
    window.addEventListener('popstate', function () {
      var overlay = document.getElementById('search-overlay');
      if (!overlay.classList.contains('hidden')) {
        closeSearch();
      }
    });
  }

  // ---- Tab Switching ----
  async function switchTab(listName) {
    currentList = listName;
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.list === listName);
    });
    await refreshCurrentList();
  }

  // ---- List Rendering ----
  async function refreshCurrentList() {
    var books = await BookDB.getBooksByList(currentList);
    var container = document.getElementById('list-container');
    BookUI.renderBookList(books, currentList, container);

    // Wire up empty state search button if present
    var emptyBtn = document.getElementById('empty-search-btn');
    if (emptyBtn) {
      emptyBtn.addEventListener('click', openSearch);
    }
  }

  async function refreshCounts() {
    var counts = await BookDB.getCounts();
    BookUI.updateCounts(counts);
  }

  // ---- Search ----
  function openSearch() {
    BookUI.showSearch();
    BookUI.clearSearchCache();
    var input = document.getElementById('search-input');
    input.value = '';
    document.getElementById('search-results').innerHTML = '';
    document.getElementById('search-status').textContent = '';
    setTimeout(function () { input.focus(); }, 350);
    history.pushState({ search: true }, '');
  }

  function closeSearch() {
    BookUI.hideSearch();
  }

  async function performSearch(query) {
    var statusEl = document.getElementById('search-status');
    var resultsEl = document.getElementById('search-results');

    try {
      var results = await BookAPI.search(query);

      if (results.length === 0) {
        resultsEl.innerHTML = '<p class="no-results">No books found for "' +
          query.replace(/</g, '&lt;') + '"</p>';
        statusEl.textContent = '';
        return;
      }

      var htmlParts = [];
      for (var i = 0; i < results.length; i++) {
        var existing = await BookDB.bookExists(results[i].id);
        htmlParts.push(BookUI.renderSearchResult(results[i], existing.list));
      }
      resultsEl.innerHTML = htmlParts.join('');
      statusEl.textContent = results.length + ' result' + (results.length !== 1 ? 's' : '');
    } catch (err) {
      console.error('Search error details:', err);
      if (!navigator.onLine) {
        statusEl.textContent = 'You are offline. Search requires an internet connection.';
      } else {
        statusEl.textContent = 'Search error. Please try again.';
      }
      resultsEl.innerHTML = '';
    }
  }

  // ---- Search Result Clicks ----
  async function handleSearchResultClick(event) {
    var addBtn = event.target.closest('[data-action="add"]');
    if (!addBtn) return;

    var card = addBtn.closest('[data-book-id]');
    var listName = addBtn.dataset.list;
    var bookData = BookUI.getCachedResult(card.dataset.bookId);
    if (!bookData) return;

    var result = await BookDB.addBook({
      id: bookData.id,
      title: bookData.title,
      authors: bookData.authors,
      isbn: bookData.isbn,
      coverUrl: bookData.coverUrl,
      publishYear: bookData.publishYear,
      pageCount: bookData.pageCount,
      list: listName,
      dateAdded: Date.now(),
      notes: '',
      rating: 0
    });

    if (result.success) {
      BookUI.showToast('Added to ' + BookUI.LIST_NAMES[listName]);
      var actionsEl = card.querySelector('.add-actions');
      actionsEl.innerHTML = '<span class="on-list-badge">On: ' +
        BookUI.LIST_NAMES[listName] + '</span>';
      await refreshCounts();
      if (listName === currentList) {
        await refreshCurrentList();
      }
    } else if (result.reason === 'exists') {
      BookUI.showToast('Already on ' + BookUI.LIST_NAMES[result.existingList]);
    }
  }

  // ---- List Card Clicks ----
  function handleListClick(event) {
    var card = event.target.closest('[data-book-id]');
    if (!card) return;
    openDetail(card.dataset.bookId);
  }

  async function openDetail(bookId) {
    var book = await BookDB.getBook(bookId);
    if (!book) return;
    BookUI.showDetail(book);
  }

  // ---- Detail Modal Actions ----
  async function handleDetailAction(event) {
    // Handle star rating clicks first (stars don't have data-action)
    var star = event.target.closest('.star');
    if (star) {
      var ratingContainer = star.closest('.detail-star-rating');
      if (ratingContainer) {
        var ratingBookId = ratingContainer.dataset.bookId;
        var rating = parseInt(star.dataset.star, 10);
        await BookDB.updateRating(ratingBookId, rating);
        var updatedBook = await BookDB.getBook(ratingBookId);
        if (updatedBook) BookUI.showDetail(updatedBook);
        await refreshCurrentList();
        BookUI.showToast('Rated ' + rating + ' star' + (rating !== 1 ? 's' : ''));
      }
      return;
    }

    var btn = event.target.closest('[data-action]');
    if (!btn) return;

    var action = btn.dataset.action;
    var bookId = btn.dataset.bookId;

    if (action === 'move') {
      var newList = btn.dataset.list;
      await BookDB.moveBook(bookId, newList);
      BookUI.showToast('Moved to ' + BookUI.LIST_NAMES[newList]);
      BookUI.hideDetail();
      await refreshCurrentList();
      await refreshCounts();

    } else if (action === 'remove') {
      if (btn.dataset.confirmed !== 'true') {
        btn.textContent = 'Tap again to confirm';
        btn.dataset.confirmed = 'true';
        btn.classList.add('confirm-state');
        setTimeout(function () {
          btn.textContent = 'Remove from Library';
          btn.dataset.confirmed = 'false';
          btn.classList.remove('confirm-state');
        }, 3000);
        return;
      }
      await BookDB.removeBook(bookId);
      BookUI.showToast('Book removed');
      BookUI.hideDetail();
      await refreshCurrentList();
      await refreshCounts();

    } else if (action === 'save-notes') {
      var textarea = document.getElementById('book-notes');
      await BookDB.updateNotes(bookId, textarea.value);
      BookUI.showToast('Notes saved');
    }
  }

  // ---- Start ----
  init().catch(function (err) {
    console.error('Init failed:', err);
  });
})();