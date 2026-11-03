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
import { readUploadedText, rememberImport, requestPublicImport } from "../lib/import-bank.ts"
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
  const [url, setUrl] = useState("")
  const [mode, setMode] = useState<Mode>("public")
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
    setPhase("idle")
    setDoneKind(null)
    setQuestions([])
    setSourceLabel(null)
    setNotice(null)
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

  function openGated() {
    setMode("gated")
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
        showLocal("file", file.name, parseImportedBank(text, hint))
      })
      .catch(() => {
        if (readToken.current !== token) return
        showLocal("file", file.name, [])
      })
  }

  const reading = phase === "reading"
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
              {mode === "gated" ? IMPORT_COPY.gatedTitle : IMPORT_COPY.title}
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
              <div aria-live="polite" className="mt-4">
                {reading && <p className="text-sm leading-7 text-muted">{IMPORT_COPY.reading}</p>}
                {phase === "miss" && notice && <p className="text-sm leading-7 text-ink">{notice}</p>}
                {phase === "miss" && !notice && (
                  <p className="text-sm leading-7 text-ink">
                    {IMPORT_COPY.missBefore}
                    <button type="button" className="text-ink underline decoration-line underline-offset-4 hover:decoration-seal" onClick={openGated}>
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
              <Dialog.Description className="mt-3 text-sm leading-7 text-ink">{IMPORT_COPY.gatedLead}</Dialog.Description>
              {url.trim() && <p className="mt-2 break-all text-xs leading-6 text-muted">{url.trim()}</p>}
              <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-7 text-ink">
                <li>{IMPORT_COPY.step1}</li>
                <li className="text-muted">{IMPORT_COPY.step2}</li>
              </ol>

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
                    <Button type="submit" className="ml-auto" disabled={!paste.trim()}>
                      {IMPORT_COPY.collect}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="mt-4">
                  <Button variant="secondary" onClick={() => fileRef.current?.click()}>
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
