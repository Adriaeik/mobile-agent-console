export function shouldSubmitComposerKey(event) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}

export function messagePayload(value) {
  if (!value) return null;
  return { type: "submit-input", data: value };
}
