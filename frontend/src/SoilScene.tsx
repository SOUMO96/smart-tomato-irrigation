import { SceneDefs } from './Scene'

const clamp = (v: number) => Math.max(0, Math.min(1, v))
const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t)

/**
 * Soil cross-section that reacts to a 0-100 moisture value, in both directions:
 *  - too dry: cracked surface, wilting, browning
 *  - too wet: standing water, air bubbles (roots short of oxygen), rotting roots, yellowing leaves, cracked fruit
 * Illustration only; zone limits follow the dataset's tomato soil model (20 / 40 / 60 / 80).
 */
export default function SoilScene({ moisture, dripping }: { moisture: number; dripping: boolean }) {
  const w = clamp(moisture / 100)
  const drought = clamp((40 - moisture) / 40)
  const severe = clamp((20 - moisture) / 20)
  const over = clamp((moisture - 60) / 40)
  const sat = clamp((moisture - 80) / 20)
  const topSoil = `rgb(${mix(196, 62, w)} ${mix(154, 46, w)} ${mix(99, 30, w)})`
  const deepSoil = `rgb(${mix(150, 36, w)} ${mix(112, 28, w)} ${mix(70, 20, w)})`
  const wilt = Math.max(drought, over * 0.35 + sat * 0.5) // overwatered plants also wilt: roots cannot take up water without oxygen
  const filter = `saturate(${1 - drought * 0.65 - over * 0.2}) sepia(${drought * 0.45 + sat * 0.4}) hue-rotate(${-(over * 30 + sat * 22)}deg) brightness(${1 - drought * 0.1 - sat * 0.12})`
  const rootColor = `rgb(${mix(241, 110, sat)} ${mix(228, 75, sat)} ${mix(196, 44, sat)})`
  const roots = [[250, 250], [400, 240], [300, 330], [360, 310], [210, 200], [440, 190]]
  const cracks = [[250, 142, 236, 178], [300, 142, 312, 170], [345, 142, 332, 182], [400, 142, 416, 174], [455, 142, 446, 168], [200, 142, 212, 166]]

  return (
    <svg className="soil-scene" viewBox="0 0 640 400" role="img" aria-label={`Soil cross-section at ${Math.round(moisture)} percent moisture`}>
      <SceneDefs />
      <defs>
        <linearGradient id="airG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#bfe3f5" /><stop offset="1" stopColor="#eaf6e4" /></linearGradient>
        <linearGradient id="soilG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={topSoil} /><stop offset="1" stopColor={deepSoil} /></linearGradient>
        <clipPath id="soilClip"><rect y="140" width="640" height="260" /></clipPath>
        <radialGradient id="bulb" cx=".5" cy=".25" r=".75"><stop offset="0" stopColor="#1a0f06" stopOpacity={0.15 + w * 0.6} /><stop offset="1" stopColor="#1a0f06" stopOpacity="0" /></radialGradient>
        <linearGradient id="puddle" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d6eefb" stopOpacity=".95" /><stop offset="1" stopColor="#6fb4e0" stopOpacity=".85" /></linearGradient>
      </defs>

      <rect width="640" height="140" fill="url(#airG)" />
      <rect y="140" width="640" height="260" fill="url(#soilG)" style={{ transition: 'all .5s' }} />
      <g clipPath="url(#soilClip)"><ellipse cx="320" cy="170" rx={50 + w * 280} ry={30 + w * 220} fill="url(#bulb)" style={{ transition: 'all .5s' }} /></g>
      {sat > 0 && <rect y="140" width="640" height="260" fill="#2c4a5a" opacity={sat * 0.25} style={{ transition: 'opacity .5s' }} />}
      <rect y="140" width="640" height="260" filter="url(#grain)" opacity=".28" style={{ mixBlendMode: 'multiply' }} />
      <rect y="136" width="640" height="6" fill="#8b6a45" opacity=".6" />

      {/* too dry: cracks in the surface */}
      <g style={{ opacity: clamp(drought * 1.6 - 0.35), transition: 'opacity .5s' }} stroke="#3b2410" strokeWidth={1 + severe * 1.4} strokeLinecap="round" fill="none">
        {cracks.map(([x1, y1, x2, y2], i) => <path key={i} d={`M${x1} ${y1} L${(x1 + x2) / 2 + 6} ${(y1 + y2) / 2} L${x2} ${y2 + severe * 24}`} />)}
      </g>

      {/* roots: pale and healthy, turning brown and dying in waterlogged soil */}
      {roots.map(([ex, ey], i) => (
        <g key={i}>
          <path d={`M320 142 C ${320 + (ex - 320) * 0.2} 202 ${ex} ${ey - 50} ${ex} ${ey}`} stroke={rootColor} strokeWidth={i < 2 ? 3 : 2} fill="none" opacity={0.8 - sat * 0.15} strokeLinecap="round" style={{ transition: 'stroke .5s' }} />
          <circle cx={ex} cy={ey} r={3.2} fill="#33200f" opacity={clamp(sat * 1.6)} style={{ transition: 'opacity .5s' }} />
        </g>
      ))}

      {/* too wet: air bubbles rising out of oxygen-starved soil */}
      {over > 0.25 && Array.from({ length: Math.round(3 + sat * 8) }, (_, i) => (
        <circle key={i} className="bubble" cx={230 + ((i * 53) % 190)} cy={330 - ((i * 37) % 110)} r={2 + (i % 3)} fill="none" stroke="#cfe9f7" strokeWidth="1.2" opacity=".7" style={{ animationDelay: `${i * 0.45}s` }} />
      ))}
      {dripping && Array.from({ length: 7 }, (_, i) => <circle key={i} className="perc" cx={290 + i * 9} cy="160" r="2.4" fill="#8fd0ff" style={{ animationDelay: `${i * 0.35}s` }} />)}

      {/* standing water on the surface */}
      <g style={{ opacity: clamp(sat * 3), transition: 'opacity .5s' }}>
        <ellipse cx="320" cy="140" rx={40 + sat * 270} ry={3 + sat * 7} fill="url(#puddle)" />
        <ellipse className="ripple2" cx="320" cy="140" rx="10" ry="2.2" fill="none" stroke="#fff" strokeWidth="1.2" />
        <ellipse className="ripple2 r2" cx="320" cy="140" rx="10" ry="2.2" fill="none" stroke="#fff" strokeWidth="1.2" />
      </g>

      <line x1="150" y1="133" x2="490" y2="133" stroke="#16181a" strokeWidth="6" strokeLinecap="round" />
      <circle cx="320" cy="133" r="6" fill="#2b2f33" stroke="#7b8590" />
      {dripping && [0, 1, 2].map((d) => <path key={d} className="drop big" d="M320 141 c 4 7 6 11 0 15 c -6 -4 -4 -8 0 -15 z" fill="url(#drop)" style={{ animationDelay: `${d * 0.55}s` }} />)}

      <g transform="translate(320 140) scale(.8)">
        <g style={{ transform: `rotate(${wilt * 9}deg) scaleY(${1 - wilt * 0.14})`, transformOrigin: '50% 100%', transformBox: 'fill-box', transition: 'transform .6s, filter .6s', filter }}>
          <use href="#plant" />
          {/* waterlogging damage: leaf spots and cracked fruit */}
          <g style={{ opacity: clamp(sat * 1.5), transition: 'opacity .5s' }} fill="#5b3a14">
            <circle cx="40" cy="-60" r="4" /><circle cx="-38" cy="-84" r="3.4" /><circle cx="46" cy="-128" r="3.8" /><circle cx="-44" cy="-166" r="3" />
          </g>
          <g style={{ opacity: clamp(over * 1.6 - 0.5), transition: 'opacity .5s' }} stroke="#4a0a07" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M28 -100 L33 -94 L29 -88 L35 -83" /><path d="M-31 -142 L-26 -137 L-30 -131" /><path d="M22 -180 L27 -175 L23 -170" />
          </g>
        </g>
      </g>
    </svg>
  )
}
