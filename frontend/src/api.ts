import { useCallback, useEffect, useRef, useState } from 'react'

// Dev: backend on :8000. Production build: same origin (the backend serves this app). VITE_API_URL overrides both.
export const API_URL: string = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://127.0.0.1:8000' : '')

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(API_URL + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new Error(`Cannot reach the backend at ${API_URL}. Is it running?`)
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const j = await res.json()
      const d = j.detail ?? j
      detail = typeof d === 'string' ? d : d.blocked_by ? d.blocked_by.join('; ') : JSON.stringify(d)
    } catch { /* ignore */ }
    throw new Error(detail)
  }
  return res.json()
}

export interface Fetched<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

/** GET (or POST with `method`) a path, optionally polling. Keeps the last good data when a refresh fails. */
export function useApi<T = any>(path: string, opts: { every?: number; method?: 'GET' | 'POST' } = {}): Fetched<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)
  const load = useCallback(() => {
    api<T>(path, { method: opts.method ?? 'GET' })
      .then((d) => { if (alive.current) { setData(d); setError(null) } })
      .catch((e: Error) => { if (alive.current) setError(e.message) })
      .finally(() => { if (alive.current) setLoading(false) })
  }, [path, opts.method])
  useEffect(() => {
    alive.current = true
    load()
    const t = opts.every ? setInterval(load, opts.every) : undefined
    return () => { alive.current = false; if (t) clearInterval(t) }
  }, [load, opts.every])
  return { data, error, loading, reload: load }
}

export const fmt = (v: number | null | undefined, digits = 1, unit = '') =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : `${v.toFixed(digits)}${unit}`

export const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

export const ago = (seconds?: number | null) => {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 90) return `${Math.round(seconds)} s ago`
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`
  return `${(seconds / 3600).toFixed(1)} h ago`
}
