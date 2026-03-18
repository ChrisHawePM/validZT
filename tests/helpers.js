/**
 * Set the textarea value and trigger an input event so validation runs.
 */
export async function setTextareaValue(page, text) {
  await page.evaluate((t) => {
    const ta = document.getElementById('textarea');
    ta.value = t;
    ta.dispatchEvent(new Event('input'));
  }, text);
}

/**
 * Get the current state (active/done/pending) of a pipeline step (1, 2, or 3).
 */
export async function getStepState(page, stepNum) {
  return page.evaluate((n) => {
    const el = document.querySelector(`[data-step="${n}"]`);
    if (!el) return null;
    return {
      active: el.classList.contains('active'),
      done: el.classList.contains('done'),
      pending: el.classList.contains('pending'),
    };
  }, stepNum);
}

/**
 * Get the status text content.
 */
export async function getStatusText(page) {
  return page.textContent('#status-text');
}
