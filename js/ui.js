window.BookUI = (function () {
  'use strict';

  var LIST_NAMES = {
    wantToRead: 'Want to Read',
    read: 'Read',
    own: 'My Library'
  };

  var PLACEHOLDER_COLORS = [
    '#E74C3C', '#3498DB', '#2ECC71', '#F39C12', '#9B59B6',
    '#1ABC9C', '#E67E22', '#2980B9', '#8E44AD', '#16A085'
  ];

  function hashString(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function renderCover(coverUrl, title, size) {
    var isLarge = size === 'large';
    var cls = isLarge ? 'detail-cover' : 'book-cover';
    var placeholderCls = isLarge ? 'detail-cover-placeholder' : 'book-cover-placeholder';

    if (coverUrl) {
      return '<img class="' + cls + '" src="' + escapeHtml(coverUrl) +
        '" alt="' + escapeHtml(title) + '" loading="lazy" onerror="this.outerHTML=this.dataset.fallback" data-fallback=\'<div class="' +
        placeholderCls + '" style="background:' + PLACEHOLDER_COLORS[hashString(title) % PLACEHOLDER_COLORS.length] +
        '">' + escapeHtml(title.charAt(0).toUpperCase()) + '</div>\'>';
    }

    var color = PLACEHOLDER_COLORS[hashString(title) % PLACEHOLDER_COLORS.length];
    return '<div class="' + placeholderCls + '" style="background:' + color + '">' +
      escapeHtml(title.charAt(0).toUpperCase()) + '</div>';
  }

  function renderStars(rating, size) {
    var starSize = size === 'large' ? 24 : 14;
    var html = '<div class="star-rating' + (size === 'large' ? ' star-rating-large' : '') + '">';
    for (var i = 1; i <= 5; i++) {
      var filled = i <= (rating || 0);
      html += '<span class="star' + (filled ? ' star-filled' : '') + '" data-star="' + i + '">' +
        '<svg width="' + starSize + '" height="' + starSize + '" viewBox="0 0 24 24" fill="' +
        (filled ? '#FFD700' : 'none') + '" stroke="' + (filled ? '#FFD700' : '#555') +
        '" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' +
      '</span>';
    }
    html += '</div>';
    return html;
  }

  function renderBookCard(book) {
    var authors = escapeHtml((book.authors || []).join(', '));
    var year = book.publishYear ? ' &middot; ' + book.publishYear : '';
    var showStars = book.list === 'read' || book.list === 'own';

    return '<div class="book-card" data-book-id="' + escapeHtml(book.id) + '">' +
      renderCover(book.coverUrl, book.title, 'small') +
      '<div class="book-info">' +
        '<div class="book-title">' + escapeHtml(book.title) + '</div>' +
        '<div class="book-author">' + authors + '</div>' +
        (year ? '<div class="book-year">' + year + '</div>' : '') +
        (showStars ? renderStars(book.rating, 'small') : '') +
      '</div>' +
    '</div>';
  }

  // In-memory store for search results so we don't embed JSON in HTML attributes
  var searchResultsCache = {};

  function clearSearchCache() {
    searchResultsCache = {};
  }

  function cacheSearchResult(result) {
    searchResultsCache[result.id] = result;
  }

  function getCachedResult(id) {
    return searchResultsCache[id] || null;
  }

  function renderSearchResult(result, existingList) {
    cacheSearchResult(result);

    var authors = escapeHtml((result.authors || []).join(', '));
    var year = result.publishYear ? ' &middot; ' + result.publishYear : '';

    var actionsHtml;
    if (existingList) {
      actionsHtml = '<div class="add-actions">' +
        '<span class="on-list-badge">On: ' + escapeHtml(LIST_NAMES[existingList]) + '</span>' +
      '</div>';
    } else {
      actionsHtml = '<div class="add-actions">' +
        '<button class="add-btn" data-action="add" data-list="wantToRead">Want to Read</button>' +
        '<button class="add-btn" data-action="add" data-list="read">Read</button>' +
        '<button class="add-btn" data-action="add" data-list="own">My Library</button>' +
      '</div>';
    }

    return '<div class="search-result" data-book-id="' + escapeHtml(result.id) + '">' +
      renderCover(result.coverUrl, result.title, 'small') +
      '<div class="book-info">' +
        '<div class="book-title">' + escapeHtml(result.title) + '</div>' +
        '<div class="book-author">' + authors + '</div>' +
        (year ? '<div class="book-year">' + year + '</div>' : '') +
        actionsHtml +
      '</div>' +
    '</div>';
  }

  function renderBookDetail(book) {
    var authors = escapeHtml((book.authors || []).join(', '));
    var meta = [];
    if (book.publishYear) meta.push('Published: ' + book.publishYear);
    if (book.pageCount) meta.push(book.pageCount + ' pages');
    if (book.isbn) meta.push('ISBN: ' + book.isbn);

    var moveButtons = '';
    ['wantToRead', 'read', 'own'].forEach(function (list) {
      var isCurrent = book.list === list;
      moveButtons += '<button class="move-btn' + (isCurrent ? ' current' : '') + '" ' +
        (isCurrent ? '' : 'data-action="move" data-list="' + list + '" ') +
        'data-book-id="' + escapeHtml(book.id) + '">' +
        escapeHtml(LIST_NAMES[list]) +
        (isCurrent ? ' (current)' : '') +
      '</button>';
    });

    var showRating = book.list === 'read' || book.list === 'own';
    var ratingHtml = '';
    if (showRating) {
      ratingHtml = '<div class="detail-section">' +
        '<div class="detail-section-title">Your Rating</div>' +
        '<div class="detail-star-rating" data-book-id="' + escapeHtml(book.id) + '">' +
          renderStars(book.rating, 'large') +
        '</div>' +
      '</div>';
    }

    return '<div class="detail-header">' +
      renderCover(book.coverUrl, book.title, 'large') +
      '<div class="detail-info">' +
        '<div class="detail-title">' + escapeHtml(book.title) + '</div>' +
        '<div class="detail-author">' + authors + '</div>' +
        '<div class="detail-meta">' + meta.map(escapeHtml).join('<br>') + '</div>' +
      '</div>' +
    '</div>' +

    ratingHtml +

    '<div class="detail-section">' +
      '<div class="detail-section-title">Notes</div>' +
      '<textarea class="detail-notes" id="book-notes" placeholder="Add your notes...">' +
        escapeHtml(book.notes || '') +
      '</textarea>' +
      '<button class="save-notes-btn" data-action="save-notes" data-book-id="' + escapeHtml(book.id) + '">Save Notes</button>' +
    '</div>' +

    '<div class="detail-section">' +
      '<div class="detail-section-title">Move to List</div>' +
      '<div class="move-buttons">' + moveButtons + '</div>' +
    '</div>' +

    '<div class="detail-section">' +
      '<button class="remove-btn" data-action="remove" data-book-id="' + escapeHtml(book.id) + '">Remove from Library</button>' +
    '</div>';
  }

  function renderEmptyState(listName) {
    var messages = {
      wantToRead: 'No books in your reading wishlist yet.',
      read: "You haven't logged any finished books yet.",
      own: 'Your library is empty.'
    };

    return '<div class="empty-state">' +
      '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>' +
        '<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>' +
      '</svg>' +
      '<div class="empty-state-text">' + messages[listName] + '</div>' +
      '<button class="empty-state-btn" id="empty-search-btn">Search for Books</button>' +
    '</div>';
  }

  function renderBookList(books, listName, container) {
    if (!books || books.length === 0) {
      container.innerHTML = renderEmptyState(listName);
      return;
    }
    container.innerHTML = books.map(renderBookCard).join('');
  }

  function updateCounts(counts) {
    ['wantToRead', 'read', 'own'].forEach(function (list) {
      var el = document.getElementById('count-' + list);
      if (el) {
        var count = counts[list] || 0;
        el.textContent = count;
        el.classList.toggle('visible', count > 0);
      }
    });
  }

  function showSearch() {
    var overlay = document.getElementById('search-overlay');
    overlay.classList.remove('hidden');
    requestAnimationFrame(function () {
      overlay.classList.add('visible');
    });
  }

  function hideSearch() {
    var overlay = document.getElementById('search-overlay');
    overlay.classList.remove('visible');
    setTimeout(function () {
      overlay.classList.add('hidden');
    }, 300);
  }

  function showDetail(book) {
    var modal = document.getElementById('book-detail-modal');
    var body = document.getElementById('book-detail-body');
    body.innerHTML = renderBookDetail(book);
    modal.classList.remove('hidden');
  }

  function hideDetail() {
    var modal = document.getElementById('book-detail-modal');
    modal.classList.add('hidden');
  }

  function showToast(message) {
    var container = document.getElementById('toast-container');
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 2200);
  }

  return {
    renderBookCard: renderBookCard,
    renderSearchResult: renderSearchResult,
    renderBookDetail: renderBookDetail,
    renderEmptyState: renderEmptyState,
    renderBookList: renderBookList,
    updateCounts: updateCounts,
    showSearch: showSearch,
    hideSearch: hideSearch,
    showDetail: showDetail,
    hideDetail: hideDetail,
    showToast: showToast,
    clearSearchCache: clearSearchCache,
    getCachedResult: getCachedResult,
    LIST_NAMES: LIST_NAMES
  };
})();