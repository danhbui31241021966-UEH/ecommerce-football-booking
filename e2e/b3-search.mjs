import { chromium } from 'playwright';
const width = Number(process.argv[2] || 390);
const U = process.env.U || 'http://127.0.0.1:4121';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: width < 600 });
const check = (ok, msg) => { if (!ok) throw new Error(msg); console.log(`OK ${msg}`); };
try {
 await page.goto(`${U}/products.html`); await page.locator('#f-toggle').click(); await page.locator('#f-name').waitFor();
 const names = await page.locator('.venue-card .title').allTextContents();
 check(names.length > 0, 'venues loaded');
 const found = names[0].trim(); await page.locator('#f-name').fill(found); await page.waitForTimeout(500);
 check((await page.locator('.venue-card .title').allTextContents()).every(n => n.toLowerCase().includes(found.toLowerCase())), 'name search filters results');
 await page.locator('#f-name').fill('zz-no-such-venue-xyz'); await page.waitForTimeout(500);
 check(await page.locator('#empty').isVisible(), 'no-results feedback appears');
 await page.locator('#f-name').fill(''); await page.waitForTimeout(500);
 const district = await page.locator('#f-district option').nth(1).getAttribute('value');
 await page.locator('#f-district').selectOption(district); await page.locator('#f-sort').selectOption('asc'); await page.waitForTimeout(500);
 const prices = await page.locator('.venue-card .price').allTextContents();
 const nums = prices.map(s => Number(s.replace(/\D/g,'')));
 check(nums.every((v,i)=>!i || nums[i-1] <= v), 'ascending minimum price order');
 await page.locator('#f-sort').selectOption('desc'); await page.waitForTimeout(500);
 const rev = (await page.locator('.venue-card .price').allTextContents()).map(s=>Number(s.replace(/\D/g,'')));
 check(rev.every((v,i)=>!i || rev[i-1] >= v), 'descending minimum price order');
 await page.screenshot({path:`/tmp/b3-shots/search/${width}.png`, fullPage:true});
 check(new URL(page.url()).searchParams.get('district') === district, 'district persisted in URL');
 await page.reload(); await page.locator('#f-toggle').click();
 check(await page.locator('#f-sort').inputValue() === 'desc' && await page.locator('#f-district').inputValue() === district, 'filters survive reload');
} finally { await browser.close(); }
