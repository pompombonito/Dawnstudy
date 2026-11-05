"use client";

import { useId } from "react";
import type { AnimeCharacter } from "../community/anime-companions";
import { animeCompanionBubble } from "../community/anime-companions";
import AnimeFace, { AnimeMouth, faceDesign } from "./AnimeFace";
import { characterMotionStyle } from "./character-motion";

type KpopCharacter = AnimeCharacter & { face?: unknown };
const ink = "#342d3d";

function EyesAndMouth({ character, uid }: { character: KpopCharacter; uid: string }) {
  const face = faceDesign(character.face);
  return <>
    <AnimeFace design={face} eyeColor={character.eyes} browColor="#493c43" uid={uid} characterId={character.id}/>
    {character.id === "kpop-ppeu" ? <g transform="translate(50 67)"><g className="anime-mouth-motion">
      <path d="M-10-3Q0-7 10-3L6 4Q0 8-6 4Z" fill="#e89a32" stroke="#bc7130" strokeWidth="1.2"/>
      <path d="M-6-2Q0 0 6-2" fill="none" stroke="#f7c45f" strokeWidth="1"/>
    </g></g> : <AnimeMouth design={face} y={67}/>}
  </>;
}

function BlackpinkCompanion({ c, uid }: { c: KpopCharacter; uid: string }) {
  return <>
    {c.id === "kpop-sooya" && <>
      <g className="anime-hair-back" fill="#fffaf2" stroke={ink} strokeWidth="2" strokeLinejoin="round">
        <path d="M37 39Q27 31 24 11Q22 3 30 8L47 32m16 7Q72 31 76 11q2-8-6-3L53 32Z"/>
      </g>
      <path d="M29 13q2 15 12 22m30-22Q69 28 59 35" fill="none" stroke="#efb5c5" strokeWidth="4" strokeLinecap="round"/>
      <path d="M30 82q-12 4-8 16h56q4-12-8-16" fill="#f3c0cc" stroke={ink} strokeWidth="1.7"/>
      <ellipse cx="50" cy="51" rx="31" ry="29" fill="#fffaf2" stroke={ink} strokeWidth="2"/>
      <ellipse cx="50" cy="62" rx="12" ry="7" fill="#fff0ed"/>
      <path d="m47 59 3-2 3 2-3 4Z" fill="#d77b91" stroke="#a75569" strokeWidth=".8"/>
      <EyesAndMouth character={c} uid={uid}/>
      <path d="M31 91v6m38-6v6" stroke="#fffaf2" strokeWidth="5" strokeLinecap="round"/>
    </>}
    {c.id === "kpop-gomdeuki" && <>
      <g className="anime-hair-back" fill="#9d6248" stroke={ink} strokeWidth="2">
        <circle cx="29" cy="29" r="12"/><circle cx="71" cy="29" r="12"/>
        <circle cx="29" cy="29" r="5.4" fill="#d3947f" stroke="none"/><circle cx="71" cy="29" r="5.4" fill="#d3947f" stroke="none"/>
      </g>
      <path d="M27 83q-12 4-8 15h62q4-11-8-15" fill="#e8b7bd" stroke={ink} strokeWidth="1.7"/>
      <ellipse cx="50" cy="52" rx="32" ry="30" fill="#b77a5c" stroke={ink} strokeWidth="2"/>
      <ellipse cx="50" cy="62" rx="15" ry="10" fill="#e7c5ad" stroke="#9e6956" strokeWidth=".9"/>
      <ellipse cx="50" cy="59" rx="4" ry="2.8" fill="#46383a"/>
      <EyesAndMouth character={c} uid={uid}/>
      <path d="M31 91v6m38-6v6" stroke="#b77a5c" strokeWidth="5" strokeLinecap="round"/>
    </>}
    {c.id === "kpop-rosie" && <>
      <g className="anime-hair-back" fill="#cd8a5b" stroke={ink} strokeWidth="2">
        <path d="M70 67Q94 73 89 53q-3-12-14-7 12 3 7 13-4 6-13 0Z"/>
        <path d="M31 35q-6-10 1-13m37 13q7-10 0-13" fill="none" strokeWidth="3" strokeLinecap="round"/>
      </g>
      <path d="M28 83q-12 4-8 15h60q4-11-8-15" fill="#e9c4a9" stroke={ink} strokeWidth="1.7"/>
      <ellipse cx="50" cy="52" rx="31" ry="29" fill="#f3d6bd" stroke={ink} strokeWidth="2"/>
      <path d="M25 44q-1-23 24-25 25 2 26 25-9-8-14-3l-6-10-9 9-9-8-6 13Z" fill="#c98354" stroke={ink} strokeWidth="1.5"/>
      <path d="m46 61 4-3 4 3-4 3Z" fill="#9d654b"/>
      <EyesAndMouth character={c} uid={uid}/>
      <path d="M30 91v6m40-6v6" stroke="#cd8a5b" strokeWidth="5" strokeLinecap="round"/>
    </>}
    {c.id === "kpop-ppeu" && <>
      <g className="anime-hair-back" fill="#f6d36d" stroke={ink} strokeWidth="1.8">
        <path d="M23 56Q8 39 18 34q10-4 18 9m41 13q15-17 5-22-10-4-18 9"/>
        <path d="M40 25q-8-13 3-13 5 0 7 9 3-9 9-7 7 3-1 13"/>
      </g>
      <ellipse cx="50" cy="78" rx="24" ry="18" fill="#f6d36d" stroke={ink} strokeWidth="1.8"/>
      <ellipse cx="50" cy="51" rx="31" ry="29" fill="#ffe18a" stroke={ink} strokeWidth="2"/>
      <path d="M23 45q1-24 27-24t27 24q-12-8-27-8t-27 8Z" fill="#f6d36d" stroke={ink} strokeWidth="1.5"/>
      <EyesAndMouth character={c} uid={uid}/>
      <path d="M35 91q-5 5-10 2m40-2q5 5 10 2" fill="none" stroke="#eebd55" strokeWidth="5" strokeLinecap="round"/>
    </>}
  </>;
}

function Bt21Companion({ c, uid }: { c: KpopCharacter; uid: string }) {
  if (c.id === "kpop-shooky") return <>
    <g className="anime-hair-back" fill="#b87645" stroke="#75452f" strokeWidth="1.7" strokeLinejoin="round">
      <path d="m31 31 4-8 9 4 7-7 8 7 10-4 3 9 9 4-3 10 5 8-7 7 1 10-11 2-7 8-9-5-10 5-7-8-10-1 1-10-8-7 5-9-3-10Z"/>
    </g>
    <path d="M37 80q-12 2-10 16h46q2-14-10-16" fill="#b87645" stroke="#75452f" strokeWidth="1.7"/>
    {[35,66].map((x) => <circle key={x} cx={x} cy="37" r="2.7" fill="#75452f"/>)}
    {[32,68].map((x) => <ellipse key={x} cx={x} cy="57" rx="3.2" ry="4.4" fill="#d59a64" opacity=".8"/>)}
    <AnimeFace design={faceDesign(c.face)} eyeColor={c.eyes} browColor="#573c31" uid={uid} characterId={c.id}/>
    <AnimeMouth design={faceDesign(c.face)} y={67}/>
  </>;

  if (c.id === "kpop-van") return <>
    <g className="anime-hair-back" stroke={ink} strokeWidth="1.8" strokeLinejoin="round">
      <path d="M24 25 33 15h34l9 10v39l-10 9H34l-10-9Z" fill="#e1e4ed"/>
      <path d="M50 16v55" stroke="#9aa6b7" strokeWidth="1.2"/>
      <path d="M25 29h24v30H25Z" fill="#d7535e" stroke="none"/><path d="M51 29h24v30H51Z" fill="#6098bb" stroke="none"/>
    </g>
    <path d="M30 80q-9 3-7 15h54q2-12-7-15" fill="#8a9aae" stroke={ink} strokeWidth="1.7"/>
    <AnimeFace design={faceDesign(c.face)} eyeColor={c.eyes} browColor="#3f4b59" uid={uid} characterId={c.id}/>
    <AnimeMouth design={faceDesign(c.face)} y={67}/>
  </>;

  return <>
    <g className="anime-hair-back" stroke={ink} strokeWidth="1.8" strokeLinejoin="round">
      {c.id === "kpop-koya" && <><ellipse cx="29" cy="33" rx="15" ry="16" fill="#9bc3d0"/><ellipse cx="71" cy="33" rx="15" ry="16" fill="#9bc3d0"/><ellipse cx="29" cy="34" rx="8" ry="10" fill="#8460a7" stroke="none"/><ellipse cx="71" cy="34" rx="8" ry="10" fill="#8460a7" stroke="none"/></>}
      {c.id === "kpop-koya" && <ellipse cx="50" cy="53" rx="31" ry="30" fill="#a8c9d5"/>}
      {c.id === "kpop-rj" && <path d="m35 31 4-13 7 8 5-15 6 15 8-9 1 14q13 9 10 34-3 17-26 18-23-1-26-18-3-25 11-34Z" fill="#fffaf0"/>}
      {c.id === "kpop-mang" && <path d="M28 38 25 19q0-7 8-5l9 14h16l9-14q8-2 8 5l-3 19q7 9 4 25-4 19-26 19T24 63q-3-16 4-25Z" fill="#9575b7"/>}
      {c.id === "kpop-chimmy" && <><path d="M30 40Q12 37 14 17q1-10 13-6l13 18m20 11q18-3 16-23-1-10-13-6L50 29Z" fill="#27252d"/><path d="M29 39q-7 13-3 30 5 13 24 14 19-1 24-14 4-17-3-30-16-12-42 0Z" fill="#f3cf52"/></>}
      {c.id === "kpop-tata" && <path d="M50 76Q43 71 27 58C8 42 24 20 41 30q6 3 9 10 4-7 10-10c17-10 33 12 14 28Q59 70 50 76Z" fill="#d8434d"/>}
      {c.id === "kpop-cooky" && <><path d="M38 39Q28 16 33 6q3-7 11-1l8 28m10 6q15-22 21-13 5 8-8 26" fill="#f09ab0"/><path d="M28 40Q28 22 50 22t22 18q6 15-1 29-5 12-21 13-16-1-21-13-7-14-1-29Z" fill="#f09ab0"/><path d="M37 11q-1 9 6 18m31 8q8-7 9-11" fill="none" stroke="#d77795" strokeWidth="2"/></>}
      {c.id === "kpop-van" && <path d="M24 31 34 19h32l10 12v34L65 75H35L24 65Z" fill="#e1e4ed"/>}
    </g>
    {c.id !== "kpop-tata" && <path d={c.id === "kpop-van" ? "M35 80q-9 3-7 15h44q2-12-7-15" : c.id === "kpop-shooky" ? "" : "M30 80q-10 3-7 15h54q3-12-7-15"} fill={c.outfit} stroke={ink} strokeWidth="1.8"/>}
    {c.id === "kpop-tata" && <path d="M34 77q-10 4-7 18h46q3-14-7-18" fill="#5d82a7" stroke={ink} strokeWidth="1.8"/>}
    {c.id === "kpop-rj" && <><path d="M26 80h48l7 17H19Z" fill="#d55760" stroke={ink} strokeWidth="1.6"/><path d="m40 79 10 10 10-10-4 18H44Z" fill="#fffaf0"/></>}
    {c.id === "kpop-chimmy" && <><path d="M27 41Q50 31 73 41q7 12 2 24-8 15-25 15T25 65q-5-12 2-24Z" fill="#ffe38a" stroke="#d2ac3c" strokeWidth="1.1"/><path d="M33 82 25 94m42-12 8 12" stroke="#e4ba42" strokeWidth="6" strokeLinecap="round"/></>}
    {c.id === "kpop-mang" && <path d="M30 80q-9 4-7 15h54q2-11-7-15" fill="#9575b7" stroke={ink} strokeWidth="1.7"/>}
    {c.id === "kpop-koya" && <path d="M30 80q-9 4-7 15h54q2-11-7-15" fill="#8798c9" stroke={ink} strokeWidth="1.7"/>}
    {c.id === "kpop-cooky" && <path d="M29 79q-11 4-8 16h58q3-12-8-16" fill="#f09ab0" stroke={ink} strokeWidth="1.7"/>}
    {c.id === "kpop-shooky" && <path d="M39 81q-8 2-7 13h36q1-11-7-13" fill="#b87645" stroke="#75452f" strokeWidth="1.7"/>}
    {c.id === "kpop-koya" && <ellipse cx="50" cy="59" rx="6" ry="4.3" fill="#6550a2" stroke="#50407f" strokeWidth=".7"/>}
    {c.id === "kpop-rj" && <ellipse cx="50" cy="60" rx="13" ry="8" fill="#f2e8dc" stroke="#d9c8b8" strokeWidth=".7"/>}
    {c.id === "kpop-mang" && <path d="M25 43q25-8 50 0l-3 18q-22 14-44 0Z" fill="#78a4c6" stroke="#496f91" strokeWidth="1"/>}
    {c.id === "kpop-chimmy" && <ellipse cx="50" cy="62" rx="13" ry="8" fill="#ffe6aa" stroke="#d8b954" strokeWidth=".7"/>}
    {c.id === "kpop-cooky" && <ellipse cx="50" cy="62" rx="12" ry="7" fill="#f8c3cd"/>}
    <AnimeFace design={faceDesign(c.face)} eyeColor={c.eyes} browColor={c.id === "kpop-cooky" ? "#513641" : "#493c43"} uid={uid} characterId={c.id}/>
    {c.id === "kpop-mang" ? <g transform="translate(50 67)"><g className="anime-mouth-motion"><path d="M-6 0q6 8 12 0q-6 3-12 0Z" fill="#f1a5bc" stroke="#624d85" strokeWidth=".8"/></g></g>
      : c.id !== "kpop-van" && <AnimeMouth design={faceDesign(c.face)} y={67}/>}
    {c.id === "kpop-cooky" && <path d="m37 37 8 2m18-2-8 2" stroke="#513641" strokeWidth="2.4" strokeLinecap="round"/>}
    {c.id === "kpop-rj" && <g className="anime-headwear"><path d="m27 83 23 9 23-9" fill="none" stroke="#fffaf0" strokeWidth="7" strokeLinejoin="round"/></g>}
    {c.id === "kpop-chimmy" && <g className="anime-headwear"><path d="M27 39Q31 20 50 20t23 19" fill="none" stroke="#ffe38a" strokeWidth="5"/></g>}
  </>;
}

/** Original, transparent chibi-style interpretations of official K-pop character mascots. */
export default function KpopAvatar({ character, className = "", label, hoverLine = true }: {
  character: KpopCharacter; className?: string; label?: string; hoverLine?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const bubble = animeCompanionBubble(character.id, 1)?.text || character.name;
  return <svg className={`ds-avatar anime-avatar motion-avatar kpop-avatar ${className}`} style={characterMotionStyle(character.id)} data-character={character.id} data-transparent="true" data-animated="true" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role={label ? "img" : undefined} aria-label={label} aria-hidden={!label || undefined}>
    {hoverLine && <title>{bubble}</title>}
    {character.series === "BLACKPINK" ? <BlackpinkCompanion c={character} uid={uid}/> : <Bt21Companion c={character} uid={uid}/>}
  </svg>;
}
