import { useState } from "react"
import { Link } from "react-router-dom"

export function UnlockPanel({
  title = "这个功能要验证一下身份",
  hint = "输入邀请码就能用，不用注册。",
  onUnlock,
}: {
  title?: string
  hint?: string
  onUnlock: (code: string) => Promise<boolean>
}) {
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="mt-5 rounded-[2px] border border-line bg-card px-4 py-4">
      <p className="text-sm text-ink">{title}</p>
      <p className="mt-1 text-xs leading-6 text-muted">{hint}</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!code.trim() || busy) return
          setBusy(true)
          setError(null)
          void onUnlock(code).then((ok) => {
            setBusy(false)
            if (!ok) setError("这个码不对，或者已经失效。")
          })
        }}
      >
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="邀请码"
          aria-label="邀请码"
          className="h-11 min-w-0 flex-1 rounded-[2px] border border-line bg-paper px-3 text-sm text-ink placeholder:text-muted/70 focus:border-seal"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="h-11 shrink-0 rounded-[2px] bg-seal px-4 text-sm text-paper disabled:opacity-40"
        >
          {busy ? "验证中…" : "解锁"}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-seal">{error}</p>}
      <p className="mt-3 text-xs leading-6 text-muted">
        没有码？
        <Link to="/account" className="ml-1 text-ink underline decoration-line underline-offset-4 hover:decoration-seal">
          绑定邮箱
        </Link>
        ，同样能用，而且进度跟账号走。
      </p>
    </div>
  )
}
