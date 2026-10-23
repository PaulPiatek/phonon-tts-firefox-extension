import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { prepareSpeechText } from "../src/selection.js";

describe("prepareSpeechText", () => {
  test("a block without punctuation ends a sentence for the block after it", () => {
    assert.equal(
      prepareSpeechText(["Nightfall", "The city sleeps"]),
      "Nightfall. The city sleeps"
    );
  });

  test("the last block keeps its own ending", () => {
    assert.equal(prepareSpeechText(["A headline"]), "A headline");
    assert.equal(prepareSpeechText(["A headline", "And the last words"]), "A headline. And the last words");
  });

  test("punctuation that is already there is left alone", () => {
    assert.equal(prepareSpeechText(["Really?", "Yes!", "Fine…", "Done."]), "Really? Yes! Fine… Done.");
  });

  test("a closing quote or bracket after the full stop still counts", () => {
    assert.equal(prepareSpeechText(["He said “go.”", "(see below)"]), "He said “go.” (see below)");
  });

  test("a block ending in a clause mark ends as a sentence instead", () => {
    assert.equal(
      prepareSpeechText(["In short:", "It works;", "and then,", "we stop"]),
      "In short. It works. and then. we stop"
    );
  });

  test("whitespace is collapsed and invisible characters are dropped", () => {
    assert.equal(prepareSpeechText(["  the\u00adre\tis\n  space ", "next"]), "there is space. next");
  });

  test("empty and content-free blocks are skipped", () => {
    assert.equal(prepareSpeechText(["", "   ", "•", "—", "Words", "here"]), "Words. here");
  });

  test("numbers count as content", () => {
    assert.equal(prepareSpeechText(["2026", "was a year"]), "2026. was a year");
  });

  test("a plain string is split at its line breaks", () => {
    assert.equal(
      prepareSpeechText("First line\r\nSecond line\n\nThird"),
      "First line. Second line. Third"
    );
  });

  test("blank input speaks nothing", () => {
    assert.equal(prepareSpeechText(""), "");
    assert.equal(prepareSpeechText("   \n  "), "");
    assert.equal(prepareSpeechText([]), "");
    assert.equal(prepareSpeechText(undefined), "");
  });
});
