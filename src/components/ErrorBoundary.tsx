import { Component, type ReactNode } from "react"

interface State {
  failed: boolean
}

/** A render error should show a way back, not a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="sheet mx-auto min-h-svh max-w-xl px-5 py-24 sm:px-6">
        <p className="text-[11px] tracking-[0.28em] text-muted">出错了</p>
        <h1 className="mt-5 font-serif text-3xl font-semibold leading-snug text-ink">这一页没画出来</h1>
        <p className="mt-4 text-sm leading-7 text-muted">练习记录还在本机或云端，重新载入一般就能继续。</p>
        <button
          type="button"
          className="mt-8 h-12 rounded-[2px] bg-seal px-6 text-sm text-paper hover:bg-[#742418]"
          onClick={() => location.reload()}
        >
          重新载入
        </button>
      </main>
    )
  }
}
