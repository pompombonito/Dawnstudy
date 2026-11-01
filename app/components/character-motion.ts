import type { CSSProperties } from "react";

/** Stable phases keep the roster lively without making every character blink together. */
export function characterMotionStyle(id: string): CSSProperties {
  let seed = 2166136261;
  for (const character of id) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  return {
    "--anime-blink-duration": `${(5.8 + seed % 19 * .17).toFixed(2)}s`,
    "--anime-blink-delay": `${-(seed % 997) / 97}s`,
    "--anime-gaze-duration": `${(11 + (seed >>> 3) % 17 * .31).toFixed(2)}s`,
    "--anime-gaze-delay": `${-((seed >>> 5) % 991) / 79}s`,
    "--anime-mouth-duration": `${(7.2 + (seed >>> 7) % 13 * .23).toFixed(2)}s`,
    "--anime-mouth-delay": `${-((seed >>> 9) % 983) / 101}s`,
    "--anime-hair-duration": `${(6.4 + (seed >>> 11) % 11 * .21).toFixed(2)}s`,
    "--anime-motion-delay": `${-((seed >>> 13) % 977) / 113}s`,
  } as CSSProperties;
}

