"use client";
import { useRef, useState } from "react";
import ProfileEditor from "./ProfileEditor";
import type { Community } from "./useCommunity";
import type { Theme, ProfileInput } from "./types";
import { enableMessaging, exportRecovery, importRecovery } from "./crypto";
import { dawnstudyApiBase } from "./api";

export default function ProfilePage({
  community,
  setTheme,
  agreement,
}: {
  community: Community;
  setTheme: (t: Theme) => void;
  agreement: () => void;
}) {
  const profile = community.data!.profile!;
  const [value, setValue] = useState<ProfileInput>(profile),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [password, setPassword] = useState(""),
    [safety, setSafety] = useState(profile.key_fingerprint || "");
  const file = useRef<HTMLInputElement>(null);
  async function operation(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-view community-page">
      <div className="workspace-page-heading">
        <span className="eyebrow">YOUR CORNER OF DAWN</span>
        <h1>A little more you.</h1>
        <p>Update your public identity, your mood, and your privacy choices.</p>
      </div>
      <form
        className="social-card profile-settings"
        onSubmit={(e) => {
          e.preventDefault();
          void operation(async () => {
            await community.saveProfile(value);
            setMessage("Your profile is saved.");
          });
        }}
      >
        <ProfileEditor value={value} onChange={setValue} setTheme={setTheme} />
        <div className="profile-save">
          <span className="subtle">
            Friend tag: #{profile.user_id.slice(-6)}
          </span>
          <button
            className="social-button primary"
            disabled={busy}
            type="submit"
          >
            {busy ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
      <section className="social-card">
        <span className="eyebrow">DESKTOP STUDY HELPER</span>
        <h2>Connect Dawnstudy’s hosted models</h2>
        <p>
          Copy a 30-day, answer-only connection token, then paste it into the
          local helper. It sends recognized question text and answer choices to
          Dawnstudy; screenshots stay on your computer.
        </p>
        <button
          className="social-button primary"
          disabled={busy}
          onClick={() =>
            void operation(async () => {
              if (!dawnstudyApiBase) throw new Error("The Dawnstudy API address is not configured.");
              const response = await fetch(`${dawnstudyApiBase}/api/local-helper/connect`, {
                method: "POST",
                headers: { Authorization: `Bearer ${community.token}` },
                cache: "no-store",
              });
              const data = await response.json().catch(() => ({}));
              if (!response.ok || typeof data.token !== "string")
                throw new Error(typeof data.detail === "string" ? data.detail : "Could not connect the local helper.");
              await navigator.clipboard.writeText(data.token);
              setMessage("Connection token copied. Paste it into the local helper and choose Dawnstudy AI.");
            })
          }
        >
          Copy local-helper connection token
        </button>
      </section>
      <section className="social-card">
        <span className="eyebrow">ONLY ON YOUR DEVICE</span>
        <h2>Private chat keys</h2>
        <p>
          Your browser keeps the key that opens your messages. Download an
          encrypted recovery file before changing devices or clearing browser
          data. Dawnstudy cannot reset or recover it.
        </p>
        <div className="recovery-controls">
          <button
            className="social-button"
            disabled={busy}
            onClick={() =>
              void operation(async () => {
                const key = await enableMessaging(
                  community.token,
                  community.userId,
                );
                setSafety(key.fingerprint);
                await community.refresh();
                setMessage(
                  "Private chat is enabled on this device. Save a recovery file next.",
                );
              })
            }
          >
            Enable private chat on this device
          </button>
          <label>
            Recovery passphrase
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              minLength={12}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 12 characters"
            />
          </label>
          <div className="button-row">
            <button
              className="social-button"
              disabled={busy || password.length < 12}
              onClick={() =>
                void operation(async () => {
                  const data = await exportRecovery(
                    community.token,
                    community.userId,
                    password,
                  );
                  const url = URL.createObjectURL(
                    new Blob([data], { type: "application/json" }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `dawnstudy-private-chat-${community.userId.slice(-6)}.json`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 5000);
                  setPassword("");
                  setMessage(
                    "Encrypted recovery file downloaded. Keep its passphrase separately.",
                  );
                })
              }
            >
              Download encrypted recovery file
            </button>
            <button
              className="social-button"
              disabled={busy || password.length < 12}
              onClick={() => file.current?.click()}
            >
              Restore recovery file
            </button>
          </div>
          <input
            type="file"
            hidden
            accept="application/json,.json"
            ref={file}
            onChange={(e) => {
              const selected = e.target.files?.[0];
              e.target.value = "";
              if (!selected) return;
              void operation(async () => {
                if (selected.size > 20000)
                  throw new Error(
                    "Choose a Dawnstudy recovery file under 20 KB.",
                  );
                await importRecovery(
                  community.token,
                  community.userId,
                  password,
                  await selected.text(),
                );
                setPassword("");
                setMessage(
                  "Your private chat key was restored on this device.",
                );
                await community.refresh();
              });
            }}
          />
          {safety && (
            <p className="safety-code">
              Your public key fingerprint{" "}
              <code>{safety.match(/.{1,8}/g)?.join(" ")}</code>
            </p>
          )}
        </div>
      </section>
      <section className="social-card">
        <h2>Your agreement &amp; privacy</h2>
        <p>
          Accepted{" "}
          {profile.terms_accepted_at
            ? new Date(profile.terms_accepted_at).toLocaleDateString()
            : "during setup"}{" "}
          · Version {profile.terms_version}
        </p>
        <div className="button-row">
          <button className="social-button" onClick={agreement}>
            Review user agreement
          </button>
          <a
            className="social-button"
            href="mailto:daquioagjairodevon@gmail.com?subject=Dawnstudy%20privacy%20request"
          >
            Request access, export or account deletion
          </a>
        </div>
      </section>
      {(error || message) && (
        <p className={error ? "social-error" : "social-success"} role="status">
          {error || message}
        </p>
      )}
    </div>
  );
}
