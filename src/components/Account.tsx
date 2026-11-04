import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { supabase } from "../lib/supabase.ts"

type Identity = { kind: "anonymous" | "email" | "none"; email: string | null }

export default function Account() {
  const [identity, setIdentity] = useState<Identity>({ kind: "none", email: null })
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState<"bind" | "login" | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    let live = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!live) return
      const user = data.session?.user
      setIdentity({ kind: user?.is_anonymous ? "anonymous" : user ? "email" : "none", email: user?.email ?? null })
    })
    const sub = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user
      setIdentity({ kind: user?.is_anonymous ? "anonymous" : user ? "email" : "none", email: user?.email ?? null })
    }).data.subscription
    return () => {
      live = false
      sub.unsubscribe()
    }
  }, [])

  async function bind() {
    if (!supabase || !email.trim()) return
    setBusy("bind")
    setError(null)
    setNote(null)
    const { error: failure } = await supabase.auth.updateUser(
      { email: email.trim() },
      { emailRedirectTo: `${location.origin}/account` },
    )
    setBusy(null)
    if (failure) setError(failure.message)
    else setNote("确认邮件已发出。点邮件里的链接，这台浏览器上的记录就归到这个邮箱名下了。")
  }

  async function login() {
    if (!supabase || !email.trim()) return
    setBusy("login")
    setError(null)
    setNote(null)
    const { error: failure } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}/account` },
    })
    setBusy(null)
    if (failure) setError(failure.message)
    else setNote("登录链接已发出。在同一个浏览器里点开邮件里的链接，就会回到这个页面。")
  }

  if (!supabase) {
    return (
      <article className="max-w-xl">
        <p className="text-[11px] tracking-[0.22em] text-muted">账号</p>
        <h1 className="mt-4 font-serif text-3xl font-semibold leading-snug text-ink">这次部署没有连云端</h1>
        <p className="mt-4 text-sm leading-7 text-muted">记录只存在这台浏览器里。配置 Supabase 之后，才能把进度绑到邮箱上。</p>
        <Link to="/today" className="mt-8 inline-flex h-12 items-center text-sm text-ink underline decoration-line underline-offset-4">
          回到今天
        </Link>
      </article>
    )
  }

  return (
    <main className="sheet mx-auto min-h-svh max-w-xl px-5 py-14 sm:px-6 sm:py-20">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-[2px] bg-seal font-serif text-lg font-semibold leading-none text-paper">T</span>
          <span className="font-serif text-2xl font-bold leading-none tracking-wide text-ink">Testpass</span>
        </span>
        <Link to="/" className="text-xs text-muted hover:text-seal">
          回到首页
        </Link>
      </div>
      <article className="mt-12 max-w-xl">
        <p className="text-[11px] tracking-[0.22em] text-muted">账号</p>
        <h1 className="mt-4 font-serif text-3xl font-semibold leading-snug text-ink">
          {identity.kind === "email" ? `已绑定 ${identity.email ?? "邮箱"}` : "把进度存到一个邮箱上"}
        </h1>
      <p className="mt-4 text-sm leading-7 text-muted">
        {identity.kind === "email"
          ? "换设备时用同一个邮箱登录，练习记录、连续天数、实力曲线都会跟着过来。"
          : "现在是访客身份，记录只在这台浏览器里。绑一个邮箱，记录不用搬，原样归到账号下；换设备也能登录回来。"}
      </p>

      {identity.kind === "email" ? (
        <div className="mt-8 rounded-[2px] border border-line bg-card px-5 py-5">
          <p className="text-sm leading-6 text-ink">{identity.email}</p>
          <p className="mt-2 text-xs leading-6 text-muted">在别的设备上，用同一个邮箱拿到登录链接，就能接着练。</p>
        </div>
      ) : null}

      <label className="mt-8 block">
        <span className="text-xs tracking-[0.16em] text-muted">邮箱</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="mt-2 block w-full rounded-[2px] border border-line bg-card px-4 py-3 text-base text-ink placeholder:text-muted/70 focus:border-seal sm:text-sm"
        />
      </label>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy !== null || !email.trim()}
          onClick={() => void bind()}
          className="h-12 rounded-[2px] bg-seal px-6 text-sm text-paper hover:bg-[#742418] disabled:opacity-40"
        >
          {busy === "bind" ? "发送中…" : identity.kind === "email" ? "换绑这个邮箱" : "绑定邮箱，保住记录"}
        </button>
        <button
          type="button"
          disabled={busy !== null || !email.trim()}
          onClick={() => void login()}
          className="h-12 rounded-[2px] border border-line px-6 text-sm text-ink hover:border-seal disabled:opacity-40"
        >
          {busy === "login" ? "发送中…" : "已有账号，发登录链接"}
        </button>
      </div>

      {note && <p className="mt-5 rounded-[2px] border border-line bg-card px-4 py-3 text-sm leading-6 text-ink">{note}</p>}
      {error && (
        <p role="alert" className="mt-5 text-sm leading-6 text-seal">
          {error}
        </p>
      )}

      <p className="mt-10 text-xs leading-6 text-muted">
        绑定和不绑定都不影响今天做题。访客身份随浏览器保存，清掉浏览器数据就找不回来了；绑定邮箱之后才有找回的可能。
      </p>
      </article>
    </main>
  )
}
