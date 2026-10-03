import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { InputError } from "./validation.js";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const IMAGE_TYPES = {
  "image/png": { extension: ".png", matches: (data) => data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/jpeg": { extension: ".jpg", matches: (data) => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff },
  "image/gif": { extension: ".gif", matches: (data) => ["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii")) },
  "image/webp": { extension: ".webp", matches: (data) => data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP" },
};

export function validateImageUpload(contentType, data) {
  const type = String(contentType || "").split(";", 1)[0].trim().toLowerCase();
  const image = IMAGE_TYPES[type];
  if (!image) throw new InputError("Unsupported image type. Use PNG, JPEG, GIF or WebP.", 415);
  if (!Buffer.isBuffer(data) || data.length === 0) throw new InputError("The image is empty.");
  if (data.length > MAX_IMAGE_BYTES) throw new InputError("The image is too large (10 MB maximum).", 413);
  if (!image.matches(data)) throw new InputError("The file contents do not match the declared image type.");
  return { extension: image.extension, type };
}

export function defaultUploadRoot(env = process.env) {
  const dataHome = env.XDG_DATA_HOME || path.join(env.HOME || os.homedir(), ".local", "share");
  return path.join(dataHome, "mobile-agent-console-data", "uploads");
}

export async function saveImageUpload({ sessionId, contentType, data, root = defaultUploadRoot(), id = randomUUID() }) {
  if (!/^\$[0-9]+$/.test(sessionId)) throw new InputError("Invalid tmux session id.");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new InputError("Invalid upload id.");
  const { extension, type } = validateImageUpload(contentType, data);
  const directory = path.join(root, `session-${sessionId.slice(1)}`);
  const name = `${id}${extension}`;
  const filePath = path.join(directory, name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(filePath, data, { flag: "wx", mode: 0o600 });
  return { path: filePath, name, type, size: data.length };
}
