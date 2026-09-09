/** Identity-scoped, latest-request-wins guard, including A→B→A transitions. */
export function createContextRequestGate<T>() {
  let owner: T | undefined
  let generation = 0
  return {
    setOwner(next: T) { if (owner !== next) { owner = next; generation++ } },
    invalidate() { generation++ },
    begin(scope: T) { const request = ++generation; return () => owner === scope && request === generation },
  }
}

/** Ignore allocation/order and mtime-only changes; include every note's content revision
 * because another note can add/remove a backlink without changing the active note. */
export function noteContextSignature(nodes: Array<{ id: string; revision: string; title: string; nodeType: string; relativePath: string; arxivId?: string }>) {
  return JSON.stringify(nodes.map(node => [node.id, node.revision, node.title, node.nodeType, node.relativePath, node.arxivId ?? ''])
    .sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
}
