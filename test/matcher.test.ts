import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAcceptableTitles, matches, matchesExact, normalize } from "../lib/matcher";

test("normalize: lowercases, strips diacritics and punctuation, collapses whitespace", () => {
  assert.equal(normalize("  The Lord of the Rings  "), "the lord of the rings");
  assert.equal(normalize("Amélie"), "amelie");
  assert.equal(normalize("Star Wars: Episode IV — A New Hope"), "star wars episode iv a new hope");
  assert.equal(normalize("WALL·E"), "wall e");
});

test("buildAcceptableTitles: includes full, article-less, subtitle, and subtitle-article-less forms", () => {
  const variants = buildAcceptableTitles("The Lord of the Rings: The Fellowship of the Ring");
  // Full and full-no-article
  assert.ok(variants.includes("the lord of the rings the fellowship of the ring"));
  // Subtitle-stripped (from the colon)
  assert.ok(variants.includes("the lord of the rings"));
  // And subtitle-stripped without the leading article
  assert.ok(variants.includes("lord of the rings"));
});

test("buildAcceptableTitles: titles without a colon don't get subtitle variants", () => {
  const variants = buildAcceptableTitles("The Matrix");
  assert.deepEqual(variants.sort(), ["matrix", "the matrix"]);
});

test("buildAcceptableTitles: deduplicates identical variants", () => {
  // "Heat" has no article and no subtitle — only one variant.
  const variants = buildAcceptableTitles("Heat");
  assert.deepEqual(variants, ["heat"]);
});

test("matches: exact normalized match", () => {
  const acc = buildAcceptableTitles("The Matrix");
  assert.equal(matches("The Matrix", acc), true);
  assert.equal(matches("the matrix", acc), true);
  assert.equal(matches("THE MATRIX", acc), true);
});

test("matches: leading article is optional", () => {
  const acc = buildAcceptableTitles("The Matrix");
  assert.equal(matches("Matrix", acc), true);
});

test("matches: subtitle stripping accepts the main title", () => {
  const acc = buildAcceptableTitles("Star Wars: A New Hope");
  assert.equal(matches("Star Wars", acc), true);
});

test("matches: empty / too-short guess rejected", () => {
  const acc = buildAcceptableTitles("The Matrix");
  assert.equal(matches("", acc), false);
  assert.equal(matches("a", acc), false);
});

test("matches: typo within fuzzy threshold accepted", () => {
  const acc = buildAcceptableTitles("The Godfather");
  // One-char typo on a 12-char title — well inside len/6 threshold.
  assert.equal(matches("The Godfther", acc), true);
});

test("matches: wildly different title rejected", () => {
  const acc = buildAcceptableTitles("The Matrix");
  assert.equal(matches("Inception", acc), false);
  assert.equal(matches("The Notebook", acc), false);
});

test("matchesExact: full normalized title required", () => {
  const acc = buildAcceptableTitles("The Hunger Games: Catching Fire");
  const canonical = acc[0]!;
  assert.equal(matchesExact("The Hunger Games: Catching Fire", canonical), true);
  assert.equal(matchesExact("the hunger games catching fire", canonical), true);
});

test("matchesExact: leading article dropped on either side", () => {
  const acc = buildAcceptableTitles("The Matrix");
  const canonical = acc[0]!;
  assert.equal(matchesExact("Matrix", canonical), true);
});

test("matchesExact: does NOT strip subtitle (combobox safety)", () => {
  // Critical safety check called out in the matcher docstring: picking
  // "The Hunger Games" from the dropdown must NOT match a round whose
  // canonical answer is "The Hunger Games: Catching Fire".
  const acc = buildAcceptableTitles("The Hunger Games: Catching Fire");
  const canonical = acc[0]!;
  assert.equal(matchesExact("The Hunger Games", canonical), false);
});

test("matchesExact: empty guess rejected", () => {
  const acc = buildAcceptableTitles("The Matrix");
  assert.equal(matchesExact("", acc[0]!), false);
});

test("matchesExact: typos rejected (fuzzy is for matches() only)", () => {
  const acc = buildAcceptableTitles("The Matrix");
  assert.equal(matchesExact("The Matricks", acc[0]!), false);
});
