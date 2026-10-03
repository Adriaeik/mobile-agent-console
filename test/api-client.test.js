import test from "node:test";
import assert from "node:assert/strict";
import { readApiResponse } from "../public/api-client.js";

test("explains an HTML response from an out-of-date server", async () => {
  const response = new Response("<!doctype html><title>Mobile Agent Console</title>", {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });

  await assert.rejects(
    readApiResponse(response),
    /server.*older version.*restart.*reload/i
  );
});

test("returns JSON and preserves API error messages", async () => {
  const success = new Response(JSON.stringify({ available: true }), {
    headers: { "Content-Type": "application/json" }
  });
  assert.deepEqual(await readApiResponse(success), { available: true });

  const failure = new Response(JSON.stringify({ error: "Session not found." }), {
    status: 404,
    headers: { "Content-Type": "application/json" }
  });
  await assert.rejects(readApiResponse(failure), /Session not found\./);
});

test("accepts an empty successful response", async () => {
  assert.equal(await readApiResponse(new Response(null, { status: 204 })), null);
});
