import { useRecord } from "../lib/useRecord.tsx"
export function SyncNotice() {
  const { status, error, retrySync } = useRecord()
  if (status === "empty") return null
  return <div className="mt-3 text-xs leading-6 text-muted" role="status" aria-live="polite">
    {status === "local" ? "记录保存在本机" : status === "syncing" ? "正在同步练习记录…" : status === "synced" ? "练习记录已同步" : error}
    {status === "error" && <button type="button" className="ml-3 text-seal underline underline-offset-4" onClick={() => void retrySync()}>重试同步</button>}
  </div>
}
