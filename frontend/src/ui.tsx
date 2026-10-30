import { useEffect, useState, type ReactNode } from 'react'
import type { Fetched } from './api'

/** Data provenance tag. Simulated data must never look like physical sensor data. */
export function SourceBadge({ source }: { source?: string | null }) {
  if (!source) return null
  const map: Record<string, [string, string]> = {
    simulated: ['SIMULATED', 'b-sim'],
    device: ['SENSOR (device)', 'b-real'],
    predicted: ['PREDICTED', 'b-pred'],
    historical: ['HISTORICAL DATASET', 'b-hist'],
    agronomic: ['AGRONOMIC CALC', 'b-agro'],
    weather: ['OPEN-METEO', 'b-hist'],
  }
  const [label, cls] = map[source] ?? [source.toUpperCase(), 'b-hist']
  return <span className={`badge ${cls}`}>{label}</span>
}

export function Card({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <header className="card-h">
          <h3>{title}</h3>
          <div className="card-r">{right}</div>
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, unit, sub, badge }: { label: ReactNode; value: ReactNode; unit?: string; sub?: ReactNode; badge?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-l">{label}{badge}</div>
      <div className="stat-v">{value}{unit && <span className="stat-u">{unit}</span>}</div>
      {sub && <div className="stat-s">{sub}</div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skel-wrap" aria-busy="true" aria-label="Loading">
      <div className="skel big" />
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skel" style={{ width: `${90 - i * 18}%` }} />)}
    </div>
  )
}

/** Loading (skeleton) / error / empty wrapper for fetched data. */
export function Async<T>({ f, children, empty }: { f: Fetched<T>; children: (d: T) => ReactNode; empty?: (d: T) => boolean }) {
  if (f.loading && !f.data) return <Skeleton />
  if (!f.data) return (
    <div className="state err">
      <strong>Could not load data.</strong>
      <div>{f.error}</div>
      <button className="btn" onClick={f.reload}>Retry</button>
    </div>
  )
  return (
    <>
      {f.error && <div className="banner warn">Showing last data. Refresh failed: {f.error}</div>}
      {empty?.(f.data) ? <Empty>No data yet.</Empty> : children(f.data)}
    </>
  )
}

export function Unavailable({ p }: { p: { status?: string; reason?: string | null } }) {
  return <Empty><strong>Unavailable.</strong> {p.reason ?? 'No prediction could be made.'}</Empty>
}

// ---- toasts: toast('Saved') from anywhere; <Toaster/> is mounted once in App
type T = { id: number; text: string; kind: 'ok' | 'err' }
let listeners: ((t: T) => void)[] = []
let seq = 0
export const toast = (text: string, kind: 'ok' | 'err' = 'ok') => listeners.forEach((l) => l({ id: ++seq, text, kind }))

export function Toaster() {
  const [items, setItems] = useState<T[]>([])
  useEffect(() => {
    const l = (t: T) => {
      setItems((x) => [...x, t])
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), 4000)
    }
    listeners.push(l)
    return () => { listeners = listeners.filter((x) => x !== l) }
  }, [])
  return <div className="toasts" role="status">{items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>
}
