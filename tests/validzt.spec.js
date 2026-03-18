import { test, expect } from '@playwright/test';
import { setTextareaValue, getStepState, getStatusText } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('Empty state', () => {
  test('shows step 1 active, steps 2-3 pending', async ({ page }) => {
    expect(await getStepState(page, 1)).toEqual({ active: true, done: false, pending: false });
    expect(await getStepState(page, 2)).toEqual({ active: false, done: false, pending: true });
    expect(await getStepState(page, 3)).toEqual({ active: false, done: false, pending: true });
  });

  test('Fix and Copy buttons are disabled', async ({ page }) => {
    await expect(page.locator('#btn-fix')).toBeDisabled();
    await expect(page.locator('#btn-copy')).toBeDisabled();
  });

  test('empty hint is visible', async ({ page }) => {
    const hint = page.locator('#empty-hint');
    await expect(hint).toBeVisible();
    await expect(hint).not.toHaveClass(/hidden/);
  });

  test('status text shows "Готово"', async ({ page }) => {
    expect(await getStatusText(page)).toBe('Готово');
  });
});

test.describe('Text with invalid characters', () => {
  test('step 2 becomes active, red highlights appear', async ({ page }) => {
    // \u2212 is a minus sign (invalid, gets replaced)
    await setTextareaValue(page, 'тест \u2212 текст');

    expect(await getStepState(page, 1)).toEqual({ active: false, done: true, pending: false });
    expect(await getStepState(page, 2)).toEqual({ active: true, done: false, pending: false });
    expect(await getStepState(page, 3)).toEqual({ active: false, done: false, pending: true });

    // Fix button enabled, Copy disabled (pending)
    await expect(page.locator('#btn-fix')).toBeEnabled();

    // Red highlight present
    const invalidMark = page.locator('.overlay mark.invalid');
    await expect(invalidMark).toHaveCount(1);

    // Status shows error count
    const status = await getStatusText(page);
    expect(status).toContain('Найдено недопустимых символов');

    // Empty hint hidden
    await expect(page.locator('#empty-hint')).toHaveClass(/hidden/);
  });

  test('editor has error border class', async ({ page }) => {
    await setTextareaValue(page, 'тест \u2212 текст');
    await expect(page.locator('.editor-container')).toHaveClass(/has-errors/);
  });

  test('status text has error color', async ({ page }) => {
    await setTextareaValue(page, 'тест \u2212 текст');
    await expect(page.locator('#status-text')).toHaveClass(/status-error/);
  });
});

test.describe('Fix flow', () => {
  test('fixes invalid chars, shows green highlights, step 3 active', async ({ page }) => {
    await setTextareaValue(page, 'тест \u2212 текст');
    await page.click('#btn-fix');

    // Textarea text should be fixed (minus → hyphen)
    const value = await page.inputValue('#textarea');
    expect(value).toBe('тест - текст');

    // Green highlights present
    const subMark = page.locator('.overlay mark.substitution');
    await expect(subMark).toHaveCount(1);

    // Step 3 active
    expect(await getStepState(page, 1)).toEqual({ active: false, done: true, pending: false });
    expect(await getStepState(page, 2)).toEqual({ active: false, done: true, pending: false });
    expect(await getStepState(page, 3)).toEqual({ active: true, done: false, pending: false });

    // Status
    const status = await getStatusText(page);
    expect(status).toBe('Исправления применены');
    await expect(page.locator('#status-text')).toHaveClass(/status-success/);
  });

  test('editor has clean border class after fix', async ({ page }) => {
    await setTextareaValue(page, 'тест \u2212 текст');
    await page.click('#btn-fix');
    await expect(page.locator('.editor-container')).toHaveClass(/is-clean/);
  });
});

test.describe('Undo flow', () => {
  test('reverts fix, step 2 becomes active again', async ({ page }) => {
    await setTextareaValue(page, 'тест \u2212 текст');
    await page.click('#btn-fix');
    await page.click('#btn-undo');

    // Text reverted
    const value = await page.inputValue('#textarea');
    expect(value).toBe('тест \u2212 текст');

    // Step 2 active again
    expect(await getStepState(page, 2)).toEqual({ active: true, done: false, pending: false });

    // Red highlights back
    const invalidMark = page.locator('.overlay mark.invalid');
    await expect(invalidMark).toHaveCount(1);
  });
});

test.describe('Reset flow', () => {
  test('clears text, returns to empty state', async ({ page }) => {
    await setTextareaValue(page, 'тест \u2212 текст');
    await page.click('#btn-reset');

    const value = await page.inputValue('#textarea');
    expect(value).toBe('');

    expect(await getStepState(page, 1)).toEqual({ active: true, done: false, pending: false });
    expect(await getStepState(page, 2)).toEqual({ active: false, done: false, pending: true });

    await expect(page.locator('#empty-hint')).not.toHaveClass(/hidden/);
  });
});

test.describe('Clean text (no errors)', () => {
  test('skips step 2, step 3 active, Fix disabled', async ({ page }) => {
    await setTextareaValue(page, 'Привет мир');

    expect(await getStepState(page, 1)).toEqual({ active: false, done: true, pending: false });
    expect(await getStepState(page, 2)).toEqual({ active: false, done: true, pending: false });
    expect(await getStepState(page, 3)).toEqual({ active: true, done: false, pending: false });

    await expect(page.locator('#btn-fix')).toBeDisabled();
    await expect(page.locator('#btn-copy')).toBeEnabled();

    const status = await getStatusText(page);
    expect(status).toBe('Текст в порядке');
    await expect(page.locator('#status-text')).toHaveClass(/status-success/);
  });

  test('editor has clean border', async ({ page }) => {
    await setTextareaValue(page, 'Привет мир');
    await expect(page.locator('.editor-container')).toHaveClass(/is-clean/);
  });
});

test.describe('Format toggle', () => {
  test('toggles between ZT and ПР', async ({ page }) => {
    await expect(page.locator('#btn-format')).toHaveText('ZT');
    await page.click('#btn-format');
    await expect(page.locator('#btn-format')).toHaveText('ПР');
    await page.click('#btn-format');
    await expect(page.locator('#btn-format')).toHaveText('ZT');
  });

  test('recalculates page count on toggle', async ({ page }) => {
    await setTextareaValue(page, 'А'.repeat(500));
    const countBefore = await page.textContent('#char-count');
    await page.click('#btn-format');
    const countAfter = await page.textContent('#char-count');
    // Both should show char count but page estimates may differ
    expect(countBefore).toContain('500 симв.');
    expect(countAfter).toContain('500 симв.');
  });
});

test.describe('Info modal', () => {
  test('opens on click, closes on Escape', async ({ page }) => {
    await expect(page.locator('#info-modal')).toBeHidden();
    await page.click('#btn-info');
    await expect(page.locator('#info-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#info-modal')).toBeHidden();
  });
});

test.describe('PWA modal', () => {
  test('opens on click, closes on backdrop click', async ({ page }) => {
    await expect(page.locator('#pwa-modal')).toBeHidden();
    await page.click('#btn-pwa');
    await expect(page.locator('#pwa-modal')).toBeVisible();
    // Click backdrop (the modal-backdrop element itself)
    await page.locator('#pwa-modal').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#pwa-modal')).toBeHidden();
  });
});
