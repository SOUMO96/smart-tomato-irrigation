import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useShared } from '../App'
import { api, fmt, fmtTime, useApi } from '../api'
import { AnimatedNumber, Async, Card, Ring, SourceBadge, Unavailable, toast } from '../ui'
import { tipStyle } from './Predictions'

export function History() {
  const ev = useApi<any>('/api/irrigation/history?limit=50', { every: 20_000 })
  const ph = useApi<any>('/api/predictions/history?limit=30', { every: 60_000 })
  return (
    <div className="grid">
      <Card title="Irrigation summary" className="span-3">
        <Async f={ev}>
          {(d) => {
            const total = d.events.reduce((a: number, e: any) => a + e.estimated_litres, 0)
            const mins = d.events.reduce((a: number, e: any) => a + e.duration_min, 0)
            return (
              <div className="kpis">
                <div className="kpi"><small>Events recorded</small><b><AnimatedNumber value={d.events.length} /></b></div>
                <div className="kpi"><small>Estimated water used</small><b>{fmt(total, 0)} L</b></div>
                <div className="kpi"><small>Total pump time</small><b>{fmt(mins, 0)} min</b></div>
                <div className="kpi"><small>Average event</small><b>{d.events.length ? fmt(mins / d.events.length, 1) : '—'} min</b></div>
              </div>
            )
          }}
        </Async>
      </Card>
      <Card title="Irrigation timeline" className="span-3">
        <Async f={ev} empty={(d) => d.events.length === 0}>
          {(d) => {
            const max = Math.max(...d.events.map((e: any) => e.duration_min), 1)
            return (
              <>
                <div className="tl">{d.events.map((e: any, i: number) => (
                  <div key={e.id} className={`tl-item ${e.running ? 'run' : ''}`} style={{ animationDelay: `${Math.min(i, 10) * 50}ms` }}>
                    <div className="tl-h">
                      <b>{e.running ? 'Running now' : fmtTime(e.start)}</b>
                      <span className="note">{e.trigger.replace('_', ' ')} • {fmt(e.duration_min)} min • ≈ {fmt(e.estimated_litres, 0)} L • moisture at start {fmt(e.moisture_at_start, 0, '%')}</span>
                      <SourceBadge source={e.simulated ? 'simulated' : 'device'} />
                    </div>
                    <div className="note">{e.running ? 'in progress' : `ended ${fmtTime(e.end)}: ${e.stop_reason ?? '—'}`}</div>
                    <div className="tl-bar"><i style={{ width: `${(e.duration_min / max) * 100}%` }} /></div>
                  </div>
                ))}</div>
                <p className="note">{d.note}</p>
              </>
            )
          }}
        </Async>
      </Card>
      <Card title="Prediction history" right={<SourceBadge source="predicted" />} className="span-3">
        <Async f={ph} empty={(d) => d.predictions.length === 0}>
          {(d) => (
            <div className="table-wrap"><table>
              <thead><tr><th>Time</th><th>Kind</th><th>Status</th><th>Input</th><th>Result</th></tr></thead>
              <tbody>{d.predictions.map((p: any) => (
                <tr key={p.id}><td>{fmtTime(p.created_at)}</td><td>{p.kind}</td><td>{p.status}</td><td><SourceBadge source={p.input_source} /></td>
                  <td>{p.kind === 'irrigation' && p.payload.probability !== undefined ? `${p.payload.irrigate ? 'YES' : 'NO'} (${fmt(p.payload.probability * 100, 0)}%)`
                    : p.kind === 'water' && p.payload.litres !== undefined ? `${fmt(p.payload.litres, 0)} L`
                    : p.kind === 'forecast' && p.payload.forecasts ? p.payload.forecasts.map((f: any) => `${f.horizon_h}h: ${fmt(f.soil_moisture, 0)}%`).join(' • ')
                    : p.payload.reason ?? '—'}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Async>
      </Card>
    </div>
  )
}

/** Confusion matrix as a heat grid: green = correct, orange = wrong, intensity = share of that row. */
function Confusion({ cm }: { cm: number[][] }) {
  const cell = (r: number, c: number) => {
    const rowSum = cm[r][0] + cm[r][1] || 1
    const a = 0.15 + 0.7 * (cm[r][c] / rowSum)
    const ok = r === c
    return <div style={{ background: ok ? `rgba(46,125,79,${a})` : `rgba(217,130,43,${a})`, color: 'var(--ink)' }} title={`${Math.round((cm[r][c] / rowSum) * 100)}% of actual ${r ? 'YES' : 'NO'}`}>{cm[r][c]}</div>
  }
  return (
    <div className="heat">
      <div className="hl" /><div className="hl">Pred. NO</div><div className="hl">Pred. YES</div>
      <div className="hl">Actual NO</div>{cell(0, 0)}{cell(0, 1)}
      <div className="hl">Actual YES</div>{cell(1, 0)}{cell(1, 1)}
    </div>
  )
}

export function Models() {
  const perf = useApi<any>('/api/models/performance')
  return (
    <Async f={perf}>
      {(m) => m.status === 'unavailable' ? <Unavailable p={m} /> : (
        <div className="grid">
          <Card title="Training information" right={<SourceBadge source="historical" />} className="span-3">
            <div className="kv">
              <div><b>Dataset</b>{m.dataset.name}</div>
              <div><b>Source</b><a href={m.dataset.source} target="_blank" rel="noreferrer">{m.dataset.doi}</a> • {m.dataset.license}</div>
              <div><b>Site</b>{m.dataset.location} • sectors {m.dataset.sectors_used}</div>
              <div><b>Trained</b>{fmtTime(m.trained_at)} • scikit-learn {m.environment['scikit-learn']} • seed {m.environment.random_seed}</div>
              <div><b>Models</b>{Object.entries(m.models).map(([k, v]: any) => `${k}: ${v.available ? v.algorithm ?? 'loaded' : 'unavailable'}`).join(' • ')}</div>
            </div>
            <ul className="note">{m.dataset.caveats.map((c: string) => <li key={c}>{c}</li>)}</ul>
          </Card>

          <Card title="Scores at a glance" className="span-3">
            <div className="metric-rings">
              <div><Ring value={m.classification.metrics_test[m.classification.selected].f1} label="F1" size={110} stroke={11} color="var(--c-pred)" /><span>A · Irrigation F1</span></div>
              <div><Ring value={m.classification.metrics_test[m.classification.selected].roc_auc ?? 0} label="AUC" size={110} stroke={11} color="var(--c-hum)" /><span>A · ROC-AUC</span></div>
              <div><Ring value={m.classification.metrics_test[m.classification.selected].recall} label="recall" size={110} stroke={11} color="var(--c-air)" /><span>A · Recall</span></div>
              <div><Ring value={Math.max(0, m.water_regression.metrics_test[m.water_regression.selected].r2)} label="R²" size={110} stroke={11} color="var(--brand)" /><span>B · Water R²</span></div>
            </div>
            <p className="note">A perfect model would fill every ring. These are real held-out results: the irrigation and water models are modest, and that is stated openly.</p>
          </Card>

          <Card title="A · Irrigation classification" className="span-2">
            <p className="note">{m.classification.task}</p>
            <p className="note">Chronological split: train {m.classification.split.train_rows} rows ({m.classification.split.train_positives} irrigation starts) → test {m.classification.split.test_rows} rows ({m.classification.split.test_positives} starts), cutoff {fmtTime(m.classification.split.cutoff)}.</p>
            <div className="table-wrap"><table>
              <thead><tr><th>Model</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th><th>ROC-AUC</th></tr></thead>
              <tbody>{Object.entries(m.classification.metrics_test).map(([k, v]: any) => (
                <tr key={k} className={k === m.classification.selected ? 'sel' : ''}><td>{k}{k === m.classification.selected && ' ✓ selected'}</td>
                  <td>{v.accuracy}</td><td>{v.precision}</td><td>{v.recall}</td><td>{v.f1}</td><td>{v.roc_auc ?? '—'}</td></tr>
              ))}</tbody>
            </table></div>
            <p className="note">Precision/recall/F1 are for the positive class (irrigation start). {m.classification.notes}</p>
          </Card>
          <Card title="Confusion matrix (test)">
            <Confusion cm={m.classification.metrics_test[m.classification.selected].confusion_matrix} />
            <p className="note">{m.classification.selected}</p>
          </Card>

          <Card title="B · Water requirement regression" className="span-2">
            <p className="note">{m.water_regression.task}. Train {m.water_regression.split.train_rows} / test {m.water_regression.split.test_rows} events.</p>
            <div className="table-wrap"><table>
              <thead><tr><th>Model</th><th>MAE (L)</th><th>RMSE (L)</th><th>R²</th></tr></thead>
              <tbody>{Object.entries(m.water_regression.metrics_test).map(([k, v]: any) => (
                <tr key={k} className={k === m.water_regression.selected ? 'sel' : ''}><td>{k}{k === m.water_regression.selected && ' ✓ selected'}</td><td>{v.mae_l}</td><td>{v.rmse_l}</td><td>{v.r2}</td></tr>
              ))}</tbody>
            </table></div>
            <p className="note">{m.water_regression.notes}</p>
          </Card>
          <Card title="Importance (water)"><div className="chart sm"><ResponsiveContainer>
            <BarChart data={m.water_regression.feature_importance} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" horizontal={false} /><XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 10 }} /><Tooltip contentStyle={tipStyle} /><Bar isAnimationActive={false} dataKey="importance" fill="var(--c-pred)" />
            </BarChart></ResponsiveContainer></div></Card>

          <Card title="C · Soil-moisture forecast (MAE / RMSE per horizon)" className="span-3">
            <p className="note">{m.forecast.algorithm}. Test: {m.forecast.split.test}.</p>
            <div className="chart sm"><ResponsiveContainer>
              <BarChart data={Object.entries(m.forecast.metrics_test).map(([h, v]: any) => ({ h, model: v.model.mae, persistence: v.persistence_baseline.mae }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" /><XAxis dataKey="h" /><YAxis unit="" tick={{ fontSize: 11 }} /><Tooltip contentStyle={tipStyle} /><Legend />
                <Bar isAnimationActive={false} dataKey="model" name="Model MAE" fill="var(--c-pred)" /><Bar isAnimationActive={false} dataKey="persistence" name="Persistence MAE" fill="var(--c-hum)" />
              </BarChart></ResponsiveContainer></div>
            <div className="table-wrap"><table>
              <thead><tr><th>Horizon</th><th>Model MAE</th><th>Model RMSE</th><th>Persistence MAE</th><th>Persistence RMSE</th><th>Test rows</th></tr></thead>
              <tbody>{Object.entries(m.forecast.metrics_test).map(([h, v]: any) => (
                <tr key={h}><td>{h}</td><td>{v.model.mae}</td><td>{v.model.rmse}</td><td>{v.persistence_baseline.mae}</td><td>{v.persistence_baseline.rmse}</td><td>{v.test_rows}</td></tr>
              ))}</tbody>
            </table></div>
            <p className="note">Persistence = "moisture stays at its current value". Errors are in moisture-percentage points. {m.forecast.notes}</p>
          </Card>
        </div>
      )}
    </Async>
  )
}

const STAGES = ['seedling', 'vegetative', 'flowering', 'fruit_development', 'ripening']
const MODES: [string, string, string][] = [
  ['manual', 'Manual only', 'You start and stop the pump'],
  ['sensor_auto', 'Sensor automatic', 'Starts below the start threshold'],
  ['ai_recommend', 'AI recommendation', 'Advice only, never actuates'],
  ['ai_auto', 'AI-assisted automatic', 'AI and sensor must agree'],
]

export function Settings() {
  const { farm, status, latest, pred } = useShared()
  const [f, setF] = useState<any>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { if (farm.data) setF(farm.data) }, [farm.data])
  if (!f) return <Async f={farm}>{() => null}</Async>

  const set = (k: string, v: any) => setF({ ...f, [k]: v })
  const num = (k: string, label: string, step = 1, hint?: string) => (
    <label>{label}<input type="number" step={step} value={f[k]} onChange={(e) => set(k, e.target.value === '' ? '' : Number(e.target.value))} />{hint && <small>{hint}</small>}</label>
  )
  const save = async () => {
    try {
      const { id, ...body } = f
      await api('/api/farm', { method: 'PUT', body: JSON.stringify(body) })
      setMsg({ ok: true, text: 'Saved.' }); toast('Settings saved'); farm.reload(); status.reload(); latest.reload(); pred.reload()
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); toast((e as Error).message, 'err') }
  }

  return (
    <div className="grid">
      <Card title="Farm and zone" className="span-2">
        <div className="form">
          <label>Farm name<input value={f.farm_name} onChange={(e) => set('farm_name', e.target.value)} /></label>
          <label>Zone name<input value={f.zone_name} onChange={(e) => set('zone_name', e.target.value)} /></label>
          {num('latitude', 'Farm latitude', 0.0001, 'Used for Open-Meteo weather (not your current location)')}
          {num('longitude', 'Farm longitude', 0.0001)}
          <label>Timezone (IANA)<input value={f.timezone} onChange={(e) => set('timezone', e.target.value)} /></label>
          {num('zone_area_m2', 'Zone area (m²)', 1, 'Placeholder default — enter your real area')}
          <label>Tomato growth stage<select value={f.growth_stage} onChange={(e) => set('growth_stage', e.target.value)}>
            {STAGES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
            <small>Used by the FAO-56 calculation only (the ML data has no stage labels).</small></label>
          {num('irrigation_efficiency', 'Application efficiency (0–1)', 0.05)}
        </div>
      </Card>
      <Card title="Data source and control">
        <div className="form">
          <div className="span-form"><span className="lbl">Sensor data source</span>
            <div className="radio-cards">
              {([['simulated', 'Simulated', 'Development data, always labelled'], ['device', 'Physical device', 'Readings posted by your ESP32']] as const).map(([v, t, d]) => (
                <button type="button" key={v} className={`rc ${f.sensor_source === v ? 'on' : ''}`} onClick={() => set('sensor_source', v)}><b>{t}</b><small>{d}</small></button>
              ))}
            </div><small>Only the selected source drives predictions and control.</small></div>
          <div className="span-form"><span className="lbl">Control mode</span>
            <div className="radio-cards">
              {MODES.map(([v, l, d]) => (
                <button type="button" key={v} className={`rc ${f.control_mode === v ? 'on' : ''}`} onClick={() => set('control_mode', v)}><b>{l}</b><small>{d}</small></button>
              ))}
            </div></div>
          {num('ai_threshold', 'AI probability threshold', 0.05)}
        </div>
      </Card>
      <Card title="Safety limits" className="span-3">
        <div className="form cols">
          {num('start_threshold', 'Start irrigating below (%)', 1, 'Dataset farm used 40')}
          {num('stop_threshold', 'Stop / never start above (%)', 1, 'Dataset farm used 60')}
          {num('max_pump_runtime_min', 'Max pump runtime (min)', 1)}
          {num('min_rest_min', 'Min rest between runs (min)', 1)}
          {num('stale_after_min', 'Sensor stale after (min)', 1)}
          {num('flow_l_per_min', 'Emitter flow (L/min)', 0.1, 'Used to estimate litres from runtime')}
        </div>
        <p className="note">Thresholds are on the probe's 0–100 scale; calibrate your sensor to the same scale before enabling automatic modes. Emergency stop, runtime cap, stale/invalid-sensor and saturation gates always apply, in every mode.</p>
        <div className="btns"><button className="btn primary" onClick={save}>Save settings</button>
          {msg && <span className={msg.ok ? 'ok-msg' : 'err-msg'}>{msg.text}</span>}</div>
      </Card>
    </div>
  )
}
