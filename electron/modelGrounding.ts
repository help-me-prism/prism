/** Generated prose is useful for recall, but must not be relabelled as a
 * researcher's original memo or primary evidence in another generation pass. */
export function withoutGeneratedProse(content: string) {
  return content.replace(/\r\n/g, '\n')
    .replace(/<!-- prism:reading-region ([a-z]+) -->[\s\S]*?<!-- \/prism:reading-region \1 -->/g, '')
    .replace(/<!-- prism:reading ([a-z0-9-]+) -->[\s\S]*?<!-- \/prism:reading \1 -->/g, '')
    .replace(/<!-- prism:auto ([a-z]+) -->[\s\S]*?<!-- \/prism:auto \1 -->/g, '')
    .replace(/^>\s*\[!ai\][^\n]*(?:\n>[^\n]*)*/gm, '')
}
