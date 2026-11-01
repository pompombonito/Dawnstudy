export type CharacterTheme =
  | "cinnamoroll"
  | "pompompurin"
  | "kuromi"
  | "hello-kitty";
export type ClassicTheme = "classic" | "ocean" | "forest" | "sepia";
export type ThemeFamily = CharacterTheme | ClassicTheme;
export type ThemeCategory = "classic" | "character";
export type ThemeMode = "light" | "dark";
export type Theme = `${ThemeFamily}-${ThemeMode}`;
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
    description: "Buttercream and custard, with graphite in dark mode.",
    colors: { light: ["#fbf5e5", "#fffdf5", "#e7c27b"], dark: ["#191a1b", "#252627", "#f2d675"] },
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
] as const;

export const CLASSICS = [
  { id: "classic", name: "Classic", description: "Pure black, white, and neutral gray.", colors: { light: ["#f2f2f2", "#ffffff", "#242424"], dark: ["#111111", "#1e1e1e", "#eeeeee"] } },
  { id: "ocean", name: "Ocean", description: "Deep teal and clear turquoise.", colors: { light: ["#edf4f3", "#fcfffe", "#006f77"], dark: ["#071f23", "#103237", "#33cdbc"] } },
  { id: "forest", name: "Forest", description: "Rich emerald and fresh fern green.", colors: { light: ["#edf3ec", "#fdfff9", "#296b36"], dark: ["#101f12", "#1a3020", "#8bcf74"] } },
  { id: "sepia", name: "Sepia", description: "Parchment, ink, and terracotta.", colors: { light: ["#f7efe2", "#fffaf3", "#ab432b"], dark: ["#241a17", "#352620", "#ec9464"] } },
] as const;

export const THEME_STYLES = [
  ...CLASSICS.map(style => ({ ...style, category: "classic" as const })),
  ...CHARACTERS.map(style => ({ ...style, category: "character" as const })),
];

export function themeFor(character: ThemeFamily, mode: ThemeMode): Theme {
  return `${character}-${mode}`;
}

export type ThemeDefinition = {
  id: Theme;
  name: string;
  character: ThemeFamily;
  category: ThemeCategory;
  mode: ThemeMode;
  description: string;
  colors: ThemeColors;
  title: string;
  label: string;
};

export const THEMES: readonly ThemeDefinition[] = THEME_STYLES.flatMap(character =>
  (["light", "dark"] as const).map(mode => ({
    id: themeFor(character.id, mode),
    name: `${character.name} · ${mode === "light" ? "Light" : "Dark"}`,
    character: character.id,
    category: character.category,
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
  "pochacco-light": "forest-light",
  "pochacco-dark": "forest-dark",
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

export function setThemeCharacter(value: unknown, character: ThemeFamily): Theme {
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
