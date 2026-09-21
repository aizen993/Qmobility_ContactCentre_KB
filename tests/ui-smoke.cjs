const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const baseUrl = process.env.KB_URL || 'http://127.0.0.1:8090/';
const outputDir = path.resolve(__dirname, '..', 'test-output');
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
    const page = await browser.newPage({ viewport, ignoreHTTPSErrors: true });
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

    const initial = await page.evaluate(() => {
      const visible = element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const boxes = [...document.querySelectorAll('#topbar > button, #topbar > .search-box')]
        .filter(visible)
        .map((element, index) => {
          const rect = element.getBoundingClientRect();
          return { id: element.id || `${element.className}-${index}`, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        });
      const kwi = window.SMS_TEMPLATES.find(row => row.cat === 'GCC plates SMS' && row.label_en === 'KWI');
      const visitor = window.FAQS.find(row => row.id === 'FAQ-0220');
      const autoPayment = window.FAQS.find(row => row.id === 'FAQ-0087');
      return {
        faqCount: window.FAQS.length,
        smsCount: window.SMS_TEMPLATES.length,
        updateCount: window.LATEST_UPDATES.length,
        authority: window.KB_AUTHORITY_STATUS,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        boxes,
        kwiTemplate: kwi?.tmpl || '',
        visitorAnswer: visitor?.a || '',
        autoPaymentAnswer: autoPayment?.a || '',
        hasParkinUpdate: window.LATEST_UPDATES.some(update => /Parkin/i.test(update.title)),
        hasJulyOperations: window.FAQS.some(row => row.id === 'OPS-2026-0727-DARBX-TRANSITION'),
      };
    });

    const overlaps = [];
    for (let i = 0; i < initial.boxes.length; i += 1) {
      for (let j = i + 1; j < initial.boxes.length; j += 1) {
        if (intersects(initial.boxes[i], initial.boxes[j])) overlaps.push(`${initial.boxes[i].id}/${initial.boxes[j].id}`);
      }
    }

    if (initial.faqCount < 439) failures.push(`${viewport.name}: expected at least 439 merged articles, found ${initial.faqCount}`);
    if (initial.smsCount !== 89) failures.push(`${viewport.name}: expected 89 SMS templates, found ${initial.smsCount}`);
    if (initial.updateCount < 21) failures.push(`${viewport.name}: expected merged official and operational updates`);
    if (initial.overflowX > 1) failures.push(`${viewport.name}: dashboard horizontal overflow ${initial.overflowX}px`);
    if (overlaps.length) failures.push(`${viewport.name}: topbar overlap ${overlaps.join(', ')}`);
    if (authorityRequests.length !== 1) failures.push(`${viewport.name}: expected one authority JSON request, found ${authorityRequests.length}`);
    if (!initial.kwiTemplate.includes('KWT Plate SMS to 3009 Text: KWI 12345ABC S/P 3')) failures.push(`${viewport.name}: Kuwait SMS does not match final workbook`);
    if (!/4 visitor phone numbers|maximum of <strong>4/i.test(initial.visitorAnswer)) failures.push(`${viewport.name}: villa visitor limit is not four`);
    if (!/cannot be disabled or paused/i.test(initial.autoPaymentAnswer)) failures.push(`${viewport.name}: auto-payment correction missing`);
    if (!initial.hasParkinUpdate) failures.push(`${viewport.name}: Parkin official update missing`);
    if (!initial.hasJulyOperations) failures.push(`${viewport.name}: July operational articles were lost`);

    await page.locator('#searchInput').fill('auto payment disabled');
    await page.evaluate(() => doSearch());
    await page.waitForSelector('#search-results .faq-card');
    const searchText = await page.locator('#search-results').textContent();
    if (!/cannot be disabled or paused/i.test(searchText)) failures.push(`${viewport.name}: normal search missed corrected auto-payment answer`);

    await page.evaluate(() => go('find-fast', 'Find Fast'));
    await page.waitForSelector('#fftWrap');
    const findFast = await page.evaluate(() => ({
      columns: document.querySelectorAll('#fftWrap .fft-col').length,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
    }));
    if (findFast.columns !== 4) failures.push(`${viewport.name}: Find Fast has ${findFast.columns} columns`);
    if (findFast.overflowX > 1) failures.push(`${viewport.name}: Find Fast horizontal overflow ${findFast.overflowX}px`);

    if (viewport.name === 'desktop' || viewport.name === 'mobile') {
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`), fullPage: true });
    }

    errors.forEach(error => failures.push(`${viewport.name}: ${error}`));
    badResponses.forEach(error => failures.push(`${viewport.name}: ${error}`));
    report.push({
      viewport: viewport.name,
      shellReadyMs,
      authorityReadyMs,
      faqCount: initial.faqCount,
      smsCount: initial.smsCount,
      updates: initial.updateCount,
      overflowX: initial.overflowX,
      topbarOverlaps: overlaps,
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
