"use client";
import StudyMascot from "./StudyMascot";

export default function Avatar({
  id = "cat",
  className = "",
  label,
}: {
  id?: string;
  className?: string;
  label?: string;
}) {
  if (["cat", "fox", "bunny", "bear"].includes(id))
    return (
      <span
        className={`ds-avatar ${className}`}
        role={label ? "img" : undefined}
        aria-label={label}
      >
        <StudyMascot animal={id as "cat" | "fox" | "bunny" | "bear"} />
      </span>
    );
  if (id.startsWith("portrait-")) {
    const [, gender, outfit, index] = id.split("-");
    const n = Number(index) || 0,
      female = gender === "female";
    const skin = [
      "#f3cbb0",
      "#dbaa83",
      "#ad7754",
      "#82563f",
      "#f0c4a2",
      "#ca916e",
      "#9b694f",
      "#edb58e",
    ][n % 8];
    const hair = [
      "#292724",
      "#50392e",
      "#322d35",
      "#1b2529",
      "#6b4634",
      "#2d2524",
      "#3d3031",
      "#302d28",
    ][n % 8];
    const shirt =
      outfit === "scrubs"
        ? "#6c92ad"
        : outfit === "sport"
          ? "#d7b7d6"
          : outfit === "formal"
            ? "#564364"
            : female && outfit === "daily"
              ? "#e7aabb"
              : "#faf1e5";
    return (
      <svg
        className={`ds-avatar ${className}`}
        viewBox="0 0 100 100"
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={!label || undefined}
      >
        <rect
          width="100"
          height="100"
          rx="24"
          fill={["#dacdc1", "#c9d9cb", "#e2cad3", "#cdd4e0"][n % 4]}
        />
        {female && <path d="M24 49C18 10 80 8 77 48l5 40H18Z" fill={hair} />}
        <path d="M12 103V85c0-18 18-25 38-25s38 7 38 25v18" fill={shirt} />
        <path d="M42 55v14l8 6 8-6V55" fill={skin} />
        <ellipse cx="50" cy="39" rx="23" ry="27" fill={skin} />
        <path
          d={
            female
              ? "M26 36C22 8 74 4 74 35 54 29 48 18 45 20 42 30 32 31 26 36Z"
              : "M26 35C17 9 78 0 75 37L65 23 46 25 34 21Z"
          }
          fill={hair}
        />
        <g fill="#302923">
          <ellipse cx="41" cy="41" rx="2" ry="2.6" />
          <ellipse cx="60" cy="41" rx="2" ry="2.6" />
        </g>
        <path
          d="M44 53q6 5 12-1"
          stroke="#8b5348"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        {n % 3 === 1 && (
          <g fill="none" stroke="#514947" strokeWidth="1.5">
            <rect x="32" y="36" width="16" height="12" rx="4" />
            <rect x="53" y="36" width="16" height="12" rx="4" />
            <path d="M48 39h5" />
          </g>
        )}
        {outfit === "daily" && (
          <>
            <path
              d="m40 65 10 10-9 9-10-15m29-4L50 75l9 9 10-15"
              fill="#fff6ed"
            />
            <path d="M50 76v24" stroke="#bb929c" />
          </>
        )}
        {["clinical", "lab"].includes(outfit) && (
          <>
            <path
              d="m40 65-9 6 11 29m18-35 9 6-11 29"
              fill="none"
              stroke="#c8c1c6"
              strokeWidth="2"
            />
            <path d="M63 83h13v9H63Z" fill="#e7b3c5" />
            <path d="M47 72h6v28h-6" fill="#d6b8cb" />
          </>
        )}
        {outfit === "scrubs" && (
          <path
            d="m38 65 12 15 12-15"
            stroke="#d2e8ec"
            strokeWidth="3"
            fill="none"
          />
        )}
        {outfit === "formal" && (
          <>
            <path d="m40 65 10 10 10-10" fill="white" />
            <path d="m50 75-4 8 4 17 4-17Z" fill="#d3a5bf" />
          </>
        )}
        {outfit === "sport" && (
          <path d="M15 85h70" stroke="#45415d" strokeWidth="7" />
        )}
        <circle cx="73" cy="76" r="3" fill="#cc789a" />
      </svg>
    );
  }
  const white = ["cinnamoroll", "hello-kitty", "pochacco"].includes(id);
  const fur = white
    ? "#fff9ed"
    : id === "pompompurin"
      ? "#f6d66f"
      : id === "keroppi"
        ? "#a8d879"
        : id === "my-melody"
          ? "#f0a8bf"
          : id === "kuromi"
            ? "#554867"
            : id === "panda"
              ? "#f7f0df"
              : id === "penguin" || id === "badtz-maru"
                ? "#3d4653"
                : id === "tuxedosam"
                  ? "#86b8d9"
                  : id === "duck"
                    ? "#f3d477"
                    : id === "owl"
                      ? "#bc9578"
                      : id === "capybara"
                        ? "#bd946e"
                        : "#c5a17d";
  const dark = "#3e3541",
    long =
      id === "cinnamoroll" ||
      id === "dog" ||
      id === "pochacco" ||
      id === "pompompurin";
  return (
    <svg
      className={`ds-avatar character-avatar ${className}`}
      viewBox="0 0 100 100"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={!label || undefined}
    >
      <ellipse cx="50" cy="92" rx="28" ry="4" fill="#413848" opacity=".12" />
      <g className="character-body">
        <ellipse cx="50" cy="73" rx="24" ry="21" fill={fur} />
        <ellipse cx="33" cy="88" rx="12" ry="7" fill={fur} />
        <ellipse cx="67" cy="88" rx="12" ry="7" fill={fur} />
        {long ? (
          <>
            <ellipse
              cx="16"
              cy="46"
              rx={id === "cinnamoroll" ? 15 : 10}
              ry="23"
              transform="rotate(30 16 46)"
              fill={id === "pochacco" ? dark : fur}
            />
            <ellipse
              cx="84"
              cy="46"
              rx={id === "cinnamoroll" ? 15 : 10}
              ry="23"
              transform="rotate(-30 84 46)"
              fill={id === "pochacco" ? dark : fur}
            />
          </>
        ) : ["kuromi", "hello-kitty", "badtz-maru"].includes(id) ? (
          <path
            d="m20 35 1-24 24 19m12 0 22-19 2 24"
            fill={fur}
            stroke={fur}
            strokeWidth="5"
          />
        ) : id === "my-melody" ? (
          <>
            <ellipse cx="34" cy="20" rx="10" ry="20" fill={fur} />
            <ellipse cx="65" cy="20" rx="10" ry="20" fill={fur} />
          </>
        ) : (
          <>
            <circle cx="27" cy="29" r="11" fill={id === "panda" ? dark : fur} />
            <circle cx="73" cy="29" r="11" fill={id === "panda" ? dark : fur} />
          </>
        )}
        <ellipse cx="50" cy="44" rx="34" ry="27" fill={fur} />
        {["kuromi", "my-melody", "penguin", "tuxedosam", "owl"].includes(
          id,
        ) && <ellipse cx="50" cy="49" rx="25" ry="20" fill="#fff6e5" />}
        {id === "keroppi" && (
          <>
            <circle cx="34" cy="29" r="15" fill="white" />
            <circle cx="66" cy="29" r="15" fill="white" />
          </>
        )}
        {id === "panda" && (
          <>
            <ellipse cx="36" cy="44" rx="10" ry="13" fill={dark} />
            <ellipse cx="64" cy="44" rx="10" ry="13" fill={dark} />
          </>
        )}
        <g
          className="character-eyes"
          fill={
            id === "cinnamoroll" ? "#6597bd" : id === "panda" ? "white" : dark
          }
        >
          <ellipse cx="36" cy={id === "keroppi" ? 29 : 44} rx="3" ry="4" />
          <ellipse cx="64" cy={id === "keroppi" ? 29 : 44} rx="3" ry="4" />
        </g>
        <ellipse cx="26" cy="54" rx="6" ry="3" fill="#eda7a5" opacity=".7" />
        <ellipse cx="74" cy="54" rx="6" ry="3" fill="#eda7a5" opacity=".7" />
        {["duck", "penguin", "tuxedosam", "badtz-maru", "owl"].includes(id) ? (
          <path d="m44 53 6-5 6 5-6 6Z" fill="#e9b250" />
        ) : (
          <ellipse
            cx="50"
            cy="53"
            rx="3.5"
            ry="2.5"
            fill={id === "hello-kitty" ? "#dfb256" : dark}
          />
        )}
        {id !== "hello-kitty" && (
          <path
            d="M45 59q5 5 10 0"
            stroke={dark}
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
          />
        )}
        {id === "pompompurin" && (
          <>
            <ellipse cx="50" cy="20" rx="22" ry="7" fill="#865737" />
            <ellipse cx="50" cy="15" rx="15" ry="9" fill="#865737" />
            <path d="M51 7V4" stroke="#865737" strokeWidth="4" />
          </>
        )}
        {id === "kuromi" && (
          <>
            <path d="m44 28 6-6 6 6v7H44Z" fill="#f1b3cc" />
            <circle cx="47" cy="29" r="1.5" fill={dark} />
            <circle cx="53" cy="29" r="1.5" fill={dark} />
          </>
        )}
        {["hello-kitty", "my-melody"].includes(id) && (
          <g fill={id === "hello-kitty" ? "#dc526e" : "#fff2cf"}>
            <path d="m65 24 12-8 5 16-16-1Z" />
            <path d="m66 24-12-8-5 16 16-1Z" />
            <circle cx="65" cy="25" r="5" />
          </g>
        )}
        {id === "hello-kitty" && (
          <g stroke={dark} strokeWidth="1.5">
            <path d="m16 48 10 2m-10 6 10-2m48-4 10-2m-10 6 10 2" />
          </g>
        )}
        <path
          d="m38 72 12 8 12-8"
          fill="none"
          stroke="#dc9f85"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
