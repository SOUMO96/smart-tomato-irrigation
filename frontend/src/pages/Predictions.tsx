import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar } from 'recharts'
import { useShared } from '../App'
import { fmt, fmtTime, useApi } from '../api'
import { Async, Card, SourceBadge, Stat, Unavailable } from '../ui'
import { tickTime } from './LiveSensors'

export function Drivers({ drivers, unit }: { drivers: any[]; unit: string }) {
  const max = Math.max(...drivers.map((d) => Math.abs(d.effect)), 1e-9)
  return (
    <div className="drivers">
      {drivers.map((d) => (
        <div key={d.feature} className="driver">
          <span className="d-l">{d.label}</span>
          <span className="d-v">{d.value} <small>(typical {d.training_median})</small></span>
          <span className="d-bar"><i className={d.effect >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(d.effect) / max) * 100}%` }} /></span>
          <span className="d-e">{d.effect >= 0 ? '+' : ''}{d.effect}{unit}</span>
        </div>
      ))}
    </div>
  )
}

export const Missing = ({ list }: { list?: string[] }) =>
  list?.length ? <div className="banner warn">Degraded: inputs unavailable and replaced by training medians — {list.join(', ')}</div> : null

export function Irrigation() {
  const { pred } = useShared()
  return (
    <div className="grid">
      <Card title="Will irrigation be needed in the next hour?" right={<SourceBadge source="predicted" />} className="span-2">
        <Async f={pred}>
          {(p) => p.irrigation.status === 'unavailable' ? <Unavailable p={p.irrigation} /> : (
            <>
              {p.sensor_state.status === 'stale' && <div className="banner warn">Sensor data is stale: {p.sensor_state.reason}</div>}
              <Missing list={p.irrigation.inputs_missing} />
              <div className={`verdict big ${p.irrigation.irrigate ? 'yes' : 'no'}`}>Irrigation required: {p.irrigation.irrigate ? 'YES' : 'NO'}</div>
              <div className="stats">
                <Stat label="Probability" value={fmt(p.irrigation.probability * 100, 0)} unit="%" />
                <Stat label="Decision threshold" value={fmt(p.irrigation.threshold * 100, 0)} unit="%" />
                <Stat label="Model" value={p.irrigation.model} sub="selected by held-out F1" />
              </div>
              <h4>Why? <small>effect of each input on the probability, versus a typical training value</small></h4>
              <Drivers drivers={p.irrigation.explanation.drivers} unit="" />
              <p className="note">Computed {fmtTime(p.computed_at)} from <b>{p.input_source}</b> sensor input. This model imitates the study farm's threshold-based
                irrigation decisions (see Model Performance for its measured skill); treat it as advisory. It never bypasses safety limits.</p>
            </>
          )}
        </Async>
      </Card>
      <Card title="Global feature importance">
        <ModelImportance section="classification" />
      </Card>
    </div>
  )
}

function ModelImportance({ section }: { section: string }) {
  const perf = useApi<any>('/api/models/performance')
  return (
    <Async f={perf}>
      {(m) => !m[section] ? <Unavailable p={m} /> : (
        <div className="chart sm"><ResponsiveContainer>
          <BarChart data={m[section].feature_importance} layout="vertical" margin={{ left: 40, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11 }} />
            <Tooltip /><Bar isAnimationActive={false} dataKey="importance" fill="var(--c-pred)" />
          </BarChart></ResponsiveContainer>
          <p className="note">Permutation importance on the held-out test set.</p></div>
      )}
    </Async>
  )
}

export function Water() {
  const { pred } = useShared()
  return (
    <div className="grid">
      <Card title="Machine-learning estimate" right={<SourceBadge source="predicted" />}>
        <Async f={pred}>
          {(p) => p.water.status === 'unavailable' ? <Unavailable p={p.water} /> : (
            <>
              <Missing list={p.water.inputs_missing} />
              <Stat label="Litres for one irrigation event" value={fmt(p.water.litres, 0)} unit="L" sub={`${p.water.model} • training range ${p.water.training_range_l.join('–')} L`} />
              <h4>Drivers</h4>
              <Drivers drivers={p.water.explanation.drivers} unit=" L" />
              <p className="note">Learned from 176 irrigation events at one research farm (1.1 L/min valves). The value is in that farm's units and is not scaled by your zone area;
                labels are valve-open time × nominal flow, not metered volumes. See Model Performance for measured error.</p>
            </>
          )}
        </Async>
      </Card>
      <Card title="Agronomic calculation (FAO-56)" right={<SourceBadge source="agronomic" />}>
        <Async f={pred}>
          {(p) => p.agronomy.status === 'unavailable' ? <Unavailable p={p.agronomy} /> : (
            <>
              <div className="stats two">
                <Stat label="ET₀ today" value={fmt(p.agronomy.et0_mm_day, 2)} unit="mm" />
                <Stat label={`Kc (${p.agronomy.stage.replace('_', ' ')})`} value={fmt(p.agronomy.kc, 2)} />
                <Stat label="Crop ET (ETc)" value={fmt(p.agronomy.etc_mm_day, 2)} unit="mm" />
                <Stat label="Effective rain" value={fmt(p.agronomy.effective_rain_mm, 2)} unit="mm" />
                <Stat label="Gross irrigation" value={fmt(p.agronomy.gross_irrigation_mm, 2)} unit="mm" sub={`efficiency ${p.agronomy.irrigation_efficiency}`} />
                <Stat label={`Zone (${p.agronomy.zone_area_m2} m²)`} value={fmt(p.agronomy.litres_per_day, 0)} unit="L/day" />
              </div>
              <ul className="note">{p.agronomy.assumptions.map((a: string) => <li key={a}>{a}</li>)}</ul>
              <p className="note">{p.agronomy.method}. Ref: {p.agronomy.reference}</p>
            </>
          )}
        </Async>
      </Card>
    </div>
  )
}

export function Forecast() {
  const { pred, farm } = useShared()
  const hist = useApi<any>('/api/sensors/readings?hours=30', { every: 60_000 })
  return (
    <div className="grid">
      <Card title="Soil moisture: observed and forecast" right={<SourceBadge source="predicted" />} className="span-3">
        <Async f={pred}>
          {(p) => p.forecast.status === 'unavailable' ? <Unavailable p={p.forecast} /> : (
            <>
              <Missing list={p.forecast.inputs_missing} />
              <ForecastChart p={p} hist={hist.data?.readings ?? []} start={farm.data?.start_threshold} stop={farm.data?.stop_threshold} />
              <div className="stats">
                {p.forecast.forecasts.map((f: any) => (
                  <Stat key={f.horizon_h} label={`In ${f.horizon_h} h`} value={fmt(f.soil_moisture, 1)} unit="%"
                        sub={f.test_mae !== null ? `typical error ±${f.test_mae} (n=${f.test_rows})` : undefined} />
                ))}
              </div>
              <ul className="note">{p.forecast.assumptions.map((a: string) => <li key={a}>{a}</li>)}
                <li>Forecasts start from the <b>{p.input_source}</b> reading at {fmtTime(p.forecast.anchor_time)}.</li></ul>
            </>
          )}
        </Async>
      </Card>
    </div>
  )
}

function ForecastChart({ p, hist, start, stop }: { p: any; hist: any[]; start?: number; stop?: number }) {
  const anchor = new Date(p.forecast.anchor_time).getTime()
  const rows: any[] = hist.filter((r) => r.valid).map((r) => ({ t: new Date(r.timestamp).getTime(), observed: r.soil_moisture }))
  rows.push({ t: anchor, forecast: p.reading.soil_moisture })
  p.forecast.forecasts.forEach((f: any) => rows.push({ t: anchor + f.horizon_h * 3600_000, forecast: f.soil_moisture }))
  rows.sort((a, b) => a.t - b.t)
  return (
    <div className="chart">
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={tickTime} tick={{ fontSize: 11 }} minTickGap={50} />
          <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
          <Tooltip labelFormatter={(t) => tickTime(Number(t))} formatter={(v) => (typeof v === "number" ? v.toFixed(1) : v)} />
          <Legend />
          {start !== undefined && <ReferenceLine y={start} stroke="var(--warn)" strokeDasharray="4 4" label={{ value: 'start', fontSize: 10 }} />}
          {stop !== undefined && <ReferenceLine y={stop} stroke="var(--c-moist)" strokeDasharray="4 4" label={{ value: 'stop', fontSize: 10 }} />}
          <ReferenceLine x={anchor} stroke="var(--muted)" label={{ value: 'now', fontSize: 10 }} />
          <Line isAnimationActive={false} dataKey="observed" name={p.input_source === 'simulated' ? 'Simulated readings' : 'Sensor readings'} stroke="var(--c-moist)" dot={false} strokeWidth={2.2} connectNulls />
          <Line isAnimationActive={false} dataKey="forecast" name="Forecast (model)" stroke="var(--c-pred)" strokeDasharray="6 4" strokeWidth={2.2} dot={{ r: 4 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
