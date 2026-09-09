/** Read the editor and a cloned prefix Range with the same offset rules.
 * Evidence chips occupy no prompt characters; their visual labels are never
 * serialized as question text. Preserve blank lines so offsets cannot drift. */
export function readComposerDom(root: Node) {
  let text = ''
  const placements: Array<{ placementId: string; textOffset: number }> = []
  const walk = (node: Node) => {
    if (node.nodeType === 3) { text += (node.textContent ?? '').replaceAll('\u200B', ''); return }
    if (node.nodeType !== 1) return
    const element = node as Element
    const placementId = element.getAttribute('data-placement-id')
    if (placementId) { placements.push({ placementId, textOffset: text.length }); return }
    if (element.tagName === 'BR') { text += '\n'; return }
    if ((element.tagName === 'DIV' || element.tagName === 'P') && text.length > 0 && !text.endsWith('\n')) text += '\n'
    element.childNodes.forEach(walk)
  }
  root.childNodes.forEach(walk)
  return { text, placements }
}
