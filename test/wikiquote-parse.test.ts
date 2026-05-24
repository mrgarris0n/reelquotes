import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balanceQuotes,
  chunkDialogue,
  isRedirect,
  parseWikiquote,
  repairOrphanBrackets,
  stripMarkup,
  trimLongLines,
} from "../lib/wikiquote-parse";

test("isRedirect detects redirect pages", () => {
  assert.equal(isRedirect("#REDIRECT [[The Matrix (franchise)]]"), true);
  assert.equal(isRedirect("  #redirect [[Foo]]"), true);
  assert.equal(isRedirect("== Quotes ==\n* hello"), false);
});

test("parseWikiquote returns [] for a redirect", () => {
  assert.deepEqual(parseWikiquote("#REDIRECT [[Elsewhere]]"), []);
});

test("parseWikiquote: multi-line HTML comments don't leak into quotes", () => {
  // Wikiquote editors occasionally leave block comments spanning many
  // source lines. The per-line stripMarkup can't match those — the strip
  // has to happen before splitSections splits on \n.
  const wt = `== Dialogue ==
:'''Cook''':  text before<!--
- Comment from User:foo:
multi-line note that should not appear
-->  text after
:'''Sally''': Something else.
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.lines[0]!.speaker, "Cook");
  assert.ok(!/<!--/.test(q[0]!.lines[0]!.text), `<!-- leaked: ${q[0]!.lines[0]!.text}`);
  assert.ok(!/User:foo/.test(q[0]!.lines[0]!.text), `comment body leaked: ${q[0]!.lines[0]!.text}`);
  assert.match(q[0]!.lines[0]!.text, /text before.*text after/);
});

test("stripMarkup: comment opener never survives nesting", () => {
  // HTML5 ends comments at the first `-->`, so a stray trailing `-->`
  // is just text. What matters is that the `<!--` opener doesn't escape.
  const out = stripMarkup("a <!--<!-- inner -->--> b");
  assert.ok(!/<!--/.test(out), `<!-- survived: ${out}`);
});

test("stripMarkup: nested <ref> tags leave nothing behind", () => {
  // The body-ref strip alone can't handle this — iteration does.
  assert.equal(stripMarkup("hello <r<ref/>ef/> world"), "hello world");
  assert.equal(
    stripMarkup("hello <re<ref>cite</ref>f>body</ref> world"),
    "hello world",
  );
});

test("stripMarkup: nested <br> collapses to whitespace", () => {
  // `<<br>br>` -> `<br>` after one pass; iteration strips it too.
  const out = stripMarkup("hello<<br>br>world");
  assert.ok(!/<br/i.test(out), `<br> survived: ${out}`);
});

test("stripMarkup leaves no <script> behind, even nested (CodeQL js/bad-tag-filter)", () => {
  // A single-pass regex strip can leave a re-formed tag (`<scr<script>ipt>`
  // -> `<script>` after one pass). Iterating to a fixed point closes that
  // gap. Stray non-tag text fragments (`ipt>`) are harmless — React escapes
  // them at render time.
  const out = stripMarkup("hello <scr<script>ipt>alert(1)</script> world");
  assert.ok(!/<\/?script/i.test(out), `<script> survived: ${out}`);
  const out2 = stripMarkup("<<center>center>text<</center>/center>");
  assert.ok(!/<\/?center/i.test(out2), `<center> survived: ${out2}`);
});

test("stripMarkup removes wiki/HTML noise", () => {
  assert.equal(stripMarkup("''italic'' and '''bold'''"), "italic and bold");
  assert.equal(stripMarkup("[[Neo (The Matrix)|Neo]] wakes up"), "Neo wakes up");
  assert.equal(stripMarkup("[[Trinity]] runs"), "Trinity runs");
  assert.equal(stripMarkup("text<ref>cite</ref> more"), "text more");
  assert.equal(stripMarkup("text<ref name=x/> more"), "text more");
  assert.equal(stripMarkup("a {{nowrap|b c}} d"), "a d");
  assert.equal(stripMarkup("see [https://x.com label] now"), "see label now");
  assert.equal(stripMarkup("line one<br>line two"), "line one line two");
  assert.equal(stripMarkup("Tom &amp; Jerry&nbsp;says"), "Tom & Jerry says");
});

test("character section: solo bullet quotes attributed to the heading", () => {
  const wt = `
== Neo ==
* There is no spoon.
* I know kung fu, and I can prove it right here.

== Cast ==
* Keanu Reeves as Neo
`;
  const q = parseWikiquote(wt);
  // "There is no spoon." is 18 chars → usable; the kung fu line too.
  assert.equal(q.length, 2);
  assert.deepEqual(q[0], { lines: [{ speaker: "Neo", text: "There is no spoon." }] });
  assert.equal(q[1]!.lines[0]!.speaker, "Neo");
  // Cast section excluded entirely.
  assert.ok(!q.some((x) => x.lines.some((l) => /Keanu/.test(l.text))));
});

test("character section: short quotes (<15 chars) dropped", () => {
  const wt = `== Yoda ==\n* No.\n* Do or do not. There is no try.`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.lines[0]!.text, "Do or do not. There is no try.");
});

test("character section: :-indented continuation lines join the bullet", () => {
  const wt = `
== Morpheus ==
* This is your last chance.
: After this, there is no turning back.
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 1);
  assert.equal(
    q[0]!.lines[0]!.text,
    "This is your last chance. After this, there is no turning back.",
  );
});

test("dialogue section: speaker lines split into a multi-line quote", () => {
  const wt = `
== Dialogue ==
'''Neo:''' What is the Matrix?
'''Morpheus:''' Unfortunately, no one can be told what the Matrix is.
----
'''Trinity:''' Get up, Trinity. Get up. Just get up.
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 2);
  assert.equal(q[0]!.lines.length, 2);
  assert.deepEqual(q[0]!.lines[0], { speaker: "Neo", text: "What is the Matrix?" });
  assert.equal(q[0]!.lines[1]!.speaker, "Morpheus");
  assert.equal(q[1]!.lines.length, 1);
  assert.equal(q[1]!.lines[0]!.speaker, "Trinity");
});

test("dialogue section: continuation line appends to previous speaker", () => {
  const wt = `
== Dialogue ==
'''Vincent:''' They got the metric system. They wouldn't know what the hell a Quarter Pounder is.
: And you know what they call it in France?
'''Jules:''' What do they call it?
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.lines.length, 2);
  assert.match(q[0]!.lines[0]!.text, /Quarter Pounder is\. And you know what they call it in France\?/);
});

test("inline-speaker bullet becomes a multi-line exchange", () => {
  const wt = `
== Memorable quotes ==
* '''Brody:''' You're gonna need a bigger boat. '''Quint:''' That's the second time.
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.lines.length, 2);
  assert.deepEqual(q[0]!.lines[0], { speaker: "Brody", text: "You're gonna need a bigger boat." });
  assert.equal(q[0]!.lines[1]!.speaker, "Quint");
});

test("level-3 sub-headings are flattened, bullets keep the level-2 speaker", () => {
  const wt = `
== The Dude ==
=== Act One ===
* That rug really tied the room together, did it not?
=== Act Two ===
* Yeah, well, you know, that's just, like, your opinion, man.
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 2);
  assert.ok(q.every((x) => x.lines[0]!.speaker === "The Dude"));
});

test("stage-direction-only bullets are dropped, inline directions stripped", () => {
  const wt = `
== Henry ==
* [the baby convulses violently]
* [picking up the phone] Oh, you are sick! I'll get the doctor.
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 1);
  // Bracketed action removed; only the spoken dialogue remains.
  assert.equal(q[0]!.lines[0]!.text, "Oh, you are sick! I'll get the doctor.");
  assert.ok(!/\[picking up the phone\]/.test(q[0]!.lines[0]!.text));
});

test("stripMarkup removes bracketed stage directions inline and at edges", () => {
  assert.equal(stripMarkup("[door slams] Get out."), "Get out.");
  assert.equal(stripMarkup("Hello, [waves hand] friend."), "Hello, friend.");
  assert.equal(stripMarkup("[a] [b] real text"), "real text");
  // Wikilink-stripped first, so legitimate `[[X]]` content survives bracket strip.
  assert.equal(stripMarkup("[[Hamlet]] enters."), "Hamlet enters.");
});

test("trimLongLines: cuts at the last sentence boundary when one is near", () => {
  const long =
    "This is a complete first sentence. " +
    "This is a complete second sentence with more substance to it. " +
    "And here is a third sentence padding the line out further to push it past the cap so the trimmer must engage and choose a sensible boundary somewhere earlier in the run.";
  const out = trimLongLines(long);
  assert.ok(out.length <= 280);
  assert.ok(out.endsWith("."));
  assert.ok(!out.endsWith("…"));
});

test("trimLongLines: falls back to a word-boundary + ellipsis when no nearby sentence end", () => {
  const long = "a".repeat(150) + " " + "b".repeat(150); // no punctuation
  const out = trimLongLines(long);
  assert.ok(out.length <= 281); // +1 for the ellipsis char
  assert.ok(out.endsWith("…"));
});

test("trimLongLines: short lines pass through untouched", () => {
  const s = "Short line.";
  assert.equal(trimLongLines(s), s);
});

test("semicolon-style dialogue speakers are recognized", () => {
  const wt = `
== Dialogue ==
; Gandalf : You shall not pass!
; Balrog : [roars]
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.lines[0]!.speaker, "Gandalf");
  assert.equal(q[0]!.lines[0]!.text, "You shall not pass!");
});

test("a page with no quotes section yields nothing", () => {
  const wt = `'''Some Film''' is a 1999 movie.\n== Cast ==\n* Someone\n== External links ==\n* [https://x site]`;
  assert.deepEqual(parseWikiquote(wt), []);
});

test("real-ish mixed page parses both character and dialogue sections", () => {
  const wt = `
{{DEFAULTSORTKEY:Matrix}}
'''The Matrix''' is a 1999 film.
[[File:Poster.jpg|thumb|"Free your mind."]]

== Neo ==
* I know kung fu, and I'm ready to prove it.<ref>scene 12</ref>

== Morpheus ==
* Welcome to the [[desert]] of the real, my friend.

== Dialogue ==
'''Morpheus:''' You take the blue pill, the story ends.
'''Neo:''' [hesitates] I don't know what to choose.

== External links ==
* [https://example.com IMDb]
`;
  const q = parseWikiquote(wt);
  // 2 solo + 1 dialogue block; File caption + External links excluded.
  assert.equal(q.length, 3);
  assert.equal(q[0]!.lines[0]!.speaker, "Neo");
  assert.match(q[0]!.lines[0]!.text, /^I know kung fu/);
  assert.ok(!/desert of the real/.test(JSON.stringify(q)) === false); // link unwrapped
  assert.equal(q[2]!.lines.length, 2);
  assert.equal(q[2]!.lines[0]!.speaker, "Morpheus");
});

// --- series season-subpage format ------------------------------------------

test("series: definition-list dialogue under level-3 episode headings", () => {
  const wt = `
{{italic title}}
----
:'''Season''' [[Show (season 1)|1]] [[Show (season 2)|2]] | [[Show|'''Main''']]
----
=== ''[[w:Pilot|Pilot]]'' [1.01] ===
[[File:Poster.jpg|thumb|a caption]]
:'''[[w:Walter White|Walter]]''': My name is Walter Hartwell White. This is a confession.
<hr width="50%"/>
:'''[[w:Jesse Pinkman|Jesse]]''': Why are you here?
:'''Walter''': I was curious. There's a lot of money in it, huh?

=== ''Cat's in the Bag'' [1.02] ===
:'''Skyler''': What is going on with you? Talk to me, Walt.

== External links ==
* [https://x site]
`;
  const q = parseWikiquote(wt);
  // nav header dropped; File caption ignored; External links skipped.
  // 3 quotes: Walter solo, Jesse/Walter exchange, Skyler solo.
  assert.equal(q.length, 3);
  assert.equal(q[0]!.lines.length, 1);
  assert.equal(q[0]!.lines[0]!.speaker, "Walter");
  assert.match(q[0]!.lines[0]!.text, /^My name is Walter/);
  assert.equal(q[1]!.lines.length, 2);
  assert.equal(q[1]!.lines[0]!.speaker, "Jesse");
  assert.equal(q[1]!.lines[1]!.speaker, "Walter");
  assert.equal(q[2]!.lines[0]!.speaker, "Skyler");
});

test("series: <hr> separates quotes within an episode", () => {
  const wt = `
=== Episode One ===
:'''A''': First quote here, long enough to count.
<hr/>
:'''B''': Second separate quote, also long enough.
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 2);
  assert.equal(q[0]!.lines[0]!.speaker, "A");
  assert.equal(q[1]!.lines[0]!.speaker, "B");
});

test("series: season-navigation header is not emitted as a quote", () => {
  const wt = `
:'''Seasons''' [[X (season 1)|1]] [[X (season 2)|2]] [[X (season 3)|3]] | [[X|Main]]
----
:'''Hank''': You got one part of that wrong. This is not meth.
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.lines[0]!.speaker, "Hank");
  assert.ok(!JSON.stringify(q).toLowerCase().includes("season"));
});

test("series: hub/index page (no quotes) yields nothing", () => {
  const wt = `
{{italic title}}
'''''[[w:Friends|Friends]]''''' (1994–2004) was a sitcom.
== Seasons ==
::[[Friends (season 1)|Season 1]]
::[[Friends (season 2)|Season 2]]
== Cast ==
* Jennifer Aniston
== External links ==
* [https://x site]
`;
  assert.deepEqual(parseWikiquote(wt), []);
});

test("chunkDialogue: short blocks pass through unchanged", () => {
  const lines = [
    { speaker: "A", text: "hi" },
    { speaker: "B", text: "hey" },
  ];
  assert.deepEqual(chunkDialogue(lines), [lines]);
});

test("chunkDialogue: long dialogue is split into ≤6-line chunks", () => {
  const lines = Array.from({ length: 14 }, (_, i) => ({
    speaker: i % 2 === 0 ? "A" : "B",
    text: `line ${i + 1} of fourteen, long enough to count.`,
  }));
  const chunks = chunkDialogue(lines);
  assert.equal(chunks.length, 3); // 6 + 6 + 2
  assert.equal(chunks[0]!.length, 6);
  assert.equal(chunks[1]!.length, 6);
  assert.equal(chunks[2]!.length, 2);
});

test("chunkDialogue: trailing single-line tail merges into the previous chunk", () => {
  const lines = Array.from({ length: 13 }, (_, i) => ({
    speaker: "A",
    text: `line ${i + 1}.`,
  }));
  const chunks = chunkDialogue(lines);
  // 6 + 6 + 1 → merge last into prior → 6 + 7
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]!.length, 6);
  assert.equal(chunks[1]!.length, 7);
});

test("parseWikiquote: very long Dialogue block splits into multiple quotes", () => {
  const body = Array.from({ length: 14 }, (_, i) => {
    const speaker = i % 2 === 0 ? "A" : "B";
    return `'''${speaker}:''' speaker ${speaker} line ${i + 1} text long enough.`;
  }).join("\n");
  const wt = `== Dialogue ==\n${body}\n`;
  const q = parseWikiquote(wt);
  // 14 lines / 6 per chunk = 3 quotes (6 + 6 + 2)
  assert.equal(q.length, 3);
  assert.ok(q.every((x) => x.lines.length <= 7));
});

test("repairOrphanBrackets: balanced [...] is removed", () => {
  assert.equal(repairOrphanBrackets("a [picks up phone] b"), "a b");
});

test("repairOrphanBrackets: nested balanced collapses fully", () => {
  assert.equal(repairOrphanBrackets("a [outer [inner] outer] b"), "a b");
});

test("repairOrphanBrackets: mixed [...) is removed (Wikiquote typo)", () => {
  assert.equal(repairOrphanBrackets("[Busy work at a mound of clay) It's bad"), "It's bad");
});

test("repairOrphanBrackets: mixed [...} is removed (Wikiquote typo)", () => {
  assert.equal(repairOrphanBrackets("look at... [Bear comes into room}"), "look at...");
});

test("repairOrphanBrackets: orphan [ followed by space drops just the bracket", () => {
  assert.equal(
    repairOrphanBrackets("Hey Phoebe! Phoebe? [ Hey Phoebe."),
    "Hey Phoebe! Phoebe? Hey Phoebe.",
  );
});

test("repairOrphanBrackets: orphan [ followed by stage-direction word drops to end", () => {
  assert.equal(
    repairOrphanBrackets("Like I haven't slept in three days? [covers up his wound."),
    "Like I haven't slept in three days?",
  );
});

test("repairOrphanBrackets: orphan [ at start of string with no closer empties string", () => {
  assert.equal(repairOrphanBrackets("[shouting You shouldn't have done it!"), "");
});

test("repairOrphanBrackets: orphan ] at end is stripped", () => {
  assert.equal(repairOrphanBrackets("Ah. The Chronosphere.]"), "Ah. The Chronosphere.");
});

test("repairOrphanBrackets: double orphan ]] is stripped", () => {
  assert.equal(
    repairOrphanBrackets("You did all you could.]]"),
    "You did all you could.",
  );
});

test("repairOrphanBrackets: orphan ] mid-line is stripped, both sides kept", () => {
  assert.equal(
    repairOrphanBrackets("White House.] Yeah, like anyone's gonna believe that."),
    "White House. Yeah, like anyone's gonna believe that.",
  );
});

test("repairOrphanBrackets: orphan ] at start is stripped", () => {
  assert.equal(
    repairOrphanBrackets('] "Just whistle." That reminds me.'),
    '"Just whistle." That reminds me.',
  );
});

test("repairOrphanBrackets: clean text passes through unchanged", () => {
  assert.equal(repairOrphanBrackets("Just plain dialogue."), "Just plain dialogue.");
});

test("repairOrphanBrackets: parentheses in normal prose are preserved", () => {
  assert.equal(
    repairOrphanBrackets("He said (loudly) the door opened."),
    "He said (loudly) the door opened.",
  );
});

test("repairOrphanBrackets: idempotent", () => {
  const input = "Hey? [ Hey again. Door.]";
  const once = repairOrphanBrackets(input);
  const twice = repairOrphanBrackets(once);
  assert.equal(once, twice);
});

test("dialogue: speaker with apostrophe-quoted nickname", () => {
  const wt = `== Dialogue ==
:'''Ronald 'Ron' Thompson''': Shut up, wimp!
:'''Nick''': Me? It was his ball!
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.lines.length, 2);
  assert.equal(q[0]!.lines[0]!.speaker, "Ronald 'Ron' Thompson");
  assert.equal(q[0]!.lines[0]!.text, "Shut up, wimp!");
  assert.equal(q[0]!.lines[1]!.speaker, "Nick");
});

test("dialogue: speaker with comma-suffix title (Sr., Jr.)", () => {
  const wt = `== Dialogue ==
:'''Russell 'Russ' Thompson, Sr.''': Blew up my kids?
:'''Wayne''': No, no!
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.lines[0]!.speaker, "Russell 'Russ' Thompson, Sr.");
  assert.equal(q[0]!.lines[0]!.text, "Blew up my kids?");
});

test("dialogue: speaker with O'Brien-style apostrophe", () => {
  const wt = `== Dialogue ==
:'''O'Brien''': Yes, Captain.
:'''Picard''': Make it so.
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.lines[0]!.speaker, "O'Brien");
  assert.equal(q[0]!.lines[1]!.speaker, "Picard");
});

test("dialogue: speaker with possessive apostrophe", () => {
  const wt = `== Dialogue ==
:'''Mary's mom''': Don't be late.
:'''Mary''': I won't!
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.lines[0]!.speaker, "Mary's mom");
  assert.equal(q[0]!.lines[1]!.speaker, "Mary");
});

test("character section: inline split with apostrophe-quoted nickname", () => {
  const wt = `== Other ==
* '''Russell 'Russ' Thompson, Sr.''': The coach put me on these babies, you know what happened?
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.lines.length, 1);
  assert.equal(q[0]!.lines[0]!.speaker, "Russell 'Russ' Thompson, Sr.");
  assert.match(q[0]!.lines[0]!.text, /^The coach put me/);
});

test("dialogue: <br>-merged multi-speaker line splits into two lines", () => {
  const wt = `== Dialogue ==
:'''Gloria''': Ma, anything interesting happen to you today?<br>'''Edith''': Actually, something interesting did happen today.
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.lines.length, 2);
  assert.equal(q[0]!.lines[0]!.speaker, "Gloria");
  assert.equal(q[0]!.lines[0]!.text, "Ma, anything interesting happen to you today?");
  assert.equal(q[0]!.lines[1]!.speaker, "Edith");
  assert.match(q[0]!.lines[1]!.text, /^Actually, something interesting/);
});

test("dialogue: parenthetical action between '''name''' and colon", () => {
  const wt = `== Dialogue ==
:'''Archie''' (addressing Mike): Poland gave us delicate dishes.
:'''Gloria''': Polish sausage is very good.
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.lines[0]!.speaker, "Archie");
  assert.equal(q[0]!.lines[0]!.text, "Poland gave us delicate dishes.");
  assert.equal(q[0]!.lines[1]!.speaker, "Gloria");
});

test("dialogue: italic action between '''name''' and colon", () => {
  const wt = `== Dialogue ==
:'''Edith''' ''(quietly)'': I think we should have them over more often.
:'''Wayne''': I think that went well.
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.lines[0]!.speaker, "Edith");
  assert.equal(q[0]!.lines[0]!.text, "I think we should have them over more often.");
});

test("character section: wikilinked heading becomes plain-text speaker", () => {
  const wt = `==[[w:Bajirao Singham|Bajirao Singham]]==
* This country wants you, not jail.
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.lines[0]!.speaker, "Bajirao Singham");
});

test("character section: wikilinked Cast heading is still skipped", () => {
  const wt = `==[[Cast]]==
* Some actor — Some character
`;
  const q = parseWikiquote(wt);
  assert.equal(q.length, 0);
});

test("balanceQuotes: even count passes through", () => {
  assert.equal(balanceQuotes('He said "hello" then left.'), 'He said "hello" then left.');
});

test("balanceQuotes: trailing orphan \" stripped", () => {
  assert.equal(balanceQuotes('Daya! break the doors."'), "Daya! break the doors.");
});

test("balanceQuotes: leading orphan \" stripped", () => {
  assert.equal(
    balanceQuotes('"People get fooled easily. Mango is the favorite.'),
    "People get fooled easily. Mango is the favorite.",
  );
});

test("balanceQuotes: mid-text orphan is left alone (too risky)", () => {
  // 1 quote char, mid-text — heuristic refuses to guess.
  const input = "He said hello\" and left.";
  assert.equal(balanceQuotes(input), input);
});

test("balanceQuotes: smart quotes are not touched", () => {
  // “…” are different code points; only ASCII `"` is balanced.
  const input = "He said “hello” and left.\"";
  assert.equal(balanceQuotes(input), "He said “hello” and left.");
});

test("intro prose with bold title is not parsed as speaker", () => {
  // Regression guard: relaxing the speaker-name pattern must not turn this
  // into a (Speaker, text) pair. There's no `:` after the closing `'''`.
  const wt = `== Lead ==
'''The Matrix''' is a 1999 science fiction film.
`;
  const q = parseWikiquote(wt);
  // The lead text is too short / not bullet-formatted; in practice nothing
  // is extracted. Critically: it does NOT mis-attribute "The Matrix" as a
  // speaker.
  assert.ok(q.every((x) => x.lines.every((l) => l.speaker !== "The Matrix")));
});
