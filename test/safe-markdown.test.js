import test from "node:test";
import assert from "node:assert/strict";
import { parseSafeMarkdown } from "../public/safe-markdown.js";

test("parses the small supported Markdown surface", () => {
  const blocks = parseSafeMarkdown("# Heading\n\nA `value` here.\n\n- one\n- two\n\n```js\nalert(1)\n```");
  assert.deepEqual(blocks.map(({ type }) => type), ["heading", "paragraph", "list", "code"]);
  assert.deepEqual(blocks[1].content, [
    { type: "text", value: "A " },
    { type: "code", value: "value" },
    { type: "text", value: " here." },
  ]);
  assert.equal(blocks[2].ordered, false);
  assert.equal(blocks[3].language, "js");
});

test("HTML and event handlers remain plain text", () => {
  const hostile = '<img src=x onerror="globalThis.pwned=1"><script>pwned()</script>';
  const blocks = parseSafeMarkdown(hostile);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "paragraph");
  assert.equal(blocks[0].content.map(({ value }) => value).join(""), hostile);
  assert.equal(JSON.stringify(blocks).includes("rawHtml"), false);
});
