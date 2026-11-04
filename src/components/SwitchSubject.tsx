import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { EXAMS } from "../engine/catalog.ts"
import type { ExamId } from "../engine/types.ts"
import { useRecord } from "../lib/useRecord.tsx"

export default function SwitchSubject() {
  const { state, openExam, examsWithRecords } = useRecord()
  const navigate = useNavigate()
  const [saved, setSaved] = useState<ExamId[]>([])
  const [busy, setBusy] = useState<ExamId | null>(null)

  useEffect(() => {
    void examsWithRecords().then(setSaved)
  }, [examsWithRecords])

  async function pick(id: ExamId) {
    if (!state) return
    if (id === state.examId) {
      navigate("/today")
      return
    }
    setBusy(id)
    const loaded = saved.includes(id) ? await openExam(id) : false
    setBusy(null)
    if (loaded) navigate("/today")
    else navigate(`/start?exam=${id}`)
  }

  return (
    <article className="max-w-xl">
      <p className="text-[11px] tracking-[0.22em] text-muted">切换科目</p>
      <h1 className="mt-4 font-serif text-3xl font-semibold leading-snug text-ink">换一门继续练</h1>
      <p className="mt-4 text-sm leading-7 text-muted">练过的科目会回到原来的进度，没练过的从今天的专项开始。</p>

      <div className="mt-8 border-t border-line">
        {EXAMS.map((exam) => {
          const current = state?.examId === exam.id
          const hasRecord = saved.includes(exam.id)
          return (
            <button
              key={exam.id}
              type="button"
              disabled={busy !== null}
              onClick={() => void pick(exam.id)}
              className="flex w-full items-center gap-4 border-b border-l-2 border-b-line border-l-transparent py-5 pr-2 pl-3 text-left hover:border-l-seal hover:bg-card disabled:opacity-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-base text-ink">{exam.name}</span>
                <span className="mt-1 block text-xs text-muted">
                  {current ? "正在练这一门" : hasRecord ? "有记录，切过去接着练" : "还没有记录"}
                </span>
              </span>
              <span className="text-xs text-muted">{busy === exam.id ? "载入中…" : "→"}</span>
            </button>
          )
        })}
      </div>

      <Link to="/today" className="mt-10 inline-flex text-sm text-muted underline decoration-line underline-offset-4 hover:text-seal">
        返回今天
      </Link>
    </article>
  )
}
