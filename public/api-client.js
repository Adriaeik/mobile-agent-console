const VERSION_MISMATCH_MESSAGE = "The server is running an older version. Restart the console service, then reload this page.";

export async function readApiResponse(response) {
  if (response.status === 204) return null;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("json")) {
    throw new Error(VERSION_MISMATCH_MESSAGE);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The server returned invalid JSON. Reload this page and try again.");
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return payload;
}

export async function request(url, options = {}) {
  const { headers = {}, ...requestOptions } = options;
  const response = await fetch(url, {
    ...requestOptions,
    headers: { "Content-Type": "application/json", ...headers }
  });
  return readApiResponse(response);
}
