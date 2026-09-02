const [major, minor] = process.versions.node.split('.').map(Number)

if (major < 22 || (major === 22 && minor < 12)) {
  process.stderr.write(`Prism requires Node.js 22.12 or newer. Current version: ${process.version}\n`)
  process.stderr.write('Install the current Node.js LTS release, then run this launcher again.\n')
  process.exit(1)
}
