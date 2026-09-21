/* Shared KB assertions.
 *
 * This file is the single source of truth for what the KB must satisfy.
 * It is evaluated INSIDE the page, so it runs identically under Playwright
 * (tests/ui-smoke.cjs) and when driven directly through a browser session.
 *
 * Usage in the page:  kbAssertions(viewportName)  ->  { failures: [], facts: {} }
 */
window.kbAssertions = function (viewportName) {
  var failures = [];
  var vp = viewportName || 'page';
  function fail(msg) { failures.push(vp + ': ' + msg); }
  function ok(cond, msg) { if (!cond) fail(msg); }

  // ---------- existing guarantees that must not regress ----------
  ok(window.FAQS.length >= 439, 'expected at least 439 merged articles, found ' + window.FAQS.length);
  ok(window.SMS_TEMPLATES.length === 89, 'expected 89 SMS templates, found ' + window.SMS_TEMPLATES.length);
  ok(window.LATEST_UPDATES.length >= 21, 'expected merged official and operational updates, found ' + window.LATEST_UPDATES.length);
  ok(window.KB_AUTHORITY_STATUS && window.KB_AUTHORITY_STATUS.loaded === true, 'authority JSON did not load');

  var kwi = window.SMS_TEMPLATES.find(function (r) { return r.cat === 'GCC plates SMS' && r.label_en === 'KWI'; });
  ok(kwi && kwi.tmpl.indexOf('KWT Plate SMS to 3009 Text: KWI 12345ABC S/P 3') >= 0,
     'Kuwait SMS does not match the final workbook');

  var visitor = window.FAQS.find(function (r) { return r.id === 'FAQ-0220'; });
  ok(visitor && /4 visitor phone numbers|maximum of <strong>4/i.test(visitor.a || ''), 'villa visitor limit is not four');
  var autoPay = window.FAQS.find(function (r) { return r.id === 'FAQ-0087'; });
  ok(autoPay && /cannot be disabled or paused/i.test(autoPay.a || ''), 'auto-payment correction missing');
  ok(window.LATEST_UPDATES.some(function (u) { return /Parkin/i.test(u.title || ''); }), 'Parkin official update missing');
  ok(window.FAQS.some(function (r) { return r.id === 'OPS-2026-0727-DARBX-TRANSITION'; }), 'July operational articles were lost');

  // ---------- timestamp parsing / formatting ----------
  // Exact timestamp renders as "22 Sep 2026, 09:30 GST" in UAE time.
  ok(kbFormatStamp('2026-09-22T09:30:00+04:00') === '22 Sep 2026, 09:30 GST',
     'exact timestamp format wrong: ' + kbFormatStamp('2026-09-22T09:30:00+04:00'));
  // Same instant expressed in UTC must still print UAE local time, not browser local.
  ok(kbFormatStamp('2026-09-22T05:30:00Z') === '22 Sep 2026, 09:30 GST',
     'UTC input not converted to Asia/Dubai: ' + kbFormatStamp('2026-09-22T05:30:00Z'));
  // A timestamp given in another zone must also land in UAE time.
  ok(kbFormatStamp('2026-09-22T00:30:00-05:00') === '22 Sep 2026, 09:30 GST',
     'non-UAE offset not converted: ' + kbFormatStamp('2026-09-22T00:30:00-05:00'));
  // Host-independent proof that formatting is pinned to Asia/Dubai rather than
  // the browser's own zone. Playwright also runs this suite under a non-UAE
  // timezoneId, but this check holds even when the host already is in the UAE.
  (function () {
    var seen = [];
    var RealDTF = Intl.DateTimeFormat;
    try {
      Intl.DateTimeFormat = function (locale, opts) {
        seen.push(opts && opts.timeZone);
        return new RealDTF(locale, opts);
      };
      Intl.DateTimeFormat.prototype = RealDTF.prototype;
      kbFormatStamp('2026-09-22T09:30:00+04:00');
    } finally {
      Intl.DateTimeFormat = RealDTF;
    }
    ok(seen.length > 0, 'kbFormatStamp did not use Intl.DateTimeFormat at all');
    ok(seen.every(function (tz) { return tz === 'Asia/Dubai'; }),
       'kbFormatStamp used a timeZone other than Asia/Dubai: ' + JSON.stringify(seen));
  })();

  // Date-only must NOT gain an invented time and must not shift across the date line.
  ok(kbFormatStamp('2026-09-22') === '22 Sep 2026', 'date-only gained a time: ' + kbFormatStamp('2026-09-22'));
  ok(kbFormatStamp('2026-01-01') === '1 Jan 2026', 'date-only shifted: ' + kbFormatStamp('2026-01-01'));
  // Legacy display dates already in the KB stay readable.
  ok(kbFormatStamp('23 Jun 2026') === '23 Jun 2026', 'legacy display date broke: ' + kbFormatStamp('23 Jun 2026'));
  // Missing / malformed optional fields must be silent, never "Invalid Date".
  ['', null, undefined, 'not a date', {}, 0].forEach(function (v) {
    ok(kbFormatStamp(v) === '', 'missing/invalid value should render empty, got: ' + kbFormatStamp(v));
  });
  ok(kbTimingMetaHtml({}) === '', 'empty record should produce no timing row');
  ok(kbTimingMetaHtml(null) === '', 'null record should produce no timing row');

  // ---------- expiry ----------
  var past = { effective_until: '2026-01-31' };
  var future = { effective_until: '2099-01-01' };
  ok(kbIsExpired(past) === true, 'past effective_until did not expire');
  ok(kbIsExpired(future) === false, 'future effective_until wrongly expired');
  ok(kbIsExpired({}) === false, 'record without effective_until must never expire');
  // A date-only end date covers the whole of that day in UAE time.
  var endOfDay = Date.parse('2026-01-31T23:59:00+04:00');
  ok(kbIsExpired(past, endOfDay) === false, 'date-only expiry ended before the day was over');
  ok(kbIsExpired(past, Date.parse('2026-02-01T00:01:00+04:00')) === true, 'date-only expiry did not end after the day');

  // ---------- sorting ----------
  var sorted = kbSortUpdates(window.LATEST_UPDATES);
  ok(sorted.length === window.LATEST_UPDATES.length, 'sorting changed the number of updates');
  for (var i = 1; i < sorted.length; i++) {
    if (kbRecordSortMs(sorted[i - 1]) < kbRecordSortMs(sorted[i])) {
      fail('updates are not sorted newest-first at index ' + i);
      break;
    }
  }
  // A record carrying only the old `date` field must still sort, not sink to the bottom.
  var legacyOnly = { date: '1 Jun 2026', title: 'legacy' };
  ok(kbRecordSortMs(legacyOnly) > kbRecordSortMs({ title: 'no dates at all' }),
     'date-only fallback did not produce a usable sort key');

  // ---------- expired updates must not appear as current instructions ----------
  var now = Date.now();
  var expiredUpdates = window.LATEST_UPDATES.filter(function (u) { return kbIsExpired(u, now); });
  var listHtml = kbUpdatesListHtml(window.LATEST_UPDATES);
  expiredUpdates.forEach(function (u) {
    var idx = listHtml.indexOf(u.title);
    if (idx < 0) return;
    var before = listHtml.slice(0, idx);
    ok(before.lastIndexOf('kb-expired-head') > before.lastIndexOf('<div class="updates-list">') ||
       listHtml.slice(0, idx).lastIndexOf('update-expired') > listHtml.slice(0, idx).lastIndexOf('update-item"'),
       'expired update "' + u.title + '" is rendered in the current list');
  });
  if (expiredUpdates.length) {
    ok(listHtml.indexOf('kb-expired-badge') >= 0, 'expired updates exist but no Expired badge was rendered');
  }

  // ---------- new canonical processes are reachable by normal search ----------
  var NEW_PROCESSES = [
    { id: 'MAW-2026-0921-PDM-SWITCHOFF', query: 'PDM machine switched off' },
    { id: 'MAW-2026-0918-PUBLIC-PLATE-PAYMENT', query: 'public plate parking payment' },
    { id: 'MAW-2026-0921-MOTORCYCLE-YELLOW-PLATE', query: 'motorcycle yellow plate' },
    { id: 'MAW-2026-0917-POD-CARD-ZAYED-ONLY', query: 'people of determination card' },
    { id: 'OPS-2026-0918-L1-DOCUMENT-CHECKLIST', query: 'mandatory documents parking permit application' },
    { id: 'MAW-2026-0827-MSCP-LONG-STAY', query: 'exceeded maximum parking duration multi storey' },
    { id: 'MAW-2026-0908-ZONING-SIGNS-SCRIPT', query: 'new zoning signs' },
    { id: 'MAW-2026-0827-FREEFLOW-ENTRY-SMS-DISABLED', query: 'free flow entry sms' },
    { id: 'MAW-2026-0807-FREEFLOW-INSPECTION-MODEL', query: 'free flow inspection' },
    { id: 'OPS-2026-0807-COMPLAINT-DIGITAL-FIRST', query: 'raise complaint digital channel' },
    { id: 'MAW-2026-0811-COMPANY-VEHICLE-GRIEVANCE-TAMM', query: 'grievance company vehicle tamm' },
    { id: 'MAW-2026-0911-COMMERCIAL-PLATE-PERMANENT-TRANSFER', query: 'commercial plate permanent transfer' },
    { id: 'OPS-2026-0901-WHATSAPP-SESSION-RULE', query: 'whatsapp customer reply template' },
    { id: 'MAW-2026-0901-E18-02-RECLASSIFICATION', query: 'E18-02 premium parking loading bay' },
    { id: 'MAW-2026-0918-W59-01-INSPECTION-RESUMED', query: 'W59-01 inspection resumed' },
    { id: 'MAW-2026-0825-EAST48-INSPECTION-RESUMED', query: 'East 48 inspection resumed' },
    { id: 'MAW-2026-0915-CAR-SHOWROOM-PARKING', query: 'car showroom parking rules' },
    { id: 'MAW-2026-0723-UNAVAILABLE-PARKING-SCRIPT', query: 'no available parking space permit' },
    { id: 'OPS-2026-0911-TOWED-STATUS-MANUAL', query: 'towed vehicle not showing in system' }
  ];
  NEW_PROCESSES.forEach(function (p) {
    var article = window.FAQS.find(function (f) { return f.id === p.id; });
    if (!article) { fail('new article missing from FAQS: ' + p.id); return; }
    if (typeof runSearch !== 'function') { fail('runSearch() is unavailable, cannot verify search reach'); return; }
    var hits = runSearch(p.query);
    var found = hits.some(function (h) { return h && h.id === p.id; });
    ok(found, 'normal search for "' + p.query + '" did not reach ' + p.id);
  });

  // ---------- no duplicate result inflation ----------
  NEW_PROCESSES.slice(0, 6).forEach(function (p) {
    var hits = (typeof runSearch === 'function') ? runSearch(p.query) : [];
    var ids = hits.map(function (h) { return h && h.id; }).filter(Boolean);
    ok(ids.length === new Set(ids).size, 'duplicate results for "' + p.query + '"');
  });
  var allIds = window.FAQS.map(function (f) { return f && f.id; }).filter(Boolean);
  ok(allIds.length === new Set(allIds).size,
     'duplicate article ids in FAQS (' + (allIds.length - new Set(allIds).size) + ' duplicates)');

  // ---------- the superseded pound hours are actually superseded ----------
  // FAQ-0169 and FAQ-TOW-001 ask the same question; the data-quality pass merges
  // them, so assert against whichever one survives into FAQS.
  var towArticles = window.FAQS.filter(function (x) {
    return x.id === 'FAQ-0169' || x.id === 'FAQ-TOW-001';
  });
  ok(towArticles.length >= 1, 'no towing-yard working-hours article is live');
  towArticles.forEach(function (f) {
    ok(/Musaffah[^<]*<\/strong><\/td><td><strong>24 hours/.test(f.a),
       f.id + ' does not show Musaffah Car Pound as 24 hours');
    // Isolate the Musaffah table row so the Al Ain row (legitimately still
    // 8:00 AM to midnight) cannot satisfy or break this check.
    var musRow = (f.a.match(/<tr>(?:(?!<\/tr>)[\s\S])*Musaffah[\s\S]*?<\/tr>/i) || [''])[0];
    ok(musRow, f.id + ' has no Musaffah row in the hours table');
    ok(/24 hours/.test(musRow), f.id + ' Musaffah row does not say 24 hours');
    ok(!/8:00 AM/.test(musRow), f.id + ' Musaffah row still shows the superseded 8:00 AM hours');
    ok(/8:00 AM to 12:00 Midnight/.test(f.a), f.id + ' lost the Al Ain pound hours, which did not change');
    ok((f.effective_from || '') === '2026-09-01', f.id + ' is missing the 1 Sep 2026 effective date');
  });

  // ---------- unapproved / conflicting material must NOT be published ----------
  var corpus = JSON.stringify(window.FAQS) + JSON.stringify(window.LATEST_UPDATES);
  [
    ['Etihad Rail Fujairah launch', /etihad rail[\s\S]{0,80}fujairah[\s\S]{0,80}(launch|open)/i],
    ['sector enforcement exemption table', /no violations at the specified/i],
    ['named internal escalation contact', /Ali Jasim Al ?Hosani/i]
  ].forEach(function (pair) {
    ok(!pair[1].test(corpus), 'unapproved material was published: ' + pair[0]);
  });
  // No customer personal data anywhere in the runtime corpus.
  [
    ['Emirates ID', /\b784\d{12}\b/],
    ['customer mobile', /\b(?:\+971|00971)\s?5\d[\s-]?\d{3}[\s-]?\d{4}\b/],
    ['fine number', /\b15(?:3|2)\d{7}\b/],
    ['grievance/appeal ref', /\b1-1\d{10,}\b/],
    ['resident permit number', /\bRP00\d{5,}\b/],
    // Public service mailboxes (customers@, careers@, admalls@ ...) are legitimate
    // KB content. A leak is a named individual's mailbox or an external consultancy.
    ['named staff mailbox', /[a-z]+[._][a-z]+@(?:qmobility|saaed)\.ae/i],
    ['external consultancy mailbox', /@kpmg\.com/i]
  ].forEach(function (pair) {
    ok(!pair[1].test(corpus), 'personal or internal data leaked into the KB: ' + pair[0]);
  });

  return {
    failures: failures,
    facts: {
      faqCount: window.FAQS.length,
      smsCount: window.SMS_TEMPLATES.length,
      updateCount: window.LATEST_UPDATES.length,
      expiredUpdates: expiredUpdates.length,
      authorityVersion: window.KB_AUTHORITY_STATUS && window.KB_AUTHORITY_STATUS.version
    }
  };
};
