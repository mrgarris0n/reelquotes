import { test } from "node:test";
import assert from "node:assert/strict";
import { HINT_COSTS, anyHintUsed, maskTitle, totalHintCost } from "../lib/hints";

test("HINT_COSTS: documented costs", () => {
  assert.equal(HINT_COSTS.year, 1);
  assert.equal(HINT_COSTS.genre, 1);
  assert.equal(HINT_COSTS.title, 2);
});

test("totalHintCost: undefined / empty = 0", () => {
  assert.equal(totalHintCost(undefined), 0);
  assert.equal(totalHintCost({}), 0);
});

test("totalHintCost: sums costs of used hints", () => {
  assert.equal(totalHintCost({ year: true }), 1);
  assert.equal(totalHintCost({ year: true, genre: true }), 2);
  assert.equal(totalHintCost({ year: true, genre: true, title: true }), 4);
  assert.equal(totalHintCost({ title: true }), 2);
});

test("totalHintCost: falsy flags ignored", () => {
  assert.equal(totalHintCost({ year: false, genre: false, title: false }), 0);
});

test("anyHintUsed: undefined / empty = false", () => {
  assert.equal(anyHintUsed(undefined), false);
  assert.equal(anyHintUsed({}), false);
});

test("anyHintUsed: true when at least one hint used", () => {
  assert.equal(anyHintUsed({ year: true }), true);
  assert.equal(anyHintUsed({ genre: true }), true);
  assert.equal(anyHintUsed({ title: true }), true);
  assert.equal(anyHintUsed({ year: false, genre: true }), true);
});

test("maskTitle: docstring examples", () => {
  assert.equal(maskTitle("The Matrix"), "T__ M_____");
  assert.equal(maskTitle("Star Wars: Episode IV"), "S___ W___: E______ I_");
  assert.equal(maskTitle("2001: A Space Odyssey"), "2___: A S____ O______");
});

test("maskTitle: single word", () => {
  assert.equal(maskTitle("Inception"), "I________");
});

test("maskTitle: preserves punctuation verbatim, doesn't restart words", () => {
  // The hyphen is punctuation — it does NOT start a new word, so the char
  // after stays masked.
  assert.equal(maskTitle("Spider-Man"), "S_____-___");
});

test("maskTitle: preserves multiple whitespace runs", () => {
  assert.equal(maskTitle("A  B"), "A  B");
});

test("maskTitle: empty input", () => {
  assert.equal(maskTitle(""), "");
});

test("maskTitle: leading whitespace preserved", () => {
  assert.equal(maskTitle(" Hi"), " H_");
});

test("maskTitle: numeric words behave like alphabetic ones", () => {
  // Each whitespace-separated run reveals its first alphanumeric.
  assert.equal(maskTitle("12 Angry Men"), "1_ A____ M__");
});
