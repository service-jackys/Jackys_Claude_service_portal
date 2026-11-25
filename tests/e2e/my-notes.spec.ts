import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type Api = { puts: any[]; server: any };

async function signIn(page: Page, server: any = {}): Promise<Api> {
  const api: Api = {
    puts: [],
    server: {
      body: '',
      color: 'navy',
      width: 380,
      height: 340,
      tabPosition: 55,
      open: false,
      updatedAt: null,
      ...server,
    },
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/login') return json({ token: 't' });
    if (url.pathname === '/api/auth/me')
      return json({
        user: { id: '1', name: 'Tester', email: 'n@jackys.com', role: 'admin', permissions: ['*'] },
      });
    if (url.pathname === '/api/me/note') {
      if (request.method() === 'PUT') {
        const patch = request.postDataJSON();
        api.puts.push(patch);
        Object.assign(api.server, patch);
        return json(api.server);
      }
      return json(api.server);
    }
    return json({});
  });
  await page.goto('/portal/');
  await page.locator('#loginEmail').fill('n@jackys.com');
  await page.locator('#loginPassword').fill('local-password-1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#staff-workspace')).toBeVisible();
  return api;
}

test.describe('My notes floating panel', () => {
  test('opens from the tab, saves what is typed, colour and size, and survives navigation', async ({
    page,
  }) => {
    const api = await signIn(page);
    const tab = page.locator('#mnTab');
    await expect(tab).toBeVisible();
    await expect(page.locator('#mnPanel')).toHaveClass(/is-closed/);

    await tab.click();
    await expect(page.locator('#mnPanel')).not.toHaveClass(/is-closed/);
    await page.locator('#mnText').fill('Call JUMEIRAH COLLEGE back');
    await page.locator('[data-mn-color="teal"]').click();
    await expect.poll(() => api.puts.length).toBeGreaterThan(0);
    await expect.poll(() => api.server.body).toBe('Call JUMEIRAH COLLEGE back');
    await expect.poll(() => api.server.color).toBe('teal');
    await expect.poll(() => api.server.open).toBe(true);

    // Switch portal pages: the note stays.
    await page.locator('#newRequestNav').dispatchEvent('click');
    await expect(page.locator('#mnText')).toHaveValue('Call JUMEIRAH COLLEGE back');

    // Resize with the grip.
    const before = await page.locator('#mnPanel').boundingBox();
    const grip = (await page.locator('#mnGrip').boundingBox())!;
    await page.mouse.move(grip.x + 8, grip.y + 8);
    await page.mouse.down();
    await page.mouse.move(grip.x - 52, grip.y - 42, { steps: 4 });
    await page.mouse.up();
    const after = await page.locator('#mnPanel').boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width + 40);
    expect(after!.height).toBeGreaterThan(before!.height + 30);
    await expect.poll(() => api.server.width).toBeGreaterThan(420);

    // Minimise: back to the tab.
    await page.locator('#mnClose').click();
    await expect(tab).toBeVisible();
    await expect.poll(() => api.server.open).toBe(false);
  });

  test('the minimised tab can be dragged up and down the right edge', async ({ page }) => {
    const api = await signIn(page);
    const tab = page.locator('#mnTab');
    const box = (await tab.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 70);
    await page.mouse.down();
    await page.mouse.move(box.x + 20, box.y - 130, { steps: 6 });
    await page.mouse.up();
    const moved = (await tab.boundingBox())!;
    expect(moved.y).toBeLessThan(box.y - 100);
    await expect.poll(() => api.server.tabPosition).toBeLessThan(40);
    // A drag does not open the note.
    await expect(page.locator('#mnPanel')).toHaveClass(/is-closed/);
  });

  test('shows what the account saved on another computer and scrolls long notes', async ({
    page,
  }) => {
    await signIn(page, {
      body: Array.from({ length: 80 }, (_, i) => `Line ${i + 1}`).join('\n'),
      color: 'plum',
      open: true,
      updatedAt: '2026-11-25T09:00:00Z',
    });
    await expect(page.locator('#mnPanel')).not.toHaveClass(/is-closed/);
    await expect(page.locator('#mnText')).toHaveValue(/Line 80/);
    const scrolls = await page
      .locator('#mnText')
      .evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrolls).toBe(true);
    await expect(page.locator('[data-mn-color="plum"]')).toHaveAttribute('aria-pressed', 'true');
  });
});
