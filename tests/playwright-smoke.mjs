import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

const root = process.cwd();
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
  const worker = context.serviceWorkers()[0] ||
    await context.waitForEvent("serviceworker", { timeout: 15000 });
  assert.ok(worker.url().startsWith("chrome-extension://"), "Extension worker missing");
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:" + server.address().port + "/", {
    waitUntil: "domcontentloaded"
  });
  assert.match(await page.title(), /Media to Drive v1\.0/);
  await page.locator("#url").fill("https://example.com/movie.mp4");
  await page.locator("#pythonTest").click();
  await page.locator("#analysisSummary").getByText(/DIRECT_FILE/).waitFor({timeout:90000});
  await page.locator("#inspect").click();
  await page.getByRole("button", {name:"이 파일 선택"}).waitFor({timeout:90000});
  await page.locator("#url").fill("https://example.com/master.m3u8");
  await page.locator("#inspect").click();
  await page.locator("#analysisSummary").getByText(/HLS_STREAM/).waitFor({timeout:90000});
  assert.match(await page.locator("#jobs").innerText(), /완료/);
  console.log("PASS: Chromium extension, app, Pyodide and stream classification");
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, {recursive:true,force:true});
}
