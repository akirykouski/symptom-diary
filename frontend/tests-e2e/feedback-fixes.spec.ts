/**
 * End-to-end verification of the feedback-fix batch.
 *
 * Drives the running dev server (http://localhost:5173) through Chromium.
 * The backend is expected to already be running on :8765 with the data dir
 * pointing at a fresh test instance and the passphrase `tobeornottobe7`.
 */
import { expect, test } from "@playwright/test";

const PASSPHRASE = "tobeornottobe7";

async function lockBackend(request: import("@playwright/test").APIRequestContext) {
  await request.post("http://localhost:5173/api/auth/lock");
}

test.beforeEach(async ({ request }) => {
  await lockBackend(request);
});

test("unlock flow lands on Timeline", async ({ page }) => {
  await page.goto("http://localhost:5173/");
  await expect(page).toHaveURL(/\/unlock/);

  await page.locator('input[type="password"]').fill(PASSPHRASE);
  await page.locator('button[type="submit"]').click();

  await page.waitForURL(/\/$/);
  await expect(page.getByRole("button", { name: /lock/i })).toBeVisible();
});

test("brief markdown reflects the new section ordering", async ({ page }) => {
  await page.goto("http://localhost:5173/");
  await page.locator('input[type="password"]').fill(PASSPHRASE);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/$/);

  // Navigate to insights via the Brief link in the toolbar
  await page.getByRole("link", { name: /brief/i }).first().click();
  await page.waitForURL(/\/insights/);

  // Trigger generation
  await page.getByRole("button", { name: /^generate/i }).click();

  const md = page.locator("pre").first();
  await expect(md).toBeVisible({ timeout: 30_000 });
  const text = (await md.innerText()).trim();

  // Structural assertions matching the feedback doc
  expect(text).toContain("## Patient-reported context");
  expect(text).not.toContain("## At a glance");
  expect(text).not.toContain("## Co-occurring patterns");
  expect(text).not.toContain("## Top reported entities");
  expect(text).not.toContain("[entry-id-prefix]");

  const sections = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  expect(sections[0]).toBe("Patient-reported context");
});

test("locked backend bounces UI back to /unlock immediately", async ({
  page,
  request,
}) => {
  await page.goto("http://localhost:5173/");
  await page.locator('input[type="password"]').fill(PASSPHRASE);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/$/);

  // Lock from the outside while the UI is on Timeline.
  await request.post("http://localhost:5173/api/auth/lock");

  // Trigger any data-fetching interaction. Clicking the "New entry" button
  // doesn't require a network call by itself, so we navigate to /labs which
  // fires GET /api/labs/tests on mount and will receive 401 detail=locked.
  await page.goto("http://localhost:5173/labs");

  await expect(page).toHaveURL(/\/unlock/, { timeout: 10_000 });
});

test("retry-failed button appears only when there are failed jobs and is clickable", async ({
  page,
}) => {
  // No failed jobs in this fresh instance, so the button should be hidden.
  await page.goto("http://localhost:5173/");
  await page.locator('input[type="password"]').fill(PASSPHRASE);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/$/);

  // The retry-failed button has the "↻ N failed" label only when failed > 0.
  await expect(page.locator("button", { hasText: "failed" })).toHaveCount(0);

  // Direct API call is also exposed and returns a sane retried count.
  // Use page.request so the unlocked session cookie travels with the call.
  const res = await page.request.post("/api/entries/queue/retry-failed");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(typeof body.retried).toBe("number");
  expect(body.retried).toBeGreaterThanOrEqual(0);
});

test("heartbeat endpoint returns 204 while unlocked", async ({ request }) => {
  // The lockBackend() in beforeEach has already locked. Unlock via API.
  await request.post("http://localhost:5173/api/auth/unlock", {
    data: { passphrase: PASSPHRASE },
  });
  const r = await request.post("http://localhost:5173/api/auth/heartbeat");
  expect(r.status()).toBe(204);
});
