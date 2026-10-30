import { useRef, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, fmt } from '../api'
import { Card, Empty, SourceBadge, Stat, toast } from '../ui'

const MAX_BYTES = 3_000_000
const PAGE = 20

const download = (name: string, text: string, type = 'text/csv') => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

const toCsv = (rows: any[]) => {
  const cols = ['row', 'timestamp', 'soil_moisture', 'status', 'reason', 'irrigation_probability', 'irrigate', 'litres_if_irrigated', 'forecast_1h', 'forecast_6h', 'forecast_12h', 'forecast_24h']
  const esc = (v: unknown) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
}

const COLUMNS: [string, string, string, string, string][] = [
  ['Soil moisture', 'Required', '% (0 to 100)', 'soil_moisture, moisture, sm', '41.5'],
  ['Air temperature', 'Required', '°C (-10 to 60)', 'air_temp, temperature, temp', '27.3'],
  ['Air humidity', 'Required', '% (0 to 100)', 'humidity, rh, relative_humidity', '58'],
  ['Soil temperature', 'Required', '°C (-5 to 60)', 'soil_temp, soil_temperature', '24.1'],
  ['Timestamp', 'Optional, strongly recommended', 'date and time, e.g. 2026-06-01 10:00', 'timestamp, time, datetime, date', '2026-06-01 10:00'],
  ['Rainfall', 'Optional (needs timestamp)', 'mm that fell in that row interval', 'rainfall, rain, precipitation', '0.4'],
  ['Wind speed', 'Optional', 'km/h', 'wind_speed, wind', '8'],
  ['Solar radiation', 'Optional', 'W/m² (direct)', 'solar_radiation, radiation', '450'],
  ['Irrigation minutes', 'Optional (needs timestamp)', 'minutes the pump ran in that row interval', 'irrigation_minutes, pump_minutes', '0'],
]

function Guide() {
  return (
    <Card title="What your CSV should contain" className="span-3">
      <p className="note">One row per measurement, one column per quantity, with a header row in the first line. Comma, semicolon or tab separated all work.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Data</th><th>Needed?</th><th>Unit / valid range</th><th>Accepted column names</th><th>Example</th></tr></thead>
        <tbody>{COLUMNS.map(([a, b, c, d, e]) => <tr key={a}><td><b>{a}</b></td><td>{b}</td><td>{c}</td><td>{d}</td><td>{e}</td></tr>)}</tbody>
      </table></div>
      <h4>Example file</h4>
      <pre className="code">{`timestamp,soil_moisture,air_temp,humidity,soil_temp,rainfall,wind_speed,solar_radiation,irrigation_minutes
2026-06-01 06:00,48.2,19.5,72,18.1,0,6,40,0
2026-06-01 07:00,46.9,21.0,66,18.6,0,8,180,0
2026-06-01 08:00,45.1,23.4,58,19.4,0,9,350,0`}</pre>
      <ul className="note">
        <li>Soil moisture must be on the same relative 0 to 100 % probe scale the models were trained on (a capacitive probe calibrated dry = 0, saturated = 100).</li>
        <li>Include a timestamp and keep readings regular (for example hourly). The models use moisture from 1, 3, 6 and 24 hours earlier, so about a day of history gives the best forecasts.</li>
        <li>Rows with a missing or impossible required value are reported as invalid and are not predicted. Optional inputs you leave out are replaced by typical training values.</li>
        <li>Leave temperatures in °C and wind in km/h. Do not convert to other units.</li>
        <li>Maximum 5,000 rows and 3 MB per file; extra columns are ignored.</li>
      </ul>
    </Card>
  )
}

export default function Upload() {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [res, setRes] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [filter, setFilter] = useState<'all' | 'yes' | 'invalid'>('all')
  const [page, setPage] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const load = async (f: File | undefined) => {
    if (!f) return
    setErr(null); setRes(null)
    if (f.size > MAX_BYTES) { setErr('File is larger than 3 MB. Split it into smaller files (limit 5,000 rows).'); return }
    try { setFile({ name: f.name, text: await f.text() }) } catch { setErr('Could not read that file.') }
  }

  const run = async () => {
    if (!file) return
    setBusy(true); setErr(null)
    try {
      setRes(await api('/api/predictions/batch', { method: 'POST', body: JSON.stringify({ csv: file.text, filename: file.name }) }))
      setPage(0); setFilter('all')
      toast('Predictions ready')
    } catch (e) { setErr((e as Error).message); setRes(null) } finally { setBusy(false) }
  }

  const template = async () => {
    try { const t = await api('/api/predictions/batch/template'); download('irrigation_input_template.csv', t.csv) } catch (e) { toast((e as Error).message, 'err') }
  }

  const rows: any[] = res?.predictions ?? []
  const shown = rows.filter((r) => filter === 'all' || (filter === 'yes' ? r.irrigate === true : r.status === 'invalid'))
  const pages = Math.max(1, Math.ceil(shown.length / PAGE))
  const chart = rows.filter((r) => r.status === 'ok').map((r) => ({ x: r.timestamp ?? `#${r.row}`, moisture: r.soil_moisture, prob: r.irrigation_probability === null ? null : Math.round(r.irrigation_probability * 100) }))

  return (
    <div className="grid">
      <Card title="1 · Provide your dataset" right={<SourceBadge source="predicted" />} className="span-3">
        <p className="note">Upload a CSV of sensor readings. Each row is predicted by the trained models; nothing is stored. Required columns: soil moisture (%), air temperature (°C),
          humidity (%), soil temperature (°C). Optional: timestamp, rainfall, wind speed, solar radiation, irrigation minutes. Common column names are recognised automatically. Limit: 5,000 rows, 3 MB.</p>
        <div className={`drop ${drag ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); load(e.dataTransfer.files[0]) }} onClick={() => input.current?.click()} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click() }}>
          <input ref={input} type="file" accept=".csv,.txt,.json,text/csv,application/json" hidden onChange={(e) => load(e.target.files?.[0])} />
          {file ? <><b>{file.name}</b><span>{(file.text.length / 1024).toFixed(0)} KB loaded. Click to choose another file.</span></>
            : <><b>Drop a CSV here, or click to browse</b><span>.csv with a header row</span></>}
        </div>
        <div className="btns">
          <button className="btn primary" disabled={!file || busy} onClick={run}>{busy ? 'Predicting…' : 'Run predictions'}</button>
          <button className="btn" onClick={template}>Download template CSV</button>
          {err && <span className="err-msg">{err}</span>}
        </div>
      </Card>

      <Guide />

      {!res && !err && <Card className="span-3"><Empty>Results will appear here after you run predictions.</Empty></Card>}

      {res && (
        <>
          <Card title="2 · Summary" className="span-3">
            <div className="stats">
              <Stat label="Rows read" value={res.summary.rows} />
              <Stat label="Valid rows" value={res.summary.valid_rows} sub={res.summary.invalid_rows ? `${res.summary.invalid_rows} invalid (not predicted)` : 'all rows usable'} />
              {res.summary.irrigate_yes !== undefined && <Stat label="Irrigation likely needed" value={res.summary.irrigate_yes} sub={`${res.summary.irrigate_no} rows: no irrigation soon`} />}
              {res.summary.mean_probability !== undefined && <Stat label="Mean probability" value={fmt(res.summary.mean_probability * 100, 0)} unit="%" />}
              {res.summary.mean_litres !== undefined && <Stat label="Mean water per event" value={fmt(res.summary.mean_litres, 0)} unit="L" sub="if irrigating at that moment" />}
            </div>
            {res.columns.notes.map((n: string) => <div key={n} className="banner warn">{n}</div>)}
            {Object.entries(res.features_not_supplied).some(([, v]: any) => v.length) && (
              <div className="banner warn">Inputs not found in your file were replaced by typical training values: {Object.entries(res.features_not_supplied).map(([m, v]: any) => v.length ? `${m}: ${v.join(', ')}` : '').filter(Boolean).join(' • ')}</div>
            )}
            <h4>How your columns were understood</h4>
            <div className="table-wrap"><table>
              <thead><tr><th>Model input</th><th>Your column</th></tr></thead>
              <tbody>{Object.entries(res.columns.detected).map(([k, v]: any) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody>
            </table></div>
            {res.columns.ignored_columns.length > 0 && <p className="note">Ignored (not used by the models): {res.columns.ignored_columns.join(', ')}</p>}
          </Card>

          {chart.length > 1 && (
            <Card title="3 · Moisture and irrigation probability" className="span-3">
              <div className="chart"><ResponsiveContainer>
                <LineChart data={chart} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                  <XAxis dataKey="x" tick={{ fontSize: 11 }} minTickGap={40} />
                  <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line isAnimationActive={false} dataKey="moisture" name="Soil moisture (your data, %)" stroke="var(--c-moist)" dot={false} strokeWidth={2.2} />
                  <Line isAnimationActive={false} dataKey="prob" name="Irrigation probability (predicted, %)" stroke="var(--c-pred)" strokeDasharray="6 4" dot={false} strokeWidth={2.2} />
                </LineChart>
              </ResponsiveContainer></div>
            </Card>
          )}

          <Card title="4 · Row-by-row predictions" className="span-3" right={
            <div className="btns">
              <div className="seg">{(['all', 'yes', 'invalid'] as const).map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => { setFilter(f); setPage(0) }}>{f === 'all' ? 'All' : f === 'yes' ? 'Irrigate' : 'Invalid'}</button>)}</div>
              <button className="btn" onClick={() => download('predictions.csv', toCsv(rows))}>Download results</button>
            </div>}>
            <div className="table-wrap"><table>
              <thead><tr><th>#</th><th>Time</th><th>Moisture %</th><th>Irrigate?</th><th>Prob.</th><th>Litres</th><th>+1 h</th><th>+6 h</th><th>+12 h</th><th>+24 h</th></tr></thead>
              <tbody>{shown.slice(page * PAGE, (page + 1) * PAGE).map((r) => r.status === 'invalid' ? (
                <tr key={r.row} className="bad-row"><td>{r.row}</td><td>{r.timestamp ?? '—'}</td><td>{fmt(r.soil_moisture)}</td><td colSpan={7}>Invalid: {r.reason}</td></tr>
              ) : (
                <tr key={r.row}><td>{r.row}</td><td>{r.timestamp ?? '—'}</td><td>{fmt(r.soil_moisture)}</td>
                  <td>{r.irrigate === null ? '—' : <span className={`tag ${r.irrigate ? 'yes' : 'no'}`}>{r.irrigate ? 'YES' : 'NO'}</span>}</td>
                  <td>{r.irrigation_probability === null ? '—' : `${Math.round(r.irrigation_probability * 100)}%`}</td><td>{fmt(r.litres_if_irrigated, 0)}</td>
                  <td>{fmt(r.forecast_1h)}</td><td>{fmt(r.forecast_6h)}</td><td>{fmt(r.forecast_12h)}</td><td>{fmt(r.forecast_24h)}</td></tr>
              ))}</tbody>
            </table></div>
            <div className="btns">
              <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <span className="note">Page {page + 1} of {pages} ({shown.length} rows)</span>
              <button className="btn" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
            <p className="note">Forecast columns are predicted soil moisture (%) ahead of each row. {res.disclaimer}</p>
          </Card>
        </>
      )}
    </div>
  )
}
