import { useEffect, useRef, useState, type FormEvent } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import {
  IMPORT_COPY,
  fileHint,
  localSuccess,
  parseImportedBank,
  publicSuccess,
  type ImportedStem,
} from "../engine/import-bank.ts"
import { safePageUrl } from "../engine/extract.ts"
import { readUploadedText, rememberImport, requestPublicImport, requestCloudImport, type CloudImportInput } from "../lib/import-bank.ts"
import { supabase } from "../lib/supabase.ts"
import { useRecord } from "../lib/useRecord.tsx"
import { cn } from "../lib/cn.ts"
import { Button } from "./ui/button.tsx"

type Mode = "public" | "gated"
type Phase = "idle" | "reading" | "done" | "miss" | "bad-format"
type Segment = "paste" | "file"
type DoneKind = "url" | "file" | "paste" | null

const MAX_FILE = 1_500_000

export default function ImportBank({
  open,
  onOpenChange,
  examId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  examId: string
}) {
  const { flushSync } = useRecord()
  const [cloudPhase, setCloudPhase] = useState<"idle" | "syncing" | "synced" | "error">("idle")
  const [cloudError, setCloudError] = useState("")
  const pendingCloud = useRef<CloudImportInput | null>(null)
  const [url, setUrl] = useState("")
  const [mode, setMode] = useState<Mode>("public")
  const [manual, setManual] = useState(false)
  const [phase, setPhase] = useState<Phase>("idle")
  const [segment, setSegment] = useState<Segment>("paste")
  const [paste, setPaste] = useState("")
  const [doneKind, setDoneKind] = useState<DoneKind>(null)
  const [questions, setQuestions] = useState<ImportedStem[]>([])
  const [sourceLabel, setSourceLabel] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const urlRef = useRef<HTMLInputElement>(null)
  const lock = useRef(false)
  const live = useRef(true)
  const readToken = useRef(0)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  function resetOutcome() {
    setCloudPhase("idle")
    pendingCloud.current = null
    setPhase("idle")
    setDoneKind(null)
    setQuestions([])
    setSourceLabel(null)
    setNotice(null)
  }

  async function syncImport(input: CloudImportInput) {
    if (!supabase || lock.current) return
    pendingCloud.current = input
    lock.current = true
    setCloudPhase("syncing")
    setCloudError("")
    try {
      await flushSync()
      const found = await requestCloudImport(examId, input)
      if (!live.current) return
      setQuestions(found)
      setPhase("done")
      setDoneKind(input.mode === "public_url" ? "url" : input.filename ? "file" : "paste")
      setMode(input.mode === "public_url" ? "public" : "gated")
      setSourceLabel(input.filename ?? input.url ?? null)
      setNotice(`已收录 ${found.length} 题`)
      setCloudPhase("synced")
      pendingCloud.current = null
    } catch (error) {
      if (!live.current) return
      if (error instanceof Error && error.message === "LOGIN_WALL") { setMode("gated"); setPhase("idle"); setCloudPhase("idle"); return }
      setCloudPhase("error")
      setCloudError(error instanceof Error ? error.message : "云同步失败，请重试。")
    } finally { lock.current = false }
  }

  function onDialogChange(next: boolean) {
    if (!next) setMode("public")
    onOpenChange(next)
  }

  function acknowledge() {
    onDialogChange(false)
  }

  function backToPublic() {
    setMode("public")
    if (doneKind !== "url") resetOutcome()
  }

  function openGated(manualEntry = false) {
    setMode("gated")
    setManual(manualEntry)
    if (doneKind === "url") resetOutcome()
  }

  function showLocal(kind: "file" | "paste", source: string, found: ImportedStem[]) {
    if (!live.current) return
    if (found.length === 0) {
      setPhase("bad-format")
      setDoneKind(null)
      setQuestions([])
      setSourceLabel(null)
      setNotice(IMPORT_COPY.badFormat)
      return
    }
    const saved = rememberImport(examId, kind, source, found)
    if (saved.questions.length === 0) {
      setPhase("bad-format")
      setDoneKind(null)
      setQuestions([])
      setSourceLabel(null)
      setNotice(IMPORT_COPY.badFormat)
      return
    }
    setMode("gated")
    setPhase("done")
    setDoneKind(kind)
    setQuestions(saved.questions)
    setSourceLabel(kind === "file" ? saved.source : null)
    setNotice(localSuccess(saved.questions.length))
  }

  async function startImport(event: FormEvent) {
    event.preventDefault()
    const trimmed = url.trim()
    if (!trimmed || lock.current) return
    if (!safePageUrl(trimmed)) {
      let httpish = false
      try {
        const probe = new URL(trimmed)
        httpish = probe.protocol === "http:" || probe.protocol === "https:"
      } catch {
        httpish = false
      }
      setPhase("miss")
      setDoneKind(null)
      setQuestions([])
      setSourceLabel(null)
      setNotice(httpish ? null : IMPORT_COPY.badUrl)
      return
    }
    if (supabase) { await syncImport({ mode: "public_url", url: trimmed }); return }
    lock.current = true
    setPhase("reading")
    setDoneKind(null)
    setQuestions([])
    setSourceLabel(null)
    setNotice(IMPORT_COPY.reading)
    try {
      const result = await requestPublicImport(trimmed)
      if (!live.current) return
      if (result.outcome === "gated") {
        setMode("gated")
        setPhase("idle")
        setDoneKind(null)
        setQuestions([])
        setSourceLabel(trimmed)
        setNotice(null)
        return
      }
      if (result.outcome !== "ok" || result.questions.length === 0) {
        setPhase("miss")
        setDoneKind(null)
        setQuestions([])
        setSourceLabel(null)
        setNotice(result.reason === "bad-url" ? IMPORT_COPY.badUrl : null)
        return
      }
      const saved = rememberImport(examId, "url", result.sourceUrl ?? trimmed, result.questions)
      setMode("public")
      setPhase("done")
      setDoneKind("url")
      setQuestions(saved.questions)
      setSourceLabel(saved.source)
      setNotice(publicSuccess(saved.questions.length))
    } finally {
      lock.current = false
    }
  }

  function submitPaste(event: FormEvent) {
    event.preventDefault()
    const text = paste.slice(0, 1_000_000)
    if (!text.trim()) return
    if (supabase) { void syncImport({ mode: "paste_html", content: text }); return }
    showLocal("paste", "", parseImportedBank(text))
  }

  function onFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = ""
    if (!file) return
    const token = readToken.current + 1
    readToken.current = token
    const hint = fileHint(file.name)
    if (!hint || file.size > MAX_FILE) {
      showLocal("file", file.name, [])
      return
    }
    void readUploadedText(file)
      .then((text) => {
        if (readToken.current !== token) return
        if (supabase) {
          void syncImport({ mode: hint === "json" ? "upload_json" : hint === "csv" ? "upload_csv" : hint === "md" ? "upload_markdown" : "paste_html", content: text, filename: file.name })
          return
        }
        showLocal("file", file.name, parseImportedBank(text, hint))
      })
      .catch(() => {
        if (readToken.current !== token) return
        showLocal("file", file.name, [])
      })
  }

  const reading = phase === "reading" || cloudPhase === "syncing"
  const publicDone = mode === "public" && phase === "done" && doneKind === "url"
  const localDone = mode === "gated" && phase === "done" && (doneKind === "file" || doneKind === "paste")

  return (
    <Dialog.Root open={open} onOpenChange={onDialogChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          className="fixed top-[max(1rem,env(safe-area-inset-top))] left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(100%-2rem,36rem)] -translate-x-1/2 overflow-y-auto rounded-[2px] border border-line bg-card p-5 sm:p-6"
          onOpenAutoFocus={(event) => {
            if (mode !== "public") return
            event.preventDefault()
            urlRef.current?.focus()
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="font-serif text-2xl font-semibold leading-snug text-ink">
              {mode === "gated" ? (manual ? "粘贴或上传题目" : IMPORT_COPY.gatedTitle) : IMPORT_COPY.title}
            </Dialog.Title>
            <Dialog.Close className="shrink-0 py-1 text-xs text-muted hover:text-seal">{IMPORT_COPY.close}</Dialog.Close>
          </div>

          {mode === "public" ? (
            <>
              <Dialog.Description className="mt-3 text-sm leading-7 text-muted">{IMPORT_COPY.note}</Dialog.Description>
              <form className="mt-5 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void startImport(event)}>
                <input
                  ref={urlRef}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="粘贴题库页面链接"
                  aria-label="题库页面链接"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={reading}
                  className="h-12 min-w-0 flex-1 rounded-[2px] border border-line bg-paper px-4 text-base text-ink placeholder:text-muted/70 focus:border-seal disabled:opacity-40 sm:text-sm"
                />
                <Button type="submit" className="shrink-0" disabled={reading || !url.trim()}>
                  {IMPORT_COPY.start}
                </Button>
              </form>
              <p className="mt-3 text-xs leading-6 text-muted">
                不想贴链接？
                <button
                  type="button"
                  className="ml-1 text-ink underline decoration-line underline-offset-4 hover:decoration-seal"
                  onClick={() => openGated(true)}
                >
                  直接粘贴题目或上传文件
                </button>
              </p>
              <div aria-live="polite" className="mt-4">
                {reading && <p className="text-sm leading-7 text-muted">{IMPORT_COPY.reading}</p>}
                {phase === "miss" && notice && <p className="text-sm leading-7 text-ink">{notice}</p>}
                {phase === "miss" && !notice && (
                  <p className="text-sm leading-7 text-ink">
                    {IMPORT_COPY.missBefore}
                    <button type="button" className="text-ink underline decoration-line underline-offset-4 hover:decoration-seal" onClick={() => openGated(false)}>
                      {IMPORT_COPY.missLink}
                    </button>
                    {IMPORT_COPY.missAfter}
                  </p>
                )}
                {publicDone && notice && (
                  <>
                    <p className="text-sm leading-7 text-moss">{notice}</p>
                    {sourceLabel && <p className="mt-2 break-all text-xs leading-6 text-muted">{sourceLabel}</p>}
                    <QuestionList questions={questions} />
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <Dialog.Description className="mt-3 text-sm leading-7 text-ink">
                {manual ? "把题目粘贴进来，或上传 JSON / CSV / Markdown。只收录你给出的内容，不补写选项和答案。" : IMPORT_COPY.gatedLead}
              </Dialog.Description>
              {!manual && url.trim() && <p className="mt-2 break-all text-xs leading-6 text-muted">{url.trim()}</p>}
              {!manual && (
                <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-7 text-ink">
                  <li>{IMPORT_COPY.step1}</li>
                  <li className="text-muted">{IMPORT_COPY.step2}</li>
                </ol>
              )}

              <div className="mt-5 grid grid-cols-2 border border-line" role="tablist" aria-label="导入方式">
                <button
                  type="button"
                  role="tab"
                  aria-selected={segment === "paste"}
                  className={cn("h-11 text-sm", segment === "paste" ? "bg-paper text-ink" : "text-muted hover:text-ink")}
                  onClick={() => {
                    setSegment("paste")
                    if (phase === "bad-format") resetOutcome()
                  }}
                >
                  {IMPORT_COPY.pasteTab}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={segment === "file"}
                  className={cn(
                    "h-11 border-l border-line text-sm",
                    segment === "file" ? "bg-paper text-ink" : "text-muted hover:text-ink",
                  )}
                  onClick={() => {
                    setSegment("file")
                    if (phase === "bad-format") resetOutcome()
                  }}
                >
                  {IMPORT_COPY.uploadTab}
                </button>
              </div>

              {segment === "paste" ? (
                <form className="mt-4" onSubmit={submitPaste}>
                  <textarea
                    value={paste}
                    onChange={(event) => setPaste(event.target.value)}
                    rows={6}
                    placeholder={IMPORT_COPY.placeholder}
                    aria-label={IMPORT_COPY.placeholder}
                    className="w-full resize-y rounded-[2px] border border-line bg-paper px-4 py-3 text-base leading-6 text-ink placeholder:text-muted/70 focus:border-seal sm:text-sm"
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button variant="secondary" onClick={acknowledge}>
                      {IMPORT_COPY.acknowledge}
                    </Button>
                    <Button type="submit" className="ml-auto" disabled={reading || !paste.trim()}>
                      {IMPORT_COPY.collect}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="mt-4">
                  <Button variant="secondary" disabled={reading} onClick={() => fileRef.current?.click()}>
                    {IMPORT_COPY.pickFile}
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".json,.csv,.md,.markdown,.html,.htm,application/json,text/csv,text/markdown,text/html"
                    className="hidden"
                    onChange={(event) => onFile(event.target.files?.[0])}
                  />
                  <p className="mt-3 text-xs leading-6 text-muted">{IMPORT_COPY.uploadNote}</p>
                  <p className="text-xs leading-6 text-muted">{IMPORT_COPY.uploadAccept}</p>
                  <div className="mt-3">
                    <Button variant="secondary" onClick={acknowledge}>
                      {IMPORT_COPY.acknowledge}
                    </Button>
                  </div>
                </div>
              )}

              <div aria-live="polite" className="mt-4">
                {phase === "bad-format" && notice && <p className="text-sm leading-7 text-ink">{notice}</p>}
                {localDone && notice && (
                  <>
                    <p className="text-sm leading-7 text-moss">{notice}</p>
                    {sourceLabel && <p className="mt-2 break-all text-xs leading-6 text-muted">{sourceLabel}</p>}
                    <QuestionList questions={questions} />
                  </>
                )}
              </div>

              <button
                type="button"
                className="mt-5 text-xs text-muted underline decoration-line underline-offset-4 hover:text-ink hover:decoration-seal"
                onClick={backToPublic}
              >
                {IMPORT_COPY.back}
              </button>
            </>
          )}
          {cloudPhase !== "idle" && <div role="status" aria-live="polite" className="mt-4 border-t border-line pt-3 text-sm leading-7 text-muted">
            {cloudPhase === "syncing" ? "正在同步题库…" : cloudPhase === "synced" ? "题库已同步" : cloudError}
            {cloudPhase === "error" && <button type="button" className="ml-3 text-seal underline" onClick={() => { if (pendingCloud.current) void syncImport(pendingCloud.current) }}>重试同步</button>}
          </div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function QuestionList({ questions }: { questions: ImportedStem[] }) {
  if (questions.length === 0) return null
  return (
    <ol aria-label="收录的题" className="mt-4 max-h-52 space-y-3 overflow-y-auto">
      {questions.map((question, index) => (
        <li key={`${index}-${question.stem}`} className="rounded-[2px] border border-line bg-paper px-4 py-3">
          <p className="text-[11px] tracking-[0.16em] text-muted">第 {index + 1} 题</p>
          <p className="mt-2 text-sm leading-7 break-words">{question.stem}</p>
        </li>
      ))}
    </ol>
  )
}
