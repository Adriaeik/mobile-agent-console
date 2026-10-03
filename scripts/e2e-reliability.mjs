// Browser-level reliability check. Runs on an isolated port and tmux socket.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const PORT = 3401;
const SOCKET = "mac-reliability-e2e";
const SESSION = "reliabilitytest";
const REPO = new URL("..", import.meta.url).pathname;
const results = [];

const tmux = (...args) => execFileAsync("tmux", ["-L", SOCKET, ...args]);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function startServer() {
  const child = spawn("node", ["src/server.js"], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      AUTH_MODE: "local",
      ALLOW_LOCAL_AUTH: "true",
      ALLOWED_ROOTS: REPO,
      TMUX_SOCKET_NAME: SOCKET,
      NODE_ENV: "development",
      PUBLIC_ORIGIN: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("server start timeout")), 10000);
    child.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("listening")) return;
      clearTimeout(timeout);
      resolve();
    });
    child.on("exit", (code) => reject(new Error(`server exited early (${code})`)));
  });
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(3000),
  ]);
}

async function openSession(page) {
  await page.waitForSelector(".session-card");
  await page.click(".session-card .open");
  await page.waitForFunction(
    () => document.querySelector("#terminal-state")?.textContent?.startsWith("Live"),
    null,
    { timeout: 15000 },
  );
}

async function main() {
  await tmux("kill-server").catch(() => {});
  await tmux("new-session", "-d", "-s", SESSION, "-x", "80", "-y", "24", "bash --norc --noprofile");
  let server = await startServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
    const registration = await page.evaluate(async () => {
      const item = await navigator.serviceWorker.ready;
      return item.scope;
    });
    check("service worker registers", registration === `http://127.0.0.1:${PORT}/`, registration);
    check("authenticated content is not cached", (await page.evaluate(() => caches.keys())).length === 0);

    await openSession(page);
    await page.click("#tmux-controls");
    await page.click("#composer-toggle");
    const draft = "echo reliability-draft-sent";
    await page.fill("#message", draft);
    await page.reload({ waitUntil: "networkidle" });
    await openSession(page);
    await page.click("#tmux-controls");
    await page.click("#composer-toggle");
    check("draft survives a reload", await page.inputValue("#message") === draft);

    await stopServer(server);
    await page.waitForFunction(
      () => /Disconnected|Reconnecting/.test(document.querySelector("#terminal-state")?.textContent || ""),
      null,
      { timeout: 10000 },
    );
    server = await startServer();
    await page.waitForFunction(
      () => document.querySelector("#terminal-state")?.textContent?.startsWith("Live"),
      null,
      { timeout: 20000 },
    );
    check("terminal reconnects after the server returns", true);
    check("draft survives disconnect and reconnect", await page.inputValue("#message") === draft);
    await page.click("#composer .send");
    await sleep(1200);
    const { stdout } = await tmux("capture-pane", "-p", "-t", `${SESSION}:0.0`);
    check("reconnected composer sends successfully", stdout.includes("reliability-draft-sent"));
    check("successful send clears the draft", await page.evaluate(() => sessionStorage.length) === 0);
    check("server change is announced", await page.locator("#update-banner").isVisible());
  } finally {
    await browser.close();
    await stopServer(server);
    await tmux("kill-server").catch(() => {});
  }

  const failed = results.filter(({ passed }) => !passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error("harness error:", error);
  await tmux("kill-server").catch(() => {});
  process.exit(2);
});
