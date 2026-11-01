"use client";

import { useId } from "react";
import type { AnimeCharacter } from "../community/anime-companions";
import AnimeFace, { AnimeMouth, faceDesign, faceOutline } from "./AnimeFace";

type Visual = AnimeCharacter;
const ink = "#342d3d";
const cream = "#fff8e8";
const gold = "#e8bb58";

function tint(hex: string, amount: number) {
  const parts = hex.replace("#", "").match(/.{2}/g) || ["88", "88", "88"];
  return "#" + parts.map((part) => {
    const value = parseInt(part, 16);
    return Math.round(value + (amount > 0 ? 255 - value : value) * amount).toString(16).padStart(2, "0");
  }).join("");
}

function Flower({ x, y, color = "#c84d68", size = 1 }: { x: number; y: number; color?: string; size?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${size})`} fill={color}>
    {[0, 60, 120, 180, 240, 300].map((angle) => <ellipse key={angle} cy="-3.5" rx="2.6" ry="4" transform={`rotate(${angle})`}/>)}
    <circle r="2.3" fill={gold}/>
  </g>;
}

function Bow({ x, y, color = ink, size = 1 }: { x: number; y: number; color?: string; size?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${size})`} fill={color} stroke={tint(color, -.2)} strokeWidth=".7" strokeLinejoin="round">
    <path d="M0 0C-5-7-11-7-10 0s5 7 10 0M0 0C5-7 11-7 10 0s-5 7-10 0"/>
    <path d="m-2 1-4 10 6-4 5 4-3-10"/><ellipse rx="2.8" ry="3.1"/>
  </g>;
}

function HairBack({ c }: { c: Visual }) {
  const h = c.hair, dark = ink;
  if (c.id === "anime-mitsueda") return <g fill={h} stroke={dark} strokeWidth="1"><path d="M24 32q-8 20 2 49l7-13-2-29m45-7q8 20-2 49l-7-13 2-29"/><path d="m26 48 2 20m46-20-2 20" stroke={tint(h,.2)} fill="none"/></g>;
  switch (c.style) {
    case "long": return <g fill={h} stroke={dark} strokeWidth="1.2">
      <path d={c.id === "anime-nami" || c.id === "anime-orihime"
        ? "M24 30C15 42 22 54 17 67q-9 13 7 22l-3-9q15 11 20-3h20q5 14 19 4l-3 9q18-8 6-23c-7-9 0-28-8-38Z"
        : "M23 30Q13 50 18 86q9-3 16 0l7-17h20l7 17q8-4 15 0l-3-45-8-17Z"}/>
      <path d="M24 43q-3 23 2 34m51-34q3 23-2 34" fill="none" stroke={ink} strokeWidth=".9" opacity=".32"/>
    </g>;
    case "twintails": return <g fill={h} stroke={dark} strokeWidth="1.1">
      <path d={c.id === "anime-mary" ? "M26 31Q7 34 14 63L8 78q22-1 24-24M74 31q19 3 12 32l6 15q-22-1-24-24" : "M26 27Q5 20 9 50L5 73q22-9 26-36M74 27q21-7 17 23l4 23q-22-9-26-36"}/>
      <path d="M18 34q-5 18-3 26m67-26q5 18 3 26" fill="none" stroke={ink} strokeWidth=".9" opacity=".32"/>
    </g>;
    case "ponytail": return <g fill={h} stroke={dark} strokeWidth="1.2">
      <path d={c.id === "anime-shion" ? "M64 18q30-8 23 26l5 36q-17-4-18-22L61 32Z" : "M66 17q26-7 22 16l-9 15 8 32q-20-9-17-33L61 29Z"}/><path d="m78 31-3 21 5 15" fill="none" stroke={ink} strokeWidth=".9" opacity=".32"/>
    </g>;
    case "braid": return <g fill={h} stroke={dark} strokeWidth="1.1">{[0,1,2,3,4,5].map((i) => <ellipse key={i} cx={76+(i%2 ? 1 : -1)} cy={43+i*7} rx="5.5" ry="5" transform={`rotate(${i%2 ? 25 : -25} 76 ${43+i*7})`}/>)}<path d="m73 82 2 9 5-8"/></g>;
    case "braids": return <g fill={h} stroke={dark} strokeWidth="1.1">{[24,76].map(x=><g key={x}>{[0,1,2,3,4].map(i=><ellipse key={i} cx={x+(i%2 ? 1 : -1)} cy={39+i*7} rx="5.5" ry="5"/>)}<Bow x={x} y={74} color="#647592" size={.55}/></g>)}</g>;
    case "bun": return <g fill={h} stroke={dark} strokeWidth="1.2"><circle cx="50" cy="16" r="14"/><path d="M23 34q-5 15 2 31l8-5h35l8 4q7-23-3-35"/></g>;
    case "tied": return <g fill={h} stroke={dark} strokeWidth="1.1"><path d="M30 33Q17 46 30 71h40q13-25 0-38"/><ellipse cx="75" cy="30" rx="10" ry="8"/></g>;
    case "updo": return <g fill={h} stroke={dark} strokeWidth="1.2"><ellipse cx="50" cy="21" rx="31" ry="16"/><circle cx="34" cy="14" r="11"/><circle cx="65" cy="14" r="10"/><path d="M24 34q-6 20 5 34l6-10h30l6 10q9-18 5-34"/></g>;
    case "side-bob": case "bob": case "curtains": return <path d="M24 28Q14 44 23 68l13-7h30l13 7q9-25-4-42Z" fill={h} stroke={dark} strokeWidth="1.2"/>;
    default: return <path d="m25 26-7 15 5 21 12-9h32l10 9 5-24-9-13Z" fill={h}/>;
  }
}

const spikyHair: Record<string, string> = {
  "anime-asta": "M21 36 12 25l14 1-6-16 18 10 1-14 12 14L63 7l3 15 15-10-5 17 12-1-10 17-13-13-8 7-10-11-8 10-8-7-10 9Z",
  "anime-yuno": "M20 40 14 23l15 1-2-13 15 8L53 7l6 12 16-5-1 14 12 5-8 17-13-20-10 14-4-10-14 11-2-14Z",
  "anime-ichigo": "M21 39 12 32l12-8-3-12 17 8L45 7l11 11L68 8l3 16 13 1-6 13 9 6-16 3-7-14-6 7-9-12-6 12-9-9-7 15Z",
  "anime-toshiro": "M19 40 9 30l14-4-4-14 18 9L45 5l11 15L70 8l2 17 15 3-10 12 9 8-16-2-10-15-7 11-7-11-8 13-8-8-5 13Z",
  "anime-bakugo": "M20 42 8 36l9-9-8-9 18 2-4-15 17 13 9-16 8 16L73 6l-1 16 17-3-8 12 12 6-16 6-5 9-9-18-6 9-7-12-7 12-8-11-7 19Z",
  "anime-naruto": "M20 41 11 30l12-6-4-12 17 5L43 5l11 13L67 7l3 15 13-2-5 14 9 6-15 8-9-15-11 8-10-10-9 12-8-7Z",
  "anime-sasuke": "M21 47 9 38l12-7-4-15 16 5L44 7l12 12 16-4-2 13 14 7-5 24-13-27-7 26-8-17-6 13-7-22-13 24Z",
  "anime-kakashi": "M20 38 11 31l14-7-3-11 17 4L47 5l8 11L70 4l-1 14 14-5-5 15 12 3-15 13-12-14-11 13-9-13-11 14-4-7Z",
  "anime-gojo": "M19 43 10 34l12-7-5-12 17 6L41 7l12 13L68 6l2 14 15-8-4 17 10 6-13 14-13-11-8 7-8-13-7 12-9-8-8 12Z",
  "anime-megumi": "M19 43 7 31l17-1-6-19 19 11 6-20 12 19L73 5l-2 19 19-7-9 16 13 7-17 9-11-18-9 14-7-16-9 18-9-12-6 18Z",
};

function HairFront({ c }: { c: Visual }) {
  const h = c.hair, edge = ink;
  let path = "";
  switch(c.style) {
    case "spiky": path = spikyHair[c.id] || "M20 41 12 28l15-6 4-12 14 9L58 9l8 15 17 3-5 20-12-15-10 12-10-13-10 11-6-12Z"; break;
    case "messy": path = c.id === "anime-shinpei"
      ? "M21 44 15 34l7-10-2-11 15 5L47 9l8 7 15-4 2 12 11 6-8 25-10-21-10 26-6-24-10 13-6-16-6 25Z"
      : c.id === "anime-deku"
      ? "M21 45 11 38l10-9-4-12 15 2 8-13 12 9L64 8l6 12 16 1-6 12 10 7-13 12-13-16-8 10-10-13-9 13-9-9-7 15Z"
      : c.id === "anime-killua" ? "M20 43 10 34l13-7-4-11 15 3L44 7l11 11L69 9l1 13 15 3-8 13 10 6-16 6-8-14-8 10-10-13-9 12-9-8-7 16Z"
        : "M21 43 16 31q-5-11 10-10-2-12 13-8 9-15 20-3 15-6 15 8 15-2 11 12l-8 17-11-15-9 11-8-12-10 11-7-10-6 16Z"; break;
    case "bob": path = ["anime-armin","anime-hinata","anime-kurapika"].includes(c.id)
      ? "M22 43Q17 15 49 14q35-1 30 33l-9 14-1-28-8 7-1-7-10 7-1-7-11 7-8-7-1 28Z"
      : c.id === "anime-rukia" ? "M22 48Q13 15 49 12q37-1 29 43l-11 9 3-30-9 10-8-12-7 25-6-21-10 7-1 21Z"
        : "M22 44Q16 15 47 13q34-4 33 29l-6 20-8-8 5-22-11 10-13-14-7 13-10-6 1 26-8 5Z"; break;
    case "side-bob": path = c.id === "anime-sanji"
      ? "M22 45Q16 14 49 12q35 0 31 32l-13-6-10-8-5 26-19-9 1-15Z"
      : c.id === "anime-touka" ? "M22 45Q18 12 52 12q33 2 27 40l-8 15-17-2 4-25-9-10-18 12-2 19Z"
      : "M22 45Q18 12 52 12q33 2 27 40L65 39l-15 20-8-27-11 10-2 19Z"; break;
    case "long": path = c.id === "anime-satoko" ? "M22 46Q16 12 50 12q34 0 28 34l-7 13-3-27-10-5-8-8-8 11-11 8-3 22Z"
      : ["anime-yumeko","anime-ririka","anime-hinata","anime-osaragi"].includes(c.id)
      ? "M22 46Q15 12 50 12q35 0 28 34l-7 11-1-23-8 6-2-7-10 7-1-7-12 7-7-6-1 23Z"
      : c.id === "anime-shin-ah" ? "M21 44Q14 14 48 12q32-4 33 31l-6 20-4-28-9 6-8-12-8 12-9-6-8 27-6 5Z"
        : "M22 47Q14 14 47 12q36-4 33 31l-8 22-5-25-9-14-9 14-7-10-11 14-3 20Z"; break;
    case "twintails": path = "M22 43Q19 13 49 13q30-2 29 31l-10-13-8 12-10-15-10 14-9-12Z"; break;
    case "ponytail": path = c.id === "anime-renji" ? "M21 38Q19 12 50 12q32 0 28 28l-13-11-10 6-9-12-13 13Z" : "M21 45Q15 16 45 12q34-6 35 26l-11 13-3-22-10 13-8-12-15 14-3-10-4 22Z"; break;
    case "braids": path = "M22 45Q17 12 49 12q32 0 29 34l-10-12-10 6-8-12-9 12-10-6Z"; break;
    case "braid": path = "M34 32Q31 13 50 12q20 0 17 20l-9-8-8-7-8 8Z"; break;
    case "undercut": path = c.id === "anime-levi" ? "M22 39Q17 16 48 13q34-2 31 25l-12-8-11 16-4-20-16 17-3-14Z" : "M22 42Q16 15 49 13q34-3 31 29l-13-13-9 14-6-15-14 15-3-13Z"; break;
    case "swept": path = c.id === "anime-mitsueda" ? "M22 43Q13 12 50 11q37 1 28 33l-10-9-6-14-12 6-12-6-7 15Z"
      : c.id === "anime-kotaro" ? "M22 42 16 30l9-7-2-11 15 6L48 8l10 9 15-4-1 11 10 7-7 15-10-13-11 11-7-15-12 13-3-12Z"
        : c.id === "anime-hisoka" ? "M21 39Q12 17 37 19L46 2q6 12 17 10 20-1 17 24l-11 3-5-15-10 15-13-12-7 15Z" : "M22 43Q12 20 39 14q30-13 40 15l2 15-14-8-8-16-11 17-13 7-1-13Z"; break;
    case "pompadour": path = "M22 42Q13 24 25 13 40-1 65 9q20 7 14 29l-11-4-4-13q-12 13-30 10l-4 14Z"; break;
    case "curtains": path = "M22 45Q14 15 49 12q35-1 30 34l-11 13-3-27-14-11-10 21-11 7 1 11Z"; break;
    case "cropped": path = c.id === "anime-zoro" ? "M23 38 20 26l9-2 2-8 10 3 9-8 9 7 10-2 4 9 7 2-3 14-11-10-6 8-10-9-9 8-8-7Z" : "M22 40 17 29l9-5 2-10 14 4 9-8 9 8 13-2 3 10 8 6-7 10-10-9-9 8-9-11-9 11-8-9Z"; break;
    case "tall-spikes": path = "M22 43 15 28l12 3L23 8l14 11L46 1l9 18L68 3l1 23 17-7-8 24-15-14-9 11-9-12-9 13-7-8Z"; break;
    case "hero": path = "M22 42Q14 25 29 19L22 2l18 11 10 14L62 10 81 2l-8 20q15 9 4 23L66 29l-8 11-8-9-9 10-9-11Z"; break;
    case "split": path = "M22 44Q16 13 49 12q34 0 30 33l-11-12-10 13-8-17-9 15-10-11-2 24Z"; break;
    case "bun": case "tied": case "updo": path = "M22 44Q16 17 49 15q35-1 29 30l-11-14-10 10-8-13-12 14-6-10-5 20Z"; break;
  }
  return <g stroke={edge} strokeWidth="1.8" strokeLinejoin="round">
    <path d={path} fill={h}/>
    {c.style === "split" && <path d="M50 12q31 0 29 33L68 33 58 46l-8-17Z" fill="#a83946" stroke="#8c3040"/>}
    {c.style === "undercut" && <path d="m22 36 2 15 7-16m47 0-3 16-7-17" fill={tint(h,-.5)} stroke="none"/>}
    {c.style === "braid" && <path d="m27 28 9-7m-8 13 11-8m-9 13 11-8" fill="none" stroke={tint(h,-.22)} strokeWidth="1"/>}
    {c.style === "braid" && <path d="m26 28 5-4m-7 9 5-4m-5 9 5-4m45-7-5-4m7 9-5-4" fill="none" stroke="#b9a488" strokeWidth=".8" opacity=".6"/>}
  </g>;
}

function Outfit({ c }: { c: Visual }) {
  const o = c.outfit, edge = ink;
  const kimono = c.series === "Firefly Wedding" || ["kimono","haori","blue-sash","dragon-hand","hairpins","camellia","hairpin"].includes(c.accessory);
  const school = ["school-bow","school-tie","blue-lips","white-mask"].includes(c.accessory);
  return <g strokeLinejoin="round">
    <path d="M18 103v-9q2-17 24-19h16q23 3 25 19v9" fill={o} stroke={edge} strokeWidth="1.4"/>
    <path d="M43 68v11q7 8 14 0V68" fill="#ffd4ba" stroke="#ce9982" strokeWidth=".9"/>
    <path d="m29 87-5 15m47-15 5 15" fill="none" stroke={edge} strokeWidth="1.3"/>
    {kimono ? <><path d="m35 77 17 13 12-13 6 5-19 20-20-22Z" fill={cream}/><path d="m37 77 20 17-9 9-18-23m31-3-16 18" fill={o} stroke={edge} strokeWidth="1.1"/><path d="M31 98h39v5H31Z" fill={c.accessory === "blue-sash" ? "#73afd3" : tint(o,-.35)}/></>
      : school ? <><path d="m40 76 10 8 10-8-2 27H42Z" fill="#fffbf3"/><path d="m37 77-8 7 10 5-6 4 11 10-2-19m21-7 8 7-10 5 6 4-11 10 2-19" fill="#30303e"/>{c.accessory === "school-tie" ? <path d="m50 84-4 5 4 13 4-13Z" fill={ink}/> : <Bow x={50} y={88} color="#343544" size={.75}/>}</>
        : <path d="m37 77 13 10 13-10-7 17H44Z" fill={tint(o,.35)} stroke={edge} strokeWidth="1.1"/>}
    {["gold-trim","brow-scar","dragon-temple","earring","fang"].includes(c.accessory) && c.series === "Tokyo Revengers" && <><path d="m39 77 4 26m18-26-4 26" stroke={gold} strokeWidth="1.7"/><path d="M63 87h8m-8 4h8m-8 4h8" stroke={gold} strokeWidth="1"/><circle cx="50" cy="94" r="1.2" fill={gold}/></>}
    {c.accessory === "apron" && <><path d="m33 77 6 1 1 7h20l1-7 6-1-1 26H34Z" fill="#fff0d7"/><path d="M43 91h14v8H43Z" fill="#e7cdbb"/></>}
    {c.accessory === "hero-suit" && <><path d="m29 82 21 13 21-13m-37 6 16 14 16-14" fill="none" stroke={cream} strokeWidth="5"/><path d="m23 85 13 9m41-9-13 9" stroke="#ca455b" strokeWidth="8"/><path d="m40 76 10 8 10-8" fill="none" stroke={gold} strokeWidth="3"/></>}
    {c.accessory === "hero-mask" && <><path d="m33 80 30 23m4-23-30 23" stroke="#e28a48" strokeWidth="6"/><path d="M43 97h14v6H43Z" fill="#c84b43"/></>}
    {c.accessory === "red-piping" && <><path d="m36 77 14 12 14-12M50 88v15M24 95h14m24 0h14" fill="none" stroke="#c35443" strokeWidth="2"/><circle cx="53" cy="94" r="1" fill={gold}/></>}
    {c.accessory === "chain" && <><path d="m35 79 15 10 15-10m-15 10v14" fill="none" stroke={gold} strokeWidth="2"/><path d="M72 87q10 8-2 15" fill="none" stroke={gold} strokeWidth="1.5" strokeDasharray="2 1"/></>}
    {c.accessory === "red-hood" && <><path d="M29 82q2-12 13-8l8 9 8-9q13-2 14 9l-9 9H39Z" fill="#bd4f60" stroke="#8f354b"/><path d="m38 80 12 7 12-7" fill="none" stroke="#e48e95" strokeWidth="2"/></>}
    {c.accessory === "high-collar" && <path d="m34 76 12 2 4 8 4-8 13-2-1 15-16 4-16-4Z" fill={tint(o,-.12)} stroke={edge} strokeWidth="1.2"/>}
    {c.accessory === "cloak" && <><path d="m33 75-13 14 15 14 11-18m21-10 13 14-15 14-11-18" fill="#5f7d60" stroke="#425e47"/><path d="m28 86 5-3 5 3-5 10Z" fill="#e8e6d9"/><path d="m30 87 6 5m-6-1 6-5" stroke="#7295b3" strokeWidth="1.6"/></>}
    {c.accessory === "cravat" && <><path d="m40 77 10 5 10-5-3 10-7-1-7 1Z" fill={cream}/><path d="m47 83-5 13 8-3 8 3-5-13Z" fill="#fffdf5" stroke="#d7d3d0" strokeWidth=".8"/></>}
    {c.accessory === "pendant" && <><path d="m39 78 11 12 11-12" fill="none" stroke="#b39a5b" strokeWidth="1.5"/><path d="m50 87 4 5-4 7-4-7Z" fill="#71ad7b" stroke="#426f52"/></>}
    {c.id === "anime-sanji" && <><path d="m40 77 10 10 10-10" fill="#c8deea"/><path d="m50 86-3 5 3 12 3-12Z" fill="#55556c"/></>}
    {c.id === "anime-leorio" && <><path d="m40 77 10 9 10-9" fill="#eef3f8"/><path d="m50 85-3 5 3 13 3-13Z" fill="#bc4a58"/></>}
    {c.accessory === "goggles" && <path d="m49 82-3 8 4 13 4-13-3-8" fill="#526b68"/>}
    {c.accessory === "collar-marks" && <path d="m43 76 3 5m1-7 3 7m3-7 3 5" stroke={ink} strokeWidth="1"/>}
    {c.id === "anime-mitsueda" && <path d="m32 78 15 16m21-16L53 94" stroke={gold} strokeWidth="2"/>}
    {c.accessory === "pink-earpieces" && <path d="m36 80 7 11h14l7-11-3 16H39Z" fill="#3e3549"/>}
    <ellipse cx="31" cy="97" rx="6" ry="5" fill="#ffd4ba"/><ellipse cx="69" cy="97" rx="6" ry="5" fill="#ffd4ba"/>
  </g>;
}

function LeafBand({ mask = false }: { mask?: boolean }) {
  return <g><path d={mask ? "m21 33 56-6 2 13-57 6Z" : "M22 31q28-5 56 0l-1 12H23Z"} fill="#414c65"/><rect x="34" y={mask ? 29 : 30} width="31" height="12" rx="3" fill="#c6d2da" stroke="#6a788b" strokeWidth="1" transform={mask ? "rotate(-6 50 36)" : undefined}/><path d="M48 34q-7 0-6 4 2 5 8 1l4-4-1 5h5" fill="none" stroke="#5e6b7b" strokeWidth="1.2" strokeLinecap="round"/><circle cx="37" cy="36" r=".8" fill="#647387"/><circle cx="62" cy="36" r=".8" fill="#647387"/></g>;
}

function Accessories({ c }: { c: Visual }) {
  const a = c.accessory;
  switch (a) {
    case "headband": return <><path d="M22 31q27-5 55-1l-2 11q-26-4-51 1Z" fill="#34333f"/><path d="m67 30-3 4 2 5 5-2 2-5-4 1Z" fill="#cf5663"/><path d="m25 35-11 8 4-11" fill="#34333f"/></>;
    case "ribbon": return <><Bow x={22} y={30} color="#5d4d77" size={.7}/><Bow x={78} y={30} color="#5d4d77" size={.7}/></>;
    case "ribbons": return <><Bow x={22} y={25} color="#3e425e" size={.7}/><Bow x={78} y={25} color="#3e425e" size={.7}/></>;
    case "red-scarf": return <><path d="M31 72q19 10 38-1l2 10q-20 12-41 0Z" fill="#aa3c50" stroke="#7f2e42"/><path d="m58 81 10-2 8 20-10-3-6 4Z" fill="#bc4656"/><path d="M37 77q12 4 24 0" fill="none" stroke="#df7f87" strokeWidth="1.5"/></>;
    case "fur-scarf": return <g fill="#f5edda" stroke="#c9c1b2" strokeWidth=".7"><path d="m28 73 7-3 5 4 6-3 5 3 7-3 5 3 7-4 5 6-2 8-7 3-7-2-7 3-7-2-7 2-6-4-6-1Z"/><path d="m65 80 10 3-3 19-10-2Z"/></g>;
    case "glasses": return <g fill="none" stroke={c.id === "anime-rize" ? "#9d4f6f" : "#604b41"} strokeWidth="1.7"><rect x="28" y="42" width="18" height="14" rx={c.id === "anime-rize" ? 7 : 4}/><rect x="54" y="42" width="18" height="14" rx={c.id === "anime-rize" ? 7 : 4}/><path d="M46 47q4-3 8 0m-30-2 4 1m44 0 4-1"/></g>;
    case "round-glasses": return <g fill={c.id === "anime-sakamoto" ? "#fffdf3" : "none"} stroke="#584e56" strokeWidth="1.6"><circle cx="37" cy="49" r="10"/><circle cx="63" cy="49" r="10"/><path d="M47 47q3-2 6 0m-30-2 5 1m44 0 5-1" fill="none"/>{c.id === "anime-sakamoto" && <path d="M43 60h14v3H43Z" fill="#74777d" stroke="none"/>}</g>;
    case "flower-clips": return <><Flower x={75} y={39} color="#8eb9dc" size={.75}/><Flower x={77} y={49} color="#8eb9dc" size={.6}/></>;
    case "forehead-marks": return <path d="m29 31 6 4-4 2m13-8 4 5-3 3m11-8-3 5 3 3m14-6-6 4 4 2M29 41l5-2m32 0 5 2" fill="none" stroke="#51333c" strokeWidth="1.8" strokeLinecap="round"/>;
    case "ghoul-mask": return <><path d="M24 53q26-2 52 0l-4 13q-21 15-44 0Z" fill="#373540" stroke="#211f2b"/><path d="M34 60h32v7H34Z" fill="#f4efdf"/><path d="M38 60v7m5-7v7m5-7v7m5-7v7m5-7v7m5-7v7M34 64h32" stroke="#55515a" strokeWidth="1"/><path d="M27 38h17v16H27Z" fill="#34323d"/><path d="m29 37-6-5" stroke="#34323d" strokeWidth="3"/></>;
    case "stitches": return <g stroke="#a75261" fill="none" strokeWidth="1.2"><path d="m31 30 10-3m-8 7 10-3m-8 7 10-3M40 70q10 4 20 0"/><path d="m41 68-1 5m6-4-1 5m7-4v5m6-6 1 4"/></g>;
    case "headphones": return <g stroke={c.id === "anime-hide" ? "#aa683d" : "#355875"} strokeWidth="1.4"><path d="M21 50V37q1-28 29-28t29 28v13" fill="none" strokeWidth="4"/><rect x="17" y="40" width="10" height="20" rx="5" fill={c.id === "anime-hide" ? "#e7a24b" : "#77a7bc"}/><rect x="73" y="40" width="10" height="20" rx="5" fill={c.id === "anime-hide" ? "#e7a24b" : "#77a7bc"}/><path d="M21 45v10m58-10v10" stroke={cream} opacity=".7"/></g>;
    case "brow-scar": return <path d="m30 43 5-6m-5 3 4 1" stroke="#bb816e" strokeWidth="1.2"/>;
    case "dragon-temple": return <path d="M29 30q-8 2-5 9t5 4q3-3 0-5-4-3-6 4m1-8-3 1m7-3-1-3m0 13 3 4m-7 0-1 4" stroke="#6b5266" fill="none" strokeWidth="1.3" strokeLinecap="round"/>;
    case "earring": return c.id === "anime-chifuyu" ? <circle cx="77" cy="57" r="3" fill="none" stroke="#30313c" strokeWidth="1.5"/> : <g stroke={gold} fill="none" strokeWidth="1.5"><path d="M77 54v11"/><circle cx="77" cy="65" r="2.5"/></g>;
    case "fang": return <path d="m45 61 4 1-3 4Z" fill="#fffaf1" stroke="#c7a08e" strokeWidth=".5"/>;
    case "horns": return <g fill="#3b303b" stroke="#211e29" strokeWidth="1"><path d="M30 28Q22 20 28 9q2 11 10 12Z"/><path d="M68 27q10-9 4-20-2 12-10 14Z"/></g>;
    case "small-horns": return <g fill="#f8dfc2" stroke="#cfaa9b" strokeWidth=".8"><path d="M30 26q-7-8-3-15l9 12Zm38 0q8-8 4-15l-9 12Z"/></g>;
    case "one-horn": return <path d="M47 27Q44 15 51 6q-1 11 6 19Z" fill="#38313d" stroke="#211d2b" strokeWidth="1"/>;
    case "freckles": return <><g fill="#8a6f64">{[31,35,39,61,65,69].map((x,i)=><circle key={x} cx={x} cy={56+(i%2)} r=".9"/>)}</g><path d="m33 73 7 9h20l7-9-4 14H37Z" fill="#c5d4d4" stroke="#6c8c8b"/><path d="M41 80v4m6-4v4m6-4v4m6-4v4" stroke="#738a8a"/></>;
    case "hero-mask": return <path d="m22 40 8-5 10 7 9 2 11-3 12-6 7 6-8 17-10-5-11 2-11-3-11 6 3-10ZM31 46q7-6 14 1v7H31ZM55 47q7-7 14-1v8H55Z" fillRule="evenodd" fill="#34333d" stroke="#21232d" strokeWidth=".8"/>;
    case "red-scar": return null; // Scar is below the individually shaped eyes.
    case "pink-earpieces": return <g fill="#f3b9d1" stroke="#aa698b" strokeWidth="1.2"><circle cx="23" cy="52" r="7"/><circle cx="77" cy="52" r="7"/><path d="M20 48h6v7h-6m54-7h6v7h-6" fill="#654762"/></g>;
    case "hair-buns": return <g fill={c.hair} stroke={tint(c.hair,-.3)} strokeWidth="1"><circle cx="21" cy="29" r="10"/><circle cx="79" cy="29" r="10"/><path d="M13 25q8 10 16 2m42 0q8 8 16-2" fill="none" stroke={gold} strokeWidth="3"/></g>;
    case "veil": return <><path d="M19 41Q13 12 49 9q36-1 32 34l-7-10Q50 15 27 33Z" fill="#33313e" stroke="#22222d"/><path d="m22 32 6-5 5 2 5-5 6 3 6-5 6 5 6-3 6 5 5-2 6 5" fill="none" stroke="#e2dfda" strokeWidth="3"/><path d="M20 33v43m60-43v43" stroke="#44404c" strokeWidth="5"/><path d="m17 44 4 4-4 4m66-8-4 4 4 4" fill="none" stroke="#b4aab9" strokeWidth="1"/></>;
    case "straw-hat": return <><path d="M26 26Q26 8 49 8q24-1 26 19" fill="#e9c77c" stroke="#b98f4e" strokeWidth="1.2"/><path d="M27 23q23-6 47 0v8H27Z" fill="#c54f53"/><ellipse cx="50" cy="31" rx="42" ry="9" fill="#eccc85" stroke="#b98f4e" strokeWidth="1.3"/><path d="M15 32q34 8 70 0m-48-16 2-5m10 4v-5m10 5 2-4" fill="none" stroke="#d2ab60" strokeWidth="1"/><path d="M61 58h10m-7-2v4m4-4v4" stroke="#b98478" strokeWidth="1"/></>;
    case "triple-earring": return <><g fill="none" stroke={gold} strokeWidth="1.5">{[0,1,2].map(i=><ellipse key={i} cx={76+i*2} cy={56+i*3} rx="2" ry="4"/>)}</g><path d="M62 41v17m-5-9 10-1" stroke="#7b7563" strokeWidth="1.2"/><path d="m58 48 8 1" stroke={ink} strokeWidth="1.5"/></>;
    case "tangerine": return <g><circle cx="70" cy="93" r="8" fill="#efa551" stroke="#d18137"/><path d="M70 85q1-7 7-5-1 5-7 5" fill="#719b66"/><circle cx="67" cy="91" r="2" fill="#ffe1a0" opacity=".7"/></g>;
    case "curly-brow": return <><path d="M61 40q9-6 9 0 0 4-4 1" fill="none" stroke="#766040" strokeWidth="1.3"/><path d="m47 68 3 2 3-2m-3 2v3" fill="none" stroke="#7c654e" strokeWidth="1.1"/></>;
    case "leaf-whiskers": return <><LeafBand/><path d="m25 53 8 2m-9 2 8 1m-7 3h8m42-8-8 2m9 2-8 1m7 3h-8" stroke="#aa8a6c" strokeWidth="1.1" strokeLinecap="round"/></>;
    case "leaf-band": return <LeafBand/>;
    case "diamond": return <><path d="M23 28q26-8 54 0l-2 7q-26-8-50 0Z" fill="#b54760"/><path d="m50 37 2.6 4-2.6 4-2.6-4Z" fill="#9861b0"/></>;
    case "ninja-mask": return <><path d="M23 52q27-5 54 0l-4 13q-22 16-46 0Z" fill="#455269" stroke="#303c55"/><path d="M31 59q19 9 37 0" fill="none" stroke="#63738a" strokeWidth="1.1"/><path d="m54 35 24-4-2 22H56Z" fill="#414c65"/><LeafBand mask/><path d="m57 54 1 3" stroke="#a47c79" strokeWidth="1"/></>;
    case "blindfold": return <><path d="M21 39q29-8 58 0l-2 15q-27-4-53 0Z" fill="#303144" stroke="#202235" strokeWidth="1"/><path d="M26 44q26-4 49-1m-47 7q21-4 45-1" fill="none" stroke="#55556f" strokeWidth="1.1"/><path d="m22 45-9 9 11-3" fill="#303144"/></>;
    case "hammer-pin": return <g transform="rotate(-25 75 40)" stroke="#b48d52" strokeWidth="1.2"><path d="M75 35v12"/><path d="M70 34h10v5H70Z" fill={gold}/></g>;
    case "goggles": return <g fill="#7f8f81" stroke="#514d40" strokeWidth="1.3"><path d="m27 43 18-2 1 12-16 2Zm28-2 18 2-3 12-16-2Z"/><path d="M45 45h10m-32 0 5 1m45 0 4-1" fill="none"/><path d="m31 46 9-1m18 0 9 1" stroke="#e7e4c5" strokeWidth="1"/></g>;
    case "star-tear": return <><path d="m31 54 1.4 3 3.2.5-2.3 2.3.5 3.2-2.8-1.5-2.8 1.5.5-3.2-2.3-2.3 3.2-.5Z" fill="#c66b91"/><path d="M68 54q-6 7-1 9t1-9" fill="#78b7c0"/></>;
    case "blue-lips": return null; // The configured mouth carries her blue lip color.
    case "white-mask": return <g><path d="M25 39q25-10 50 0l-3 23q-22 22-44 0Z" fill="#fbfaf4" stroke="#c8c9d0" strokeWidth="1.1"/><path d="m32 48 11 1-6 4Zm36 0-11 1 6 4Z" fill="#555662"/><path d="m50 49-2 8 4 1m-7 7q5-2 10 0" fill="none" stroke="#b8b8c3" strokeWidth="1.2"/></g>;
    case "camellia": return <><Flower x={76} y={30} size={1.05}/><path d="m77 36-2 14m5-14 2 11" stroke={gold} strokeWidth="1.5"/><circle cx="75" cy="51" r="2" fill="#f1d293"/></>;
    case "hairpins": return <g stroke={gold} strokeWidth="1.6" strokeLinecap="round"><path d="m19 13 36 15m-33 5 32-15m8 7 20-13m-18 2 14 17"/><Flower x={27} y={20} color="#d8698d" size={.7}/><path d="m23 25-2 17m5-15-1 12" strokeWidth="1"/><circle cx="21" cy="44" r="2" fill={gold}/></g>;
    case "hairpin": return <g stroke={gold} strokeWidth="1.5"><path d="m65 29 17 10m-17-7 12 11"/><path d="m76 34 6-4 3 5-5 4Z" fill="#78b6bd"/><circle cx="78" cy="43" r="2" fill={gold}/></g>;
    case "dragon-hand": return <g fill="#e9ede9" stroke="#a5beb9" strokeWidth="1"><path d="M66 100q-4-6 0-10l-3-8q1-4 4 0l3 6 1-10q2-4 4 0v11l3-6q3-1 3 2l-3 13-4 4Z"/><path d="m68 91 7 3m-8 0 7 3m-3-8 3 2" fill="none"/></g>;
    case "dragon-mask": return <><g transform="translate(15 -2) rotate(14 50 24) scale(.72 .56)"><path d="m23 43 4-13 13 7 10-7 10 7 13-7 4 14-7 21-13 2-7 7-7-7-13-2Z" fill="#dfd1a6" stroke="#a9946b" strokeWidth="1.4"/><path d="m29 43 15 4-9 7Zm42 0-15 4 9 7Z" fill="#5b6874"/><path d="m50 37-4 11 4 9 4-9ZM40 62h20l-4 5H44Z" fill="#b3a174"/><path d="m74 34 9-17 1 16 8-9-7 18" fill="#648aa9" stroke="#3f6483"/></g><path d="m28 70 7-2 6 4 8-3 7 3 8-4 9 4-4 12-9-2-10 4-10-4-8 1Z" fill="#eee6d3"/></>;
    case "stubble": return <g stroke="#8c6b61" strokeWidth=".9" strokeLinecap="round"><path d="m32 62 1 2m3 0 1 2m3 0 1 2m3 1 1 2m5-1v2m5-3-1 2m5-5-1 2m5-4-1 2m4-5-1 2"/>{c.id === "anime-yami" && <path d="m44 62 3-1m6 0 3 1" strokeWidth="1.5"/>}</g>;
    case "snack": return <g><path d="M38 97q-3-3 0-7l9-13q3-4 6 0l10 14q3 5-2 7Z" fill="#fff9e9" stroke="#c7bda4"/><path d="M45 91h11v8H45Z" fill="#415c46"/><path d="m43 87 1-1m5-3 1 1m7 4h1" stroke="#d6ccae" strokeWidth="1"/></g>;
    default: return null;
  }
}

function Chopper({ c }: { c: Visual }) {
  const face = faceDesign((c as unknown as { face?: unknown }).face);
  return <g strokeLinejoin="round" data-face={face.faceShape} data-eyes={face.eyes}>
    <path d="M29 33Q13 23 16 9m3 17L8 20m9-2L8 10m63 23Q87 23 84 9m-3 17 11-6m-9-2 9-8" stroke="#94603d" strokeWidth="5" strokeLinecap="round" fill="none"/>
    <path d="M31 40q-16-15-21-3t18 17m41-14q16-15 21-3T72 54" fill="#bd8e64" stroke="#875b41" strokeWidth="1.2"/>
    <path d="M27 103q1-22 23-22t23 22" fill="#82bcc0" stroke="#57949e" strokeWidth="1.2"/><path d="M43 81v22m14-22v22" stroke="#d2eddf" strokeWidth="4"/>
    <ellipse cx="50" cy="53" rx="32" ry="26" fill={c.hair} stroke="#946240" strokeWidth="1.2"/><ellipse cx="50" cy="64" rx="19" ry="13" fill="#e6bb89"/>
    {face.eyes === "closed" ? <path d="M32 52q5-7 10 0m16 0q5-7 10 0" fill="none" stroke={ink} strokeWidth="1.8" strokeLinecap="round"/> : <><ellipse cx="37" cy="52" rx={face.eyeWidth*.3} ry={face.eyeHeight*.44} fill={ink}/><ellipse cx="63" cy="52" rx={face.eyeWidth*.3} ry={face.eyeHeight*.44} fill={ink}/><circle cx="38" cy="50" r="1.2" fill="white"/><circle cx="64" cy="50" r="1.2" fill="white"/></>}
    <ellipse cx="50" cy="60" rx="5.5" ry="3.7" fill="#679bbd" stroke="#476a95" strokeWidth=".8"/><path d="M50 64v2" fill="none" stroke="#714e40" strokeWidth="1.3"/><AnimeMouth design={face} y={68}/>
    <ellipse cx="28" cy="62" rx="5" ry="2.5" fill="#eaa0a0" opacity={face.blush}/><ellipse cx="72" cy="62" rx="5" ry="2.5" fill="#eaa0a0" opacity={face.blush}/>
    <path d="M20 35Q14 9 50 8q36 1 30 27" fill="#d674a2" stroke="#a34e7d" strokeWidth="1.3"/><ellipse cx="50" cy="37" rx="36" ry="9" fill="#e397ba" stroke="#ac5b8b" strokeWidth="1.2"/><path d="m43 18 14 13m0-13L43 31" stroke="#fff8ed" strokeWidth="5" strokeLinecap="round"/>
    <path d="M32 89q-7-2-7 5t11 6m32-11q7-2 7 5t-11 6" fill={c.hair} stroke="#946240"/>
  </g>;
}

/** Original, compact vector portraits: shared proportions, individual hair, costume and signature details. */
export default function AnimeAvatar({ character: c, className = "", label }: { character: Visual; className?: string; label?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const clip = `anime-clip-${uid}`;
  const face = faceDesign((c as unknown as { face?: unknown }).face);
  const frontScale = ["anime-megumi", "anime-bakugo"].includes(c.id) ? 1.06 : 1.14;
  const backScale = ["twintails", "updo"].includes(c.style) ? 1 : 1.1;
  const heldProp = ["snack", "tangerine", "dragon-hand"].includes(c.accessory);
  if (c.id === "anime-kirari" && !face.lipColor) face.lipColor = "#6a90b5";
  const complexion = ["anime-yami","anime-mitsueda","anime-hak"].includes(c.id) ? "#e7b494" : "#ffdcc3";
  return <svg className={`ds-avatar anime-avatar ${className}`} data-character={c.id} data-transparent="true" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role={label ? "img" : undefined} aria-label={label} aria-hidden={!label || undefined}>
    <defs>
      <clipPath id={clip}><rect width="100" height="100"/></clipPath>
    </defs>
    <g clipPath={`url(#${clip})`}>
      {c.style === "reindeer" ? <Chopper c={c}/> : <>
        <g transform={`translate(50 0) scale(${backScale} 1) translate(-50 0)`}><HairBack c={c}/></g>
        <g transform="translate(50 80) scale(.68 .78) translate(-50 -80)"><Outfit c={c}/>{heldProp && <Accessories c={c}/>}</g>
        <ellipse cx="18" cy="51" rx="5" ry="7" fill={complexion} stroke={ink} strokeWidth="1.1"/><ellipse cx="82" cy="51" rx="5" ry="7" fill={complexion} stroke={ink} strokeWidth="1.1"/>
        <path d={faceOutline(face)} fill={complexion} stroke={ink} strokeWidth="1.8"/>
        {c.accessory === "red-scar" && <path d="M55 37q15-5 19 9l-3 13-12-1-5-10Z" fill="#bd6c70" opacity=".65"/>}
        <AnimeFace design={face} eyeColor={c.eyes} browColor={tint(c.hair,-.55)} uid={uid} characterId={c.id}/>
        <g transform={`translate(50 0) scale(${frontScale} 1) translate(-50 0)`}><HairFront c={c}/></g>
        {!heldProp && <g transform="translate(50 0) scale(1.12 1) translate(-50 0)"><Accessories c={c}/></g>}
      </>}
    </g>
  </svg>;
}
