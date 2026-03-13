window.BookAPI = (function () {
  'use strict';

  var GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';
  var OPEN_LIBRARY_URL = 'https://openlibrary.org/search.json';
  var RESULTS_LIMIT = 20;

  function isISBN(query) {
    var cleaned = query.replace(/[-\s]/g, '');
    return /^\d{10}(\d{3})?$/.test(cleaned);
  }

  // Main search: try Google Books first, fall back to Open Library
  function search(query) {
    if (!query.trim()) return Promise.resolve([]);

    return searchGoogle(query).catch(function (err) {
      console.warn('Google Books failed, trying Open Library:', err.message);
      return searchOpenLibrary(query);
    });
  }

  // ---- Google Books ----
  function searchGoogle(query) {
    var q;
    if (isISBN(query)) {
      q = 'isbn:' + query.replace(/[-\s]/g, '');
    } else {
      q = query;
    }

    var url = GOOGLE_BOOKS_URL + '?q=' + encodeURIComponent(q) +
      '&maxResults=' + RESULTS_LIMIT + '&printType=books';

    return fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error('Google Books: ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data.items) return [];
        return data.items.map(normalizeGoogle);
      });
  }

  function normalizeGoogle(item) {
    var info = item.volumeInfo || {};
    var isbn = null;

    if (info.industryIdentifiers) {
      for (var i = 0; i < info.industryIdentifiers.length; i++) {
        var id = info.industryIdentifiers[i];
        if (id.type === 'ISBN_13') { isbn = id.identifier; break; }
        if (id.type === 'ISBN_10' && !isbn) { isbn = id.identifier; }
      }
    }

    var coverUrl = null;
    if (info.imageLinks) {
      coverUrl = (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail || '')
        .replace('http://', 'https://')
        .replace('&edge=curl', '');
    }

    return {
      id: 'gbooks:' + item.id,
      title: info.title || 'Unknown Title',
      authors: info.authors || ['Unknown Author'],
      isbn: isbn,
      coverUrl: coverUrl,
      publishYear: info.publishedDate ? parseInt(info.publishedDate.substring(0, 4), 10) || null : null,
      pageCount: info.pageCount || null
    };
  }

  // ---- Open Library (fallback) ----
  function searchOpenLibrary(query) {
    var params;
    if (isISBN(query)) {
      params = 'isbn=' + encodeURIComponent(query.replace(/[-\s]/g, ''));
    } else {
      params = 'q=' + encodeURIComponent(query);
    }

    var url = OPEN_LIBRARY_URL + '?' + params +
      '&fields=key,title,author_name,first_publish_year,isbn,cover_i,number_of_pages_median' +
      '&limit=' + RESULTS_LIMIT;

    return fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error('Open Library: ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data.docs) return [];
        return data.docs.map(normalizeOpenLibrary);
      });
  }

  function normalizeOpenLibrary(doc) {
    var coverUrl = null;
    if (doc.cover_i) {
      coverUrl = 'https://covers.openlibrary.org/b/id/' + doc.cover_i + '-M.jpg';
    }

    var isbn = null;
    if (doc.isbn && doc.isbn.length > 0) {
      // Prefer 13-digit ISBN
      for (var i = 0; i < doc.isbn.length; i++) {
        if (doc.isbn[i].length === 13) { isbn = doc.isbn[i]; break; }
      }
      if (!isbn) isbn = doc.isbn[0];
    }

    return {
      id: 'ol:' + (doc.key || '').replace('/works/', ''),
      title: doc.title || 'Unknown Title',
      authors: doc.author_name || ['Unknown Author'],
      isbn: isbn,
      coverUrl: coverUrl,
      publishYear: doc.first_publish_year || null,
      pageCount: doc.number_of_pages_median || null
    };
  }

  return {
    search: search,
    isISBN: isISBN
  };
})();
