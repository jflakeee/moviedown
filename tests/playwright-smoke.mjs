import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm, mkdir, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

const root = process.cwd();
const reportDir = path.join(root, "test-results", "playwright-smoke");
await mkdir(reportDir, { recursive: true });
const report = { startedAt: new Date().toISOString(), checks: [], errors: [] };
const mark = name => report.checks.push({ name, passed: true });
let page;
const server = createServer(async (req, res) => {
  if (new URL(req.url, "http://127.0.0.1").pathname === "/fixture") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end('<!doctype html><title>Public media fixture</title><a download href="/sample.mp4">다운로드</a><video src="/sample.mp4" controls></video>');
    return;
  }
  if (new URL(req.url, "http://127.0.0.1").pathname === "/sample.mp4") {
    res.writeHead(200, { "content-type": "video/mp4", "content-length": "0" }); res.end(); return;
  }
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  const filename = path.resolve(root, "." + (pathname === "/" ? "/index.html" : decodeURIComponent(pathname)));
  if (!filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    const bytes = await readFile(filename);
    const type = filename.endsWith(".js") ? "text/javascript" :
      filename.endsWith(".html") ? "text/html" : "text/plain";
    res.writeHead(200, { "content-type": type });
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const profile = await mkdtemp(path.join(os.tmpdir(), "md-smoke-"));
const testExtension = path.join(profile, "extension");
await cp(path.join(root, "extension"), testExtension, {recursive:true});
const manifestFile = path.join(testExtension, "manifest.json");
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
manifest.host_permissions.push("http://127.0.0.1/*");
await writeFile(manifestFile, JSON.stringify(manifest));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: false,
    args: [
      "--disable-extensions-except=" + testExtension,
      "--load-extension=" + testExtension
    ]
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  context.on("page", opened => {
    opened.on("pageerror", error => report.errors.push("Browser page error: " + String(error.message)));
  });
  const worker = context.serviceWorkers()[0] ||
    await context.waitForEvent("serviceworker", { timeout: 15000 });
  assert.ok(worker.url().startsWith("chrome-extension://"), "Extension worker missing");
  mark("extension-service-worker");
  const extensionId = new URL(worker.url()).hostname;
  const popup = await context.newPage();
  await popup.goto("chrome-extension://" + extensionId + "/popup.html");
  await popup.locator("#scan").waitFor();
  await popup.locator("#clear").waitFor();
  assert.equal(await popup.locator("#scan").isEnabled(), true);
  assert.equal(await popup.locator("#clear").isEnabled(), true);
  await popup.locator("#scan").click();
  await popup.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("분석 실패:"), null, { timeout: 15000 });
  assert.match(await popup.locator("#status").innerText(), /일반 웹페이지/);
  mark("popup-scan-error-handling");
  await popup.locator("#clear").click();
  await popup.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("기록 삭제 실패:"), null, { timeout: 15000 });
  mark("popup-clear-error-handling");
  await popup.screenshot({ path: path.join(reportDir, "extension-popup.png") });
  await popup.close();
  mark("extension-popup-loaded");
  const fixture = await context.newPage();
  await fixture.goto("http://127.0.0.1:" + server.address().port + "/fixture");
  await fixture.locator("a[download]").waitFor();
  const fixtureUrl = await fixture.locator("a[download]").getAttribute("href");
  assert.equal(new URL(fixtureUrl, fixture.url()).pathname, "/sample.mp4");
  const fixtureLinks = await fixture.evaluate(() => [...document.querySelectorAll("a[download], video[src]")].map(el => new URL(el.getAttribute("href") || el.getAttribute("src"), document.baseURI).href));
  assert.equal(fixtureLinks.length, 2);
  assert.ok(fixtureLinks.every(url => url.endsWith("/sample.mp4")));
  const fixtureTabId = await worker.evaluate(async targetUrl => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(item => item.url === targetUrl);
    if (!tab) throw Error("Fixture tab not found");
    return tab.id;
  }, fixture.url());
  const extracted = await worker.evaluate(async tabId => {
    const frames = await chrome.scripting.executeScript({
      target: {tabId, allFrames:true},
      func: () => [...document.querySelectorAll("a[href], video[src], video source[src]")]
        .map(el => el.href || el.currentSrc || el.src)
        .filter(Boolean)
    });
    return frames.flatMap(frame => frame.result || []);
  }, fixtureTabId);
  assert.ok(extracted.filter(url => url.endsWith("/sample.mp4")).length >= 2);
  mark("extension-scripting-public-links");
  const fixturePopup = await context.newPage();
  await fixturePopup.goto("chrome-extension://" + extensionId + "/popup.html");
  await fixture.bringToFront();
  await fixturePopup.bringToFront();
  await worker.evaluate(async tabId => { await chrome.tabs.update(tabId, {active:true}); }, fixtureTabId);
  await fixturePopup.locator("#scan").click();
  await fixturePopup.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("1개의 공개 미디어 링크 후보"), null, {timeout:15000});
  assert.equal(await fixturePopup.locator("#results li").count(), 1);
  assert.equal(await fixturePopup.locator("#results li a").first().getAttribute("href"), new URL("/sample.mp4", fixture.url()).href);
  mark("popup-detects-public-media");
  await context.route("https://jflakeee.github.io/moviedown/**", route => route.fulfill({status:200,contentType:"text/html",body:"<!doctype html><title>Transfer captured</title>"}));
  const [handoff] = await Promise.all([
    context.waitForEvent("page", {timeout:15000}),
    fixturePopup.getByRole("button", {name:"Drive 앱으로 전달"}).click()
  ]);
  await handoff.waitForLoadState("domcontentloaded");
  const target = new URL(handoff.url());
  assert.equal(target.origin, "https://jflakeee.github.io");
  assert.equal(target.pathname, "/moviedown/");
  assert.equal(target.searchParams.get("media"), new URL("/sample.mp4", fixture.url()).href);
  await handoff.close();
  mark("popup-drive-handoff-url");
  await fixturePopup.screenshot({path:path.join(reportDir,"extension-fixture.png")});
  await fixturePopup.close();
  mark("local-public-media-fixture");
  await fixture.close();
  page = await context.newPage();
  await page.goto("http://127.0.0.1:" + server.address().port + "/", {
    waitUntil: "domcontentloaded"
  });
  assert.match(await page.title(), /Media to Drive v1\.0/);
  mark("app-loaded");
  await page.locator("#url").fill("https://example.com/movie.mp4");
  await page.locator("#pythonTest").click();
  await page.locator("#analysisSummary").getByText(/DIRECT_FILE/).waitFor({timeout:90000});
  await page.locator("#inspect").click();
  await page.getByRole("button", {name:"이 파일 선택"}).waitFor({timeout:90000});
  mark("direct-file-classification");
  await page.locator("#url").fill("https://example.com/master.m3u8");
  await page.locator("#inspect").click();
  await page.locator("#analysisSummary").getByText(/HLS_STREAM/).waitFor({timeout:90000});
  assert.match(await page.locator("#jobs").innerText(), /완료/);
  mark("hls-classification");
  console.log("PASS: Chromium extension, app, Pyodide and stream classification");
} catch (error) {
  report.errors.push(String(error?.stack || error));
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  try { if (page) await page.screenshot({ path: path.join(reportDir, "app-final.png"), fullPage: true }); }
  catch (error) { report.errors.push("Screenshot: " + String(error)); }
  await writeFile(path.join(reportDir, "report.json"), JSON.stringify(report, null, 2));
  if (context) {
    try {
      await context.tracing.stop(report.errors.length ? { path: path.join(reportDir, "trace.zip") } : {});
    } catch (error) { console.warn("Trace save failed:", String(error)); }
  }
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, {recursive:true,force:true});
}
