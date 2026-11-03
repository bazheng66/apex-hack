import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { syncAfterLocalChange } from "../algo/index.ts"
import { recordUpload, scoreOf } from "../engine/agent.ts"
import { examById, topicById } from "../engine/catalog.ts"
import { todayKey } from "../lib/day.ts"
import { askPast, askSenior, askVision } from "../lib/senior.ts"
import {
  UNWRITTEN,
  imageFileError,
  pastTurn,
  priorHistory,
  readStoredTurns,
  sendFailure,
  stemRecorded,
  storageKey,
  turnsForStorage,
  visionTurn,
  waitingCopy,
  withStemRecorded,
  type TalkTurn,
  type WaitKind,
} from "../lib/talk.ts"
import { useRecord } from "../lib/useRecord.tsx"
import ImportBank from "./ImportBank.tsx"

export default function Talk() {
  const { state, setState } = useRecord()
  const examId = state?.examId
  const [items, setItems] = useState<TalkTurn[]>(() => readStoredTurns(examId ? localStorage.getItem(storageKey(examId)) : null))
  const itemsRef = useRef(items)
  const [draft, setDraft] = useState("")
  const [image, setImage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState<WaitKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const lock = useRef(false)
  const marked = useRef(new Set<string>())

  useEffect(() => {
    const node = listRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [items, wait])

  function commit(next: TalkTurn[]) {
    itemsRef.current = next
    setItems(next)
    if (examId) localStorage.setItem(storageKey(examId), JSON.stringify(turnsForStorage(next)))
  }

  function release() {
    lock.current = false
    setBusy(false)
    setWait(null)
  }

  function clearImage() {
    setImage(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  if (!state || !examId) return null
  const record = state
  const topic = topicById(record.examId, record.daily.topicId)
  const exam = examById(record.examId)

  async function sendText(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if ((!text && !image) || lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    const shot = image
    const userItem: TalkTurn = {
      id: crypto.randomUUID(),
      role: "user",
      text: text || "看这张卷面。",
      ...(shot ? { image: shot } : {}),
    }
    const history = priorHistory(itemsRef.current)
    commit([...itemsRef.current, userItem])
    setDraft("")
    clearImage()
    setWait(shot ? "image" : "text")
    try {
      if (shot) {
        const note = await askVision(shot, exam.name, topic.name, text)
        commit([...itemsRef.current, visionTurn(crypto.randomUUID(), note)])
        return
      }
      const line = await askSenior({
        kind: "talk",
        exam: exam.name,
        topic: topic.name,
        score: scoreOf(record.mastery, topic.id),
        text,
        history,
      })
      commit([...itemsRef.current, { id: crypto.randomUUID(), role: "senior", text: line?.trim() || UNWRITTEN }])
    } catch {
      setError(sendFailure(shot ? "image" : "text"))
    } finally {
      release()
    }
  }

  async function findQuestion() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    const userItem: TalkTurn = { id: crypto.randomUUID(), role: "user", text: `找一道${topic.name}的真题。` }
    commit([...itemsRef.current, userItem])
    setWait("past")
    try {
      const paper = await askPast(exam.name, topic.name)
      commit([...itemsRef.current, pastTurn(crypto.randomUUID(), topic.id, paper)])
    } catch {
      setError(sendFailure("past"))
    } finally {
      release()
    }
  }

  function onFile(file: File | undefined) {
    if (!file || lock.current) return
    const problem = imageFileError(file)
    if (problem) {
      setError(problem)
      clearImage()
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setImage(reader.result)
        setError(null)
      }
    }
    reader.onerror = () => setError("这张图没有读出来。")
    reader.readAsDataURL(file)
  }

  function onDraftKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  function markWrong(message: TalkTurn, stem: string) {
    if (!message.topicId || stemRecorded(message, stem)) return
    const key = `${message.id}:${stem}`
    if (marked.current.has(key)) return
    marked.current.add(key)
    const result = recordUpload(record, {
      topicId: message.topicId,
      correct: 0,
      total: 1,
      mistake: stem,
      today: todayKey(),
    })
    if (!result.ok) {
      marked.current.delete(key)
      setError(result.message)
      return
    }
    setError(null)
    setState(result.state)
    syncAfterLocalChange(result.state)
    commit(itemsRef.current.map((item) => (item.id === message.id ? withStemRecorded(item, stem) : item)))
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0">
        <p className="text-[11px] tracking-[0.22em] text-muted">对话</p>
        <h1 className="mt-3 max-w-2xl font-serif text-2xl font-semibold leading-snug text-ink sm:text-3xl">跟 Testpass 说这道题</h1>
      </div>

      <ol
        ref={listRef}
        role="log"
        aria-label="对话记录"
        className="talk-scroll mt-6 flex min-h-0 min-w-0 flex-1 flex-col gap-8 overflow-y-auto overscroll-contain pb-8"
      >
        {items.map((item) =>
          item.id === "open" ? (
            <li key={item.id}>
              <p className="max-w-2xl border-l-2 border-l-seal pl-4 font-serif text-xl leading-8">{item.text}</p>
            </li>
          ) : item.role === "user" ? (
            <li key={item.id} className="ml-auto w-fit max-w-[88%] text-right">
              <p className="text-[11px] tracking-[0.2em] text-muted">你</p>
              <div className="mt-2 border-t border-ink pt-3">
                {item.image && (
                  <img
                    src={item.image}
                    alt="刚发送的卷面"
                    className="mb-3 ml-auto max-h-48 max-w-full rounded-[2px] border border-line object-contain sm:max-w-64"
                  />
                )}
                <p className="text-sm leading-7 break-words">{item.text}</p>
              </div>
            </li>
          ) : (
            <li key={item.id}>
              <p className="text-[11px] tracking-[0.2em] text-muted">Testpass</p>
              <div className="mt-2 border-l-2 border-l-seal pl-4">
                {item.seen && (
                  <div className="mb-4 border-b border-line pb-4">
                    <p className="text-[11px] tracking-[0.18em] text-muted">卷面上读到</p>
                    <p className="mt-2 text-sm leading-7 break-words">{item.seen}</p>
                  </div>
                )}
                <p className="text-sm leading-7 break-words">{item.text}</p>
                {item.questions && item.questions.length > 0 && (
                  <ol className="mt-5 space-y-4 text-left">
                    {item.questions.map((question, index) => {
                      const done = stemRecorded(item, question.stem)
                      return (
                        <li key={`${item.id}-${index}`} className="rounded-[2px] border border-line bg-card px-4 py-3">
                          <p className="text-[11px] tracking-[0.16em] text-muted">第 {index + 1} 题</p>
                          <p className="mt-2 text-sm leading-7 break-words">{question.stem}</p>
                          {done ? (
                            <p className="mt-3 text-xs text-muted">已经按错题记入实力。</p>
                          ) : (
                            <button
                              type="button"
                              className="mt-3 inline-flex min-h-11 items-center text-left text-xs text-seal underline decoration-line underline-offset-4 hover:decoration-seal"
                              onClick={() => markWrong(item, question.stem)}
                            >
                              这题我做错了，记入{topicById(record.examId, item.topicId ?? topic.id).name}
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                )}
                {item.source && (
                  <a
                    href={item.source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-5 block text-left text-xs leading-6 text-ink"
                  >
                    <span className="underline decoration-line underline-offset-4 hover:decoration-seal">出处 · {item.source.title}</span>
                    <span className="mt-1 block break-words text-muted">
                      {item.source.url.split("/").map((part, index, all) => (
                        <span key={`${index}-${part}`}>
                          {index > 0 ? "/" : null}
                          {part}
                          {index < all.length - 1 ? <wbr /> : null}
                        </span>
                      ))}
                    </span>
                  </a>
                )}
              </div>
            </li>
          ),
        )}
        {wait && (
          <li>
            <p className="text-[11px] tracking-[0.2em] text-muted">Testpass</p>
            <p className="mt-2 border-l-2 border-l-seal pl-4 text-sm leading-7 text-muted">{waitingCopy(wait)}</p>
          </li>
        )}
      </ol>

      <form
        aria-label="发给 Testpass"
        onSubmit={(event) => void sendText(event)}
        className="shrink-0 min-w-0 border-t border-line bg-paper pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        {image && (
          <div className="mb-3 flex items-end gap-4">
            <img src={image} alt="待发送的卷面" className="max-h-32 max-w-full rounded-[2px] border border-line object-contain" />
            <button type="button" className="shrink-0 py-2 text-xs text-muted underline-offset-4 hover:text-seal hover:underline" onClick={clearImage}>
              不用这张
            </button>
          </div>
        )}
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onDraftKey}
          rows={2}
          enterKeyHint="send"
          placeholder="说你卡在哪，或配上一张卷面"
          className="w-full resize-none rounded-[2px] border border-line bg-card px-4 py-3 text-base leading-6 break-words text-ink placeholder:text-muted/70 focus:border-seal sm:text-sm"
        />
        {error && (
          <p role="alert" className="mt-3 text-sm leading-6 text-seal">
            {error}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="h-12 rounded-[2px] border border-line bg-transparent px-4 text-sm text-ink hover:border-seal disabled:opacity-40"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            识图
          </button>
          <button
            type="button"
            className="h-12 rounded-[2px] border border-line bg-transparent px-4 text-sm text-ink hover:border-seal disabled:opacity-40"
            onClick={() => void findQuestion()}
            disabled={busy}
          >
            找真题
          </button>
          <button
            type="button"
            className="h-12 rounded-[2px] border border-line bg-transparent px-4 text-sm text-ink hover:border-seal"
            onClick={() => setImportOpen(true)}
          >
            导入题库
          </button>
          <button
            type="submit"
            className="ml-auto h-12 rounded-[2px] bg-seal px-6 text-sm text-paper hover:bg-[#742418] disabled:opacity-40"
            disabled={busy || (!draft.trim() && !image)}
          >
            发送
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={(event) => onFile(event.target.files?.[0])}
          />
        </div>
      </form>
      <ImportBank open={importOpen} onOpenChange={setImportOpen} examId={examId} />
    </section>
  )
}
