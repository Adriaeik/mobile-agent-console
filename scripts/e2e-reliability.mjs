// Browser-level reliability check. Runs on an isolated port and tmux socket.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const PORT = 3401;
const SOCKET = "mac-reliability-e2e";
const SESSION = "reliabilitytest";
const REPO = new URL("..", import.meta.url).pathname;
const TEST_DATA_HOME = path.join(os.tmpdir(), `mobile-agent-console-e2e-${process.pid}`);
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
      XDG_DATA_HOME: TEST_DATA_HOME,
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
  await page.locator(".session-card", { hasText: SESSION }).locator(".open").click();
  await page.waitForFunction(
    () => document.querySelector("#terminal-state")?.textContent?.startsWith("Live"),
    null,
    { timeout: 15000 },
  );
}

async function main() {
  await tmux("kill-server").catch(() => {});
  await tmux("new-session", "-d", "-s", SESSION, "-x", "80", "-y", "24", "bash --norc --noprofile");
  await tmux("new-session", "-d", "-s", "alpha-shell", "-x", "80", "-y", "24", "bash --norc --noprofile");
  await tmux("new-session", "-d", "-s", "misc-process", "-x", "80", "-y", "24", "sleep 1000");
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
    const longToken = "mobile-agent-console".repeat(60);
    conversation = {
      available: true,
      provider: "codex",
      messages: Array.from({ length: 24 }, (_, index) => ({
        id: `message-${index}`,
        role: index % 2 ? "assistant" : "user",
        text: index === 23
          ? `# Result\n\n- Test response\n- \`inline code\`\n\n${longToken}\n\n\`\`\`js\nconst safe = true;\n${longToken}\n\`\`\`\n\n<img src=x onerror="globalThis.pwned=1"><script>globalThis.pwned=1</script>`
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
    const conversationWidths = await page.evaluate(() => {
      const root = document.querySelector("#conversation");
      const messages = document.querySelector("#conversation-messages");
      const article = document.querySelector(".conversation-message.assistant:last-of-type");
      const paragraph = article.querySelector(".message-content p");
      const pre = article.querySelector("pre");
      return {
        rootClient: root.clientWidth,
        rootScroll: root.scrollWidth,
        messages: Math.ceil(messages.getBoundingClientRect().width),
        article: Math.ceil(article.getBoundingClientRect().width),
        paragraphClient: paragraph.clientWidth,
        paragraphScroll: paragraph.scrollWidth,
        pre: Math.ceil(pre.getBoundingClientRect().width),
      };
    });
    check("long prose and code stay within the mobile chat width",
      conversationWidths.rootScroll === conversationWidths.rootClient &&
      conversationWidths.messages <= conversationWidths.rootClient &&
      conversationWidths.article <= conversationWidths.rootClient &&
      conversationWidths.paragraphScroll === conversationWidths.paragraphClient &&
      conversationWidths.pre <= conversationWidths.article,
      JSON.stringify(conversationWidths));
    const composerWidths = [];
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      composerWidths.push(await page.evaluate(() => {
        const messages = document.querySelector("#conversation-messages").getBoundingClientRect();
        const textarea = document.querySelector("#message").getBoundingClientRect();
        const send = document.querySelector("#composer .send").getBoundingClientRect();
        return {
          viewport: window.innerWidth,
          messageLeft: Math.round(messages.left),
          messageRight: Math.round(messages.right),
          inputLeft: Math.round(textarea.left),
          inputRight: Math.round(send.right),
        };
      }));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    check("chat composer aligns with the conversation at mobile and desktop widths",
      composerWidths.every((item) =>
        Math.abs(item.messageLeft - item.inputLeft) <= 1 &&
        Math.abs(item.messageRight - item.inputRight) <= 1),
      JSON.stringify(composerWidths));
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

    await page.evaluate(() => {
      const transfer = new DataTransfer();
      const png = new File([
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      ], "clipboard.png", { type: "image/png" });
      transfer.items.add(png);
      document.querySelector("#message").dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }));
    });
    await page.waitForFunction(() => document.querySelector("#message")?.value.startsWith("Attached image:"));
    const imageReference = (await page.inputValue("#message")).replace("Attached image: ", "");
    const imageInfo = await stat(imageReference);
    check("clipboard image is uploaded privately and referenced in the message",
      imageReference.startsWith(TEST_DATA_HOME) && imageInfo.size === 9 && (imageInfo.mode & 0o777) === 0o600,
      imageReference);
    await page.fill("#message", "");

    const optimisticText = "echo optimistic-e2e";
    await page.fill("#message", optimisticText);
    await page.press("#message", "Enter");
    await page.waitForFunction((text) =>
      [...document.querySelectorAll(".conversation-message.pending")].some((item) => item.textContent.includes(text)),
    optimisticText);
    check("acknowledged chat text renders as pending", true);
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

    const sessionPayload = await context.request.get(`http://127.0.0.1:${PORT}/api/sessions`).then((response) => response.json());
    const byName = Object.fromEntries(sessionPayload.sessions.map((session) => [session.name, session]));
    check("session API exposes activity and stable provider categories",
      Number.isFinite(byName[SESSION]?.lastActivity) &&
      byName[SESSION]?.provider === "shell" &&
      byName["misc-process"]?.provider === "other");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#dashboard:not(.hidden) .session-card");
    await page.selectOption("#session-provider", "other");
    check("provider filter isolates generic processes",
      await page.locator(".session-card").count() === 1 &&
      await page.locator(".session-card h2").innerText() === "misc-process");
    await page.setViewportSize({ width: 320, height: 700 });
    const dashboardOverflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tools: document.querySelector(".session-tools").scrollWidth - document.querySelector(".session-tools").clientWidth,
    }));
    check("dashboard controls fit at 320px", dashboardOverflow.page === 0 && dashboardOverflow.tools === 0, JSON.stringify(dashboardOverflow));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.selectOption("#session-provider", "all");
    await page.fill("#session-search", "sleep");
    check("session search covers commands", await page.locator(".session-card h2").innerText() === "misc-process");
    await page.fill("#session-search", "");
    await page.locator(".session-card", { hasText: SESSION }).locator(".pin-session").click();
    check("pinning moves a session ahead of recent sessions", await page.locator(".session-card h2").first().innerText() === SESSION);
    await page.reload({ waitUntil: "networkidle" });
    check("pinning survives reload", await page.locator(".session-card h2").first().innerText() === SESSION);
    await page.selectOption("#session-provider", "other");
    await page.reload({ waitUntil: "networkidle" });
    check("provider preference survives reload",
      await page.inputValue("#session-provider") === "other" && await page.locator(".session-card").count() === 1);
    const localValues = await page.evaluate(() => Object.values(localStorage));
    check("local preferences contain no conversation content",
      !JSON.stringify(localValues).includes("Test response") && !JSON.stringify(localValues).includes("optimistic-e2e"));
  } finally {
    await browser.close();
    await stopServer(server);
    await tmux("kill-server").catch(() => {});
    await rm(TEST_DATA_HOME, { recursive: true, force: true });
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
