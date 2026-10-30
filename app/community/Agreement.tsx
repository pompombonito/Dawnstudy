export const TERMS_VERSION = "2026-10-30";
export default function Agreement({ compact = false }: { compact?: boolean }) {
  return (
    <article className={`agreement-copy ${compact ? "compact" : ""}`}>
      <p className="eyebrow">
        USER AGREEMENT &amp; PRIVACY NOTICE · 30 OCTOBER 2026
      </p>
      <h1>A thoughtful space to study together.</h1>
      <p>
        This agreement explains how Dawnstudy works and how personal information
        is handled. It applies to study tools, AI companions, profiles,
        friendships, messages and live games. Dawnstudy is an independent
        student project run by Jairo Devon A. Daquioag; it is not an official
        CEU or Sanrio service.
      </p>
      <h2>1. Your account and choices</h2>
      <p>
        Use your own eligible CEU account, keep your sign-in secure and choose a
        nickname that you are comfortable making public. Do not impersonate
        another person. If you are under 18, review these terms with a parent or
        guardian before using the social and AI features. Profile discovery is
        optional and off by default. Gender is private, optional through “Prefer
        not to say,” and does not limit which icons you can use.
      </p>
      <h2>2. Study responsibly</h2>
      <p>
        Upload or link only material you have permission to use. Public access
        does not remove copyright. Do not submit passwords, medical records,
        confidential school records or other sensitive personal information. AI
        questions, explanations, video notes and companion replies can be
        inaccurate; check the source and use your own judgment. This service
        does not replace teachers, professional advice or emergency support.
        Availability and provider limits may interrupt generation or live games.
      </p>
      <h2>3. Treat people with care</h2>
      <p>
        No harassment, hate, threats, stalking, scams, sexual exploitation,
        sharing another person's private information, or attempts to bypass
        security. Friends must accept your request before private messaging or
        joining your live quiz. You may decline requests, cancel requests,
        unfriend or block people. Blocking stops new discovery and communication
        between those accounts. A room code is only for your accepted friends.
        Do not use the service to violate examination or academic integrity
        rules.
      </p>
      <h2>4. What is collected and why</h2>
      <p>
        Account records include your email, sign-in identifiers, display name,
        account creation date and a password hash if password sign-in applies.
        Study records include uploaded-material text sent for processing, saved
        questions, sources, progress, shares, generation usage and reports.
        Social records include your chosen nickname, icon, optional gender
        choice, theme, companion settings, discovery choice, friends, blocks,
        public encryption key, encrypted messages, game results, and the
        agreement version and time you accepted. This supports authentication,
        study tools, preferences, access control, delivery, security and abuse
        prevention.
      </p>
      <h2>5. Who can see what</h2>
      <p>
        Opting into discovery lets signed-in eligible users see your nickname,
        icon and friend tag. Accepted friends also see a recent-online
        indicator. Other quiz players see your nickname, icon, answers after a
        reveal, points and placement. Email and gender are not included in
        public profiles. Shared study links can be viewed by anyone holding the
        link until the owner disables sharing.
      </p>
      <p>
        Google Sheets stores account, study and social records. Google sign-in,
        Vercel hosting, Render hosting, and the configured AI providers process
        the information necessary for their services, potentially outside the
        Philippines. Material, voice-review content and companion messages
        requiring AI replies are sent to the selected or fallback AI provider.
        Common safety responses and help contacts can be displayed locally on
        your device. AI companion chat is separate from encrypted friend
        messages. Do not send the companion information you would not want
        processed by an AI provider.
      </p>
      <h2>6. Private messages and keys</h2>
      <p>
        Friend message text is encrypted and decrypted on your device using Web
        Crypto (P-256 ECDH, HKDF and AES-GCM). The server and Sheets receive
        ciphertext, public keys, sender/recipient identifiers and delivery
        timestamps. The operator can see that metadata, but the stored message
        text cannot be read without a participant's private key. Recipients can
        still copy or screenshot messages. This design does not provide forward
        secrecy or protection from a compromised device or malicious application
        code.
      </p>
      <p>
        Your private key stays in browser storage. Keep an encrypted recovery
        file and its passphrase separately if you want to use another device.
        Clearing browser data without a recovery file can permanently lose
        access to your messages. The operator cannot recover the private key.
        Verify safety codes with your friend through another trusted channel; a
        changed code interrupts messaging.
      </p>
      <h2>7. Storage and retention</h2>
      <p>
        Account, study, social, encrypted-message and finished-game records
        remain until removed through available controls or an approved deletion
        request. Unfriending does not erase previously delivered ciphertext.
        Browser keys remain until you clear that browser's storage. AI companion
        history is held in that tab's session storage and can be cleared in the
        companion panel; it is not written to the Dawnstudy spreadsheet.
        Providers apply their own processing and retention policies. Presence
        expires after about 100 seconds without a heartbeat. Live rooms expire
        after an hour of inactivity and may disappear on a server restart.
        Operational hosting logs may include request metadata; message text is
        not intentionally logged by Dawnstudy.
      </p>
      <h2>8. Your privacy rights</h2>
      <p>
        Republic Act No. 10173, the Philippine Data Privacy Act of 2012, and its
        implementing rules set requirements for transparency, legitimate
        purpose, proportionality and security. Subject to applicable law, you
        may request access, correction, deletion or blocking, object to
        processing, withdraw consent for optional processing, request
        portability where applicable, and lodge a complaint with the National
        Privacy Commission. Requests may require identity verification.
        Disabling discovery does not remove existing friendships; use Unfriend
        or Block separately. Withdrawing processing essential to the account may
        require closing it.
      </p>
      <p>
        For privacy requests, account closure, corrections, data export, or
        abuse reports, contact{" "}
        <a href="mailto:daquioagjairodevon@gmail.com">
          daquioagjairodevon@gmail.com
        </a>
        . Include your account email and the request, but never your password,
        private key or another person's message contents without their
        permission. We cannot decrypt messages for an export. Records required
        by law or an active security investigation may need to be retained; the
        reason will be explained.
      </p>
      <h2>9. Updates, artwork and acceptance</h2>
      <p>
        Substantial agreement changes require renewed acceptance. Character
        names and recognizable character designs belong to their respective
        owners, including Sanrio. The icon gallery contains stylized
        illustrations and CEU-inspired study outfits, not an official catalogue
        or certification of every CEU uniform. You can review this agreement at
        any time from the navigation or your profile. Checking acceptance
        records your agreement to these terms and acknowledgment of this notice;
        optional discovery remains a separate choice.
      </p>
      <p className="legal-sources">
        References:{" "}
        <a
          href="https://privacy.gov.ph/data-privacy-act/"
          target="_blank"
          rel="noreferrer"
        >
          Data Privacy Act of 2012
        </a>{" "}
        ·{" "}
        <a
          href="https://privacy.gov.ph/wp-content/uploads/2023/06/IRR_RA-10173-as-amended.pdf"
          target="_blank"
          rel="noreferrer"
        >
          NPC implementing rules
        </a>{" "}
        ·{" "}
        <a href="https://privacy.gov.ph/" target="_blank" rel="noreferrer">
          National Privacy Commission
        </a>
      </p>
    </article>
  );
}
