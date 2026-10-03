import test from "node:test";
import assert from "node:assert/strict";
import { conversationSignature, shouldFollowConversation } from "../public/conversation-view.js";

test("conversation signature changes when streamed text changes", () => {
  const before = [{ id: "message-0", role: "assistant", text: "Working" }];
  const after = [{ id: "message-0", role: "assistant", text: "Working\nDone" }];
  assert.notEqual(conversationSignature(before), conversationSignature(after));
  assert.equal(conversationSignature(after), conversationSignature(structuredClone(after)));
});

test("conversation follows only when the reader is already near the bottom", () => {
  assert.equal(shouldFollowConversation({ scrollTop: 700, clientHeight: 300, scrollHeight: 1040 }), true);
  assert.equal(shouldFollowConversation({ scrollTop: 100, clientHeight: 300, scrollHeight: 1040 }), false);
  assert.equal(shouldFollowConversation({ scrollTop: 0, clientHeight: 800, scrollHeight: 700 }), true);
});
