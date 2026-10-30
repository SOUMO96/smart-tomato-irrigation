import { createContext, lazy, Suspense, useContext, useEffect, useState } from 'react'
import { useApi, type Fetched } from './api'
import { Icon } from './icons'
import { Skeleton, SourceBadge, Toaster } from './ui'
import './App.css'

const Overview = lazy(() => import('./pages/Overview'))
const LiveSensors = lazy(() => import('./pages/LiveSensors'))
const Explain = lazy(() => import('./pages/Explain'))
const Upload = lazy(() => import('./pages/Upload'))
const Irrigation = lazy(() => import('./pages/Predictions').then((m) => ({ default: m.Irrigation })))
const Water = lazy(() => import('./pages/Predictions').then((m) => ({ default: m.Water })))
const Forecast = lazy(() => import('./pages/Predictions').then((m) => ({ default: m.Forecast })))
const History = lazy(() => import('./pages/Other').then((m) => ({ default: m.History })))
const Models = lazy(() => import('./pages/Other').then((m) => ({ default: m.Models })))
const Settings = lazy(() => import('./pages/Other').then((m) => ({ default: m.Settings })))

/** Shared data: predictions (computed + stored by the backend), pump status and latest sensor state. */
interface Shared { pred: Fetched<any>; status: Fetched<any>; latest: Fetched<any>; farm: Fetched<any>; health: Fetched<any> }
const Ctx = createContext<Shared>(null as unknown as Shared)
export const useShared = () => useContext(Ctx)

const PAGES = [
  ['overview', 'Overview', 'overview', Overview],
  ['sensors', 'Live Sensors', 'sensors', LiveSensors],
  ['irrigation', 'AI Irrigation Predictions', 'ai', Irrigation],
  ['water', 'Water Requirement', 'water', Water],
  ['forecast', 'Soil Moisture Forecast', 'forecast', Forecast],
  ['history', 'Irrigation History', 'history', History],
  ['models', 'Model Performance', 'models', Models],
  ['upload', 'Predict Your Data', 'upload', Upload],
  ['explain', 'How It Works', 'how', Explain],
  ['settings', 'Settings', 'settings', Settings],
] as const

type Theme = 'system' | 'light' | 'dark'
const readTheme = (): Theme => {
  const q = new URLSearchParams(location.search).get('theme')
  if (q === 'light' || q === 'dark') return q
  try { const t = localStorage.getItem('theme'); if (t === 'light' || t === 'dark') return t } catch { /* storage unavailable */ }
  return 'system'
}

export default function App() {
  const [page, setPage] = useState<string>(() => { const h = location.hash.slice(1); return PAGES.some((p) => p[0] === h) ? h : 'overview' })
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(readTheme)
  const pred = useApi('/api/predictions/run', { method: 'POST', every: 5 * 60_000 })
  const status = useApi('/api/irrigation/status', { every: 10_000 })
  const latest = useApi('/api/sensors/latest', { every: 10_000 })
  const farm = useApi('/api/farm')
  const health = useApi('/api/health', { every: 30_000 })
  const current = PAGES.find((p) => p[0] === page)!
  const Page = current[3]
  const offline = !!health.error && !health.data

  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
    try { localStorage.setItem('theme', theme) } catch { /* ignore */ }
  }, [theme])
  const nextTheme = () => setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')

  return (
    <Ctx.Provider value={{ pred, status, latest, farm, health }}>
      <div className="shell">
        {open && <div className="scrim" onClick={() => setOpen(false)} />}
        <aside className={`side ${open ? 'open' : ''}`}>
          <div className="brand"><span className="logo">🍅</span><div><b>TomatoIQ</b><small>Adaptive drip irrigation</small></div></div>
          <nav aria-label="Sections">
            {PAGES.map(([id, label, icon]) => (
              <button key={id} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined}
                onClick={() => { setPage(id); location.hash = id; setOpen(false) }}>
                <Icon name={icon} />{label}
              </button>
            ))}
          </nav>
          <div className="side-foot">
            <SourceBadge source={farm.data?.sensor_source} />
            <small>{farm.data?.farm_name}</small>
          </div>
        </aside>
        <main>
          <header className="topbar">
            <button className="icon-btn burger" aria-label="Open menu" onClick={() => setOpen(true)}><Icon name="menu" /></button>
            <h1>{current[1]}</h1>
            <div className="top-r">
              {farm.data?.sensor_source === 'simulated' && <span className="pill sim">Simulated</span>}
              <span className={`pill ${offline ? 'bad' : 'good'}`}><i className="dot" />{offline ? 'Offline' : 'Connected'}</span>
              <button className="icon-btn" onClick={nextTheme} aria-label={`Theme: ${theme}. Click to change`} title={`Theme: ${theme}`}>
                <Icon name={theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'auto'} />
              </button>
            </div>
          </header>
          {offline && (
            <div className="banner err">
              The backend is not reachable. Start it with <code>uvicorn app.main:app</code> in <code>backend/</code>. Safety limits are enforced
              by the backend only; nothing is being actuated from this page.
            </div>
          )}
          <div className="content" key={page}>
            <Suspense fallback={<div className="card"><Skeleton lines={4} /></div>}><Page /></Suspense>
          </div>
        </main>
      </div>
      <Toaster />
    </Ctx.Provider>
  )
}
