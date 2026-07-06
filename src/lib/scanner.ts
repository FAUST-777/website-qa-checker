import puppeteer, { Browser, Page } from 'puppeteer-core';
import fs from 'fs';

export type Emit = (event: Record<string, unknown>) => void;

export interface Finding {
  severity: 'error' | 'warning';
  category: string;
  message: string;
  detail?: string;
  pageUrl: string;
}

export interface Report {
  url: string;
  scannedAt: string;
  durationMs: number;
  pagesScanned: string[];
  findings: Finding[];
  screenshots: { label: string; data: string }[];
  stats: { linksChecked: number; buttonsTested: number; errors: number; warnings: number };
  partial: boolean;
}

const BUDGET_MS = 235_000;
const MAX_SUBPAGES = 6;
const MAX_LINKS_CHECKED = 40;
const MAX_CLICK_TESTS = 25;

const ANALYTICS_HOSTS = /google-analytics|googletagmanager|facebook\.|fbcdn|doubleclick|clarity\.ms|hotjar|cloudflareinsights/i;
const SKIP_HREF = /^(mailto:|tel:|sms:|javascript:|#|$)/i;
// 平台/框架產生的無害 console 訊息，過濾掉避免報告塞滿雜訊
const IGNORE_CONSOLE = /report-only|Permissions policy|permissions policy|X-Frame-Options|third-party cookie|was preloaded|deprecated|slow network is detected|Minified React error #(405|418|423|425)/i;
// 一律阻擋機器人的外送/訂位平台，403 屬正常現象
const BOT_BLOCKING_PLATFORMS = /ubereats\.com|foodpanda\.|inline\.app|opentable\./i;

// ---------- browser ----------

function findLocalChromium(): string | null {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ];
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

async function launchBrowser(): Promise<Browser> {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION) {
    const chromium = (await import('@sparticuz/chromium')).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
      defaultViewport: { width: 1366, height: 900 },
    });
  }
  const local = findLocalChromium();
  if (!local) throw new Error('找不到本機 Chrome/Edge，無法啟動瀏覽器');
  return puppeteer.launch({
    executablePath: local,
    headless: true,
    defaultViewport: { width: 1366, height: 900 },
  });
}

// ---------- helpers ----------

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchStatus(url: string): Promise<{ status: number; finalUrl: string; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36' },
    });
    return { status: res.status, finalUrl: res.url };
  } catch (e: any) {
    return { status: 0, finalUrl: url, error: e?.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

interface PageLink { href: string; text: string; }

// ---------- LINE link rules ----------

async function checkLineLinks(links: PageLink[], findings: Finding[], pageUrl: string, emit: Emit) {
  const seen = new Set<string>();
  for (const { href, text } of links) {
    const h = href.toLowerCase();
    if (!/line\.me|lin\.ee|line:\/\/|liff\.line/.test(h)) continue;
    if (seen.has(h)) continue;
    seen.add(h);
    const label = text || href;

    if (/line\.me\/([a-z-]+\/)?download/.test(h)) {
      findings.push({
        severity: 'error', category: 'LINE連結', pageUrl,
        message: `「${label}」連到的是 LINE APP「下載頁」，不是加好友頁`,
        detail: `目前連結：${href}\n正確格式應為 https://lin.ee/xxxx 或 https://line.me/R/ti/p/@官方帳號ID（電腦點開會顯示 QR Code）`,
      });
    } else if (h.startsWith('line://')) {
      findings.push({
        severity: 'error', category: 'LINE連結', pageUrl,
        message: `「${label}」使用 line:// 深層連結，電腦版瀏覽器點了會沒反應`,
        detail: `目前連結：${href}\n建議改用 https://lin.ee/xxxx，電腦會自動顯示 QR Code、手機會開啟 LINE APP`,
      });
    } else if (/(apps\.apple\.com|itunes\.apple\.com|play\.google\.com)/.test(h) && /line/.test(h)) {
      findings.push({
        severity: 'error', category: 'LINE連結', pageUrl,
        message: `「${label}」連到的是 APP 商店的 LINE 下載頁，不是加好友頁`,
        detail: `目前連結：${href}\n正確格式應為 https://lin.ee/xxxx 或 https://line.me/R/ti/p/@官方帳號ID`,
      });
    } else if (/lin\.ee\/|line\.me\/r\/ti\/p\/|line\.me\/ti\/p\//.test(h)) {
      emit({ type: 'progress', message: `驗證 LINE 加好友連結：${href}` });
      const r = await fetchStatus(href);
      if (r.status >= 400 || r.status === 0) {
        findings.push({
          severity: 'error', category: 'LINE連結', pageUrl,
          message: `「${label}」的 LINE 加好友連結無法開啟（HTTP ${r.status || '連線失敗'}）`,
          detail: `連結：${href}${r.error ? '\n錯誤：' + r.error : ''}`,
        });
      } else if (/\/download/.test(r.finalUrl.toLowerCase())) {
        findings.push({
          severity: 'error', category: 'LINE連結', pageUrl,
          message: `「${label}」的 LINE 連結最後跳轉到下載頁，加好友 ID 可能失效`,
          detail: `連結：${href}\n最終跳轉：${r.finalUrl}`,
        });
      }
    } else {
      findings.push({
        severity: 'warning', category: 'LINE連結', pageUrl,
        message: `「${label}」是非常見格式的 LINE 連結，請人工確認行為`,
        detail: `連結：${href}`,
      });
    }
  }
}

// ---------- link HTTP check ----------

async function checkLinks(
  links: PageLink[], findings: Finding[], pageUrl: string,
  visited: Set<string>, emit: Emit, stats: { linksChecked: number },
) {
  const targets: PageLink[] = [];
  for (const l of links) {
    if (SKIP_HREF.test(l.href)) continue;
    if (!/^https?:\/\//i.test(l.href)) continue;
    if (/line\.me|lin\.ee/i.test(l.href)) continue; // handled by LINE checker
    const key = l.href.split('#')[0];
    if (visited.has(key)) continue;
    visited.add(key);
    targets.push(l);
    if (targets.length >= MAX_LINKS_CHECKED) break;
  }
  if (!targets.length) return;
  emit({ type: 'progress', message: `檢查 ${targets.length} 個連結是否失效…` });

  const queue = [...targets];
  const workers = Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const l = queue.shift();
      if (!l) break;
      const r = await fetchStatus(l.href);
      stats.linksChecked++;
      const label = l.text || l.href;
      if (r.status === 404 || r.status === 410 || r.status >= 500) {
        findings.push({
          severity: 'error', category: '失效連結', pageUrl,
          message: `「${label}」連結失效（HTTP ${r.status}）`,
          detail: `連結：${l.href}`,
        });
      } else if (r.status === 0) {
        findings.push({
          severity: 'error', category: '失效連結', pageUrl,
          message: `「${label}」連結無法連線`,
          detail: `連結：${l.href}\n錯誤：${r.error}`,
        });
      } else if (r.status === 401 || r.status === 403 || r.status === 999) {
        // 已知一律阻擋機器人的外送/訂位平台，403 是正常現象，不列入報告以免業務誤會連結壞掉
        if (BOT_BLOCKING_PLATFORMS.test(l.href)) continue;
        findings.push({
          severity: 'warning', category: '失效連結', pageUrl,
          message: `「${label}」回應 HTTP ${r.status}（可能是對方網站阻擋機器人），請人工點一次確認`,
          detail: `連結：${l.href}`,
        });
      }
    }
  });
  await Promise.all(workers);
}

// ---------- dead button click test ----------

async function clickTest(
  page: Page, findings: Finding[], pageUrl: string, emit: Emit,
  stats: { buttonsTested: number },
) {
  // Tag clickables with stable indices so we can re-find them after a navigation.
  const candidates: { idx: number; text: string; bareImgLink: boolean }[] = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('button, [role="button"], a'));
    const out: { idx: number; text: string; bareImgLink: boolean }[] = [];
    els.forEach((el, i) => {
      el.setAttribute('data-qaidx', String(i));
      const tag = el.tagName.toLowerCase();
      const href = (el.getAttribute('href') || '').trim().toLowerCase();
      const visible = !!((el as HTMLElement).offsetWidth || (el as HTMLElement).offsetHeight);
      const disabled = (el as HTMLButtonElement).disabled === true;
      const inForm = !!el.closest('form');
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (!visible || disabled) return;
      // 有尺寸但實際上看不到/點不到的元素（例如 Framer 輪播在第一張時的 Previous 箭頭
      // 是 opacity:0 + pointer-events:none），對使用者不存在，不測
      const cs = getComputedStyle(el);
      if (parseFloat(cs.opacity) < 0.05 || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return;
      // 輪播/滑動元件的前後箭頭在邊界時本來就沒反應，屬正常行為，不測
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const nearbyCls = ((typeof el.className === 'string' ? el.className : '') + ' ' +
        (el.parentElement && typeof el.parentElement.className === 'string' ? el.parentElement.className : '')).toLowerCase();
      if (/^(previous|next|prev)$/.test(ariaLabel) || /carousel|slider|swiper|slick|splide|glide|flickity|wslide-arrow/.test(nearbyCls)) return;
      if (inForm || type === 'submit') return; // 避免真的送出表單
      if (tag === 'a' && href && !['#', 'javascript:void(0)', 'javascript:;', 'javascript:void(0);'].includes(href)) return;
      let text = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40);
      // 無文字時，用內部圖片或 class 描述這顆按鈕，報告才看得懂是哪一顆
      const img = el.querySelector('img');
      let bareImgLink = false;
      if (!text) {
        if (img) {
          const src = img.getAttribute('src') || '';
          const file = src.split('/').pop()?.split('?')[0] || '';
          text = `圖片：${img.getAttribute('alt') && img.getAttribute('alt') !== 'Picture' ? img.getAttribute('alt') : file}`.slice(0, 60);
          // <a> 沒有 href、裡面只有圖片：Weebly 等平台常見的「圖片連結框沒設連結」
          bareImgLink = tag === 'a' && !href && el.children.length >= 1;
        } else if (el.className && typeof el.className === 'string') {
          text = `元素 class="${el.className.slice(0, 40)}"`;
        }
      }
      out.push({ idx: i, text, bareImgLink });
    });
    return out;
  });

  const toTest = candidates.slice(0, MAX_CLICK_TESTS);
  if (!toTest.length) return;
  emit({ type: 'progress', message: `測試 ${toTest.length} 個按鈕是否有反應…` });

  let dialogSeen = false;
  let popupSeen = false;
  let netCount = 0;
  const onDialog = async (d: any) => { dialogSeen = true; try { await d.dismiss(); } catch {} };
  const onRequest = (req: any) => {
    const u = req.url();
    if (!ANALYTICS_HOSTS.test(u) && !u.startsWith('data:')) netCount++;
  };
  const onTarget = () => { popupSeen = true; };
  page.on('dialog', onDialog);
  const browser = page.browser();
  browser.on('targetcreated', onTarget);

  for (const c of toTest) {
    const before = page.url();
    dialogSeen = false; popupSeen = false;
    try {
      const handle = await page.$(`[data-qaidx="${c.idx}"]`);
      if (!handle) continue;
      await page.evaluate(() => {
        (window as any).__qaMut = 0;
        const mo = new MutationObserver((m) => { (window as any).__qaMut += m.length; });
        mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
        (window as any).__qaMo = mo;
      });
      page.on('request', onRequest);
      netCount = 0;
      await handle.click({ delay: 20 });
      await sleep(1200);
      page.off('request', onRequest);
      stats.buttonsTested++;

      // 只有 hash 變化（例如 href="#"）不算真的跳轉
      const stripHash = (u: string) => u.split('#')[0];
      const navigated = stripHash(page.url()) !== stripHash(before);
      const mutations = await page.evaluate(() => {
        const n = (window as any).__qaMut || 0;
        try { (window as any).__qaMo?.disconnect(); } catch {}
        return n;
      }).catch(() => 0);

      const responded = navigated || popupSeen || dialogSeen || netCount > 0 || mutations > 0;
      if (!responded) {
        if (c.bareImgLink) {
          findings.push({
            severity: 'warning', category: '未設連結的圖片', pageUrl,
            message: `「${c.text}」外層有連結框但沒有設定連結，點了沒反應`,
            detail: '如果這張圖本來就不需要點擊可忽略；如果應該要能點（例如 LINE 圖示、外送平台、菜單放大），請美編補上連結。',
          });
        } else {
          findings.push({
            severity: 'error', category: '死按鈕', pageUrl,
            message: `按鈕「${c.text || '(無文字)'}」按下去沒有任何反應`,
            detail: '點擊後沒有跳轉、沒有開新視窗、畫面也沒有任何變化，可能忘記綁定功能或連結。',
          });
        }
      }

      if (navigated) {
        // 回到原頁面並重建索引，讓後面的按鈕還找得到
        await page.goto(before, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
        await page.evaluate(() => {
          document.querySelectorAll('button, [role="button"], a').forEach((el, i) => el.setAttribute('data-qaidx', String(i)));
        }).catch(() => {});
      }
    } catch {
      page.off('request', onRequest);
      // 元素點不到（被遮住等）不視為錯誤
    }
  }

  page.off('dialog', onDialog);
  browser.off('targetcreated', onTarget);
}

// ---------- per-page scan ----------

interface ScanCtx {
  emit: Emit;
  findings: Finding[];
  visited: Set<string>;
  seenConsole: Set<string>;
  seenResources: Set<string>;
  stats: { linksChecked: number; buttonsTested: number };
}

async function scanPage(
  browser: Browser, url: string, ctx: ScanCtx,
  opts: { clickTests: boolean; screenshot: boolean },
): Promise<{ internalLinks: string[]; screenshot?: string }> {
  const { emit, findings } = ctx;
  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  const failedResources: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORE_CONSOLE.test(msg.text())) consoleErrors.push(msg.text().slice(0, 200));
  });
  page.on('pageerror', (err) => { if (!IGNORE_CONSOLE.test(String(err))) consoleErrors.push(String(err).slice(0, 200)); });
  page.on('response', (res) => {
    if (res.status() >= 400 && !ANALYTICS_HOSTS.test(res.url())) {
      failedResources.push(`HTTP ${res.status()}  ${res.url().slice(0, 150)}`);
    }
  });

  let internalLinks: string[] = [];
  let screenshot: string | undefined;

  try {
    emit({ type: 'progress', message: `載入頁面：${url}` });
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });
    if (resp && resp.status() >= 400) {
      findings.push({
        severity: 'error', category: '頁面載入', pageUrl: url,
        message: `頁面本身回應 HTTP ${resp.status()}，無法正常開啟`,
      });
      return { internalLinks };
    }
    await sleep(800);

    // 標題
    const title = await page.title();
    if (!title.trim()) {
      findings.push({
        severity: 'warning', category: '基本檢查', pageUrl: url,
        message: '頁面沒有標題（<title>），分享到 LINE/FB 時會顯示空白',
      });
    }

    // 破圖
    const brokenImgs: string[] = await page.evaluate(() =>
      Array.from(document.images)
        .filter((img) => img.complete && img.naturalWidth === 0 && img.src && !img.src.startsWith('data:'))
        .map((img) => img.src.slice(0, 150))
    );
    for (const src of brokenImgs.slice(0, 10)) {
      findings.push({ severity: 'error', category: '破圖', pageUrl: url, message: '圖片載入失敗（破圖）', detail: `圖片網址：${src}` });
    }

    // 連結收集
    const links: PageLink[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: ((a as HTMLElement).innerText || a.getAttribute('aria-label') || '').trim().slice(0, 40),
      }))
    );
    const origin = new URL(url).origin;
    internalLinks = [...new Set(
      links.map((l) => l.href.split('#')[0])
        .filter((h) => h.startsWith(origin) && h !== url && /^https?:/.test(h) && !/\.(jpg|png|pdf|zip|mp4)$/i.test(h))
    )];

    await checkLineLinks(links, findings, url, emit);
    await checkLinks(links, findings, url, ctx.visited, emit, ctx.stats);

    if (opts.clickTests) {
      await clickTest(page, findings, url, emit, ctx.stats);
    }

    // console 錯誤（跨頁去重——同一個框架錯誤在每頁重複出現時只報一次，取前 5）
    for (const err of [...new Set(consoleErrors)].slice(0, 5)) {
      const key = err.slice(0, 80);
      if (ctx.seenConsole.has(key)) continue;
      ctx.seenConsole.add(key);
      findings.push({ severity: 'warning', category: '程式錯誤', pageUrl: url, message: '瀏覽器 console 出現錯誤（可能影響功能）', detail: err });
    }
    for (const r of [...new Set(failedResources)].slice(0, 5)) {
      const key = r.slice(0, 80);
      if (ctx.seenResources.has(key)) continue;
      ctx.seenResources.add(key);
      findings.push({ severity: 'warning', category: '資源載入', pageUrl: url, message: '頁面有資源載入失敗', detail: r });
    }

    if (opts.screenshot) {
      screenshot = (await page.screenshot({ type: 'jpeg', quality: 55, encoding: 'base64' })) as string;
    }
  } catch (e: any) {
    findings.push({
      severity: 'error', category: '頁面載入', pageUrl: url,
      message: `頁面載入失敗或逾時：${(e?.message || String(e)).slice(0, 150)}`,
    });
  } finally {
    await page.close().catch(() => {});
  }
  return { internalLinks, screenshot };
}

// ---------- mobile pass ----------

async function scanMobile(browser: Browser, url: string, ctx: ScanCtx): Promise<string | undefined> {
  const { emit, findings } = ctx;
  emit({ type: 'progress', message: '用手機尺寸重新檢查…' });
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });
    await sleep(800);

    // 注意：手機模擬下 Chrome 會把 layout viewport 撐大到內容寬度（shrink-to-fit），
    // 所以不能跟 window.innerWidth 比，要直接跟手機實際寬度 390 比。
    const mobile = await page.evaluate(() => ({
      hasViewport: !!document.querySelector('meta[name="viewport"]'),
      scrollW: document.scrollingElement ? document.scrollingElement.scrollWidth : document.body.scrollWidth,
    }));
    if (!mobile.hasViewport) {
      findings.push({
        severity: 'warning', category: '手機版', pageUrl: url,
        message: '頁面缺少 viewport 設定，手機打開會變成縮小版的電腦畫面，字非常小',
        detail: '請美編在 <head> 加上：<meta name="viewport" content="width=device-width, initial-scale=1">',
      });
    } else if (mobile.scrollW > 390 + 4) {
      findings.push({
        severity: 'warning', category: '手機版', pageUrl: url,
        message: `手機版內容超出螢幕寬度（內容寬 ${mobile.scrollW}px > 手機螢幕 390px），畫面會被縮小或左右晃動`,
        detail: '通常是某個元素被設了固定寬度（px），請美編改用 max-width:100% 或 %、rem 等相對單位。',
      });
    }
    return (await page.screenshot({ type: 'jpeg', quality: 55, encoding: 'base64' })) as string;
  } catch {
    return undefined;
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------- entry ----------

export async function runScan(rawUrl: string, depth: 'single' | 'site', emit: Emit): Promise<Report> {
  const started = Date.now();
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  new URL(url); // 格式驗證，錯誤會直接丟出

  const findings: Finding[] = [];
  const screenshots: { label: string; data: string }[] = [];
  const pagesScanned: string[] = [];
  const stats = { linksChecked: 0, buttonsTested: 0 };
  const ctx: ScanCtx = { emit, findings, visited: new Set(), seenConsole: new Set(), seenResources: new Set(), stats };
  let partial = false;

  emit({ type: 'progress', message: '啟動瀏覽器…' });
  const browser = await launchBrowser();
  try {
    const first = await scanPage(browser, url, ctx, { clickTests: true, screenshot: true });
    pagesScanned.push(url);
    if (first.screenshot) screenshots.push({ label: '電腦版畫面', data: first.screenshot });

    const mobileShot = await scanMobile(browser, url, ctx);
    if (mobileShot) screenshots.push({ label: '手機版畫面', data: mobileShot });

    if (depth === 'site') {
      const subpages = first.internalLinks.slice(0, MAX_SUBPAGES);
      for (const sub of subpages) {
        if (Date.now() - started > BUDGET_MS) { partial = true; break; }
        emit({ type: 'progress', message: `檢查子頁面：${sub}` });
        await scanPage(browser, sub, ctx, { clickTests: true, screenshot: false });
        pagesScanned.push(sub);
      }
      if (first.internalLinks.length > MAX_SUBPAGES) partial = true;
    }
  } finally {
    await browser.close().catch(() => {});
  }

  if (partial) {
    findings.push({
      severity: 'warning', category: '檢查範圍', pageUrl: url,
      message: `網站頁面較多，本次僅檢查了 ${pagesScanned.length} 頁，未涵蓋全站`,
      detail: '如需檢查其他頁面，請將該頁網址直接貼入再跑一次。',
    });
  }

  return {
    url,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    pagesScanned,
    findings,
    screenshots,
    stats: {
      ...stats,
      errors: findings.filter((f) => f.severity === 'error').length,
      warnings: findings.filter((f) => f.severity === 'warning').length,
    },
    partial,
  };
}
