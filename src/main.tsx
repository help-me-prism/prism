import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/noto-serif-kr'
import App from './App'
import NotesWindow from './NotesWindow'
import './styles.css'

class AppErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Prism renderer error stack: ${error.stack ?? error.message}`)
    console.error(`Prism component stack: ${info.componentStack ?? 'unavailable'}`)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="fatal-error">
          <div>
            <img className="brand-mark" src="./icon.png" alt="" />
            <h1>화면을 표시하지 못했어요</h1>
            <p>{this.state.error.message}</p>
            <button onClick={() => window.location.reload()}>앱 다시 불러오기</button>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>{new URLSearchParams(window.location.search).get('view') === 'notes' ? <NotesWindow /> : <App />}</AppErrorBoundary>
  </StrictMode>,
)
