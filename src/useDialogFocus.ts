import { useEffect } from 'react'

/** Trap keyboard navigation inside a modal, including when its controls change. */
export function useDialogFocus(open: boolean, selector: string, fallback?: string) {
  useEffect(() => {
    if (!open) return
    const dialog = document.querySelector<HTMLElement>(selector)
    if (!dialog) return
    const previous = document.activeElement as HTMLElement | null
    const controls = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter(element => element.getClientRects().length > 0)
    if (!dialog.contains(document.activeElement)) controls()[0]?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = controls(); const index = items.indexOf(document.activeElement as HTMLElement)
      if (!items.length) { event.preventDefault(); return }
      if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus() }
      else if (!event.shiftKey && (index === items.length - 1 || index < 0)) { event.preventDefault(); items[0].focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      if (previous?.isConnected && !dialog.contains(previous)) previous.focus()
      else if (fallback) document.querySelector<HTMLElement>(fallback)?.focus()
    }
  }, [open, selector, fallback])
}
