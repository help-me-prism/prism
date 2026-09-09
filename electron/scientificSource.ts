const greekLatex: Record<string, string> = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', θ: 'theta', λ: 'lambda', μ: 'mu', ν: 'nu', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega', Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Π: 'Pi', Σ: 'Sigma', Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega' }
/** Bounded lexical projection only. Geometry, not this function, decides position. */
export function scientificVariableLatex(text: string, position: 'sub' | 'super'): string | undefined {
  const match = /^([A-Za-zαβγδεθλμνπρστφχψωΓΔΘΛΠΣΦΨΩ])\s*([0-9]{1,3})$/u.exec(text)
  if (!match) return undefined
  const base = greekLatex[match[1]] ? '\\' + greekLatex[match[1]] : match[1]
  return `${base}${position === 'sub' ? '_' : '^'}{${match[2]}}`
}


export type ScientificSpan = { start: number; end: number; text: string; latex: string; baseline: number; rect: { left: number; top: number; width: number; height: number; fontSize: number } }
/** Metadata originates in verified PDF glyph extraction, never model output.
 * This rechecks the bounded lexical projection, not the original PDF baseline evidence. */
export function validatedScientificSpans(source: string, value: unknown): ScientificSpan[] {
  if (!Array.isArray(value) || value.length > 100 || !value.length) return []
  const spans: ScientificSpan[] = []; let previousEnd = 0
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') return []
    const s = candidate as ScientificSpan; const r = s.rect
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < previousEnd || s.end <= s.start || s.end > source.length
      || typeof s.text !== 'string' || s.text !== source.slice(s.start,s.end) || scientificVariableLatex(s.text,'sub') !== s.latex
      || !r || ![r.left,r.top,r.width,r.height,r.fontSize,s.baseline].every(Number.isFinite)
      || r.left < 0 || r.top < 0 || r.width <= 0 || r.height <= 0 || r.fontSize <= 0
      || r.width > 1000 || r.height > 1000 || r.fontSize > 1000 || s.baseline < r.top || s.baseline > r.top+r.height
      || /[\p{L}\p{N}_]/u.test(source.slice(Math.max(0,s.start-1),s.start)) || /[\p{L}\p{N}_]/u.test(source.slice(s.end,s.end+1))) return []
    spans.push({start:s.start,end:s.end,text:s.text,latex:s.latex,baseline:s.baseline,rect:{left:r.left,top:r.top,width:r.width,height:r.height,fontSize:r.fontSize}})
    previousEnd = s.end
  }
  return spans
}
export function validatedScientificSource(source: string, value: unknown): string {
  const spans = validatedScientificSpans(source,value)
  let result = ''; let from = 0
  for (const span of spans) { result += source.slice(from,span.start) + '$' + span.latex + '$'; from = span.end }
  return result + source.slice(from)
}

/** Plain preview labels cannot render TeX; use the same verified subscript semantics. */
export function scientificPreviewText(source: string, value: unknown): string {
  let result = ''; let from = 0
  for (const span of validatedScientificSpans(source, value)) {
    const digits = span.text.match(/[0-9]+$/)![0]
    result += source.slice(from, span.start) + span.text[0] + [...digits].map(digit => '₀₁₂₃₄₅₆₇₈₉'[Number(digit)]).join('')
    from = span.end
  }
  return result + source.slice(from)
}
