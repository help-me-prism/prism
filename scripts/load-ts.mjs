// Loads a TypeScript source file for a test or audit script without a build.
//
// The scripts used to inline this as `import('data:...' + base64(code))`, which
// works only while the file imports nothing of its own: a data: URL has no
// directory, so Node cannot resolve './sibling' from inside one. The first time
// a rule was lifted out of textExtraction.ts into its own module, twelve scripts
// failed at once for that reason and nothing was actually wrong with the code.
//
// Relative specifiers are therefore resolved here and inlined as nested data
// URLs, depth first, so a module graph of any shape loads the same way the
// bundler would. Absolute and bare specifiers ('node:fs', 'vite') are left for
// Node to resolve normally.
import fs from 'node:fs/promises'
import path from 'node:path'
import { transformWithOxc } from 'vite'

const cache = new Map()
const extensions = ['', '.ts', '.tsx', '.mts', '.js', '/index.ts', '/index.tsx']

async function resolveRelative(specifier, fromFile) {
  const base = path.resolve(path.dirname(fromFile), specifier)
  for (const extension of extensions) {
    const candidate = base + extension
    try {
      if ((await fs.stat(candidate)).isFile()) return candidate
    } catch { /* try the next extension */ }
  }
  throw new Error(`cannot resolve ${specifier} from ${fromFile}`)
}

/** Builds the data: URL for one file, inlining its relative dependencies. */
async function dataUrlFor(file) {
  const absolute = path.resolve(file)
  const cached = cache.get(absolute)
  if (cached) return cached
  const promise = (async () => {
    const { code } = await transformWithOxc(await fs.readFile(absolute, 'utf8'), absolute)
    // Matches the specifier of a static import/export, which is all the compiled
    // output emits. Dynamic import() in these modules would need the same
    // treatment, and there is none today.
    const pattern = /(\bfrom\s*|\bimport\s*)(['"])(\.\.?\/[^'"]+)\2/g
    const specifiers = [...code.matchAll(pattern)].map(match => match[3])
    const resolved = new Map()
    for (const specifier of new Set(specifiers)) resolved.set(specifier, await dataUrlFor(await resolveRelative(specifier, absolute)))
    const rewritten = code.replace(pattern, (whole, keyword, quote, specifier) => `${keyword}${quote}${resolved.get(specifier) ?? specifier}${quote}`)
    return 'data:text/javascript;base64,' + Buffer.from(rewritten).toString('base64')
  })()
  cache.set(absolute, promise)
  return promise
}

/** Imports a .ts/.tsx file and returns its module namespace. */
export async function loadTs(file) {
  return import(await dataUrlFor(file))
}

export default loadTs
