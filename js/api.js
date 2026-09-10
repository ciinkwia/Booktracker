window.BookAPI = (function () {
  'use strict';

  // ---------------------------------------------------------------
  // Search engine
  //
  // Both sources are queried IN PARALLEL, then the results are pooled,
  // junk (summaries / workbooks / box sets) is dropped, editions of the
  // same book are collapsed into one card, and the survivors are ranked
  // by how well they match what was typed + how well-known they are.
  //
  //   Google Books  — best coverage of brand-new titles, best covers,
  //                   but keyless calls share a per-IP daily quota and
  //                   can 429 at any time, and it returns every edition.
  //   Open Library  — community catalog, great popularity signals
  //                   (readinglog_count), weaker on very new books.
  //
  // If one source fails the other still answers. Only when BOTH fail
  // does search() reject.
  // ---------------------------------------------------------------

  var GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';
  var OPEN_LIBRARY_URL = 'https://openlibrary.org/search.json';

  // Optional. Keyless Google Books calls share a small per-IP quota.
  // To raise it: enable "Books API" on the booktracker-574a6 Firebase
  // project in Google Cloud console, then paste the Firebase web API key
  // (from js/firebase.js) here. Until the API is enabled, a key returns
  // 403, so leave this empty.
  var GOOGLE_BOOKS_KEY = '';

  var GOOGLE_LIMIT = 40;      // max Google allows per call
  var OL_LIMIT = 30;
  var RESULTS_LIMIT = 20;     // what we show
  var FETCH_TIMEOUT_MS = 9000;

  // ---- ISBN ----
  function cleanISBN(query) {
    return query.replace(/[-\s]/g, '');
  }

  function isISBN(query) {
    return /^\d{9}[\dXx]$|^\d{13}$/.test(cleanISBN(query));
  }

  // ---- Fetch with timeout ----
  function fetchJson(url) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = null;
    if (controller) {
      timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
    }
    return fetch(url, controller ? { signal: controller.signal } : undefined)
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        return data;
      }, function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  function settle(promise) {
    return promise.then(
      function (value) { return { ok: true, value: value }; },
      function (err) { return { ok: false, error: err }; }
    );
  }

  // ---- Text normalization ----
  function fold(str) {
    var s = String(str || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/&/g, ' and ')
         .replace(/['’]/g, '')
         .replace(/[^a-z0-9]+/g, ' ')
         .trim();
    return s;
  }

  var EDITION_NOISE = /\b(\d+(st|nd|rd|th)|anniversary|edition|ed|unabridged|abridged|illustrated|annotated|revised|updated|expanded|deluxe|collectors|hardcover|paperback|large print|mass market|kindle|ebook|audiobook|international|export|reprint|movie tie in|tie in|special|complete|definitive|new)\b/g;

  // Key used to decide "these two results are the same book".
  // Lowercase, no accents/punctuation, subtitle and bracketed text dropped,
  // leading article dropped, edition words dropped.
  function titleKey(title) {
    var t = String(title || '');
    t = t.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, ' ');          // (Large Print) [Illustrated]
    var cut = t.search(/\s*[:–—]\s|\s-\s/);           // subtitle after ":" or dash
    if (cut > 2) t = t.substring(0, cut);
    t = fold(t);
    t = t.replace(/^(a|an|the)\s+/, '');
    t = t.replace(EDITION_NOISE, ' ').replace(/\s+/g, ' ').trim();
    return t;
  }

  // Last name of the first author, folded.
  function authorKey(authors) {
    var first = (authors && authors[0]) || '';
    if (/unknown author/i.test(first)) return '';
    var parts = fold(first).split(' ').filter(function (p) {
      return p.length > 1 && !/^(jr|sr|phd|md|dr|ii|iii|iv)$/.test(p);
    });
    return parts.length ? parts[parts.length - 1] : '';
  }

  function matchKey(title, authors) {
    return titleKey(title) + '|' + authorKey(authors);
  }

  // ---- Junk detection ----
  var JUNK_TITLE = /\b(summary|summaries|summarized|synopsis|study guide|workbook|work book|analysis of|key (takeaways|insights|ideas)|conversation starters|cliffs?notes|sparknotes|book club kit|in \d+ minutes|quicklet|instaread|blinkist|companion (guide|workbook|book)|trivia|quiz(zes)?|box(ed)? set|bundle|\d+[- ]books? (set|series|collection|bundle|box)|books? \d+[- ]\d+|collection \d+ books?|\d+[- ]copy|counter display|display pack|resumen (de|del)|^r[eé]sum[eé]|teachers? guide|lesson plans?|readers? guide|discussion (guide|prompts|questions)|sidekick|coloring book|journal for|notebook for|cheat sheet|literature notes|a guide to reading|the essential (points|guide)|by [a-z ]+ \| ?(summary|analysis))\b/i;

  var JUNK_AUTHOR = /(shortcut edition|irb media|meilleurs resum|resum[eé]s? |summar|instaread|summareads|readtrepreneur|bookrags|milkyway media|speedy reads|worth books|blinkist|quickread|getabstract|sparknotes|cliffsnotes|hourly history|whizbooks|fastreads|book tigers|ant hive|elite summaries|smart reads|paul adams|summary station|instant[- ]?summ|knowledge lovers|dennis braun|abbey beathan|blackwell|bookzilla|savant|epicread|rapid reads|1 hour summar|book addict|chapter|bookhabits|bookflix|swift reads|speed reads|scholarly reads|brief reads|clever reads|quick reads|the book tigers|book\s*summar)/i;

  function isJunk(candidate, query) {
    var title = candidate.title + ' ' + (candidate.subtitle || '');
    var authors = (candidate.authors || []).join(' ');
    if (JUNK_AUTHOR.test(authors)) return true;
    if (JUNK_TITLE.test(title)) {
      // Only drop if the user didn't actually ask for it (e.g. "workbook")
      return !JUNK_TITLE.test(query);
    }
    return false;
  }

  // ---- Public search ----
  function search(query) {
    var q = String(query || '').trim();
    if (!q) return Promise.resolve({ items: [], stats: emptyStats() });

    var isbn = isISBN(q);
    var tasks = [
      settle(searchGoogle(q, isbn)),
      settle(searchOpenLibrary(q, isbn))
    ];

    return Promise.all(tasks).then(function (outcomes) {
      var candidates = [];
      var failed = [];
      outcomes.forEach(function (o, i) {
        var name = i === 0 ? 'google' : 'openlibrary';
        if (o.ok) {
          candidates = candidates.concat(o.value);
        } else {
          failed.push(name);
          console.warn('Book source failed (' + name + '):', o.error && o.error.message);
        }
      });

      if (failed.length === tasks.length) {
        throw new Error('All book sources failed');
      }

      var out = rankAndDedupe(candidates, q, isbn);
      out.stats.failedSources = failed;
      return out;
    });
  }

  function emptyStats() {
    return { raw: 0, junk: 0, duplicates: 0, shown: 0, failedSources: [] };
  }

  // ---- Ranking + dedupe ----
  var STOPWORDS = /^(the|a|an|of|and|or|in|on|to|for|at|by|de|la|le|el|du|les|del|von|der|das|die|un|una|y|e|is|it|its|with|from|how|why|what)$/;

  function tokens(str) {
    var all = fold(str).split(' ').filter(function (t) { return t.length > 0; });
    var meaningful = all.filter(function (t) { return !STOPWORDS.test(t); });
    return meaningful.length ? meaningful : all;
  }

  function relevance(c, q) {
    var qf = fold(q);
    var tf = fold(c.title);
    var tfull = fold(c.title + ' ' + (c.subtitle || ''));
    var af = fold((c.authors || []).join(' '));
    var qt = tokens(q);
    var hay = tfull + ' ' + af;

    var score = 0;

    // Query-to-title match
    if (titleKey(c.title) === titleKey(q)) score += 4;
    else if (tf.indexOf(qf) === 0) score += 2.5;
    else if (tfull.indexOf(qf) !== -1) score += 2;
    else if (af.indexOf(qf) !== -1) score += 2;   // typed an author name

    // Token coverage: what fraction of the words typed show up in title/author
    if (qt.length) {
      var hit = 0;
      for (var i = 0; i < qt.length; i++) {
        if (hay.indexOf(qt[i]) !== -1) hit++;
      }
      var coverage = hit / qt.length;
      score += coverage * 3;
      if (coverage === 1) score += 1;
      else if (coverage < 0.5) score -= 4;
    }

    // Source's own ordering still counts for something
    score += 1.5 / (1 + c.rank);

    // Popularity (log-scaled, capped)
    score += Math.min(3, Math.log10(1 + c.popularity) * 0.8);

    // Data quality
    if (c.coverUrl) score += 0.5;
    if (c.isbn) score += 0.2;
    if (c.language === 'en') score += 0.4;
    else if (c.language && c.language !== 'unknown') score -= 1.5;

    return score;
  }

  // Which edition inside a group becomes the card
  function editionQuality(c) {
    var s = 0;
    if (c.coverUrl) s += 3;
    if (c.language === 'en') s += 2;
    if (c.isbn && c.isbn.length === 13) s += 1;
    if (c.pageCount) s += 1;
    if (c.source === 'google') s += 0.5;   // Google covers are usually sharper
    if (c.subtitle) s += 0.2;
    return s;
  }

  function rankAndDedupe(candidates, query, isbnQuery) {
    var stats = emptyStats();
    stats.raw = candidates.length;

    // 1. Drop junk (never for ISBN lookups — the user asked for that exact book)
    var kept = [];
    for (var i = 0; i < candidates.length; i++) {
      if (!isbnQuery && isJunk(candidates[i], query)) {
        stats.junk++;
      } else {
        kept.push(candidates[i]);
      }
    }

    // 2. Score each candidate
    kept.forEach(function (c) { c.score = relevance(c, query); });

    // 3. Group editions of the same book (by match key, and by ISBN)
    var groups = [];
    var byKey = {};
    var byIsbn = {};
    kept.forEach(function (c) {
      var key = matchKey(c.title, c.authors);
      var g = byKey[key] || (c.isbn && byIsbn[c.isbn]) || null;
      if (!g) {
        g = { members: [] };
        groups.push(g);
      }
      g.members.push(c);
      byKey[key] = g;
      if (c.isbn) byIsbn[c.isbn] = g;
    });

    // 4. Collapse each group into its best edition, filling gaps from siblings
    var results = groups.map(function (g) {
      var members = g.members.slice().sort(function (a, b) {
        return editionQuality(b) - editionQuality(a);
      });
      var best = members[0];
      var maxScore = -Infinity;
      for (var j = 0; j < members.length; j++) {
        if (members[j].score > maxScore) maxScore = members[j].score;
        if (!best.coverUrl && members[j].coverUrl) best.coverUrl = members[j].coverUrl;
        if (!best.isbn && members[j].isbn) best.isbn = members[j].isbn;
        if (!best.pageCount && members[j].pageCount) best.pageCount = members[j].pageCount;
        if (!best.publishYear && members[j].publishYear) best.publishYear = members[j].publishYear;
        if (!best.description && members[j].description) best.description = members[j].description;
        else if (best.description && members[j].description && members[j].description.length > best.description.length + 200) {
          best.description = members[j].description;   // a sibling edition has a fuller blurb
        }
      }
      // Original publication year is nicer than "this edition's" year
      var years = members.map(function (m) { return m.publishYear; }).filter(Boolean);
      if (years.length) best.publishYear = Math.min.apply(null, years);

      // Well-known books show up as many editions across both sources
      best.score = maxScore + Math.min(1.2, Math.log10(members.length) * 0.8);
      best.editions = members.length;
      stats.duplicates += members.length - 1;
      return best;
    });

    // 5. Sort, cut off the long tail of weak matches, trim
    results.sort(function (a, b) { return b.score - a.score; });
    if (results.length && !isbnQuery) {
      var top = results[0].score;
      var floor = Math.max(2, top * 0.45);
      results = results.filter(function (r, idx) { return idx < 3 || r.score >= floor; });
    }
    results = results.slice(0, RESULTS_LIMIT);
    stats.shown = results.length;

    return {
      items: results.map(publicShape),
      stats: stats
    };
  }

  function publicShape(c) {
    return {
      id: c.id,
      title: c.title,
      authors: c.authors,
      isbn: c.isbn,
      coverUrl: c.coverUrl,
      publishYear: c.publishYear,
      pageCount: c.pageCount,
      description: c.description || null,
      score: c.score
    };
  }

  // ---- Google Books ----
  function searchGoogle(query, isbnQuery) {
    var q = isbnQuery ? 'isbn:' + cleanISBN(query) : query;
    var url = GOOGLE_BOOKS_URL +
      '?q=' + encodeURIComponent(q) +
      '&maxResults=' + GOOGLE_LIMIT +
      '&printType=books' +
      '&fields=' + encodeURIComponent('items(id,volumeInfo(title,subtitle,authors,publishedDate,industryIdentifiers,imageLinks,pageCount,language,ratingsCount,averageRating,description))') +
      (GOOGLE_BOOKS_KEY ? '&key=' + GOOGLE_BOOKS_KEY : '');

    return fetchJson(url).then(function (data) {
      if (!data.items) return [];
      return data.items.map(normalizeGoogle);
    });
  }

  function normalizeGoogle(item, index) {
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
        .replace('&edge=curl', '') || null;
    }

    return {
      source: 'google',
      rank: index,
      id: 'gbooks:' + item.id,
      title: info.title || 'Unknown Title',
      subtitle: info.subtitle || '',
      authors: info.authors || ['Unknown Author'],
      isbn: isbn,
      coverUrl: coverUrl,
      publishYear: info.publishedDate ? parseInt(info.publishedDate.substring(0, 4), 10) || null : null,
      pageCount: info.pageCount || null,
      language: info.language || 'unknown',
      popularity: (info.ratingsCount || 0) * 5,
      description: cleanDescription(info.description)
    };
  }

  // ---- Open Library ----
  function searchOpenLibrary(query, isbnQuery) {
    var params = isbnQuery
      ? 'isbn=' + encodeURIComponent(cleanISBN(query))
      : 'q=' + encodeURIComponent(query);

    // lang=en + the editions sub-document makes Open Library hand us the
    // English edition's title/cover (work titles are often in the original
    // language, e.g. "Siete breves lecciones de física").
    var url = OPEN_LIBRARY_URL + '?' + params +
      '&lang=en' +
      '&fields=' + encodeURIComponent('key,title,subtitle,author_name,first_publish_year,isbn,cover_i,number_of_pages_median,edition_count,ratings_count,readinglog_count,want_to_read_count,language,editions,editions.title,editions.subtitle,editions.language,editions.cover_i,editions.isbn,editions.number_of_pages') +
      '&limit=' + OL_LIMIT;

    return fetchJson(url).then(function (data) {
      if (!data.docs) return [];
      return data.docs.map(normalizeOpenLibrary);
    });
  }

  function pickIsbn(list) {
    if (!list || !list.length) return null;
    for (var i = 0; i < list.length; i++) {
      if (/^97[89]\d{10}$/.test(list[i])) return list[i];
    }
    return list[0];
  }

  function normalizeOpenLibrary(doc, index) {
    // Preferred English edition (only present when lang=en matched one)
    var ed = (doc.editions && doc.editions.docs && doc.editions.docs[0]) || null;

    var coverId = (ed && ed.cover_i) || doc.cover_i || null;
    var coverUrl = coverId
      ? 'https://covers.openlibrary.org/b/id/' + coverId + '-M.jpg'
      : null;

    var isbn = (ed && pickIsbn(ed.isbn)) || pickIsbn(doc.isbn);

    var lang = 'unknown';
    if (ed && ed.language && ed.language.length) {
      lang = ed.language.indexOf('eng') !== -1 ? 'en' : ed.language[0];
    } else if (doc.language && doc.language.length) {
      lang = doc.language.indexOf('eng') !== -1 ? 'en' : doc.language[0];
    }

    var pop = (doc.readinglog_count || 0) +
              (doc.want_to_read_count || 0) +
              (doc.ratings_count || 0) * 3 +
              (doc.edition_count || 0) * 2;

    return {
      source: 'openlibrary',
      rank: index,
      id: 'ol:' + (doc.key || '').replace('/works/', ''),
      title: (ed && ed.title) || doc.title || 'Unknown Title',
      subtitle: (ed && ed.subtitle) || doc.subtitle || '',
      authors: doc.author_name || ['Unknown Author'],
      isbn: isbn,
      coverUrl: coverUrl,
      publishYear: doc.first_publish_year || null,
      pageCount: (ed && ed.number_of_pages) || doc.number_of_pages_median || null,
      language: lang,
      popularity: pop,
      description: null   // Open Library search has no blurbs; fetched on demand via fetchDescription()
    };
  }

  // ---------------------------------------------------------------
  // Descriptions (the jacket blurb)
  //
  // Google Books search already returns one. Open Library search does
  // not, so fetchDescription() goes and gets it for a single book:
  //   ol:      -> the work's JSON
  //   gbooks:  -> the volume's JSON, else Open Library via ISBN / title
  //   manual:  -> Open Library search by title+author, else Google
  // Resolves to a string, or null when nobody has a blurb. Rejects only
  // when every source errored (network / quota) so callers can retry.
  // ---------------------------------------------------------------

  function cleanDescription(raw) {
    if (!raw) return null;
    var text = typeof raw === 'object' ? (raw.value || '') : String(raw);
    text = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/^\s*\[\d+\]:\s*\S+.*$/gm, '')        // markdown link refs: [1]: http://...
      .replace(/\(\[source\]\[\d+\]\)/gi, '')
      .replace(/\[([^\]]+)\]\[\d+\]/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^\s*-{4,}\s*$/gm, '')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    // Open Library sometimes appends "Contains: ..." / "Also contained in: ..." lists
    text = text.replace(/\n+(Also )?contain(s|ed in):[\s\S]*$/i, '').trim();
    return text.length >= 20 ? text : null;
  }

  function olWorkDescription(workId) {
    if (!workId) return Promise.resolve(null);
    return fetchJson('https://openlibrary.org/works/' + encodeURIComponent(workId) + '.json')
      .then(function (data) { return cleanDescription(data && data.description); });
  }

  function olWorkIdFromIsbn(isbn) {
    if (!isbn) return Promise.resolve(null);
    return fetch('https://openlibrary.org/isbn/' + encodeURIComponent(cleanISBN(isbn)) + '.json')
      .then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var w = data && data.works && data.works[0] && data.works[0].key;
        return w ? w.replace('/works/', '') : null;
      });
  }

  function olWorkIdFromSearch(title, authors) {
    var q = title + ' ' + ((authors && authors[0]) || '');
    var url = OPEN_LIBRARY_URL + '?q=' + encodeURIComponent(q) + '&fields=key,title,author_name&limit=5';
    var want = matchKey(title, authors);
    return fetchJson(url).then(function (data) {
      var docs = (data && data.docs) || [];
      for (var i = 0; i < docs.length; i++) {
        if (matchKey(docs[i].title, docs[i].author_name) === want) {
          return (docs[i].key || '').replace('/works/', '') || null;
        }
      }
      return null;
    });
  }

  function googleVolumeDescription(volumeId) {
    var url = GOOGLE_BOOKS_URL + '/' + encodeURIComponent(volumeId) +
      '?fields=' + encodeURIComponent('volumeInfo(description)') +
      (GOOGLE_BOOKS_KEY ? '&key=' + GOOGLE_BOOKS_KEY : '');
    return fetchJson(url).then(function (data) {
      return cleanDescription(data && data.volumeInfo && data.volumeInfo.description);
    });
  }

  function googleSearchDescription(q) {
    var url = GOOGLE_BOOKS_URL + '?q=' + encodeURIComponent(q) + '&maxResults=5' +
      '&fields=' + encodeURIComponent('items(volumeInfo(description))') +
      (GOOGLE_BOOKS_KEY ? '&key=' + GOOGLE_BOOKS_KEY : '');
    return fetchJson(url).then(function (data) {
      var items = (data && data.items) || [];
      var best = null;
      for (var i = 0; i < items.length; i++) {
        var d = cleanDescription(items[i].volumeInfo && items[i].volumeInfo.description);
        if (d && (!best || d.length > best.length)) best = d;
      }
      return best;
    });
  }

  // Try a list of promise factories in order; first non-null wins.
  // A failing step is skipped unless every step fails.
  function firstOf(steps) {
    var failures = 0;
    function next(i) {
      if (i >= steps.length) {
        if (failures === steps.length) throw new Error('All description sources failed');
        return null;
      }
      return steps[i]().then(function (val) {
        return val || next(i + 1);
      }, function (err) {
        failures++;
        console.warn('Description source failed:', err && err.message);
        return next(i + 1);
      });
    }
    return next(0);
  }

  function fetchDescription(book) {
    var id = book.id || '';
    var steps;

    if (id.indexOf('ol:') === 0) {
      steps = [
        function () { return olWorkDescription(id.substring(3)); },
        function () { return book.isbn ? googleSearchDescription('isbn:' + cleanISBN(book.isbn)) : Promise.resolve(null); }
      ];
    } else if (id.indexOf('gbooks:') === 0) {
      steps = [
        function () { return googleVolumeDescription(id.substring(7)); },
        function () { return olWorkIdFromIsbn(book.isbn).then(olWorkDescription); },
        function () { return olWorkIdFromSearch(book.title, book.authors).then(olWorkDescription); }
      ];
    } else {
      steps = [
        function () { return olWorkIdFromSearch(book.title, book.authors).then(olWorkDescription); },
        function () {
          var q = 'intitle:' + book.title + ((book.authors && book.authors[0]) ? ' inauthor:' + book.authors[0] : '');
          return googleSearchDescription(q);
        }
      ];
    }

    return firstOf(steps);
  }

  return {
    search: search,
    fetchDescription: fetchDescription,
    cleanDescription: cleanDescription,
    isISBN: isISBN,
    matchKey: matchKey,
    titleKey: titleKey,
    authorKey: authorKey
  };
})();
