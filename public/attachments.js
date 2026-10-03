export function imageFilesFromClipboard(clipboardData) {
  return [...(clipboardData?.items || [])]
    .filter((item) => item.kind === "file" && item.type.toLowerCase().startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

export function appendImageReferences(value, uploads) {
  const paths = uploads.map((upload) => upload.path);
  if (!paths.length) return value;
  const reference = paths.length === 1
    ? `Attached image: ${paths[0]}`
    : `Attached images:\n${paths.map((filePath) => `- ${filePath}`).join("\n")}`;
  return value ? `${value}\n\n${reference}` : reference;
}
