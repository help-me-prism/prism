type WikiNode = { id: string; title: string; relativePath: string; aliases?: string[] }
const normalized = (value: string) => value.replaceAll('\\', '/').replace(/\.md$/i, '').trim().toLocaleLowerCase()

/** Resolve once by precedence, never choose an arbitrary duplicate title/alias. */
export function wikiTargetResolver<T extends WikiNode>(nodes: T[]) {
  const indexes = Array.from({ length: 5 }, () => new Map<string, Map<string, T>>())
  const add = (tier: number, key: string, node: T) => {
    if (!key) return
    const matches = indexes[tier].get(key) ?? new Map<string, T>()
    matches.set(node.id, node); indexes[tier].set(key, matches)
  }
  for (const node of nodes) {
    const route = normalized(node.relativePath)
    add(0, node.id, node); add(1, route, node); add(2, normalized(node.title), node)
    add(3, route.split('/').at(-1)!, node)
    for (const alias of node.aliases ?? []) add(4, normalized(alias), node)
  }
  return (target: string): T | undefined => {
    const raw = target.split('|', 1)[0].split('#', 1)[0].trim()
    const key = normalized(raw)
    if (!key) return undefined
    for (let tier = 0; tier < indexes.length; tier++) {
      if (tier === 3 && key.includes('/')) continue
      const matches = indexes[tier].get(tier === 0 ? raw : key)
      if (matches) return matches.size === 1 ? matches.values().next().value : undefined
    }
    return undefined
  }
}
