// Playwright and subprocess errors can include the entire request or command.
// Keep diagnostics useful without logging signed replay links or request headers.
export function safeMessage(value) {
  return String(value).split(/\r?\n\s*Call log:/i)[0]
    .replace(/https?:\/\/[^\s<>"']+/gi, '[链接已隐藏]');
}
