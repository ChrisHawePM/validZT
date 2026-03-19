'use strict';

// ─── Character rules ──────────────────────────────────────────────────────────
// zt.ru rejects or silently garbles certain Unicode characters when a letter is
// submitted. This table lists every known problem character, tested against the
// live system (2026-03-11). Characters in "replacements" are swapped for a safe
// equivalent; characters in "deleteChars" are removed entirely.
// All of this runs locally in your browser — your text is never sent anywhere.
const CHAR_RULES = {
  replacements: {
    '\u2212': '-',      // minus sign → hyphen
    '\u20BD': ' \u0440\u0443\u0431.',  // ruble sign → "руб."
    '\u2033': '"',      // double prime → straight quote
    '\u2009': ' ',      // thin space → regular space
    '\u2003': ' ',      // em space → regular space
    '\u2002': ' ',      // en space → regular space
    '\t':     ' ',      // tab → regular space
  },
  deleteChars: [
    '\u200B', // zero-width space
    '\u200C', // zero-width non-joiner
    '\u200D', // zero-width joiner
    '\uFEFF', // byte order mark
    '\uFE0F', // variation selector
    '\uFE0E', // text variation selector
  ],
  emojiPattern: /(?![\u00A9\u00AE\u2122])[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu,
};

// ─── Page estimation ──────────────────────────────────────────────────────────
// zt.ru splits letters into pages based on the rendered pixel height of the text.
// This function estimates how many pages your letter will occupy so you can plan
// before submitting. It counts characters, weighs Cyrillic vs Latin width, and
// applies the same line-wrapping logic the zt.ru renderer uses.
//
// Two delivery formats exist:
//   ZT  (proportional) — standard delivery, proportional font, 29 lines/page.
//   ПР  (monospace)    — Почта России delivery, monospace font, 38 lines/page.
//
// Constants validated against 5 real zt.ru PDFs (2026-03-03 to 2026-03-16).
// Important: the formula expects paragraph-level line breaks only — do not
// manually wrap lines within a paragraph or the page count will be overstated.
//
// Your text is processed entirely in this browser tab. Nothing is transmitted.
const FORMATS = {
  proportional: { PAGE_LINES: 29, LINE_COST: 89, EN_CHAR_COST: 0.818 },
  monospace:    { PAGE_LINES: 38, LINE_COST: 65, EN_CHAR_COST: 1.0   },
};

let currentFormat = localStorage.getItem('zt-format') || 'proportional';

function estimatePages(text) {
  if (!text) return { pages: 0, lines: 0 };
  const { PAGE_LINES, LINE_COST, EN_CHAR_COST } = FORMATS[currentFormat];
  const PAGE_COST = PAGE_LINES * LINE_COST;
  let totalCost = 0;
  const paragraphs = text.split('\n');
  for (const p of paragraphs) {
    if (p.length === 0) {
      totalCost += LINE_COST;
    } else {
      let pCost = 0;
      for (const ch of p) {
        pCost += (ch >= '\u0400' && ch <= '\u04FF') ? 1.0 : EN_CHAR_COST;
      }
      totalCost += Math.ceil(pCost / LINE_COST) * LINE_COST;
    }
  }
  return {
    pages: Math.ceil(totalCost / PAGE_COST),
    lines: Math.round(totalCost / LINE_COST),
  };
}

// ─── Validation lookups ───────────────────────────────────────────────────────
// Converts the rules above into fast lookup structures (Map and Set) so that
// checking each character is as quick as possible even for long letters.
function buildLookups() {
  return {
    replaceMap: new Map(Object.entries(CHAR_RULES.replacements)),
    deleteSet: new Set(CHAR_RULES.deleteChars),
  };
}

const lookups = buildLookups();

// ─── Text validation ──────────────────────────────────────────────────────────
// Scans the text and returns a list of every problem character with its position.
// This list drives both the red/orange highlights in the editor and the status
// message ("Found N invalid characters"). Nothing leaves your device.
function validateText(text) {
  const results = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (lookups.replaceMap.has(ch)) {
      results.push({ index: i, char: ch, codepoint: ch.codePointAt(0), type: 'replace' });
    } else if (lookups.deleteSet.has(ch)) {
      results.push({ index: i, char: ch, codepoint: ch.codePointAt(0), type: 'delete' });
    }
  }
  if (CHAR_RULES.emojiPattern) {
    CHAR_RULES.emojiPattern.lastIndex = 0;
    let match;
    while ((match = CHAR_RULES.emojiPattern.exec(text)) !== null) {
      if (!results.some((r) => r.index === match.index)) {
        results.push({ index: match.index, char: match[0], codepoint: match[0].codePointAt(0), type: 'delete', length: match[0].length });
      }
    }
  }
  results.sort((a, b) => a.index - b.index);
  return results;
}

// ─── Sanitization (auto-fix) ──────────────────────────────────────────────────
// Applies all replacements and deletions in one pass, producing a clean copy of
// the text that zt.ru will accept. Also records exactly what changed so the
// editor can highlight the fixed spots in green/grey for review.
function applyFixes(text) {
  const invalid = validateText(text);
  if (invalid.length === 0) return { fixedText: text, changes: [] };

  const skipIndices = new Map();
  for (const inv of invalid) {
    const len = inv.length || inv.char.length;
    for (let j = 0; j < len; j++) skipIndices.set(inv.index + j, inv);
  }

  const changes = [];
  const fixedChars = [];
  let offset = 0;
  let i = 0;

  while (i < text.length) {
    const inv = skipIndices.get(i);
    if (inv && inv.index === i) {
      const len = inv.length || inv.char.length;
      if (inv.type === 'replace') {
        const replacement = lookups.replaceMap.get(inv.char);
        changes.push({ index: offset, original: inv.char, replacement, type: 'substitution' });
        for (const c of replacement) { fixedChars.push(c); offset++; }
      } else {
        changes.push({ index: offset, original: inv.char, replacement: '', type: 'deletion' });
      }
      i += len;
    } else if (skipIndices.has(i)) {
      i++;
    } else {
      fixedChars.push(text[i]);
      offset++;
      i++;
    }
  }

  return { fixedText: fixedChars.join(''), changes };
}

// ─── Undo stack ───────────────────────────────────────────────────────────────
// Keeps up to 20 snapshots of the text so the user can undo fixes one step at a
// time. Snapshots are plain strings stored in memory only — cleared when the
// page is closed, never written to disk or sent anywhere.
const MAX_UNDO = 20;
const undoStack = [];
function pushUndo(text) { undoStack.push(text); if (undoStack.length > MAX_UNDO) undoStack.shift(); }
function popUndo() { return undoStack.pop(); }
function canUndo() { return undoStack.length > 0; }

// ─── DOM references ───────────────────────────────────────────────────────────
// Grab the HTML elements we need to interact with. All processing happens here
// in the browser — these are the only inputs and outputs the app uses.
const textarea = document.getElementById('textarea');
const overlay = document.getElementById('overlay');
const statusText = document.getElementById('status-text');
const charCount = document.getElementById('char-count');
const btnPaste = document.getElementById('btn-paste');
const btnFix = document.getElementById('btn-fix');
const btnCopy = document.getElementById('btn-copy');
const btnUndo = document.getElementById('btn-undo');
const btnReset = document.getElementById('btn-reset');
const btnFormat = document.getElementById('btn-format');
const btnInfo = document.getElementById('btn-info');
const btnPwa = document.getElementById('btn-pwa');
const infoModal = document.getElementById('info-modal');
const pwaModal = document.getElementById('pwa-modal');
const toast = document.getElementById('toast');
const btnExample = document.getElementById('btn-example');
const emptyHint = document.getElementById('empty-hint');
const editorContainer = document.querySelector('.editor-container');
const steps = [
  document.querySelector('[data-step="1"]'),
  document.querySelector('[data-step="2"]'),
  document.querySelector('[data-step="3"]'),
];

// Example text: full About page with invalid characters sprinkled in for demo.
// Invalid chars: \u20BD (ruble sign), \u2212 (minus), \u2033 (double prime),
// \u2009 (thin space), \u200B (zero-width space), emoji.
const EXAMPLE_TEXT = 'validZT \u2212 \u044D\u0442\u043E \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0434\u043B\u044F \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u0438 \u043E\u0447\u0438\u0441\u0442\u043A\u0438 \u0442\u0435\u043A\u0441\u0442\u0430 \u043F\u0435\u0440\u0435\u0434 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u043E\u0439 \u043F\u0438\u0441\u044C\u043C\u0430 \u0447\u0435\u0440\u0435\u0437 zt.ru.\n\n\u041A\u0430\u043A \u044D\u0442\u043E \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442:\nzt.ru \u043E\u0442\u043A\u043B\u043E\u043D\u044F\u0435\u0442 \u0438\u043B\u0438 \u0438\u0441\u043A\u0430\u0436\u0430\u0435\u0442 \u043D\u0435\u043A\u043E\u0442\u043E\u0440\u044B\u0435 Unicode\u2212\u0441\u0438\u043C\u0432\u043E\u043B\u044B, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0432\u044B\u0433\u043B\u044F\u0434\u044F\u0442 \u043D\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u043E \u0432 \u043B\u044E\u0431\u043E\u043C \u0440\u0435\u0434\u0430\u043A\u0442\u043E\u0440\u0435. \u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, \u0437\u043D\u0430\u043A \u0440\u0443\u0431\u043B\u044F \u20BD, \u043C\u0438\u043D\u0443\u0441 \u0432\u043C\u0435\u0441\u0442\u043E \u0434\u0435\u0444\u0438\u0441\u0430, \u043F\u0440\u043E\u0431\u0435\u043B\u044B\u2009\u043D\u0435\u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043D\u043E\u0439 \u0448\u0438\u0440\u0438\u043D\u044B \u0438 \u044D\u043C\u043E\u0434\u0437\u0438 \uD83D\uDE2D. validZT \u043D\u0430\u0445\u043E\u0434\u0438\u0442 \u0442\u0430\u043A\u0438\u0435 \u0441\u0438\u043C\u0432\u043E\u043B\u044B, \u043F\u043E\u0434\u0441\u0432\u0435\u0447\u0438\u0432\u0430\u0435\u0442 \u0438\u0445 \u0438 \u0437\u0430\u043C\u0435\u043D\u044F\u0435\u0442 \u043D\u0430 \u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u044B\u0435 \u0430\u043D\u0430\u043B\u043E\u0433\u0438 \u043E\u0434\u043D\u043E\u0439 \u043A\u043D\u043E\u043F\u043A\u043E\u0439.\n\n\u041A\u0430\u043A \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C\u0441\u044F:\n1. \u0412\u0441\u0442\u0430\u0432\u044C\u0442\u0435 \u0442\u0435\u043A\u0441\u0442 \u043A\u043D\u043E\u043F\u043A\u043E\u0439 \u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0438\u043B\u0438 \u0447\u0435\u0440\u0435\u0437 Ctrl+V.\n2. \u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u0418\u0441\u043F\u0440\u0430\u0432\u0438\u0442\u044C\u200B \u2212 \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u043D\u044B\u0435 \u0441\u0438\u043C\u0432\u043E\u043B\u044B \u0431\u0443\u0434\u0443\u0442 \u0437\u0430\u043C\u0435\u043D\u0435\u043D\u044B.\n3. \u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u041A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0438 \u0432\u0441\u0442\u0430\u0432\u044C\u0442\u0435 \u0433\u043E\u0442\u043E\u0432\u044B\u0439 \u0442\u0435\u043A\u0441\u0442 \u0432 zt.ru.\n\n\u041A\u043E\u043D\u0444\u0438\u0434\u0435\u043D\u0446\u0438\u0430\u043B\u044C\u043D\u043E\u0441\u0442\u044C:\n\u0422\u0435\u043A\u0441\u0442 \u043D\u0435 \u043F\u043E\u043A\u0438\u0434\u0430\u0435\u0442 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u043E. \u041F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u043F\u043E\u043B\u043D\u043E\u0441\u0442\u044C\u044E \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435, \u043D\u0438\u043A\u0430\u043A\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u043D\u0435 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0442\u0441\u044F \u043D\u0430 \u0441\u0435\u0440\u0432\u0435\u0440. \u041F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0432\u043E\u0433\u043E \u043E\u0442\u043A\u0440\u044B\u0442\u0438\u044F \u0432\u0441\u0435 \u0444\u0430\u0439\u043B\u044B \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u044E\u0442\u0441\u044F \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E \u0438 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0431\u0435\u0437 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442\u0430 (PWA). \u041C\u043E\u0436\u043D\u043E \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u043A\u0430\u043A \u043E\u0431\u044B\u0447\u043D\u043E\u0435 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u2212 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \u043A\u043D\u043E\u043F\u043A\u0443 \u2708 offline.\n\n\u0412\u0430\u0436\u043D\u043E:\n\u041E\u0446\u0435\u043D\u043A\u0430 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446 \u0438 \u0441\u043F\u0438\u0441\u043E\u043A \u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u044B\u0445 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432 \u043C\u043E\u0433\u0443\u0442 \u043D\u0435 \u0431\u044B\u0442\u044C 100% \u0442\u043E\u0447\u043D\u044B\u043C\u0438, \u0442\u0430\u043A \u043A\u0430\u043A zt.ru \u043C\u043E\u0436\u0435\u0442 \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0441\u0432\u043E\u0438 \u043F\u0440\u0430\u0432\u0438\u043B\u0430. \u0420\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0443\u0435\u043C \u0432\u0441\u0435\u0433\u0434\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u0442\u044C \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u043D\u0430 \u0441\u0442\u043E\u0440\u043E\u043D\u0435 zt.ru \u043F\u0435\u0440\u0435\u0434 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u043E\u0439.\n\n\u0412\u043E\u043F\u0440\u043E\u0441\u044B \u0438 \u043E\u0448\u0438\u0431\u043A\u0438:\n\u0415\u0441\u043B\u0438 \u0432\u044B \u043D\u0430\u0448\u043B\u0438 \u043E\u0448\u0438\u0431\u043A\u0443 \u0438\u043B\u0438 \u0441\u0438\u043C\u0432\u043E\u043B, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u0435\u0442\u0441\u044F \u0438\u043B\u0438 \u0437\u0430\u043C\u0435\u043D\u044F\u0435\u0442\u0441\u044F \u043D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u043E, \u043D\u0430\u043F\u0438\u0448\u0438\u0442\u0435 \u043D\u0430 validZT@pm.me. \u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043A\u0430\u043A\u043E\u0439 \u0441\u0438\u043C\u0432\u043E\u043B \u0432\u044B\u0437\u0432\u0430\u043B \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u0443 \u0438 \u0447\u0442\u043E \u043F\u0440\u043E\u0438\u0437\u043E\u0448\u043B\u043E \u043D\u0430 \u0441\u0442\u043E\u0440\u043E\u043D\u0435 zt.ru \u2212 \u044D\u0442\u043E \u043F\u043E\u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0441\u0442\u0440\u043E \u0438\u0441\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u0443.\n\n\u042D\u0442\u043E\u0442 \u0442\u0435\u043A\u0441\u0442 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u043F\u0440\u0438\u043C\u0435\u0440\u044B \u043D\u0435\u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u044B\u0445 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432 (\u043C\u0438\u043D\u0443\u0441, \u0437\u043D\u0430\u043A \u0440\u0443\u0431\u043B\u044F, \u0442\u043E\u043D\u043A\u0438\u0439 \u043F\u0440\u043E\u0431\u0435\u043B, \u044D\u043C\u043E\u0434\u0437\u0438). \u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u0418\u0441\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0447\u0442\u043E\u0431\u044B \u0443\u0432\u0438\u0434\u0435\u0442\u044C \u043A\u0430\u043A \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430.';

let lastDiffChanges = null;

// ─── Pipeline state ──────────────────────────────────────────────────────────
// Updates the visual step indicators (1→2→3) based on the current app state.
// Each step can be active (current action), done (completed), or pending (not yet).
function updatePipelineState(hasText, hasErrors) {
  // Determine step states
  const states = !hasText
    ? ['active', 'pending', 'pending']
    : hasErrors
      ? ['done', 'active', 'pending']
      : ['done', 'done', 'active'];

  steps.forEach((step, i) => {
    step.classList.remove('active', 'done', 'pending');
    step.classList.add(states[i]);
  });

  // Empty hint visibility
  emptyHint.classList.toggle('hidden', hasText);

  // Button enable/disable
  btnFix.disabled = !hasErrors;
  btnCopy.disabled = !hasText;

  // Editor border state
  editorContainer.classList.toggle('has-errors', hasText && hasErrors);
  editorContainer.classList.toggle('is-clean', hasText && !hasErrors);
}

// ─── Overlay rendering ────────────────────────────────────────────────────────
// The editor has two layers: a visible textarea where you type, and a hidden
// overlay div directly behind it with identical font and size. The overlay
// renders coloured <mark> spans at the exact positions of problem characters,
// creating the highlight effect without interfering with editing.

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderOverlay(text, invalidChars, diffChanges) {
  if (!text) { overlay.innerHTML = ''; return; }

  const marks = new Map();

  if (diffChanges) {
    for (const change of diffChanges) {
      if (change.type === 'substitution') {
        for (let j = 0; j < change.replacement.length; j++) {
          marks.set(change.index + j, { cls: 'substitution', length: 1 });
        }
      } else if (change.type === 'deletion') {
        marks.set(change.index, { cls: 'deletion-marker', length: 0 });
      }
    }
  } else {
    for (const inv of invalidChars) {
      const len = inv.length || inv.char.length;
      marks.set(inv.index, { cls: 'invalid', length: len });
      for (let j = 1; j < len; j++) marks.set(inv.index + j, { cls: 'skip' });
    }
  }

  let html = '';
  for (let i = 0; i < text.length; i++) {
    const m = marks.get(i);
    if (m && m.cls === 'skip') continue;
    if (m && m.cls === 'deletion-marker') {
      html += '<mark class="deletion">\u00B7</mark>' + escapeHtml(text[i]);
    } else if (m && m.length > 1) {
      html += '<mark class="' + m.cls + '">' + escapeHtml(text.slice(i, i + m.length)) + '</mark>';
      i += m.length - 1;
    } else if (m) {
      html += '<mark class="' + m.cls + '">' + escapeHtml(text[i]) + '</mark>';
    } else {
      html += escapeHtml(text[i]);
    }
  }

  if (text.endsWith('\n')) html += '\n';
  overlay.innerHTML = html;
}

function updateValidation() {
  const text = textarea.value;
  const invalid = validateText(text);
  renderOverlay(text, invalid, lastDiffChanges || null);

  const count = invalid.length;
  const hasText = text.length > 0;
  const hasErrors = hasText && count > 0 && !lastDiffChanges;

  // Status text + color
  statusText.classList.remove('status-error', 'status-success');
  if (lastDiffChanges) {
    statusText.textContent = 'Исправления применены';
    statusText.classList.add('status-success');
  } else if (count > 0) {
    statusText.textContent = 'Найдено недопустимых символов: ' + count;
    statusText.classList.add('status-error');
  } else if (hasText) {
    statusText.textContent = 'Текст в порядке';
    statusText.classList.add('status-success');
  } else {
    statusText.textContent = 'Готово';
  }

  if (hasText) {
    const est = estimatePages(text);
    charCount.textContent = text.length + ' симв. | ~' + est.pages + ' стр. (~' + est.lines + ' строк)';
  } else {
    charCount.textContent = '';
  }

  btnUndo.disabled = !canUndo();
  updatePipelineState(hasText, hasErrors);
}

// Keep overlay scroll and size in sync with the textarea at all times.
textarea.addEventListener('scroll', () => {
  overlay.scrollTop = textarea.scrollTop;
  overlay.scrollLeft = textarea.scrollLeft;
});

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    overlay.style.width = textarea.offsetWidth + 'px';
    overlay.style.height = textarea.offsetHeight + 'px';
  }).observe(textarea);
}

// Clear diff highlights when the user edits manually after a fix.
textarea.addEventListener('input', () => {
  lastDiffChanges = null;
  updateValidation();
});

// ─── Toast notifications ──────────────────────────────────────────────────────
// Briefly shows a small message at the bottom of the screen (e.g. "Copied!").
function showToast(msg) {
  toast.textContent = msg;
  toast.hidden = false;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toast.hidden = true; }, 300);
  }, 1500);
}

// ─── Button handlers ──────────────────────────────────────────────────────────
// All clipboard access (paste / copy) happens only when the user explicitly
// clicks a button — the app never reads your clipboard in the background.

btnPaste.addEventListener('click', async () => {
  try {
    textarea.blur();
    const clip = await navigator.clipboard.readText();
    pushUndo(textarea.value);
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    textarea.value = before + clip + after;
    textarea.selectionStart = textarea.selectionEnd = start + clip.length;
    lastDiffChanges = null;
    updateValidation();
    textarea.focus();
  } catch {
    showToast('Нет доступа к буферу. Используйте Ctrl+V');
  }
});

btnFix.addEventListener('click', () => {
  const text = textarea.value;
  if (!text) return;
  const { fixedText, changes } = applyFixes(text);
  if (changes.length === 0) { showToast('Нечего исправлять'); return; }
  pushUndo(text);
  textarea.value = fixedText;
  lastDiffChanges = changes;
  updateValidation();
});

btnCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(textarea.value);
    btnCopy.classList.add('flash-success');
    const origHTML = btnCopy.innerHTML;
    btnCopy.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Скопировано';
    setTimeout(() => {
      btnCopy.classList.remove('flash-success');
      btnCopy.innerHTML = origHTML;
    }, 1500);
  } catch {
    showToast('Не удалось скопировать');
  }
});

btnUndo.addEventListener('click', () => {
  if (!canUndo()) return;
  textarea.value = popUndo();
  lastDiffChanges = null;
  updateValidation();
});

btnExample.addEventListener('click', () => {
  pushUndo(textarea.value);
  textarea.value = EXAMPLE_TEXT;
  lastDiffChanges = null;
  updateValidation();
  textarea.focus();
});

btnReset.addEventListener('click', () => {
  if (!textarea.value) return;
  pushUndo(textarea.value);
  textarea.value = '';
  lastDiffChanges = null;
  updateValidation();
});

// Modal open/close
btnInfo.addEventListener('click', () => { infoModal.hidden = false; });
btnPwa.addEventListener('click', () => { pwaModal.hidden = false; });

for (const modal of [infoModal, pwaModal]) {
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.classList.contains('modal-close')) {
      modal.hidden = true;
    }
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { infoModal.hidden = true; pwaModal.hidden = true; }
});

// ─── Format toggle ────────────────────────────────────────────────────────────
// Switches between ZT (standard proportional delivery) and ПР (monospace Почта России
// delivery). The choice is saved in localStorage so it persists across sessions.
// Only the label string changes — no format preference is ever transmitted.
function updateFormatBtn() {
  if (currentFormat === 'monospace') {
    btnFormat.textContent = 'ПР';
    btnFormat.classList.add('active');
  } else {
    btnFormat.textContent = 'ZT';
    btnFormat.classList.remove('active');
  }
}

btnFormat.addEventListener('click', () => {
  currentFormat = currentFormat === 'proportional' ? 'monospace' : 'proportional';
  localStorage.setItem('zt-format', currentFormat);
  updateFormatBtn();
  updateValidation();
});

updateFormatBtn();
updateValidation();
