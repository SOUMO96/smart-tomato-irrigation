import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './icons'
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

/** Eases a number from its previous value to the new one. Respects reduced-motion. */
export function AnimatedNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(value); from.current = value; return }
    let raf = 0
    const a = from.current, t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 900)
      const v = a + (value - a) * (1 - Math.pow(1 - p, 3))
      setShown(v); from.current = v
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{shown.toFixed(decimals)}</>
}

export function Stat({ label, value, unit, sub, badge }: { label: ReactNode; value: ReactNode; unit?: string; sub?: ReactNode; badge?: ReactNode }) {
  const numeric = typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value))
  const decimals = typeof value === 'string' ? (value.split('.')[1]?.length ?? 0) : Number.isInteger(value) ? 0 : 1
  return (
    <div className="stat">
      <div className="stat-l">{label}{badge}</div>
      <div className="stat-v">{numeric ? <AnimatedNumber value={Number(value)} decimals={decimals} /> : value}{unit && <span className="stat-u">{unit}</span>}</div>
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
      {f.stale && !f.error && <span className="updating" role="status"><i className="mini-spin" /> updating…</span>}
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

/** Circular progress ring (value 0..1) that animates in. */
export function Ring({ value, size = 132, stroke = 12, label, color = 'var(--brand)', display }: { value: number; size?: number; stroke?: number; label?: string; color?: string; display?: string }) {
  const [p, setP] = useState(0)
  useEffect(() => { const t = setTimeout(() => setP(Math.max(0, Math.min(1, value))), 80); return () => clearTimeout(t) }, [value])
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-fg" strokeWidth={stroke} stroke={color} strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="ring-t"><b>{display ?? <><AnimatedNumber value={value * 100} />%</>}</b>{label && <small>{label}</small>}</div>
    </div>
  )
}

/** Gradient banner at the top of every dashboard page, with floating shapes and animated drops. */
export function PageHero({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div className="phero">
      <i className="blob b1" /><i className="blob b2" /><i className="blob b3" />
      <div className="phero-drops" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ left: `${12 + i * 19}%`, animationDelay: `${i * 0.55}s` }} />)}</div>
      <div className="phero-ico"><Icon name={icon} size={28} /></div>
      <div className="phero-t"><h2>{title}</h2><p>{subtitle}</p></div>
    </div>
  )
}
