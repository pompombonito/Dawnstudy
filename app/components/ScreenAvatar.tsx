"use client";

import { useId } from "react";
import { animeCompanionBubble, type AnimeCharacter } from "../community/anime-companions";
import { characterMotionStyle } from "./character-motion";

type Portrait = {
  hairStyle?: string; fringe?: string; part?: string; outfitStyle?: string;
  feature?: string; gender?: string;
};
type Face = {
  eyes?: string; mouth?: string; eyeTilt?: number; faceShape?: string;
  eyeWidth?: number; eyeHeight?: number; eyeSpacing?: number; lashes?: boolean;
  irisScale?: number; pupilScale?: number; brow?: string; blush?: number;
};
type ScreenCharacter = AnimeCharacter & { portrait?: Portrait; skin?: string; face?: Face };
const ink = "#40333f";
const cream = "#fff5de";

function tint(color: string, amount: number) {
  const values = color.replace("#", "").match(/.{2}/g) || ["77", "66", "66"];
  return "#" + values.map(value => {
    const channel = parseInt(value, 16);
    return Math.round(channel + (amount > 0 ? 255 - channel : channel) * amount).toString(16).padStart(2, "0");
  }).join("");
}

function has(c: ScreenCharacter, term: string) {
  return `${c.accessory || ""} ${c.portrait?.feature || ""}`.toLowerCase().includes(term);
}

function HairBack({ c }: { c: ScreenCharacter }) {
  const style = c.portrait?.hairStyle || c.style;
  const longCurls = c.portrait?.gender === "feminine" || c.id.includes("patrick-verona") || c.id.includes("hagrid");
  const long = ["long", "braids", "ponytail"].includes(style) || (["wavy", "curly"].includes(style) && longCurls);
  return <g className="anime-hair-back" fill={c.hair} stroke={ink} strokeWidth="1.15" strokeLinejoin="round">
    {style === "updo" && <><ellipse cx="50" cy="17" rx="16" ry="10"/><path d="M39 15q10-8 21 1m-19 3q10-5 19 1" fill="none" stroke={tint(c.hair, .18)} strokeWidth=".7"/></>}
    {style === "ponytail" && <path d="M70 28q14 3 9 21-4 13 4 30-11-1-15-13-3-13 0-25Z"/>}
    <path d={long
      ? style === "curly" ? "M25 22q-10 7-6 19-6 7-1 14-5 8 1 15-4 9 4 17l10-5 4-26h26l5 27 10 3q8-8 3-16 6-9 1-15 5-9-1-16 4-13-7-19Z"
        : style === "wavy" ? "M26 22Q17 29 20 42q-6 11-1 19-4 11 3 23l12-4 4-24h25l4 24 12 4q7-11 2-22 5-10-1-20 3-18-10-22Z"
          : style === "braids" ? "M26 25Q18 35 23 51l-1 28 6 5 5-7 1-27h32l1 27 5 7 6-6-1-29q5-16-5-24Z"
            : "M25 22Q17 33 22 51l-1 32 12-3 4-27h26l4 27 12 3-1-32q5-18-4-29Z"
      : style === "bob" ? "M25 23Q15 33 20 52l4 17 12-3h28l12 3 5-17q3-20-8-29Z"
        : "M25 23q-8 9-4 27l8 9h42l8-9q3-18-5-27Z"}/>
    {style === "braids" && <path d="m24 53 5 3-5 4 5 3-5 4 5 3-5 4m47-21 5 3-5 4 5 3-5 4 5 3-5 4" fill="none" stroke={tint(c.hair, .24)} strokeWidth=".8"/>}
    {style === "curly" && <path d="M24 48q-5 7 0 10t0 11-1 10m52-31q5 7 0 10t0 11 1 10" fill="none" stroke={tint(c.hair, .2)} strokeWidth=".8"/>}
  </g>;
}

function HairFront({ c }: { c: ScreenCharacter }) {
  const p: Portrait = c.portrait || {};
  const style = p.hairStyle || c.style;
  const full = p.fringe === "full" || c.id === "screen-summer-finn" || c.id === "screen-lilly-moscovitz";
  const center = p.part === "center" || p.fringe === "curtain" || style === "curtain";
  let path = full
    ? "M21 39Q16 11 49 10q33-1 31 29l-5 13-4-24q-3 2-7 0-3 2-7 0-4 2-8 0-4 2-8 0-4 2-8 0l-6 25-5-6Z"
    : center
      ? "M21 39Q15 13 40 10q7-2 10 3 5-5 14-2 21 4 16 29l-5 12-4-22q-3-11-16-12l-5 5-5-5Q29 20 28 36l-2 16Z"
      : "M21 40Q15 15 37 11q15-7 29 1 18 5 14 27l-5 14-5-21q-1-10-15-14-8 9-24 13l-5 20Z";
  if (style === "short" || style === "pixie") path = "M21 41Q16 20 31 15q6-7 16-4 9-5 15 0 18 1 18 19l-5 20-5-19q-12 3-23-7-5 7-17 10l-5 18Z";
  if (style === "slicked-back") path = "M21 40Q17 13 40 11q24-5 36 9 7 9 3 23l-5 8-4-18q-3-12-20-14-17 0-22 15l-3 19Z";
  if (style === "curly" && !full) path = "M21 43q-8-8-3-16-3-8 5-11 2-8 11-6 7-8 16-3 9-5 15 2 10-1 13 8 9 5 5 13 4 10-6 20l-6-17q-3-6-7-7-7 4-14-1-8 9-20 8l-4 19Z";
  return <g className="anime-hair-front" fill={c.hair} stroke={ink} strokeWidth="1.15" strokeLinejoin="round">
    <path d={path}/>
    <g fill="none" stroke={tint(c.hair, .25)} strokeWidth=".75" opacity=".75">
      {style === "curly" ? <path d="M24 29q-3-7 5-8m5-7q7-5 12 0m7-1q9-3 12 4m6 2q7 3 5 10"/>
        : full ? <path d="M28 29q-2-13 17-15m28 14Q69 15 54 14m-20 4-1 11m8-13v13m8-13v13m8-12v12m8-10 1 10"/>
          : center ? <path d="M25 33q-1-15 17-18m-10 8q8-10 15-7m7 0q18 1 21 19"/>
            : <path d="M25 32q-1-15 19-18m-12 11q14-10 22-10m8 1q11 5 13 17"/>}
    </g>
    {(has(c, "bow") || c.id === "screen-lara-jean-covey" || c.id === "screen-summer-finn") && <g className="anime-headwear" fill={c.id === "screen-lara-jean-covey" ? "#dbafc7" : cream} stroke="#b797a2" strokeWidth=".7"><path d="m71 24-7-4v9l7-3 7 4v-10Z"/><ellipse cx="71" cy="25" rx="2" ry="2.2"/></g>}
    {has(c, "headband") && <path d="M24 31Q25 12 50 13q24 0 27 18" fill="none" stroke={c.id === "screen-allie-hamilton" ? "#a84143" : c.outfit} strokeWidth="2.6"/>}
  </g>;
}

function Outfit({ c, skin }: { c: ScreenCharacter; skin: string }) {
  const p: Portrait = c.portrait || {};
  const feminine = p.gender === "feminine", kind = p.outfitStyle || "casual";
  const hogwarts = kind === "hogwarts" || c.series === "Harry Potter";
  const regency = kind === "regency";
  const dress = feminine && ["dress", "regency"].includes(kind);
  const robe = hogwarts && !c.id.includes("hagrid");
  const skirt = feminine && ["cardigan", "plaid"].includes(kind) && !dress && !robe;
  const luke = c.id === "screen-luke-danes", tom = c.id === "screen-tom-hansen";
  const house = c.id.includes("draco") ? ["#46735a", "#cad0c2"] : c.id.includes("luna") ? ["#5a789d", "#c9b085"] : ["#9a4353", "#e1bd61"];
  return <g stroke={ink} strokeWidth="1" strokeLinejoin="round">
    <path d="M41 87v14q-2 4 2 5h5V87m4 0v19h5q4-1 2-5V87" fill={dress || skirt ? skin : c.id === "screen-jess-mariano" ? "#374959" : "#40424d"}/>
    <path d="M40 102q-5 1-5 5h14v-5m3 0v5h14q0-5-8-5" fill={c.id === "screen-summer-finn" ? "#69504a" : "#39343d"}/>
    <path d="M39 69q-7 0-9 15l5 3 8-14m18-4q7 0 9 15l-5 3-8-14" fill={c.outfit}/>
    <ellipse cx="32.3" cy="85" rx="3.2" ry="3.8" fill={skin}/><ellipse cx="67.7" cy="85" rx="3.2" ry="3.8" fill={skin}/>
    <path d={dress ? "M41 66h18l3 15 7 17H31l7-17Z" : robe ? "M40 66h20l6 31-16 4-16-4Z" : "M40 66h20l4 23H36Z"} fill={robe ? "#34323d" : c.outfit}/>
    <path d="M44 63v7q6 5 12 0v-7" fill={skin} stroke={tint(skin, -.28)}/>
    {robe ? <>
      <path d="m40 67 10 9 10-9-3 17H43Z" fill="#e3dfd4"/>
      <path d="m40 67 5 6-7 5 8 20m14-31-5 6 7 5-8 20" fill="none" stroke="#56545f" strokeWidth="1.4"/>
      {!c.id.includes("snape") && <><path d="m40 68 10 5 10-5v6l-10 5-10-5Z" fill={house[0]}/><path d="M52 77h6v16h-6Z" fill={house[0]}/><path d="m42 71 4 2m5 2 4-2m0 7h3m-3 5h3m-3 5h3" fill="none" stroke={house[1]} strokeWidth="1.9"/></>}
    </> : regency ? feminine ? <>
      <path d="M40 68q10 9 20 0l2 7H38Z" fill={tint(c.outfit, .2)}/><path d="M38 76h24" fill="none" stroke={tint(c.outfit, -.2)} strokeWidth="1.3"/>
      <path d="m42 80-4 16m10-16-1 16m9-16 6 16" fill="none" stroke={tint(c.outfit, -.15)} strokeWidth=".7"/>
      <path d="m44 68 6 4 6-4" fill="none" stroke={cream} strokeWidth="1.2" strokeDasharray="1.5 1"/>
    </> : <>
      <path d="m41 66 9 9 9-9-3 22H44Z" fill="#ddd5c5"/><path d="m44 66 6 6 6-6-3 12h-6Z" fill={cream}/>
      <path d="m39 66-3 11 7-2-4 8 5 15m17-32 3 11-7-2 4 8-5 15" fill="none" stroke={tint(c.outfit, .3)}/>
    </> : kind === "suit" || tom ? <>
      <path d="m42 67 8 7 8-7-2 22H44Z" fill={tom ? "#c1af92" : "#faf0e2"}/>
      <path d="m46 70 4 3 4-3-3 8h-2Z" fill={tom ? "#526476" : "#724756"}/><path d="m49 77-1 10 2 2 2-2-1-10Z" fill={tom ? "#526476" : "#724756"}/>
      {!tom && <path d="m40 67 5 11-5 2 6 9m14-22-5 11 5 2-6 9" fill="none" stroke={tint(c.outfit, .25)}/>}
    </> : kind === "cardigan" ? <>
      <path d="m43 68 7 6 7-6-1 21H44Z" fill={cream}/><path d="m40 68 7 10-3 11m16-21-7 10 3 11" fill="none" stroke={tint(c.outfit, -.25)}/><path d="M50 78v11" stroke={tint(c.outfit, -.35)}/>
      {[79, 83, 87].map(y => <circle key={y} cx="50" cy={y} r=".65" fill={cream} stroke="none"/>)}
    </> : <path d="m43 68 7 5 7-5" fill="none" stroke={tint(c.outfit, -.25)}/>}
    {skirt && <path d="M37 86h26l4 10H33Z" fill={c.id === "screen-cher-horowitz" ? c.outfit : tint(c.outfit, -.25)}/>}
    {(kind === "plaid" || luke) && <g fill="none" stroke={tint(c.outfit, .5)} strokeWidth=".65" opacity=".8"><path d="M39 74h22m-24 5h26m-26 5h26m-24 6h22M42 70v25m7-22v22m7-25v25m6-18v15"/></g>}
    {(c.id === "screen-summer-finn" || c.id === "screen-bianca-stratford") && <path d="m42 67 8 6-5 3-5-7m18-2-8 6 5 3 5-7" fill={cream} stroke="#bfaeb2" strokeWidth=".65"/>}
    {(c.id.includes("clarisse") || c.id === "screen-regina-george") && <path d="m43 70 7 5 7-5" fill="none" stroke={cream} strokeWidth="1.8" strokeDasharray="1.6 1.3"/>}
    {luke && <g fill="#f5e8d6" stroke="#7b6659" strokeWidth=".65"><path d="M28 81h8v9h-8Z"/><path d="M36 83q5-1 4 3t-4 2" fill="none"/></g>}
    {hogwarts && !c.id.includes("hagrid") && <path d="m68 85 12-17" fill="none" stroke="#74503d" strokeWidth="1.6" strokeLinecap="round"/>}
  </g>;
}

function FaceDetails({ c, uid, skin }: { c: ScreenCharacter; uid: string; skin: string }) {
  const face = c.face || {}, feminine = c.portrait?.gender === "feminine";
  const spacing = Math.max(25, Math.min(30, face.eyeSpacing || 28));
  const eyeType = face.eyes || "round";
  const sleepy = /narrow|sleep|half|tired/.test(eyeType);
  const almond = /almond|sharp|piercing|cat/.test(eyeType);
  const eyePath = sleepy ? "M-6.7-1Q0-2.7 6.7-1L5.5 3.2Q0 5-5.5 3.2Z"
    : almond ? "M-6.8 .1Q-1-7 6.8-1Q6 6.5 0 6T-6.8 .1Z"
      : "M-6.6 .3C-6.5-7.5 5.8-8 6.7-.5Q6.8 7.2 0 7T-6.6 .3Z";
  const mouth = face.mouth || (c.id.includes("snape") || c.id.includes("draco") ? "neutral" : "smile");
  const beard = has(c, "beard") || c.id.includes("hagrid") || c.id.includes("noah") || c.id.includes("simon");
  const width = Math.max(.85, Math.min(1.15, (face.eyeWidth || 13) / 13));
  const height = Math.max(.8, Math.min(1.18, (face.eyeHeight || 11) / (sleepy ? 9 : 11)));
  const iris = (sleepy ? 3.4 : 4.2) * (face.irisScale || .62) / .62;
  const brow = face.brow === "flat" ? "M-5.8-9h11.6" : face.brow === "arched" ? "M-5.8-8q5.8-4.3 11.6-1"
    : /angry|sharp/.test(face.brow || "") ? "M-6.1-10 5.8-7.5" : face.brow === "tired" ? "M-6-7.5q5.5-2.3 11.8.1"
      : sleepy ? "M-6.2-7q6-1.5 12.4-.5" : "M-5.8-9q5.8-1.8 11.6 .1";
  return <>
    <ellipse cx="29" cy="53" rx="5.5" ry="2.6" fill="#df8b94" opacity=".17"/><ellipse cx="71" cy="53" rx="5.5" ry="2.6" fill="#df8b94" opacity=".17"/>
    {[-1, 1].map(side => {
      const clip = `screen-eye-${uid}-${side}`;
      return <g key={side} transform={`translate(${50 + side * spacing / 2} 42)`}>
        <g transform={`scale(${-side * width} ${height}) rotate(${(face.eyeTilt || 0) * .6})`}>
          <path d={brow} fill="none" stroke={tint(c.hair, .15)} strokeWidth={feminine ? 1 : 1.5} strokeLinecap="round"/>
          <g className="anime-eye-blink">
            <defs><clipPath id={clip}><path d={eyePath}/></clipPath></defs>
            <path d={eyePath} fill="#fff9f0" stroke="#9f7c76" strokeWidth=".45"/>
            <g clipPath={`url(#${clip})`}><g className="anime-eye-gaze" data-mirrored={side === 1 || undefined}>
              <ellipse cy="1" rx={iris} ry={sleepy ? 4 : 6.2} fill={c.eyes}/>
              <ellipse cy=".6" rx={iris * (face.pupilScale || .48)} ry={sleepy ? 3 : 4.8} fill={tint(c.eyes, -.65)}/>
              <path d="M-3.1 4.7q3 1.7 6.2 0" fill="none" stroke={tint(c.eyes, .4)} strokeWidth=".8"/>
              <ellipse cx="1.6" cy="-1.3" rx="1.35" ry="1.65" fill="#fffdf8"/><circle cx="-1.7" cy="3.1" r=".7" fill="#fffdf8"/>
            </g></g>
            <path d={sleepy ? "M-6.8-1Q0-2.7 6.8-1" : almond ? "M-7 .1Q-1-7 7-1" : "M-6.8 .3C-6.7-7.7 6-8.2 6.9-.5"} fill="none" stroke={ink} strokeWidth={feminine ? 1.2 : 1} strokeLinecap="round"/>
            {(feminine || face.lashes) && <path d="m-6.5-1-1.5-1.6m3.2-1.9-.8-1.6" fill="none" stroke={ink} strokeWidth=".9" strokeLinecap="round"/>}
          </g>
        </g>
      </g>;
    })}
    <path d="M49.3 51.9q.7.7 1.4 0" fill="none" stroke={tint(skin, -.3)} strokeWidth=".65" strokeLinecap="round"/>
    {beard && (c.id.includes("hagrid") ? <path d="M27 49q2 12 10 8l5-4 8 3 8-3 5 4q8 4 10-8l2 19-8 14-9-2-8 9-8-9-9 2-8-14Z" fill={c.hair} stroke={ink} strokeWidth="1"/>
      : <path d="M29 50q3 15 21 16 18-1 21-16l-4 11q-17 13-34 0Z" fill={c.hair} opacity=".45"/>)}
    <g transform="translate(50 57)"><g className="anime-mouth-motion">
      {/open|grin|toothy|happy/.test(mouth) ? <><path d="M-4.3-1q4.3 1.2 8.6 0Q3.7 4.8 0 4.6T-4.3-1Z" fill="#9b5363" stroke="#7b4a56" strokeWidth=".6"/><path d="M-3.4-.2q3.4.7 6.8 0L2.8 1.3h-5.6Z" fill={cream}/></>
        : /smirk/.test(mouth) ? <path d="M-3 .8q3.8 1.1 6.2-1.6" fill="none" stroke="#995d6c" strokeWidth="1" strokeLinecap="round"/>
          : /neutral|flat|serious|calm/.test(mouth) ? <path d="M-2.5 .5h5" fill="none" stroke="#986575" strokeWidth=".9" strokeLinecap="round"/>
            : <path d="M-3.1-.1Q0 3 3.1-.1" fill="none" stroke="#a56376" strokeWidth="1" strokeLinecap="round"/>}
    </g></g>
    {(has(c, "freckles") || c.id.includes("ron-weasley")) && <g fill="#b18469" opacity=".7">{[[-1,0],[1,0]].flatMap(([side]) => [0,1,2].map(i => <circle key={`${side}-${i}`} cx={50+side*(20+i*1.8)} cy={52+(i%2)*1.5} r=".55"/>))}</g>}
    {(has(c, "scar") || c.id === "screen-harry-potter") && <path d="m58 24-3 4 3 1-3 5" fill="none" stroke="#bd766f" strokeWidth="1.1" strokeLinejoin="round"/>}
    {(has(c, "glasses") || c.id === "screen-harry-potter" || c.id === "screen-kitty-covey") && <g fill="none" stroke={c.id.includes("luna") ? "#ba6b9b" : "#554754"} strokeWidth="1.2"><circle cx={50-spacing/2} cy="43" r="9.2"/><circle cx={50+spacing/2} cy="43" r="9.2"/><path d="M45.5 42q4.5-2.3 9 0m-29-1-3-1m52.5 1 3-1"/></g>}
  </>;
}

function Headwear({ c }: { c: ScreenCharacter }) {
  const crown = has(c, "crown") || c.id.includes("clarisse") || c.id.includes("mia-thermopolis");
  const cap = c.id.includes("luke-danes") || c.id.includes("noah-calhoun") || has(c, "cap");
  return <g className="anime-headwear" stroke={ink} strokeWidth=".9" strokeLinejoin="round">
    {crown && <><path d="m35 18-2-9 9 5 8-8 8 8 9-5-2 9Z" fill="#d5bc75"/><path d="M37 18q13-3 26 0" fill="none" stroke="#eee4bf"/><circle cx="50" cy="12" r="1.3" fill="#9f8cac"/></>}
    {cap && <><path d="M21 27Q22 10 49 10q27 0 30 18Z" fill={c.id.includes("luke") ? "#6b8194" : "#776552"}/><path d="M20 27q21-5 57 0l6 5q-15-4-25-1H21Z" fill={c.id.includes("luke") ? "#536a80" : "#665440"}/><path d="M48 12v13" fill="none" stroke="#b0a49a" strokeWidth=".5"/></>}
    {c.id === "screen-dionne-davenport" && <><path d="M27 20 30 7h40l3 13Z" fill="#35313d"/><path d="M24 20q26-5 52 0l5 6H19Z" fill="#f8eee0"/><path d="M30 15h40" stroke="#f8eee0" strokeWidth="3"/></>}
    {c.id === "screen-luna-lovegood" && <g fill="#bd8a72" stroke="#7d935a" strokeWidth=".6"><path d="M22 52v7m56-7v7"/><ellipse cx="22" cy="61" rx="1.5" ry="2.3"/><ellipse cx="78" cy="61" rx="1.5" ry="2.3"/></g>}
  </g>;
}

/** Full-body, transparent movie/TV chibis use individual costume and portrait metadata. */
export default function ScreenAvatar({ character, className = "", label, hoverLine = true }: {
  character: AnimeCharacter; className?: string; label?: string; hoverLine?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const c = character as ScreenCharacter;
  const skin = c.skin || "#f1d1b8";
  const angular = /angular|slim|oval|pointed/.test(c.face?.faceShape || "");
  const head = angular ? "M22 35Q21 12 50 12t28 23v12q-1 13-19 19l-9 2-9-2Q23 60 22 47Z"
    : "M21 35Q20 12 50 12t29 23v12q-1 16-20 19l-9 1-9-1Q22 63 21 47Z";
  return <svg className={`ds-avatar anime-avatar motion-avatar screen-avatar ${className}`} style={characterMotionStyle(c.id)} data-character={c.id} data-transparent="true" data-animated="true" viewBox="0 0 100 112" xmlns="http://www.w3.org/2000/svg" role={label ? "img" : undefined} aria-label={label} aria-hidden={!label || undefined}>
    {hoverLine && <title>{`${c.name} · ${c.series}\n${animeCompanionBubble(c.id, 1)?.text || ""}`}</title>}
    <HairBack c={c}/>
    <Outfit c={c} skin={skin}/>
    <ellipse cx="21" cy="44" rx="3.5" ry="5" fill={skin} stroke={tint(skin, -.25)} strokeWidth=".85"/><ellipse cx="79" cy="44" rx="3.5" ry="5" fill={skin} stroke={tint(skin, -.25)} strokeWidth=".85"/>
    <path d={head} fill={skin} stroke="#755561" strokeWidth="1.05"/>
    <FaceDetails c={c} uid={uid} skin={skin}/>
    <HairFront c={c}/>
    <Headwear c={c}/>
  </svg>;
}
