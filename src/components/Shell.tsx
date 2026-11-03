import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { examById } from "../engine/catalog.ts"
import { useRecord } from "../lib/useRecord.tsx"
import { cn } from "../lib/cn.ts"

const LINKS = [
  { to: "/today", label: "今日" },
  { to: "/talk", label: "对话" },
  { to: "/mock", label: "模拟" },
  { to: "/progress", label: "实力" },
]

export default function Shell() {
  const { state, reset } = useRecord()
  const navigate = useNavigate()
  const talk = useLocation().pathname === "/talk"
  if (!state) return null
  const exam = examById(state.examId)

  return (
    <div className={cn("flex min-h-svh flex-col", talk ? "h-dvh overflow-hidden" : "overflow-x-clip")}>
      <header className="sheet mx-auto w-full max-w-3xl shrink-0 px-5 pt-5 sm:px-6 sm:pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[2px] bg-seal font-serif text-lg font-semibold leading-none text-paper shadow-[inset_0_0_0_1px_rgba(243,236,223,0.55)]"
            >
              T
            </span>
            <div className="min-w-0">
              <p className="font-serif text-2xl font-bold leading-none tracking-wide text-ink">Testpass</p>
              <p className="mt-1.5 font-serif text-[13px] tracking-[0.08em] text-muted">AI考试通过助手</p>
            </div>
          </div>
          <button
            type="button"
            className="mt-1 shrink-0 px-1 py-1 text-xs text-muted hover:text-seal"
            onClick={() => {
              reset()
              navigate("/")
            }}
          >
            重新设定
          </button>
        </div>
        <div className="mt-5 flex items-stretch justify-between gap-3 border-b border-line">
          <nav className="flex shrink-0 gap-0.5 sm:gap-1" aria-label="主要页面">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    "-mb-px inline-flex h-12 shrink-0 items-center whitespace-nowrap border-b-2 px-2 text-sm sm:px-3",
                    isActive ? "border-seal font-medium text-ink" : "border-transparent text-muted hover:text-ink",
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
          <p className="flex h-12 min-w-0 items-center truncate pl-2 text-xs tracking-wide text-muted">{exam.name}</p>
        </div>
      </header>
      <main
        className={cn(
          "sheet mx-auto w-full max-w-3xl px-5 sm:px-6",
          talk ? "flex min-h-0 min-w-0 flex-1 flex-col pt-6" : "py-10 sm:py-12",
        )}
      >
        <Outlet />
      </main>
    </div>
  )
}
