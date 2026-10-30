export type Theme = "light" | "dark" | "rose";
export type Gender = "male" | "female" | "gender-diverse" | "prefer-not-to-say";
export type Person = {
  id: string;
  nickname: string;
  avatar_id: string;
  tag: string;
  online: boolean;
  relationship?: string;
  outgoing?: boolean;
};
export type Profile = {
  user_id: string;
  nickname: string;
  avatar_id: string;
  gender: Gender;
  theme: Theme;
  discoverable: boolean;
  companion_id: string;
  companion_name: string;
  onboarded: boolean;
  terms_version: string;
  terms_accepted_at: string;
  key_fingerprint: string;
  public_key: JsonWebKey | null;
};
export type ProfileInput = Pick<
  Profile,
  | "nickname"
  | "avatar_id"
  | "gender"
  | "theme"
  | "discoverable"
  | "companion_id"
  | "companion_name"
> & { accept_terms?: boolean; terms_version?: string };
export type Bootstrap = {
  profile: Profile | null;
  friends: Person[];
  incoming: Person[];
  outgoing: Person[];
  blocked: Person[];
  invitations: { code: string; title: string }[];
  terms_version: string;
};
export type Envelope = {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
  sender_key: string;
  recipient_key: string;
};
export type CipherMessage = {
  id: string;
  sender_id: string;
  recipient_id: string;
  created_at: string;
  envelope: Envelope;
};
export type Game = {
  code: string;
  host: string;
  title: string;
  kind: string;
  phase: "lobby" | "countdown" | "question" | "reveal" | "finished";
  index: number;
  total: number;
  deadline: number;
  server_time: number;
  players: (Person & { points: number; correct: number; rank: number })[];
  answered: boolean;
  answered_count: number;
  question?: {
    question: string;
    options: string[];
    answer?: string | string[];
    explanation?: string;
  };
  feedback?: { correct: boolean; points: number };
};
