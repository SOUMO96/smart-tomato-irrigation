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
  /** true while the data shown is the last saved copy and a fresh one is still on its way */
  stale: boolean
  reload: () => void
}

// Stale-while-revalidate: the last response for each request is kept in memory (instant page switches) and in
// localStorage (instant return visits), shown immediately and marked "updating" until fresh data arrives.
const mem = new Map<string, { data: unknown; at: number }>()
const inflight = new Map<string, Promise<unknown>>()
const LS_PREFIX = 'tomato-cache:'
const MAX_AGE_MS = 6 * 3600_000

function readCache(key: string): { data: unknown; at: number } | null {
  const m = mem.get(key)
  if (m) return m
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    if (raw) {
      const v = JSON.parse(raw)
      if (Date.now() - v.at < MAX_AGE_MS) { mem.set(key, v); return v }
    }
  } catch { /* storage unavailable or corrupt: just load normally */ }
  return null
}

function writeCache(key: string, data: unknown) {
  const v = { data, at: Date.now() }
  mem.set(key, v)
  try {
    const s = JSON.stringify(v)
    if (s.length < 300_000) localStorage.setItem(LS_PREFIX + key, s)
  } catch { /* quota or private mode: memory cache still works */ }
}

function fetchShared<T>(key: string, path: string, method: 'GET' | 'POST'): Promise<T> {
  let p = inflight.get(key) as Promise<T> | undefined
  if (!p) {
    p = api<T>(path, { method }).finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return p
}

/** GET (or POST with `method`) a path, optionally polling. Keeps the last good data when a refresh fails. */
export function useApi<T = any>(path: string, opts: { every?: number; method?: 'GET' | 'POST' } = {}): Fetched<T> {
  const method = opts.method ?? 'GET'
  const key = `${method} ${path}`
  const initial = readCache(key)
  const [data, setData] = useState<T | null>(initial ? (initial.data as T) : null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!initial)
  const [stale, setStale] = useState(!!initial)
  const alive = useRef(true)
  const load = useCallback(() => {
    fetchShared<T>(key, path, method)
      .then((d) => { writeCache(key, d); if (alive.current) { setData(d); setError(null); setStale(false) } })
      .catch((e: Error) => { if (alive.current) setError(e.message) })
      .finally(() => { if (alive.current) setLoading(false) })
  }, [key, path, method])
  useEffect(() => {
    alive.current = true
    const c = readCache(key)
    setData(c ? (c.data as T) : null); setLoading(!c); setStale(!!c)
    load()
    const t = opts.every ? setInterval(load, opts.every) : undefined
    return () => { alive.current = false; if (t) clearInterval(t) }
  }, [key, load, opts.every])
  return { data, error, loading, stale, reload: load }
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
