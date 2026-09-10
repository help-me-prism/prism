export type MonotoneMatch = { leftIndex: number; rightIndex: number }

/** Maximum-score order-preserving alignment. Weak or missing entries on either
 * side are skipped instead of shifting every equation that follows. */
export function monotoneMatches(scores: number[][], threshold: number): MonotoneMatch[] {
  const rows = scores.length
  const columns = scores.reduce((maximum, row) => Math.max(maximum, row.length), 0)
  const dp = Array.from({ length: rows + 1 }, () => Array<number>(columns + 1).fill(0))
  const choice = Array.from({ length: rows + 1 }, () => Array<'left' | 'right' | 'match'>(columns + 1).fill('left'))
  for (let row = 1; row <= rows; row += 1) for (let column = 1; column <= columns; column += 1) {
    const skipLeft = dp[row - 1][column]
    const skipRight = dp[row][column - 1]
    const score = scores[row - 1]?.[column - 1] ?? Number.NEGATIVE_INFINITY
    const match = score >= threshold ? dp[row - 1][column - 1] + score : Number.NEGATIVE_INFINITY
    if (match >= skipLeft && match >= skipRight) { dp[row][column] = match; choice[row][column] = 'match' }
    else if (skipRight > skipLeft) { dp[row][column] = skipRight; choice[row][column] = 'right' }
    else { dp[row][column] = skipLeft; choice[row][column] = 'left' }
  }
  const matches: MonotoneMatch[] = []
  for (let row = rows, column = columns; row > 0 && column > 0;) {
    const selected = choice[row][column]
    if (selected === 'match') { matches.push({ leftIndex: row - 1, rightIndex: column - 1 }); row -= 1; column -= 1 }
    else if (selected === 'right') column -= 1
    else row -= 1
  }
  return matches.reverse()
}
