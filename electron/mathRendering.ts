/** Remove document-only metadata and restore the alignment environment that the
 * structure parser intentionally strips from display-equation bodies. */
export function displayMathForPreview(source: string) {
  let math = source.trim().replace(/^\$\$([\s\S]*)\$\$$/, '$1').replace(/^\\\[([\s\S]*)\\\]$/, '$1')
    .replace(/\\label\s*\{[^{}]*\}/g, '')
    .replace(/\\(?:nonumber|notag)\b/g, '')
    .trim()
  if (!/\\begin\s*\{/.test(math) && (math.includes('&') || /\\\\(?:\s|$)/.test(math))) math = `\\begin{aligned}${math}\\end{aligned}`
  return math
}
