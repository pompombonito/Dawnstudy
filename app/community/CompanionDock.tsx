"use client";
import { useEffect, useRef, useState } from "react";
import {
  LifeBuoy,
  MessageCircle,
  Send,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import Avatar from "../components/Avatar";
import { AvatarPicker } from "./ProfileEditor";
import type { Community } from "./useCommunity";
import { communityApi } from "./api";
import {
  classifyCompanion,
  restoreCompanionHistory,
  safetyReply,
  type CompanionReply,
  type SafetyInfo,
} from "./companion-safety";
import CompanionSafetyCard from "./CompanionSafetyCard";

type Turn = {
  role: "user" | "assistant";
  content: string;
  suggest?: boolean;
  safety?: SafetyInfo | null;
};
const lines = [
  "A little progress is still progress. What will you learn today?",
  "Unclench your shoulders. One question at a time.",
  "Your brain deserves a water break, too.",
  "Feeling stuck? Try explaining the idea in your own words.",
  "A study friend can make a hard chapter feel a little lighter.",
];

export default function CompanionDock({
  community,
  friends,
  signIn,
}: {
  community: Community;
  friends: () => void;
  signIn: () => void;
}) {
  const p = community.data?.profile;
  const [id, setId] = useState("cat"),
    [name, setName] = useState("Miso"),
    [draftId, setDraftId] = useState("cat"),
    [draftName, setDraftName] = useState("Miso"),
    [open, setOpen] = useState(false),
    [settings, setSettings] = useState(false),
    [bubble, setBubble] = useState(""),
    [text, setText] = useState(""),
    [turns, setTurns] = useState<Turn[]>([]),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(""),
    [quiet, setQuiet] = useState(false);
  const bottom = useRef<HTMLDivElement>(null),
    running = useRef(false);
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const [showHelp, setShowHelp] = useState(false);
  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );
  const [historyReady, setHistoryReady] = useState(false);
  useEffect(() => {
    let local;
    try {
      local = JSON.parse(
        localStorage.getItem("dawnstudy_companion_v1") || "null",
      );
    } catch {
      /* Use defaults. */
    }
    const chosenId = p?.companion_id || local?.id || "cat",
      chosenName = p?.companion_name || local?.name || "Miso";
    setId(chosenId);
    setName(chosenName);
    setDraftId(chosenId);
    setDraftName(chosenName);
    setQuiet(localStorage.getItem("dawnstudy_companion_quiet") === "true");
  }, [p?.companion_id, p?.companion_name]);
  useEffect(() => {
    setTurns([]);
    setError("");
    try {
      const history = JSON.parse(
        sessionStorage.getItem(
          `dawnstudy-companion-chat:${community.userId}`,
        ) || "[]",
      );
      setTurns(restoreCompanionHistory(history));
    } catch {
      /* A fresh conversation. */
    }
    setHistoryReady(true);
  }, [community.userId]);
  useEffect(() => {
    if (!historyReady) return;
    sessionStorage.setItem(
      `dawnstudy-companion-chat:${community.userId}`,
      JSON.stringify(turns.slice(-24)),
    );
    const messages =
      bottom.current?.parentElement?.querySelectorAll<HTMLElement>(
        ".buddy-turn",
      );
    const urgent = turns[turns.length - 1]?.safety?.emergency;
    const last = messages?.[messages.length - 1];
    const target = urgent
      ? last?.querySelector<HTMLElement>(".companion-help")
      : bottom.current;
    target?.scrollIntoView({
      block: urgent ? "start" : "nearest",
      behavior: urgent ? "instant" : "smooth",
    });
  }, [turns, community.userId, historyReady]);
  useEffect(() => {
    if (showHelp)
      bottom.current?.parentElement
        ?.querySelector<HTMLElement>(".buddy-help-panel")
        ?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [showHelp]);
  useEffect(() => {
    if (open || quiet) return;
    const timer = setInterval(() => {
      if (!document.hidden)
        setBubble(lines[Math.floor(Math.random() * lines.length)]);
    }, 150000);
    return () => clearInterval(timer);
  }, [open, quiet]);
  useEffect(() => {
    if (!bubble) return;
    const timer = setTimeout(
      () => setBubble(""),
      Math.min(18000, Math.max(9000, bubble.length * 80)),
    );
    return () => clearTimeout(timer);
  }, [bubble]);
  async function save() {
    if (!draftName.trim()) {
      setError("Give your companion a name first.");
      return;
    }
    setSaving(true);
    setError("");
    setSaved("");
    try {
      if (p?.onboarded)
        await community.saveProfile({
          ...p,
          companion_id: draftId,
          companion_name: draftName.trim(),
        });
      localStorage.setItem(
        "dawnstudy_companion_v1",
        JSON.stringify({ id: draftId, name: draftName.trim() }),
      );
      setId(draftId);
      setName(draftName.trim());
      setSaved("Saved. Your buddy has a new look!");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function send() {
    if (!text.trim()) return;
    const content = text.trim();
    const category = classifyCompanion(content, turns);
    if (category) {
      request.current?.abort();
      sequence.current += 1;
      running.current = false;
      setBusy(false);
      setError("");
      const result = safetyReply(category);
      setTurns([
        ...turns,
        { role: "user", content },
        {
          role: "assistant",
          content: result.reply,
          suggest: result.suggest_friends,
          safety: result.safety,
        },
      ]);
      setText("");
      return;
    }
    if (running.current) return;
    if (!p?.onboarded) {
      signIn();
      return;
    }
    const history = [...turns, { role: "user", content } as Turn];
    const current = ++sequence.current;
    const controller = new AbortController();
    request.current = controller;
    running.current = true;
    setBusy(true);
    setError("");
    setTurns(history);
    setText("");
    try {
      const result = await communityApi<CompanionReply>(
        community.token,
        "/companion",
        {
          message: content,
          history: turns
            .slice(-12)
            .map(({ role, content }) => ({ role, content })),
        },
        undefined,
        controller.signal,
      );
      if (current !== sequence.current) return;
      setTurns([
        ...history,
        {
          role: "assistant",
          content: result.reply,
          suggest: result.suggest_friends,
          safety: result.safety,
        },
      ]);
    } catch (e) {
      if (current !== sequence.current || controller.signal.aborted) return;
      setError((e as Error).message);
      setText(content);
      setTurns(history.slice(0, -1));
    } finally {
      if (current === sequence.current) {
        running.current = false;
        setBusy(false);
        request.current = null;
      }
    }
  }
  return (
    <aside
      className={`buddy-dock ${open ? "open" : ""}`}
      aria-label="Your AI study companion"
    >
      {bubble && !open && (
        <button
          className="buddy-bubble"
          onClick={() => setBubble("")}
          aria-label={`${name}: ${bubble}. Tap to dismiss.`}
        >
          <Sparkles className="bubble-sparkles" size={18} />
          <strong>{name}</strong>
          <span>{bubble}</span>
          <small>Tap to dismiss ✧</small>
          <i className="bubble-star">✦</i>
        </button>
      )}
      {open && (
        <section className="buddy-panel">
          <header>
            <Avatar id={id} />
            <div>
              <strong>{name}</strong>
              <small>
                {settings ? "Make your buddy yours" : "Your AI study companion"}
              </small>
            </div>
            <button
              className="plain-icon"
              aria-label="Show Philippine help contacts"
              aria-expanded={showHelp}
              onClick={() => {
                setSettings(false);
                setShowHelp((v) => !v);
              }}
              title="Philippine help contacts"
            >
              <LifeBuoy size={18} />
            </button>
            <button
              className="plain-icon"
              aria-label={
                settings ? "Back to companion chat" : "Customize companion"
              }
              onClick={() => {
                setSettings((s) => !s);
                setError("");
              }}
            >
              {settings ? <MessageCircle size={18} /> : <Settings2 size={18} />}
            </button>
            <button
              className="plain-icon"
              aria-label="Close companion"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
          </header>
          {settings ? (
            <div className="buddy-settings">
              <label>
                Companion name
                <input
                  value={draftName}
                  onChange={(e) => {
                    setDraftName(e.target.value);
                    setSaved("");
                  }}
                  maxLength={24}
                  placeholder="Your buddy's name"
                />
              </label>
              <AvatarPicker value={draftId} onChange={setDraftId} companions />
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={quiet}
                  onChange={(e) => {
                    setQuiet(e.target.checked);
                    localStorage.setItem(
                      "dawnstudy_companion_quiet",
                      String(e.target.checked),
                    );
                    setBubble("");
                  }}
                />
                <span>Quiet mode · pause occasional bubbles</span>
              </label>
              <button
                className="social-button primary"
                disabled={saving || !draftName.trim()}
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save companion"}
              </button>
              {saved && (
                <p className="social-success" role="status">
                  {saved}
                </p>
              )}
              <button
                className="text-button"
                onClick={() => {
                  request.current?.abort();
                  sequence.current += 1;
                  running.current = false;
                  setBusy(false);
                  setTurns([]);
                  setSaved("Conversation cleared from this tab.");
                }}
              >
                Clear this conversation
              </button>
            </div>
          ) : (
            <>
              <div className="buddy-history" aria-live="polite">
                {showHelp && (
                  <div className="buddy-help-panel">
                    <button
                      className="text-button"
                      onClick={() => setShowHelp(false)}
                    >
                      Close help contacts
                    </button>
                    <CompanionSafetyCard
                      info={safetyReply("resources").safety!}
                    />
                  </div>
                )}
                {!turns.length && (
                  <div className="buddy-greeting">
                    <Sparkles size={23} />
                    <h3>What's on your mind?</h3>
                    <p>
                      I'm an AI study companion. I can help with studying,
                      finding a study friend, or connecting you with real-world
                      support.
                    </p>
                    <div className="buddy-starters">
                      {[
                        "I need a little motivation",
                        "I'm feeling lonely",
                        "Today went well!",
                      ].map((t) => (
                        <button key={t} onClick={() => setText(t)}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {turns.map((turn, i) => (
                  <div className={`buddy-turn ${turn.role}`} key={i}>
                    <small>{turn.role === "user" ? "You" : name}</small>
                    <p>{turn.content}</p>
                    {turn.safety && <CompanionSafetyCard info={turn.safety} />}
                    {turn.suggest && (
                      <button
                        className="social-button"
                        onClick={() => {
                          setOpen(false);
                          friends();
                        }}
                      >
                        Meet a study friend ↗
                      </button>
                    )}
                  </div>
                ))}
                {busy && (
                  <p className="typing-dots" role="status">
                    {name} is thinking<span>•••</span>
                  </p>
                )}
                <div ref={bottom} />
              </div>
              <p className="buddy-privacy">
                AI replies use an AI provider. Help contacts are available
                without an AI connection.
              </p>
              <form
                className="chat-compose"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <textarea
                  rows={2}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={1200}
                  placeholder={
                    p?.onboarded
                      ? `Talk to ${name}…`
                      : "Sign in for AI chat · help is always available"
                  }
                  aria-label="Message your AI companion"
                />
                <button
                  className="social-button primary"
                  disabled={
                    !text.trim() || (busy && !classifyCompanion(text, turns))
                  }
                  aria-label="Send to companion"
                >
                  <Send size={17} />
                </button>
              </form>
            </>
          )}
          {error && (
            <p className="social-error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
      <button
        className="buddy-launcher"
        aria-expanded={open}
        aria-label={`${name}, ${open ? "close" : "open"} companion chat`}
        onClick={() => {
          setOpen((v) => !v);
          setBubble("");
        }}
      >
        <Avatar id={id} />
        <span>✧</span>
      </button>
    </aside>
  );
}
