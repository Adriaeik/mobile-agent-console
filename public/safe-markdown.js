function inlineContent(text) {
  const content = [];
  const pattern = /`([^`\n]+)`/g;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) content.push({ type: "text", value: text.slice(offset, match.index) });
    content.push({ type: "code", value: match[1] });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) content.push({ type: "text", value: text.slice(offset) });
  return content.length ? content : [{ type: "text", value: "" }];
}

function startsBlock(line) {
  return /^```/.test(line) || /^#{1,3}\s+/.test(line) || /^\s*(?:[-*]|\d+\.)\s+/.test(line);
}

export function parseSafeMarkdown(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([A-Za-z0-9_+-]{0,24})\s*$/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language: fence[1], value: code.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, content: inlineContent(heading[2]) });
      index += 1;
      continue;
    }

    const list = line.match(/^\s*(?:(\d+)\.|([-*]))\s+(.+)$/);
    if (list) {
      const ordered = Boolean(list[1]);
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:(\d+)\.|([-*]))\s+(.+)$/);
        if (!item || Boolean(item[1]) !== ordered) break;
        items.push(inlineContent(item[3]));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) paragraph.push(lines[index++]);
    blocks.push({ type: "paragraph", content: inlineContent(paragraph.join("\n")) });
  }
  return blocks;
}

function appendInline(element, content, documentRef) {
  for (const token of content) {
    if (token.type === "code") {
      const code = documentRef.createElement("code");
      code.textContent = token.value;
      element.append(code);
    } else {
      element.append(documentRef.createTextNode(token.value));
    }
  }
}

export function renderSafeMarkdown(root, value, documentRef = root.ownerDocument) {
  const fragment = documentRef.createDocumentFragment();
  for (const block of parseSafeMarkdown(value)) {
    if (block.type === "code") {
      const pre = documentRef.createElement("pre");
      const code = documentRef.createElement("code");
      if (block.language) code.dataset.language = block.language;
      code.textContent = block.value;
      pre.append(code);
      fragment.append(pre);
      continue;
    }
    if (block.type === "list") {
      const list = documentRef.createElement(block.ordered ? "ol" : "ul");
      for (const item of block.items) {
        const entry = documentRef.createElement("li");
        appendInline(entry, item, documentRef);
        list.append(entry);
      }
      fragment.append(list);
      continue;
    }
    const element = documentRef.createElement(block.type === "heading" ? `h${block.level}` : "p");
    appendInline(element, block.content, documentRef);
    fragment.append(element);
  }
  root.replaceChildren(fragment);
}
