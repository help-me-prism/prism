# Obsidian Vault interoperability contract

## Use case

From a knowledge note or one of its block-addressable evidence cards, the Notes window can ask the main process to open the same source Markdown location in Obsidian. The renderer never constructs filesystem paths or launches external protocols itself.

## Request

```ts
type ObsidianOpenRequest = {
  nodeId: string
  heading?: string
  blockId?: string
}
```

- `nodeId` is the stable `prism_id` of an existing knowledge node.
- `heading` and `blockId` are optional and mutually exclusive.
- A block ID excludes the leading `^`; the URI builder adds the Obsidian `#^block-id` suffix.
- A heading excludes the leading `#`; the URI builder adds the `#Heading` suffix.

## URI and path rules

- The main process resolves the node from its Vault-relative `/` path and verifies that the result remains inside the selected library.
- It invokes `obsidian://open?path=<encoded absolute path and optional fragment>`. The URI is ephemeral and is never written into Markdown or relation sidecars.
- Every parameter value is percent-encoded. Heading and block fragments are encoded as part of the `path` value, matching the official Obsidian URI navigation format.
- Windows and macOS use their native absolute path only at launch time. Stored Markdown links remain Vault-relative and always use `/` separators.
- Absolute renderer-supplied paths, `..` traversal, malformed IDs, and simultaneous heading/block targets are rejected.

## Failure behavior

- A missing knowledge node or invalid target fails without launching any external application.
- Protocol launch errors are returned to the Notes UI and do not modify Markdown.
- Obsidian is optional. All Prism editing, linking, search, graph, and data-view behavior remains available without it.
