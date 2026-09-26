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
  ok(window.SMS_TEMPLATES.length === 97, 'expected 89 workbook + 8 public-plate SMS templates, found ' + window.SMS_TEMPLATES.length);
  ok(window.LATEST_UPDATES.length >= 21, 'expected merged official and operational updates, found ' + window.LATEST_UPDATES.length);
  ok(window.KB_AUTHORITY_STATUS && window.KB_AUTHORITY_STATUS.loaded === true, 'authority JSON did not load');

  // Supplied Etihad MBZ v3 FAQ supersedes the old AED 30 tariff everywhere.
  var rail = window.FAQS.find(function(f){return f.id === 'OPS-2026-0727-ETIHAD-RAIL';});
  ok(rail && /AED 15/.test(rail.a) && /AED 20/.test(rail.a), 'Etihad MBZ v3 tariff missing');
  ok(rail && /25hrs<\/td><td>AED 35/.test(rail.a) && /49hrs<\/td><td>AED 55/.test(rail.a), 'multi-day examples differ from v3 source table');
  var railFaqs = window.FAQS.filter(function(f){return /^ETIHAD-MBZ-V3-/.test(f.id);});
  ok(railFaqs.length === 16, 'expected all 16 bilingual v3 FAQs, got ' + railFaqs.length);
  railFaqs.forEach(function(f){
    ok(f.a && f.a_ar && f.q_ar, 'incomplete bilingual FAQ: ' + f.id);
    ok(f.page === 'faq-priv-etihad-rail' && f.subcat === 'Etihad Rail', 'Etihad FAQ absent from category: ' + f.id);
    ok(!f.effective_from, 'source did not supply a v3 effective date: ' + f.id);
    ok(runSearch(f.q).some(function(hit){return hit.id === f.id;}), 'Etihad FAQ unreachable by search: ' + f.id);
  });
  var railWa = window.WHATSAPP_RESPONSES.find(function(f){return f.id === 'WA-305';});
  ok(railWa && /AED 15/.test(railWa.en) && /AED 20/.test(railWa.en), 'WhatsApp still has old Etihad charges');
  var railLocation = window.PRIVATE_LOCATIONS.find(function(f){return f.id === 'etihad-rail';});
  [rail.a, rail.a_ar, railWa.en, railWa.ar, railLocation.fee_short].forEach(function(text){
    ok(!/AED 30|30 درهم|خمس ساعات|up to 5 hours/i.test(text), 'superseded Etihad tariff remains in runtime content');
  });
  var plate = window.FAQS.find(function(f){return f.id === 'MAW-2026-0918-PUBLIC-PLATE-PAYMENT';});
  ['AUHPUB1','AUHPUB2','AUHORA','AUHYEL','AUHGRE','DXBBLA','DXBYEL','DXBGRE'].forEach(function(code){
    ok(plate && plate.a.includes(code) && plate.a_ar.includes(code), 'public plate code missing: ' + code);
    ok(window.SMS_TEMPLATES.some(function(row){return row.cat === 'Public plates SMS' && row.tmpl === code + ' 12345 S 1';}), 'public plate copy example missing: ' + code);
  });

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

  // ---------- every new article lands on a real page and a real subcategory ----------
  // The authority JSON is shared with the Cloudflare build, which uses kb-* page
  // ids natively. If a record is authored with this app's faq-* ids instead, it
  // stays searchable but disappears from every category page in the other build,
  // and vice versa. Guard both ends.
  var GENERIC_SUBCATS = { 'Legacy KB coverage': 1, 'Official verification': 1 };
  NEW_PROCESSES.forEach(function (p) {
    var f = window.FAQS.find(function (x) { return x.id === p.id; });
    if (!f) return;
    ok(/^faq-/.test(f.page || ''),
       p.id + ' resolved to page "' + f.page + '", which this app cannot render');
    ok(!GENERIC_SUBCATS[f.subcat],
       p.id + ' has the placeholder subcat "' + f.subcat + '", so it is hidden on subcategory hub pages');
  });

  // ---------- payment rules must stay scoped to the right environment ----------
  // On-street SmartPark (Public Lot, W4 from 28 Sep 2026) does NOT allow the
  // QR code / freeflow.qmobility.ae / 24-hour-after-exit route that facilities
  // do. Any record that offers that route to a non-Darb vehicle must say which
  // environment it is talking about, or an agent will give the wrong answer.
  var _plain = function (h) { return String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); };
  var _records = []
    .concat((window.FAQS || []).map(function (f) { return { k: 'FAQ ' + f.id, t: _plain([f.q, f.a, f.a_ar].join(' ')) }; }))
    .concat((window.WHATSAPP_RESPONSES || []).map(function (f) { return { k: 'WA ' + f.id, t: _plain([f.en, f.ar].join(' ')) }; }));

  var _unscoped = _records.filter(function (r) {
    return /(non[- ]?darb|not registered)[\s\S]{0,180}(24\s*hours|QR code|freeflow\.qmobility\.ae)/i.test(r.t)
        && !/on[- ]street|smart ?park|mall|MSCP|multi-storey|etihad|mushrif|abu dhabi mall/i.test(r.t);
  }).map(function (r) { return r.k; });
  ok(_unscoped.length === 0,
     'these records offer the 24h/QR payment route without saying where it applies: ' + _unscoped.join(', '));

  // Musaffah Car Pound moved to 24/7 on 1 Sep 2026. No record may still present
  // the old 8:00 AM-midnight hours for Musaffah as the current answer.
  var _pound = _records.filter(function (r) {
    return /Musaffah[^\n.;•]{0,40}8:00\s*AM/i.test(r.t) && !/previously|moved to 24/i.test(r.t);
  }).map(function (r) { return r.k; });
  ok(_pound.length === 0, 'Musaffah pound still shown as 8:00 AM-midnight in: ' + _pound.join(', '));

  // The on-street rules must be present and reachable.
  [['MAW-2026-0928-ONSTREET-SMARTPARK-W4', 'on street smart park W4 charges'],
   ['MAW-2026-0928-ONSTREET-NONDARB-SMS', 'non darb on-street smart park'],
   ['MAW-2026-0928-ONSTREET-PERMITS-TICKETS', 'MSCP permit valid on street'],
   ['MAW-2026-0928-ONSTREET-REENTRY-REMAINING', 'charged full hour 30 minutes re-enter'],
   ['MAW-2026-0923-NUKHBA-SCHOOL-ME09', 'school drop off fine towed ME09'],
   ['MAW-2026-0925-W2-COLLEGE-PARKING-ACTIVATED', 'W2 college parking activated']
  ].forEach(function (pair) {
    var f = window.FAQS.find(function (x) { return x.id === pair[0]; });
    ok(f, 'missing article: ' + pair[0]);
    if (f) ok(runSearch(pair[1]).some(function (h) { return h.id === pair[0]; }),
              'search "' + pair[1] + '" did not reach ' + pair[0]);
  });
  // The critical on-street facts themselves.
  var _os = window.FAQS.find(function (x) { return x.id === 'MAW-2026-0928-ONSTREET-NONDARB-SMS'; });
  ok(_os && /10 minutes of entry/i.test(_os.a), 'on-street 10-minute SMS window missing');
  ok(_os && /cannot/i.test(_os.a) && /QR/i.test(_os.a), 'on-street article does not rule out the QR route');

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

  // ---------- 26 Sep 2026 staleness sweep: fixes must not regress ----------
  var _byId = function (id) { return window.FAQS.find(function (f) { return f.id === id; }); };
  ok(/UAE Pass/.test((_byId('FAQ-0079') || {}).a || ''), 'password-reset answer does not reflect UAE Pass sign-in');
  ok(stripHtml((_byId('FAQ-0227') || {}).a || '').length > 100, 'Darb violations answer is empty');
  ok(/TAMM grievance/.test((_byId('FAQ-0303') || {}).a || ''), 'smart-vehicle objection lost its TAMM grievance guidance');
  var _all = _records.map(function (r) { return r.t; }).join(' ');
  ok(!/custoemr\.care|\[email(?:&#160;|\s)protected\]/i.test(_all + JSON.stringify(window.FAQS)), 'misspelled or scraped placeholder email is still live');
  ok(!/concerned department/i.test(JSON.stringify(window.FAQS.map(function (f) { return [f.q, f.a, f.q_ar, f.a_ar]; })).replace(/Never write or say[^.]*concerned department/gi, "")), 'a live article still tells customers "the concerned department"');
  var _moto = (window.VEHICLE_TYPES || []).find(function (v) { return v.type === 'Motorcycle'; });
  ok(_moto && /Yes/.test(_moto.sms_ok), 'vehicle-type table still says motorcycles cannot pay by SMS');
  ok(!/Musaffah Car Pound"?, cat:"Tow Yard", note:"8AM/.test(JSON.stringify(window.MAP_POINTS || '')), 'map still shows old Musaffah pound hours');

  // ---------- publish gate: structure ----------
  // Every article lands in exactly one defined sector / category / subtype,
  // and the sector accordion shows every article the sector count promises.
  var _tree = kbTree();
  var _classified = 0;
  ['maw', 'darb', 'priv'].forEach(function (s) {
    Object.keys(_tree[s]).forEach(function (g) {
      ok(KB_TAXONOMY[s].groups[g], 'article classified into undefined group ' + s + '/' + g);
      _classified += kbCount(_tree[s][g]);
    });
    var acc = document.createElement('div');
    acc.innerHTML = kbSectorAccordionHtml(s);
    var items = acc.querySelectorAll('.kb-acc-item').length;
    var inSector = window.FAQS.filter(function (f) { return f && kbClassify(f).sector === s; }).length;
    ok(items === inSector, s + ' accordion shows ' + items + ' of ' + inSector + ' articles');
  });
  ok(_classified === window.FAQS.filter(Boolean).length, 'taxonomy classified ' + _classified + ' of ' + window.FAQS.length + ' articles');

  // One canonical article per question.
  var _sigs = {};
  window.FAQS.forEach(function (f) {
    var s = _kbSig(f.q);
    if (_sigs[s]) fail('two live articles ask the same question: ' + _sigs[s] + ' and ' + f.id);
    else _sigs[s] = f.id;
  });

  // Superseded records are gone, and nothing still points at a missing article.
  var _ids = {};
  window.FAQS.forEach(function (f) { _ids[f.id] = 1; });
  window.FAQS.forEach(function (f) {
    ok(f.status !== 'superseded', 'superseded article is still live: ' + f.id);
    (String(f.a || '') + String(f.a_ar || '')).replace(/openFaqById\(\\?['"]([^'"\\]+)/g, function (m, id) {
      ok(_ids[id] || (window.KB_REDIRECTS && KB_REDIRECTS[id]), f.id + ' links to missing article ' + id);
      return m;
    });
  });
  window.LATEST_UPDATES.forEach(function (u) {
    if (u.related) ok(_ids[u.related], 'update "' + (u.title || '') + '" links to missing article ' + u.related);
  });

  // No temporary instruction may outlive its end date as a live article.
  window.FAQS.forEach(function (f) {
    ok(kbArticleStatus(f).key !== 'expired', 'expired temporary article is still live: ' + f.id);
  });

  // Arabic fields must actually be Arabic.
  window.FAQS.forEach(function (f) {
    ['q_ar', 'a_ar'].forEach(function (k) {
      if (f[k]) ok(/[\u0600-\u06FF]/.test(stripHtml(f[k])), f.id + ' has non-Arabic text in ' + k);
    });
  });
  var newWithoutArabic = window.FAQS.filter(function (f) {
    return kbFreshness(f) === 'new' && (!f.q_ar || !f.a_ar);
  }).map(function (f) { return f.id; });

  // ---------- publish gate: search and updates behaviour ----------
  var _box = document.createElement('div');
  // Keep the test's own search out of the search analytics.
  var _track = ANALYTICS.trackSearch;
  var _prevQuery = _lastSearchQuery, _prevResults = _lastSearchResults;
  ANALYTICS.trackSearch = function () {};
  try { renderSearch(_box, 'residential permit lease'); }
  finally { ANALYTICS.trackSearch = _track; _lastSearchQuery = _prevQuery; _lastSearchResults = _prevResults; }
  ok(_box.querySelectorAll('.kb-best').length === 1, 'search does not lead with one best answer');
  var _tops = _box.querySelectorAll('.faq-card-top');
  ok(_tops.length > 1 && _tops[0].getAttribute('aria-expanded') === 'true', 'best answer is not open');
  ok([].slice.call(_tops, 1).every(function (t) { return t.getAttribute('aria-expanded') === 'false'; }),
     'secondary search results are not collapsed');
  ok(!/>\s*Verified \(\d+\)/.test(_box.innerHTML), 'search tabs still group by the raw "Verified" label');
  ok(_box.querySelector('.kb-path-tag'), 'search results do not show where the answer lives');

  // Unread counter: marking every recent update seen clears it, and the
  // viewer's real read state is restored afterwards.
  var _savedSeen = null;
  try { _savedSeen = localStorage.getItem(KB_SEEN_KEY); } catch (e) {}
  try {
    try { localStorage.removeItem(KB_SEEN_KEY); } catch (e) {}
    var _recent = kbRecentUpdates();
    ok(kbUnreadUpdates().length === _recent.length, 'unread count differs from recent updates when nothing is read');
    kbMarkSeen(_recent.map(kbUpdateKey));
    ok(kbUnreadUpdates().length === 0, 'marking all updates read did not clear the counter');
  } finally {
    try {
      if (_savedSeen === null) localStorage.removeItem(KB_SEEN_KEY);
      else localStorage.setItem(KB_SEEN_KEY, _savedSeen);
    } catch (e) {}
    kbPaintUnread();
  }

  // The updates page files every update exactly once.
  var _up = document.createElement('div');
  var _updUi = JSON.stringify(S.updUi); S.updUi = {q: '', svc: 'all', status: 'all', unread: false, view: 'compact'};
  renderUpdates(_up);
  S.updUi = JSON.parse(_updUi);
  // Current updates use the new card; expired ones keep the struck-through
  // "Expired" card so they can never read as live instructions.
  var _upTitles = _up.querySelectorAll('.kb-upd, .update-item.update-expired, .kb-upd-line').length;
  ok(_upTitles === window.LATEST_UPDATES.length,
     'updates page shows ' + _upTitles + ' of ' + window.LATEST_UPDATES.length + ' updates');

  return {
    failures: failures,
    warnings: newWithoutArabic.length ? ['new articles without an approved Arabic version: ' + newWithoutArabic.join(', ')] : [],
    facts: {
      newWithoutArabic: newWithoutArabic.length,
      faqCount: window.FAQS.length,
      smsCount: window.SMS_TEMPLATES.length,
      updateCount: window.LATEST_UPDATES.length,
      expiredUpdates: expiredUpdates.length,
      authorityVersion: window.KB_AUTHORITY_STATUS && window.KB_AUTHORITY_STATUS.version
    }
  };
};
