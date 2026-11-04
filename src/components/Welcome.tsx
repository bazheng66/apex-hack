import { useNavigate } from "react-router-dom"
import { useRecord } from "../lib/useRecord.tsx"
import { SyncNotice } from "./SyncNotice.tsx"

export default function Welcome() {
  const navigate = useNavigate()
  const { demo } = useRecord()

  return (
    <main className="sheet mx-auto flex min-h-svh max-w-xl flex-col justify-center px-5 py-16 sm:px-6">
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

      <div className="mt-12 flex flex-col gap-3 sm:max-w-sm">
        <button
          type="button"
          onClick={() => navigate("/start")}
          className="inline-flex h-12 items-center justify-center rounded-[2px] bg-seal px-6 text-sm text-paper hover:bg-[#742418]"
        >
          以游客身份进入
        </button>
        <button
          type="button"
          onClick={() => navigate("/account")}
          className="inline-flex h-12 items-center justify-center rounded-[2px] border border-line px-6 text-sm text-ink hover:border-seal"
        >
          登录 / 注册，保存进度
        </button>
        <button
          type="button"
          className="h-10 text-xs text-muted hover:text-seal"
          onClick={() => {
            demo()
            navigate("/today")
          }}
        >
          先看一份练过几天的记录
        </button>
      </div>

      <p className="mt-10 max-w-md text-xs leading-6 text-muted">
        游客记录只存在这台浏览器里，换设备就找不回来。绑一个邮箱之后，记录跟着账号走。
      </p>
      <SyncNotice />
    </main>
  )
}
