import { createContext, lazy, Suspense, useContext, useEffect, useState } from 'react'
import { useApi, type Fetched } from './api'
import { Icon } from './icons'
import { PageHero, Skeleton, SourceBadge, Toaster } from './ui'
import './App.css'
import './design.css'

const Overview = lazy(() => import('./pages/Overview'))
const LiveSensors = lazy(() => import('./pages/LiveSensors'))
const Explain = lazy(() => import('./pages/Explain'))
const Upload = lazy(() => import('./pages/Upload'))
const Landing = lazy(() => import('./pages/Landing'))
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

// id, nav label, icon, component, banner title, banner subtitle
const PAGES = [
  ['overview', 'Overview', 'overview', Overview, 'Your farm at a glance', 'Live conditions, AI advice and pump control in one place.'],
  ['sensors', 'Live Sensors', 'sensors', LiveSensors, 'Live sensor readings', 'Moisture, temperature and humidity from the field, or clearly labelled simulated data.'],
  ['history', 'History', 'history', History, 'What has happened', 'Every irrigation event and every stored prediction, newest first.'],
  ['irrigation', 'AI Predictions', 'ai', Irrigation, 'Should we irrigate?', 'The classifier answers yes or no and shows which inputs drove the answer.'],
  ['water', 'Water Requirement', 'water', Water, 'How much water?', 'A machine-learning estimate next to an FAO-56 agronomic calculation.'],
  ['forecast', 'Moisture Forecast', 'forecast', Forecast, 'Where is soil moisture heading?', 'Forecasts for 1, 6, 12 and 24 hours with the typical error shown.'],
  ['upload', 'Predict Your Data', 'upload', Upload, 'Bring your own dataset', 'Upload a CSV of readings and get predictions for every row.'],
  ['models', 'Model Performance', 'models', Models, 'How good are the models?', 'Real held-out test results, with limitations stated plainly.'],
  ['explain', 'How It Works', 'how', Explain, 'How a prediction is made', 'The data taken, the inputs each model sees, and a live try-it tool.'],
  ['settings', 'Settings', 'settings', Settings, 'Farm and safety settings', 'Coordinates, growth stage, control mode and safety limits.'],
] as const

const GROUPS: [string, string[]][] = [
  ['Monitor', ['overview', 'sensors', 'history']],
  ['Intelligence', ['irrigation', 'water', 'forecast', 'upload']],
  ['Transparency', ['models', 'explain']],
  ['System', ['settings']],
]

type Theme = 'system' | 'light' | 'dark'
const readTheme = (): Theme => {
  const q = new URLSearchParams(location.search).get('theme')
  if (q === 'light' || q === 'dark') return q
  try { const t = localStorage.getItem('theme'); if (t === 'light' || t === 'dark') return t } catch { /* storage unavailable */ }
  return 'system'
}

export default function App() {
  const fromHash = () => { const h = location.hash.slice(1); return PAGES.some((p) => p[0] === h) ? h : 'home' }
  const [page, setPage] = useState<string>(fromHash)
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(readTheme)
  const pred = useApi('/api/predictions/run', { method: 'POST', every: 5 * 60_000 })
  const status = useApi('/api/irrigation/status', { every: 10_000 })
  const latest = useApi('/api/sensors/latest', { every: 10_000 })
  const farm = useApi('/api/farm')
  const health = useApi('/api/health', { every: 30_000 })
  const current = PAGES.find((p) => p[0] === page) ?? PAGES[0]
  const Page = current[3]
  const offline = !!health.error && !health.data
  const go = (id: string) => { setPage(id); location.hash = id; window.scrollTo({ top: 0 }) }

  useEffect(() => {
    const onHash = () => { setPage(fromHash()); window.scrollTo({ top: 0 }) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
    try { localStorage.setItem('theme', theme) } catch { /* ignore */ }
  }, [theme])
  const nextTheme = () => setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')

  const shared = { pred, status, latest, farm, health }
  if (page === 'home') {
    return (
      <Ctx.Provider value={shared}>
        <Suspense fallback={<div className="state"><span className="spinner" /></div>}><Landing go={go} /></Suspense>
        <Toaster />
      </Ctx.Provider>
    )
  }

  const running = status.data?.pump?.running
  return (
    <Ctx.Provider value={shared}>
      <div className="shell">
        {open && <div className="scrim" onClick={() => setOpen(false)} />}
        <aside className={`side ${open ? 'open' : ''}`}>
          <button className="brand" onClick={() => go('home')} title="Back to the home page">
            <span className="logo">🍅</span><div><b>TomatoIQ</b><small>Adaptive drip irrigation</small></div>
          </button>
          <nav aria-label="Sections">
            {GROUPS.map(([group, ids]) => (
              <div key={group} className="nav-group">
                <span className="nav-label">{group}</span>
                {ids.map((id) => {
                  const [, label, icon] = PAGES.find((p) => p[0] === id)!
                  return (
                    <button key={id} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => { go(id); setOpen(false) }}>
                      <Icon name={icon} />{label}
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>
          <div className="side-foot">
            <div className="side-card">
              <span className={`live-dot ${offline ? 'off' : ''}`} />
              <div><b>{offline ? 'Backend offline' : 'System online'}</b><small>{farm.data?.farm_name ?? '—'}</small></div>
            </div>
            <div className="side-badges"><SourceBadge source={farm.data?.sensor_source} />{running && <span className="badge b-real">PUMP RUNNING</span>}</div>
          </div>
        </aside>
        <main>
          <header className="topbar">
            <button className="icon-btn burger" aria-label="Open menu" onClick={() => setOpen(true)}><Icon name="menu" /></button>
            <div className="crumbs"><button onClick={() => go('home')}>Home</button><span>/</span><b>{current[1]}</b></div>
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
            <PageHero icon={current[2]} title={current[4]} subtitle={current[5]} />
            <Suspense fallback={<div className="card"><Skeleton lines={4} /></div>}><Page /></Suspense>
          </div>
        </main>
      </div>
      <Toaster />
    </Ctx.Provider>
  )
}
