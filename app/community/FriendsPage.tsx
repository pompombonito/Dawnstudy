"use client";
import { useEffect, useState } from "react";
import { MessageCircle, UserPlus, Users } from "lucide-react";
import Avatar from "../components/Avatar";
import type { Community } from "./useCommunity";
import type { Person } from "./types";
import { communityApi } from "./api";
import DirectMessages from "./DirectMessages";

export default function FriendsPage({
  community,
  profile,
  initialPerson,
}: {
  community: Community;
  profile: () => void;
  initialPerson?: string;
}) {
  const [tab, setTab] = useState("friends"),
    [q, setQ] = useState(""),
    [people, setPeople] = useState<Person[]>([]),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Person | null>(null),
    [confirm, setConfirm] = useState<{ person: Person; action: string } | null>(
      null,
    );
  const data = community.data!;
  useEffect(() => {
    if (initialPerson)
      setSelected(data.friends.find((p) => p.id === initialPerson) || null);
  }, [initialPerson]);
  useEffect(() => {
    if (selected && !data.friends.some((p) => p.id === selected.id))
      setSelected(null);
  }, [data.friends, selected]);
  async function discover(append = false) {
    setLoading(true);
    setError("");
    try {
      const result = await communityApi<{ people: Person[]; more: boolean }>(
        community.token,
        `/directory?q=${encodeURIComponent(q)}&offset=${append ? people.length : 0}`,
      );
      setPeople((old) => (append ? [...old, ...result.people] : result.people));
      setMore(result.more);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (tab === "explore") void discover();
  }, [tab]);
  async function action(person: Person, action: string) {
    setBusy(person.id);
    setError("");
    try {
      await community.action(person.id, action);
      if (tab === "explore") await discover();
      setConfirm(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const personCard = (p: Person, buttons: React.ReactNode) => (
    <div className="person-card" key={p.id}>
      <span className="person-avatar">
        <Avatar id={p.avatar_id} />
        {p.online && <i title="Recently online" />}
      </span>
      <div className="person-copy">
        <strong>{p.nickname}</strong>
        <small>
          #{p.tag}
          {p.online ? " · Online" : ""}
        </small>
      </div>
      <div className="person-actions">{buttons}</div>
    </div>
  );
  return (
    <div className="workspace-view community-page">
      <div className="workspace-page-heading">
        <span className="eyebrow">GOOD COMPANY, BETTER STUDY SESSIONS</span>
        <h1>Your people.</h1>
        <p>
          Find a study friend, share a little encouragement, or challenge each
          other.
        </p>
      </div>
      <div className="friends-layout">
        <div>
          <div className="segmented friends-tabs">
            {[
              ["friends", `Friends (${data.friends.length})`],
              ["requests", `Requests (${data.incoming.length})`],
              ["explore", "Explore"],
              ["blocked", "Blocked"],
            ].map(([id, title]) => (
              <button
                key={id}
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
              >
                {title}
              </button>
            ))}
          </div>
          {error && (
            <p className="social-error" role="alert">
              {error}
            </p>
          )}
          {confirm && (
            <div className="social-card confirm-card">
              <p>
                {confirm.action === "block"
                  ? `Block ${confirm.person.nickname}? This also removes your friendship and prevents new requests and messages.`
                  : `Remove ${confirm.person.nickname} from your friends? Previous encrypted messages remain stored.`}
              </p>
              <div className="button-row">
                <button
                  className="social-button"
                  disabled={!!busy}
                  onClick={() => setConfirm(null)}
                >
                  Keep things as they are
                </button>
                <button
                  className="social-button danger"
                  disabled={!!busy}
                  onClick={() => void action(confirm.person, confirm.action)}
                >
                  {confirm.action === "block" ? "Block" : "Unfriend"}
                </button>
              </div>
            </div>
          )}
          <section className="social-card people-list">
            {tab === "friends" && (
              <>
                <h2>
                  <Users size={20} />{" "}
                  {data.friends.filter((p) => p.online).length} online now
                </h2>
                {!data.friends.length && (
                  <div className="social-empty">
                    <UserPlus size={32} />
                    <h3>Every friendship starts with hello.</h3>
                    <p>
                      Explore students who chose to be discoverable. Send a
                      request and let them decide.
                    </p>
                    <button
                      className="social-button primary"
                      onClick={() => setTab("explore")}
                    >
                      Find study friends
                    </button>
                  </div>
                )}
                {data.friends.map((p) =>
                  personCard(
                    p,
                    <>
                      <button
                        className="social-button"
                        aria-label={`Message ${p.nickname}`}
                        onClick={() => setSelected(p)}
                      >
                        <MessageCircle size={16} />
                        <span>Chat</span>
                      </button>
                      <details className="friend-menu">
                        <summary aria-label={`More actions for ${p.nickname}`}>
                          •••
                        </summary>
                        <button
                          onClick={() =>
                            setConfirm({ person: p, action: "unfriend" })
                          }
                        >
                          Unfriend
                        </button>
                        <button
                          onClick={() =>
                            setConfirm({ person: p, action: "block" })
                          }
                        >
                          Block
                        </button>
                      </details>
                    </>,
                  ),
                )}
              </>
            )}
            {tab === "requests" && (
              <>
                <h2>Incoming requests</h2>
                {!data.incoming.length && (
                  <p className="social-empty">
                    No requests waiting. Your next study friend might be in
                    Explore.
                  </p>
                )}
                {data.incoming.map((p) =>
                  personCard(
                    p,
                    <>
                      <button
                        className="social-button primary"
                        disabled={busy === p.id}
                        onClick={() => void action(p, "accept")}
                      >
                        Accept
                      </button>
                      <button
                        className="text-button"
                        disabled={busy === p.id}
                        onClick={() => void action(p, "decline")}
                      >
                        Decline
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          setConfirm({ person: p, action: "block" })
                        }
                      >
                        Block
                      </button>
                    </>,
                  ),
                )}
                <h3>Sent requests</h3>
                {data.outgoing.map((p) =>
                  personCard(
                    p,
                    <button
                      className="social-button"
                      disabled={busy === p.id}
                      onClick={() => void action(p, "cancel")}
                    >
                      Cancel request
                    </button>,
                  ),
                )}
                {!data.outgoing.length && (
                  <p className="subtle">No pending sent requests.</p>
                )}
              </>
            )}
            {tab === "explore" && (
              <>
                <h2>Meet your next study friend.</h2>
                <p className="subtle">
                  Only students who opted into discovery appear here. Your email
                  is never shown.
                </p>
                {!data.profile?.discoverable && (
                  <p className="discovery-note">
                    You are hidden from Explore.{" "}
                    <button className="text-button" onClick={profile}>
                      Change in Profile
                    </button>
                  </p>
                )}
                <form
                  className="directory-search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void discover();
                  }}
                >
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search nickname or friend tag"
                    maxLength={80}
                    aria-label="Search people"
                  />
                  <button className="social-button" disabled={loading}>
                    Search
                  </button>
                </form>
                {people.map((p) =>
                  personCard(
                    p,
                    p.relationship === "accepted" ? (
                      <span className="subtle">Friends ✓</span>
                    ) : p.relationship === "pending" ? (
                      <button
                        className="social-button"
                        disabled={busy === p.id}
                        onClick={() =>
                          void action(p, p.outgoing ? "cancel" : "accept")
                        }
                      >
                        {p.outgoing ? "Cancel request" : "Accept request"}
                      </button>
                    ) : (
                      <button
                        className="social-button"
                        disabled={busy === p.id}
                        onClick={() => void action(p, "request")}
                      >
                        <UserPlus size={15} /> Add
                      </button>
                    ),
                  ),
                )}
                {!people.length && (
                  <p className="social-empty">
                    {loading
                      ? "Looking for people…"
                      : "No matching discoverable profiles yet. Invite a classmate to set up their profile."}
                  </p>
                )}
                {more && (
                  <button
                    className="social-button"
                    disabled={loading}
                    onClick={() => void discover(true)}
                  >
                    Show more people
                  </button>
                )}
              </>
            )}
            {tab === "blocked" && (
              <>
                <h2>People you blocked</h2>
                {data.blocked.map((p) =>
                  personCard(
                    p,
                    <button
                      className="social-button"
                      disabled={busy === p.id}
                      onClick={() => void action(p, "unblock")}
                    >
                      Unblock
                    </button>,
                  ),
                )}
                {!data.blocked.length && (
                  <p className="social-empty">No blocked profiles.</p>
                )}
              </>
            )}
          </section>
        </div>
        {selected ? (
          <DirectMessages
            key={selected.id}
            community={community}
            person={selected}
            close={() => setSelected(null)}
            profile={profile}
          />
        ) : (
          <aside className="social-card friends-aside">
            <span className="eyebrow">A QUIETER KIND OF SOCIAL</span>
            <h2>
              A friendly face.
              <br />A fresh perspective.
            </h2>
            <p>
              Messages unlock after a friend request is accepted. Private chat
              text is encrypted on your devices.
            </p>
            <p className="subtle">
              Be kind, keep personal details private, and block or report
              anything that makes you uncomfortable.
            </p>
            <a
              className="text-button"
              href="mailto:daquioagjairodevon@gmail.com?subject=Dawnstudy%20safety%20report"
            >
              Report a safety concern ↗
            </a>
          </aside>
        )}
      </div>
    </div>
  );
}
