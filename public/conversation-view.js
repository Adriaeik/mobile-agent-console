export function conversationSignature(messages) {
  let hash = 2166136261;
  for (const message of messages) {
    const text = `${message.id}|${message.role}|${message.text.length}|${message.text.slice(-256)}`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${messages.length}:${hash >>> 0}`;
}

export function shouldFollowConversation({ scrollTop, clientHeight, scrollHeight }, threshold = 80) {
  return scrollHeight <= clientHeight || scrollHeight - clientHeight - scrollTop <= threshold;
}
