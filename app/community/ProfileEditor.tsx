"use client";
import { useState } from "react";
import Avatar from "../components/Avatar";
import { animals, portraits, themes } from "./catalog";
import type { ProfileInput, Theme } from "./types";

export const defaultProfile: ProfileInput = {
  nickname: "",
  avatar_id: "cat",
  gender: "prefer-not-to-say",
  theme: "dark",
  discoverable: false,
  companion_id: "cat",
  companion_name: "Miso",
};
export function ThemeChoices({
  value,
  onChange,
}: {
  value: Theme;
  onChange: (theme: Theme) => void;
}) {
  return (
    <div className="theme-choices">
      {themes.map((t) => (
        <button
          type="button"
          key={t.id}
          className={`theme-card theme-${t.id} ${value === t.id ? "chosen" : ""}`}
          aria-pressed={value === t.id}
          onClick={() => onChange(t.id)}
        >
          <span className="theme-swatch">
            <i />
            <i />
            <i />
          </span>
          <strong>{t.label}</strong>
          <small>{t.description}</small>
        </button>
      ))}
    </div>
  );
}
export function AvatarPicker({
  value,
  onChange,
  companions = false,
}: {
  value: string;
  onChange: (id: string) => void;
  companions?: boolean;
}) {
  const [filter, setFilter] = useState("animals");
  const [outfit, setOutfit] = useState("all");
  const [limit, setLimit] = useState(24);
  const choices =
    filter === "animals"
      ? animals.slice(0, 10).map(([id, label]) => ({ id, label }))
      : filter === "characters"
        ? animals.slice(10).map(([id, label]) => ({ id, label }))
        : portraits.filter(
            (p) =>
              p.id.includes(`-${filter}-`) &&
              (outfit === "all" || p.id.includes(`-${outfit}-`)),
          );
  return (
    <div className="avatar-picker">
      <div className="segmented" role="group" aria-label="Icon category">
        {[
          ...[
            ["animals", "Animals"],
            ["characters", "Characters"],
          ],
          ...(!companions
            ? [
                ["female", "Feminine"],
                ["male", "Masculine"],
              ]
            : []),
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={filter === id}
            onClick={() => {
              setFilter(id);
              setLimit(24);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {!companions && ["male", "female"].includes(filter) && (
        <label className="outfit-filter">
          Study outfit
          <select
            value={outfit}
            onChange={(e) => {
              setOutfit(e.target.value);
              setLimit(24);
            }}
          >
            <option value="all">All outfits</option>
            <option value="daily">Pink &amp; white</option>
            <option value="clinical">Clinical whites</option>
            <option value="lab">Lab coat</option>
            <option value="scrubs">Scrubs</option>
            <option value="sport">PE</option>
            <option value="formal">Formal</option>
          </select>
        </label>
      )}
      <div className="avatar-grid">
        {choices.slice(0, limit).map((choice) => (
          <button
            type="button"
            key={choice.id}
            className={value === choice.id ? "chosen" : ""}
            title={choice.label}
            aria-label={choice.label}
            aria-pressed={value === choice.id}
            onClick={() => onChange(choice.id)}
          >
            <Avatar id={choice.id} />
            <small>
              {choice.label.split(" · ").slice(1).join(" · ") || choice.label}
            </small>
          </button>
        ))}
      </div>
      {limit < choices.length && (
        <button
          className="social-button"
          type="button"
          onClick={() => setLimit(limit + 24)}
        >
          Show more icons
        </button>
      )}
    </div>
  );
}
export default function ProfileEditor({
  value,
  onChange,
  setTheme,
}: {
  value: ProfileInput;
  onChange: (value: ProfileInput) => void;
  setTheme: (theme: Theme) => void;
}) {
  return (
    <div className="profile-editor">
      <div className="profile-preview">
        <Avatar id={value.avatar_id} />
        <div>
          <strong>{value.nickname || "Your next chapter"}</strong>
          <small>Your nickname and icon are visible to other people.</small>
        </div>
      </div>
      <div className="profile-fields">
        <label>
          Public nickname
          <input
            value={value.nickname}
            onChange={(e) => onChange({ ...value, nickname: e.target.value })}
            maxLength={24}
            minLength={2}
            required
            placeholder="What should friends call you?"
            autoComplete="nickname"
          />
        </label>
        <label>
          Gender <small>Private · optional</small>
          <select
            value={value.gender}
            onChange={(e) =>
              onChange({
                ...value,
                gender: e.target.value as ProfileInput["gender"],
              })
            }
          >
            <option value="prefer-not-to-say">Prefer not to say</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="gender-diverse">Non-binary / gender-diverse</option>
          </select>
        </label>
      </div>
      <label className="checkline">
        <input
          type="checkbox"
          checked={value.discoverable}
          onChange={(e) =>
            onChange({ ...value, discoverable: e.target.checked })
          }
        />
        <span>
          <strong>Let other students find me</strong>
          <small>
            Show my nickname, icon and friend tag in Explore. You choose which
            requests to accept.
          </small>
        </span>
      </label>
      <h3>
        Find your look <span className="subtle">115 icons</span>
      </h3>
      <AvatarPicker
        value={value.avatar_id}
        onChange={(id) => onChange({ ...value, avatar_id: id })}
      />
      <small className="subtle">
        Choose any style, regardless of gender. Portrait outfits are stylized
        CEU-inspired looks.
      </small>
      <h3>Set the mood</h3>
      <ThemeChoices
        value={value.theme}
        onChange={(theme) => {
          onChange({ ...value, theme });
          setTheme(theme);
        }}
      />
    </div>
  );
}
