import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  process.env.DAWNSTUDY_PLAYWRIGHT_PATH
    ? pathToFileURL(process.env.DAWNSTUDY_PLAYWRIGHT_PATH).href
    : "playwright-core"
);
const artifacts = join(tmpdir(), "dawnstudy-community-qa");
await mkdir(artifacts, { recursive: true });
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const browser = await chromium.launch({
  executablePath:
    process.env.DAWNSTUDY_BROWSER ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const baseProfile = (uid) => ({
  user_id: uid,
  nickname: uid === "alice" ? "June" : "Riley",
  avatar_id: "cat",
  gender: "prefer-not-to-say",
  theme: "dark",
  discoverable: true,
  companion_id: "cat",
  companion_name: "Miso",
  onboarded: true,
  terms_version: "2026-10-30",
  terms_accepted_at: new Date().toISOString(),
  key_fingerprint: "",
  public_key: null,
});
const profiles = { alice: null, bob: baseProfile("bob") };
const messages = [];
const errors = [];
let room = null;
const answers = new Set();
const roomView = (user) => ({
  ...room,
  server_time: Date.now(),
  answered: answers.has(user),
  answered_count: answers.size,
  question:
    room.phase === "question"
      ? {
          question: "Which organelle supplies energy?",
          options: ["Mitochondrion", "Nucleus", "Ribosome", "Golgi body"],
        }
      : room.phase === "reveal"
        ? {
            question: "Which organelle supplies energy?",
            options: ["Mitochondrion", "Nucleus", "Ribosome", "Golgi body"],
            answer: "Mitochondrion",
            explanation: "Mitochondria produce ATP.",
          }
        : undefined,
  feedback:
    room.phase === "reveal" ? { correct: true, points: 1500 } : undefined,
});
const person = (uid) => ({
  id: uid,
  nickname: profiles[uid]?.nickname || uid,
  avatar_id: profiles[uid]?.avatar_id || "cat",
  online: true,
  tag: uid,
});
async function context(uid, width = 1440, height = 1000) {
  const c = await browser.newContext({
    viewport: { width, height },
    acceptDownloads: true,
  });
  await c.addInitScript(
    (uid) => localStorage.setItem("dawnstudy_session_v1", uid),
    uid,
  );
  await c.route("http://localhost:8000/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      method = req.method(),
      user = req.headers().authorization?.replace("Bearer ", "") || uid;
    const body = req.postDataJSON?.() || {};
    let data = {};
    let status = 200;
    if (method === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "*",
        },
      });
    if (path === "/api/auth/me")
      data = {
        id: user,
        username: user,
        email: `${user}@ceu.edu.ph`,
        display_name: user,
      };
    else if (path === "/api/models") data = { models: [] };
    else if (path === "/api/study-sets")
      data = [
        {
          id: "quiz",
          title: "Biology essentials",
          type: "multiple_choice",
          items: [
            {
              question: "Which organelle supplies energy?",
              answer: "Mitochondrion",
              options: ["Mitochondrion", "Nucleus", "Ribosome", "Golgi body"],
            },
          ],
          created_at: new Date().toISOString(),
        },
      ];
    else if (path === "/api/study-shares") data = [];
    else if (path === "/api/progress")
      data = {
        total_reviews: 0,
        reviewed_today: 0,
        accuracy: 0,
        current_streak: 0,
        best_streak: 0,
        due_count: 0,
        total_cards: 1,
        week: [],
      };
    else if (path === "/api/generation-jobs") data = { job: null };
    else if (path === "/api/community/bootstrap")
      data = {
        profile: profiles[user],
        friends: profiles[user]
          ? [person(user === "alice" ? "bob" : "alice")]
          : [],
        incoming: [],
        outgoing: [],
        blocked: [],
        invitations: [],
        terms_version: "2026-10-30",
      };
    else if (path === "/api/community/profile") {
      profiles[user] = {
        ...baseProfile(user),
        ...profiles[user],
        ...body,
        onboarded: true,
      };
      data = profiles[user];
    } else if (path === "/api/community/presence") data = { ok: true };
    else if (path.startsWith("/api/community/messaging-key/")) {
      const p = profiles[path.split("/").pop()];
      data = { public_key: p.public_key, fingerprint: p.key_fingerprint };
    } else if (path === "/api/community/messaging-key") {
      const key = body.public_key;
      const bytes = new TextEncoder().encode(`${key.x}.${key.y}`);
      const fp = Buffer.from(
        await crypto.subtle.digest("SHA-256", bytes),
      ).toString("hex");
      profiles[user].public_key = key;
      profiles[user].key_fingerprint = fp;
      data = { public_key: key, fingerprint: fp };
    } else if (path === "/api/community/messages") {
      messages.push({
        id: `msg-${messages.length}`,
        sender_id: user,
        recipient_id: body.recipient_id,
        envelope: body.envelope,
        created_at: new Date().toISOString(),
      });
      data = { id: messages.at(-1).id };
    } else if (path.startsWith("/api/community/messages/"))
      data = {
        messages: messages.filter((m) =>
          [m.sender_id, m.recipient_id].includes(user),
        ),
        more: false,
      };
    else if (path === "/api/community/companion")
      data = {
        reply:
          "I'm an AI study companion, so I can't provide counselling. If you'd like some company, you can meet a study friend here. For personal support, you can contact CEU GCD or the NCMH Crisis Hotline below.",
        suggest_friends: true,
        model: "mock",
      };
    else if (path === "/api/community/directory")
      data = { people: [], more: false };
    else if (path === "/api/community/games") {
      room = {
        code: "ABC234",
        host: user,
        title: "Biology essentials",
        kind: "multiple_choice",
        phase: "lobby",
        index: -1,
        total: 1,
        deadline: 0,
        players: [{ ...person(user), points: 0, correct: 0, rank: 1 }],
      };
      data = roomView(user);
    } else if (path === "/api/community/games/ABC234" && room) {
      if (body.action === "join" && !room.players.some((p) => p.id === user))
        room.players.push({ ...person(user), points: 0, correct: 0, rank: 1 });
      if (body.action === "start") {
        room.phase = "countdown";
        room.deadline = Date.now() + 1000;
        setTimeout(() => {
          room.phase = "question";
          room.index = 0;
          room.deadline = Date.now() + 25000;
        }, 1000);
      }
      if (body.action === "answer") {
        answers.add(user);
        const player = room.players.find((p) => p.id === user);
        player.points = 1500;
        player.correct = 1;
        if (answers.size === 2) {
          room.phase = "reveal";
          room.deadline = Date.now() + 2500;
          setTimeout(() => {
            room.phase = "finished";
          }, 2500);
        }
      }
      if (body.action === "leave")
        room.players = room.players.filter((p) => p.id !== user);
      data = roomView(user);
    } else {
      data = { detail: `Unmocked ${method} ${path}` };
      status = 404;
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(data),
    });
  });
  const page = await c.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:3033");
  return { c, page };
}
try {
  const a = await context("alice");
  const p = a.page;
  await p.getByRole("heading", { name: "Before we begin." }).waitFor();
  await p
    .locator(".agreement-scroll")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  await p.locator(".setup-consent input").check();
  await p.getByRole("button", { name: "Continue", exact: true }).click();
  await p.getByLabel("Public nickname").fill("June");
  await p.getByRole("button", { name: /Rose Dawn Blush/ }).click();
  await p.getByRole("button", { name: "Characters", exact: true }).click();
  await p.getByRole("button", { name: "Hello Kitty", exact: true }).click();
  await p.getByRole("button", { name: "Meet your study space →" }).click();
  await p.locator(".setup-backdrop").waitFor({ state: "detached" });
  assert.equal(await p.locator("html").getAttribute("data-theme"), "rose");
  console.log("PASS first-login agreement, profile icon, theme and save");
  assert.equal(
    await p.locator(".buddy-launcher").count(),
    1,
    "Only one companion may mount during onboarding",
  );
  await p.screenshot({
    path: join(artifacts, "setup-debug.png"),
    fullPage: true,
    animations: "disabled",
  });

  await p.getByRole("button", { name: "Miso, open companion chat" }).click();
  await p.getByRole("button", { name: "Customize companion" }).click();
  await p.getByLabel("Companion name").fill("Biscuit");
  await p.getByRole("button", { name: "Save companion" }).click();
  await p.getByText("Saved. Your buddy has a new look!").waitFor();
  await p.getByRole("button", { name: "Back to companion chat" }).click();
  await p.getByLabel("Message your AI companion").fill("I'm feeling lonely");
  await p.getByRole("button", { name: "Send to companion" }).click();
  await p.getByRole("button", { name: "Meet a study friend ↗" }).waitFor();
  await p.getByRole("button", { name: "Close companion", exact: true }).click();
  await p.reload();
  await p
    .getByRole("button", { name: "Biscuit, open companion chat" })
    .waitFor();
  await p.getByRole("button", { name: "Biscuit, open companion chat" }).click();
  await p
    .getByText(
      "I'm an AI study companion, so I can't provide counselling. If you'd like some company, you can meet a study friend here. For personal support, you can contact CEU GCD or the NCMH Crisis Hotline below.",
      { exact: true },
    )
    .waitFor();
  await p.getByRole("button", { name: "Close companion", exact: true }).click();
  console.log(
    "PASS companion rename survives reload and relevant chat offers friends",
  );
  await p.getByRole("button", { name: "My profile", exact: true }).click();
  await p
    .getByRole("button", { name: "Enable private chat on this device" })
    .click();
  await p
    .getByText(
      "Private chat is enabled on this device. Save a recovery file next.",
    )
    .waitFor();
  await p.screenshot({
    path: join(artifacts, "desktop-profile.png"),
    fullPage: true,
    animations: "disabled",
  });
  const b = await context("bob");
  await b.page.getByRole("button", { name: "My profile", exact: true }).click();
  await b.page
    .getByRole("button", { name: "Enable private chat on this device" })
    .click();
  await b.page
    .getByText(
      "Private chat is enabled on this device. Save a recovery file next.",
    )
    .waitFor();
  await p
    .getByLabel("Recovery passphrase")
    .fill("A separate long recovery phrase 123");
  const downloadPromise = p.waitForEvent("download");
  await p
    .getByRole("button", { name: "Download encrypted recovery file" })
    .click();
  const download = await downloadPromise;
  await download.saveAs(join(artifacts, "recovery.json"));
  const backup = await readFile(join(artifacts, "recovery.json"), "utf8");
  assert(!backup.includes("privateKey"));
  assert(!backup.includes("recovery phrase"));
  await p.getByRole("button", { name: "Friends", exact: true }).first().click();
  await p.getByRole("button", { name: "Message Riley" }).click();
  await p.getByLabel("Private message").waitFor();
  await p.getByLabel("Private message").fill("Kumusta 🌅 — a private hello");
  await p.getByRole("button", { name: "Send encrypted message" }).click();
  await p.getByText("Kumusta 🌅 — a private hello", { exact: true }).waitFor();
  assert(!JSON.stringify(messages).includes("private hello"));
  await b.page
    .getByRole("button", { name: "Friends", exact: true })
    .first()
    .click();
  await b.page.getByRole("button", { name: "Message June" }).click();
  await b.page
    .getByText("Kumusta 🌅 — a private hello", { exact: true })
    .waitFor();
  await b.page
    .getByLabel("Private message")
    .fill("A reply only our browsers can read.");
  await b.page.getByRole("button", { name: "Send encrypted message" }).click();
  await p
    .getByText("A reply only our browsers can read.", { exact: true })
    .waitFor({ timeout: 15000 });
  console.log(
    "PASS two independent browsers encrypt, store ciphertext, and decrypt both directions",
  );
  const restored = await context("alice");
  await restored.page
    .getByRole("button", { name: "My profile", exact: true })
    .click();
  await restored.page
    .getByLabel("Recovery passphrase")
    .fill("A separate long recovery phrase 123");
  await restored.page
    .locator("input[type=file]")
    .last()
    .setInputFiles(join(artifacts, "recovery.json"));
  await restored.page
    .getByText("Your private chat key was restored on this device.")
    .waitFor();
  await restored.page
    .getByRole("button", { name: "Friends", exact: true })
    .first()
    .click();
  await restored.page.getByRole("button", { name: "Message Riley" }).click();
  await restored.page
    .getByText("Kumusta 🌅 — a private hello", { exact: true })
    .waitFor();
  console.log(
    "PASS encrypted key recovery restores old conversation on a fresh browser",
  );

  await p.getByRole("button", { name: "Play together", exact: true }).click();
  await p.getByLabel("Choose a quiz").selectOption("quiz");
  await p.getByRole("button", { name: "Create a room →" }).click();
  await p.getByText("The more minds, the merrier.").waitFor();
  await p.screenshot({
    path: join(artifacts, "desktop-lobby.png"),
    fullPage: true,
    animations: "disabled",
  });
  await b.page
    .getByRole("button", { name: "Play together", exact: true })
    .click();
  await b.page.getByLabel("Room code").fill("ABC234");
  await b.page
    .getByRole("button", { name: "Join a friend", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Everybody ready? Let's play →" })
    .click();
  await p
    .getByRole("heading", { name: "Which organelle supplies energy?" })
    .waitFor();
  await b.page
    .getByRole("heading", { name: "Which organelle supplies energy?" })
    .waitFor();
  await p.getByRole("button", { name: "A Mitochondrion", exact: true }).click();
  await p.getByRole("button", { name: "Lock my answer", exact: true }).click();
  await p.getByRole("button", { name: "Locked ✓", exact: true }).waitFor();
  await b.page
    .getByRole("button", { name: "A Mitochondrion", exact: true })
    .click();
  await b.page
    .getByRole("button", { name: "Lock my answer", exact: true })
    .click();
  await p.getByRole("heading", { name: "Nicely done! +1500 points" }).waitFor();
  await p.getByRole("heading", { name: "Give yourselves a hand." }).waitFor();
  assert.equal(await p.locator(".leaderboard li").count(), 2);
  console.log(
    "PASS two-player lobby, simultaneous question, locked answers, reveal and podium",
  );
  for (const [width, height, name] of [
    [1440, 1000, "desktop"],
    [820, 1180, "tablet"],
    [390, 844, "mobile"],
  ]) {
    await p.setViewportSize({ width, height });
    const overflow = await p.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    assert(!overflow, `${name} overflows`);
    await p.screenshot({
      path: join(artifacts, `${name}-game.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p
    .getByRole("button", { name: "My profile", exact: true })
    .last()
    .click();
  await p.getByLabel("Public nickname").waitFor();
  assert(
    !(await p.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    )),
  );
  await p.getByRole("button", { name: "Biscuit, open companion chat" }).click();
  await p.screenshot({
    path: join(artifacts, "mobile-companion.png"),
    fullPage: true,
    animations: "disabled",
  });
  console.log(
    "PASS desktop, tablet, mobile layouts, More navigation, game lobby and companion panel",
  );
  await p.clock.install();
  await p.getByRole("button", { name: "Close companion", exact: true }).click();
  await p.clock.fastForward(150001);
  await p.locator(".buddy-bubble").waitFor();
  await p.locator(".buddy-bubble").click();
  assert.equal(await p.locator(".buddy-bubble").count(), 0);
  console.log(
    "PASS occasional companion bubble appears on schedule and dismisses on touch/click",
  );
  assert.deepEqual(errors, []);
  console.log("ALL BROWSER CHECKS PASSED");
} finally {
  await browser.close();
}
