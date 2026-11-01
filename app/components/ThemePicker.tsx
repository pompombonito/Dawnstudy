"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Moon, Sun } from "lucide-react";
import Avatar from "./Avatar";
import {
  CHARACTERS,
  getTheme,
  setThemeCharacter,
  setThemeMode,
  type Theme,
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
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = getTheme(value);
  const character = CHARACTERS.find(item => item.id === selected.character)!;

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
      <fieldset className="theme-character-fieldset">
        <legend>Character</legend>
        <div className="theme-character-options">
          {CHARACTERS.map(item => (
            <label
              key={item.id}
              className={`theme-character-choice${selected.character === item.id ? " is-selected" : ""}`}
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
              <Avatar id={item.id} className="theme-character-avatar" />
              <span className="theme-character-name">{item.name}</span>
              <span className="theme-character-swatches" aria-hidden="true">
                {item.colors[selected.mode].map(color => <i key={color} style={{ backgroundColor: color }} />)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
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
          onClick={() => setOpen(previous => !previous)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={`theme-picker-${id}`}
          aria-label={`Change theme. Current: ${character.name}, ${selected.mode} mode`}
          title={`${character.name} · ${selected.mode === "light" ? "Light" : "Dark"}`}
        >
          <Avatar id={selected.character} className="theme-trigger-avatar" />
          <span className="theme-picker-current">
            <span className="theme-picker-current-character">{character.name}</span>
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
