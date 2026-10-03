import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MAX_IMAGE_BYTES,
  saveImageUpload,
  validateImageUpload,
} from "../src/uploads.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

test("accepts a supported image signature and rejects spoofed or oversized input", () => {
  assert.deepEqual(validateImageUpload("image/png", PNG), { extension: ".png", type: "image/png" });
  assert.throws(() => validateImageUpload("image/png", Buffer.from("not an image")), /contents/i);
  assert.throws(() => validateImageUpload("image/svg+xml", Buffer.from("<svg/>")), /type/i);
  assert.throws(() => validateImageUpload("image/png", Buffer.alloc(MAX_IMAGE_BYTES + 1)), /large/i);
});

test("stores uploads privately outside the project using an opaque name", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mobile-console-upload-"));
  const uploaded = await saveImageUpload({
    sessionId: "$12",
    contentType: "image/png",
    data: PNG,
    root,
    id: "4c3fa20c-59ef-4ee2-b799-c73aac81bbee",
  });

  assert.equal(uploaded.name, "4c3fa20c-59ef-4ee2-b799-c73aac81bbee.png");
  assert.equal(uploaded.type, "image/png");
  assert.equal(uploaded.size, PNG.length);
  assert.equal(path.dirname(uploaded.path), path.join(root, "session-12"));
  assert.deepEqual(await readFile(uploaded.path), PNG);
  assert.equal((await stat(uploaded.path)).mode & 0o777, 0o600);
});

test("rejects invalid session identifiers before writing", async () => {
  await assert.rejects(
    saveImageUpload({ sessionId: "../../escape", contentType: "image/png", data: PNG }),
    /session/i
  );
});
