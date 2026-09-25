const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const baseUrl = process.env.KB_URL || 'http://127.0.0.1:8090/';
const outputDir = path.resolve(__dirname, '..', 'test-output');
const assertionsPath = path.resolve(__dirname, 'kb-assertions.js');
fs.mkdirSync(outputDir, { recursive: true });

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'small-mobile', width: 320, height: 568 },
];

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const report = [];

  for (const viewport of viewports) {
    // A non-UAE browser timezone proves every displayed time really is
    // rendered through Intl with timeZone Asia/Dubai, not the local zone.
    const page = await browser.newPage({ viewport, ignoreHTTPSErrors: true, timezoneId: 'America/New_York' });
    const errors = [];
    const badResponses = [];
    const authorityRequests = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('response', response => {
      if (response.url().includes('qmobility_kb_latest.json')) authorityRequests.push(response.url());
      if (response.status() >= 400 && !response.url().includes('favicon')) {
        badResponses.push(`${response.status()} ${response.url()}`);
      }
    });

    const started = Date.now();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.agent-hero');
    const shellReadyMs = Date.now() - started;
    await page.waitForFunction(() => window.KB_AUTHORITY_STATUS?.loaded === true);
    const authorityReadyMs = Date.now() - started;

    // The shared assertion suite is the single source of truth.
    await page.addScriptTag({ path: assertionsPath });
    const result = await page.evaluate(name => window.kbAssertions(name), viewport.name);
    failures.push(...result.failures);

    const initial = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      boxes: (() => {
        const visible = element => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        return [...document.querySelectorAll('#topbar > button, #topbar > .search-box')]
          .filter(visible)
          .map((element, index) => {
            const rect = element.getBoundingClientRect();
            return { id: element.id || `${element.className}-${index}`, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          });
      })(),
    }));

    const overlaps = [];
    for (let i = 0; i < initial.boxes.length; i += 1) {
      for (let j = i + 1; j < initial.boxes.length; j += 1) {
        if (intersects(initial.boxes[i], initial.boxes[j])) overlaps.push(`${initial.boxes[i].id}/${initial.boxes[j].id}`);
      }
    }
    if (initial.overflowX > 1) failures.push(`${viewport.name}: dashboard horizontal overflow ${initial.overflowX}px`);
    if (overlaps.length) failures.push(`${viewport.name}: topbar overlap ${overlaps.join(', ')}`);
    if (authorityRequests.length !== 1) failures.push(`${viewport.name}: expected one authority JSON request, found ${authorityRequests.length}`);

    // Dashboard update cards must carry readable UAE timing metadata.
    const dashTiming = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.updates-list .update-item')];
      const timing = [...document.querySelectorAll('.updates-list .kb-timing')];
      return {
        cards: rows.length,
        withTiming: timing.length,
        sample: timing.length ? timing[0].textContent.replace(/\s+/g, ' ').trim() : '',
        gstShown: timing.some(node => /GST/.test(node.textContent)),
      };
    });
    if (!dashTiming.cards) failures.push(`${viewport.name}: dashboard rendered no update cards`);
    if (!dashTiming.withTiming) failures.push(`${viewport.name}: update cards carry no timing metadata`);
    if (!dashTiming.gstShown) failures.push(`${viewport.name}: no update card shows a GST timestamp`);

    // Latest Updates page must exist, sort, and separate expired items.
    await page.evaluate(() => go('updates', 'Latest Updates'));
    await page.waitForSelector('.updates-list');
    const updatesPage = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      cards: document.querySelectorAll('.update-item').length,
      expiredBadges: document.querySelectorAll('.kb-expired-badge').length,
      expiredInCurrent: [...document.querySelectorAll('.updates-list')][0]
        ? [...[...document.querySelectorAll('.updates-list')][0].querySelectorAll('.update-expired')].length
        : 0,
      notFound: /Page not found/i.test(document.getElementById('content').textContent),
    }));
    if (updatesPage.notFound) failures.push(`${viewport.name}: Latest Updates page is missing a renderer`);
    if (!updatesPage.cards) failures.push(`${viewport.name}: Latest Updates page rendered no cards`);
    if (updatesPage.expiredInCurrent > 0) failures.push(`${viewport.name}: ${updatesPage.expiredInCurrent} expired update(s) rendered in the current list`);
    if (updatesPage.overflowX > 1) failures.push(`${viewport.name}: Latest Updates horizontal overflow ${updatesPage.overflowX}px`);

    // Normal search must still reach the previously corrected answer.
    await page.evaluate(() => go('dashboard', 'Home'));
    await page.locator('#searchInput').fill('auto payment disabled');
    await page.evaluate(() => doSearch());
    await page.waitForSelector('#search-results .faq-card');
    const searchText = await page.locator('#search-results').textContent();
    if (!/cannot be disabled or paused/i.test(searchText)) failures.push(`${viewport.name}: normal search missed corrected auto-payment answer`);

    // A new canonical process must be reachable and expose its timing metadata.
    await page.locator('#searchInput').fill('PDM machine switched off');
    await page.evaluate(() => doSearch());
    await page.waitForSelector('#search-results .faq-card');
    const pdmResult = await page.evaluate(() => {
      const text = document.getElementById('search-results').textContent;
      return {
        hasAnswer: /discontinued as we are moving to digital channels/i.test(text),
        hasStamp: /Reviewed:|Updated:/.test(text),
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    if (!pdmResult.hasAnswer) failures.push(`${viewport.name}: search did not surface the approved PDM switch-off script`);
    if (!pdmResult.hasStamp) failures.push(`${viewport.name}: search results do not expose a verified/updated date`);
    if (pdmResult.overflowX > 1) failures.push(`${viewport.name}: search results horizontal overflow ${pdmResult.overflowX}px`);

    await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
    if (await page.locator('#search-results .faq-card-top[aria-expanded="true"]').count()) failures.push(`${viewport.name}: collapse all failed`);
    const firstAnswer = page.locator('#search-results .faq-card-top').first();
    await firstAnswer.focus();
    await page.keyboard.press('Enter');
    if (await firstAnswer.getAttribute('aria-expanded') !== 'true') failures.push(`${viewport.name}: keyboard accordion failed`);
    await page.getByRole('button', { name: 'Expand all', exact: true }).click();
    if (await page.locator('#search-results .faq-card-top[aria-expanded="false"]').count()) failures.push(`${viewport.name}: expand all failed`);

    await page.locator('#searchInput').fill('Etihad Rail MBZ');
    await page.waitForSelector('#searchDropdown .sd-item', { state: 'visible' });
    const dropdownVisible = await page.locator('#searchDropdown .sd-item').first().evaluate(node => {
      const r = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(r.x + 12, r.y + Math.min(20, r.height / 2)));
    });
    if (!dropdownVisible) failures.push(`${viewport.name}: search dropdown clipped or covered`);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { go('faq-priv-etihad-rail', 'Etihad Rail MBZ'); });
    const railPage = await page.locator('#content').textContent();
    if (!railPage.includes('AED 35') || !railPage.includes('AED 55')) failures.push(`${viewport.name}: category is missing v3 multi-day table`);
    await page.locator('#langBtn').click();
    const arabicRail = await page.locator('#content').textContent();
    if (!arabicRail.includes('20') || !arabicRail.includes('قطارات الاتحاد')) failures.push(`${viewport.name}: Arabic Etihad article missing`);
    await page.locator('#langBtn').click();

    if (viewport.name === 'desktop' || viewport.name === 'mobile') {
      await page.evaluate(() => quickFind('PDM machine switched off'));
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}-search.png`), fullPage: true, animations: 'disabled' });
    }

    // Find Fast must still reach the tree and the new subject areas.
    await page.evaluate(() => go('find-fast', 'Find Fast'));
    await page.waitForSelector('#fftWrap');
    const findFast = await page.evaluate(() => ({
      columns: document.querySelectorAll('#fftWrap .fft-col').length,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
    }));
    if (findFast.columns !== 4) failures.push(`${viewport.name}: Find Fast has ${findFast.columns} columns`);
    if (findFast.overflowX > 1) failures.push(`${viewport.name}: Find Fast horizontal overflow ${findFast.overflowX}px`);

    if (viewport.name === 'desktop' || viewport.name === 'mobile') {
      await page.evaluate(() => go('updates', 'Latest Updates'));
      await page.waitForSelector('.updates-list');
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}-updates.png`), fullPage: true, animations: 'disabled' });
      await page.evaluate(() => go('dashboard', 'Home'));
      await page.waitForSelector('.agent-hero');
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`), fullPage: true, animations: 'disabled' });
    }

    errors.forEach(error => failures.push(`${viewport.name}: ${error}`));
    badResponses.forEach(error => failures.push(`${viewport.name}: ${error}`));
    report.push({
      viewport: viewport.name,
      shellReadyMs,
      authorityReadyMs,
      ...result.facts,
      overflowX: initial.overflowX,
      topbarOverlaps: overlaps,
      updateCards: dashTiming.cards,
      timingRows: dashTiming.withTiming,
      timingSample: dashTiming.sample,
      updatesPageCards: updatesPage.cards,
      expiredBadges: updatesPage.expiredBadges,
      findFastColumns: findFast.columns,
      errors,
      badResponses,
    });
    await page.close();
  }

  await browser.close();
  console.log(JSON.stringify({ report, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
