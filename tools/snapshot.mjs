// Render an HTML page (e.g. a smlibpy viewer page) to PNG with a headless Chromium browser.
// usage: node tools/snapshot.mjs <page.html> <out.png> [width] [height]
// The page signals readiness with `window.__ready = true`. Set CHROME to the browser binary.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [, , page, out, width = "1200", height = "800"] = process.argv;
if (!page || !out) {
  console.error("usage: node tools/snapshot.mjs <page.html> <out.png> [width] [height]");
  process.exit(2);
}
const browser = process.env.CHROME || "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const profile = mkdtempSync(join(tmpdir(), "smlibpy-snapshot-"));
const port = 9300 + Math.floor(Math.random() * 600);
const proc = spawn(browser, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const p = list.find((t) => t.type === "page");
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  throw new Error("browser did not start");
}

let ws, id = 0;
const pending = new Map();
function send(method, params = {}) {
  const msg = { id: ++id, method, params };
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(msg.id, { res, rej }));
}

try {
  ws = new WebSocket(await target());
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: +width, height: +height, deviceScaleFactor: 2, mobile: false });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: process.env.SCHEME || "light" }] });
  const url = page.startsWith("http") || page.startsWith("file:") ? page : "file://" + resolve(page.split("#")[0]) + (page.includes("#") ? "#" + page.split("#")[1] : "");
  await send("Page.navigate", { url });
  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) {
    await sleep(100);
    const expr = process.env.READY === "load" ? "document.readyState === 'complete'" : "window.__ready === true";
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
    ready = r.result.value === true;
  }
  if (!ready) throw new Error("page did not signal readiness");
  await sleep(200);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log(`wrote ${out}`);
} catch (e) {
  console.error(String(e));
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch {}
  proc.kill("SIGKILL");
  await sleep(200);
  rmSync(profile, { recursive: true, force: true });
}
