"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  BookOpen,
  LifeBuoy,
  MessageCircle,
  Menu,
  Send,
  Settings2,
  Sparkles,
  Users,
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
import { animeCompanionBubble, companionNameAfterSelection, findAnimeCharacter } from "./anime-companions";

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

type GenerationNotice = {
  title: string;
  detail: string;
  progress: number | null;
  reconnect: boolean;
  reconnectDisabled: boolean;
  cancel: boolean;
  cancelDisabled: boolean;
  cancelTitle?: string;
  error?: string;
  onReconnect: () => void;
  onCancel: () => void;
};

export default function CompanionDock({
  community,
  friends,
  signIn,
  generation,
}: {
  community: Community;
  friends: () => void;
  signIn: () => void;
  generation: GenerationNotice | null;
}) {
  const p = community.data?.profile;
  const [id, setId] = useState("cat"),
    [name, setName] = useState("Miso"),
    [draftId, setDraftId] = useState("cat"),
    [draftName, setDraftName] = useState("Miso"),
    [open, setOpen] = useState(false),
    [quickActionsOpen, setQuickActionsOpen] = useState(false),
    [generationVisible, setGenerationVisible] = useState(false),
    [settings, setSettings] = useState(false),
    [bubble, setBubble] = useState(""),
    [bubbleSource, setBubbleSource] = useState(""),
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
  // Signature dialogue comes first; hover never consumes the automatic sequence.
  const bubbleSequence = useRef(1);
  const lastHoverAt = useRef<number | null>(null);
  const lastLineAt = useRef<number | null>(null);
  const lineId = useId();
  const [showHelp, setShowHelp] = useState(false);
  const generationPresent = Boolean(generation);
  useEffect(() => {
    if (generationPresent) {
      setGenerationVisible(true);
      setBubble("");
      setBubbleSource("");
    } else {
      setGenerationVisible(false);
    }
  }, [generationPresent]);
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
    const storedId = p?.companion_id || local?.id || "cat",
      chosenId = findAnimeCharacter(storedId)?.id || storedId,
      storedName = p?.companion_name || local?.name || "",
      chosenName = companionNameAfterSelection(storedName, storedId, chosenId) || findAnimeCharacter(chosenId)?.name || "Miso";
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
    setBubble("");
    setBubbleSource("");
    bubbleSequence.current = 1;
    lastHoverAt.current = null;
    lastLineAt.current = null;
  }, [id]);
  useEffect(() => {
    if (open || quiet || generationPresent) {
      if (open) lastHoverAt.current = null;
      setBubble("");
      setBubbleSource("");
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const schedule = (delay: number) => {
      clearTimer();
      if (document.hidden) return;
      timer = setTimeout(() => {
        if (document.hidden) return;
        // Give a manually requested line time to finish before another appears.
        if (lastLineAt.current === null || Date.now() - lastLineAt.current >= 18000) {
          const line = animeCompanionBubble(id, bubbleSequence.current++);
          setBubble(line?.text || lines[Math.floor(Math.random() * lines.length)]);
          setBubbleSource(line?.quoteSource || "");
          lastLineAt.current = Date.now();
        }
        schedule(120000);
      }, delay);
    };
    const visibilityChanged = () => {
      clearTimer();
      if (document.hidden) {
        setBubble("");
        setBubbleSource("");
      } else schedule(30000);
    };
    schedule(30000);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      clearTimer();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [open, quiet, id, generationPresent]);
  useEffect(() => {
    if (!bubble) return;
    const dismiss = () => {
      setBubble("");
      setBubbleSource("");
    };
    const timer = setTimeout(dismiss, Math.min(18000, Math.max(9000, bubble.length * 80)));
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    const hideWhenBackgrounded = () => {
      if (document.hidden) dismiss();
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("visibilitychange", hideWhenBackgrounded);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("visibilitychange", hideWhenBackgrounded);
    };
  }, [bubble]);
  function showSignatureLine(force = false) {
    if (open || document.hidden || generationPresent) return;
    const now = Date.now();
    if (!force && lastHoverAt.current !== null && now - lastHoverAt.current < 15000) return;
    lastHoverAt.current = now;
    lastLineAt.current = now;
    const line = animeCompanionBubble(id, 1);
    setBubble(line?.text || lines[Math.floor(Math.random() * lines.length)]);
    setBubbleSource(line?.quoteSource || "");
  }
  function openCompanionPanel(section: "chat" | "settings" | "help") {
    setQuickActionsOpen(false);
    setOpen(true);
    setError("");
    setSettings(section === "settings");
    setShowHelp(section === "help");
  }
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
      className={`buddy-dock ${open ? "open" : ""} ${quickActionsOpen ? "quick-actions-open" : ""} ${generationPresent ? "has-generation" : ""}`}
      aria-label="Your AI study companion"
    >
      {generation && generationVisible && !open && (
        <button
          className="buddy-bubble buddy-generation-bubble"
          type="button"
          onClick={() => setGenerationVisible(false)}
          aria-label={`${generation.title}. ${generation.detail}. Tap to hide status.`}
          aria-live="polite"
          aria-atomic="true"
          title="Tap to hide status"
        >
          <span className="generation-bubble-heading"><i className="generation-status-pulse"/><strong>{generation.title}</strong></span>
          <span className="generation-bubble-detail">{generation.detail}</span>
          {generation.progress !== null && <span className="generation-progress-track" aria-label={`${Math.round(generation.progress)} percent complete`}><i style={{ width: `${generation.progress}%` }}/></span>}
          {generation.error && <span className="generation-bubble-error" role="alert">{generation.error}</span>}
          <small>Tap to hide · tap your buddy to reopen ✧</small>
          <i className="bubble-star">✦</i>
        </button>
      )}
      {bubble && !open && !generationPresent && (
        <div className="buddy-bubble-stack" role="status" aria-live="polite" aria-atomic="true">
          <button
            id={lineId}
            className="buddy-bubble"
            onClick={() => {
              setBubble("");
              setBubbleSource("");
            }}
            aria-label={`${name}: ${bubble}. Tap to dismiss.`}
          >
            <Sparkles className="bubble-sparkles" size={18} />
            <strong>{name}</strong>
            <span>{bubble}</span>
            <small>Tap or press Escape to dismiss ✧</small>
            <i className="bubble-star">✦</i>
          </button>
          {bubbleSource && <a className="buddy-quote-source" href={bubbleSource} target="_blank" rel="noopener noreferrer">Quote source ↗</a>}
        </div>
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
              <p className="buddy-line-hint">Hover over your companion or focus it with Tab for a line. Quiet mode pauses automatic lines.</p>
              <AvatarPicker value={draftId} onChange={(nextId) => {
                setDraftName((currentName) => companionNameAfterSelection(currentName, draftId, nextId));
                setDraftId(nextId);
                setSaved("");
              }} companions />
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
                    setBubbleSource("");
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
      {quickActionsOpen && !open && (
        <nav className="buddy-quick-actions" aria-label="Companion shortcuts">
          {generation?.reconnect && <button className="buddy-quick-action" type="button" onClick={generation.onReconnect} disabled={generation.reconnectDisabled} aria-label="Reconnect and restore generation" title="Reconnect and restore generation"><BookOpen size={18}/><span className="buddy-action-label">Reconnect</span></button>}
          {generation?.cancel && <button className="buddy-quick-action danger" type="button" onClick={generation.onCancel} disabled={generation.cancelDisabled} aria-label={generation.cancelTitle || "Cancel generation"} title={generation.cancelTitle || "Cancel generation"}><X size={18}/><span className="buddy-action-label">Cancel generation</span></button>}
          <button className="buddy-quick-action" type="button" onClick={() => openCompanionPanel("chat")} aria-label="Open companion chat" title="Chat"><MessageCircle size={18}/><span className="buddy-action-label">Chat</span></button>
          <button className="buddy-quick-action" type="button" onClick={() => openCompanionPanel("settings")} aria-label="Customize companion" title="Customize companion"><Settings2 size={18}/><span className="buddy-action-label">Customize</span></button>
          <button className="buddy-quick-action" type="button" onClick={() => { setQuickActionsOpen(false); friends(); }} aria-label="Find study friends" title="Study friends"><Users size={18}/><span className="buddy-action-label">Friends</span></button>
          <button className="buddy-quick-action" type="button" onClick={() => openCompanionPanel("help")} aria-label="Show help contacts" title="Help contacts"><LifeBuoy size={18}/><span className="buddy-action-label">Help contacts</span></button>
        </nav>
      )}
      <div className="buddy-launcher-wrap">
        <button
          className="buddy-launcher"
          type="button"
          aria-expanded={generationPresent ? generationVisible : Boolean(bubble)}
          aria-label={`${name}, ${generationPresent ? "show generation status" : "show a companion line"}`}
          aria-describedby={bubble && !open && !generationPresent ? lineId : undefined}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") showSignatureLine();
          }}
          onFocus={(event) => {
            if (event.currentTarget.matches(":focus-visible")) showSignatureLine();
          }}
          onClick={() => {
            if (generationPresent) {
              setGenerationVisible(true);
              setBubble("");
              setBubbleSource("");
            } else {
              showSignatureLine(true);
            }
          }}
        >
          <Avatar id={id} hoverLine={false} />
        </button>
        <button
          className="buddy-menu-toggle"
          type="button"
          aria-label={quickActionsOpen ? "Close companion shortcuts" : "Open companion shortcuts"}
          aria-expanded={quickActionsOpen}
          onClick={(event) => {
            event.stopPropagation();
            setQuickActionsOpen((value) => !value);
          }}
          title="Companion shortcuts"
        >{quickActionsOpen ? <X size={15}/> : <Menu size={15}/>}</button>
      </div>
    </aside>
  );
}
