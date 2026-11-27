// Mocked order-unlock checks for the fruit quiz. Synthetic ids only.
// Chrome is pinned to 127.0.0.1 for the vault, the old order host, and Mantle,
// so a missed mock cannot redeem a real order or pool code.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire('/tmp/ppt/package.json');
const puppeteer = require('puppeteer-core');

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VAULT_HOST = 'snappy-tundra-7uesdvk.tmp.now';
const ORDER_HOST = 'snappy-tundra-7uesdvk-zengpenghui420-glitch.vercel.app';
const MANTLE_HOST = 'mantledb.sh';
const ORDER = 'P847291038475610293';
const OTHER = 'P602847159303671824';
const CODE = 'FFABCD';
const PORT = 8944;
const BASE = `http://127.0.0.1:${PORT}/`;

function patternError(id) {
  if (!/^P\d{18}$/.test(id)) return 'shape';
  const d = id.slice(1);
  for (const size of [1, 2, 3, 6, 9]) {
    if (d.slice(0, size).repeat(d.length / size) === d) return 'repeat';
  }
  const step = (d.charCodeAt(1) - d.charCodeAt(0) + 10) % 10;
  if (step === 1 || step === 9) {
    let seq = true;
    for (let i = 1; i < d.length; i++) {
      if ((d.charCodeAt(i) - d.charCodeAt(i - 1) + 10) % 10 !== step) seq = false;
    }
    if (seq) return 'sequence';
  }
  return '';
}
if (patternError(ORDER) || patternError(OTHER)) throw new Error('synthetic order is not a legal id');
if (!/^FF[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(CODE)) throw new Error('synthetic code shape');

const pageHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
for (const banned of ['vercel.app', '/order/redeem', '/order/get', '/orders/', 'soft_persimmon_order_uses', '暂时验证不了', '次数已经用完', 'bound_other_quiz', 'X-Device-Id']) {
  if (pageHtml.includes(banned)) throw new Error('index.html still contains ' + banned);
}
if (!pageHtml.includes("const ORDER_USES_KEY='fruit_order_uses'")) throw new Error('missing fruit order use key');
if (!pageHtml.includes('paidVerified:false')) throw new Error('paidVerified must stay false');
if (!pageHtml.includes('>输入订单号</h3>')) throw new Error('order field label changed');
if (pageHtml.includes('local-only') || pageHtml.includes('cosmetic')) throw new Error('page describes the display count as local-only');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Content-Type,Authorization,X-Device-Id,X-Fingerprint,X-Mantle-Key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'content-type': 'application/json',
};

function freshState() {
  return {
    vaultMode: 'ok',
    vaultPosts: 0,
    bodies: [],
    urls: [],
    unexpected: [],
  };
}

async function send(req, status, obj) {
  await req.respond({ status, headers: CORS, body: JSON.stringify(obj) });
}

async function handleVault(req, u, state) {
  if (req.method() === 'OPTIONS') {
    await req.respond({ status: 204, headers: CORS, body: '' });
    return;
  }
  state.urls.push(req.method() + ' ' + u.pathname);
  if (u.pathname !== '/redeem' || req.method() !== 'POST') {
    state.unexpected.push('vault ' + req.method() + ' ' + u.pathname);
    await req.abort('failed');
    return;
  }
  const body = JSON.parse(req.postData() || '{}');
  state.bodies.push(body);
  state.vaultPosts++;
  if (body.quiz !== 'fruit' || body.code !== CODE || body.orderId) {
    state.unexpected.push('vault body ' + JSON.stringify(body));
    return send(req, 400, { ok: false, error: 'invalid' });
  }
  if (state.vaultMode === 'not_found') return send(req, 404, { ok: false, error: 'not_found' });
  if (state.vaultMode === 'exhausted') return send(req, 403, { ok: false, error: 'exhausted', remaining: 0, max: 3 });
  return send(req, 200, { ok: true, remaining: 2, max: 3 });
}

function rejectForeign(req, state, why) {
  state.unexpected.push(why);
  return req.abort('failed');
}

async function arm(page, state) {
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    try {
      const u = new URL(req.url());
      if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
        await req.continue();
        return;
      }
      if (u.hostname === VAULT_HOST) return await handleVault(req, u, state);
      if (u.hostname === ORDER_HOST) return rejectForeign(req, state, 'vercel ' + req.method() + ' ' + u.pathname);
      if (u.hostname === MANTLE_HOST) return rejectForeign(req, state, 'mantle ' + req.method() + ' ' + u.pathname);
      state.unexpected.push(u.hostname + ' ' + req.url());
      await req.abort('failed');
    } catch (e) {
      state.unexpected.push('handler ' + e.message);
      try { await req.abort('failed'); } catch (err) {}
    }
  });
}

function assert(cond, msg, state) {
  if (!cond) {
    const extra = state ? '\n' + JSON.stringify({
      vaultPosts: state.vaultPosts, bodies: state.bodies, urls: state.urls, unexpected: state.unexpected,
    }, null, 2) : '';
    throw new Error(msg + extra);
  }
}

function assertNoOrderNet(state, msg) {
  const hit = state.urls.filter((u) => u.includes('/orders/') || u.includes('/order/') || u.includes('vercel'));
  assert(hit.length === 0 && state.unexpected.length === 0, msg, state);
  assert(state.vaultPosts === 0, msg, state);
}

async function openAndSubmit(page, value) {
  await page.click('#btnStart');
  await page.waitForSelector('#codeMask.show');
  await page.$eval('#codeInput', (el, v) => { el.value = v; }, value);
  await page.click('#btnCodeOk');
}

async function waitQuiz(page) {
  await page.waitForFunction(() => document.getElementById('quiz').classList.contains('active'), { timeout: 8000 });
}

async function waitResult(page) {
  await page.waitForFunction(() => document.getElementById('result').classList.contains('active'), { timeout: 8000 });
}

async function fastFinish(page) {
  await page.evaluate(() => {
    ans = Array(QS.length).fill(3);
    qi = QS.length - 1;
    finish();
  });
  await waitResult(page);
}

async function answerOne(page) {
  const before = await page.$eval('#qno', (el) => el.textContent);
  await page.click('#opts .opt');
  await page.waitForFunction((prev) => document.getElementById('qno').textContent !== prev, { timeout: 3000 }, before);
}

async function shownUses(page, orderId = ORDER) {
  return page.evaluate((id) => shownOrderUses(id), orderId);
}

async function newPage(browser, state, opts = {}) {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.setCacheEnabled(false);
  await page.evaluateOnNewDocument(() => {
    try {
      if (sessionStorage.getItem('__test_ready')) return;
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem('__test_ready', '1');
    } catch (e) {}
  });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await arm(page, state);
  await page.goto(BASE + (opts.path || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof redeemOrder === 'function' && typeof redeemVault === 'function' && typeof shownOrderUses === 'function');
  return { page, errors };
}

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('format helpers reject patterns and keep FF codes off the order path', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const out = await page.evaluate((order, other) => {
    const counted = redeemOrder(other);
    return {
      good: orderFormatError(order),
      repeat: orderFormatError('P111111111111111111'),
      seq: orderFormatError('P123456789012345678'),
      pasted: classifyInput(' 「p8472-9103-8475-610293」 '),
      code: classifyInput(' ff ab cd '),
      junk: classifyInput('hello'),
      badCode: classifyInput('FFIIII'),
      shortP: classifyInput('P12345'),
      p19: orderFormatError('P9900000000000001378'),
      p19c: classifyInput('P9900000000000001378').type,
      copy: orderSuccessText({ ok: true, uses: 1, remaining: 2, paidVerified: false }),
      lastCopy: orderSuccessText({ ok: true, uses: 3, remaining: 0, paidVerified: false }),
      laterCopy: orderSuccessText({ ok: true, uses: 4, remaining: 0, paidVerified: false }),
      counted,
      orderUses: shownOrderUses(order),
      otherUses: shownOrderUses(other),
      quiz: QUIZ_KEY,
      key: ORDER_USES_KEY,
    };
  }, ORDER, OTHER);
  assert(out.good === '', 'legal synthetic id rejected ' + out.good);
  assert(out.repeat === 'invalid' && out.seq === 'invalid', 'pattern ids should be invalid');
  assert(out.pasted.type === 'order' && out.pasted.orderId === ORDER, 'paste normalize ' + JSON.stringify(out.pasted));
  assert(out.code.type === 'code' && out.code.code === CODE, 'spaced FF code ' + JSON.stringify(out.code));
  assert(out.junk.type === 'order-invalid' && out.badCode.type === 'code-bad' && out.shortP.type === 'order-invalid', 'classifier mixed');
  assert(out.p19 === 'invalid' && out.p19c === 'order-invalid', '19-digit id must stay invalid');
  assert(out.copy === '验证成功，还可以测 2 次', out.copy);
  assert(out.lastCopy === '验证成功，这是最后一次', out.lastCopy);
  assert(out.laterCopy === '验证成功', out.laterCopy);
  assert(out.counted.ok === true && out.counted.paidVerified === false && out.counted.uses === 1, 'display record ' + JSON.stringify(out.counted));
  assert(out.orderUses === 0 && out.otherUses === 1, 'counts are stored per order id');
  assert(out.quiz === 'fruit' && out.key === 'fruit_order_uses', 'quiz key');
  assert(await page.evaluate(() => localStorage.getItem('soft_persimmon_order_uses')) == null, 'reused the other quiz key');
  const onQuiz = await page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!onQuiz, 'calling redeemOrder from the helper must not be what starts the quiz');
  assertNoOrderNet(state, 'format checks must not hit the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('valid id starts with no order request; refresh and continue keep the display', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const heading = await page.$eval('#codeMask h3', (el) => el.textContent);
  const hint = await page.$eval('.code-hint', (el) => el.textContent);
  assert(heading === '输入订单号', heading);
  assert(hint.includes('我的订单') && hint.includes('3 次') && !hint.includes('localStorage'), hint);
  const visible = await page.evaluate(() => document.body.innerText);
  assert(!visible.includes('paidVerified') && !visible.includes('已付款') && !visible.includes('验证码'), 'start copy');
  await openAndSubmit(page, ' 「p8472-9103-8475-610293」 ');
  await waitQuiz(page);
  assert(await shownUses(page) === 1, 'first start should display one use');
  assertNoOrderNet(state, 'first start must not call the network');
  const toast = await page.$eval('#toast', (el) => el.textContent);
  assert(toast === '验证成功，还可以测 2 次', toast);
  const stored = await page.evaluate((id) => JSON.parse(localStorage.getItem(ORDER_USES_KEY) || '{}')[id], ORDER);
  assert(stored === 1, 'stored display count ' + stored);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('btnStart').textContent === '继续测试');
  assert(await shownUses(page) === 1, 'refresh must not change the display count');
  assertNoOrderNet(state, 'refresh must not call the network');
  await page.click('#btnStart');
  await waitQuiz(page);
  assert(await page.$eval('#qprog', (el) => el.textContent) === '1 / 18', 'continue did not resume');
  assert(await shownUses(page) === 1, 'continue from the first question changed the display count');
  await answerOne(page);
  await answerOne(page);
  assert(await page.$eval('#qprog', (el) => el.textContent) === '3 / 18', 'progress');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('btnStart').textContent === '继续测试');
  await page.click('#btnStart');
  await waitQuiz(page);
  const resumed = await page.evaluate(() => ({
    prog: document.getElementById('qprog').textContent,
    qi,
    a0: ans[0],
    a1: ans[1],
  }));
  assert(resumed.prog === '3 / 18' && resumed.qi === 2 && resumed.a0 === 1 && resumed.a1 === 1, 'mid refresh ' + JSON.stringify(resumed));
  assert(await shownUses(page) === 1, 'mid refresh changed the display count');
  await page.click('#qback');
  await page.waitForFunction(() => document.getElementById('start').classList.contains('active') && document.getElementById('btnStart').textContent === '继续测试');
  await page.click('#btnStart');
  await waitQuiz(page);
  const cont = await page.evaluate(() => ({
    prog: document.getElementById('qprog').textContent,
    sel: document.querySelectorAll('#opts .opt.sel').length,
    a0: ans[0],
  }));
  assert(cont.prog === '3 / 18' && cont.sel === 0 && cont.a0 === 1, 'continue left the attempt ' + JSON.stringify(cont));
  assert(await shownUses(page) === 1, 'continue changed the display count');
  assertNoOrderNet(state, 'continue must not call the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('result restore and 查看上次结果 do not advance; 重新测试 does; a later entry still starts', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, ORDER);
  await waitQuiz(page);
  await fastFinish(page);
  const firstTitle = await page.$eval('#typeTitle', (el) => el.textContent);
  await page.evaluate(() => show('start'));
  await page.waitForFunction(() => document.getElementById('btnStart').textContent === '查看本次结果');
  assert(await shownUses(page) === 1, 'leaving the result changed the display count');
  await page.click('#btnStart');
  await waitResult(page);
  assert(await page.$eval('#typeTitle', (el) => el.textContent) === firstTitle, 'result restore changed the result');
  assert(await shownUses(page) === 1, 'result restore changed the display count');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitResult(page);
  assert(await page.$eval('#typeTitle', (el) => el.textContent) === firstTitle, 'reload changed the saved result');
  assert(await shownUses(page) === 1, 'reload of the result changed the display count');
  assertNoOrderNet(state, 'result restore must not call the network');

  await page.click('#btnViewLast');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('不扣次'));
  assert(await shownUses(page) === 1, '查看上次 changed the display count');
  await page.evaluate(() => show('start'));
  await page.click('#btnLast');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('不扣次'));
  assert(await shownUses(page) === 1, '查看上次结果 changed the display count');
  assertNoOrderNet(state, 'view last must not call the network');

  await page.click('#btnRetry');
  await waitQuiz(page);
  assert(await shownUses(page) === 2, 'retest should display the second use');
  const secondToast = await page.$eval('#toast', (el) => el.textContent);
  assert(secondToast === '验证成功，还可以测 1 次', secondToast);
  const restarted = await page.evaluate(() => ({ prog: document.getElementById('qprog').textContent, len: ans.length }));
  assert(restarted.prog === '1 / 18' && restarted.len === 0, 'retest should open a new attempt ' + JSON.stringify(restarted));
  await fastFinish(page);
  await page.click('#btnRetry');
  await waitQuiz(page);
  assert(await shownUses(page) === 3, 'third displayed use');
  assert(await page.$eval('#toast', (el) => el.textContent) === '验证成功，这是最后一次', 'third toast');
  await fastFinish(page);
  await page.click('#btnRetry');
  await waitQuiz(page);
  const after = await page.evaluate((id) => ({
    quiz: document.getElementById('quiz').classList.contains('active'),
    toast: document.getElementById('toast').textContent,
    uses: shownOrderUses(id),
  }), ORDER);
  assert(after.quiz, 'a later entry must still open the quiz');
  assert(after.toast === '验证成功' && !after.toast.includes('用完') && !after.toast.includes('暂时验证不了'), after.toast);
  assert(after.uses === 4, 'later entry still records a display count');
  assertNoOrderNet(state, 'later entry must not call the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('a stored count of 3 still lets the same id in, and another id starts at 1', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await page.evaluate((key, id) => {
    localStorage.setItem(key, JSON.stringify({ [id]: 3 }));
  }, 'fruit_order_uses', ORDER);
  await openAndSubmit(page, ORDER);
  await waitQuiz(page);
  const again = await page.evaluate((id) => ({
    toast: document.getElementById('toast').textContent,
    uses: shownOrderUses(id),
  }), ORDER);
  assert(again.toast === '验证成功' && again.uses === 4, JSON.stringify(again));
  assertNoOrderNet(state, 'returning id must not call the network');
  await page.evaluate(() => { clearUnlock(); show('start'); });
  await openAndSubmit(page, OTHER);
  await waitQuiz(page);
  const split = await page.evaluate((a, b) => ({ a: shownOrderUses(a), b: shownOrderUses(b) }), ORDER, OTHER);
  assert(split.a === 4 && split.b === 1, 'per-order display ' + JSON.stringify(split));
  const otherToast = await page.$eval('#toast', (el) => el.textContent);
  assert(otherToast === '验证成功，还可以测 2 次', otherToast);
  assertNoOrderNet(state, 'second id must not call the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('19-digit, repeating, and sequence ids are rejected on the page', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const bad = ['P123456789012345678', 'P9900000000000001378', 'P111111111111111111', 'hello'];
  for (const value of bad) {
    await page.evaluate(() => { document.getElementById('toast').textContent = ''; });
    if (!(await page.$eval('#codeMask', (el) => el.classList.contains('show')))) await page.click('#btnStart');
    await page.waitForSelector('#codeMask.show');
    await page.$eval('#codeInput', (el, v) => { el.value = v; }, value);
    await page.click('#btnCodeOk');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('格式不对'));
    const onQuiz = await page.$eval('#quiz', (el) => el.classList.contains('active'));
    const unlocked = await page.evaluate(() => isUnlocked());
    assert(!onQuiz && !unlocked, value + ' started the quiz');
  }
  assert(await shownUses(page) === 0, 'rejected ids recorded a display count');
  assert(await page.evaluate(() => localStorage.getItem(ORDER_USES_KEY)) == null, 'rejected ids wrote the use map');
  assertNoOrderNet(state, 'invalid input reached the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('access codes still redeem on the vault and do not call Mantle or orders', async (browser) => {
  const hit = freshState();
  const opened = await newPage(browser, hit);
  await openAndSubmit(opened.page, ' ff ab cd ');
  await waitQuiz(opened.page);
  assert(hit.vaultPosts === 1 && hit.bodies[0].quiz === 'fruit' && hit.bodies[0].code === CODE, 'vault body', hit);
  assert(!('orderId' in hit.bodies[0]), 'legacy redeem must not send orderId', hit);
  assert(hit.unexpected.length === 0, 'vault hit touched another host', hit);
  assert(hit.urls.every((u) => u === 'POST /redeem'), 'vault url', hit);
  const toast = await opened.page.$eval('#toast', (el) => el.textContent);
  assert(toast === '验证成功，还可以测 2 次', toast);
  assert(await shownUses(opened.page) === 0, 'a vault code wrote an order display count');
  assert(opened.errors.length === 0, opened.errors.join('\n'));
  await opened.page.close();

  const miss = freshState();
  miss.vaultMode = 'not_found';
  const missed = await newPage(browser, miss);
  await openAndSubmit(missed.page, CODE);
  await missed.page.waitForFunction(() => document.getElementById('toast').textContent.includes('没有找到这个验证码'));
  const missQuiz = await missed.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!missQuiz && await missed.page.evaluate(() => !isUnlocked()), 'vault miss started the quiz');
  assert(miss.vaultPosts === 1 && miss.unexpected.length === 0, 'vault miss fell through', miss);
  await missed.page.close();

  const done = freshState();
  done.vaultMode = 'exhausted';
  const spent = await newPage(browser, done);
  await openAndSubmit(spent.page, CODE);
  await spent.page.waitForFunction(() => document.getElementById('toast').textContent.includes('已经用完'));
  const spentQuiz = await spent.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!spentQuiz && done.vaultPosts === 1 && done.unexpected.length === 0, 'exhausted vault fell through', done);
  assert(await spent.page.evaluate(() => !document.body.innerText.includes('次数已经用完')), 'order exhausted copy leaked');
  await spent.page.close();
});

test('query string still redeems an FF code and does not send an order id anywhere', async (browser) => {
  const order = freshState();
  const p1 = await newPage(browser, order, { path: '?code=' + ORDER });
  await p1.page.waitForFunction(() => document.getElementById('start').classList.contains('active'));
  assert(await shownUses(p1.page) === 0, 'query order id should not start by itself');
  assert(await p1.page.evaluate(() => !isUnlocked()), 'query order unlocked');
  assertNoOrderNet(order, 'query order must not call the network');
  await p1.page.close();

  const code = freshState();
  const p2 = await newPage(browser, code, { path: '?code=' + CODE });
  await waitQuiz(p2.page);
  assert(code.vaultPosts === 1 && code.bodies[0].code === CODE && code.unexpected.length === 0, 'query code', code);
  await p2.page.close();
});

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: ROOT,
  stdio: 'ignore',
});
await new Promise((resolve) => setTimeout(resolve, 300));

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    `--host-resolver-rules=MAP ${VAULT_HOST} 127.0.0.1, MAP ${ORDER_HOST} 127.0.0.1, MAP ${MANTLE_HOST} 127.0.0.1`,
  ],
});

let failed = 0;
try {
  for (const c of cases) {
    try {
      await c.fn(browser);
      console.log('ok  ' + c.name);
    } catch (e) {
      failed++;
      console.error('FAIL ' + c.name);
      console.error(e && e.stack || e);
    }
  }
} finally {
  await browser.close();
  server.kill();
}
if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log(cases.length + ' passed');
