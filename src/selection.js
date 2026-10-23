// What the page gives us, shaped for the model.
//
// The checkpoint pauses where the punctuation says to. Firefox hands a selection over as flat
// text, so a heading without a full stop and the paragraph below it become one run-on sentence
// and the voice reads straight through. `readSelection` runs in the page and keeps the block
// structure; `prepareSpeechText` turns each block boundary into a sentence end the model can
// pause at. Newlines alone do not help: the runtime normalizes whitespace, but a period
// lengthens the pause after the word it follows.

const TERMINAL = /[.!?…]["'”’»)\]]*$/u;
const CLAUSE_END = /[,;:](["'”’»)\]]*)$/u;
const INVISIBLE = /[\u00ad\u200b\u200c\u200d\u2060\ufeff]/g;
const HAS_WORD = /[\p{L}\p{N}]/u;

/** End `text` like a sentence, unless it already is one. */
function asSentence(text) {
  if (TERMINAL.test(text)) return text;
  // A heading often ends in a colon or a semicolon; both are a pause inside a sentence, not
  // the end the next block needs.
  if (CLAUSE_END.test(text)) return text.replace(CLAUSE_END, ".$1");
  return text + ".";
}

/**
 * Turn one string per page block (or a plain string, split at its line breaks) into the text
 * to speak: whitespace collapsed, empty and content-free blocks dropped, each block that is
 * followed by another closed with sentence punctuation, blocks separated by a space. The last
 * block keeps its own ending, so a selection without a final full stop is not given one.
 *
 * @param {string | string[]} input
 * @returns {string}
 */
export function prepareSpeechText(input) {
  const blocks = (Array.isArray(input) ? input : String(input ?? "").split(/\r?\n/))
    .map((block) =>
      String(block ?? "")
        .replace(INVISIBLE, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((text) => text && HAS_WORD.test(text));
  return blocks
    .map((text, index) => (index < blocks.length - 1 ? asSentence(text) : text))
    .join(" ");
}

/**
 * Runs inside the page through `browser.scripting.executeScript`, which serializes this
 * function's source: it cannot use the module's imports or its other exports.
 *
 * Returns the selection as one string per block, so headings, paragraphs, list items and table
 * cells stay apart. Elements that carry no speech are skipped, and a `<br>` ends a block.
 *
 * @returns {string[]}
 */
export function readSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return [];

  const root = document.createElement("div");
  root.appendChild(selection.getRangeAt(0).cloneContents());

  const BLOCK_TAGS = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "CAPTION", "DD", "DETAILS", "DIALOG", "DIV",
    "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4",
    "H5", "H6", "HEADER", "HGROUP", "HR", "LEGEND", "LI", "MAIN", "MENU", "NAV", "OL", "P",
    "PRE", "SECTION", "SUMMARY", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL"
  ]);
  const SKIP_TAGS = new Set([
    "AUDIO", "CANVAS", "IFRAME", "MATH", "NOSCRIPT", "SCRIPT", "STYLE", "SVG", "TEMPLATE", "VIDEO"
  ]);

  const blocks = [];
  let text = "";
  const flush = () => {
    if (text.trim()) blocks.push(text);
    text = "";
  };
  const walk = (node) => {
    if (node.nodeType === 3) {
      text += node.nodeValue;
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) return;
    if (tag === "BR") {
      flush();
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    if (block) flush();
    for (const child of node.childNodes) walk(child);
    if (block) flush();
  };

  for (const child of root.childNodes) walk(child);
  flush();
  return blocks;
}
