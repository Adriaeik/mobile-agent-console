// End-to-end scrolling check against the installed Codex and Claude Code TUIs.
//
//   node scripts/e2e-tui-scroll.mjs
//
// This is intentionally separate from CI: it uses authenticated local CLIs.
// A dedicated server port and tmux socket keep normal sessions untouched.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const SOCKET = `mac-tui-e2e-${process.pid}`;
const PORT = 3401;
const REPO = new URL("..", import.meta.url).pathname;
const results = [];

const tmux = (...args) => execFileAsync("tmux", ["-L", SOCKET, ...args]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function paneState(target) {
  const { stdout } = await tmux(
    "display-message", "-p", "-t", target,
    "#{pane_in_mode}\t#{pane_mode}\t#{mouse_any_flag}"
  );
  const [inMode, mode, mouse] = stdout.trimEnd().split("\t");
  return { inMode: inMode === "1", mode: mode || null, mouse: mouse === "1" };
}

async function main() {
  const { stdout: listeners } = await execFileAsync("ss", ["-ltn"]);
  if (listeners.split("\n").some((line) => line.includes(`:${PORT} `))) {
    throw new Error(`test port ${PORT} is already in use`);
  }

  const server = spawn("node", ["src/server.js"], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      AUTH_MODE: "local",
      ALLOW_LOCAL_AUTH: "true",
      ALLOWED_ROOTS: REPO,
      TMUX_SOCKET_NAME: SOCKET,
      TMUX_MOUSE: "on",
      CLAUDE_CODE_NO_FLICKER: "1",
      NODE_ENV: "development",
      PUBLIC_ORIGIN: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.stdout.on("data", (chunk) => String(chunk).includes("listening") && resolve());
      server.on("exit", (code) => reject(new Error(`server exited early (${code})`)));
      setTimeout(() => reject(new Error("server start timeout")), 30000);
    });

    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const sentFrames = [];
    page.on("websocket", (socket) => socket.on("framesent", (event) => sentFrames.push(String(event.payload))));
    page.on("pageerror", (error) => console.error(`[pageerror] ${error.message}`));
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });

    const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    async function swipe(fromY, toY, steps = 16) {
      const box = await page.locator("#terminal").boundingBox();
      const x = box.x + box.width / 2;
      await touch("touchStart", [{ x, y: fromY, id: 1 }]);
      for (let index = 1; index <= steps; index += 1) {
        await touch("touchMove", [{ x, y: fromY + ((toY - fromY) * index) / steps, id: 1 }]);
        await sleep(16);
      }
      await touch("touchEnd", []);
    }

    for (const provider of [
      { id: "codex", permission: "balanced", label: "Codex" },
      { id: "claude", permission: "plan", label: "Claude Code" },
    ]) {
      const sessionName = `tui-${provider.id}-${process.pid}`;
      const marker = "RIVER-STONE-ORBIT";
      const prompt = [
        "Without using tools, print exactly 100 numbered lines, from line 001 through line 100.",
        `Then print ${provider.id.toUpperCase()} followed by the uppercase words RIVER STONE ORBIT joined with hyphens, with no spaces.`,
      ].join(" ");
      const response = await context.request.post(`http://127.0.0.1:${PORT}/api/sessions`, {
        data: { name: sessionName, path: REPO, provider: provider.id, model: "", permission: provider.permission, prompt },
      });
      if (!response.ok()) throw new Error(`${provider.label} session creation failed: ${await response.text()}`);
      const session = await response.json();
      const target = `${session.id}:0.0`;

      await page.reload({ waitUntil: "networkidle" });
      const card = page.locator(".session-card", { hasText: sessionName });
      await card.locator(".open").click();
      await page.waitForFunction(
        (wanted) => document.querySelector(".xterm-rows")?.textContent?.includes(wanted),
        marker,
        { timeout: 180000 }
      );
      await sleep(1000);

      const beforeText = await page.locator(".xterm-rows").innerText();
      const before = await paneState(target);
      const terminalBox = await page.locator("#terminal").boundingBox();
      await swipe(terminalBox.y + terminalBox.height * 0.3, terminalBox.y + terminalBox.height * 0.78);
      await sleep(1800);
      const olderText = await page.locator(".xterm-rows").innerText();
      const older = await paneState(target);

      check(`${provider.label}: fullscreen TUI requests mouse forwarding`, before.mouse, `mouse_any_flag=${before.mouse}`);
      check(`${provider.label}: swipe changes the TUI viewport`, olderText !== beforeText,
        `visible text changed=${olderText !== beforeText}`);
      check(`${provider.label}: swipe does not enter tmux copy mode`, !older.inMode && older.mode !== "copy-mode",
        `pane_in_mode=${older.inMode}, pane_mode=${older.mode}`);
      check(`${provider.label}: app reports native TUI scrolling`,
        (await page.locator("#terminal-state").innerText()).startsWith("Live TUI"),
        await page.locator("#terminal-state").innerText());

      await swipe(terminalBox.y + terminalBox.height * 0.78, terminalBox.y + terminalBox.height * 0.3);
      await sleep(1200);
      const newerText = await page.locator(".xterm-rows").innerText();
      const newer = await paneState(target);
      check(`${provider.label}: reverse swipe moves toward current output`, newerText !== olderText,
        `visible text changed=${newerText !== olderText}`);
      check(`${provider.label}: reverse swipe also stays outside copy mode`, !newer.inMode,
        `pane_in_mode=${newer.inMode}`);

      const beforeButtonText = newerText;
      await page.click("#tmux-copy");
      await sleep(1000);
      const afterButtonText = await page.locator(".xterm-rows").innerText();
      const afterButton = await paneState(target);
      check(`${provider.label}: Scroll button moves the TUI history`, afterButtonText !== beforeButtonText,
        `visible text changed=${afterButtonText !== beforeButtonText}`);
      check(`${provider.label}: Scroll button does not enter tmux copy mode`, !afterButton.inMode,
        `pane_in_mode=${afterButton.inMode}`);

      if (provider.id === "codex") {
        sentFrames.length = 0;
        await page.click("#tmux-controls");
        await page.getByRole("button", { name: /Answer question/ }).click();
        await sleep(300);
        const sentShiftLeft = sentFrames.some((payload) => {
          try {
            const message = JSON.parse(payload);
            return message.type === "input" && message.data === "\u001b[1;2D";
          } catch {
            return false;
          }
        });
        check("Codex: Answer question sends Shift+Left", sentShiftLeft, `sent=${sentShiftLeft}`);
      }

      await page.click("#terminal-back");
      await context.request.delete(
        `http://127.0.0.1:${PORT}/api/sessions/${encodeURIComponent(session.id)}?confirm=${encodeURIComponent(sessionName)}`
      );
    }
  } finally {
    await browser?.close().catch(() => {});
    server.kill();
    await tmux("kill-server").catch(() => {});
  }

  const failed = results.filter((result) => !result.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error("harness error:", error);
  await tmux("kill-server").catch(() => {});
  process.exitCode = 2;
});
