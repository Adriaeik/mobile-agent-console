// End-to-end check of mobile scrolling against a real tmux pane and a real browser.
//
//   npm install -g playwright && playwright install chromium
//   node scripts/e2e-scroll.mjs
//
// Not part of `npm test`: it needs Chromium and a tmux binary, so CI would have to
// install both. It runs its own server on port 3399 and its own tmux socket, so the
// sessions and service you actually use are never touched.
//
// Note: desktop Chromium does not implement double-tap-to-zoom even under mobile
// emulation, so the zoom guarantees are asserted through the touch-action contract
// that governs the gesture rather than by observing a zoom that cannot happen here.
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const SOCKET = "mac-e2e";
const PORT = 3399;
const REPO = new URL("..", import.meta.url).pathname;
const SESSION = "scrolltest";
const results = [];

const tmux = (...args) => execFileAsync("tmux", ["-L", SOCKET, ...args]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function scrollPosition(target) {
  const { stdout } = await tmux("display-message", "-p", "-t", target, "#{pane_in_mode}\t#{pane_mode}\t#{scroll_position}");
  const [inMode, mode, position] = stdout.trimEnd().split("\t");
  return { inMode: inMode === "1", mode: mode || null, position: Number(position) || 0 };
}

function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function main() {
  // Only ever reclaim the dedicated test port, never the user's running service.
  await execFileAsync("bash", ["-c", `ss -ltnp 2>/dev/null | grep -oP '(?<=pid=)[0-9]+(?=,[^)]*\\))' <<< "$(ss -ltnp 2>/dev/null | grep :${PORT})" | xargs -r kill`]).catch(() => {});
  await sleep(500);
  await tmux("kill-server").catch(() => {});
  await tmux("new-session", "-d", "-s", SESSION, "-x", "80", "-y", "24", "bash --norc --noprofile");
  await tmux("set-window-option", "-t", `${SESSION}:0`, "history-limit", "50000");
  await tmux("send-keys", "-t", `${SESSION}:0`, "for i in $(seq 1 600); do echo \"output line $i\"; done", "Enter");
  await sleep(1500);
  const { stdout: idOut } = await tmux("display-message", "-p", "-t", `${SESSION}:0`, "#{session_id}");
  const sessionId = idOut.trim();
  const target = `${sessionId}:0.0`;

  const server = spawn("node", ["src/server.js"], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", AUTH_MODE: "local", ALLOW_LOCAL_AUTH: "true",
           ALLOWED_ROOTS: REPO, TMUX_SOCKET_NAME: SOCKET, NODE_ENV: "development", PUBLIC_ORIGIN: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (chunk) => String(chunk).includes("listening") && resolve());
    server.on("exit", (code) => reject(new Error(`server exited early (${code})`)));
    setTimeout(() => reject(new Error("server start timeout")), 10000);
  });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Mobile Safari/537.36"
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));
  const cdp = await context.newCDPSession(page);
  const scale = () => page.evaluate(() => window.visualViewport.scale);

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".session-card");
  await page.click(".session-card .open");
  await page.waitForFunction(() => document.querySelector("#terminal-state")?.textContent?.startsWith("Live"), null, { timeout: 10000 });
  await sleep(600);

  const box = await page.locator("#terminal").boundingBox();
  const midX = box.x + box.width / 2;
  const midY = box.y + box.height / 2;
  const upLocator = page.locator(".key-row button").filter({ hasText: "↑" }).first();
  const upButton = await upLocator.boundingBox();

  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  async function swipe(fromY, toY, steps = 14) {
    await touch("touchStart", [{ x: midX, y: fromY, id: 1 }]);
    for (let index = 1; index <= steps; index += 1) {
      await touch("touchMove", [{ x: midX, y: fromY + ((toY - fromY) * index) / steps, id: 1 }]);
      await sleep(16);
    }
    await touch("touchEnd", [{ x: midX, y: toY, id: 1 }]);
  }

  // --- 1. swipe down from live mode scrolls back through history ---------
  const beforeSwipe = await scrollPosition(target);
  await swipe(midY - 150, midY + 150);
  await sleep(1200);
  const afterSwipe = await scrollPosition(target);
  check("swipe down scrolls back through history from live mode",
    afterSwipe.position > beforeSwipe.position && afterSwipe.mode === "copy-mode",
    `position ${beforeSwipe.position} -> ${afterSwipe.position}, mode ${afterSwipe.mode}`);
  check("swipe does not zoom the page", (await scale()) === 1, `visualViewport.scale=${await scale()}`);

  // --- 2. swipe up scrolls back toward the live prompt -------------------
  const beforeBack = await scrollPosition(target);
  await swipe(midY + 150, midY - 150);
  await sleep(1200);
  const afterBack = await scrollPosition(target);
  check("swipe up scrolls forward again",
    afterBack.position < beforeBack.position,
    `position ${beforeBack.position} -> ${afterBack.position}`);

  // --- 3. rapid arrow taps ----------------------------------------------
  // Enter scroll mode explicitly so the tap tests measure the same thing on any build.
  if (!(await page.locator("#tmux-copy").evaluate((node) => node.classList.contains("active")))) {
    await page.click("#tmux-copy");
    await sleep(1200);
  }
  const beforeTaps = await scrollPosition(target);
  for (let index = 0; index < 10; index += 1) {
    await page.touchscreen.tap(upButton.x + upButton.width / 2, upButton.y + upButton.height / 2);
    await sleep(50);
  }
  await sleep(1500);
  const afterTaps = await scrollPosition(target);
  const tapScale = await scale();
  check("ten rapid arrow taps scroll ten lines",
    afterTaps.position - beforeTaps.position === 10,
    `position ${beforeTaps.position} -> ${afterTaps.position} (delta ${afterTaps.position - beforeTaps.position})`);
  check("rapid arrow taps do not zoom the page", tapScale === 1, `visualViewport.scale=${tapScale}`);

  // --- 4. holding the arrow key auto-repeats -----------------------------
  const beforeHold = await scrollPosition(target);
  await touch("touchStart", [{ x: upButton.x + upButton.width / 2, y: upButton.y + upButton.height / 2, id: 2 }]);
  await sleep(1500);
  const heldClass = await upLocator.evaluate((node) => node.classList.contains("held"));
  await touch("touchEnd", [{ x: upButton.x + upButton.width / 2, y: upButton.y + upButton.height / 2, id: 2 }]);
  await sleep(1500);
  const afterHold = await scrollPosition(target);
  const holdScale = await scale();
  check("holding the arrow key auto-repeats",
    afterHold.position - beforeHold.position >= 10,
    `position ${beforeHold.position} -> ${afterHold.position} (delta ${afterHold.position - beforeHold.position})`);
  check("held key shows pressed state", heldClass === true, `held=${heldClass}`);
  check("holding the arrow key does not zoom", holdScale === 1, `visualViewport.scale=${holdScale}`);

  // --- 5. releasing the key stops the scrolling ---------------------------
  await sleep(800);
  const settled = await scrollPosition(target);
  check("scrolling stops when the key is released",
    settled.position === afterHold.position,
    `position ${afterHold.position} -> ${settled.position}`);

  // --- 5b. gesture configuration that suppresses double-tap zoom ----------
  // Headless Chromium never performs double-tap zoom, so assert the CSS contract
  // that governs it on a real phone instead of pretending to observe the gesture.
  const gestures = await page.evaluate(() => ({
    upKey: getComputedStyle(document.querySelector(".key-row button[data-repeat]")).touchAction,
    keyRow: getComputedStyle(document.querySelector(".key-row")).touchAction,
    terminal: getComputedStyle(document.querySelector("#terminal")).touchAction,
    page: getComputedStyle(document.querySelector(".terminal-page")).touchAction
  }));
  check("arrow keys opt out of double-tap zoom", gestures.upKey === "manipulation", `touch-action=${gestures.upKey}`);
  check("key row opts out of double-tap zoom", gestures.keyRow === "manipulation", `touch-action=${gestures.keyRow}`);
  check("terminal owns vertical drags but keeps pinch zoom", gestures.terminal === "pinch-zoom", `touch-action=${gestures.terminal}`);
  check("terminal page opts out of double-tap zoom", gestures.page === "manipulation", `touch-action=${gestures.page}`);

  // --- 5c. keyboard activation of a repeating key still works -------------
  const beforeKeyboard = await scrollPosition(target);
  await upLocator.focus();
  await page.keyboard.press("Enter");
  await sleep(1200);
  const afterKeyboard = await scrollPosition(target);
  check("keyboard activation of the arrow key scrolls once",
    afterKeyboard.position - beforeKeyboard.position === 1,
    `position ${beforeKeyboard.position} -> ${afterKeyboard.position}`);

  // --- 5d. left and right must not disturb scroll mode --------------------
  const beforeSideways = await scrollPosition(target);
  const sideBox = await page.locator(".key-row button").filter({ hasText: "←" }).first().boundingBox();
  await page.touchscreen.tap(sideBox.x + sideBox.width / 2, sideBox.y + sideBox.height / 2);
  await sleep(700);
  const afterSideways = await scrollPosition(target);
  check("left arrow leaves scroll mode and position untouched",
    afterSideways.mode === "copy-mode" && afterSideways.position === beforeSideways.position,
    `mode ${afterSideways.mode}, position ${beforeSideways.position} -> ${afterSideways.position}`);

  // --- 6. double tap inside the terminal does not zoom ---------------------
  await page.touchscreen.tap(midX, midY);
  await sleep(80);
  await page.touchscreen.tap(midX, midY);
  await sleep(600);
  check("double tap in the terminal leaves the viewport alone", (await scale()) === 1, `visualViewport.scale=${await scale()} (headless cannot zoom; weak check)`);

  // --- 7. normal typing still reaches the pane ---------------------------
  await page.click("#tmux-copy");                       // leave scroll mode
  await page.waitForFunction(() => document.querySelector("#terminal-state")?.textContent?.startsWith("Live"), null, { timeout: 5000 });
  await page.evaluate(() => document.querySelector("#terminal textarea")?.focus());
  await page.keyboard.type("echo e2e-typing-works");
  await page.keyboard.press("Enter");
  await sleep(1200);
  const { stdout: pane } = await tmux("capture-pane", "-p", "-t", target);
  check("typing still reaches the shell", pane.includes("e2e-typing-works"), "found echo output in pane");
  const liveState = await scrollPosition(target);
  check("terminal returns to live mode", liveState.mode !== "copy-mode", `mode=${liveState.mode}`);

  // --- 7b. the key row carries full arrow navigation ---------------------
  const keyLayout = await page.evaluate(() => {
    const row = document.querySelector(".key-row");
    const buttons = [...row.querySelectorAll("button")];
    return {
      labels: buttons.map((button) => button.textContent.trim()),
      overflow: row.scrollWidth - row.clientWidth,
      narrowest: Math.min(...buttons.map((button) => Math.round(button.getBoundingClientRect().width))),
      clipped: buttons.filter((button) => button.scrollWidth > button.clientWidth + 1).map((button) => button.textContent.trim()),
      touchActions: [...new Set(buttons.map((button) => getComputedStyle(button).touchAction))]
    };
  });
  check("key row keeps every existing key and adds left/right",
    keyLayout.labels.join(" ") === "Esc Scroll Tab ← ↑ ↓ → Enter", keyLayout.labels.join(" "));
  check("key row fits without horizontal scrolling", keyLayout.overflow === 0, `overflow ${keyLayout.overflow}px`);
  check("no key label is clipped", keyLayout.clipped.length === 0, keyLayout.clipped.join(",") || "none clipped");
  check("every key stays a usable target", keyLayout.narrowest >= 34, `narrowest key ${keyLayout.narrowest}px`);
  check("all eight keys opt out of double-tap zoom",
    keyLayout.touchActions.length === 1 && keyLayout.touchActions[0] === "manipulation", keyLayout.touchActions.join(","));

  // --- 7c. left and right actually drive the cursor ----------------------
  const cursorX = async () => Number((await tmux("display-message", "-p", "-t", target, "#{cursor_x}")).stdout.trim());
  const tapKey = async (box) => {
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(400);
  };
  const leftBox = await page.locator(".key-row button").filter({ hasText: "←" }).first().boundingBox();
  const rightBox = await page.locator(".key-row button").filter({ hasText: "→" }).first().boundingBox();
  await page.evaluate(() => document.querySelector("#terminal textarea")?.focus());
  await page.keyboard.type("echo abcdefghijklmnopqrstuvwxyz");
  await sleep(700);
  const typedAt = await cursorX();
  await tapKey(leftBox);
  const afterLeft = await cursorX();
  check("left arrow moves the cursor one column back", typedAt - afterLeft === 1, `cursor ${typedAt} -> ${afterLeft}`);
  await tapKey(rightBox);
  const afterRight = await cursorX();
  check("right arrow moves the cursor one column forward", afterRight - afterLeft === 1, `cursor ${afterLeft} -> ${afterRight}`);

  await touch("touchStart", [{ x: leftBox.x + leftBox.width / 2, y: leftBox.y + leftBox.height / 2, id: 3 }]);
  await sleep(1400);
  await touch("touchEnd", [{ x: leftBox.x + leftBox.width / 2, y: leftBox.y + leftBox.height / 2, id: 3 }]);
  await sleep(600);
  const afterHoldLeft = await cursorX();
  check("holding left repeats across the line", afterRight - afterHoldLeft >= 10, `cursor ${afterRight} -> ${afterHoldLeft}`);

  await touch("touchStart", [{ x: rightBox.x + rightBox.width / 2, y: rightBox.y + rightBox.height / 2, id: 4 }]);
  await sleep(1400);
  await touch("touchEnd", [{ x: rightBox.x + rightBox.width / 2, y: rightBox.y + rightBox.height / 2, id: 4 }]);
  await sleep(600);
  const afterHoldRight = await cursorX();
  check("holding right repeats back the other way", afterHoldRight - afterHoldLeft >= 10, `cursor ${afterHoldLeft} -> ${afterHoldRight}`);

  // Editing mid-line is the whole point of having left and right.
  await tapKey(leftBox);
  await tapKey(leftBox);
  await page.evaluate(() => document.querySelector("#terminal textarea")?.focus());
  await page.keyboard.type("Z");
  await sleep(600);
  const { stdout: editedPane } = await tmux("capture-pane", "-p", "-t", target);
  check("cursor keys allow editing in the middle of a line",
    editedPane.includes("echo abcdefghijklmnopqrstuvwxZyz"), "inserted a character mid-line");
  await page.keyboard.press("Control+C");
  await sleep(400);

  // --- 8. the on-screen keyboard must not bury the toolbar ---------------
  await page.click("#tmux-controls");
  await page.click("#composer-toggle");
  await sleep(400);
  const fullHeight = await page.evaluate(() => window.innerHeight);
  const paneBefore = (await tmux("display-message", "-p", "-t", target, "#{pane_height}")).stdout.trim();

  // iOS shrinks only the visual viewport, which is the case a fixed inset-0 page
  // gets wrong; emulate it directly since no browser here raises a real keyboard.
  const keyboard = 340;
  await page.evaluate((height) => {
    Object.defineProperty(window.visualViewport, "height", { value: height, configurable: true });
    window.visualViewport.dispatchEvent(new Event("resize"));
  }, fullHeight - keyboard);
  await sleep(700);
  const lifted = await page.evaluate(() => {
    const rect = (selector) => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { top: Math.round(box.top), bottom: Math.round(box.bottom), height: Math.round(box.height) };
    };
    return { page: rect("#terminal-page"), keyRow: rect(".key-row"), composer: rect(".composer"), terminal: rect("#terminal") };
  });
  const visible = fullHeight - keyboard;
  check("terminal page shrinks to the space above the keyboard",
    Math.abs(lifted.page.height - visible) <= 1, `page height ${lifted.page.height} vs visible ${visible}`);
  check("key row toolbar stays above the keyboard",
    lifted.keyRow.bottom <= visible + 1, `key row bottom ${lifted.keyRow.bottom}, keyboard starts at ${visible}`);
  check("composer input stays above the keyboard",
    lifted.composer.bottom <= visible + 1, `composer bottom ${lifted.composer.bottom}, keyboard starts at ${visible}`);
  check("terminal keeps a usable height above the keyboard",
    lifted.terminal.height > 80, `terminal height ${lifted.terminal.height}`);

  const paneDuring = (await tmux("display-message", "-p", "-t", target, "#{pane_height}")).stdout.trim();
  check("tmux reflows into the reduced height so the prompt stays visible",
    Number(paneDuring) < Number(paneBefore), `pane height ${paneBefore} -> ${paneDuring}`);

  // --- 9. dismissing the keyboard restores the layout --------------------
  await page.evaluate(() => {
    delete window.visualViewport.height;
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await sleep(700);
  const restored = await page.evaluate(() => Math.round(document.querySelector("#terminal-page").getBoundingClientRect().height));
  const paneAfter = (await tmux("display-message", "-p", "-t", target, "#{pane_height}")).stdout.trim();
  check("layout returns to full height when the keyboard closes",
    Math.abs(restored - fullHeight) <= 1, `page height ${restored} vs ${fullHeight}`);
  check("tmux returns to its full height", paneAfter === paneBefore, `pane height ${paneDuring} -> ${paneAfter}`);

  // --- 10. typing still works after the keyboard cycle -------------------
  await page.evaluate(() => document.querySelector("#terminal textarea")?.focus());
  await page.keyboard.type("echo after-keyboard-cycle");
  await page.keyboard.press("Enter");
  await sleep(1200);
  const { stdout: paneAfterCycle } = await tmux("capture-pane", "-p", "-t", target);
  check("typing still works after the keyboard opens and closes",
    paneAfterCycle.includes("after-keyboard-cycle"), "found echo output in pane");

  await browser.close();
  server.kill();
  await tmux("kill-server").catch(() => {});

  const failed = results.filter((result) => !result.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error("harness error:", error);
  await tmux("kill-server").catch(() => {});
  process.exit(2);
});
