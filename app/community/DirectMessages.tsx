"use client";
import { useEffect, useRef, useState } from "react";
import { LockKeyhole, Send, X } from "lucide-react";
import Avatar from "../components/Avatar";
import type { Community } from "./useCommunity";
import type { CipherMessage, Person } from "./types";
import { communityApi } from "./api";
import {
  decryptMessage,
  enableMessaging,
  encryptMessage,
  hex,
  peerKey,
} from "./crypto";

export default function DirectMessages({
  community,
  person,
  close,
  profile,
}: {
  community: Community;
  person: Person;
  close: () => void;
  profile: () => void;
}) {
  const [messages, setMessages] = useState<
      (CipherMessage & { text: string })[]
    >([]),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [safety, setSafety] = useState(""),
    [more, setMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const scroll = useRef<HTMLDivElement>(null),
    pending = useRef<{ text: string; id: string } | null>(null);
  const keys = useRef<{
    local: Awaited<ReturnType<typeof enableMessaging>>;
    peer: Awaited<ReturnType<typeof peerKey>>;
  } | null>(null);
  async function load(before = "") {
    const key = keys.current;
    if (!key) return;
    const data = await communityApi<{
      messages: CipherMessage[];
      more: boolean;
    }>(
      community.token,
      `/messages/${encodeURIComponent(person.id)}${before ? `?before=${encodeURIComponent(before)}` : ""}`,
    );
    const clear = await Promise.all(
      data.messages.map(async (m) => ({
        ...m,
        text: await decryptMessage(key.local, key.peer, m).catch(
          () => "[This message could not be decrypted on this device.]",
        ),
      })),
    );
    setMore(data.more);
    setMessages((old) =>
      before
        ? [...clear, ...old.filter((m) => !clear.some((n) => n.id === m.id))]
        : [
            ...old.filter((m) => !clear.some((n) => n.id === m.id)),
            ...clear,
          ].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    );
  }
  useEffect(() => {
    let active = true;
    keys.current = null;
    setMessages([]);
    setReady(false);
    setError("");
    void (async () => {
      try {
        const local = await enableMessaging(community.token, community.userId);
        const peer = await peerKey(
          community.token,
          community.userId,
          person.id,
        );
        if (!active) return;
        keys.current = { local, peer };
        const code = hex(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(
              [local.fingerprint, peer.fingerprint].sort().join(":"),
            ),
          ),
        );
        if (!active) return;
        setSafety(code);
        setReady(true);
        await load();
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    const timer = setInterval(() => {
      if (active && !document.hidden)
        void load().catch((e) => setError(e.message));
    }, 6000);
    return () => {
      active = false;
      clearInterval(timer);
      keys.current = null;
    };
  }, [community.token, community.userId, person.id, attempt]);
  useEffect(() => {
    scroll.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length]);
  async function send() {
    if (!text.trim() || !keys.current || busy) return;
    setBusy(true);
    setError("");
    if (pending.current?.text !== text.trim())
      pending.current = { text: text.trim(), id: crypto.randomUUID() };
    try {
      const envelope = await encryptMessage(
        keys.current.local,
        keys.current.peer,
        community.userId,
        person.id,
        pending.current.text,
      );
      await communityApi(community.token, "/messages", {
        recipient_id: person.id,
        client_id: pending.current.id,
        envelope,
      });
      setText("");
      pending.current = null;
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="dm-panel social-card">
      <header className="dm-header">
        <Avatar id={person.avatar_id} />
        <div>
          <h2>{person.nickname}</h2>
          <small>
            <LockKeyhole size={12} /> End-to-end encrypted text
          </small>
        </div>
        <button
          className="plain-icon"
          aria-label="Close conversation"
          onClick={close}
        >
          <X size={19} />
        </button>
      </header>
      <details className="dm-safety">
        <summary>Verify safety code &amp; protect your key</summary>
        <p>
          Compare this code with your friend through another trusted channel.
          Matching codes verify the keys used by this conversation.
        </p>
        <code>
          {safety.match(/.{1,8}/g)?.join(" ") ||
            "Available after both people enable private chat."}
        </code>
        <p>
          The server sees sender, recipient and time; message text is encrypted
          on this device. Save a recovery file to avoid losing access.
        </p>
        <button className="text-button" onClick={profile}>
          Open key recovery settings
        </button>
      </details>
      <div className="dm-history" aria-live="polite">
        {more && messages[0] && (
          <button
            className="text-button"
            onClick={() =>
              void load(messages[0].created_at).catch((e) =>
                setError(e.message),
              )
            }
          >
            Load earlier messages
          </button>
        )}
        {!messages.length && (
          <p className="social-empty">
            {ready
              ? "A little hello goes a long way. Say something kind."
              : "Setting up your private conversation…"}
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`dm-message ${m.sender_id === community.userId ? "mine" : ""}`}
          >
            <p>{m.text}</p>
            <time>
              {new Date(m.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </div>
        ))}
        <div ref={scroll} />
      </div>
      {error && (
        <div className="social-error" role="alert">
          <p>{error}</p>
          <button
            className="text-button"
            onClick={() => setAttempt((a) => a + 1)}
          >
            Retry connection
          </button>
          <button className="text-button" onClick={profile}>
            Key recovery
          </button>
        </div>
      )}
      <form
        className="chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder={
            ready
              ? `Message ${person.nickname}…`
              : "Waiting for messaging keys…"
          }
          aria-label="Private message"
          disabled={!ready}
        />
        <button
          className="social-button primary"
          disabled={!ready || busy || !text.trim()}
          aria-label="Send encrypted message"
        >
          <Send size={18} />
        </button>
      </form>
    </section>
  );
}
