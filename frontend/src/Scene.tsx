import { useEffect, useState } from 'react'

/** Layered, animated SVG illustration of a drip-irrigated tomato field. Pure SVG + CSS (no images, no JS animation loop). */

const VP_X = 720, VP_Y = 468 // vanishing point of the crop rows

/** Shared artwork: gradients, grain filter and the tomato plant symbol (origin at the stem base, growing upward). */
export function SceneDefs() {
  return (
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#0f4468" /><stop offset=".42" stopColor="#4a9cc7" /><stop offset=".78" stopColor="#f3cf9c" /><stop offset="1" stopColor="#ffe6bd" />
      </linearGradient>
      <radialGradient id="sunGlow" cx=".5" cy=".5" r=".5">
        <stop offset="0" stopColor="#fff7d6" stopOpacity="1" /><stop offset=".22" stopColor="#ffe08a" stopOpacity=".75" /><stop offset="1" stopColor="#ffc878" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="hillFar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8fb6c4" /><stop offset="1" stopColor="#a9c9b4" /></linearGradient>
      <linearGradient id="hillNear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5f9a6e" /><stop offset="1" stopColor="#7fae6a" /></linearGradient>
      <linearGradient id="soil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7a5636" /><stop offset=".5" stopColor="#523620" /><stop offset="1" stopColor="#2c1d10" /></linearGradient>
      <linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7cc25a" /><stop offset="1" stopColor="#2c7a30" /></linearGradient>
      <radialGradient id="tomato" cx=".35" cy=".3" r=".8">
        <stop offset="0" stopColor="#ff8f78" /><stop offset=".45" stopColor="#e03a2b" /><stop offset="1" stopColor="#8d1a14" />
      </radialGradient>
      <radialGradient id="tomatoGreen" cx=".35" cy=".3" r=".8"><stop offset="0" stopColor="#c8e48a" /><stop offset="1" stopColor="#5d9a32" /></radialGradient>
      <radialGradient id="wet" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#1d1208" stopOpacity=".75" /><stop offset="1" stopColor="#1d1208" stopOpacity="0" /></radialGradient>
      <linearGradient id="drop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d8f1ff" /><stop offset="1" stopColor="#4aa8e0" /></linearGradient>
      <filter id="blur6"><feGaussianBlur stdDeviation="6" /></filter>
      <filter id="grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="4" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .5 0" />
      </filter>

      <g id="leafShape">
        <path d="M0 0 C 20 -24 60 -22 78 0 C 60 22 20 24 0 0 Z" fill="url(#leaf)" />
        <path d="M4 0 C 30 -2 52 -2 72 0" stroke="#2c6a28" strokeWidth="1.4" fill="none" opacity=".6" />
      </g>
      <g id="tomatoFruit">
        <circle r="13" fill="url(#tomato)" />
        <ellipse cx="-4" cy="-5" rx="3.6" ry="2.2" fill="#fff" opacity=".35" />
        <path d="M-7 -11 L0 -7 L7 -11 L3 -5 L0 -15 L-3 -5 Z" fill="#3f7d27" />
      </g>
      <g id="plant">
        <rect x="-2" y="-270" width="4" height="270" fill="#b98e55" />
        <path d="M0 0 C -5 -60 6 -125 0 -245" stroke="#4c8a32" strokeWidth="6" fill="none" strokeLinecap="round" />
        <use href="#leafShape" transform="translate(0 -40) rotate(-28)" />
        <use href="#leafShape" transform="translate(0 -70) scale(-1 1) rotate(-22)" />
        <use href="#leafShape" transform="translate(0 -110) rotate(-34)" />
        <use href="#leafShape" transform="translate(0 -150) scale(-1 1) rotate(-30)" />
        <use href="#leafShape" transform="translate(0 -190) rotate(-40) scale(.85)" />
        <use href="#leafShape" transform="translate(0 -225) scale(-1 1) rotate(-48) scale(.7)" />
        <use href="#tomatoFruit" transform="translate(32 -92)" />
        <use href="#tomatoFruit" transform="translate(-28 -136) scale(.92)" />
        <use href="#tomatoFruit" transform="translate(24 -176) scale(.8)" />
        <g transform="translate(-40 -84) scale(.62)"><circle r="13" fill="url(#tomatoGreen)" /></g>
      </g>
    </defs>
  )
}

const PLANTS = [60, 250, 440, 640, 840, 1040, 1230, 1410]
const rows = Array.from({ length: 22 }, (_, i) => -10 + i)

/** True on phone-sized screens; the hero crops the artwork differently there so plants and sun keep their proportions. */
function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 760px)').matches)
  useEffect(() => {
    const mq = matchMedia('(max-width: 760px)')
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

export default function Scene() {
  const narrow = useNarrow()
  const bottomX = (i: number) => VP_X + (i - 5) * 150
  return (
    <svg className="scene" viewBox="0 0 1440 760" preserveAspectRatio={narrow ? 'xMaxYMax slice' : 'xMidYMax slice'} role="img" aria-label="Animated illustration of a drip-irrigated tomato field">
      <SceneDefs />
      <rect width="1440" height="760" fill="url(#sky)" />

      <g className="px" style={{ ['--k' as string]: 6 }}>
        <circle cx="1130" cy="230" r="360" fill="url(#sunGlow)" className="sun-glow" />
        <g transform="translate(1130 230)">
          <g className="rays">
            {Array.from({ length: 14 }, (_, i) => <rect key={i} x="-3" y="-120" width="6" height="52" rx="3" fill="#fff3c0" opacity=".45" transform={`rotate(${i * (360 / 14)})`} />)}
          </g>
        </g>
        <circle cx="1130" cy="230" r="46" fill="#fff6d0" />
      </g>

      <g className="px" style={{ ['--k' as string]: 14 }} filter="url(#blur6)">
        <g className="cloud c1"><ellipse cx="260" cy="150" rx="120" ry="30" fill="#fff" opacity=".85" /><ellipse cx="330" cy="130" rx="80" ry="34" fill="#fff" opacity=".9" /><ellipse cx="200" cy="140" rx="70" ry="26" fill="#fff" opacity=".85" /></g>
        <g className="cloud c2"><ellipse cx="760" cy="90" rx="150" ry="26" fill="#fff" opacity=".7" /><ellipse cx="830" cy="74" rx="90" ry="28" fill="#fff" opacity=".8" /></g>
        <g className="cloud c3"><ellipse cx="1180" cy="330" rx="110" ry="22" fill="#fff" opacity=".55" /><ellipse cx="1240" cy="318" rx="70" ry="22" fill="#fff" opacity=".6" /></g>
      </g>

      <g className="bird b1" fill="none" stroke="#1d3b4d" strokeWidth="2.2" strokeLinecap="round"><path d="M0 0 q8 -9 16 0 q8 -9 16 0" /></g>
      <g className="bird b2" fill="none" stroke="#1d3b4d" strokeWidth="2" strokeLinecap="round"><path d="M0 0 q6 -7 12 0 q6 -7 12 0" /></g>
      <g className="bird b3" fill="none" stroke="#1d3b4d" strokeWidth="1.8" strokeLinecap="round"><path d="M0 0 q5 -6 10 0 q5 -6 10 0" /></g>

      <g className="px" style={{ ['--k' as string]: 9 }}>
        <path d="M-60 470 C 160 360 330 420 520 380 C 700 340 860 430 1040 380 C 1220 330 1340 410 1500 380 L1500 520 L-60 520 Z" fill="url(#hillFar)" />
        <path d="M-60 500 C 120 430 300 470 480 450 C 700 425 900 490 1100 450 C 1260 420 1380 470 1500 450 L1500 540 L-60 540 Z" fill="url(#hillNear)" />
      </g>

      {/* field in perspective */}
      <path d={`M-60 ${VP_Y + 20} H1500 V760 H-60 Z`} fill="#4f7f33" />
      {rows.map((i) => (
        <polygon key={i} points={`${VP_X},${VP_Y + 20} ${bottomX(i)},760 ${bottomX(i + 1)},760`} fill={i % 2 ? '#4a7a30' : '#5d8f3b'} opacity=".9" />
      ))}
      {rows.map((i) => <line key={`l${i}`} x1={VP_X} y1={VP_Y + 20} x2={bottomX(i)} y2="760" stroke="#2f4f1e" strokeWidth="1.4" opacity=".35" />)}
      <rect y={VP_Y + 8} width="1440" height="40" fill="#e8f2d2" opacity=".28" filter="url(#blur6)" />

      {/* soil strip with drip line */}
      <rect y="640" width="1440" height="120" fill="url(#soil)" />
      <rect y="640" width="1440" height="4" fill="#9b7650" opacity=".7" />
      <line x1="0" y1="626" x2="1440" y2="626" stroke="#16181a" strokeWidth="6" strokeLinecap="round" />
      <line x1="0" y1="624" x2="1440" y2="624" stroke="#6c757d" strokeWidth="1.4" opacity=".7" />

      {PLANTS.map((x, i) => {
        const s = i % 2 ? 0.72 : 0.8
        return (
          <g key={x}>
            <ellipse cx={x} cy="656" rx="74" ry="14" fill="url(#wet)" className="wetpatch" style={{ animationDelay: `${i * 0.5}s` }} />
            <g transform={`translate(${x} 640) scale(${s})`}>
              <g className="sway" style={{ animationDelay: `${i * -0.9}s`, animationDuration: `${4.6 + (i % 3) * 0.8}s` }}><use href="#plant" /></g>
            </g>
            <circle cx={x} cy="626" r="5" fill="#2b2f33" stroke="#7b8590" strokeWidth="1" />
            {[0, 1].map((d) => (
              <g key={d}>
                <path className="drop" d={`M${x} ${632} c 3 5 4.5 8 0 11 c -4.5 -3 -3 -6 0 -11 z`} fill="url(#drop)" style={{ animationDelay: `${i * 0.37 + d * 0.9}s` }} />
                <ellipse className="ripple" cx={x} cy="656" rx="4" ry="1.4" fill="none" stroke="#bfe6ff" strokeWidth="1.2" style={{ animationDelay: `${i * 0.37 + d * 0.9 + 0.55}s` }} />
              </g>
            ))}
          </g>
        )
      })}

      <rect width="1440" height="760" filter="url(#grain)" opacity=".18" style={{ mixBlendMode: 'overlay' }} />
      <rect width="1440" height="760" fill="url(#vig)" />
      <defs><radialGradient id="vig" cx=".5" cy=".45" r=".75"><stop offset=".6" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#0b1a10" stopOpacity=".45" /></radialGradient></defs>
    </svg>
  )
}
