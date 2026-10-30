import { useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { useShared } from '../App'
import { ago, api, fmt, fmtTime, useApi } from '../api'
import Gauge from '../Gauge'
import { Icon } from '../icons'
import { Async, Card, SourceBadge, Stat, toast } from '../ui'

function Chip({ icon, title, sub, level }: { icon: string; title: string; sub: string; level: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className={`chip ${level}`}>
      <span className="ci"><Icon name={icon} /></span>
      <div style={{ minWidth: 0 }}><b>{title}</b><small title={sub}>{sub}</small></div>
    </div>
  )
}

function HealthStrip() {
  const { pred, status, latest, health } = useShared()
  const st = latest.data?.state
  const sensorLevel = !st ? 'bad' : st.status === 'ok' ? 'ok' : st.status === 'stale' ? 'warn' : 'bad'
  const w = pred.data?.weather
  const models = health.data ? Object.values(health.data.models as Record<string, { available: boolean }>) : []
  const loaded = models.filter((m) => m.available).length
  const pump = status.data?.pump
  return (
    <div className="health">
      <Chip icon="sensors" title="Sensor data" level={sensorLevel} sub={!st ? 'no data' : st.status === 'ok' ? `fresh, ${ago(st.age_s)}` : `${st.status}: ${st.reason ?? ''}`} />
      <Chip icon="cloud" title="Weather" level={!w ? 'warn' : w.status === 'ok' ? 'ok' : w.status === 'stale' ? 'warn' : 'bad'} sub={!w ? 'loading' : w.status === 'unavailable' ? 'unavailable: degraded predictions' : w.status === 'stale' ? 'cached (offline)' : 'Open-Meteo live'} />
      <Chip icon="cpu" title="ML models" level={loaded === 3 ? 'ok' : loaded ? 'warn' : 'bad'} sub={`${loaded} of 3 loaded`} />
      <Chip icon="shield" title="Pump safety" level={pump?.emergency_stop ? 'bad' : 'ok'} sub={!pump ? 'loading' : pump.emergency_stop ? 'EMERGENCY STOP active' : `armed, max ${Math.round(pump.max_runtime_s / 60)} min run`} />
    </div>
  )
}

function Trend() {
  const r = useApi<any>('/api/sensors/readings?hours=6', { every: 30_000 })
  const rows = (r.data?.readings ?? []).filter((x: any) => x.valid).map((x: any) => ({ t: x.timestamp, v: x.soil_moisture }))
  if (rows.length < 3) return <p className="note">Trend appears once there are a few readings.</p>
  return (
    <div className="spark" aria-label="Soil moisture, last 6 hours">
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--c-moist)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--c-moist)" stopOpacity={0} /></linearGradient></defs>
          <YAxis hide domain={[0, 100]} />
          <Area dataKey="v" stroke="var(--c-moist)" strokeWidth={2} fill="url(#sg)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
      <p className="note" style={{ textAlign: 'center' }}>last 6 hours</p>
    </div>
  )
}

function ClimateTrend() {
  const r = useApi<any>('/api/sensors/readings?hours=12', { every: 30_000 })
  const rows = (r.data?.readings ?? []).filter((x: any) => x.valid).map((x: any) => ({ t: new Date(x.timestamp).getTime(), air: x.air_temp, soil: x.soil_temp }))
  if (rows.length < 3) return null
  return (
    <div>
      <h4>Temperatures, last 12 hours</h4>
      <div className="chart sm" style={{ height: 170 }}>
        <ResponsiveContainer>
          <AreaChart data={rows} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
            <defs>
              <linearGradient id="airG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--c-air)" stopOpacity={0.35} /><stop offset="1" stopColor="var(--c-air)" stopOpacity={0} /></linearGradient>
              <linearGradient id="soilG2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--c-soil)" stopOpacity={0.3} /><stop offset="1" stopColor="var(--c-soil)" stopOpacity={0} /></linearGradient>
            </defs>
            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} tick={{ fontSize: 10 }} minTickGap={40} />
            <YAxis tick={{ fontSize: 10 }} unit="°" domain={['auto', 'auto']} />
            <Area isAnimationActive={false} dataKey="air" name="Air °C" stroke="var(--c-air)" strokeWidth={2} fill="url(#airG)" />
            <Area isAnimationActive={false} dataKey="soil" name="Soil °C" stroke="var(--c-soil)" strokeWidth={2} fill="url(#soilG2)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function Overview() {
  const { pred, status, latest, farm } = useShared()
  const [busy, setBusy] = useState(false)

  const act = async (path: string, ok: string) => {
    setBusy(true)
    try { await api(path, { method: 'POST' }); toast(ok); status.reload() } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }

  return (
    <div className="grid">
      <Card className="span-3"><HealthStrip /></Card>

      <Card title="Soil moisture" right={<SourceBadge source={latest.data?.source} />}>
        <Async f={latest} empty={(d) => !d.reading}>
          {(d) => (
            <>
              <Gauge value={d.reading.soil_moisture} start={farm.data?.start_threshold ?? 40} stop={farm.data?.stop_threshold ?? 60}
                label={`irrigate below ${farm.data?.start_threshold ?? 40}%, stop at ${farm.data?.stop_threshold ?? 60}%`} />
              <Trend />
            </>
          )}
        </Async>
      </Card>

      <Card title="Current conditions" right={<SourceBadge source={latest.data?.source} />} className="span-2">
        <Async f={latest} empty={(d) => !d.reading}>
          {(d) => {
            const r = d.reading
            return (
              <>
                {d.state.status !== 'ok' && <div className="banner warn">Sensor data {d.state.status}: {d.state.reason}</div>}
                <div className="stats">
                  <Stat label="Air temperature" value={fmt(r.air_temp, 1)} unit="°C" />
                  <Stat label="Humidity" value={fmt(r.humidity, 0)} unit="%" />
                  <Stat label="Soil temperature" value={fmt(r.soil_temp, 1)} unit="°C" />
                  <Stat label="Rainfall (sensor)" value={r.rainfall === null ? '—' : fmt(r.rainfall, 1)} unit={r.rainfall === null ? '' : 'mm'} sub={r.rainfall === null ? 'not reported' : undefined} />
                  <Stat label="Last sensor update" value={ago(d.state.age_s)} sub={fmtTime(r.timestamp)} />
                </div>
                <p className="note">{d.label}</p>
                <ClimateTrend />
              </>
            )
          }}
        </Async>
      </Card>

      <Card title="Irrigation status">
        <Async f={status}>
          {(s) => (
            <>
              <div className="stats one">
                <Stat label="Pump" value={<span className={s.pump.running ? 'on' : 'off'}>{s.pump.running ? 'RUNNING' : 'Off'}</span>}
                      badge={<span className={`badge ${s.pump.simulated ? 'b-sim' : 'b-real'}`}>{s.pump.simulated ? 'SIMULATED PUMP' : 'PHYSICAL'}</span>}
                      sub={s.pump.running ? `${Math.round(s.pump.runtime_s / 60)} min of max ${Math.round(s.pump.max_runtime_s / 60)}` : 'idle'} />
                <Stat label="Mode" value={s.mode.replace('_', ' ')} sub={s.pump.emergency_stop ? 'EMERGENCY STOP ACTIVE' : 'safety interlocks armed'} />
              </div>
              {s.pump.running && <div className="pipe" aria-label="Water flowing (simulated)"><i /></div>}
              <div className="btns">
                <button className="btn primary" disabled={busy || s.pump.running || s.pump.emergency_stop} onClick={() => act('/api/irrigation/start', 'Pump started (simulated)')}>Start (manual)</button>
                <button className="btn" disabled={busy || !s.pump.running} onClick={() => act('/api/irrigation/stop', 'Pump stopped')}>Stop</button>
                {s.pump.emergency_stop
                  ? <button className="btn" disabled={busy} onClick={() => act('/api/irrigation/emergency-reset', 'Emergency stop reset')}>Reset e-stop</button>
                  : <button className="btn danger" disabled={busy} onClick={() => act('/api/irrigation/emergency-stop', 'EMERGENCY STOP engaged')}>EMERGENCY STOP</button>}
              </div>
              <p className="note">Pump control is simulated. Physical control is disabled until hardware is configured.</p>
            </>
          )}
        </Async>
      </Card>

      <Card title="Predicted water requirement" right={<SourceBadge source="predicted" />}>
        <Async f={pred}>
          {(p) => (
            <>
              {p.water.status === 'unavailable'
                ? <p className="muted">ML estimate unavailable: {p.water.reason}</p>
                : <Stat label="ML estimate per irrigation event" value={fmt(p.water.litres, 0)} unit="L" sub={`typical event in training zones • ${p.water.status}`} />}
              {p.agronomy.status !== 'unavailable'
                ? <Stat label={<>FAO-56 daily need <SourceBadge source="agronomic" /></>} value={fmt(p.agronomy.litres_per_day, 0)} unit="L/day" sub={`${p.agronomy.stage.replace('_', ' ')}, ${p.agronomy.zone_area_m2} m²`} />
                : <p className="muted">Agronomic estimate unavailable: {p.agronomy.reason}</p>}
            </>
          )}
        </Async>
      </Card>

      <Card title="AI irrigation recommendation" right={<SourceBadge source="predicted" />}>
        <Async f={pred}>
          {(p) => p.irrigation.status === 'unavailable'
            ? <p className="muted">Unavailable: {p.irrigation.reason}</p>
            : (
              <>
                <div className={`verdict ${p.irrigation.irrigate ? 'yes' : 'no'}`}>{p.irrigation.irrigate ? 'Irrigation likely needed' : 'No irrigation needed soon'}</div>
                <p className="note">Probability {fmt(p.irrigation.probability * 100, 0)}% (threshold {fmt(p.irrigation.threshold * 100, 0)}%) • {p.irrigation.model}</p>
                <p className="note">Computed {fmtTime(p.computed_at)} from <b>{p.input_source}</b> sensor data. Advisory only: it cannot override safety limits.</p>
              </>
            )}
        </Async>
        <button className="btn" onClick={() => { pred.reload(); toast('Predictions refreshed') }}>Refresh predictions</button>
      </Card>

      <Card title="Weather (Open-Meteo)" right={<SourceBadge source="weather" />} className="span-2">
        <Async f={pred}>
          {(p) => p.weather.status === 'unavailable'
            ? <p className="muted">Weather unavailable ({p.weather.error}). Models run in degraded mode without wind, radiation and rain inputs.</p>
            : (
              <div className="stats">
                <Stat label="Air temp" value={fmt(p.weather.air_temp, 1)} unit="°C" />
                <Stat label="Rain 24 h" value={fmt(p.weather.rain_24h, 1)} unit="mm" />
                <Stat label="Wind" value={fmt(p.weather.wind_speed, 0)} unit="km/h" />
                <Stat label="Solar (direct)" value={fmt(p.weather.solar_radiation, 0)} unit="W/m²" />
                <Stat label="Rain next 24 h" value={fmt(p.weather.forecast_rain_next_24h, 1)} unit="mm" sub="forecast" />
                <Stat label="Status" value={p.weather.status} sub={p.weather.cached ? 'cached' : 'live'} />
              </div>
            )}
        </Async>
      </Card>
    </div>
  )
}
