/**
 * A force layout small enough to read in one sitting, so the vault graph needs no dependency.
 *
 * Two properties matter more than physical accuracy. The starting positions come from a hash of the node id,
 * so the same vault opens in the same shape every time — a graph that reshuffles on every open is a graph
 * nobody can recognise. And repulsion runs over a grid rather than every pair, so a thousand-node vault costs
 * roughly what a hundred-node one does per tick.
 */

export type SimulationNode = { id: string; x: number; y: number; vx: number; vy: number; radius: number; degree: number; pinned: boolean }
export type SimulationEdge = { sourceId: string; targetId: string }
export type SimulationOptions = { width: number; height: number; linkDistance?: number; charge?: number; gravity?: number }

const DECAY = 0.978
const DAMPING = 0.82
const SETTLED = 0.02

/** FNV-1a, folded into the unit interval: the same id always lands in the same place. */
function unitHash(id: string, salt: number) {
  let hash = 2166136261 ^ salt
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619)
  return ((hash >>> 0) % 100000) / 100000
}

export function seedPosition(id: string, width: number, height: number) {
  // A phyllotaxis-like spread: hashes alone clump, and a clumped start takes many more ticks to open up.
  const angle = unitHash(id, 0) * Math.PI * 2
  const radius = Math.sqrt(unitHash(id, 77)) * Math.min(width, height) * 0.36
  return { x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius }
}

export class GraphSimulation {
  nodes: SimulationNode[] = []
  byId = new Map<string, SimulationNode>()
  edges: SimulationEdge[] = []
  alpha = 1
  private width: number
  private height: number
  private linkDistance: number
  private charge: number
  private gravity: number

  constructor(options: SimulationOptions) {
    this.width = options.width
    this.height = options.height
    // Repulsion and centring have to balance at roughly the link distance, or every node collapses onto the
    // middle: gravity grows with distance and a 1/d^2 push cannot answer it. charge ~= linkDistance^3 * gravity.
    this.linkDistance = options.linkDistance ?? 60
    this.charge = options.charge ?? 2200
    this.gravity = options.gravity ?? 0.01
  }

  resize(width: number, height: number) {
    if (width === this.width && height === this.height) return
    this.width = width; this.height = height
    this.reheat(0.5)
  }

  /** Keeps the position of every node that is still here, so a filter change moves the graph instead of redrawing it. */
  setGraph(nodes: Array<{ id: string; radius: number; degree: number }>, edges: SimulationEdge[]) {
    const next = new Map<string, SimulationNode>()
    for (const node of nodes) {
      const previous = this.byId.get(node.id)
      const seed = previous ?? { ...seedPosition(node.id, this.width, this.height), vx: 0, vy: 0, pinned: false }
      next.set(node.id, { id: node.id, x: seed.x, y: seed.y, vx: seed.vx, vy: seed.vy, pinned: seed.pinned, radius: node.radius, degree: node.degree })
    }
    const changed = next.size !== this.byId.size || [...next.keys()].some((id) => !this.byId.has(id))
    this.byId = next
    this.nodes = [...next.values()]
    this.edges = edges.filter((edge) => next.has(edge.sourceId) && next.has(edge.targetId))
    if (changed) this.reheat(1)
    else this.reheat(Math.max(this.alpha, 0.35))
  }

  reheat(value = 1) { this.alpha = Math.max(this.alpha, value) }
  get settled() { return this.alpha < SETTLED }

  pin(id: string, x: number, y: number) {
    const node = this.byId.get(id)
    if (!node) return
    node.pinned = true; node.x = x; node.y = y; node.vx = 0; node.vy = 0
    this.reheat(0.4)
  }
  release(id: string) { const node = this.byId.get(id); if (node) node.pinned = false }

  tick() {
    if (this.settled) return this.alpha
    const alpha = this.alpha
    const cell = Math.max(this.linkDistance * 2.4, 60)
    const buckets = new Map<number, SimulationNode[]>()
    const key = (x: number, y: number) => (Math.floor(x / cell) + 8192) * 65536 + Math.floor(y / cell) + 8192
    for (const node of this.nodes) {
      const bucketKey = key(node.x, node.y)
      const bucket = buckets.get(bucketKey)
      if (bucket) bucket.push(node); else buckets.set(bucketKey, [node])
    }

    // Repulsion, each pair once, and only for pairs close enough to matter.
    for (const node of this.nodes) {
      for (let column = -1; column <= 1; column += 1) {
        for (let row = -1; row <= 1; row += 1) {
          for (const other of buckets.get(key(node.x + column * cell, node.y + row * cell)) ?? []) {
            if (other.id <= node.id) continue
            let dx = other.x - node.x
            let dy = other.y - node.y
            let distanceSquared = dx * dx + dy * dy
            if (distanceSquared > cell * cell) continue
            if (distanceSquared < 0.01) {
              // Two nodes exactly on top of each other have no direction to separate along; the hash gives one.
              dx = unitHash(node.id, 3) - 0.5; dy = unitHash(other.id, 5) - 0.5
              distanceSquared = dx * dx + dy * dy || 0.01
            }
            const push = this.charge * alpha / distanceSquared
            const distance = Math.sqrt(distanceSquared)
            const fx = dx / distance * push
            const fy = dy / distance * push
            node.vx -= fx; node.vy -= fy
            other.vx += fx; other.vy += fy
          }
        }
      }
    }

    // Springs: an edge wants to be one link-distance long, and a well-connected node holds on more loosely.
    for (const edge of this.edges) {
      const source = this.byId.get(edge.sourceId)!
      const target = this.byId.get(edge.targetId)!
      const dx = target.x - source.x
      const dy = target.y - source.y
      const distance = Math.sqrt(dx * dx + dy * dy) || 0.01
      const ideal = this.linkDistance + source.radius + target.radius
      const strength = 0.09 * alpha / (1 + Math.min(source.degree, target.degree) * 0.12)
      const force = (distance - ideal) * strength
      const fx = dx / distance * force
      const fy = dy / distance * force
      source.vx += fx; source.vy += fy
      target.vx -= fx; target.vy -= fy
    }

    const centerX = this.width / 2
    const centerY = this.height / 2
    for (const node of this.nodes) {
      if (node.pinned) { node.vx = 0; node.vy = 0; continue }
      node.vx += (centerX - node.x) * this.gravity * alpha
      node.vy += (centerY - node.y) * this.gravity * alpha
      node.vx *= DAMPING; node.vy *= DAMPING
      node.x += node.vx; node.y += node.vy
    }

    this.alpha *= DECAY
    return this.alpha
  }

  /** Runs the layout to rest without drawing — used before the first paint so nothing is seen exploding. */
  settle(maxTicks = 220) { for (let index = 0; index < maxTicks && !this.settled; index += 1) this.tick() }

  /** The drawn extent, so a view can fit the graph rather than guess a zoom. */
  bounds() {
    if (!this.nodes.length) return { minX: 0, minY: 0, maxX: this.width, maxY: this.height }
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
    for (const node of this.nodes) {
      minX = Math.min(minX, node.x - node.radius); minY = Math.min(minY, node.y - node.radius)
      maxX = Math.max(maxX, node.x + node.radius); maxY = Math.max(maxY, node.y + node.radius)
    }
    return { minX, minY, maxX, maxY }
  }
}
