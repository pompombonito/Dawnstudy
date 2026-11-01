export type CharacterTheme =
  | "cinnamoroll"
  | "pompompurin"
  | "kuromi"
  | "hello-kitty"
  | "pochacco";
export type ThemeMode = "light" | "dark";
export type Theme = `${CharacterTheme}-${ThemeMode}`;
export type ThemeColors = readonly [string, string, string];

export const DEFAULT_THEME: Theme = "kuromi-dark";
export const THEME_STORAGE_KEY = "dawnstudy_theme_v1";
export const GUEST_THEME_STORAGE_KEY = "dawnstudy_guest_theme_v1";
export const SESSION_STORAGE_KEY = "dawnstudy_session_v1";

export const CHARACTERS = [
  {
    id: "cinnamoroll",
    name: "Cinnamoroll",
    description: "Cloud blues and snowy whites.",
    colors: { light: ["#eef5fa", "#fbfdff", "#a9d4f0"], dark: ["#121e29", "#1b2a38", "#b4daf2"] },
  },
  {
    id: "pompompurin",
    name: "Pompompurin",
    description: "Pudding creams and cozy caramel.",
    colors: { light: ["#fbf5e5", "#fffdf5", "#e7c27b"], dark: ["#261f18", "#33291f", "#e6c17e"] },
  },
  {
    id: "kuromi",
    name: "Kuromi",
    description: "Lilac accents and dreamy plum.",
    colors: { light: ["#f3eef7", "#fffbff", "#c9a7e6"], dark: ["#19161f", "#23202b", "#c6a7e9"] },
  },
  {
    id: "hello-kitty",
    name: "Hello Kitty",
    description: "Ribbon pinks and soft rose.",
    colors: { light: ["#fff1f4", "#fffafb", "#eda2b7"], dark: ["#281a23", "#37232f", "#eeabc0"] },
  },
  {
    id: "pochacco",
    name: "Pochacco",
    description: "Fresh greens and gentle sage.",
    colors: { light: ["#eef4ed", "#fbfdf8", "#accbad"], dark: ["#17221c", "#223028", "#afd4b3"] },
  },
] as const;

export function themeFor(character: CharacterTheme, mode: ThemeMode): Theme {
  return `${character}-${mode}`;
}

export type ThemeDefinition = {
  id: Theme;
  name: string;
  character: CharacterTheme;
  mode: ThemeMode;
  description: string;
  colors: ThemeColors;
  title: string;
  label: string;
};

export const THEMES: readonly ThemeDefinition[] = CHARACTERS.flatMap(character =>
  (["light", "dark"] as const).map(mode => ({
    id: themeFor(character.id, mode),
    name: `${character.name} · ${mode === "light" ? "Light" : "Dark"}`,
    character: character.id,
    mode,
    description: character.description,
    colors: character.colors[mode],
    title: character.name,
    label: mode === "light" ? "Light" : "Dark",
  })),
);

const LEGACY_ALIASES: Record<string, Theme> = {
  light: "cinnamoroll-light",
  dark: "kuromi-dark",
  rose: "hello-kitty-light",
};
const themeIds = new Set<string>(THEMES.map(theme => theme.id));

export function normalizeTheme(value: unknown): Theme {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  const canonical = LEGACY_ALIASES[key] || key;
  return themeIds.has(canonical) ? canonical as Theme : DEFAULT_THEME;
}

export function getTheme(value: unknown): ThemeDefinition {
  const id = normalizeTheme(value);
  return THEMES.find(theme => theme.id === id)!;
}

export function setThemeCharacter(value: unknown, character: CharacterTheme): Theme {
  return themeFor(character, getTheme(value).mode);
}

export function setThemeMode(value: unknown, mode: ThemeMode): Theme {
  return themeFor(getTheme(value).character, mode);
}

export function readInitialTheme(storage: Pick<Storage, "getItem">): Theme {
  try {
    const key = storage.getItem(SESSION_STORAGE_KEY) ? THEME_STORAGE_KEY : GUEST_THEME_STORAGE_KEY;
    return normalizeTheme(storage.getItem(key));
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(value: unknown, root?: Pick<HTMLElement, "dataset" | "style">): Theme {
  const selected = getTheme(value);
  const target = root || (typeof document === "undefined" ? null : document.documentElement);
  if (target) {
    target.dataset.theme = selected.mode;
    target.dataset.character = selected.character;
    target.dataset.colorTheme = selected.id;
    target.style.colorScheme = selected.mode;
  }
  return selected.id;
}

// Inline before paint; generated from this catalog to keep defaults and aliases aligned.
export const themeBootstrapScript = `(function(){var themes=${JSON.stringify(Object.fromEntries(THEMES.map(theme => [theme.id, { character: theme.character, mode: theme.mode }])))};var aliases=${JSON.stringify(LEGACY_ALIASES)};var value=null;try{var key=localStorage.getItem(${JSON.stringify(SESSION_STORAGE_KEY)})?${JSON.stringify(THEME_STORAGE_KEY)}:${JSON.stringify(GUEST_THEME_STORAGE_KEY)};value=localStorage.getItem(key);}catch(e){}var id=typeof value==='string'?value.trim().toLowerCase():'';id=aliases[id]||id;if(!Object.prototype.hasOwnProperty.call(themes,id))id=${JSON.stringify(DEFAULT_THEME)};var selected=themes[id],root=document.documentElement;root.dataset.theme=selected.mode;root.dataset.character=selected.character;root.dataset.colorTheme=id;root.style.colorScheme=selected.mode;})();`;
