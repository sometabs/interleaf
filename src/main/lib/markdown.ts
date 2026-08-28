import { toPlainText } from '../../shared/plaintext'

// Titles are stored and listed as plain text, so a bolded first line would
// otherwise read as `**Test**`.
export function deriveTitle(md: string, max = 120): string {
  for (const line of md.split(/\r?\n/)) {
    if (!line.trim()) continue
    const text = toPlainText(line)
    if (!text) continue
    return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text
  }
  return ''
}
