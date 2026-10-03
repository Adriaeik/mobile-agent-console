import test from "node:test";
import assert from "node:assert/strict";
import { appendImageReferences, imageFilesFromClipboard } from "../public/attachments.js";

test("extracts only image files from clipboard items", () => {
  const png = { name: "screen.png", type: "image/png" };
  const text = { name: "notes.txt", type: "text/plain" };
  const files = imageFilesFromClipboard({ items: [
    { kind: "string", type: "text/plain", getAsFile: () => null },
    { kind: "file", type: "text/plain", getAsFile: () => text },
    { kind: "file", type: "image/png", getAsFile: () => png },
  ] });
  assert.deepEqual(files, [png]);
});

test("adds uploaded image paths to an existing or image-only message", () => {
  const uploads = [
    { path: "/home/user/.local/share/mobile-agent-console/uploads/session-2/one.png" },
    { path: "/home/user/.local/share/mobile-agent-console/uploads/session-2/two.jpg" },
  ];
  assert.equal(
    appendImageReferences("Describe the differences", uploads),
    "Describe the differences\n\nAttached images:\n- /home/user/.local/share/mobile-agent-console/uploads/session-2/one.png\n- /home/user/.local/share/mobile-agent-console/uploads/session-2/two.jpg"
  );
  assert.equal(
    appendImageReferences("", uploads.slice(0, 1)),
    "Attached image: /home/user/.local/share/mobile-agent-console/uploads/session-2/one.png"
  );
});
