"use client";

import { useId } from "react";
import { animeCompanionBubble, type AnimeCharacter } from "../community/anime-companions";
import { characterMotionStyle } from "./character-motion";

const ink = "#302b35";
const silver = "#cbd1dd";

function shadeHex(color: string, amount: number) {
  const match = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const value = match[1];
  const channels = [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16));
  const target = amount < 0 ? 0 : 255;
  return `#${channels.map(channel => Math.round(channel + (target - channel) * Math.abs(amount)).toString(16).padStart(2, "0")).join("")}`;
}
const eyeScale: Record<string, [number, number]> = {
  "kpop-rm": [1.16, 1.1], "kpop-jin": [1.2, 1.24], "kpop-suga": [1.18, .94], "kpop-jhope": [1.24, 1.16],
  "kpop-jimin": [1.2, 1.03], "kpop-v": [1.25, 1.32], "kpop-jungkook": [1.31, 1.45],
};
type Portrait = {
  jaw: string; eye: string; lid: string; brow: string; spacing: number;
  iris: number; tilt: number; browWeight: number; nose: string;
  lips: string; lipLine: string; lipColor: string; lowerLip: string;
};

type ArtistStyling = {
  hairStyle?: "short" | "wavy" | "long" | "bob" | "curly" | "updo" | "braids" | "pixie" | "curtain" | "slicked-back" | "ponytail";
  fringe?: "none" | "full" | "wispy" | "side" | "curtain";
  part?: "left" | "center" | "right";
  outfitStyle?: "suit" | "cardigan" | "dress" | "casual" | "coat";
  feature?: "freckles" | "beauty-mark";
  gender?: "feminine" | "masculine";
};

function artistStyling(c: AnimeCharacter): ArtistStyling {
  return ("portrait" in c && typeof c.portrait === "object" ? c.portrait : {}) as ArtistStyling;
}

function chibiPortrait(c: AnimeCharacter): Portrait {
  const face = c.face;
  const feminine = artistStyling(c).gender === "feminine";
  const classic = portraits[c.id];
  const scale = eyeScale[c.id];
  const width = Math.max(6.3, Math.min(8.3, (face.eyeWidth || 12) * .57));
  const height = Math.max(4.6, Math.min(7.5, (face.eyeHeight || 8) * .7 * (scale ? scale[1] / 1.18 : 1)));
  const tilt = classic?.tilt ?? face.eyeTilt ?? 0;
  const round = face.faceShape === "round";
  return {
    jaw: round ? "M18 39Q17 17 50 17t33 22v13q0 18-21 23l-12 2-12-2Q18 70 18 52Z" : "M20 39Q19 17 50 17t31 22v13q-1 17-19 23l-12 3-12-3Q21 69 20 52Z",
    eye: `M${-width} 0Q0 ${-height * 1.4} ${width} ${-Math.abs(tilt) * .35}Q${width * .9} ${height * 1.3} 0 ${height * 1.2}T${-width} 0Z`,
    lid: `M${-width - (feminine ? .6 : .2)} 0Q0 ${-height * 1.45} ${width + .2} ${-Math.abs(tilt) * .35}`,
    brow: face.brow === "angry" || face.brow === "determined" ? "M-6.3-9 6.3-10.6" : "M-6.3-10q6.3-2 12.6-.2",
    spacing: classic?.spacing ?? Math.max(25, Math.min(30, face.eyeSpacing || 27)),
    iris: Math.min(width * .66, height * .78), tilt, browWeight: feminine ? 1.05 : 1.3,
    nose: "M49.3 59q.7.7 1.4 0", lips: "", lipLine: "", lowerLip: "", lipColor: classic?.lipColor || "#bd8190",
  };
}

// Individual contours follow the linked YG and BTS official portrait references.
// Chibi proportions simplify the portraits; facial contours are not shared anime presets.
const portraits: Record<string, Portrait> = {
  "kpop-jisoo": {
    jaw: "M18 39Q17 18 50 18t32 21v12q0 16-16 21l-16 2.5-16-2.5Q18 68 18 52Z",
    eye: "M-7.8 .2C-5.5-7.5 5.2-7.5 7.8-.8Q7.4 7.2 0 7.3T-7.8 .2Z", lid: "M-8.2 .2C-5.7-7.8 5.4-7.8 8.1-.8", brow: "M-6.5-10q6.2-2.2 12.5-.5",
    spacing: 28.5, iris: 5.1, tilt: .5, browWeight: 1.15, nose: "M49.4 58.8q.6.6 1.2 0",
    lips: "M-4.8 0-2-1.4 0-.6 2-1.4 4.8 0Q0 4.6-4.8 0Z", lipLine: "M-4.8 0Q0 1 4.8 0", lowerLip: "M-2.6 2q2.6 .9 5.2 0", lipColor: "#b8707c",
  },
  "kpop-jennie": {
    jaw: "M18 39Q16 18 50 18t32 21v12q0 17-17 22l-15 2-15-2Q18 69 18 52Z",
    eye: "M-8 .2Q-3-7.5 7.8-2.2Q7.6 6.2 0 6.2T-8 .2Z", lid: "M-8.8-1.4-8 .2Q-3-7.8 8.2-2.4", brow: "M-6.8-9q6.8-2.6 13.2 0",
    spacing: 28, iris: 5.0, tilt: 2.2, browWeight: 1.2, nose: "M49 58.8q1 .7 2 0",
    lips: "M-5.2 0-1.8-1.4 0-.5 1.8-1.4 5.2 0Q0 5.2-5.2 0Z", lipLine: "M-5.2 0Q0 .7 5.2 0", lowerLip: "M-2.8 2.3q2.8 1 5.6 0", lipColor: "#a86470",
  },
  "kpop-rose": {
    jaw: "M18 39Q17 18 50 18t32 21v12q0 16-17 21l-15 2.5-15-2.5Q18 68 18 52Z",
    eye: "M-7.8 .4Q-3-7 7.8-.2Q7.3 7 0 6.8T-7.8 .4Z", lid: "M-8.2 .4Q-3.2-7.4 8.1-.2", brow: "M-6.2-9.6q6.2-1.2 12.4.6",
    spacing: 27.5, iris: 5.0, tilt: 0, browWeight: 1.1, nose: "M50 58.6q.5.6 1 .1",
    lips: "M-4.6 0-1.6-1.2 0-.8 1.6-1.2 4.6 0Q0 4.3-4.6 0Z", lipLine: "M-4.6 0q4.6 .7 9.2 0", lowerLip: "M-2.3 1.9q2.3 .8 4.6 0", lipColor: "#bd7f86",
  },
  "kpop-lisa": {
    jaw: "M18 39Q16 18 50 18t32 21v12q0 17-18 22l-14 2-14-2Q18 69 18 52Z",
    eye: "M-8.2 0C-6.2-8.5 6-8.5 8.2 0Q8 8.8 0 8.6T-8.2 0Z", lid: "M-8.8-.2C-6.4-9 6.2-9 8.8-.2", brow: "M-6.8-10.5q6.8-1.8 13.3.4",
    spacing: 28, iris: 5.4, tilt: .5, browWeight: 1.15, nose: "M48.8 59q1.2.7 2.4 0",
    lips: "M-5.4 0-1.8-1.7 0-.7 1.8-1.7 5.4 0Q0 5.6-5.4 0Z", lipLine: "M-5.4 0q5.4 .8 10.8 0", lowerLip: "M-2.8 2.4q2.8 1 5.6 0", lipColor: "#b26c74",
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

function CuteIdolFace({ c, p, uid }: { c: AnimeCharacter; p: Portrait; uid: string }) {
  const bp = c.series === "BLACKPINK";
  const rose = c.id === "kpop-rose", lisa = c.id === "kpop-lisa", jennie = c.id === "kpop-jennie";
  const brow = rose ? "#9e8668" : lisa ? "#6b5446" : "#54444a";
  const irisRadius = bp ? p.iris * 1.08 : p.iris;
  return <>
    <defs>
      <radialGradient id={`idol-blush-${uid}`}><stop stopColor="#ed879b" stopOpacity=".55"/><stop offset="1" stopColor="#f4a2a6" stopOpacity="0"/></radialGradient>
    </defs>
    <ellipse cx={jennie ? 28 : 28.5} cy="59" rx="6.8" ry="3.8" fill={`url(#idol-blush-${uid})`}/>
    <ellipse cx={jennie ? 72 : 71.5} cy="59" rx="6.8" ry="3.8" fill={`url(#idol-blush-${uid})`}/>
    {[-1, 1].map(side => {
      const clip = `idol-eye-${uid}-${side}`, iris = `idol-iris-${uid}-${side}`;
      return <g key={side} transform={`translate(${50 + side * p.spacing / 2} ${lisa ? 50 : 50.5})`}>
        <g transform={`scale(${-side} 1) rotate(${p.tilt})`}>
          <path d={p.brow} stroke={brow} strokeWidth={p.browWeight} opacity=".82" fill="none" strokeLinecap="round"/>
          <g className="anime-eye-blink">
            <defs>
              <clipPath id={clip}><path d={p.eye}/></clipPath>
              <linearGradient id={iris} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#251f26"/><stop offset=".55" stopColor={c.eyes}/><stop offset="1" stopColor={rose ? "#785b4a" : lisa ? "#60473b" : "#4c3937"}/></linearGradient>
            </defs>
            <path d={p.eye} fill="#fffbf7" stroke="#bc8f88" strokeWidth=".45"/>
            <g clipPath={`url(#${clip})`}><g className="anime-eye-gaze">
              <ellipse cy="1.1" rx={irisRadius} ry={irisRadius * 1.25} fill={`url(#${iris})`}/>
              <ellipse cy=".4" rx={irisRadius * .44} ry={irisRadius * .85} fill="#18151a"/>
              <path d={`M${-irisRadius * .55} 4.8q${irisRadius * .55} 2.2 ${irisRadius * 1.1} 0`} fill="none" stroke="#f6ce9d" strokeWidth=".7" opacity=".85"/>
              <ellipse cx="1.6" cy="-1.4" rx={irisRadius * .38} ry={irisRadius * .44} fill="#ffffff"/>
              <circle cx="-1.7" cy="3.2" r={irisRadius * .2} fill="#ffffff" opacity=".95"/>
              <circle cx="2.2" cy="2.5" r={irisRadius * .12} fill="#ffffff" opacity=".85"/>
            </g></g>
            <path d={p.lid} fill="none" stroke="#3c2833" strokeWidth={jennie || lisa ? 1.45 : 1.2} strokeLinecap="round"/>
            <path d="m-7.6-.8-1.5-2m3.3.3-.8-2" fill="none" stroke="#3c2833" strokeWidth="1.05" strokeLinecap="round"/>
            {lisa && <path d="m-6.8-2.2-2-1.4m3.6-.4-.4-2m3.4.4.8-2" stroke="#3c2833" strokeWidth=".85" strokeLinecap="round" fill="none"/>}
            {jennie && <path d="M-8.2-1.2-10.2-3.4" stroke="#3c2833" strokeWidth="1.4" strokeLinecap="round"/>}
            <path d="M-5.5 5.8q5.5 1.8 11 0" fill="none" stroke="#c89487" opacity=".35" strokeWidth=".5"/>
            <path d={p.lid} transform="translate(0 -1.8)" fill="none" stroke="#b8847d" opacity=".3" strokeWidth=".5"/>
          </g>
        </g>
      </g>;
    })}
    <path d={p.nose} fill="none" stroke="#c58b80" strokeWidth=".65" strokeLinecap="round"/>
    <g transform={`translate(50 ${jennie ? 65.3 : 65.8})`}><g className="anime-mouth-motion" strokeLinecap="round" strokeLinejoin="round">
      {c.id === "kpop-jisoo" && <><path d="M-3.4 0-1.7-1.4 0-.5 1.7-1.4 3.4 0Q0 4.2-3.4 0Z" fill="#d97387"/><path d="M-3.4 0Q0 .8 3.4 0" fill="none" stroke="#944254" strokeWidth=".7"/><path d="M-1.6 2.1q1.6 .7 3.2 0" fill="none" stroke="#f8bcc7" strokeWidth="1"/></>}
      {jennie && <><path d="m-3 0 1.6-1.1 1.4.7 1.4-.7 1.6 1.1Q0 4.8-3 0Z" fill="#d4798a"/><path d="M-3 0q3 .9 6 0" fill="none" stroke="#944654" strokeWidth=".8"/><path d="M-1.8 2.2q1.8 .8 3.6 0" fill="none" stroke="#f6b8c4" strokeWidth="1"/></>}
      {rose && <><path d="M-2.8 0q2.8 2.2 5.6-.2" fill="none" stroke="#b0697b" strokeWidth=".9"/><path d="M-.9 1.4h1.8" stroke="#ecc0c4" strokeWidth=".65"/></>}
      {lisa && <><path d="M-3.6-.2q3.6 3.6 7.2 0Q2.6 4.3 0 4.3T-3.6-.2Z" fill="#de6f84" stroke="#943d52" strokeWidth=".8"/><path d="M-2.4 .6h4.8" stroke="#ffffff" strokeWidth=".9"/></>}
      {c.series !== "BLACKPINK" && (c.face.mouth === "open-smile" || c.face.mouth === "grin" ? <><path d="M-3.5-.5q3.5 1.1 7 0Q2.7 4.3 0 4.3T-3.5-.5Z" fill={p.lipColor}/><path d="M-2.3 2.8q2.3-1 4.6 0" fill="none" stroke="#efb3bd" strokeWidth="1"/></> : <path d={c.face.mouth === "neutral" ? "M-2.6 .7q2.6.6 5.2 0" : "M-3 .1q3 2.4 6-.3"} fill="none" stroke={p.lipColor} strokeWidth="1.05"/>)}
    </g></g>
    {/* Jennie's iconic beauty mark above her left eye from the Jump single reference */}
    {jennie && <circle cx="64" cy="46" r=".65" fill="#38252d"/>}
    {artistStyling(c).feature === "beauty-mark" && !jennie && <circle cx="65.5" cy="59.5" r=".65" fill="#70505a"/>}
    {artistStyling(c).feature === "freckles" && <g fill="#bd8a77" opacity=".65">{[29, 32, 35, 65, 68, 71].map((x, i) => <circle key={x} cx={x} cy={59 + i % 2 * 1.5} r=".5"/>)}</g>}
  </>;
}

function PortraitFace({ c, p, uid }: { c: AnimeCharacter; p: Portrait; uid: string }) {
  return <CuteIdolFace c={c} p={p} uid={uid}/>;
}

const backHair: Record<string, string> = {
  "kpop-jisoo": "M22 26Q13 40 14 62q1 15 6 25 3 4 8 2 10 3 20 0 10 3 20 0 5 2 8-2 5-10 6-25 1-22-7-36Q50 11 22 26Z",
  "kpop-jennie": "M22 26Q12 40 13 60q0 15 7 24 4 5 10 3 9 2 18 0 9 2 18 0 6 2 10-3 7-9 7-24 1-20-7-34Q50 11 22 26Z",
  "kpop-rose": "M22 26Q13 38 14 54q-1 10 5 17 4 4 9 2 4-2 6-8l1-11 5-2h20l5 2 1 11q2 6 6 8 5 2 9-2 6-7 5-17 1-16-7-26Q50 10 22 26Z",
  "kpop-lisa": "M22 26Q14 40 15 62q1 14 6 23 4 4 8 2 10 2 19 0 10 2 19 0 4 2 8-2 5-9 6-23 1-22-7-36Q50 11 22 26Z",
  "kpop-rm": "M22 34q-3 9 0 26l10 6h37l9-8 1-24Z",
  "kpop-jin": "M22 30Q16 41 20 67l10 14 7-8h27l7 8 10-17-3-36Z",
  "kpop-suga": "M23 29Q17 43 23 62l8 9 7-4h26l8 5 7-12-3-34Z",
  "kpop-jhope": "M22 31Q18 46 22 62l10 9h36l10-10q4-18-2-30Z",
  "kpop-jimin": "M22 30Q16 45 22 65q2 12 11 13l5-7h26l6 7q10-6 10-14l-3-33Z",
  "kpop-v": "M23 28q-8 11-2 29l-1 14 13 9 7-8h25l7 10 10-13-1-18 1-22Z",
  "kpop-jungkook": "M23 30Q17 43 23 63l8 8 7-4h28l8 6 6-12-3-31Z",
};

const frontHair: Record<string, string> = {
  "kpop-jisoo": "M18 43Q15 15 50 14q34 0 32 29v15l-5 6-2-19Q71 31 50 25 30 27 24 44l-2 20-5-6Z",
  "kpop-jennie": "M18 43Q16 15 50 14q34 0 32 29v15l-5 5-2-19Q70 30 50 24 31 27 24 44l-2 19-5-5Z",
  "kpop-rose": "M19 42Q16 14 50 13q34 0 32 29v13q3 5 0 10-4 3-7-1l-2-17Q70 32 51 25 33 27 26 45l-3 19q-4 3-7-1 0-7 3-13Z",
  "kpop-lisa": "M19 42Q16 14 50 13q34 0 32 29v16l-5 5-2-20-2-7q-3 3-7 1-4 3-8 0-4 3-8 0-4 3-8 0-4 3-8 0-4 2-7-1l-2 7-2 20-5-5Z",
  "kpop-rm": "M21 42 19 31q-2-12 9-16l-1-4 10 3 4-5 8 4 8-5 3 5 10-2-1 4q14 1 13 15l-7 17-5-18Q52 20 31 31l-5 23Z",
  "kpop-jin": "M21 43Q12 20 33 12q14-6 26-1 17-4 22 16 3 10-2 21l-6 10-2-23q-2-13-15-16-18 3-27 19l-1 17Z",
  "kpop-suga": "M21 48Q12 20 32 13q14-9 27-2 23-3 22 22l-5 20-6-15-2-15Q56 17 48 24q-13 7-19 25l-3 11Z",
  "kpop-jhope": "M21 43 17 30q-3-16 13-17L39 6l8 7q18-10 29 0l-5 4q16 1 11 18l-7 19-5-23q-23 3-39-6l-4 27Z",
  "kpop-jimin": "M21 45Q11 23 30 14q11-10 23-3 13-6 22 6 12 9 5 29l-6 11-3-22q-6-13-18-16-17 3-25 18l-1 20Z",
  "kpop-v": "M21 44q-9-9-3-19-3-10 8-12 1-10 13-7 8-8 18-1 12-4 18 6 12 2 9 14 6 8-3 20l-6 13-5-25q-2-15-18-14-6 9-21 13l-4 25Z",
  "kpop-jungkook": "M21 45Q13 19 35 12q15-6 28 1 18 3 18 21l-6 22-6-14 1-17q-13-9-20 1-12 9-19 19l-4 14Z",
};

const catalogBackHair: Record<NonNullable<ArtistStyling["hairStyle"]>, string> = {
  short: "M23 30Q17 43 23 59l8 9h38l9-12-3-27Z",
  pixie: "M24 30Q18 44 24 57l8 8h35l9-11-2-25Z",
  curtain: "M24 29Q16 42 22 61l9 12 7-8h26l7 8 9-13-4-31Z",
  "slicked-back": "M24 30Q18 40 23 57l9 8h37l8-10-2-25Z",
  bob: "M25 28Q16 35 19 59l3 14q11 5 18-3h20q9 7 18 2l3-21q1-17-13-24Z",
  long: "M27 29Q17 38 22 56q-2 14 0 28 4 5 9 2l3-22h32l3 22q7 3 10-2 2-12-1-28 4-18-12-27Z",
  wavy: "M27 28Q17 38 22 51q-5 10 0 19-5 12 2 23 10 3 12-3-4-11 1-22h26q6 13 1 23 7 7 14 1 7-12 0-23 5-12 0-21 2-15-13-21Z",
  curly: "M27 27q-9-2-10 9-6 5-1 13-5 8 0 15-4 10 4 14-3 11 9 14 9 4 12-5l1-18h21l1 20q9 9 17 1 9-4 5-13 8-7 2-15 5-8 0-15 4-10-5-15-1-11-13-8Z",
  updo: "M25 28Q18 41 24 57l7 10h39l8-13-3-24Z",
  braids: "M25 28Q18 41 24 57l7 10h38l8-13-3-24Z M24 51q-5 12-1 23l-2 18 3 4 3-4-1-19 3-20Z M72 51q6 12 2 23l2 18-3 4-3-4 1-19-3-20Z",
  ponytail: "M64 21q18-9 20 11-3 13 2 25 3 15-4 27-9-5-11-17 5-17-1-28Z M25 29Q18 42 24 57l7 10h37l8-14-3-24Z",
};

const catalogFrontHair: Record<NonNullable<ArtistStyling["hairStyle"]>, string> = {
  short: "M22 44q-5-13 2-21l-1-5 11-2 8-6 9 5 10-3 6 5q15 2 13 18l-5 17-4-18-9-5-10 5-10-5-12 7-4 17Z",
  pixie: "M22 45Q13 26 33 16q15-8 30 0 18 2 16 22l-6 17-4-19-8-8q-14 5-25 2l-8 14-2 12Z",
  curtain: "M22 44Q15 22 36 15q15-7 27 0 17 2 17 21l-5 17-4-18q-3-10-18-14-5 11-22 14l-4 19Z",
  "slicked-back": "M22 45Q16 25 35 17q16-8 31 1 15 4 13 23l-5 13-3-20q-22-15-41 2l-4 18Z",
  bob: "M22 44Q17 22 37 16q15-7 28 1 15 6 14 25l-4 18-4-21q-1-11-16-16-17 3-24 15l-4 23Z",
  long: "M22 45Q17 24 36 16q15-8 29 1 15 4 14 24l-4 18-4-22q-1-11-17-15-15 3-23 16l-4 22Z",
  wavy: "M22 45Q16 26 36 16q14-7 29 1 16 4 14 25l-4 18-4-21q0-11-17-17-15 4-23 16l-4 23Z",
  curly: "M22 46q-8-7-3-16-3-10 8-12 2-11 13-6 8-7 17-1 12-3 17 7 11 3 7 14 5 8-5 18l-5-15q-2-10-16-13-6 9-23 12l-5 20Z",
  updo: "M23 44Q17 23 36 16q15-8 29 1 15 6 14 24l-5 16-4-22q-22-16-39 2l-4 19Z",
  braids: "M23 44Q17 24 36 16q15-8 29 1 15 6 14 24l-5 16-4-22q-22-16-39 2l-4 19Z",
  ponytail: "M23 44Q17 23 36 16q15-8 29 1 15 6 14 24l-5 16-4-22q-22-16-39 2l-4 19Z",
};

function Fringe({ c }: { c: AnimeCharacter }) {
  const fringe = artistStyling(c).fringe;
  const outline = fringe === "full" ? "M25 32Q49 16 75 32l-2 7q-4 2-8 0-4 2-8 0-4 2-8 0-4 2-8 0-4 2-8 0l-6 1Z"
    : fringe === "wispy" ? "M25 32Q49 16 75 32l-2 8-6-4-4 4-5-5-5 7-4-6-6 5-4-5-7 6-3-6-5 7Z"
    : fringe === "curtain" ? "M25 34Q30 18 50 18q20 0 25 16l-3 13-7-14-8-9-4 17-4-17q-4 13-16 18l-9 8Z"
    : fringe === "side" ? "M23 34Q33 15 58 20l10 7q-7 10-25 12l-7 8-1-9-12 12Z" : "";
  return outline ? <path d={outline} fill={c.hair} stroke="none"/> : null;
}

function CatalogHair({ c, front }: { c: AnimeCharacter; front: boolean }) {
  const detail = artistStyling(c), style = detail.hairStyle || "short";
  const color = detail.gender === "feminine" ? "#59414a" : ink;
  return <g className={front ? "anime-hair-front" : "anime-hair-back"} transform={detail.part === "right" ? "translate(100 0) scale(-1 1)" : undefined} fill={c.hair} stroke={color} strokeWidth="1.15" strokeLinejoin="round">
    {!front && style === "updo" && <><path d="M36 21q-9-3-5-10 3-6 11-4 10-4 14 4 5 8-3 12Z"/><path d="M37 12q8-4 12 4" fill="none" stroke="#b29891" strokeWidth=".65" opacity=".6"/></>}
    {!front && <path d="M21 48Q15 23 35 13Q50 5 65 14Q84 23 79 49L73 46Q71 31 61 25Q50 19 39 25Q28 31 27 46Z" stroke="none"/>}
    <path d={!front && style === "curly" && detail.gender === "masculine" ? "M23 28q-8 6-5 16-4 9 3 16l9 8h40l10-11q4-9-1-17 2-12-10-15Z" : (front ? catalogFrontHair : catalogBackHair)[style]}/>
    {front && <Fringe c={c}/>}
    {front && style === "slicked-back" && <path d="M23 37Q31 20 49 18q12 0 22 8-10 0-17 7-11-5-22 5l-7 11Z" stroke="none"/>}
    {front && (!detail.fringe || detail.fringe === "none") && detail.gender === "feminine" && <path d="M23 45Q23 30 42 25Q31 35 28 52l-2 9Zm54 0Q77 30 58 25q11 10 14 27l2 9Z" fill={c.hair} stroke="none"/>}
    {front && <path d={style === "curly" ? "M24 29q-3-7 6-8m4-4q1-5 8-2m5-1q7-4 11 3m7 1q8 0 10 8" : "M27 30q2-12 17-14m15 1q12 3 15 16"} fill="none" stroke="#d4bdad" strokeWidth=".65" opacity=".33"/>}
    {!front && style === "braids" && <path d="m23 74 3 2m-3 3 3 2m-3 3 3 2m-3 3 3 2m46-14 3-2m-3 7 3-2m-3 7 3-2m-3 7 3-2" fill="none" stroke="#d0aea0" strokeWidth=".65" opacity=".5"/>}
  </g>;
}

/** The four JUMP silhouettes use continuous crowns and fitted face framing. */
function JumpHair({ c, front }: { c: AnimeCharacter; front: boolean }) {
  const rose = c.id === "kpop-rose", lisa = c.id === "kpop-lisa", jennie = c.id === "kpop-jennie";
  const back = rose
    ? "M23 29Q16 29 17 39q-6 6-2 13-5 7 0 14-5 9 3 14 2 7 10 3l6-15h32l6 15q9 4 12-4 7-5 2-13 5-9 0-15 4-8-2-13 0-9-8-11Q50 12 23 29Z"
    : lisa ? "M20 31Q13 42 17 64l1 27q8 6 16 2l3-24h26l3 24q9 4 17-3l1-29q3-20-6-31Q50 14 20 31Z"
    : jennie ? "M20 30Q11 41 16 63l-1 22 7 9 9-4 5-22h28l4 23 10 3 8-9-3-25q4-20-7-31Q50 12 20 30Z"
    : "M20 30Q11 44 15 66l2 24q7 8 16 2l4-24h26l4 24q9 6 16-2l2-26q2-22-9-35Q50 12 20 30Z";
  const crown = rose
    ? "M18 47q-5-9 0-17-1-10 10-12 5-10 16-5 8-6 16-1 12-2 16 8 10 4 7 15 4 9-2 17l-5 7-3-15q-3-12-20-19-16-1-24 13l-6 20Z"
    : lisa ? "M17 46Q13 14 49 13q37 0 35 33l-4 18-4-20-2-9q-4 4-8 2-4 3-8 0-4 3-8 0-4 3-8 0-4 3-8 0-4 2-8-1l-2 8-3 20Z"
    : jennie ? "M17 46Q12 18 43 14q23-5 35 13 8 9 5 23l-4 15-4-21q-2-13-18-20-5 11-25 17l-7 16-3 10Z"
    : "M17 46Q13 14 49 13q37-1 35 33l-4 19-4-20q-3-13-26-20-22 4-26 20l-3 20Z";
  return <g className={front ? "anime-hair-front" : "anime-hair-back"} fill={c.hair} stroke={rose ? "#8e806c" : "#39303a"} strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round">
    <path d={front ? crown : back}/>
    {front && rose && <>
      <path d="M29 31q-9 3-6 13-8 7-2 15-5 9 2 14 6 3 8-3-9-3-4-10-5-6 0-12-3-8 5-12m39-7q12 4 7 15 9 7 3 15 6 9-1 14-7 3-9-3 8-3 4-10 5-6-1-12 4-8-4-12"/>
      <path d="M24 29q2-10 13-10m9-3q7-3 13 2m8 4q8 2 9 10M24 47q-5 7 0 12m51-13q6 7 0 13" fill="none" stroke="#fff7e5" strokeWidth="1.2"/>
    </>}
    {front && !rose && <path d={lisa ? "M23 30q8-13 25-13m9 0q17 4 21 17m-44-9v9m9-12v12m9-12v12m9-11v11m9-8v8" : jennie ? "M23 32q5-16 26-14m9 1q17 7 20 23m-45-9q11-3 17-12" : "M23 32q4-15 22-14m12 0q18 5 21 21m-54 9-3 27m56-27 3 27"} fill="none" stroke={lisa ? "#9a8066" : "#77717c"} strokeWidth=".7" opacity=".55"/>}
    {!front && !rose && <path d="M21 60q-2 16 2 27m55-28q3 16-1 28" fill="none" stroke={lisa ? "#a08872" : "#6d626e"} strokeWidth=".7" opacity=".45"/>}
  </g>;
}

function Hair({ c, front = false }: { c: AnimeCharacter; front?: boolean }) {
  if (c.series === "BLACKPINK") return <JumpHair c={c} front={front}/>;
  if (!frontHair[c.id]) return <CatalogHair c={c} front={front}/>;
  return <g className={front ? "anime-hair-front" : "anime-hair-back"} fill={c.hair} stroke={c.series === "BLACKPINK" ? "#493944" : ink} strokeWidth={c.series === "BLACKPINK" ? 1.2 : 1.4} strokeLinejoin="round">
    <path d={(front ? frontHair : backHair)[c.id]}/>
    {front && <Fringe c={c}/>}
    {!front && c.id === "kpop-rose" && <path d="M22 52q-2 8 2 16t3 12m46-28q2 8-2 16t-3 12" fill="none" stroke="#f5e3b4" strokeWidth=".65" opacity=".55"/>}
    {front && <g fill="none" stroke={c.id === "kpop-rose" ? "#f5e3b4" : c.id === "kpop-jhope" ? "#d0d0df" : "#73717d"} strokeWidth=".65" opacity=".5">
      {c.id === "kpop-jisoo" && <path d="M26 32q4-12 19-15m-16 8q1-10 19-10m24 17Q67 21 54 17"/>}
      {c.id === "kpop-jennie" && <path d="M27 33q0-12 13-17m-7 12q2-9 11-13m19 2q10 4 11 16m-15-16q8 5 10 14M46 17l-1 4m10-5 4 5"/>}
      {c.id === "kpop-rose" && <path d="M26 38q0-17 20-21m28 23q0-16-18-21"/>}
      {c.id === "kpop-lisa" && <path d="M28 31q1-10 18-10m27 11Q70 23 56 21m-20 4v8m7-10v10m6-10 1 11m7-10v9m7-8 1 9"/>}
      {c.id === "kpop-rm" && <path d="m29 24 7-8m1 10 7-11m1 9 7-10m1 10 9-10m0 12 10-8"/>}
      {c.id === "kpop-jin" && <path d="M26 33q1-16 27-19m-20 9q6-8 23-8m3 0q17 5 17 23"/>}
      {c.id === "kpop-suga" && <path d="M25 38q2-19 22-23m-15 18Q37 19 51 17m8-3q16 4 17 20"/>}
      {c.id === "kpop-jhope" && <path d="M26 20q17 10 45-4M30 16q21 7 36-2m7 9 5 6M25 30l1 9"/>}
      {c.id === "kpop-jimin" && <path d="M25 32q1-15 24-17m-16 9 13-8m10-1q19 7 20 24"/>}
      {c.id === "kpop-v" && <path d="M24 27q-5-8 5-8m2-2q-3-9 9-6m5-1q9-6 13 3m6 0q12-2 13 10M32 29q12-7 14-14m24 9q9 3 7 13"/>}
      {c.id === "kpop-jungkook" && <path d="M25 35q0-15 20-20m-14 18q7-14 15-15m12-2q16 1 18 17m-5 7 3-10"/>}
    </g>}
    {front && c.id === "kpop-rm" && <path d="m21 35 10-1m-10 5 9-1" fill="none" stroke="#b3a2a5" strokeWidth="1.6"/>}
    {front && c.id === "kpop-jisoo" && <g strokeLinecap="round">
      <path d="M26 36Q23 48 24 64l-2.5-.5 1-17Q24 39 28 34Z" fill={c.hair} stroke="#493944" strokeWidth="1.1"/>
      <path d="M74 36Q77 48 76 64l2.5-.5-1-17Q76 39 72 34Z" fill={c.hair} stroke="#493944" strokeWidth="1.1"/>
      <path d="m27 24 6-3m6-2 6-1m6 0 6 1m6 2 6 3" fill="none" stroke="#544c60" strokeWidth="1.2" opacity=".55"/>
    </g>}
    {front && c.id === "kpop-jennie" && <g strokeLinecap="round">
      <path d="M36 34Q31 48 29 65l-2.5-.5 2-17Q32 38 37 32Z" fill={c.hair} stroke="#493944" strokeWidth="1.1"/>
      <path d="M64 34Q69 48 71 65l2.5-.5-2-17Q68 38 63 32Z" fill={c.hair} stroke="#493944" strokeWidth="1.1"/>
      <path d="m28 25 6-3m7-2 6-1m6 0 6 1m6 2 6 3" fill="none" stroke="#544c60" strokeWidth="1.2" opacity=".5"/>
    </g>}
    {front && c.id === "kpop-rose" && <g fill="none" strokeLinecap="round">
      <path d="M22 46q-3 6 1 12m56-18q3 6-1 12m-46-21q6-8 16-5m12 0q10-3 16 5" stroke="#fffcf2" strokeWidth="1" opacity=".7"/>
      <path d="M25 50q-2 7 1 12m50-18q2 7-1 12" stroke="#8a7350" strokeWidth=".8" opacity=".5"/>
    </g>}
    {front && c.id === "kpop-lisa" && <g strokeLinecap="round">
      <path d="M24 40q-2 11 0 24l-2.5-.5q-2-11 0-24Z" fill={c.hair} stroke="#493944" strokeWidth="1.1"/>
      <path d="M76 40q2 11 0 24l2.5-.5q2-11 0-24Z" fill={c.hair} stroke="#493944" strokeWidth="1.1"/>
      <path d="m27 24 6-3m7-2 6-1m6 0 6 1m6 2 6 3" fill="none" stroke="#8e7667" strokeWidth="1.1" opacity=".5"/>
    </g>}
  </g>;
}

function ChibiBody({ c, skin, fabricId }: { c: AnimeCharacter; skin: string; fabricId: string }) {
  const detail = artistStyling(c), bp = c.series === "BLACKPINK";
  const feminine = bp || detail.gender === "feminine";
  const jisoo = c.id === "kpop-jisoo", lisa = c.id === "kpop-lisa", rose = c.id === "kpop-rose", jennie = c.id === "kpop-jennie";
  const dress = !bp && feminine && detail.outfitStyle === "dress";
  const trousers = !feminine || jisoo || lisa;
  const shortSleeves = bp || detail.outfitStyle === "casual" || dress;
  const bottom = trousers ? "#292730" : "#37313d";
  const outfitFill = `url(#${fabricId})`;
  return <g strokeLinecap="round" strokeLinejoin="round">
    <path d={lisa ? "M39 97h10l-1 25H35l4-25Zm13 0h9l5 25H53Z" : "M40 98h9l-1 25h-9Zm12 0h9l1 25h-9Z"} fill={trousers ? bottom : skin} stroke={trousers ? "#24212b" : "#bc9384"} strokeWidth=".9"/>
    {!trousers && <path d="M39 115h9v9h-9Zm14 0h9v9h-9Z" fill={rose ? "#f2eff2" : "#25222a"} stroke={rose ? "#aaa4af" : "#25222a"} strokeWidth=".7"/>}
    <path d="M39 122q-5 1-5 5 4 3 14 1v-6Zm14 0v6q10 2 14-1 0-4-5-5Z" fill={rose ? "#f6f3f5" : "#24212a"} stroke={rose ? "#8d8793" : "#19171f"} strokeWidth=".9"/>
    <path d="M35 127h12m7 0h12" stroke={rose ? "#c4beca" : "#625969"} strokeWidth=".6"/>
    {rose && <path d="m40 123 5 1m-5 1 5 1m10-3 5 1m-5 1 5 1" stroke="#b5adbb" strokeWidth=".65"/>}
    <path d="M41 80q-9 1-11 10l3 12 5-1-1-11 7-5Zm18 0q9 1 11 10l-3 12-5-1 1-11-7-5Z" fill={outfitFill} stroke={ink} strokeWidth="1"/>
    {shortSleeves && <>
      <path d={jisoo ? "M31 89q-1 8 5 13l4-3q-5-4-5-10Z" : "M31 89q-1 8 3 14l4-2-3-12Z"} fill={jisoo ? "#e9bb43" : skin} stroke={jisoo ? "#ab8229" : "#bc9384"} strokeWidth=".8"/>
      <path d={bp ? "m66 89 3 2-4 12-5-2 5-5Z" : "M65 89q4 7 0 14l-4-2 3-12Z"} fill={skin} stroke="#bc9384" strokeWidth=".8"/>
    </>}
    <ellipse cx={jisoo ? 39 : 35} cy={jisoo ? 100 : 103} rx="2.3" ry="2.8" fill={skin} stroke="#bc9384" strokeWidth=".7"/>
    <ellipse cx={bp ? 62 : 65} cy="102" rx="2.3" ry="2.8" fill={skin} stroke="#bc9384" strokeWidth=".7"/>
    {feminine && !jisoo && !lisa && <>
      <path d={dress ? "M39 97h22l8 15q-19 5-38 0Z" : "M38 97h24l4 11q-16 4-32 0Z"} fill={dress ? outfitFill : bottom} stroke={ink} strokeWidth="1"/>
      <path d={dress ? "m40 102-3 9m9-9-1 11m9-11 1 11m5-11 3 9" : "m41 100-2 7m9-7v9m8-9 2 7"} fill="none" stroke={dress ? "#ffffff" : "#6f626e"} strokeOpacity=".35" strokeWidth=".7"/>
    </>}
    <Outfit c={c} skin={skin} fabricId={fabricId} shortSleeves={shortSleeves}/>
    {bp && <>
      <text x="50" y="88" textAnchor="middle" fontFamily="Arial Black, sans-serif" fontStyle="italic" fontWeight="900" fontSize="4.5" fill="#fff" letterSpacing=".05">JUMP!</text>
      <path d="M38 98h24" fill="none" stroke="#b6a3a0" strokeWidth=".6"/>
      {(jisoo || jennie) && <><rect x="41" y="98" width="3" height="2" rx=".4" fill="none" stroke="#c9c5cc" strokeWidth=".7"/><path d="M57 99v10h2V99" fill="#1c1a23" stroke="#8c838f" strokeWidth=".5"/></>}
      {rose && <circle cx="57" cy="99" r=".9" fill="#d4b76c"/>}
      {lisa && <g stroke="#e6dfe8" strokeWidth=".55" fill="none"><path d="M54 99q4 6 9 0m-21 7 3 2m11 3 3-1m-18 7 3-1m15 3 3-1"/>{[[43,103],[57,106],[41,113],[58,116],[45,120],[60,121]].map(([x,y]) => <path key={`${x}-${y}`} d={`M${x-1} ${y}h2m-1-1v2`}/>)}</g>}
    </>}
    {!bp && trousers && <path d="M38 101h24m-12 0v6" fill="none" stroke="#786979" strokeWidth=".6"/>}
  </g>;
}

function Outfit({ c, skin, fabricId, shortSleeves }: { c: AnimeCharacter; skin: string; fabricId: string; shortSleeves: boolean }) {
  const bp = c.series === "BLACKPINK", detail = artistStyling(c);
  const rose = c.id === "kpop-rose";
  const fabric = `url(#${fabricId})`;
  const seam = shadeHex(c.outfit, -.22);
  const topShape = shortSleeves
    ? bp
      ? "M42 78q-5-1-8 2l-4 6q-1 3 3 5l4-2 1-4 1 12q11 3 22 0l1-12 1 4 4 2q4-2 3-5l-4-6q-3-3-8-2l-5-2q-5 5-10 0Z"
      : "M42 78q-5-1-8 2l-4 7q-1 3 3 5l4-2 1-4 1 14q11 4 22 0l1-14 1 4 4 2q4-2 3-5l-4-7q-3-3-8-2l-5-2q-5 5-10 0Z"
    : bp
      ? "M42 78q-6 1-8 6l-3 10q0 3 4 4 15 3 30 0 4-1 4-4l-3-10q-2-5-8-6l-5-2q-5 5-10 0Z"
      : "M42 78q-7 1-9 7l-3 13q0 4 4 5 16 4 32 0 4-1 4-5l-3-13q-2-6-9-7l-5-2q-5 5-10 0Z";
  return <g strokeLinejoin="round">
    <path d={topShape} fill={fabric} stroke={ink} strokeWidth="1"/>
    {shortSleeves && <path d="M32 88q3 2 6 .5m24-.5q3 1.5 6-.5" fill="none" stroke={seam} strokeWidth=".65" strokeLinecap="round"/>}
    <path d="M44 73v7q6 5 12 0v-7" fill={skin} stroke="#bc9384" strokeWidth=".8"/>
    {rose ? <path d="M38 81q11 8 24 1" fill="none" stroke="#dedde5" strokeWidth="2.2"/> : <path d="M43 80q7 6 14 0" fill="none" stroke={bp ? "#78717d" : "#ded6d1"} strokeWidth=".85"/>}
    <path d={bp ? "M36 94q14 2 28 0m-22-11 3 2m15-2-3 2" : "M35 100q15 3 30 0m-24-16 3 2m15-2-3 2"} fill="none" stroke={seam} strokeOpacity=".55" strokeWidth=".6"/>
    <path d={bp ? "M37 87q2 4 1 7m25-7q-2 4-1 7" : "M36 90q2 4 1 7m27-7q-2 4-1 7"} fill="none" stroke="#fff8ee" strokeOpacity=".22" strokeWidth=".65"/>
    {!bp && (detail.outfitStyle === "suit" || detail.outfitStyle === "coat") && <>
      <path d="m41 81 7 7-6 8-5-11m22-4-7 7 6 8 5-11" fill="#ece6e2" stroke="#b9afb8" strokeWidth=".5"/>
      <path d="m48 84 2 2 2-2-1 14h-2Z" fill="#746078"/>
      <path d="M50 99v4m8-9h5" stroke="#8a7c90" strokeWidth=".65"/>
    </>}
    {!bp && detail.outfitStyle === "cardigan" && <>
      <path d="m41 81 9 8 9-8m-9 8v14" fill="none" stroke="#f2e9df" strokeWidth="1.1"/>
      {[92,97,101].map(y => <circle key={y} cx="51.5" cy={y} r=".55" fill="#927782"/>)}
    </>}
    {!bp && detail.outfitStyle === "dress" && <path d="M39 98q11 3 22 0m-11 0-3-2v4l3-2 3-2v4Z" fill="none" stroke="#e5cfd6" strokeWidth=".8"/>}
    <path d="m38 90 1 4m23-4-1 4" stroke="#ffffff" strokeOpacity=".15" strokeWidth=".65"/>
  </g>;
}

/** Human artist portraits retain individual features and the site's transparent SVG animation rig. */
export default function KpopAvatar({ character: c, className = "", label, hoverLine = true }: {
  character: AnimeCharacter; className?: string; label?: string; hoverLine?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const p = c.series === "BLACKPINK" ? portraits[c.id] || chibiPortrait(c) : chibiPortrait(c);
  const skin = "skin" in c && typeof c.skin === "string" ? c.skin : "#f0d0ba";
  const bp = c.series === "BLACKPINK";
  const outfitColor = typeof c.outfit === "string" ? c.outfit : "#657080";
  const fabricId = `idol-fabric-${uid}`;
  return <svg className={`ds-avatar anime-avatar motion-avatar kpop-avatar ${className}`} style={characterMotionStyle(c.id)} data-character={c.id} data-transparent="true" data-animated="true" viewBox="0 0 100 132" xmlns="http://www.w3.org/2000/svg" role={label ? "img" : undefined} aria-label={label} aria-hidden={!label || undefined}>
    {hoverLine && <title>{`${c.name} · ${c.series}\n${animeCompanionBubble(c.id, 1)?.text || ""}`}</title>}
    <defs><linearGradient id={fabricId} x1="0" y1="0" x2="1" y2="0"><stop stopColor={shadeHex(outfitColor, .13)}/><stop offset=".48" stopColor={outfitColor}/><stop offset="1" stopColor={shadeHex(outfitColor, -.16)}/></linearGradient></defs>
    {bp && <defs><radialGradient id={`idol-face-light-${uid}`} cx="35%" cy="30%" r="75%"><stop stopColor="#fff8ee" stopOpacity=".3"/><stop offset="1" stopColor="#fff8ee" stopOpacity="0"/></radialGradient></defs>}
    <Hair c={c}/>
    <ChibiBody c={c} skin={skin} fabricId={fabricId}/>
    <ellipse cx="18" cy="52" rx="3.6" ry="5.5" fill={skin} stroke="#ba9380" strokeWidth="1"/><ellipse cx="82" cy="52" rx="3.6" ry="5.5" fill={skin} stroke="#ba9380" strokeWidth="1"/>
    <path d={p.jaw} fill={skin} stroke={bp ? "#72515d" : ink} strokeWidth={bp ? 1.1 : 1.4}/>
    {bp ? <path d={p.jaw} fill={`url(#idol-face-light-${uid})`}/> : <path d="M25 55q2 13 14 17m36-17q-2 13-14 17" fill="none" stroke="#d6ab96" opacity=".25" strokeWidth="2"/>}
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
