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
  await context.grantPermissions(["notifications", "clipboard-read", "clipboard-write"], { origin: `http://127.0.0.1:${PORT}` });
  await context.addInitScript(() => {
    window.__shownNotifications = [];
    if (globalThis.ServiceWorkerRegistration) {
      ServiceWorkerRegistration.prototype.showNotification = async function showNotification(title, options) {
        window.__shownNotifications.push({ title, body: options?.body, tag: options?.tag });
      };
    }
  });
  const page = await context.newPage();
  let conversation = { available: true, provider: "codex", messages: [{ role: "user", text: "Test request", timestamp: Date.now() }] };
  await page.route("**/api/sessions/*/conversation", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(conversation),
  }));

  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
    const registration = await page.evaluate(async () => {
      const item = await navigator.serviceWorker.ready;
      return item.scope;
    });
    check("service worker registers", registration === `http://127.0.0.1:${PORT}/`, registration);
    check("authenticated content is not cached", (await page.evaluate(() => caches.keys())).length === 0);

    await openSession(page);
    await page.waitForFunction(() => document.querySelector("#agent-status")?.dataset.status === "working");
    check("active agent status shows Working", await page.textContent("#agent-status") === "Working");
    await page.click("#tmux-controls");
    await page.click("#notification-toggle");
    await page.waitForFunction(() => document.querySelector("#notification-toggle")?.getAttribute("aria-pressed") === "true");
    check("notification opt-in is enabled by its button", await page.getAttribute("#notification-toggle", "aria-pressed") === "true");
    await page.click("#tmux-close");
    await page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => true }));
    conversation = {
      available: true,
      provider: "codex",
      messages: Array.from({ length: 24 }, (_, index) => ({
        id: `message-${index}`,
        role: index % 2 ? "assistant" : "user",
        text: index === 23
          ? '# Result\n\n- Test response\n- `inline code`\n\n```js\nconst safe = true;\n```\n\n<img src=x onerror="globalThis.pwned=1"><script>globalThis.pwned=1</script>'
          : `Conversation line ${index}`,
        timestamp: Date.now() - (24 - index) * 1000,
      })),
    };
    await page.waitForFunction(() => document.querySelector("#agent-status")?.dataset.status === "waiting");
    await page.waitForFunction(() => window.__shownNotifications.some(({ tag }) => tag === "mobile-agent-console-ready"));
    const readyNotification = await page.evaluate(() => window.__shownNotifications.find(({ tag }) => tag === "mobile-agent-console-ready"));
    check("ready transition uses a generic notification", readyNotification.body === "An active session is waiting for input.");

    await tmux("send-keys", "-t", `${SESSION}:0.0`, "printf '\\a'", "Enter");
    await page.waitForFunction(() => window.__shownNotifications.some(({ tag }) => tag === "mobile-agent-console-attention"));
    const attentionNotification = await page.evaluate(() => window.__shownNotifications.find(({ tag }) => tag === "mobile-agent-console-attention"));
    check("terminal bell notification contains no terminal output", attentionNotification.body === "An active terminal session requested attention.");

    await page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => false }));
    await page.click("#view-toggle");
    await page.waitForSelector(".conversation-message h1");
    check("safe Markdown renders headings, lists, inline code, and fenced code",
      await page.locator(".conversation-message h1").count() === 1 &&
      await page.locator(".conversation-message ul").count() === 1 &&
      await page.locator(".conversation-message pre code").count() === 1 &&
      await page.locator(".message-content li code").count() === 1);
    check("hostile HTML stays inert text",
      await page.locator(".conversation-message img, .conversation-message script").count() === 0 &&
      await page.evaluate(() => globalThis.pwned) === undefined);
    check("conversation messages show timestamps", await page.locator(".conversation-message time").count() === 24);

    const copiedText = await page.locator(".conversation-message.assistant").last().locator(".message-copy").click()
      .then(() => page.evaluate(() => navigator.clipboard.readText()));
    check("message copy writes the original plain text", copiedText.includes("const safe = true") && copiedText.includes("<script>"));

    await page.fill("#conversation-search", "Test response");
    check("conversation search finds matching text", await page.textContent("#conversation-search-count") === "1/1");
    await page.locator("#conversation").evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
    await page.waitForSelector("#conversation-latest:not(.hidden)");
    await page.click("#conversation-latest");
    await page.waitForFunction(() => {
      const element = document.querySelector("#conversation");
      return element.scrollTop > 0;
    });
    check("jump to latest moves the conversation", true);

    const optimisticText = "echo optimistic-e2e";
    await page.fill("#message", optimisticText);
    await page.press("#message", "Enter");
    check("sent chat text renders immediately as pending",
      await page.locator(".conversation-message.pending", { hasText: optimisticText }).count() === 1);
    conversation.messages.push({ id: "message-24", role: "user", text: optimisticText, timestamp: Date.now() });
    await page.waitForFunction((text) => {
      const messages = [...document.querySelectorAll(".conversation-message")].filter((item) => item.textContent.includes(text));
      return messages.length === 1 && !messages[0].classList.contains("pending");
    }, optimisticText, { timeout: 10000 });
    check("transcript reconciliation removes pending state without duplication", true);
    await page.setViewportSize({ width: 320, height: 700 });
    const narrowLayout = await page.evaluate(() => ({
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      toolsOverflow: document.querySelector(".conversation-tools").scrollWidth - document.querySelector(".conversation-tools").clientWidth,
      searchWidth: Math.round(document.querySelector("#conversation-search").getBoundingClientRect().width),
    }));
    check("conversation controls fit at 320px",
      narrowLayout.pageOverflow === 0 && narrowLayout.toolsOverflow === 0 && narrowLayout.searchWidth >= 160,
      JSON.stringify(narrowLayout));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click("#view-toggle");

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
