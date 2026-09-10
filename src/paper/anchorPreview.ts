/** Keep compact PDF text/table crops across restarts. Figure originals already
 * have a durable file and are loaded lazily, so embedding them would duplicate
 * large image data in chat/session storage. */
export function durableAnchorPreview(anchor: ContextAnchor): ContextAnchor {
  if (anchor.type === 'figure' || !anchor.preview || anchor.preview.length > 350_000) {
    const { preview: _preview, ...durable } = anchor
    return durable
  }
  return anchor
}
