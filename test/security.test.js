import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeConfiguration, authorizeRequest, getIdentity, isLoopback, validateOrigin } from "../src/security.js";

function request(headers = {}, remoteAddress = "127.0.0.1") {
  return { headers, socket: { remoteAddress } };
}

test("extracts the identity inserted by Tailscale Serve", () => {
  assert.deepEqual(getIdentity(request({ "tailscale-user-login": "Me@Example.com", "tailscale-user-name": "Me" })), {
    login: "me@example.com", name: "Me"
  });
});

test("requires an allowlisted Tailscale user", () => {
  const env = { AUTH_MODE: "tailscale", ALLOWED_TAILSCALE_USERS: "me@example.com" };
  assert.equal(authorizeRequest(request({ "tailscale-user-login": "me@example.com" }), env).login, "me@example.com");
  assert.throws(() => authorizeRequest(request({ "tailscale-user-login": "other@example.com" }), env));
  assert.throws(() => authorizeRequest(request(), env));
});

test("local development mode cannot be reached from the network", () => {
  assert.equal(isLoopback("::ffff:127.0.0.1"), true);
  assert.throws(() => authorizeRequest(request({}, "192.168.1.2"), { AUTH_MODE: "local" }));
});

test("production cannot start with local authentication or a network listener", () => {
  assert.throws(() => assertSafeConfiguration({ AUTH_MODE: "local", ALLOW_LOCAL_AUTH: "true", NODE_ENV: "production" }));
  assert.throws(() => assertSafeConfiguration({
    AUTH_MODE: "tailscale", HOST: "0.0.0.0", ALLOWED_TAILSCALE_USERS: "me@example.com", PUBLIC_ORIGIN: "https://host.example.ts.net"
  }));
});

test("Tailscale mode requires an allowlist and a bare HTTPS origin", () => {
  assert.equal(assertSafeConfiguration({
    AUTH_MODE: "tailscale", ALLOWED_TAILSCALE_USERS: "me@example.com", PUBLIC_ORIGIN: "https://host.example.ts.net:8443"
  }), true);
  assert.throws(() => assertSafeConfiguration({ AUTH_MODE: "tailscale", PUBLIC_ORIGIN: "https://host.example.ts.net" }));
  assert.throws(() => assertSafeConfiguration({
    AUTH_MODE: "tailscale", ALLOWED_TAILSCALE_USERS: "me@example.com", PUBLIC_ORIGIN: "http://host.example.ts.net"
  }));
});

test("checks browser origins in Tailscale mode", () => {
  const env = { AUTH_MODE: "tailscale", PUBLIC_ORIGIN: "https://host.example.ts.net:8443" };
  assert.equal(validateOrigin(request({ origin: env.PUBLIC_ORIGIN }), env), true);
  assert.throws(() => validateOrigin(request({ origin: "https://evil.example" }), env));
});
