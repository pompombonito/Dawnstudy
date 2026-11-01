"use client";

export type FaceDesign = {
  eyes: "round" | "almond" | "narrow" | "half-lidded" | "angular" | "soft" | "wide" | "cat" | "sleepy" | "closed" | "dot" | "blank";
  eyeWidth: number;
  eyeHeight: number;
  eyeSpacing: number;
  irisScale: number;
  pupilScale: number;
  eyeTilt: number;
  gazeX: number;
  brow: "flat" | "angry" | "worried" | "soft" | "raised" | "arched" | "tired";
  mouth: "neutral" | "frown" | "smirk" | "grin" | "shout" | "small-smile" | "open-smile" | "pout" | "surprised" | "wavy" | "toothy" | "hidden";
  faceShape: "round" | "oval" | "pointed" | "square";
  blush: number;
  lashes: boolean;
  irisDetail: "ring" | "plain" | "slit" | "pale" | "red-ghoul";
  undereye?: boolean;
  highlights?: boolean;
  wink?: "left" | "right";
  hiddenEye?: "left" | "right";
  eyeShadow?: boolean;
  squareGrin?: boolean;
  mouthScale?: number;
  browWeight?: number;
  lipColor?: string;
  leftEyeColor?: string;
  rightEyeColor?: string;
};

const ink = "#302b37";
const defaults: FaceDesign = {
  eyes: "almond", eyeWidth: 12, eyeHeight: 10, eyeSpacing: 24,
  irisScale: .66, pupilScale: .46, eyeTilt: 0, gazeX: 0,
  brow: "flat", mouth: "neutral", faceShape: "oval", blush: 0,
  lashes: false, irisDetail: "plain",
};

export function faceDesign(value?: unknown): FaceDesign {
  return { ...defaults, ...(value && typeof value === "object" ? value : {}) };
}

export function faceOutline(design: FaceDesign): string {
  // Broad cheeks and a compact chin follow the user's chibi expression sheets.
  switch (design.faceShape) {
    case "round": return "M17 40q0-23 33-23t33 23v13q0 23-33 24-33-1-33-24Z";
    case "pointed": return "M18 40q0-23 32-23t32 23v12q-1 14-19 21L50 77 37 73Q19 66 18 52Z";
    case "square": return "M17 40q0-23 33-23t33 23v14q0 15-16 21l-17 2-17-2q-16-6-16-21Z";
    default: return "M18 40q0-23 32-23t32 23v13q-1 21-32 24-31-3-32-24Z";
  }
}

function eyeContours(shape: FaceDesign["eyes"], rx: number, ry: number) {
  switch (shape) {
    case "angular": return {
      outline: `M${-rx} ${-ry*.48}L${rx} ${-ry*.1} ${rx*.78} ${ry*.64}Q0 ${ry*1.05} ${-rx*.72} ${ry*.55}Z`,
      upper: `M${-rx-.4} ${-ry*.48}L${rx+.3} ${-ry*.1}`,
      lower: `M${-rx*.72} ${ry*.55}Q0 ${ry*1.05} ${rx*.78} ${ry*.64}`,
    };
    case "narrow": return {
      outline: `M${-rx} ${-ry*.08}Q0 ${-ry*.65} ${rx} ${-ry*.18}L${rx*.8} ${ry*.47}Q0 ${ry*.8} ${-rx*.8} ${ry*.35}Z`,
      upper: `M${-rx-.3} ${-ry*.08}Q0 ${-ry*.65} ${rx+.5} ${-ry*.18}`,
      lower: `M${-rx*.8} ${ry*.35}Q0 ${ry*.8} ${rx*.8} ${ry*.47}`,
    };
    case "half-lidded": return {
      outline: `M${-rx} ${-ry*.3}L${rx} ${-ry*.3}Q${rx} ${ry*1.16} 0 ${ry*1.2}T${-rx} ${-ry*.3}Z`,
      upper: `M${-rx-.4} ${-ry*.3}H${rx+.4}`,
      lower: `M${-rx*.78} ${ry*.86}Q0 ${ry*1.4} ${rx*.78} ${ry*.86}`,
    };
    case "sleepy": return {
      outline: `M${-rx} 0Q0 ${ry*.34} ${rx} 0L${rx*.73} ${ry*.55}Q0 ${ry*.9} ${-rx*.73} ${ry*.55}Z`,
      upper: `M${-rx-.5} 0Q0 ${ry*.34} ${rx+.5} 0`,
      lower: `M${-rx*.76} ${ry*.56}Q0 ${ry*.9} ${rx*.76} ${ry*.56}`,
    };
    case "cat": return {
      outline: `M${-rx} ${-ry*.5}Q${rx*.65} ${-ry*.9} ${rx} ${ry*.04}Q${rx*.7} ${ry} 0 ${ry*.9}T${-rx} ${-ry*.5}Z`,
      upper: `M${-rx-.6} ${-ry*.5}Q${rx*.65} ${-ry*.9} ${rx+.4} ${ry*.04}`,
      lower: `M${-rx*.7} ${ry*.52}Q0 ${ry*1.06} ${rx*.72} ${ry*.35}`,
    };
    case "almond": return {
      outline: `M${-rx} 0Q${-rx*.3} ${-ry*1.15} ${rx} ${-ry*.15}Q${rx*.5} ${ry*.9} 0 ${ry*.85}T${-rx} 0Z`,
      upper: `M${-rx-.3} 0Q${-rx*.3} ${-ry*1.15} ${rx+.3} ${-ry*.15}`,
      lower: `M${-rx*.75} ${ry*.36}Q0 ${ry*1.05} ${rx*.74} ${ry*.38}`,
    };
    case "soft": return {
      outline: `M${-rx} ${-ry*.1}C${-rx} ${-ry*.95} ${rx*.4} ${-ry*1.18} ${rx} ${-ry*.1}C${rx*.95} ${ry*.6} ${rx*.45} ${ry} 0 ${ry}S${-rx} ${ry*.5} ${-rx} ${-ry*.1}Z`,
      upper: `M${-rx-.25} ${-ry*.1}C${-rx} ${-ry*.95} ${rx*.4} ${-ry*1.18} ${rx+.25} ${-ry*.1}`,
      lower: `M${-rx*.76} ${ry*.61}Q0 ${ry*1.18} ${rx*.75} ${ry*.57}`,
    };
    case "wide": return {
      outline: `M${-rx} 0C${-rx} ${-ry*1.35} ${rx} ${-ry*1.35} ${rx} 0C${rx} ${ry*1.2} ${-rx} ${ry*1.2} ${-rx} 0Z`,
      upper: `M${-rx} 0C${-rx} ${-ry*1.35} ${rx} ${-ry*1.35} ${rx} 0`,
      lower: `M${-rx*.77} ${ry*.69}Q0 ${ry*1.12} ${rx*.77} ${ry*.69}`,
    };
    default: return {
      outline: `M${-rx} 0C${-rx} ${-ry*1.25} ${rx} ${-ry*1.25} ${rx} 0C${rx} ${ry*1.25} ${-rx} ${ry*1.25} ${-rx} 0Z`,
      upper: `M${-rx} 0C${-rx} ${-ry*1.25} ${rx} ${-ry*1.25} ${rx} 0`,
      lower: `M${-rx*.75} ${ry*.66}Q0 ${ry*1.16} ${rx*.75} ${ry*.66}`,
    };
  }
}

function Eyebrow({ face, side, color }: { face: FaceDesign; side: number; color: string }) {
  const r = face.eyeWidth*.47, y = -face.eyeHeight*.5-4;
  // Draw from the temple towards the nose so both eyebrows keep the same intent.
  const outer = side*r, inner = -side*r;
  let d: string;
  switch (face.brow) {
    case "angry": d=`M${outer} ${y-2}L${inner} ${y+1.5}`; break;
    case "worried": d=`M${outer} ${y+2}Q0 ${y-1} ${inner} ${y-3}`; break;
    case "raised": d=`M${outer} ${y-3}Q0 ${y-6} ${inner} ${y-3}`; break;
    case "arched": d=`M${outer} ${y+1}Q${outer*.1} ${y-7} ${inner} ${y}`; break;
    case "soft": d=`M${outer} ${y}Q0 ${y-2} ${inner} ${y-.5}`; break;
    case "tired": d=`M${outer} ${y+2}L${inner} ${y+2.8}`; break;
    default: d=`M${outer} ${y}L${inner} ${y}`;
  }
  return <path d={d} fill="none" stroke={color} strokeWidth={face.browWeight ?? (face.brow === "angry" ? 2.1 : 1.55)} strokeLinecap="round"/>;
}

export function AnimeMouth({ design, y = 64 }: { design: FaceDesign; y?: number }) {
  const color=design.lipColor || ink;
  const common={ stroke: color, strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return <g transform={`translate(50 ${y}) scale(${design.mouthScale ?? 1})`} data-mouth={design.mouth}>
    <g className={design.mouth === "hidden" ? undefined : "anime-mouth-motion"}>
    {design.mouth === "neutral" && <path d="M-4 0h8" fill="none" {...common}/>}
    {design.mouth === "frown" && <path d="M-4.5 1Q0-3 4.5 1" fill="none" {...common}/>}
    {design.mouth === "smirk" && <><path d="M-5 1q5 1 11-3" fill="none" {...common}/><path d="m6-3 1 2" fill="none" stroke={color} strokeWidth=".8"/></>}
    {design.mouth === "small-smile" && <path d="M-3.5-.5q3.5 3 7 0" fill="none" {...common}/>}
    {design.mouth === "pout" && <path d="m-3-1 3 1-3 1m3-1 3-1m-3 1 3 1" fill="none" {...common}/>}
    {design.mouth === "wavy" && <path d="M-5 0q2.5-3 5 0t5 0" fill="none" {...common}/>}
    {design.mouth === "surprised" && <ellipse cy=".5" rx="2.6" ry="3.9" fill="#8a4c56" stroke={color} strokeWidth=".8"/>}
    {design.mouth === "open-smile" && <><path d="M-5.5-2q5.5 2 11 0Q5 6 0 6t-5.5-8" fill="#87444e" {...common}/><path d="M-3 4q3-3 6 0Q0 7-3 4" fill="#d98188"/></>}
    {design.mouth === "grin" && !design.squareGrin && <><path d="M-10-2q10 4 20 0Q9 8 0 8T-10-2" fill="#fffdf1" {...common}/><path d="M-8 1q8 3 16 0M0 0v7" fill="none" stroke="#ddc9ba" strokeWidth=".75"/></>}
    {design.mouth === "grin" && design.squareGrin && <><path d="M-10-2q10 1 20 0l-1 9H-9Z" fill="#fffdf1" {...common}/><path d="M-9 2H9m-5-3v7m-4-7v7m-4-7v7" stroke="#d2bcaa" strokeWidth=".7"/></>}
    {design.mouth === "toothy" && <><path d="M-8-1q8 1 16-2L6 6Q0 9-7 4Z" fill="#fffdf1" {...common}/><path d="M-6 1q6 2 12-1m-8 0v5m4-6v6" fill="none" stroke="#d7b9ad" strokeWidth=".75"/></>}
    {design.mouth === "shout" && <><path d="M-6-3Q0-6 6-3L8 5Q0 11-8 5Z" fill="#723e48" {...common}/><path d="M-5-3H5l1 3H-6Z" fill="#fff9e9"/><path d="M-5 5Q0 1 5 5Q0 9-5 5" fill="#d98790"/></>}
    </g>
  </g>;
}

export default function AnimeFace({ design, eyeColor, browColor, uid, characterId }: {
  design: FaceDesign; eyeColor: string; browColor: string; uid: string; characterId?: string;
}) {
  const f = design, rx=f.eyeWidth/2, ry=f.eyeHeight/2;
  const contours=eyeContours(f.eyes,rx,ry);
  const quietEyes=["half-lidded","narrow","sleepy"].includes(f.eyes);
  return <g data-face={f.faceShape} data-eyes={f.eyes}>
    {f.blush > 0 && <g fill="#de8e98" opacity={f.blush}><ellipse cx="30" cy="58" rx="4.6" ry="2.2"/><ellipse cx="70" cy="58" rx="4.6" ry="2.2"/></g>}
    {[-1,1].map(side => {
      const cx=50+side*f.eyeSpacing/2, cy=49;
      const id=`face-eye-${uid}-${side === -1 ? "l" : "r"}`;
      const color=(side === -1 ? f.leftEyeColor : f.rightEyeColor) || eyeColor;
      const mirror=side === 1 ? -1 : 1, gaze=f.gazeX*mirror;
      const irisRx=rx*f.irisScale, irisRy=irisRx*1.22;
      const redGhoul=f.irisDetail === "red-ghoul" && side === 1;
      const pale=f.irisDetail === "pale";
      const hidden=f.hiddenEye === (side === -1 ? "left" : "right");
      const wink=f.wink === (side === -1 ? "left" : "right");
      const closedSmile=["grin","small-smile","open-smile"].includes(f.mouth);
      if (hidden) return null;
      return <g key={side} transform={`translate(${cx} ${cy})`}>
        {f.eyes !== "blank" && <Eyebrow face={f} side={side} color={browColor}/>}
        <g transform={`rotate(${-side*f.eyeTilt}) scale(${mirror} 1)`}>
          {f.eyeShadow && !wink && f.eyes !== "closed" && f.eyes !== "blank" && <path d={contours.outline} transform="scale(1.5 1.9)" fill="#3a3848"/>}
          <g className={f.eyes === "blank" ? undefined : f.eyes === "closed" || wink ? "anime-eye-rest" : "anime-eye-blink"}>
          {f.eyes === "closed" || wink ? <path d={closedSmile ? `M${-rx} 1Q0 ${-ry} ${rx} 1` : `M${-rx} 0q${rx} 1 ${rx*2} 0`} fill="none" stroke={ink} strokeWidth="1.8" strokeLinecap="round"/>
            : f.eyes === "dot" ? <><ellipse rx={rx*.38} ry={ry*.8} fill={ink}/><circle cx="1" cy={-ry*.36} r=".8" fill="white"/></>
              : f.eyes !== "blank" && <>
                <defs><clipPath id={id}><path d={contours.outline}/></clipPath></defs>
                <path d={contours.outline} fill={redGhoul ? "#302331" : "#fffdf4"} stroke="#a18d89" strokeWidth=".55"/>
                <g clipPath={`url(#${id})`}>
                  <g className="anime-eye-gaze" data-mirrored={mirror === -1 || undefined}>
                  <ellipse cx={gaze} cy=".5" rx={irisRx} ry={irisRy} fill={redGhoul ? "#c93f55" : color} stroke={pale ? "#b3a9c9" : ink} strokeWidth={f.irisDetail === "ring" ? 1.1 : .65}/>
                  {!pale && <ellipse cx={gaze} cy={-irisRy*.35} rx={irisRx} ry={irisRy*.63} fill={ink} opacity={quietEyes ? .3 : .18}/>}
                  {f.irisDetail === "ring" && <ellipse cx={gaze} cy=".5" rx={irisRx*.72} ry={irisRy*.72} fill="none" stroke={ink} strokeWidth=".6" opacity=".65"/>}
                  {f.irisDetail === "slit" ? <path d={`M${gaze} ${-irisRy*.65}l${irisRx*.2} ${irisRy*.9}-${irisRx*.2} ${irisRy*.8}-${irisRx*.2}-${irisRy*.8}Z`} fill={ink}/>
                    : <ellipse cx={gaze} cy=".6" rx={pale ? .8 : irisRx*f.pupilScale} ry={pale ? 1.2 : irisRy*f.pupilScale} fill={pale ? "#aaa2bc" : ink}/>}
                  {f.highlights !== false && f.irisDetail !== "red-ghoul" && !quietEyes && <circle cx={gaze+irisRx*.38*mirror} cy={-irisRy*.34} r={Math.min(1.6,irisRx*.33)} fill="white"/>}
                  {f.highlights !== false && !quietEyes && f.eyes !== "angular" && !pale && <circle cx={gaze-irisRx*.35*mirror} cy={irisRy*.45} r=".65" fill="#fff4da" opacity=".85"/>}
                  </g>
                </g>
                <path d={contours.upper} fill="none" stroke={ink} strokeWidth={f.lashes ? 2 : f.eyes === "angular" ? 1.9 : 1.45} strokeLinecap={f.eyes === "angular" ? "square" : "round"}/>
                <path d={contours.lower} fill="none" stroke={quietEyes ? "#7d6c70" : "#aa8c89"} strokeWidth={quietEyes ? .9 : .65} strokeLinecap="round"/>
                {f.lashes && <path d={`m${-rx} ${-ry*.12} -2.4 -2.5m${-rx+.9} ${-ry*.46} -1.4 -2.5`} fill="none" stroke={ink} strokeWidth="1.2" strokeLinecap="round"/>}
              </>}
          </g>
        </g>
        {f.undereye && <path d={`M${-rx*.7} ${ry+2.3}q${rx*.7} 1.2 ${rx*1.4} -.1`} fill="none" stroke="#a28b8c" strokeWidth=".85" strokeLinecap="round"/>}
      </g>;
    })}
    <AnimeMouth design={f} y={characterId === "anime-all-might" ? 63 : 64}/>
  </g>;
}
