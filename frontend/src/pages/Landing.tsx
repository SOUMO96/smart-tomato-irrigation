import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useShared } from '../App'
import { api, fmt, useApi } from '../api'
import { Icon } from '../icons'
import Scene from '../Scene'
import SoilScene from '../SoilScene'
import '../landing.css'

/** Fades/slides children in once they scroll into view. */
function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setOn(true); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect() } }, { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return <div ref={ref} className={`rv ${on ? 'in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>
}

/** Counts up to `value` when first visible. */
function CountUp({ value, decimals = 0, suffix = '' }: { value: number | null | undefined; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(0)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!seen || value === null || value === undefined) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(value); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 1200)
      setShown(value * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [seen, value])
  return <span ref={ref}>{value === null || value === undefined ? '—' : `${shown.toFixed(decimals)}${suffix}`}</span>
}

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

const STEPS = [
  ['sensors', 'Sense', 'Soil-moisture, soil-temperature and air sensors on an ESP32 report every few minutes, powered by a small solar panel.'],
  ['cloud', 'Add weather', 'Open-Meteo supplies wind, sunshine and rain for your exact farm coordinates, with a safe fallback if the internet drops.'],
  ['ai', 'Predict', 'Three models estimate if irrigation is needed within the hour, how much water, and where soil moisture is heading over 24 hours.'],
  ['water', 'Irrigate safely', 'A controller waters only inside strict limits: emergency stop, runtime cap, sensor checks. The AI can advise but never override them.'],
] as const

const FEATURES = [
  ['sensors', 'Live monitoring', 'Moisture, temperatures and humidity with freshness checks. Simulated and real data are always clearly labelled.'],
  ['ai', 'Explained predictions', 'Every answer shows which inputs pushed it up or down, so it is not a black box.'],
  ['forecast', 'Moisture forecast', 'Look 1, 6, 12 and 24 hours ahead, compared honestly against a "nothing changes" baseline.'],
  ['shield', 'Safety first', 'Manual override, emergency stop, maximum pump runtime, stale and invalid sensor detection.'],
  ['upload', 'Bring your own data', 'Upload a CSV of readings and get irrigation, water and forecast predictions for every row.'],
  ['models', 'Transparent results', 'Real held-out test metrics, dataset source and limitations are published in the app itself.'],
] as const

const ZONES = [
  { key: 'drought', max: 20, tone: 'dry', short: 'Below wilting point', title: 'Too dry: below the wilting point',
    effects: ['The plant cannot pull water out of the soil, so leaves wilt and may not recover.', 'Flowers and young fruit drop; yield is lost.', 'The soil surface cracks and roots dry out. Prolonged drought can kill the plant.'],
    system: 'Irrigation is clearly needed. In automatic modes the pump starts (within its runtime cap) and the AI recommends watering.' },
  { key: 'stress', max: 40, tone: 'dry', short: 'Water stress', title: 'Dry: water stress',
    effects: ['Growth slows and leaves curl or droop in the afternoon.', 'Uneven watering makes blossom-end rot more likely and fruit stays smaller.', 'This is the zone where the farm in the dataset started irrigating (40%).'],
    system: 'This is the irrigation zone: below the start threshold the sensor rule starts the pump, and the AI usually agrees.' },
  { key: 'optimal', max: 60, tone: 'ok', short: 'Comfortable range', title: 'Optimal: roots get water and air',
    effects: ['Pores hold both water and oxygen, so roots work well.', 'Steady growth and even fruit set.', 'Nothing needs to be done; this is the target band.'],
    system: 'No action. The pump stays off and the AI predicts no irrigation is needed soon.' },
  { key: 'excess', max: 80, tone: 'wet', short: 'Too wet', title: 'Overwatered: above field capacity',
    effects: ['Extra water drains away and carries nutrients with it (leaching), so water and pumping energy are wasted.', 'Roots get less oxygen; leaves can start to yellow.', 'Wet soil and humid foliage raise the risk of fungal diseases.'],
    system: 'The saturation gate blocks irrigation: the pump will not start above the stop threshold (60%), and a running pump is stopped. The AI cannot override this.' },
  { key: 'sat', max: 101, tone: 'flood', short: 'Waterlogged', title: 'Waterlogged: roots are suffocating',
    effects: ['Soil pores fill with water, so roots run out of oxygen and begin to rot (root rot).', 'The plant wilts even though the soil is wet, and leaves turn yellow with brown spots.', 'Fruit can crack after sudden water uptake, and diseases spread quickly. Standing water forms on the surface.'],
    system: 'Irrigation is blocked completely. If real readings stay this high with no rain or irrigation, check for leaks, drainage problems or a faulty sensor.' },
] as const

function Explorer() {
  const [m, setM] = useState(() => { const q = Number(new URLSearchParams(location.search).get('m')); return Number.isFinite(q) && q > 0 && q <= 100 ? q : 34 })
  const [res, setRes] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setBusy(true)
    const t = setTimeout(() => {
      api('/api/predictions/what-if', { method: 'POST', body: JSON.stringify({ soil_moisture: m, air_temp: 26, humidity: 50, soil_temp: 22, hour: 10, rain_6h: 0, wind_speed: 8, solar_radiation: 450 }) })
        .then(setRes).catch(() => setRes(null)).finally(() => setBusy(false))
    }, 350)
    return () => clearTimeout(t)
  }, [m])
  const zone = ZONES.find((z) => m < z.max) ?? ZONES[ZONES.length - 1]
  return (
    <div className="explorer">
      <div className="ex-vis"><SoilScene moisture={m} dripping={m < 40} /><span className={`ex-zone ${zone.tone}`}>{zone.short}</span></div>
      <div className="ex-panel">
        <label htmlFor="mslider">Soil moisture</label>
        <div className="ex-val">{m}<span>%</span></div>
        <input id="mslider" type="range" min={0} max={100} value={m} onChange={(e) => setM(Number(e.target.value))} aria-valuetext={`${m} percent, ${zone.title}`} />
        <div className="zonebar" aria-hidden="true">
          {ZONES.map((z) => <i key={z.key} className={z.tone} style={{ opacity: z.key === zone.key ? 1 : 0.45 }} />)}
          <b className="zone-pin" style={{ left: `${m}%` }} />
        </div>
        <div className="ex-scale"><span>0</span><span>20</span><span>40</span><span>60</span><span>80</span><span>100</span></div>
        <div className={`conseq ${zone.tone}`} key={zone.key}>
          <div className="conseq-h"><b>{zone.title}</b></div>
          <ul>{zone.effects.map((e) => <li key={e}>{e}</li>)}</ul>
          <p className="conseq-sys"><b>What TomatoIQ does:</b> {zone.system}</p>
        </div>
        <div className="ex-ai">
          <div className="ex-ai-h">What the trained model says {busy && <i className="mini-spin" />}</div>
          {res && res.irrigation?.status !== 'unavailable' ? (
            <>
              <div className={`ex-verdict ${res.irrigation.irrigate ? 'yes' : 'no'}`}>{res.irrigation.irrigate ? 'Irrigate soon' : 'No irrigation needed soon'}</div>
              <div className="ex-nums">
                <div><b>{fmt(res.irrigation.probability * 100, 0)}%</b><small>irrigation probability</small></div>
                <div><b>{fmt(res.water.litres, 0)} L</b><small>water per event</small></div>
              </div>
            </>
          ) : <p className="ex-note">{busy ? 'Asking the model…' : 'Start the backend to see live model output.'}</p>}
          <p className="ex-note">Fixed conditions for this demo: 26 °C, 50 % humidity, 10:00, light wind. The picture is an illustration; the numbers come from the real model.
            Zone limits (20 / 40 / 60 / 80) follow the dataset's tomato soil model on the probe's 0-100 scale. The effects listed are general agronomy: real damage depends on soil, duration and variety.</p>
        </div>
      </div>
    </div>
  )
}

export default function Landing({ go }: { go: (p: string) => void }) {
  const { latest, pred } = useShared()
  const perf = useApi<any>('/api/models/performance')
  const info = useApi<any>('/api/dataset/info')
  const hero = useRef<HTMLElement>(null)
  useEffect(() => {
    const f = new URLSearchParams(location.search).get('focus')
    if (f) setTimeout(() => document.getElementById(f)?.scrollIntoView(), 600)
  }, [])

  const onMove = (e: React.MouseEvent) => {
    const r = hero.current?.getBoundingClientRect()
    if (!r || !hero.current) return
    hero.current.style.setProperty('--mx', String(((e.clientX - r.left) / r.width - 0.5) * 2))
    hero.current.style.setProperty('--my', String(((e.clientY - r.top) / r.height - 0.5) * 2))
  }

  const rows = info.data ? (Object.values(info.data.processed) as any[]).reduce((a, v) => a + v.rows, 0) : null
  const c = perf.data?.classification
  const sel = c?.metrics_test?.[c.selected]
  const reading = latest.data?.reading
  const verdict = pred.data?.irrigation

  return (
    <div className="lp">
      <header className="lp-nav">
        <button className="lp-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><span>🍅</span> TomatoIQ</button>
        <nav>
          <button onClick={() => scrollTo('how')}>How it works</button>
          <button onClick={() => scrollTo('explore')}>Try the soil</button>
          <button onClick={() => scrollTo('results')}>Results</button>
        </nav>
        <button className="lp-btn sm" onClick={() => go('overview')}>Open dashboard</button>
      </header>

      <section className="hero" ref={hero} onMouseMove={onMove}>
        <Scene />
        <div className="hero-shade" />
        <div className="hero-copy">
          <span className="eyebrow">IoT · Solar-powered · Machine learning</span>
          <h1>Precision irrigation for <em>healthier</em> tomato crops.</h1>
          <p>TomatoIQ monitors soil conditions, reads the weather and forecasts crop water demand, so every litre is applied where and when it is needed, within strict safety limits.</p>
          <div className="hero-cta">
            <button className="lp-btn" onClick={() => go('overview')}>Open the live dashboard <Icon name="forecast" size={18} /></button>
            <button className="lp-btn ghost" onClick={() => go('upload')}>Predict from your data</button>
          </div>
        </div>
        <button className="scroll-cue" onClick={() => scrollTo('live')} aria-label="Scroll down"><span /></button>
      </section>

      <section id="live" className="lp-sec strip">
        <Reveal className="tiles">
          <div className="tile"><small>Soil moisture now {latest.data?.source === 'simulated' && <em className="tag-sim">simulated</em>}</small><b><CountUp value={reading?.soil_moisture} decimals={1} suffix="%" /></b></div>
          <div className="tile"><small>AI says</small><b className="sm-t">{verdict?.status && verdict.status !== 'unavailable' ? (verdict.irrigate ? 'Irrigate soon' : 'No irrigation needed') : '—'}</b></div>
          <div className="tile"><small>Labelled moments learned from</small><b><CountUp value={rows} /></b></div>
          <div className="tile"><small>Models running</small><b><CountUp value={3} /></b></div>
        </Reveal>
      </section>

      <section id="how" className="lp-sec">
        <Reveal><h2>From soil to sprinkler in four steps</h2><p className="lead">Everything between the sensor and the valve is checked, explained and limited.</p></Reveal>
        <div className="steps-lp">
          {STEPS.map(([icon, t, d], i) => (
            <Reveal key={t} delay={i * 110} className="step-lp">
              <div className="step-ico"><Icon name={icon} size={26} /><i>{i + 1}</i></div>
              <h3>{t}</h3><p>{d}</p>
            </Reveal>
          ))}
          <svg className="flow" viewBox="0 0 1000 6" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="3" x2="1000" y2="3" /></svg>
        </div>
      </section>

      <section id="explore" className="lp-sec alt">
        <Reveal><h2>See how the soil and the model respond</h2><p className="lead">Drag the slider from bone dry to waterlogged. See what too little and too much water do to the soil, roots and fruit, and what the trained model and the safety rules do about it.</p></Reveal>
        <Reveal><Explorer /></Reveal>
      </section>

      <section className="lp-sec">
        <Reveal><h2>Built for a real greenhouse or field</h2></Reveal>
        <div className="feat-grid">
          {FEATURES.map(([icon, t, d], i) => (
            <Reveal key={t} delay={(i % 3) * 100} className="feat"><span className="feat-ico"><Icon name={icon} size={22} /></span><h3>{t}</h3><p>{d}</p></Reveal>
          ))}
        </div>
      </section>

      <section id="results" className="lp-sec alt">
        <Reveal><h2>Honest results, published in the open</h2>
          <p className="lead">Trained on real data from tomato fields in Italy (Mendeley Data, CC BY 4.0) and tested on later, unseen weeks. These models are early-stage and we show the real numbers, including where they are weak.</p></Reveal>
        <Reveal className="res-grid">
          <div className="res"><small>Irrigation classifier</small><b><CountUp value={sel?.f1} decimals={2} /></b><span>F1 score · ROC-AUC {sel?.roc_auc ?? '—'}</span></div>
          <div className="res"><small>Water estimate</small><b><CountUp value={perf.data?.water_regression?.metrics_test?.[perf.data?.water_regression?.selected]?.mae_l} decimals={0} suffix=" L" /></b><span>average error per event</span></div>
          <div className="res"><small>1-hour moisture forecast</small><b><CountUp value={perf.data?.forecast?.metrics_test?.['1h']?.model?.mae} decimals={1} /></b><span>points off on average (baseline {perf.data?.forecast?.metrics_test?.['1h']?.persistence_baseline?.mae})</span></div>
        </Reveal>
        <Reveal><button className="lp-btn ghost dark" onClick={() => go('models')}>See every metric and limitation</button></Reveal>
      </section>

      <section className="cta">
        <Reveal>
          <h2>Ready to look inside?</h2>
          <p>The dashboard runs on simulated data by default and switches to your ESP32 sensors with one setting.</p>
          <div className="hero-cta center">
            <button className="lp-btn" onClick={() => go('overview')}>Open the dashboard</button>
            <button className="lp-btn ghost" onClick={() => go('explain')}>How the AI decides</button>
          </div>
        </Reveal>
      </section>

      <footer className="lp-foot">
        <div><b>TomatoIQ</b> · B.Tech major project · IoT-enabled solar-powered adaptive drip irrigation for tomato crops</div>
        <div>Data: Adamo, Colizzi, Dimauro, Guerriero, Lomonte, Mendeley Data, <a href="https://doi.org/10.17632/c837v6p8ph.2" target="_blank" rel="noreferrer">10.17632/c837v6p8ph.2</a> (CC BY 4.0) · Weather: Open-Meteo · <a href="https://github.com/SOUMO96/smart-tomato-irrigation" target="_blank" rel="noreferrer">Source code</a></div>
      </footer>
    </div>
  )
}
