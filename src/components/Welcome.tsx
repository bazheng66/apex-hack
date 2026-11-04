import { useNavigate } from "react-router-dom"
import { useRecord } from "../lib/useRecord.tsx"
import { CompanionFigure } from "./Companion.tsx"
import { SyncNotice } from "./SyncNotice.tsx"

export default function Welcome() {
  const navigate = useNavigate()
  const { demo } = useRecord()

  return (
    <main className="sheet mx-auto flex min-h-svh max-w-3xl flex-col justify-center px-5 py-14 sm:px-8">
      <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_15rem] md:gap-x-10 md:gap-y-0">
        <div className="md:col-start-1 md:row-start-1">
          <span
            aria-hidden="true"
            className="grid h-12 w-12 place-items-center rounded-[2px] bg-seal font-serif text-2xl font-semibold leading-none text-paper shadow-[inset_0_0_0_1px_rgba(243,236,223,0.55)]"
          >
            T
          </span>
          <h1 className="mt-6 font-serif text-5xl font-bold leading-none tracking-tight text-ink sm:text-6xl">
            Testpass
            <span className="mt-3 block text-xl font-semibold tracking-wide text-ink sm:text-2xl">个性化 AI 考试通过助手</span>
          </h1>
          <p className="mt-6 max-w-md text-sm leading-7 text-ink/80">只补最弱的短板，用长期数据预测成绩。</p>
        </div>

        <figure className="flex items-end gap-4 md:col-start-2 md:row-span-2 md:row-start-1 md:self-center md:flex-col md:items-start md:gap-5">
          <p className="bubble bubble-senior bubble-tail bubble-in welcome-bubble order-2 min-w-0 px-4 py-3 md:order-1">
            <span className="block font-serif text-[17px] leading-[1.6] text-ink">今天只做一件小事。</span>
            <span className="mt-1 block text-[13px] leading-[1.7] text-muted">先挑最弱的那一块，做完就停。</span>
          </p>
          <div className="order-1 md:order-2 md:pl-5">
            <CompanionFigure hint="encourage" className="h-20 w-[76px] md:h-28 md:w-[107px]" />
          </div>
          <figcaption className="sr-only">印章小人：今天只做一件小事。</figcaption>
        </figure>

        <div className="md:col-start-1 md:row-start-2 md:mt-12">
          <button
            type="button"
            onClick={() => navigate("/start")}
            className="group inline-flex h-12 w-full items-center justify-center gap-3 rounded-[2px] bg-seal px-8 text-sm text-paper shadow-[3px_3px_0_var(--color-ink)] hover:bg-[#742418] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_var(--color-ink)] sm:w-auto"
          >
            以游客身份进入
            <PixelArrow />
          </button>
          <div className="mt-3 flex flex-wrap items-center gap-x-6">
            <button
              type="button"
              onClick={() => navigate("/account")}
              className="inline-flex min-h-11 items-center text-sm text-ink underline decoration-line underline-offset-4 hover:decoration-seal"
            >
              登录 / 注册，保存进度
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center text-sm text-muted underline decoration-transparent underline-offset-4 hover:text-seal hover:decoration-seal"
              onClick={() => {
                demo()
                navigate("/today")
              }}
            >
              先看一份练过几天的记录
            </button>
          </div>
          <p className="mt-8 max-w-sm border-l border-line pl-3 text-[11px] leading-5 text-muted">
            游客记录只存在这台浏览器里；绑定邮箱后，记录跟着账号走。
          </p>
          <SyncNotice />
        </div>
      </div>
    </main>
  )
}

function PixelArrow() {
  return (
    <svg
      viewBox="0 0 7 5"
      shapeRendering="crispEdges"
      className="h-[10px] w-[14px] fill-current transition-transform duration-150 group-hover:translate-x-[2px]"
      aria-hidden="true"
    >
      <rect x="0" y="2" width="5" height="1" />
      <rect x="4" y="1" width="1" height="3" />
      <rect x="5" y="2" width="1" height="1" />
      <rect x="3" y="0" width="1" height="1" />
      <rect x="3" y="4" width="1" height="1" />
    </svg>
  )
}
