"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Moon, Sun } from "lucide-react";
import ThemeEmblem from "./ThemeEmblem";
import {
  THEME_STYLES,
  getTheme,
  setThemeCharacter,
  setThemeMode,
  type Theme,
  type ThemeCategory,
} from "../community/themes";

export default function ThemePicker({
  value,
  onChange,
  compact = true,
}: {
  value: Theme;
  onChange: (theme: Theme) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ThemeCategory>(() => getTheme(value).category);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = getTheme(value);
  const family = THEME_STYLES.find(item => item.id === selected.character)!;

  useEffect(() => {
    if (!open) setCategory(selected.category);
  }, [open, selected.category]);

  useEffect(() => {
    if (!compact || !open) return;
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLInputElement>("input:checked")?.focus());
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [compact, open]);

  const choices = (
    <>
      <div className="theme-picker-heading">
        <small>MAKE IT YOURS</small>
        <strong>Choose your study mood</strong>
      </div>
      <div className="theme-collection-tabs" role="tablist" aria-label="Theme collection" onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "classic" : event.key === "End" ? "character" : category === "classic" ? "character" : "classic";
        setCategory(next);
        event.currentTarget.querySelector<HTMLButtonElement>(`[data-collection="${next}"]`)?.focus();
      }}>
        {(["classic", "character"] as const).map(collection => <button key={collection} id={`${id}-${collection}-tab`} data-collection={collection} type="button" role="tab" tabIndex={category === collection ? 0 : -1} aria-selected={category === collection} aria-controls={`${id}-collection`} onClick={() => setCategory(collection)}>{collection === "classic" ? "Classic" : "Characters"}</button>)}
      </div>
      <div className="theme-collection-panel" id={`${id}-collection`} role="tabpanel" aria-labelledby={`${id}-${category}-tab`}>
      <fieldset className="theme-character-fieldset">
        <legend>{category === "classic" ? "Palette" : "Character"}</legend>
        <div className={category === "classic" ? "theme-classic-options" : "theme-character-options"}>
          {THEME_STYLES.filter(item => item.category === category).map(item => (
            <label
              key={item.id}
              className={`theme-character-choice${category === "classic" ? " theme-classic-choice" : ""}${selected.character === item.id ? " is-selected" : ""}`}
              data-character={item.id}
              data-mode={selected.mode}
            >
              <input
                className="theme-option-radio"
                type="radio"
                aria-label={item.name}
                name={`theme-character-${id}`}
                value={item.id}
                checked={selected.character === item.id}
                onChange={() => onChange(setThemeCharacter(value, item.id))}
              />
              <ThemeEmblem family={item.id} className="theme-character-avatar" />
              <span className="theme-character-name">{item.name}</span>
              {category === "classic" && <small className="theme-classic-description">{item.description}</small>}
              <span className={category === "classic" ? "theme-classic-preview" : "theme-character-swatches"} aria-hidden="true">
                {item.colors[selected.mode].map(color => <i key={color} style={{ backgroundColor: color }} />)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      </div>
      <fieldset className="theme-mode-fieldset">
        <legend>Appearance</legend>
        <div className="theme-mode-options" role="radiogroup" aria-label="Color mode">
          {(["light", "dark"] as const).map(mode => (
            <label key={mode} className={`theme-mode-option${selected.mode === mode ? " is-selected" : ""}`}>
              <input
                className="theme-option-radio"
                type="radio"
                name={`theme-mode-${id}`}
                value={mode}
                checked={selected.mode === mode}
                onChange={() => onChange(setThemeMode(value, mode))}
              />
              {mode === "light" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
              <span>{mode === "light" ? "Light" : "Dark"}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );

  return (
    <div ref={root} className={`theme-picker ${compact ? "theme-picker-compact" : "theme-picker-full"}`} onBlur={event => {
      if (compact && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      {compact && (
        <button
          ref={trigger}
          className="theme-toggle"
          type="button"
          onClick={() => { if (!open) setCategory(selected.category); setOpen(previous => !previous); }}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={`theme-picker-${id}`}
          aria-label={`Change theme. Current: ${family.name}, ${selected.mode} mode`}
          title={`${family.name} · ${selected.mode === "light" ? "Light" : "Dark"}`}
        >
          <ThemeEmblem family={selected.character} className="theme-trigger-avatar" />
          <span className="theme-picker-current">
            <span className="theme-picker-current-character">{family.name}</span>
            <span className="theme-picker-current-mode">{selected.mode === "light" ? "Light" : "Dark"}</span>
          </span>
          <ChevronDown className="theme-picker-chevron" size={14} aria-hidden="true" />
        </button>
      )}
      {(!compact || open) && (
        <div ref={panel} id={`theme-picker-${id}`} className={compact ? "theme-picker-popover" : "theme-picker-content"} role={compact ? "dialog" : undefined} aria-label={compact ? "Choose character and appearance" : undefined}>
          {choices}
        </div>
      )}
    </div>
  );
}
