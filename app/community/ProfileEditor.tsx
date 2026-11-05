"use client";
import { useState } from "react";
import Avatar from "../components/Avatar";
import { animals, portraits } from "./catalog";
import { allCompanionCharacters, animeSeries, kpopGroups, animeCompanionBubble, companionCategory, filterAnimeCharacters, filterKpopCharacters, findAnimeCharacter } from "./anime-companions";
import ThemePicker from "../components/ThemePicker";
import { DEFAULT_THEME } from "./themes";
import type { ProfileInput, Theme } from "./types";

export const defaultProfile: ProfileInput = {
  nickname: "",
  avatar_id: "cat",
  gender: "prefer-not-to-say",
  theme: DEFAULT_THEME,
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
  return <ThemePicker value={value} onChange={onChange} compact={false}/>;
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
  const [filter, setFilter] = useState<string>(companionCategory(value) || "animals");
  const [outfit, setOutfit] = useState("all");
  const [series, setSeries] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(24);
  const selectedId = findAnimeCharacter(value)?.id || value;
  const choices =
    filter === "animals"
      ? animals.slice(0, 10).map(([id, label]) => ({ id, label }))
      : filter === "characters"
        ? animals.slice(10).map(([id, label]) => ({ id, label }))
        : filter === "anime" || filter === "kpop"
          ? (filter === "kpop" ? filterKpopCharacters(series, search) : filterAnimeCharacters(series, search)).map((character) => ({
              id: character.id,
              label: character.name,
              series: character.series,
            }))
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
            ["anime", "Anime"],
            ["kpop", "K-pop"],
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
              setSeries("all");
              setSearch("");
              setLimit(24);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {(filter === "anime" || filter === "kpop") && (
        <div className="anime-filters">
          <label className="outfit-filter">
            {filter === "kpop" ? "K-pop group" : "Anime series"}
            <select
              aria-label={filter === "kpop" ? "K-pop group" : "Anime series"}
              value={series}
              onChange={(event) => {
                setSeries(event.target.value);
                setLimit(24);
              }}
            >
              <option value="all">{filter === "kpop" ? "All groups" : "All series"}</option>
              {(filter === "kpop" ? kpopGroups : animeSeries).map((title) => <option key={title} value={title}>{title}</option>)}
            </select>
          </label>
          <label className="outfit-filter">
            {filter === "kpop" ? "Search artists" : "Search anime characters"}
            <input
              aria-label={filter === "kpop" ? "Search artists" : "Search anime characters"}
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setLimit(24);
              }}
              placeholder={filter === "kpop" ? "Artist or group" : "Character or series"}
            />
          </label>
          <small className="subtle" role="status">{choices.length} {filter === "kpop" ? choices.length === 1 ? "artist" : "artists" : choices.length === 1 ? "character" : "characters"}</small>
        </div>
      )}
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
            className={selectedId === choice.id ? "chosen" : ""}
            title={"series" in choice ? `${choice.label} · ${choice.series}\n${animeCompanionBubble(choice.id, 1)?.text || ""}` : choice.label}
            aria-label={"series" in choice ? `${choice.label} · ${choice.series}` : choice.label}
            aria-pressed={selectedId === choice.id}
            onClick={() => onChange(choice.id)}
          >
            <Avatar id={choice.id} />
            <small>
              {choice.label.split(" · ").slice(1).join(" · ") || choice.label}
            </small>
            {"series" in choice && <small>{String(choice.series)}</small>}
          </button>
        ))}
      </div>
      {choices.length === 0 && <p className="subtle">{filter === "kpop" ? "No artists match. Try another name or group." : "No characters match. Try another name or series."}</p>}
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
        Find your look <span className="subtle">{animals.length + portraits.length + allCompanionCharacters.length} icons</span>
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
