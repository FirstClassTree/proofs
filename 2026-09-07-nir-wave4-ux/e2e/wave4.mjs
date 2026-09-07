// E2E proof for the nir-wave4-ux branch, driven headless against the local
// stack. Nothing here opens a window and nothing spends money: the only faked
// values are API payloads for rows the seeded dev account does not have
// (a connection, a finished run). Every page, component and signal is real.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { CONVERSATION_ID, conversation, CONNECTION } from "./fixture.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "/private/tmp/claude-501/-Users-talweiss-Dev-saas-ShapelessAI-Master/2f1b1be3-67bb-4483-9aae-b9c7ec400004/scratchpad/shots";
mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (name, detail) => { results.push({ name, pass: true, detail }); console.log(`PASS ${name} :: ${detail}`); };
const assert = (cond, name, detail) => {
  if (!cond) { results.push({ name, pass: false, detail }); console.log(`FAIL ${name} :: ${detail}`); failed = true; }
  else ok(name, detail);
};
let failed = false;

const WIDTHS = [390, 1440, 2560];
// The local media proxy fetches from GCS, so a poster can take seconds. A shot
// taken over a skeleton would prove nothing about the layout.
const settled = (page) =>
  page.waitForFunction(
    () => [...document.images].every((img) => img.complete && img.naturalWidth > 0),
    null,
    { timeout: 30_000 },
  ).catch(() => {});
const shot = async (page, name, focus) => {
  const before = page.viewportSize();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
    await settled(page);
    // Reflow moves the subject, so the frame is chosen at each width.
    if (focus) await focus.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: false });
  }
  if (before) await page.setViewportSize(before);
};

const b64urlJson = (s) => JSON.parse(Buffer.from(s, "base64url").toString());

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });

// Connections are served from here so the run can watch the list change.
let connections = [];
let connectionFetches = 0;
await context.route(
  (url) => url.pathname === "/api/connections" ,
  async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    connectionFetches += 1;
    await route.fulfill({ json: { connections } });
  },
);
// The connect route is stubbed IN THE BROWSER so the popup stays on our origin
// (window.opener is only readable same-origin). The real route is exercised
// separately, over plain HTTP, further down.
await context.route(
  (url) => url.pathname.startsWith("/api/connections/") && url.pathname !== "/api/connections/tracked",
  (route) => route.fulfill({ contentType: "text/html", body: "<title>consent stub</title><p>platform consent</p>" }),
);
await context.route(
  (url) => url.pathname === `/api/conversations/${CONVERSATION_ID}`,
  (route) => route.fulfill({ json: { conversation: conversation() } }),
);
let scheduleRequests = [];
await context.route(
  (url) => url.pathname === "/api/posts",
  async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = JSON.parse(route.request().postData() ?? "{}");
    scheduleRequests.push(body);
    await route.fulfill({ json: { id: "row-e2e", status: "scheduled" } });
  },
);

const page = await context.newPage();
await page.goto(`${BASE}/api/dev/login`, { waitUntil: "domcontentloaded" });
await page.waitForURL(/\/studio/, { timeout: 30_000 });

// ---------------------------------------------------------------- check A
await page.goto(`${BASE}/studio/accounts`, { waitUntil: "domcontentloaded" });
await page.getByText("+ Connect LinkedIn", { exact: false }).first().waitFor({ timeout: 30_000 });
await shot(page, "a-accounts-connect-cards");

const urlBefore = page.url();
const [popup] = await Promise.all([
  context.waitForEvent("page", { timeout: 15_000 }),
  page.getByText("+ Connect X", { exact: false }).first().click(),
]);
await popup.waitForLoadState("domcontentloaded");
const urlAfter = page.url();

assert(urlBefore === urlAfter, "A1 the page you were on is never navigated away",
  `original stayed at ${urlAfter}`);
assert(popup.url() === `${BASE}/api/connections/x?returnTo=%2Fstudio%2Faccounts`,
  "A2 Connect opens a NEW tab carrying returnTo",
  `popup opened at ${popup.url()}`);
const opener = await popup.evaluate(() => window.opener);
assert(opener === null, "A3 the new tab holds no handle back",
  `window.opener in the new tab === ${JSON.stringify(opener)}`);
assert(!page.isClosed(), "A4 the original tab is still open", "page.isClosed() === false");
await popup.close();

// The server half of the flight, over plain HTTP (no browser route stubs).
const cookies = await context.cookies(BASE);
const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
const raw = await fetch(`${BASE}/api/connections/x?returnTo=%2Fstudio%2Fc%2Fabc123`, {
  headers: { cookie: cookieHeader }, redirect: "manual",
});
const flightOf = (response) => {
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith("sl_oauth="));
  const value = decodeURIComponent(cookie.split(";")[0].slice("sl_oauth=".length));
  return b64urlJson(value.split(".")[0]);
};
const flight = flightOf(raw);
assert(raw.status === 307 && (raw.headers.get("location") ?? "").includes("x.com"),
  "A5 the real connect route redirects into the platform",
  `${raw.status} -> ${(raw.headers.get("location") ?? "").slice(0, 60)}...`);
assert(flight.returnTo === "/studio/c/abc123",
  "A6 the signed flight cookie carries returnTo",
  `flight.returnTo === ${JSON.stringify(flight.returnTo)}`);

// A hostile returnTo must never survive into the flight.
const hostile = await fetch(`${BASE}/api/connections/x?returnTo=${encodeURIComponent("https://evil.test/x")}`, {
  headers: { cookie: cookieHeader }, redirect: "manual",
});
const hostileFlight = flightOf(hostile);
assert(hostileFlight.returnTo === undefined,
  "A7 an off-site returnTo is dropped by the server",
  `flight.returnTo === ${JSON.stringify(hostileFlight.returnTo)}`);

// ---------------------------------------------------------------- check B
const instrument = async (p) => p.evaluate(() => {
  window.__signals = [];
  const bc = new BroadcastChannel("shapeless-connections");
  bc.onmessage = () => window.__signals.push("broadcast");
  window.addEventListener("storage", (e) => {
    if (e.key === "shapeless:connections-changed") window.__signals.push("storage");
  });
  window.addEventListener("focus", () => window.__signals.push("focus"));
});

await page.goto(`${BASE}/studio/accounts`, { waitUntil: "domcontentloaded" });
await page.getByText("+ Connect LinkedIn", { exact: false }).first().waitFor({ timeout: 30_000 });
await instrument(page);
const hadHandleBefore = await page.getByText("@local-review", { exact: false }).count();
const fetchesBefore = connectionFetches;

// The connect lands in its own tab, exactly as the OAuth callback would.
connections = [CONNECTION];
const landing = await context.newPage();
await landing.goto(`${BASE}/connected?connected=linkedin&to=%2Fstudio%2Faccounts`, { waitUntil: "domcontentloaded" });
await landing.waitForURL(`${BASE}/studio/accounts`, { timeout: 15_000 });

await page.getByText("@local-review", { exact: false }).first().waitFor({ timeout: 15_000 });
const signals = await page.evaluate(() => window.__signals);

assert(hadHandleBefore === 0, "B1 the original tab showed no connection before the connect",
  `matches for "@local-review" before === ${hadHandleBefore}`);
assert(signals.includes("broadcast"), "B2 the BroadcastChannel signal reaches the original tab",
  `window.__signals === ${JSON.stringify(signals)}`);
assert(connectionFetches > fetchesBefore, "B3 the original tab re-fetched /api/connections",
  `GET /api/connections count ${fetchesBefore} -> ${connectionFetches}`);
assert((await page.getByText("@local-review", { exact: false }).count()) > 0,
  "B4 the original tab's connection list re-rendered with the new account",
  `"@local-review" is now on the accounts screen`);
assert(landing.url() === `${BASE}/studio/accounts`,
  "B5 the landing hands the new tab back to returnTo",
  `landing ended at ${landing.url()}`);
await shot(page, "b-accounts-after-connect");

// The landing page itself, held still so it can be seen.
// The landing redirects in a blink, so it is photographed in a context with
// scripting off: the same server-rendered page, with the effect that leaves it
// never running.
const stillContext = await browser.newContext({
  viewport: { width: 1440, height: 1200 },
  deviceScaleFactor: 2,
  javaScriptEnabled: false,
});
const landingShot = await stillContext.newPage();
await landingShot.goto(`${BASE}/connected?connected=linkedin&to=%2Fstudio%2Faccounts`, { waitUntil: "domcontentloaded" });
await landingShot.getByText("connected", { exact: false }).first().waitFor({ timeout: 15_000 });
await shot(landingShot, "b-connected-landing");
await stillContext.close();
await landing.close();

// B6: with BroadcastChannel absent, the localStorage stamp still delivers.
const noBc = await context.newPage();
await noBc.addInitScript(() => {
  Object.defineProperty(window, "BroadcastChannel", { value: undefined, configurable: true });
});
connections = [];
await noBc.goto(`${BASE}/studio/accounts`, { waitUntil: "domcontentloaded" });
await noBc.getByText("+ Connect LinkedIn", { exact: false }).first().waitFor({ timeout: 30_000 });
connections = [CONNECTION];
const stamper = await context.newPage();
await stamper.goto(`${BASE}/connected?connected=linkedin&to=%2Fstudio%2Faccounts`, { waitUntil: "domcontentloaded" });
let stampSeen = true;
await noBc.getByText("@local-review", { exact: false }).first().waitFor({ timeout: 15_000 }).catch(() => { stampSeen = false; });
assert(stampSeen, "B6 without BroadcastChannel the storage stamp still refreshes the tab",
  `the account appeared in a tab whose window.BroadcastChannel is undefined`);
await stamper.close();
await noBc.close();

// ---------------------------------------------------------------- checks C + D
connections = [CONNECTION];
await page.goto(`${BASE}/studio/c/${CONVERSATION_ID}`, { waitUntil: "domcontentloaded" });
await page.getByText("Footage", { exact: false }).first().waitFor({ timeout: 30_000 });

for (const label of ["Earlier renders", "Footage", "Voiceover", "Captions", "Script", "Published"]) {
  const group = page.locator("section").filter({ has: page.getByText(new RegExp(`^${label}( · \\d+)?$`)) });
  assert((await group.count()) > 0, `D1 the shelf shows "${label}"`,
    `a shelf group labelled "${label}" is on screen`);
}
assert((await page.getByText(/^Footage · 3$/).count()) > 0,
  "D2 the shelf counts a group with more than one artifact", `the group reads "Footage · 3"`);
// The shelf itself: span("Earlier renders") -> its section -> the shelf grid.
const shelf = page.getByText(/^Earlier renders$/).locator("xpath=../..");
assert((await shelf.locator('[aria-label="Launch short - take 1"]').count()) === 1,
  "D3a the superseded render lands on the shelf",
  `1 tile inside the shelf with aria-label "Launch short - take 1"`);
assert((await shelf.locator('[aria-label="Launch short - take 2"]').count()) === 0
  && (await page.locator('[aria-label="Launch short - take 2"]').count()) === 1,
  "D3b the newest take stays in the payoff and never doubles onto the shelf",
  `"Launch short - take 2" appears once on the page and zero times inside the shelf`);
assert((await page.getByText("Shot list v1", { exact: false }).count()) === 0,
  "D3c a spec whose render is on screen is not repeated as an artifact",
  `0 matches for the spec title "Shot list v1"`);
await page.locator("audio").first().waitFor({ timeout: 10_000 });
assert((await page.locator("audio").count()) === 1,
  "D4 the voiceover is playable on the shelf", `1 <audio> element rendered`);
assert((await page.getByText("00:03 Here is what that actually took.", { exact: false }).count()) > 0,
  "D5 the caption track's own lines are on the shelf", `the second caption line is on screen`);
assert((await page.getByRole("link", { name: /Posted to X/ }).getAttribute("href")) === "https://x.com/shapelessai/status/1234567890",
  "D6 a publish receipt links out to the live post", `the receipt href is the published URL`);
await shot(page, "d-artifact-shelf", page.getByText(/^Earlier renders$/));

// Check C: Enter in the schedule field commits.
await page.getByRole("button", { name: "Schedule", exact: true }).first().click();
const timeField = page.getByLabel("When to publish");
await timeField.waitFor({ timeout: 10_000 });
const when = new Date(Date.now() + 26 * 3600_000);
const pad = (n) => String(n).padStart(2, "0");
const local = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
await timeField.fill(local);
await shot(page, "c-schedule-form", timeField);
scheduleRequests = [];
await timeField.press("Enter");
await page.waitForFunction(() => true);
await page.waitForTimeout(1500);

assert(scheduleRequests.length === 1, "C1 Enter in the time field commits the schedule",
  `exactly ${scheduleRequests.length} POST /api/posts fired from a keypress, no click`);
assert(scheduleRequests[0]?.scheduledAt === new Date(local).toISOString(),
  "C2 the committed schedule carries the time that was typed",
  `scheduledAt === ${scheduleRequests[0]?.scheduledAt} for typed ${local}`);
assert((await page.getByText("Scheduled", { exact: false }).count()) > 0,
  "C3 the card moves to its scheduled state", `"Scheduled" is on the card`);
await shot(page, "c-schedule-committed", page.getByText("Scheduled", { exact: false }).first());

// C4: the form never navigates - a GET-submitted form would put the fields in the URL.
assert(page.url() === `${BASE}/studio/c/${CONVERSATION_ID}`,
  "C4 committing never navigates the page", `still at ${page.url()}`);

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
await browser.close();
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
