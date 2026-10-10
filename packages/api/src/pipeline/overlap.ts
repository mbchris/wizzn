/** Lower-cased words without punctuation; digits and umlauts survive ("0,8" → "08") */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFC')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
}

/**
 * Longest run of consecutive words the draft shares with any source excerpt (issue #4 licensing guard).
 * Classic longest-common-substring DP over word arrays; excerpts are ≤ 8 000 chars so O(n·m) is cheap.
 */
export function longestSharedRun(draft: string, excerpts: string[]): number {
  const a = tokens(draft)
  let best = 0
  for (const excerpt of excerpts) {
    const b = tokens(excerpt)
    let prev = new Array<number>(b.length + 1).fill(0)
    for (let i = 1; i <= a.length; i++) {
      const cur = new Array<number>(b.length + 1).fill(0)
      for (let j = 1; j <= b.length; j++) {
        if (a[i - 1] === b[j - 1]) {
          cur[j] = prev[j - 1]! + 1
          if (cur[j]! > best) best = cur[j]!
        }
      }
      prev = cur
    }
  }
  return best
}
