/** Validate an opaque identifier already stored in Prism's library.
 * Provider ids include arXiv, DOI, PMC and local fingerprints, so this must not
 * impose one provider's alphabet. Paths are never derived from this raw value. */
export function isStoredPaperId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 3
    && value.length <= 400
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !/(?:^|[\\/])\.\.?($|[\\/])/.test(value)
}
