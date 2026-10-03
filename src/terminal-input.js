const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function submitTerminalInput(terminal, value, pause = delay) {
  const text = value.includes("\n") ? `\u001b[200~${value}\u001b[201~` : value;
  terminal.write(text);
  // Current agent TUIs can interpret text and Enter received in one PTY write as
  // a paste, leaving the text in the editor instead of submitting it.
  await pause(50);
  terminal.write("\r");
}
