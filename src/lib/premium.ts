import { useEffect, useState } from "react"
import { supabase } from "./supabase.ts"

const KEY = "testpass-premium-code"

export function storedCode(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function saveCode(code: string) {
  try {
    localStorage.setItem(KEY, code.trim())
  } catch {
    /* private mode */
  }
}

export function clearCode() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* private mode */
  }
}

export function premiumHeaders(): Record<string, string> {
  const code = storedCode()
  return code ? { "x-access-code": code } : {}
}

/** Send the invite code and, when signed in, the account token so the server can tell real users apart. */
export async function premiumHeadersFor(): Promise<Record<string, string>> {
  const headers = premiumHeaders()
  if (supabase) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  }
  return headers
}

export async function tryUnlock(code: string): Promise<boolean> {
  try {
    const response = await fetch("/api/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    })
    if (!response.ok) return false
    const data = (await response.json()) as { ok?: unknown }
    return data.ok === true
  } catch {
    return false
  }
}

/** Premium = invite code on this browser, or a signed-in account (anonymous sessions are free). */
export function usePremium() {
  const [code, setCode] = useState<string | null>(() => storedCode())
  const [anonymous, setAnonymous] = useState<boolean | null>(null)

  useEffect(() => {
    if (!supabase) {
      setAnonymous(false)
      return
    }
    let live = true
    void supabase.auth.getSession().then(({ data }) => {
      if (live) setAnonymous(data.session?.user?.is_anonymous ?? true)
    })
    const sub = supabase.auth.onAuthStateChange((_event, session) => {
      setAnonymous(session?.user?.is_anonymous ?? true)
    }).data.subscription
    return () => {
      live = false
      sub.unsubscribe()
    }
  }, [])

  async function unlock(raw: string): Promise<boolean> {
    const ok = await tryUnlock(raw)
    if (ok) {
      saveCode(raw)
      setCode(raw.trim())
    }
    return ok
  }

  return {
    premium: Boolean(code) || anonymous === false,
    anonymous,
    code,
    unlock,
    relock: () => {
      clearCode()
      setCode(null)
    },
  }
}
