import { useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useShared } from '../App'
import { API_URL, api, fmt, fmtTime, useApi } from '../api'
import { Async, Card, SourceBadge } from '../ui'

export const tickTime = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function LiveSensors() {
  const { latest, farm } = useShared()
  const [hours, setHours] = useState(24)
  const readings = useApi<any>(`/api/sensors/readings?hours=${hours}`, { every: 15_000 })
  const [msg, setMsg] = useState<string | null>(null)
  const sim = farm.data?.sensor_source === 'simulated'

  const run = async (path: string) => {
    setMsg(null)
    try { await api(path, { method: 'POST' }); readings.reload(); latest.reload() } catch (e) { setMsg((e as Error).message) }
  }

  return (
    <div className="grid">
      <Card title="Moisture and temperature history" right={
        <div className="seg">{[6, 24, 72].map((h) => <button key={h} className={hours === h ? 'on' : ''} onClick={() => setHours(h)}>{h} h</button>)}</div>
      } className="span-3">
        <Async f={readings} empty={(d) => d.count === 0}>
          {(d) => {
            const rows = d.readings.map((r: any) => ({ t: new Date(r.timestamp).getTime(), moisture: r.soil_moisture, air: r.air_temp, soil: r.soil_temp, humidity: r.humidity }))
            return (
              <>
                <p className="note"><SourceBadge source={d.source} /> {d.count} readings in the last {hours} h. Shaded band = optimal moisture range from Settings.</p>
                <div className="chart">
                  <ResponsiveContainer>
                    <LineChart data={rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                      <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={tickTime} tick={{ fontSize: 11 }} minTickGap={50} />
                      <YAxis yAxisId="l" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                      <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} unit="°" />
                      <Tooltip labelFormatter={(t) => tickTime(Number(t))} formatter={(v) => (typeof v === "number" ? v.toFixed(1) : v)} />
                      <Legend />
                      <ReferenceArea yAxisId="l" y1={farm.data?.start_threshold ?? 40} y2={farm.data?.stop_threshold ?? 60} fill="var(--zone-ok)" fillOpacity={0.12} ifOverflow="hidden" />
                      <Line isAnimationActive={false} yAxisId="l" dataKey="moisture" name="Soil moisture (%)" stroke="var(--c-moist)" dot={false} strokeWidth={2.2} />
                      <Line isAnimationActive={false} yAxisId="l" dataKey="humidity" name="Humidity (%)" stroke="var(--c-hum)" dot={false} strokeWidth={1.4} />
                      <Line isAnimationActive={false} yAxisId="r" dataKey="air" name="Air temp (°C)" stroke="var(--c-air)" dot={false} strokeWidth={1.4} />
                      <Line isAnimationActive={false} yAxisId="r" dataKey="soil" name="Soil temp (°C)" stroke="var(--c-soil)" dot={false} strokeWidth={1.4} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )
          }}
        </Async>
      </Card>

      {sim ? (
        <Card title="Simulator" right={<SourceBadge source="simulated" />}>
          <p>Simulated mode generates synthetic readings for development. They are stored with source <code>simulated</code> and are never counted as physical sensor data.</p>
          <div className="btns">
            <button className="btn" onClick={() => run('/api/simulator/tick')}>Add one reading</button>
            <button className="btn" onClick={() => run('/api/simulator/backfill?hours=48')}>Backfill 48 h</button>
          </div>
          {msg && <div className="banner err">{msg}</div>}
        </Card>
      ) : (
        <Card title="Device mode" right={<SourceBadge source="device" />}>
          <p>Showing readings sent by physical devices only. If nothing appears, no device has posted yet.</p>
        </Card>
      )}

      <Card title="ESP32 request format" className="span-2">
        <pre className="code">{`POST ${API_URL || location.origin}/api/sensors/readings
X-API-Key: <DEVICE_API_KEY>
Content-Type: application/json

{
  "device_id": "esp32-zone1",
  "soil_moisture": 41.5,      // % (0-100)
  "air_temp": 27.3,           // °C
  "humidity": 58.0,           // %
  "soil_temp": 24.1,          // °C
  "timestamp": "2026-06-01T10:15:00Z",   // optional
  "rainfall": 0.0             // optional, mm
}`}</pre>
      </Card>

      <Card title="Latest readings" className="span-3">
        <Async f={readings} empty={(d) => d.count === 0}>
          {(d) => (
            <div className="table-wrap"><table>
              <thead><tr><th>Time</th><th>Moisture %</th><th>Air °C</th><th>Hum %</th><th>Soil °C</th><th>Source</th><th>Valid</th></tr></thead>
              <tbody>{[...d.readings].reverse().slice(0, 12).map((r: any) => (
                <tr key={r.id}><td>{fmtTime(r.timestamp)}</td><td>{fmt(r.soil_moisture)}</td><td>{fmt(r.air_temp)}</td><td>{fmt(r.humidity, 0)}</td>
                  <td>{fmt(r.soil_temp)}</td><td><SourceBadge source={r.source} /></td><td>{r.valid ? '✓' : `✗ ${r.invalid_reason}`}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Async>
      </Card>
    </div>
  )
}
