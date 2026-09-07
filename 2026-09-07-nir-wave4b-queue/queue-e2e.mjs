// E2E for the composer queue (branch nir-wave4b-queue).
//
// No money is spent and no engine run happens: POST /api/studio is intercepted at
// the network layer and answered by this script, so the studio believes a run is
// live for exactly as long as we hold the response open.
//
// Usage: node queue-e2e.mjs <siteUrl> <shotDir>
// Run it from a checkout that has playwright installed (the engine repo does):
//   cd shapeless-ai-content && node <this file> http://localhost:3128 ./shots

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const SITE = process.argv[2] ?? "http://localhost:3128";
const SHOTS = process.argv[3] ?? "./shots";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
};

const PLAN_STREAM = [
  JSON.stringify({ type: "run-state", state: { phase: "planning" } }),
  JSON.stringify({ type: "text-delta", delta: "Here is what I would make." }),
  JSON.stringify({ type: "run-state", state: { phase: "awaiting-edits" } }),
  JSON.stringify({ type: "done" }),
].join("\n");

const QUEUE_KEY = (id) => `shapeless.queued-message.${id}`;

const chipText = (page) =>
  page.locator('[role="status"]:has-text("Sends when the agent finishes"), [role="status"]:has-text("The run ended")');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // --- the mocked engine ---------------------------------------------------
  /** Every POST /api/studio, in order. `release` fulfils the held response. */
  const turns = [];
  let stopCalls = 0;
  /** What GET /api/conversations/<id> answers with after a reload. */
  let thread = null;

  await context.route("**/api/studio", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.fallback();
    const body = JSON.parse(request.postData() ?? "{}");
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const turn = { goal: body.goal, op: body.op, body, release, fulfilled: null };
    turns.push(turn);
    const payload = await held;
    try {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
        body: payload,
      });
      turn.fulfilled = "ok";
    } catch (error) {
      // The page aborted this request (Stop, a new turn, or a navigation).
      turn.fulfilled = `aborted: ${(error && error.message) || error}`;
    }
  });

  await context.route("**/api/studio/stop", async (route) => {
    stopCalls += 1;
    await route.fulfill({ status: 200, body: JSON.stringify({ stopped: true }) });
  });

  // No live tail for a re-attached run, so the store falls back to polling.
  await context.route("**/api/studio/tail*", (route) =>
    route.fulfill({ status: 404, body: JSON.stringify({ error: "no tail" }) }),
  );

  await context.route("**/api/conversations/*", async (route) => {
    if (route.request().method() !== "GET" || !thread) return route.fallback();
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversation: thread }),
    });
  });

  const page = await context.newPage();
  page.on("pageerror", (error) => console.log(`  [pageerror] ${error.message}`));

  // Seeded local account (stack started with --dev-account).
  await page.goto(`${SITE}/api/dev/login`, { waitUntil: "domcontentloaded" });
  await page.goto(`${SITE}/studio`, { waitUntil: "domcontentloaded" });

  const box = page.getByRole("textbox", { name: "Describe what to make" });
  await box.waitFor({ state: "visible", timeout: 60_000 });
  // Identity first: submitting before /api/me lands raises the sign-in dialog
  // instead of a turn, which is correct behaviour and useless to test against.
  await page.getByText("Local Review").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1_000);

  // --- 1. a run goes live, and stays there ---------------------------------
  await box.click();
  await box.fill("make me a launch video for a solo founder");
  await box.press("Enter");
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await stop.waitFor({ state: "visible", timeout: 30_000 });
  check("a submitted turn puts the composer in the running state (Stop is showing)", true);
  await page.waitForFunction(() => true);

  // --- 2. Escape does not kill the run -------------------------------------
  await box.fill("escape must not kill this run");
  await box.press("Escape");
  await page.waitForTimeout(300);
  const afterEscape = await box.inputValue();
  check(
    'Escape clears the composer instead of the run: textarea === "" ',
    afterEscape === "",
    `textarea=${JSON.stringify(afterEscape)}`,
  );
  check(
    "Escape mid-run posts nothing to /api/studio/stop: stopCalls === 0",
    stopCalls === 0,
    `stopCalls=${stopCalls}`,
  );
  check(
    "Escape mid-run starts no new turn: turns.length === 1",
    turns.length === 1,
    `turns=${turns.length}`,
  );
  check(
    "the run is still live after Escape: the Stop button is still visible",
    await stop.isVisible(),
  );

  // --- 3. Enter mid-run queues instead of stopping --------------------------
  await box.fill("queued question one");
  await box.press("Enter");
  const chip = chipText(page);
  await chip.waitFor({ state: "visible", timeout: 10_000 });
  check(
    'the queued chip shows the typed message: chip contains "queued question one"',
    (await chip.innerText()).includes("queued question one"),
    JSON.stringify(await chip.innerText()),
  );
  check(
    "Enter mid-run posts nothing to /api/studio/stop: stopCalls === 0",
    stopCalls === 0,
    `stopCalls=${stopCalls}`,
  );
  check(
    "Enter mid-run starts no second turn: turns.length === 1",
    turns.length === 1,
    `turns=${turns.length}`,
  );
  check(
    "the run is NOT stopped: the first POST /api/studio is still open (not aborted)",
    turns[0].fulfilled === null,
    `fulfilled=${turns[0].fulfilled}`,
  );
  check(
    'no killed banner: "We stopped this run before it finished." is absent',
    !(await page.getByText("We stopped this run before it finished.").isVisible().catch(() => false)),
  );
  check(
    'the chip says when it goes: "Sends when the agent finishes"',
    (await chip.innerText()).includes("Sends when the agent finishes"),
  );
  const conversationId = await page.evaluate(() => location.pathname.split("/").pop());
  const stored = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    QUEUE_KEY(conversationId),
  );
  check(
    `the queue is in sessionStorage under shapeless.queued-message.<conversationId>`,
    Boolean(stored) && JSON.parse(stored).text === "queued question one",
    `stored=${stored}`,
  );

  // Screenshot: the chip during a run, at three widths.
  await shoot(page, "queued-chip", stop);

  // --- 4. a second Enter appends ------------------------------------------
  await box.fill("and one more");
  await box.press("Enter");
  await page.waitForTimeout(300);
  check(
    'a second queued message appends: chip contains both "queued question one" and "and one more"',
    (await chip.innerText()).includes("queued question one") &&
      (await chip.innerText()).includes("and one more"),
    JSON.stringify(await chip.innerText()),
  );

  // --- 5. edit takes it back into the composer -----------------------------
  await page.getByRole("button", { name: "Edit" }).click();
  await page.waitForTimeout(300);
  const edited = await box.inputValue();
  check(
    'Edit puts the queued text back in the composer: textarea === "queued question one\\nand one more"',
    edited === "queued question one\nand one more",
    JSON.stringify(edited),
  );
  check("Edit removes the chip", (await chip.count()) === 0);
  await shootEdit(page);

  // --- 6. re-queue, then cancel -------------------------------------------
  await box.press("Enter");
  await chip.waitFor({ state: "visible", timeout: 10_000 });
  await page.getByRole("button", { name: "Cancel the queued message" }).click();
  await page.waitForTimeout(400);
  check("Cancel removes the chip", (await chip.count()) === 0);
  const afterCancel = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    QUEUE_KEY(conversationId),
  );
  check(
    "Cancel clears sessionStorage: getItem(key) === null",
    afterCancel === null,
    `stored=${afterCancel}`,
  );

  // --- 7. queue again, then end the run: it sends itself, exactly once ------
  await box.fill("send me the thumbnail too");
  await box.press("Enter");
  await chip.waitFor({ state: "visible", timeout: 10_000 });
  turns[0].release(PLAN_STREAM);
  await page.waitForFunction(() => true);
  await page.waitForTimeout(2_500);
  const sent = turns.filter((t) => t.goal === "send me the thumbnail too");
  check(
    'the run ending sends the queued message: a POST /api/studio carries goal === "send me the thumbnail too"',
    sent.length === 1,
    `matching POSTs=${sent.length}, all goals=${JSON.stringify(turns.map((t) => t.goal))}`,
  );
  check(
    "the queued message is sent exactly once (no duplicate turn)",
    sent.length === 1 && turns.length === 2,
    `turns=${turns.length}`,
  );
  check("the chip clears once it is sent", (await chip.count()) === 0);
  check(
    "the first turn's response was consumed, never aborted: fulfilled === 'ok'",
    turns[0].fulfilled === "ok",
    `fulfilled=${turns[0].fulfilled}`,
  );

  // --- 8. a reload keeps the chip -----------------------------------------
  // The second turn is still open, so this thread has a live run to come back to.
  await box.fill("also post it to LinkedIn");
  await box.press("Enter");
  await chip.waitFor({ state: "visible", timeout: 10_000 });
  const before = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    QUEUE_KEY(conversationId),
  );
  // A durable run the server still owns - what a reload mid-run really finds.
  thread = { id: conversationId, messages: [], activeRunAt: new Date().toISOString() };
  await page.reload({ waitUntil: "domcontentloaded" });
  await box.waitFor({ state: "visible", timeout: 60_000 });
  await page.getByText("Local Review").first().waitFor({ timeout: 60_000 });
  const chipAfterReload = chipText(page);
  await chipAfterReload.waitFor({ state: "visible", timeout: 30_000 });
  check(
    'the chip survives a reload: it still reads "also post it to LinkedIn"',
    (await chipAfterReload.innerText()).includes("also post it to LinkedIn"),
    JSON.stringify(await chipAfterReload.innerText()),
  );
  check(
    "the reload restored it from sessionStorage, not from the server",
    JSON.parse(before).text === "also post it to LinkedIn",
    `stored=${before}`,
  );
  await shoot(page, "queued-chip-after-reload", null);

  // --- 9. the polled (durable) end of a run also sends it -------------------
  const turnsBefore = turns.length;
  thread = { id: conversationId, messages: [], activeRunAt: null };
  await page.waitForFunction(
    (key) => window.sessionStorage.getItem(key) === null,
    QUEUE_KEY(conversationId),
    { timeout: 20_000 },
  ).catch(() => {});
  const linkedin = turns.filter((t) => t.goal === "also post it to LinkedIn");
  check(
    'a durable run ending (the poll path) sends it too: exactly one POST with goal === "also post it to LinkedIn"',
    linkedin.length === 1,
    `matching POSTs=${linkedin.length}, new turns=${turns.length - turnsBefore}`,
  );
  check(
    "still no /api/studio/stop was ever posted: stopCalls === 0",
    stopCalls === 0,
    `stopCalls=${stopCalls}`,
  );

  for (const turn of turns) turn.release?.(PLAN_STREAM);
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

/**
 * Local-only chrome out of the proof: the Next dev indicator, the X-ray strip and
 * the style-lab button are fixed to the bottom-right of a DEV stack only, and at
 * 390 they sit on top of the send/stop controls this PR changes. Nothing that
 * ships is touched.
 */
async function hideDevChrome(page) {
  await page
    .addStyleTag({
      content:
        "nextjs-portal, .pos_fixed.bottom_3.right_3, .pos_fixed.right_3.bottom_12 { display: none !important; }",
    })
    .catch(() => {});
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("body *")) {
      if (getComputedStyle(el).position !== "fixed") continue;
      if ((el.textContent ?? "").length > 60) continue;
      const text = el.textContent ?? "";
      if (text.includes("X-RAY") || text.trim() === "style lab") el.style.display = "none";
    }
  });
}

/** The chip during a run, at the three widths the repo proves UI at. */
async function shoot(page, name, _stop) {
  await hideDevChrome(page);
  for (const width of [390, 1440, 2560]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/${name}-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
}

/** The edit state: the queued text back in the composer, mid-run. */
async function shootEdit(page) {
  await hideDevChrome(page);
  for (const width of [390, 1440, 2560]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/queued-edit-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
