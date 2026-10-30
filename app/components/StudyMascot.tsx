"use client";

import { useId } from "react";
import "./study-mascot.css";

type Animal = "cat" | "fox" | "bunny" | "bear";

type StudyMascotProps = {
  animal?: Animal;
  className?: string;
  decorative?: boolean;
};

const palettes = {
  cat: { fur: "#edc79d", light: "#fff0d7", shade: "#d7a878", ear: "#d98e78", scarf: "#718b68" },
  fox: { fur: "#d98b54", light: "#fff0d9", shade: "#bd7042", ear: "#6a5140", scarf: "#718b68" },
  bunny: { fur: "#e8eadc", light: "#fff9eb", shade: "#c7cdbb", ear: "#dda68f", scarf: "#d18a61" },
  bear: { fur: "#8eaa82", light: "#e7edd7", shade: "#708c69", ear: "#becaaa", scarf: "#d99468" },
} as const;

/** A small, original illustration shared by the study desk and floating buddy. */
export default function StudyMascot({ animal = "cat", className = "", decorative = true }: StudyMascotProps) {
  const titleId = useId();
  const color = palettes[animal];
  const outline = "#3c4736";

  return (
    <svg
      className={`study-mascot study-mascot--${animal} ${className}`.trim()}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={decorative || undefined}
      aria-labelledby={decorative ? undefined : titleId}
      role={decorative ? undefined : "img"}
      focusable="false"
    >
      {!decorative && <title id={titleId}>Your {animal} study companion</title>}
      <ellipse className="study-mascot-shadow" cx="101" cy="186" rx="45" ry="7" fill={outline} opacity=".12" />
      <g className="study-mascot-creature" strokeLinecap="round" strokeLinejoin="round">
        {animal === "cat" && <path d="M137 158c35 6 43-13 33-23-6-6-16-2-13 6 2 4 7 3 9 1" stroke={color.shade} strokeWidth="15" />}
        {animal === "fox" && <><path d="M132 165c35 5 47-15 37-39-2 14-14 14-28 15Z" fill={color.fur} stroke={outline} strokeWidth="2.5" /><path d="M169 126c-2 14-14 14-28 15l14 10c13-5 17-13 14-25Z" fill={color.light} /></>}
        {animal === "bunny" && <circle cx="142" cy="153" r="16" fill={color.light} stroke={outline} strokeWidth="2.5" />}
        {animal === "bear" && <circle cx="142" cy="157" r="12" fill={color.fur} stroke={outline} strokeWidth="2.5" />}

        {animal === "cat" && <>
          <path d="m51 75-1-39c0-6 4-7 8-3l27 29" fill={color.fur} stroke={outline} strokeWidth="2.5" />
          <path d="m58 65-1-23 18 21" fill={color.ear} />
          <path d="m149 75 1-39c0-6-4-7-8-3l-27 29" fill={color.fur} stroke={outline} strokeWidth="2.5" />
          <path d="m142 65 1-23-18 21" fill={color.ear} />
        </>}
        {animal === "fox" && <>
          <path d="M51 78 44 33c-1-5 3-7 7-4l34 34" fill={color.fur} stroke={outline} strokeWidth="2.5" />
          <path d="m53 65-3-25 24 24" fill={color.ear} />
          <path d="m149 78 7-45c1-5-3-7-7-4l-34 34" fill={color.fur} stroke={outline} strokeWidth="2.5" />
          <path d="m147 65 3-25-24 24" fill={color.ear} />
        </>}
        {animal === "bunny" && <>
          <path d="M63 76C51 45 53 13 65 12c13-1 21 30 21 55" fill={color.fur} stroke={outline} strokeWidth="2.5" />
          <path d="M68 64c-6-18-8-38-3-39 5-1 10 19 11 36" fill={color.ear} />
          <path d="M116 66c2-29 14-50 26-46 12 5 6 34-5 58" fill={color.fur} stroke={outline} strokeWidth="2.5" />
          <path d="M127 62c4-19 10-31 13-28 4 4-1 18-7 32" fill={color.ear} />
        </>}
        {animal === "bear" && <>
          <circle cx="61" cy="59" r="20" fill={color.fur} stroke={outline} strokeWidth="2.5" />
          <circle cx="61" cy="59" r="11" fill={color.ear} />
          <circle cx="139" cy="59" r="20" fill={color.fur} stroke={outline} strokeWidth="2.5" />
          <circle cx="139" cy="59" r="11" fill={color.ear} />
        </>}

        <path d="M60 145c0-23 15-36 40-36s40 13 40 36v20c0 14-17 20-40 20s-40-6-40-20Z" fill={color.fur} stroke={outline} strokeWidth="2.5" />
        <ellipse cx="100" cy="154" rx="26" ry="23" fill={color.light} />
        <ellipse cx="73" cy="178" rx="16" ry="9" fill={color.fur} stroke={outline} strokeWidth="2.5" />
        <ellipse cx="127" cy="178" rx="16" ry="9" fill={color.fur} stroke={outline} strokeWidth="2.5" />
        <path d="M68 178v3m7-3v3m49-3v3m7-3v3" stroke={color.shade} strokeWidth="2" />

        <path d="M62 123c8 10 68 10 76 0v11c-12 10-64 10-76 0Z" fill={color.scarf} stroke={outline} strokeWidth="2.5" />
        <path d="m77 135-7 23 15 3 5-25" fill={color.scarf} stroke={outline} strokeWidth="2.5" />
        <path d="m73 151 12 3" stroke={color.light} strokeWidth="2" opacity=".65" />

        {animal === "fox" ? <>
          <path d="M50 76c9-15 26-23 50-23s41 8 50 23l8 24-18 22c-10 10-24 15-40 15s-30-5-40-15l-18-22Z" fill={color.fur} stroke={outline} strokeWidth="2.5" />
          <path d="m46 101 27 2c9 1 15 6 27 17 12-11 18-16 27-17l27-2-16 20c-10 10-22 14-38 14s-28-4-38-14Z" fill={color.light} />
        </> : <>
          <path d="M49 93c0-26 20-42 51-42s51 16 51 42c0 28-21 43-51 43s-51-15-51-43Z" fill={color.fur} stroke={outline} strokeWidth="2.5" />
          <ellipse cx="100" cy="112" rx={animal === "bear" ? 22 : 25} ry="17" fill={color.light} />
        </>}

        {animal === "cat" && <g stroke={color.shade} strokeWidth="4"><path d="m88 57 4 11m8-13v11m12-9-4 11" /></g>}
        {animal === "fox" && <path d="m93 57 7 13 7-13" fill={color.light} />}
        {animal === "bunny" && <path d="m92 55 6 8 7-9" stroke={color.light} strokeWidth="3" />}
        <g className="study-mascot-eyes" fill={outline}>
          <ellipse cx="80" cy="92" rx="4.4" ry="6.5" />
          <ellipse cx="120" cy="92" rx="4.4" ry="6.5" />
          <circle cx="81.2" cy="90.3" r="1.35" fill="#fff9ec" />
          <circle cx="121.2" cy="90.3" r="1.35" fill="#fff9ec" />
        </g>
        <ellipse cx="66" cy="106" rx="7" ry="4" fill="#d98e78" opacity=".5" />
        <ellipse cx="134" cy="106" rx="7" ry="4" fill="#d98e78" opacity=".5" />
        <path d="M95 106q5-3 10 0c0 4-3 6-5 6s-5-2-5-6Z" fill={animal === "bunny" ? "#c58275" : outline} />
        <path d="M100 112v3m0 0c-2 4-7 4-9 0m9 0c2 4 7 4 9 0" stroke={outline} strokeWidth="2" />
        {animal === "cat" && <g stroke={outline} strokeWidth="1.7" opacity=".5"><path d="m53 103 14 3m-15 6 14-1m67-5 14-3m-13 8 14 1" /></g>}

        <path d="M58 151c16-5 29-3 42 5 13-8 26-10 42-5v24c-15-4-28-2-42 5-14-7-27-9-42-5Z" fill="#f7f1df" stroke={outline} strokeWidth="2.5" />
        <path d="M58 151v24c15-4 28-2 42 5v-24c-13-8-26-10-42-5Z" fill="#e1e8d2" />
        <path d="M58 175c15-4 28-2 42 5 14-7 27-9 42-5m-42-19v24" stroke={outline} strokeWidth="2.5" />
        <path d="m67 157 20 3m-20 4 20 3m24-6 19-4m-19 11 19-4" stroke="#9ca78c" strokeWidth="1.8" />
        <path d="M123 150v11l4-3 4 1v-10" fill="#dc9265" />
        <path d="M55 151c-4-8 1-15 7-15 7 0 12 7 9 15-2 7-12 8-16 0Z" fill={color.fur} stroke={outline} strokeWidth="2.5" />
        <path d="M129 151c-3-8 2-15 9-15 6 0 11 7 7 15-4 8-14 7-16 0Z" fill={color.fur} stroke={outline} strokeWidth="2.5" />
        <path d="m60 146 1 5m5-6v5m69-5v5m5-4-1 5" stroke={color.shade} strokeWidth="2" />
      </g>
      <g className="study-mascot-star" fill="#dc9566">
        <path d="m168 53 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" />
        <circle cx="32" cy="120" r="3" opacity=".65" />
      </g>
    </svg>
  );
}
