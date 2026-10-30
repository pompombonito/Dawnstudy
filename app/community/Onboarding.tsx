"use client";
import { useEffect, useRef, useState } from "react";
import Agreement, { TERMS_VERSION } from "./Agreement";
import ProfileEditor, { defaultProfile } from "./ProfileEditor";
import type { Community } from "./useCommunity";
import type { Theme } from "./types";
import { DawnMark } from "../components/DawnArtwork";

export default function Onboarding({
  community,
  setTheme,
  signOut,
}: {
  community: Community;
  setTheme: (t: Theme) => void;
  signOut: () => void;
}) {
  const [step, setStep] = useState(0),
    [accepted, setAccepted] = useState(false),
    [read, setRead] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [value, setValue] = useState({
    ...defaultProfile,
    ...community.data?.profile,
    nickname: community.data?.profile?.nickname || "",
  });
  const scroll = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const nodes = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select,textarea,a[href],[tabindex="0"]',
        ) || []),
      ].filter((el) => el.getClientRects().length);
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", trap);
    };
  }, []);
  useEffect(() => {
    if (
      scroll.current &&
      scroll.current.scrollHeight <= scroll.current.clientHeight + 5
    )
      setRead(true);
  }, [step]);
  return (
    <div className="setup-backdrop">
      <section
        ref={dialog}
        tabIndex={-1}
        className="setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
      >
        <div className="setup-head">
          <span className="setup-brand">
            <DawnMark /> Dawnstudy
          </span>
          <button className="text-button" onClick={signOut}>
            Sign out
          </button>
        </div>
        <div className="setup-title">
          <span className="eyebrow">
            A LITTLE INTRODUCTION · {step + 1} OF 2
          </span>
          <h2 id="setup-title">
            {step === 0 ? "Before we begin." : "Make this space yours."}
          </h2>
          <p>
            {step === 0
              ? "Please read our agreement and privacy notice. Scroll to the end to continue."
              : "Choose a nickname, an icon and a theme. You can change these later in Profile."}
          </p>
        </div>
        {step === 0 ? (
          <>
            <div
              className="agreement-scroll"
              ref={scroll}
              tabIndex={0}
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20)
                  setRead(true);
              }}
            >
              <Agreement compact />
            </div>
            <label className="checkline setup-consent">
              <input
                type="checkbox"
                checked={accepted}
                disabled={!read}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>
                I have read and agree to the User Agreement and acknowledge the
                Privacy Notice, including processing described under the Data
                Privacy Act of 2012.
              </span>
            </label>
          </>
        ) : (
          <div className="setup-profile">
            <ProfileEditor
              value={value}
              onChange={setValue as (v: typeof defaultProfile) => void}
              setTheme={setTheme}
            />
          </div>
        )}
        {error && (
          <p className="social-error" role="alert">
            {error}
          </p>
        )}
        <footer className="setup-footer">
          {step === 1 && (
            <button
              className="social-button"
              disabled={busy}
              onClick={() => setStep(0)}
            >
              Back
            </button>
          )}
          <span>
            {step === 0
              ? read
                ? "Thank you for taking a moment to read."
                : "Scroll through the agreement to unlock acceptance."
              : "Your email stays out of your public profile."}
          </span>
          <button
            className="social-button primary"
            disabled={
              busy ||
              (step === 0 ? !accepted : value.nickname.trim().length < 2)
            }
            onClick={async () => {
              if (step === 0) {
                setStep(1);
                return;
              }
              setBusy(true);
              setError("");
              try {
                await community.saveProfile({
                  ...value,
                  accept_terms: true,
                  terms_version: TERMS_VERSION,
                });
                await community.refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? "Saving…"
              : step === 0
                ? "Continue"
                : "Meet your study space →"}
          </button>
        </footer>
      </section>
    </div>
  );
}
