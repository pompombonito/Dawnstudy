"use client";

import { useId } from "react";
import { animeCompanionBubble, type AnimeCharacter } from "../community/anime-companions";
import { characterMotionStyle } from "./character-motion";

const ink = "#302b35";
const silver = "#cbd1dd";
const eyeScale: Record<string, [number, number]> = {
  "kpop-jisoo": [1.23, 1.25], "kpop-jennie": [1.26, 1.26], "kpop-rose": [1.16, 1.1], "kpop-lisa": [1.32, 1.44],
  "kpop-rm": [1.16, 1.1], "kpop-jin": [1.2, 1.24], "kpop-suga": [1.18, .94], "kpop-jhope": [1.24, 1.16],
  "kpop-jimin": [1.2, 1.03], "kpop-v": [1.25, 1.32], "kpop-jungkook": [1.31, 1.45],
};
type Portrait = {
  jaw: string; eye: string; lid: string; brow: string; spacing: number;
  iris: number; tilt: number; browWeight: number; nose: string;
  lips: string; lipLine: string; lipColor: string; lowerLip: string;
};

// Individual contours follow the linked YG and BTS official portrait references.
// Chibi proportions simplify the portraits; facial contours are not shared anime presets.
const portraits: Record<string, Portrait> = {
  "kpop-jisoo": {
    jaw: "M20 39Q19 17 50 17t30 22v14q-2 18-19 24L50 80 39 77Q21 70 20 53Z",
    eye: "M-6 .4Q-1-3.4 6-.5Q3.5 3.4-.5 3.1T-6 .4Z", lid: "M-6.5 .3Q-1-3.7 6.5-.5", brow: "M-6-7q5-2 11-.3",
    spacing: 27, iris: 2.35, tilt: 1, browWeight: 1.5, nose: "M50 55q-1 3 1 4m-3 1q2 1.2 4 0",
    lips: "M-5.1 0-2.1-1.7 0-.7 2.1-1.7 5.1 0Q0 5-5.1 0Z", lipLine: "M-5.1 0Q0 1.2 5.1 0", lowerLip: "M-2.8 2q2.8 1 5.6 0", lipColor: "#bb8184",
  },
  "kpop-jennie": {
    jaw: "M19 40Q18 18 50 18t31 22v12q-1 19-20 24l-11 4-11-4Q20 71 19 52Z",
    eye: "M-6.4 0Q-1-3.2 6.4-1.2Q4 3.4-.6 3T-6.4 0Z", lid: "M-7 0Q-1-3.5 7-1.4l1.2-.6", brow: "M-6.3-7q6-2.2 12 .5",
    spacing: 26, iris: 2.55, tilt: 4, browWeight: 1.8, nose: "M50 55q-1.8 3 .8 4.4m-3 .4q2.4 1.5 4.8 0",
    lips: "M-5.5 0-2-1.6 0-.5 2-1.6 5.5 0Q0 6-5.5 0Z", lipLine: "M-5.5 0Q0 .7 5.5 0", lowerLip: "M-3 2.5q3 1 6 0", lipColor: "#a56e76",
  },
  "kpop-rose": {
    jaw: "M22 38Q21 17 50 17t28 21v16q-2 16-17 23L50 81 39 77Q23 70 22 54Z",
    eye: "M-6 .2Q-1.4-3.1 6 .3Q3.5 3.4-.6 3T-6 .2Z", lid: "M-6.3 .2Q-1.2-3.5 6.4 .2", brow: "M-5.8-7q5.5-1.5 11.5.5",
    spacing: 25, iris: 2.25, tilt: -2, browWeight: 1.2, nose: "M50 54q-1.1 4 .5 5.3m-2 1q1.8 1 3.7 0",
    lips: "M-4.6 0-1.6-1.2 0-.8 1.6-1.2 4.6 0Q0 4.3-4.6 0Z", lipLine: "M-4.6 0q4.6 .7 9.2 0", lowerLip: "M-2.3 1.9q2.3 .8 4.6 0", lipColor: "#c08c91",
  },
  "kpop-lisa": {
    jaw: "M19 40Q18 18 50 18t31 22v12q-1 17-18 24l-13 5-13-5Q20 69 19 52Z",
    eye: "M-6.7 .2Q-.6-4.6 6.7-.8Q4.5 4.4-.4 4T-6.7 .2Z", lid: "M-7.1 .1Q-.6-4.8 7.2-1l1.2-.9", brow: "M-6.1-8q6.1-2.3 12.2.1",
    spacing: 27.5, iris: 2.8, tilt: 1.5, browWeight: 1.55, nose: "M50 55q-1.1 3.4 1 4.3m-3.4.7q2.4 1.7 5 0",
    lips: "M-5.7 0-2-1.9 0-.8 2-1.9 5.7 0Q0 6-5.7 0Z", lipLine: "M-5.7 0q5.7 .9 11.4 0", lowerLip: "M-3 2.6q3 1.2 6 0", lipColor: "#b0787e",
  },
  "kpop-rm": {
    jaw: "M20 39Q20 17 50 17t30 22v15q-2 15-16 23l-14 4-14-4Q22 69 20 54Z",
    eye: "M-5.6 0Q0-2.5 5.6-.2L4.2 2.4Q0 3.4-4.7 1.8Z", lid: "M-5.9-.1Q0-2.7 5.9-.3", brow: "M-6.2-6.4q6-1.8 12.4-.3",
    spacing: 27, iris: 2.15, tilt: 0, browWeight: 2, nose: "M50 53q-1.2 4.2 1 6.4m-3.7.6q2.7 1.4 5.4 0",
    lips: "M-5.1 0-1.5-1.4 0-.6 1.5-1.4 5.1 0Q0 5-5.1 0Z", lipLine: "M-5.1 0q5.1 .8 10.2 0", lowerLip: "M-2.5 2q2.5 1 5 0", lipColor: "#b68a8c",
  },
  "kpop-jin": {
    jaw: "M20 39Q20 17 50 17t30 22v15q-2 17-18 23l-12 4-12-4Q22 71 20 54Z",
    eye: "M-6.2 .1Q-.8-3.1 6.2-.4Q4 3.4-.4 3T-6.2 .1Z", lid: "M-6.6 .1Q-.8-3.5 6.6-.5", brow: "M-6.2-7q6.2-1.2 12.4.1",
    spacing: 27, iris: 2.4, tilt: 0, browWeight: 1.75, nose: "M50 53q-1 4.7 1 6.1m-3 1q2 1.2 4 0",
    lips: "M-6 0-2.1-1.8 0-.6 2.1-1.8 6 0Q0 5.2-6 0Z", lipLine: "M-6 0q6 1 12 0", lowerLip: "M-3 2.3q3 1 6 0", lipColor: "#bb8b93",
  },
  "kpop-suga": {
    jaw: "M19 40Q19 18 50 18t31 22v13q-2 18-20 23l-11 4-11-4Q21 71 19 53Z",
    eye: "M-5.8 .3Q-.7-2.4 5.8-1Q3.9 2.8-.4 2.6T-5.8 .3Z", lid: "M-6.2 .3Q-.8-2.8 6.2-1.1", brow: "M-5.9-6.4q5.6-2 11.9-1",
    spacing: 26, iris: 2.2, tilt: 2, browWeight: 1.5, nose: "M50 55q-1.5 3.3.5 4.1m-2.5.9q2 1 4 0",
    lips: "M-4.8 0-1.8-1.3 0-.7 1.8-1.3 4.8 0Q0 4.2-4.8 0Z", lipLine: "M-4.8 0q4.8 .4 9.6 0", lowerLip: "M-2.5 1.9q2.5 .8 5 0", lipColor: "#bd969a",
  },
  "kpop-jhope": {
    jaw: "M22 39Q21 17 50 17t28 22v15q-2 16-16 23l-12 5-12-5Q24 70 22 54Z",
    eye: "M-6.2 .3Q-.3-3.1 6.2-1Q4.7 3-.6 2.9T-6.2 .3Z", lid: "M-6.6 .3Q-.3-3.5 6.7-1.1", brow: "M-6.3-7q6.3-1.3 12.6-.2",
    spacing: 26, iris: 2.3, tilt: 2, browWeight: 1.65, nose: "M50 52q-1 5 1 7m-3 1q2 1.3 4 0",
    lips: "M-5.5 0-2-2 0-.5 2-2 5.5 0Q0 4.8-5.5 0Z", lipLine: "M-5.5 0q5.5 .6 11 0", lowerLip: "M-2.5 2q2.5 .9 5 0", lipColor: "#b47f83",
  },
  "kpop-jimin": {
    jaw: "M19 40Q19 17 50 17t31 23v13q-1 19-20 24l-11 3-11-3Q20 72 19 53Z",
    eye: "M-5.7 0Q-.6-2.5 5.7-.3Q3.7 2.9-.8 2.5T-5.7 0Z", lid: "M-6.2 0Q-.6-2.8 6.2-.4", brow: "M-5.9-6.8q5.9-1.9 11.8.4",
    spacing: 25.5, iris: 2.15, tilt: 0, browWeight: 1.65, nose: "M50 54q-1.3 4 .7 5m-2.8 1q2.1 1.4 4.2 0",
    lips: "M-5.8 0-2.1-1.6 0-.5 2.1-1.6 5.8 0Q0 6-5.8 0Z", lipLine: "M-5.8 0q5.8 .8 11.6 0", lowerLip: "M-3.1 2.6q3.1 1.2 6.2 0", lipColor: "#c18f97",
  },
  "kpop-v": {
    jaw: "M19 39Q19 17 50 17t31 22v15q-2 14-15 23l-16 3-16-3Q21 68 19 54Z",
    eye: "M-6.3 .3Q-.9-3.3 6.3-.6L4.8 2.6Q0 4-5 2.3Z", lid: "M-6.7 .3Q-.8-3.6 6.7-.7", brow: "M-6.5-7q6.5-1.7 13 .3",
    spacing: 27, iris: 2.6, tilt: 0, browWeight: 2, nose: "M50 52q-.5 5.2 1.1 7m-3.3 1q2.2 1.2 4.4 0",
    lips: "M-5.6 0-2-1.5 0-.8 2-1.5 5.6 0Q0 4.9-5.6 0Z", lipLine: "M-5.6 0q5.6 .5 11.2 0", lowerLip: "M-2.7 2.2q2.7 .9 5.4 0", lipColor: "#b98b8b",
  },
  "kpop-jungkook": {
    jaw: "M19 39Q19 17 50 17t31 22v14q-1 17-18 23l-13 5-13-5Q20 70 19 53Z",
    eye: "M-6 .1Q-.2-3.7 6-.4Q4 3.6-.3 3.3T-6 .1Z", lid: "M-6.4 .1Q-.2-4 6.4-.5", brow: "M-6.2-7.2q6.2-1.6 12.4 0",
    spacing: 27, iris: 2.6, tilt: 0, browWeight: 1.8, nose: "M50 54q-1.3 3.9.8 5m-3.2 1q2.4 1.4 4.8 0",
    lips: "M-5.2 0-1.8-1.6 0-.6 1.8-1.6 5.2 0Q0 5-5.2 0Z", lipLine: "M-5.2 0q5.2 .7 10.4 0", lowerLip: "M-2.5 2.2q2.5 .9 5 0", lipColor: "#bc8d91",
  },
};

function PortraitFace({ c, p, uid }: { c: AnimeCharacter; p: Portrait; uid: string }) {
  const female = c.series === "BLACKPINK";
  return <>
    {[-1, 1].map(side => {
      const clip = `idol-eye-${uid}-${side}`;
      return <g key={side} transform={`translate(${50 + side * p.spacing / 2} 48)`}>
        <g transform={`scale(${-side} 1) rotate(${p.tilt})`}>
          <path d={p.brow} stroke={c.hair} strokeWidth={p.browWeight} fill="none" strokeLinecap="round"/>
          <g transform={`scale(${eyeScale[c.id][0]} ${eyeScale[c.id][1]})`}><g className="anime-eye-blink">
            <defs><clipPath id={clip}><path d={p.eye}/></clipPath></defs>
            <path d={p.eye} fill="#fff9f2" stroke="#a67e75" strokeWidth=".45"/>
            <g clipPath={`url(#${clip})`}><g className="anime-eye-gaze">
              <ellipse cy=".7" rx={p.iris} ry={p.iris * 1.25} fill={c.eyes}/>
              <ellipse cy=".7" rx={p.iris * .5} ry={p.iris * .95} fill="#29232c"/>
              <circle cx=".8" cy="-.6" r=".65" fill="#fff7ea"/>
            </g></g>
            <path d={p.lid} fill="none" stroke={ink} strokeWidth={female ? 1.1 : .85} strokeLinecap="round"/>
            {female && <path d="m-5.7-.3-1.3-1m2.5.1-.8-1.4" fill="none" stroke={ink} strokeWidth=".75" strokeLinecap="round"/>}
            <path d={p.lid} transform="translate(0 -1.65)" fill="none" stroke="#b28d82" opacity={c.id === "kpop-v" && side === 1 ? .2 : .5} strokeWidth=".45"/>
          </g></g>
        </g>
      </g>;
    })}
    <path d={p.nose} fill="none" stroke="#b78370" strokeWidth=".7" strokeLinecap="round"/>
    <g transform={`translate(50 67) scale(${["kpop-jin", "kpop-jimin", "kpop-lisa"].includes(c.id) ? 1.16 : 1} 1)`}><g className="anime-mouth-motion">
      <path d={p.lips} fill={p.lipColor} opacity=".85"/>
      <path d={p.lipLine} fill="none" stroke="#81565d" strokeWidth=".65" strokeLinecap="round"/>
      <path d={p.lowerLip} fill="none" stroke="#ffe4d4" opacity=".75" strokeWidth=".65" strokeLinecap="round"/>
    </g></g>
    {c.id === "kpop-rm" && <path d="m29 63 1.5 1.5m39-1.5L70 65" fill="none" stroke="#bb927e" opacity=".65" strokeWidth=".55"/>}
    {c.id === "kpop-jungkook" && <g fill={silver} stroke="#6c6c79" strokeWidth=".4"><circle cx="30.5" cy="39.5" r=".95"/><circle cx="32.2" cy="37" r=".95"/><ellipse cx="46.6" cy="68" rx=".65" ry="1.7" fill="none" strokeWidth=".8"/></g>}
  </>;
}

const backHair: Record<string, string> = {
  "kpop-jisoo": "M24 29Q12 30 17 59q-8 9 1 16 8 5 17-2h30l9-9 4-27Z",
  "kpop-jennie": "M23 31Q15 43 20 65l-3 28 12-3 6-28h29l9 30 9-3-4-37-3-22Z",
  "kpop-rose": "M24 28Q12 38 17 52q-7 10-1 21-6 12 1 26l14-5 5-17h28l7 21 13-2q7-15 0-24 6-11-1-22 4-19-13-25Z",
  "kpop-lisa": "M28 28Q17 27 22 15q5-8 14-2l7 9h16l8-12q7-4 12 3 5 11-7 16l7 20-5 21-8-3-2-20H36l-6 21-9 2 3-24Z",
  "kpop-rm": "M22 34q-3 9 0 26l10 6h37l9-8 1-24Z",
  "kpop-jin": "M22 30Q16 41 20 67l10 14 7-8h27l7 8 10-17-3-36Z",
  "kpop-suga": "M23 29Q17 43 23 62l8 9 7-4h26l8 5 7-12-3-34Z",
  "kpop-jhope": "M22 31Q18 46 22 62l10 9h36l10-10q4-18-2-30Z",
  "kpop-jimin": "M22 30Q16 45 22 65q2 12 11 13l5-7h26l6 7q10-6 10-14l-3-33Z",
  "kpop-v": "M23 28q-8 11-2 29l-1 14 13 9 7-8h25l7 10 10-13-1-18 1-22Z",
  "kpop-jungkook": "M23 30Q17 43 23 63l8 8 7-4h28l8 6 6-12-3-31Z",
};

const frontHair: Record<string, string> = {
  "kpop-jisoo": "M20 43Q13 18 37 11q20-6 36 7 12 9 7 26l-6 13-2-20q-7-17-24-18-17 1-24 18v19Z",
  "kpop-jennie": "M21 44Q12 18 37 11q14-8 25 1 23-2 20 28l-8 18-3-22q-2-12-13-16l-8 6-7-6q-15-4-17 18l1 18Z",
  "kpop-rose": "M21 47Q13 18 39 12q20-8 34 6 13 10 7 33l-8 16-2-26q-2-14-15-21l-5 4-5-5q-16 9-16 24l-2 25-7-5Z",
  "kpop-lisa": "M22 46Q15 16 48 15q32-1 31 30l-7 17-2-27-6 1-1-8-4 9-3-8-3 8-3-8-3 8-3-8-3 7-4-4-2 7-4-2-2 27-8 4Z",
  "kpop-rm": "M21 42 19 31q-2-12 9-16l-1-4 10 3 4-5 8 4 8-5 3 5 10-2-1 4q14 1 13 15l-7 17-5-18Q52 20 31 31l-5 23Z",
  "kpop-jin": "M21 43Q12 20 33 12q14-6 26-1 17-4 22 16 3 10-2 21l-6 10-2-23q-2-13-15-16-18 3-27 19l-1 17Z",
  "kpop-suga": "M21 48Q12 20 32 13q14-9 27-2 23-3 22 22l-5 20-6-15-2-15Q56 17 48 24q-13 7-19 25l-3 11Z",
  "kpop-jhope": "M21 43 17 30q-3-16 13-17L39 6l8 7q18-10 29 0l-5 4q16 1 11 18l-7 19-5-23q-23 3-39-6l-4 27Z",
  "kpop-jimin": "M21 45Q11 23 30 14q11-10 23-3 13-6 22 6 12 9 5 29l-6 11-3-22q-6-13-18-16-17 3-25 18l-1 20Z",
  "kpop-v": "M21 44q-9-9-3-19-3-10 8-12 1-10 13-7 8-8 18-1 12-4 18 6 12 2 9 14 6 8-3 20l-6 13-5-25q-2-15-18-14-6 9-21 13l-4 25Z",
  "kpop-jungkook": "M21 45Q13 19 35 12q15-6 28 1 18 3 18 21l-6 22-6-14 1-17q-13-9-20 1-12 9-19 19l-4 14Z",
};

function Hair({ c, front = false }: { c: AnimeCharacter; front?: boolean }) {
  return <g className={front ? "anime-hair-front" : "anime-hair-back"} fill={c.hair} stroke={ink} strokeWidth="1.4" strokeLinejoin="round">
    <path d={(front ? frontHair : backHair)[c.id]}/>
    {front && <g fill="none" stroke={c.id === "kpop-rose" ? "#f5e3b4" : c.id === "kpop-jhope" ? "#d0d0df" : "#73717d"} strokeWidth=".65" opacity=".5">
      {c.id === "kpop-jisoo" && <path d="M25 31q4-13 20-16m-17 9q-1-12 25-11m19 18Q66 17 51 15M20 37l5-4-4-4 7-4-2-4 8-3"/>}
      {c.id === "kpop-jennie" && <path d="M26 33q-3-16 14-20m-8 15q0-13 13-16m16 1q14 3 13 18m-16-17q10 6 10 17M46 15l-2 7m11-7 4 5"/>}
      {c.id === "kpop-rose" && <path d="M24 38q0-21 22-23m29 26Q76 21 55 16M23 53q-6 12 0 22t0 18m53-40q8 12 1 22t2 17"/>}
      {c.id === "kpop-lisa" && <path d="M29 30q-1-13 17-12m27 13Q72 20 55 18M34 23l2 11m5-13 3 12m8-12 1 12m8-10 1 11M25 21q-5-8 7-6m37 5q10-11 7-6"/>}
      {c.id === "kpop-rm" && <path d="m29 24 7-8m1 10 7-11m1 9 7-10m1 10 9-10m0 12 10-8"/>}
      {c.id === "kpop-jin" && <path d="M26 33q1-16 27-19m-20 9q6-8 23-8m3 0q17 5 17 23"/>}
      {c.id === "kpop-suga" && <path d="M25 38q2-19 22-23m-15 18Q37 19 51 17m8-3q16 4 17 20"/>}
      {c.id === "kpop-jhope" && <path d="M26 20q17 10 45-4M30 16q21 7 36-2m7 9 5 6M25 30l1 9"/>}
      {c.id === "kpop-jimin" && <path d="M25 32q1-15 24-17m-16 9 13-8m10-1q19 7 20 24"/>}
      {c.id === "kpop-v" && <path d="M24 27q-5-8 5-8m2-2q-3-9 9-6m5-1q9-6 13 3m6 0q12-2 13 10M32 29q12-7 14-14m24 9q9 3 7 13"/>}
      {c.id === "kpop-jungkook" && <path d="M25 35q0-15 20-20m-14 18q7-14 15-15m12-2q16 1 18 17m-5 7 3-10"/>}
    </g>}
    {front && c.id === "kpop-rm" && <path d="m21 35 10-1m-10 5 9-1" fill="none" stroke="#b3a2a5" strokeWidth="1.6"/>}
    {front && c.id === "kpop-jennie" && <g fill="none" stroke={c.hair} strokeWidth="3" strokeLinecap="round"><path d="M27 29q-8 20-4 40l-7 27m54-68q9 15 4 35l5 30"/><path d="M22 48q-8 27-8 34m62-35q8 22 7 37" strokeWidth="1.6"/></g>}
    {front && c.id === "kpop-lisa" && <g fill="none" stroke="#bd9764" strokeWidth="1.6" strokeLinecap="round"><path d="M29 29q-7 20-3 40l-6 22m52-61q7 19 3 35l6 25"/></g>}
  </g>;
}

function Outfit({ c, skin }: { c: AnimeCharacter; skin: string }) {
  const bp = c.series === "BLACKPINK";
  return <g strokeLinejoin="round">
    <path d="M27 99v-7q1-11 17-13h12q17 2 17 13v7" fill={c.outfit} stroke={ink} strokeWidth="1.5"/>
    <path d="M43 73v8q7 7 14 0v-8" fill={skin} stroke="#be9580" strokeWidth=".8"/>
    {bp ? <>
      {c.id === "kpop-jisoo" && <><path d="M40 78q10 3 20 0l2 13-5 8H43l-5-8Z" fill="#b6c5c7" stroke="#7e9397" strokeWidth="1"/><path d="M45 81v15m5-14v15m5-16v15" stroke="#ced7d4" strokeWidth=".6"/></>}
      {c.id === "kpop-jennie" && <><path d="M28 86q22 6 44 0l2 13H26Z" fill="#a5b3b6" stroke="#6f838a" strokeWidth="1"/><path d="M31 90q19 5 38 0m-38 4q19 5 38 0" fill="none" stroke="#d0d9d8" strokeWidth=".7"/></>}
      {c.id === "kpop-rose" && <><path d="m35 82 2 17m28-17-2 17" stroke="#64757d" strokeWidth="1.2"/><path d="m42 82 8 8 8-8" stroke="#d1c5a5" strokeWidth="1.1" fill="none"/><circle cx="50" cy="90" r="1" fill="#e0d7bc"/></>}
      {c.id === "kpop-lisa" && <><path d="M34 84q16 9 32 0l-3 15H37Z" fill="#81918f" stroke="#556b70"/><path d="m35 85 15 9 15-9" fill="none" stroke={silver} strokeWidth="3" strokeDasharray="2 1"/><path d="m35 78 15 9 15-9" fill="none" stroke="#636872" strokeWidth="4"/><path d="m35 78 15 9 15-9" fill="none" stroke={silver} strokeWidth="1.5" strokeDasharray="2 1"/></>}
    </> : <>
      <path d="m38 80-8 7 12 12 5-13m15-6 8 7-12 12-5-13" fill="#202532" stroke="#525b6c" strokeWidth="1.1"/>
      {c.id === "kpop-v" ? <path d="m30 81-7 7 6 1-4 7 8-2 1 5 10-12m26-6 7 7-6 1 4 7-8-2-1 5-10-12" fill="#20222e" stroke="#444252" strokeWidth="1"/>
        : c.id === "kpop-suga" || c.id === "kpop-jhope" ? <path d="m35 80 10 7-3 12m23-19-10 7 3 12" fill="none" stroke="#414451" strokeWidth="4"/>
          : <path d="M50 87v12" stroke="#a0a6b2" strokeWidth=".8"/>}
      <path d="m40 81 10 6 10-6" fill="none" stroke={silver} strokeWidth={c.id === "kpop-jhope" || c.id === "kpop-jungkook" ? 2.3 : 1.35} strokeDasharray="1.6 1"/>
      {(c.id === "kpop-jin" || c.id === "kpop-jimin") && <><path d="m38 84 12 8 12-8m-25 4 13 8 13-8" fill="none" stroke={silver} strokeWidth="1.2" strokeDasharray="1 1"/><rect x="48.4" y="91" width="3.2" height="4" rx=".7" fill={silver}/></>}
    </>}
  </g>;
}

/** Human artist portraits retain individual features and the site's transparent SVG animation rig. */
export default function KpopAvatar({ character: c, className = "", label, hoverLine = true }: {
  character: AnimeCharacter; className?: string; label?: string; hoverLine?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const p = portraits[c.id];
  if (!p) return null;
  const skin = "skin" in c && typeof c.skin === "string" ? c.skin : "#f0d0ba";
  return <svg className={`ds-avatar anime-avatar motion-avatar kpop-avatar ${className}`} style={characterMotionStyle(c.id)} data-character={c.id} data-transparent="true" data-animated="true" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role={label ? "img" : undefined} aria-label={label} aria-hidden={!label || undefined}>
    {hoverLine && <title>{`${c.name} · ${c.series}\n${animeCompanionBubble(c.id, 1)?.text || ""}`}</title>}
    <Hair c={c}/>
    <Outfit c={c} skin={skin}/>
    <ellipse cx="20" cy="52" rx="4.5" ry="7" fill={skin} stroke="#ba9380" strokeWidth="1"/><ellipse cx="80" cy="52" rx="4.5" ry="7" fill={skin} stroke="#ba9380" strokeWidth="1"/>
    <path d={p.jaw} fill={skin} stroke={ink} strokeWidth="1.4"/>
    <path d="M25 55q2 13 14 17m36-17q-2 13-14 17" fill="none" stroke="#d6ab96" opacity=".25" strokeWidth="2"/>
    <PortraitFace c={c} p={p} uid={uid}/>
    <g fill="none" stroke={silver} strokeWidth="1.1">
      {c.id === "kpop-lisa" && <><ellipse cx="20" cy="59" rx="3.2" ry="4.5"/><ellipse cx="80" cy="59" rx="3.2" ry="4.5"/></>}
      {c.id === "kpop-jimin" && <><ellipse cx="20" cy="58" rx="2.5" ry="3.8"/><path d="M80 57v10"/><circle cx="80" cy="68" r="1.5" fill={silver}/></>}
      {c.id === "kpop-suga" && <><path d="M80 57v7"/><circle cx="80" cy="65" r="1.2"/></>}
      {c.id === "kpop-jungkook" && <><ellipse cx="80" cy="59" rx="2.5" ry="4"/>{[55,58,61].map(y => <circle key={y} cx="19.5" cy={y} r=".7" fill={silver}/>)}</>}
      {(c.id === "kpop-rm" || c.id === "kpop-jhope") && <circle cx="20" cy="58" r="1.1" fill={silver}/>}
      {c.id === "kpop-jennie" && <path d="M80 51v7" stroke="#ccb878" strokeWidth="1.6"/>}
    </g>
    <Hair c={c} front/>
  </svg>;
}
