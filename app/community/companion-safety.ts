import policy from "../../backend/companion_safety_policy.json";

export type SafetyCategory = keyof typeof policy.responses;
export type ContactId = keyof typeof policy.contacts;
export type SafetyInfo = {
  category: SafetyCategory;
  emergency: boolean;
  contacts: ContactId[];
};
export type CompanionReply = {
  reply: string;
  model: string;
  suggest_friends: boolean;
  safety?: SafetyInfo | null;
};
export type CompanionTurn = {
  role: "user" | "assistant";
  content: string;
  suggest?: boolean;
  safety?: SafetyInfo | null;
};
export const supportContacts = policy.contacts;

type PatternGroup = keyof typeof policy.patterns;
const patterns = Object.fromEntries(
  Object.entries(policy.patterns).map(([key, list]) => [
    key,
    list.map((p) => new RegExp(p, "iu")),
  ]),
) as Record<PatternGroup, RegExp[]>;
const matches = (key: PatternGroup, text: string) =>
  patterns[key].some((p) => p.test(text));
const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export function classifyCompanion(
  message: string,
  history: { role: string; content: string }[] = [],
): SafetyCategory | null {
  let text = normalize(message);
  for (const p of [...patterns.negations, ...patterns.harmless])
    text = text.replace(new RegExp(p.source, "giu"), " ");
  const unquoted = text.replace(/"[^"\n]*"|(?<!\w)'[^'\n]*'/g, " ");
  const educational =
    matches("educational", text) && !matches("personal_intent", unquoted);
  if (!educational) {
    for (const category of [
      "medical_emergency",
      "violent_intent",
      "self_harm",
      "immediate_danger",
      "harmful_request",
    ] as const)
      if (matches(category, text)) return category;
    if (matches("followup", text)) {
      const previous = history
        .slice(-6)
        .filter((turn) => turn.role === "user")
        .slice(-2)
        .reverse();
      for (const turn of previous) {
        const category = classifyCompanion(turn.content);
        if (
          category &&
          [
            "self_harm",
            "medical_emergency",
            "violent_intent",
            "immediate_danger",
          ].includes(category)
        )
          return category;
        if (!matches("followup", normalize(turn.content))) break;
      }
    }
  }
  for (const category of [
    "resources",
    "clinical_boundary",
    "abuse_support",
    "distress",
    "support",
  ] as const)
    if ((category === "resources" || !educational) && matches(category, text))
      return category;
  return null;
}

export function safetyReply(category: SafetyCategory): CompanionReply {
  const value = policy.responses[category];
  return {
    reply: value.reply,
    model: "dawnstudy-safety-policy",
    suggest_friends: value.suggest_friends,
    safety: {
      category,
      emergency: value.emergency,
      contacts: value.contacts as ContactId[],
    },
  };
}

/** Refresh legacy replies locally so an old crisis chat also receives help. */
export function restoreCompanionHistory(value: unknown): CompanionTurn[] {
  if (!Array.isArray(value)) return [];
  const restored: CompanionTurn[] = [];
  for (const item of value.slice(-24)) {
    if (
      !item ||
      !["user", "assistant"].includes(item.role) ||
      typeof item.content !== "string"
    )
      continue;
    let turn: CompanionTurn = {
      role: item.role,
      content: item.content,
      suggest: item.suggest === true,
    };
    if (turn.role === "assistant") {
      const previous = restored[restored.length - 1];
      const category: SafetyCategory | null =
        item.safety && Object.hasOwn(policy.responses, item.safety.category)
          ? item.safety.category
          : previous?.role === "user"
            ? classifyCompanion(previous.content, restored.slice(0, -1))
            : null;
      if (category) {
        const fixed = safetyReply(category);
        turn = {
          role: "assistant",
          content: fixed.reply,
          suggest: fixed.suggest_friends,
          safety: fixed.safety,
        };
      }
    }
    restored.push(turn);
  }
  const last = restored[restored.length - 1];
  if (last?.role === "user") {
    const category = classifyCompanion(last.content, restored.slice(0, -1));
    if (category) {
      const fixed = safetyReply(category);
      restored.push({
        role: "assistant",
        content: fixed.reply,
        suggest: fixed.suggest_friends,
        safety: fixed.safety,
      });
    }
  }
  return restored.slice(-24);
}
