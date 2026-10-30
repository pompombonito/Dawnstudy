type ArtworkProps = { className?: string; variant?: "study" | "botanical" };
type MarkProps = { className?: string };

const ink = "#2d493b";
const orange = "#f1a775";
const sage = "#b8cbb2";
const cream = "#ece8dc";

/** Original sunrise mark: a half sun, three rays, and an open horizon. */
export function DawnMark({ className = "" }: MarkProps) {
  return <svg className={`dawn-mark ${className}`.trim()} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <path d="M7 21a9 9 0 0 1 18 0Z" fill={orange} />
    <path d="M4 21h24M8 26h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M16 3v4M5.5 7.5l2.8 2.8m18.2-2.8-2.8 2.8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>;
}

function StudyComposition() {
  return <>
    <path d="M313 43c109-29 222 39 225 161 2 83-51 143-132 151-82 8-144-43-148-119-4-74 9-154 55-193Z" fill={cream} />
    <circle cx="414" cy="170" r="109" fill={orange} />
    <path d="M416 39v26m0 211v27M287 170h26m211 0h26M325 79l19 19m149 149 19 19M325 261l19-19M491 95l19-19" stroke={ink} strokeWidth="1.5" opacity=".4" />
    <g className="dawn-artwork-orbit" stroke={ink} fill="none">
      <ellipse cx="395" cy="184" rx="173" ry="89" transform="rotate(-32 395 184)" strokeWidth="1.3" opacity=".42" />
      <path d="M279 301c100 33 244-37 265-116" strokeWidth="1.3" strokeDasharray="3 6" opacity=".4" />
      <circle cx="535" cy="118" r="8" fill={ink} stroke="none" />
      <circle cx="276" cy="288" r="6" fill={cream} strokeWidth="1.5" />
    </g>

    <g className="dawn-artwork-landscape">
      <path d="M270 309c49-54 108-45 146-11 33-73 110-68 153 13v82H270Z" fill={sage} />
      <path d="M270 350c64-40 115-24 146 2 53-39 104-16 153 21v20H270Z" fill={ink} />
      <path d="M348 298c17 13 30 32 39 55m45-81c32 17 53 39 63 70m-182-8c31 2 62 12 84 30m111-60c19 11 36 25 50 43" stroke={cream} strokeWidth="1.2" opacity=".65" />
      <path d="M304 315h232m-250 22h266m-282 23h285" stroke={ink} strokeWidth=".8" opacity=".14" />
    </g>

    <g transform="rotate(-11 233 221)">
      <path d="M134 89h202v264H134Z" fill={ink} opacity=".13" transform="translate(9 12)" />
      <path d="M127 82h202v264H127Z" fill={sage} stroke={ink} strokeWidth="1.8" />
      <path d="M144 89h202v264H144Z" fill="#f8f3e7" stroke={ink} strokeWidth="1.8" />
      <path d="M163 89v264" stroke={ink} strokeWidth="1" opacity=".3" />
      <path d="M144 116h202m-202 24h202m-202 24h202m-202 24h202m-202 24h202m-202 24h202m-202 24h202m-202 24h202m-202 24h202m-202 24h202" stroke={sage} strokeWidth=".7" opacity=".75" />
      {[111, 151, 191, 231, 271, 311].map((y) => <g key={y}><circle cx="151" cy={y} r="3" fill={ink} /><path d={`M137 ${y - 1}c-11-12-11 14 0 13`} stroke={ink} strokeWidth="2.4" strokeLinecap="round" /></g>)}
      <path d="M182 125h98m-98 10h63" stroke={ink} strokeWidth="3" strokeLinecap="round" />
      <path d="M180 149h128v20H180Z" fill={orange} />
      <path d="M188 159h78" stroke={ink} strokeWidth="2" strokeLinecap="round" />
      <rect x="182" y="192" width="12" height="12" rx="2" stroke={ink} strokeWidth="1.5" />
      <path d="m184 197 4 4 9-12m8 9h101" stroke={ink} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="182" y="219" width="12" height="12" rx="2" stroke={ink} strokeWidth="1.5" />
      <path d="m184 224 4 4 9-12m8 9h80" stroke={ink} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="182" y="246" width="12" height="12" rx="2" stroke={ink} strokeWidth="1.5" />
      <path d="M205 252h94m-94 9h68" stroke={ink} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M183 303c7-16 21-16 28 0m-33 0h38m-32 8h26M196 280v7m-18-2 5 5m32-5-5 5" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />
      <path d="m293 293 12 24 16-38" stroke={orange} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M317 89v45l9-7 9 7V89" fill={orange} stroke={ink} strokeWidth="1.1" />
    </g>

    <g transform="rotate(14 434 314)">
      <path d="M385 286h106v57H385Z" fill={sage} stroke={ink} strokeWidth="1.5" />
      <path d="M398 303h63m-63 12h78m-78 12h44" stroke={ink} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M474 282v12" stroke={orange} strokeWidth="9" />
    </g>
    <g fill={ink}>
      <path d="m91 121 4 14 14 4-14 4-4 14-4-14-14-4 14-4Z" />
      <path d="m511 297 3 10 10 3-10 3-3 10-3-10-10-3 10-3Z" />
      <circle cx="92" cy="273" r="3" />
    </g>
    <path d="m67 338 28-12 12 28-28 12Z" fill={orange} />
    <path d="M75 343h24m-12-12v24" stroke={ink} strokeWidth="1.2" opacity=".6" />
    <path d="M64 375h48m-24-23v46" stroke={ink} strokeWidth="1" opacity=".3" />
  </>;
}

function MonsteraLeaf({ transform, fill, secondary = false }: { transform: string; fill: string; secondary?: boolean }) {
  return <g transform={transform} className="dawn-artwork-leaf">
    <path d="M126 257C81 260 39 235 18 204-3 174 2 137 24 111 11 83 22 49 48 36 78 20 106 32 120 61c8-30 32-49 61-42 35 8 55 41 52 81 24 17 28 47 16 76-18 44-68 76-123 81Z" fill={fill} />
    <path d="M126 257c-2-72 7-143-6-196" stroke={secondary ? cream : sage} strokeWidth="2" fill="none" opacity=".65" />
    <path d="M126 227c-34-16-60-36-78-61m78 35c31-16 59-36 77-64m-77 25c-23-12-45-30-59-51m59 17c22-12 40-28 53-49" stroke={secondary ? cream : sage} strokeWidth="1.2" fill="none" opacity=".45" />
    <path d="M72 75c-9-7-17-3-13 8 6 18 20 32 26 27 7-6-1-25-13-35Zm16 59c-16-10-28-4-21 10 9 18 24 32 31 26 7-6 3-22-10-36Zm72-62c12-10 21-3 16 10-6 15-16 27-22 23-6-4-4-25 6-33Zm14 58c16-10 25-3 18 12-9 18-22 29-28 22-5-6-1-26 10-34ZM49 197c-7-10-14-9-12 0 2 9 12 18 17 15 3-2 0-9-5-15Zm150-17c10-12 20-9 14 4-5 11-16 19-20 15-4-3 0-12 6-19Z" fill={cream} />
  </g>;
}

function BotanicalComposition() {
  return <>
    <rect width="600" height="760" fill={cream} />
    <circle cx="504" cy="154" r="134" fill={orange} />
    <path d="M41 732c150-129 278-353 429-545" stroke={ink} strokeWidth="10" strokeLinecap="round" fill="none" />
    <path d="M244 485c-7-91-35-163-94-208m154 106c78 10 151 6 219-20M131 639C99 542 67 495 10 454" stroke={ink} strokeWidth="6" strokeLinecap="round" fill="none" />
    <path d="M55 760c144-92 270-195 335-309" stroke={sage} strokeWidth="8" strokeLinecap="round" fill="none" />
    <MonsteraLeaf transform="translate(130 14) rotate(-21 126 130) scale(1.28)" fill={ink} />
    <MonsteraLeaf transform="translate(323 268) rotate(51 126 130) scale(1.12)" fill="#54745b" />
    <MonsteraLeaf transform="translate(-116 252) rotate(-42 126 130) scale(1.35)" fill="#66856a" secondary />
    <MonsteraLeaf transform="translate(109 471) rotate(20 126 130) scale(1.2)" fill={ink} />
    <MonsteraLeaf transform="translate(414 533) rotate(48 126 130) scale(.93)" fill={sage} secondary />
    <path d="M20 101c28 24 54 33 85 36m-43-51-7 38m37-21-14 28" stroke={sage} strokeWidth="1.6" fill="none" opacity=".8" />
    <path d="m58 183 4 13 13 4-13 4-4 13-4-13-13-4 13-4Z" fill={orange} />
    <circle cx="547" cy="433" r="5" fill={orange} />
    <circle cx="35" cy="663" r="3" fill={ink} opacity=".4" />
    <path d="M436 716h94m-47-47v94" stroke={ink} strokeWidth="1" opacity=".3" />
    <path d="M456 716a27 27 0 0 1 54 0" stroke={ink} strokeWidth="1" opacity=".4" fill="none" />
  </>;
}

/** Decorative Dawnstudy artwork; no external assets or raster dependencies. */
export function DawnArtwork({ className = "", variant = "study" }: ArtworkProps) {
  return <svg className={`dawn-artwork dawn-artwork--${variant} ${className}`.trim()} viewBox={variant === "botanical" ? "0 0 600 760" : "0 0 600 430"} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    {variant === "botanical" ? <BotanicalComposition /> : <StudyComposition />}
  </svg>;
}
