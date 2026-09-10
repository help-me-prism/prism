/** The copy IPC reads the source on disk. Flush its draft first, and do not copy an
 * older snapshot if the user changes the source again while that save is pending. */
export async function copySavedEvidence<T>(saveSource: () => Promise<boolean>, sourceStillCurrent: () => boolean, copy: () => Promise<T>): Promise<T | undefined> {
  if (!(await saveSource()) || !sourceStillCurrent()) return undefined
  return copy()
}
