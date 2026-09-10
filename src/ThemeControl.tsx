import { useSyncExternalStore } from 'react'

type Theme = 'system' | 'light' | 'dark'
const key = 'prism.appearance'
function read(): Theme {
  const value = localStorage.getItem(key)
  return value === 'light' || value === 'dark' ? value : 'system'
}
export function applyTheme() {
  const theme = read()
  document.documentElement.style.colorScheme = theme === 'system' ? 'light dark' : theme
  document.documentElement.dataset.theme = theme
  const resolved = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
  void window.prism?.setAppearance?.(resolved).catch(() => {})
}
function subscribe(callback: () => void) {
  const update = () => { applyTheme(); callback() }
  window.addEventListener('storage', update)
  window.addEventListener('prism-theme', update)
  return () => { window.removeEventListener('storage', update); window.removeEventListener('prism-theme', update) }
}
export default function ThemeControl() {
  const theme = useSyncExternalStore(subscribe, read)
  return <label className="theme-control"><span>화면 테마</span><select aria-label="화면 테마" value={theme} onChange={event => {
    localStorage.setItem(key, event.target.value); window.dispatchEvent(new Event('prism-theme'))
  }}><option value="system">시스템 설정</option><option value="light">라이트</option><option value="dark">다크</option></select></label>
}
