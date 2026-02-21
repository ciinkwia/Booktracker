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
    var cats = book.categories || [];
    var catBadges = '';
    if (book.list === 'own' && cats.length > 0) {
      catBadges = '<div class="book-cat-badges">' +
        cats.map(function (c) { return '<span class="book-cat-badge">' + escapeHtml(c) + '</span>'; }).join('') +
      '</div>';
    }

    return '<div class="book-card" data-book-id="' + escapeHtml(book.id) + '">' +
      renderCover(book.coverUrl, book.title, 'small') +
      '<div class="book-info">' +
        '<div class="book-title">' + escapeHtml(book.title) + '</div>' +
        '<div class="book-author">' + authors + '</div>' +
        (year ? '<div class="book-year">' + year + '</div>' : '') +
        catBadges +
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

  function renderManualAddForm() {
    return '<div class="manual-add-section">' +
      '<div class="manual-add-header">Can\'t find your book? Add it manually</div>' +
      '<div class="manual-add-form">' +
        '<input type="text" id="manual-title" placeholder="Book title (required)" autocomplete="off">' +
        '<input type="text" id="manual-author" placeholder="Author (required)" autocomplete="off">' +
        '<div class="manual-add-buttons">' +
          '<button class="add-btn" data-action="manual-add" data-list="wantToRead" disabled>Want to Read</button>' +
          '<button class="add-btn" data-action="manual-add" data-list="read" disabled>Read</button>' +
          '<button class="add-btn" data-action="manual-add" data-list="own" disabled>My Library</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderCategoryPicker(bookId, selectedCategories, allCategories) {
    var selected = selectedCategories || [];
    var html = '<div class="detail-section">' +
      '<div class="detail-section-title">Categories (up to 2)</div>' +
      '<div class="category-picker" data-book-id="' + escapeHtml(bookId) + '">';
    for (var i = 0; i < allCategories.length; i++) {
      var cat = allCategories[i];
      var isSelected = selected.indexOf(cat) !== -1;
      html += '<button class="cat-chip' + (isSelected ? ' cat-chip-selected' : '') +
        '" data-action="toggle-category" data-category="' + escapeHtml(cat) +
        '" data-book-id="' + escapeHtml(bookId) + '">' +
        escapeHtml(cat) + '</button>';
    }
    html += '</div></div>';
    return html;
  }

  function renderCategoryGroupedList(books, categories) {
    var groups = {};
    var uncategorized = [];

    // Initialize groups in user-defined order
    categories.forEach(function (cat) { groups[cat] = []; });

    books.forEach(function (book) {
      var cats = book.categories || [];
      if (cats.length === 0) {
        uncategorized.push(book);
      } else {
        cats.forEach(function (cat) {
          if (groups[cat]) {
            groups[cat].push(book);
          } else {
            // Category was deleted but book still has it — treat as uncategorized
            uncategorized.push(book);
          }
        });
      }
    });

    // Sort books within a group: by author first, then title
    function sortByAuthorTitle(a, b) {
      var authorA = (a.authors || [''])[0].toLowerCase();
      var authorB = (b.authors || [''])[0].toLowerCase();
      if (authorA < authorB) return -1;
      if (authorA > authorB) return 1;
      var titleA = (a.title || '').toLowerCase();
      var titleB = (b.title || '').toLowerCase();
      if (titleA < titleB) return -1;
      if (titleA > titleB) return 1;
      return 0;
    }

    var html = '';
    // Render in user-defined order
    categories.forEach(function (cat) {
      if (groups[cat] && groups[cat].length > 0) {
        groups[cat].sort(sortByAuthorTitle);
        html += '<div class="category-group">' +
          '<div class="category-header">' + escapeHtml(cat) + '</div>' +
          groups[cat].map(renderBookCard).join('') +
        '</div>';
      }
    });

    if (uncategorized.length > 0) {
      uncategorized.sort(sortByAuthorTitle);
      html += '<div class="category-group">' +
        '<div class="category-header">Uncategorized</div>' +
        uncategorized.map(renderBookCard).join('') +
      '</div>';
    }

    return html;
  }

  function renderCategoryManager(categories) {
    var html = '<div class="cat-manager-header">' +
      '<span>Manage Categories</span>' +
      '<button class="icon-btn" data-action="close-cat-manager" aria-label="Close">' +
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
    '</div>';

    html += '<div class="cat-manager-add">' +
      '<input type="text" id="new-category-input" placeholder="New category name..." autocomplete="off">' +
      '<button class="cat-add-btn" data-action="add-category">Add</button>' +
    '</div>';

    html += '<div class="cat-manager-list">';
    for (var i = 0; i < categories.length; i++) {
      var cat = categories[i];
      html += '<div class="cat-manager-item" data-index="' + i + '">' +
        '<div class="cat-manager-arrows">' +
          '<button class="cat-arrow-btn" data-action="move-cat-up" data-index="' + i + '"' +
            (i === 0 ? ' disabled' : '') + '>' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>' +
          '</button>' +
          '<button class="cat-arrow-btn" data-action="move-cat-down" data-index="' + i + '"' +
            (i === categories.length - 1 ? ' disabled' : '') + '>' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' +
          '</button>' +
        '</div>' +
        '<span class="cat-manager-name">' + escapeHtml(cat) + '</span>' +
        '<button class="cat-delete-btn" data-action="delete-category" data-category="' + escapeHtml(cat) + '">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
        '</button>' +
      '</div>';
    }
    html += '</div>';

    return html;
  }

  function renderBookDetail(book, allCategories) {
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

    var categoryHtml = '';
    if (book.list === 'own' && allCategories && allCategories.length > 0) {
      categoryHtml = renderCategoryPicker(book.id, book.categories || [], allCategories);
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

    categoryHtml +

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

  function renderBookList(books, listName, container, categories) {
    if (!books || books.length === 0) {
      container.innerHTML = renderEmptyState(listName);
      return;
    }
    var manageBtnHtml = '';
    if (listName === 'own') {
      manageBtnHtml = '<div class="manage-cat-bar">' +
        '<button id="manage-cat-btn" class="manage-cat-btn">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' +
          ' Manage Categories' +
        '</button>' +
      '</div>';
    }
    if (listName === 'own' && categories && categories.length > 0) {
      container.innerHTML = manageBtnHtml + renderCategoryGroupedList(books, categories);
    } else {
      container.innerHTML = manageBtnHtml + books.map(renderBookCard).join('');
    }
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

  function showDetail(book, allCategories) {
    var modal = document.getElementById('book-detail-modal');
    var body = document.getElementById('book-detail-body');
    body.innerHTML = renderBookDetail(book, allCategories);
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
    renderManualAddForm: renderManualAddForm,
    renderCategoryManager: renderCategoryManager,
    LIST_NAMES: LIST_NAMES
  };
})();