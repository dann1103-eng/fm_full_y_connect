/** Helper: insert text at a textarea's cursor, updating both DOM and state. */
export function insertAtCursor(
  textarea: HTMLTextAreaElement | null,
  current: string,
  text: string
): { next: string; caret: number } {
  if (!textarea) {
    return { next: current + text, caret: current.length + text.length }
  }
  const start = textarea.selectionStart ?? current.length
  const end = textarea.selectionEnd ?? current.length
  const next = current.slice(0, start) + text + current.slice(end)
  return { next, caret: start + text.length }
}
