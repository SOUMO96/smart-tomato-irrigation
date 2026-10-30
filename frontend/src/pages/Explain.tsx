import { useState } from 'react'
import { useShared } from '../App'
import { api, fmt, useApi } from '../api'
import { Async, Card, SourceBadge, Unavailable } from '../ui'
import { Drivers, Missing } from './Predictions'

const LABELS: Record<string, string> = {
  soil_moisture: 'Soil moisture (%)', air_temp: 'Air temperature (°C)', humidity: 'Air humidity (%)', soil_temp: 'Soil temperature (°C)',
  rain_6h: 'Rain, past 6 h (mm)', rain_24h: 'Rain, past 24 h (mm)', wind_speed: 'Wind (km/h)', solar_radiation: 'Direct solar radiation (W/m²)',
  irrigated_min_6h: 'Irrigated minutes, past 6 h', irrigated_min_1h: 'Irrigated minutes, past 1 h', irrigated_min_24h: 'Irrigated minutes, past 24 h',
  irrigated_l_24h: 'Water applied, past 24 h (L)', hours_since_irrigation: 'Hours since last irrigation', hour_sin: 'Time of day (sin)', hour_cos: 'Time of day (cos)',
  sm_lag_1h: 'Soil moisture 1 h ago', sm_lag_3h: 'Soil moisture 3 h ago', sm_lag_6h: 'Soil moisture 6 h ago', sm_lag_24h: 'Soil moisture 24 h ago',
  irrigate_next_hour: 'TARGET: irrigation starts within 1 h (0/1)', water_l: 'TARGET: litres applied', target_1h: 'TARGET: moisture +1 h', target_6h: 'TARGET: moisture +6 h',
  target_12h: 'TARGET: moisture +12 h', target_24h: 'TARGET: moisture +24 h', stop_reason: 'Stop reason', duration_min: 'Event duration (min)',
}

const STEPS = [
  ['1 · Collect', 'Public dataset from a real tomato farm: soil-moisture probes, valve (pump) records and weather, every 10 min.'],
  ['2 · Clean', 'Drop impossible moisture values, remove spikes, fill gaps of 20 min or less only. Nothing is invented.'],
  ['3 · Build features', 'Turn each moment into inputs (moisture, weather, recent irrigation, time of day, past moisture) and a known outcome.'],
  ['4 · Split by time', 'Train on the earlier part of the season, test on the later part, so the test resembles predicting the future.'],
  ['5 · Train', 'Random Forest vs a second algorithm for A and B; gradient boosting per horizon for C. Best on the test set is kept.'],
  ['6 · Predict', 'Live sensor + Open-Meteo weather become the same inputs; the model answers and shows what drove the answer.'],
]

export default function Explain() {
  return (
    <div className="grid">
      <Card title="How a prediction is made" className="span-3">
        <div className="steps">{STEPS.map(([t, d]) => <div key={t} className="step"><b>{t}</b><p>{d}</p></div>)}</div>
      </Card>
      <DataTaken />
      <Tables />
      <Results />
      <TryIt />
    </div>
  )
}

function DataTaken() {
  const info = useApi<any>('/api/dataset/info')
  return (
    <Card title="What data was taken" right={<SourceBadge source="historical" />} className="span-3">
      <Async f={info}>
        {(d) => (
          <>
            <div className="kv">
              <div><b>Dataset</b>{d.name}</div>
              <div><b>Source</b><a href={d.source} target="_blank" rel="noreferrer">{d.doi}</a> • licence {d.license}</div>
              <div><b>Authors</b>{d.authors}</div>
              <div><b>Location</b>{d.location}</div>
              <div><b>Used</b>Sectors {d.sectors_used}. Files: {d.files_used.join(', ')}</div>
              <div><b>Excluded</b>{Object.entries(d.sectors_excluded).map(([k, v]) => `sector ${k}: ${v}`).join(' • ')}</div>
              <div><b>Weather</b>{d.weather_source}</div>
            </div>
            <div className="table-wrap"><table>
              <thead><tr><th>Training table</th><th>Rows</th><th>What one row is</th><th>Target (what is predicted)</th></tr></thead>
              <tbody>{Object.entries(d.processed).map(([k, v]: any) => (
                <tr key={k}><td>{k}</td><td>{v.rows.toLocaleString()}</td>
                  <td>{k.startsWith('clf') ? 'a moment when the valve is closed' : k.startsWith('reg') ? 'one irrigation event' : 'a moment with a known future'}</td>
                  <td>{v.target ?? v.targets.join(', ')}</td></tr>
              ))}</tbody>
            </table></div>
            <h4>Known limits of this data</h4>
            <ul className="note">{d.caveats.map((c: string) => <li key={c}>{c}</li>)}</ul>
          </>
        )}
      </Async>
    </Card>
  )
}

function Tables() {
  const [t, setT] = useState<'clf' | 'reg' | 'fc'>('clf')
  const s = useApi<any>(`/api/dataset/samples?table=${t}&n=6`)
  const names = { clf: 'A · Irrigation classifier', reg: 'B · Water regressor', fc: 'C · Moisture forecaster' }
  return (
    <Card title="Inputs each model sees (real rows from the training data)" className="span-3"
      right={<div className="seg">{(Object.keys(names) as (keyof typeof names)[]).map((k) => <button key={k} className={t === k ? 'on' : ''} onClick={() => setT(k)}>{names[k].slice(0, 1)}</button>)}</div>}>
      <p className="note"><b>{names[t]}</b>. Columns marked TARGET are the answers the model learned to predict; all others are inputs.</p>
      <Async f={s}>
        {(d) => {
          const cols = d.columns.filter((c: string) => c !== 'sector')
          return (
            <>
              <div className="table-wrap"><table>
                <thead><tr><th>Column</th><th>Min</th><th>Median</th><th>Max</th></tr></thead>
                <tbody>{Object.entries(d.stats).filter(([k]) => k !== 'sector').map(([k, v]: any) => (
                  <tr key={k}><td>{LABELS[k] ?? k}</td><td>{v.min}</td><td>{v.median}</td><td>{v.max}</td></tr>
                ))}</tbody>
              </table></div>
              <h4>Random sample rows ({d.rows_total.toLocaleString()} total)</h4>
              <div className="table-wrap"><table>
                <thead><tr>{cols.map((c: string) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{d.samples.map((r: any, i: number) => <tr key={i}>{cols.map((c: string) => <td key={c}>{String(r[c])}</td>)}</tr>)}</tbody>
              </table></div>
            </>
          )
        }}
      </Async>
    </Card>
  )
}

function Results() {
  const perf = useApi<any>('/api/models/performance')
  return (
    <Card title="Results at a glance" className="span-3">
      <Async f={perf}>
        {(m) => {
          if (m.status === 'unavailable') return <Unavailable p={m} />
          const c = m.classification, sel = c.metrics_test[c.selected], r = m.water_regression, rs = r.metrics_test[r.selected]
          return (
            <>
              <div className="stats">
                <div className="stat"><div className="stat-l">A · {c.selected}</div><div className="stat-v">F1 {sel.f1}</div><div className="stat-s">accuracy {sel.accuracy} • precision {sel.precision} • recall {sel.recall}</div></div>
                <div className="stat"><div className="stat-l">B · {r.selected}</div><div className="stat-v">R² {rs.r2}</div><div className="stat-s">MAE {rs.mae_l} L • RMSE {rs.rmse_l} L</div></div>
                {Object.entries(m.forecast.metrics_test).map(([h, v]: any) => (
                  <div className="stat" key={h}><div className="stat-l">C · +{h}</div><div className="stat-v">MAE {v.model.mae}</div><div className="stat-s">persistence {v.persistence_baseline.mae} • n={v.test_rows}</div></div>
                ))}
              </div>
              <p className="note">Accuracy alone is misleading for A: only about 5% of test moments are real irrigation starts, so always answering NO would score about 95%. Precision, recall and F1 measure the cases that matter. Full tables and the confusion matrix are on the Model Performance page.</p>
            </>
          )
        }}
      </Async>
    </Card>
  )
}

const DEFAULTS: Record<string, string> = { soil_moisture: '35', air_temp: '26', humidity: '50', soil_temp: '22', hour: '10', rain_6h: '0', wind_speed: '8', solar_radiation: '450' }
const OPTIONAL = ['rain_24h', 'irrigated_min_6h', 'irrigated_l_24h', 'hours_since_irrigation', 'sm_lag_1h', 'sm_lag_3h', 'sm_lag_6h', 'sm_lag_24h']
const FIELDS = ['soil_moisture', 'air_temp', 'humidity', 'soil_temp', 'hour', 'rain_6h', 'wind_speed', 'solar_radiation', ...OPTIONAL]

function TryIt() {
  const { latest } = useShared()
  const [v, setV] = useState<Record<string, string>>(DEFAULTS)
  const [res, setRes] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const preset = (o: Record<string, string>) => setV({ ...DEFAULTS, ...o })
  const loadLatest = () => {
    const r = latest.data?.reading
    if (r) setV({ ...DEFAULTS, soil_moisture: String(r.soil_moisture), air_temp: String(r.air_temp), humidity: String(r.humidity), soil_temp: String(r.soil_temp) })
  }
  const run = async () => {
    setBusy(true); setErr(null)
    try {
      const body: Record<string, number> = {}
      for (const k of FIELDS) if (v[k] !== undefined && v[k] !== '') body[k] = Number(v[k])
      setRes(await api('/api/predictions/what-if', { method: 'POST', body: JSON.stringify(body) }))
    } catch (e) { setErr((e as Error).message); setRes(null) } finally { setBusy(false) }
  }

  return (
    <Card title="Try it: change the inputs and watch the models respond" right={<SourceBadge source="predicted" />} className="span-3">
      <p className="note">Type your own conditions (not stored, not tied to a sensor). Leave optional fields blank: the model then fills them with a typical training value and says so.</p>
      <div className="btns">
        <button className="btn" onClick={() => preset({ soil_moisture: '28', air_temp: '31', solar_radiation: '700', hour: '9' })}>Dry, hot morning</button>
        <button className="btn" onClick={() => preset({ soil_moisture: '62', air_temp: '20', solar_radiation: '150', hour: '15', rain_6h: '4' })}>Wet, after rain</button>
        <button className="btn" disabled={!latest.data?.reading} onClick={loadLatest}>Use latest sensor reading</button>
      </div>
      <div className="form cols4">
        {FIELDS.map((k) => (
          <label key={k}>{LABELS[k] ?? 'Hour of day (0-23)'}{OPTIONAL.includes(k) ? ' (optional)' : ''}
            <input type="number" value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>
        ))}
      </div>
      <div className="btns"><button className="btn primary" disabled={busy} onClick={run}>{busy ? 'Predicting…' : 'Predict'}</button>{err && <span className="err-msg">{err}</span>}</div>

      {res && (
        <div className="grid g3 inner">
          <div className="sub">
            <h4>A · Irrigation needed within 1 h?</h4>
            {res.irrigation.status === 'unavailable' ? <Unavailable p={res.irrigation} /> : (
              <>
                <Missing list={res.irrigation.inputs_missing} />
                <div className={`verdict ${res.irrigation.irrigate ? 'yes' : 'no'}`}>{res.irrigation.irrigate ? 'YES' : 'NO'}: {fmt(res.irrigation.probability * 100, 0)}% probability</div>
                <h4>What drove it</h4><Drivers drivers={res.irrigation.explanation.drivers} unit="" />
              </>
            )}
          </div>
          <div className="sub">
            <h4>B · Water for one irrigation event</h4>
            {res.water.status === 'unavailable' ? <Unavailable p={res.water} /> : (
              <>
                <Missing list={res.water.inputs_missing} />
                <div className="verdict no">{fmt(res.water.litres, 0)} L</div>
                <h4>What drove it</h4><Drivers drivers={res.water.explanation.drivers} unit=" L" />
              </>
            )}
          </div>
          <div className="sub">
            <h4>C · Moisture forecast</h4>
            {res.forecast.status === 'unavailable' ? <Unavailable p={res.forecast} /> : (
              <>
                <Missing list={res.forecast.inputs_missing} />
                <div className="table-wrap"><table><thead><tr><th>Ahead</th><th>Moisture</th><th>Typical error</th></tr></thead>
                  <tbody>{res.forecast.forecasts.map((f: any) => <tr key={f.horizon_h}><td>+{f.horizon_h} h</td><td>{fmt(f.soil_moisture, 1, '%')}</td><td>±{f.test_mae}</td></tr>)}</tbody></table></div>
                <p className="note">More accurate when you fill the "moisture N h ago" fields.</p>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
