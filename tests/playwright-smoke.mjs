import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
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
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: false,
    args: [
      "--disable-extensions-except=" + path.join(root, "extension"),
      "--load-extension=" + path.join(root, "extension")
    ]
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const worker = context.serviceWorkers()[0] ||
    await context.waitForEvent("serviceworker", { timeout: 15000 });
  assert.ok(worker.url().startsWith("chrome-extension://"), "Extension worker missing");
  mark("extension-service-worker");
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
