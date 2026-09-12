import type { FigureRect } from './figureGeometry'
type Matrix = number[]
type State = { matrix: Matrix; clip: FigureRect }
const intersection = (a: FigureRect, b: FigureRect): FigureRect => {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top)
  return { left, top, width: Math.max(0, Math.min(a.left + a.width, b.left + b.width) - left), height: Math.max(0, Math.min(a.top + a.height, b.top + b.height) - top) }
}
function bounds(values: ArrayLike<number>, matrix: Matrix): FigureRect {
  const [x0, y0, x1, y1] = Array.from(values)
  const points = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [x * matrix[0] + y * matrix[2] + matrix[4], x * matrix[1] + y * matrix[3] + matrix[5]])
  const left = Math.min(...points.map(p => p[0])), top = Math.min(...points.map(p => p[1]))
  return { left, top, width: Math.max(...points.map(p => p[0])) - left, height: Math.max(...points.map(p => p[1])) - top }
}
/** Mirror PDF graphics-state scopes, including Form XObjects (implicit save/restore). */
export function pdfGraphicRects(operators: { fnArray: number[]; argsArray: unknown[][] }, viewport: { transform: number[]; width: number; height: number }, { OPS, Util }: { OPS: Record<string, number>; Util: { transform: (a: number[], b: number[]) => number[] } }) {
  let state: State = { matrix: [1, 0, 0, 1, 0, 0], clip: { left: 0, top: 0, width: viewport.width, height: viewport.height } }
  const stack: State[] = [], images: FigureRect[] = [], vectors: FigureRect[] = []
  const save = () => stack.push({ matrix: [...state.matrix], clip: { ...state.clip } })
  const transform = (matrix: unknown) => { if (Array.isArray(matrix) && matrix.length === 6) state.matrix = Util.transform(state.matrix, matrix) }
  const project = (values: ArrayLike<number>) => bounds(values, Util.transform(viewport.transform, state.matrix))
  const add = (target: FigureRect[], rect: FigureRect) => { const clipped = intersection(rect, state.clip); if (Object.values(clipped).every(Number.isFinite) && (clipped.width > 0 || clipped.height > 0)) target.push(clipped) }
  for (let index = 0; index < operators.fnArray.length; index++) {
    const operation = operators.fnArray[index], args = operators.argsArray[index] ?? []
    if (operation === OPS.save) save()
    else if (operation === OPS.restore || operation === OPS.paintFormXObjectEnd) state = stack.pop() ?? state
    else if (operation === OPS.transform) transform(args)
    else if (operation === OPS.paintFormXObjectBegin) {
      save(); transform(args[0])
      if (args[1]) state.clip = intersection(state.clip, project(args[1] as ArrayLike<number>))
    } else if (operation === OPS.constructPath && ![OPS.endPath, OPS.clip, OPS.eoClip].includes(args[0] as number) && args[2]) {
      const values = Array.from(args[2] as ArrayLike<number>)
      if (values.length === 4 && values.every(Number.isFinite)) add(vectors, project(values))
    } else if ([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].includes(operation)) add(images, project([0, 0, 1, 1]))
  }
  // Printer/page frame rules span the page and would connect every nearby
  // panel into one enormous box, which is subsequently rejected as background.
  return { images, vectors: vectors.filter(rect => !(rect.width > viewport.width * .8 && rect.height < viewport.height * .003)
    && !(rect.height > viewport.height * .8 && rect.width < viewport.width * .003)) }
}
