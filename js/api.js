window.BookAPI = (function () {
  'use strict';

  var GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';
  var RESULTS_LIMIT = 20;

  function isISBN(query) {
    var cleaned = query.replace(/[-\s]/g, '');
    return /^\d{10}(\d{3})?$/.test(cleaned);
  }

  function search(query) {
    if (!query.trim()) return Promise.resolve([]);

    var q;
    if (isISBN(query)) {
      q = 'isbn:' + query.replace(/[-\s]/g, '');
    } else {
      q = query;
    }

    var url = GOOGLE_BOOKS_URL + '?q=' + encodeURIComponent(q) +
      '&maxResults=' + RESULTS_LIMIT + '&printType=books';

    return fetch(url, { mode: 'cors' })
      .then(function (response) {
        if (!response.ok) throw new Error('Search failed: ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data.items) return [];
        return data.items.map(normalizeResult);
      });
  }

  function normalizeResult(item) {
    var info = item.volumeInfo || {};
    var isbn = null;

    if (info.industryIdentifiers) {
      // Prefer ISBN_13, fall back to ISBN_10
      for (var i = 0; i < info.industryIdentifiers.length; i++) {
        var id = info.industryIdentifiers[i];
        if (id.type === 'ISBN_13') { isbn = id.identifier; break; }
        if (id.type === 'ISBN_10' && !isbn) { isbn = id.identifier; }
      }
    }

    var coverUrl = null;
    if (info.imageLinks) {
      // Use thumbnail and upgrade to a better size
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

  return {
    search: search,
    isISBN: isISBN
  };
})();