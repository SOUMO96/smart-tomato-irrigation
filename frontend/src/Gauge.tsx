/** Semi-circular soil-moisture gauge with dry / optimal / wet zones taken from the farm settings. */
const CX = 100, CY = 100, R = 78

const pt = (v: number, r = R) => {
  const a = Math.PI * (1 - Math.max(0, Math.min(100, v)) / 100)
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)]
}
const arc = (v1: number, v2: number) => {
  const [x1, y1] = pt(v1), [x2, y2] = pt(v2)
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`
}

export default function Gauge({ value, start, stop, label }: { value: number | null; start: number; stop: number; label?: string }) {
  const [nx, ny] = pt(value ?? 0, R - 14)
  const zone = value === null ? 'none' : value < start ? 'dry' : value < stop ? 'ok' : 'wet'
  const text = { none: 'No data', dry: 'Dry: irrigation zone', ok: 'In optimal range', wet: 'Wet: no irrigation' }[zone]
  return (
    <div className="gauge">
      <svg viewBox="0 0 200 120" role="img" aria-label={`Soil moisture ${value ?? 'unknown'} percent`}>
        <path d={arc(0, start)} className="g-dry" />
        <path d={arc(start, stop)} className="g-ok" />
        <path d={arc(stop, 100)} className="g-wet" />
        {value !== null && (
          <>
            <line x1={CX} y1={CY} x2={nx} y2={ny} className="g-needle" />
            <circle cx={CX} cy={CY} r="6" className="g-hub" />
          </>
        )}
        <text x="22" y="116" className="g-tick">0</text>
        <text x="178" y="116" className="g-tick" textAnchor="end">100</text>
      </svg>
      <div className="g-val">{value === null ? '—' : value.toFixed(1)}<span>%</span></div>
      <div className={`g-state ${zone}`}>{text}</div>
      {label && <div className="g-sub">{label}</div>}
    </div>
  )
}
