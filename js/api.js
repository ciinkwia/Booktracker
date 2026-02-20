window.BookAPI = (function () {
  'use strict';

  var SEARCH_URL = 'https://openlibrary.org/search.json';
  var COVER_URL = 'https://covers.openlibrary.org/b/id';
  var FIELDS = 'key,title,author_name,first_publish_year,isbn,cover_i,number_of_pages_median';
  var RESULTS_LIMIT = 20;

  function isISBN(query) {
    var cleaned = query.replace(/[-\s]/g, '');
    return /^\d{10}(\d{3})?$/.test(cleaned);
  }

  function search(query) {
    if (!query.trim()) return Promise.resolve([]);

    var url;
    if (isISBN(query)) {
      var cleaned = query.replace(/[-\s]/g, '');
      url = SEARCH_URL + '?isbn=' + encodeURIComponent(cleaned) +
        '&fields=' + FIELDS + '&limit=' + RESULTS_LIMIT;
    } else {
      url = SEARCH_URL + '?q=' + encodeURIComponent(query) +
        '&fields=' + FIELDS + '&limit=' + RESULTS_LIMIT;
    }

    return fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error('Search failed: ' + response.status);
        return response.json();
      })
      .then(function (data) {
        return (data.docs || []).map(normalizeResult);
      });
  }

  function normalizeResult(doc) {
    return {
      id: doc.key,
      title: doc.title || 'Unknown Title',
      authors: doc.author_name || ['Unknown Author'],
      isbn: (doc.isbn && doc.isbn[0]) || null,
      coverUrl: doc.cover_i
        ? COVER_URL + '/' + doc.cover_i + '-M.jpg'
        : null,
      publishYear: doc.first_publish_year || null,
      pageCount: doc.number_of_pages_median || null
    };
  }

  function getCoverUrl(coverId, size) {
    if (!coverId) return null;
    return COVER_URL + '/' + coverId + '-' + (size || 'M') + '.jpg';
  }

  return {
    search: search,
    isISBN: isISBN,
    getCoverUrl: getCoverUrl
  };
})();