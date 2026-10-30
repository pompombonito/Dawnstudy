"use client";
import { useEffect, useRef, useState } from "react";
import { Copy, Flag, Gamepad2, Trophy, Volume2, VolumeX } from "lucide-react";
import Avatar from "../components/Avatar";
import { communityApi } from "./api";
import type { Community } from "./useCommunity";
import type { Game } from "./types";

type QuizSet = { id: string; title: string; type: string; items: unknown[] };
export default function GameRoom({
  community,
  sets,
  initialSet = "",
  friends,
}: {
  community: Community;
  sets: QuizSet[];
  initialSet?: string;
  friends: () => void;
}) {
  const [game, setGame] = useState<Game | null>(null),
    [selected, setSelected] = useState(initialSet),
    [code, setCode] = useState(""),
    [answer, setAnswer] = useState<string | string[]>(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [remaining, setRemaining] = useState(0),
    [sound, setSound] = useState(false);
  const audio = useRef<AudioContext | null>(null),
    previous = useRef(""),
    clockOffset = useRef(0),
    roomRef = useRef("");
  const key = `dawnstudy-live-room:${community.userId}`;
  useEffect(() => {
    if (
      initialSet &&
      sets.some((s) => s.id === initialSet && s.type !== "flashcards")
    )
      setSelected(initialSet);
  }, [initialSet]);
  function remember(next: Game) {
    if (roomRef.current && roomRef.current !== next.code) return;
    clockOffset.current = next.server_time - Date.now();
    setGame(next);
    roomRef.current = next.code;
    localStorage.setItem(key, next.code);
  }
  function tone(success = true) {
    if (!sound) return;
    try {
      const ctx = audio.current || new AudioContext();
      audio.current = ctx;
      void ctx.resume();
      [0, 0.12, 0.24].forEach((delay, i) => {
        const oscillator = ctx.createOscillator(),
          gain = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = (
          success ? [523, 659, 784] : [330, 294, 262]
        )[i];
        gain.gain.setValueAtTime(0.06, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          ctx.currentTime + delay + 0.18,
        );
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(ctx.currentTime + delay);
        oscillator.stop(ctx.currentTime + delay + 0.2);
      });
    } catch {
      /* Silent mode if browser audio is unavailable. */
    }
  }
  useEffect(() => {
    setSound(localStorage.getItem("dawnstudy-game-sound") === "true");
    const saved = localStorage.getItem(key);
    if (!saved) return;
    roomRef.current = saved;
    void communityApi<Game>(community.token, `/games/${saved}`)
      .then(remember)
      .catch((e) => {
        localStorage.removeItem(key);
        roomRef.current = "";
        setError(e.message);
      });
  }, [community.userId]);
  useEffect(() => {
    if (!game?.code || game.phase === "finished") return;
    const code = game.code;
    let active = true,
      pending = false;
    const poll = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const next = await communityApi<Game>(
          community.token,
          `/games/${code}`,
        );
        if (active) {
          remember(next);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(() => void poll(), 1300);
    document.addEventListener("visibilitychange", poll);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [game?.code, game?.phase, community.token]);
  useEffect(() => {
    if (!game) return;
    const phase = `${game.code}:${game.index}:${game.phase}`;
    if (phase !== previous.current) {
      if (game.phase === "question") {
        setAnswer(game.kind === "checkbox" ? [] : "");
        tone();
      }
      if (game.phase === "reveal") tone(game.feedback?.correct);
      if (game.phase === "finished") tone();
      previous.current = phase;
    }
    const update = () =>
      setRemaining(
        Math.max(
          0,
          Math.ceil((game.deadline - Date.now() - clockOffset.current) / 1000),
        ),
      );
    update();
    const timer = setInterval(update, 200);
    return () => clearInterval(timer);
  }, [game?.index, game?.phase, game?.deadline]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  async function operation(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function act(action: string, extra: Record<string, unknown> = {}) {
    const next = await communityApi<Game>(
      community.token,
      `/games/${game!.code}`,
      { action, ...extra },
    );
    remember(next);
  }
  async function join(value: string) {
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(normalized))
      throw new Error("Enter the six-character room code.");
    const result = await communityApi<Game>(
      community.token,
      `/games/${normalized}`,
      { action: "join" },
    );
    roomRef.current = normalized;
    remember(result);
  }
  const available = sets.filter(
    (s) => s.type !== "flashcards" && s.items.length,
  );
  return (
    <div className="workspace-view community-page games-page">
      <div className="workspace-page-heading">
        <span className="eyebrow">
          SAME QUESTION. A LITTLE FRIENDLY COMPETITION.
        </span>
        <h1>Meet at the finish line.</h1>
        <p>
          Up to 12 friends. 25 seconds per question. Accuracy comes first; quick
          correct answers earn a bonus.
        </p>
      </div>
      <div className="game-toolbar">
        <button
          className="social-button"
          aria-pressed={sound}
          onClick={() => {
            const next = !sound;
            setSound(next);
            localStorage.setItem("dawnstudy-game-sound", String(next));
            if (next) {
              try {
                audio.current ||= new AudioContext();
                void audio.current.resume();
              } catch {
                /* Audio optional. */
              }
            }
          }}
        >
          {sound ? <Volume2 size={17} /> : <VolumeX size={17} />} Sound{" "}
          {sound ? "on" : "off"}
        </button>
        {game && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              void operation(async () => {
                try {
                  await communityApi(community.token, `/games/${game.code}`, {
                    action: "leave",
                  });
                } finally {
                  roomRef.current = "";
                  setGame(null);
                  localStorage.removeItem(key);
                }
              })
            }
          >
            Leave game
          </button>
        )}
      </div>
      {error && (
        <p className="social-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="social-success" role="status">
          {notice}
        </p>
      )}
      {!game ? (
        <>
          <div className="game-entry">
            <section className="social-card game-host">
              <Gamepad2 size={34} />
              <h2>Your quiz. Your crew.</h2>
              <p>
                Host a saved quiz and invite accepted friends. Each game uses up
                to 30 questions.
              </p>
              <label>
                Choose a quiz
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Select from your library</option>
                  {available.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} · {s.items.length} questions
                    </option>
                  ))}
                </select>
              </label>
              {!available.length && (
                <p className="subtle">
                  Create and save a scored quiz first. Flashcards are for
                  individual review.
                </p>
              )}
              <button
                className="social-button primary"
                disabled={!selected || busy}
                onClick={() =>
                  void operation(async () => {
                    roomRef.current = "";
                    const created = await communityApi<Game>(
                      community.token,
                      "/games",
                      { set_id: selected },
                    );
                    remember(created);
                  })
                }
              >
                Create a room →
              </button>
            </section>
            <section className="social-card">
              <Flag size={28} />
              <h2>Got an invitation?</h2>
              <p>
                Enter your friend's room code. You must be accepted friends with
                the host.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void operation(() => join(code));
                }}
              >
                <label>
                  Room code
                  <input
                    className="room-code-input"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="ABC234"
                    maxLength={6}
                    autoComplete="off"
                  />
                </label>
                <button
                  className="social-button"
                  disabled={busy || code.length !== 6}
                >
                  Join a friend
                </button>
              </form>
              <button className="text-button" onClick={friends}>
                Find your study friends ↗
              </button>
            </section>
          </div>
          {community.data!.invitations.length > 0 && (
            <section className="social-card">
              <h2>You're invited</h2>
              {community.data!.invitations.map((inv) => (
                <div className="game-invitation" key={inv.code}>
                  <span>
                    {inv.title} · <b>{inv.code}</b>
                  </span>
                  <button
                    className="social-button primary"
                    disabled={busy}
                    onClick={() => void operation(() => join(inv.code))}
                  >
                    Join room
                  </button>
                </div>
              ))}
            </section>
          )}
        </>
      ) : (
        <section className={`social-card live-game phase-${game.phase}`}>
          <header className="game-header">
            <div>
              <span className="eyebrow">
                {game.phase === "lobby"
                  ? "THE LOBBY"
                  : game.phase === "finished"
                    ? "THE FINISH LINE"
                    : `ROUND ${game.index + 1} OF ${game.total}`}
              </span>
              <h2>{game.title}</h2>
            </div>
            <button
              className="game-code"
              title="Copy room code"
              onClick={() =>
                void navigator.clipboard
                  .writeText(game.code)
                  .then(() => setNotice("Room code copied."))
                  .catch(() => setNotice(`Room code: ${game.code}`))
              }
            >
              {game.code}
              <Copy size={15} />
            </button>
          </header>
          {game.phase === "lobby" ? (
            <>
              <h3 className="lobby-title">The more minds, the merrier.</h3>
              <div className="lobby-players">
                {game.players.map((p) => (
                  <div key={p.id}>
                    <Avatar id={p.avatar_id} />
                    <strong>{p.nickname}</strong>
                    <small>{p.id === game.host ? "Host" : "Ready"}</small>
                  </div>
                ))}
              </div>
              {community.userId === game.host ? (
                <>
                  <div className="invite-friends">
                    <h3>Invite a friend</h3>
                    {community
                      .data!.friends.filter(
                        (p) =>
                          !game.players.some((player) => player.id === p.id),
                      )
                      .map((p) => (
                        <button
                          key={p.id}
                          className="social-button"
                          disabled={busy}
                          onClick={() =>
                            void operation(async () => {
                              await act("invite", { user_id: p.id });
                              setNotice(
                                `Invitation sent to ${p.nickname}. They can join from Play together.`,
                              );
                            })
                          }
                        >
                          <Avatar id={p.avatar_id} />
                          {p.nickname} +
                        </button>
                      ))}
                    {!community.data!.friends.length && (
                      <button className="text-button" onClick={friends}>
                        Add a study friend first →
                      </button>
                    )}
                  </div>
                  <button
                    className="social-button primary start-game"
                    disabled={busy || game.players.length < 2}
                    onClick={() => void operation(() => act("start"))}
                  >
                    {game.players.length < 2
                      ? "Waiting for one more friend…"
                      : "Everybody ready? Let's play →"}
                  </button>
                </>
              ) : (
                <p className="social-empty">
                  You're in! Waiting for the host to start.
                </p>
              )}
              <p className="subtle">
                Live rooms last for this server session. Refreshing reconnects
                you automatically.
              </p>
            </>
          ) : game.phase === "countdown" ? (
            <div className="game-countdown" role="status">
              <span>Find your focus.</span>
              <strong key={remaining}>{remaining || "GO"}</strong>
              <p>Everyone gets the same question.</p>
            </div>
          ) : game.phase === "finished" ? (
            <>
              <div className="podium-celebration">
                <div className="confetti" aria-hidden="true">
                  {Array.from({ length: 18 }, (_, i) => (
                    <i key={i} style={{ "--i": i } as React.CSSProperties} />
                  ))}
                </div>
                <Trophy size={48} />
                <h3>Give yourselves a hand.</h3>
                <p>
                  {game.players.find((p) => p.id === community.userId)?.rank ===
                  1
                    ? "You earned the top spot!"
                    : "Every round is another way to learn."}
                </p>
              </div>
              <ol className="leaderboard">
                {game.players.map((p) => (
                  <li
                    key={p.id}
                    className={p.id === community.userId ? "you" : ""}
                  >
                    <b className="placement">
                      {p.rank === 1
                        ? "🥇"
                        : p.rank === 2
                          ? "🥈"
                          : p.rank === 3
                            ? "🥉"
                            : `#${p.rank}`}
                    </b>
                    <Avatar id={p.avatar_id} />
                    <span>
                      <strong>
                        {p.nickname}
                        {p.id === community.userId ? " (you)" : ""}
                      </strong>
                      <small>
                        {p.correct} / {game.total} correct
                      </small>
                    </span>
                    <b>
                      {p.points.toLocaleString()} <small>pts</small>
                    </b>
                  </li>
                ))}
              </ol>
              <button
                className="social-button primary"
                onClick={() => {
                  roomRef.current = "";
                  setGame(null);
                  localStorage.removeItem(key);
                }}
              >
                Another round?
              </button>
            </>
          ) : (
            <div className="game-round" key={game.index}>
              <div className="round-meta">
                <span>
                  {game.kind === "checkbox"
                    ? "Select all that apply"
                    : game.kind === "identification"
                      ? "Name the concept"
                      : "Pick your answer"}
                </span>
                <strong className={remaining <= 5 ? "urgent" : ""}>
                  {remaining}s
                </strong>
              </div>
              <div className="round-timer">
                <i
                  style={{
                    width: `${Math.min(100, (remaining / (game.phase === "reveal" ? 5 : 25)) * 100)}%`,
                  }}
                />
              </div>
              <h3>{game.question?.question}</h3>
              {game.question?.options?.length ? (
                <div className="game-options">
                  {game.question.options.map((option, i) => (
                    <button
                      key={option}
                      className={
                        (
                          Array.isArray(answer)
                            ? answer.includes(option)
                            : answer === option
                        )
                          ? "chosen"
                          : ""
                      }
                      disabled={
                        game.answered || game.phase !== "question" || busy
                      }
                      onClick={() => {
                        if (game.kind === "checkbox")
                          setAnswer((old) =>
                            Array.isArray(old)
                              ? old.includes(option)
                                ? old.filter((o) => o !== option)
                                : [...old, option]
                              : [option],
                          );
                        else setAnswer(option);
                      }}
                    >
                      <b>{String.fromCharCode(65 + i)}</b>
                      {option}
                    </button>
                  ))}
                </div>
              ) : (
                <label>
                  Your answer
                  <input
                    value={typeof answer === "string" ? answer : ""}
                    onChange={(e) => setAnswer(e.target.value)}
                    maxLength={200}
                    disabled={game.answered || game.phase !== "question"}
                    placeholder="Type the term…"
                  />
                </label>
              )}
              {game.phase === "question" ? (
                <div className="game-submit">
                  <span>
                    {game.answered
                      ? "Answer locked. Take a breath!"
                      : `${game.answered_count} of ${game.players.length} answers locked`}
                  </span>
                  <button
                    className="social-button primary"
                    disabled={game.answered || busy || !answer.length}
                    onClick={() =>
                      void operation(() =>
                        act("answer", { answer, question_index: game.index }),
                      )
                    }
                  >
                    {game.answered ? "Locked ✓" : "Lock my answer"}
                  </button>
                </div>
              ) : (
                <div
                  className={`game-reveal ${game.feedback?.correct ? "correct" : ""}`}
                  role="status"
                >
                  <h4>
                    {game.feedback?.correct
                      ? `Nicely done! +${game.feedback.points} points`
                      : "Keep going — next question, fresh start."}
                  </h4>
                  <p>
                    Answer:{" "}
                    <strong>
                      {Array.isArray(game.question?.answer)
                        ? game.question.answer.join("; ")
                        : game.question?.answer}
                    </strong>
                  </p>
                  <p>{game.question?.explanation}</p>
                  <small>Next round in {remaining}s</small>
                </div>
              )}
              <div className="live-scores">
                {game.players.map((p) => (
                  <span key={p.id}>
                    <Avatar id={p.avatar_id} />
                    <b>{p.nickname}</b>
                    <small>{p.points.toLocaleString()}</small>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
