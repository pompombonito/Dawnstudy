import { communityApi } from "./api";
import type { CipherMessage, Envelope } from "./types";

type Identity = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  fingerprint: string;
};
type RemoteKey = { public_key: JsonWebKey | null; fingerprint: string };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const b64 = (v: ArrayBuffer | Uint8Array) =>
  btoa(
    String.fromCharCode(
      ...new Uint8Array(
        v instanceof Uint8Array
          ? (v.buffer.slice(
              v.byteOffset,
              v.byteOffset + v.byteLength,
            ) as ArrayBuffer)
          : v,
      ),
    ),
  );
const un64 = (v: string) => Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
const buffer = (v: Uint8Array): ArrayBuffer =>
  v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
export const hex = (v: ArrayBuffer) =>
  [...new Uint8Array(v)].map((b) => b.toString(16).padStart(2, "0")).join("");
export async function fingerprint(key: JsonWebKey) {
  return hex(
    await crypto.subtle.digest("SHA-256", encoder.encode(`${key.x}.${key.y}`)),
  );
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("dawnstudy-private-keys-v1", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("identities");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          "This browser cannot keep a private messaging key. Enable browser storage.",
        ),
      );
  });
}
async function readIdentity(uid: string): Promise<Identity | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction("identities").objectStore("identities").get(uid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
async function writeIdentity(uid: string, value: Identity) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("identities", "readwrite");
      tx.objectStore("identities").put(value, uid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function enableMessaging(
  token: string,
  uid: string,
): Promise<Identity> {
  // Serialize first-key creation across tabs before publishing a public key.
  if (navigator.locks)
    return navigator.locks.request(`dawnstudy-chat-key:${uid}`, () =>
      initializeMessaging(token, uid),
    );
  return initializeMessaging(token, uid);
}
async function initializeMessaging(
  token: string,
  uid: string,
): Promise<Identity> {
  if (!globalThis.crypto?.subtle)
    throw new Error("Private chat needs a secure HTTPS connection.");
  const remote = await communityApi<RemoteKey>(
    token,
    `/messaging-key/${encodeURIComponent(uid)}`,
  );
  let local = await readIdentity(uid);
  if (!local && remote.public_key)
    throw new Error(
      "Restore your encrypted recovery file to chat on this device. Your private key stays on your original device.",
    );
  if (!local) {
    const pair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    local = {
      ...pair,
      fingerprint: await fingerprint(
        await crypto.subtle.exportKey("jwk", pair.publicKey),
      ),
    };
    // Save before publishing, so a failed request never loses the published key.
    await writeIdentity(uid, local);
  }
  if (remote.fingerprint && remote.fingerprint !== local.fingerprint)
    throw new Error(
      "This device's key differs from your account. Restore the correct recovery file.",
    );
  if (!remote.public_key)
    await communityApi(
      token,
      "/messaging-key",
      { public_key: await crypto.subtle.exportKey("jwk", local.publicKey) },
      "PUT",
    );
  return local;
}
export async function peerKey(token: string, uid: string, other: string) {
  const remote = await communityApi<RemoteKey>(
    token,
    `/messaging-key/${encodeURIComponent(other)}`,
  );
  if (!remote.public_key)
    throw new Error(
      "Your friend hasn't enabled private chat yet. Ask them to open Messages once.",
    );
  if ((await fingerprint(remote.public_key)) !== remote.fingerprint)
    throw new Error("Invalid safety code. Please try again later.");
  const pin = `dawnstudy-peer-key:${uid}:${other}`;
  const previous = localStorage.getItem(pin);
  if (previous && previous !== remote.fingerprint)
    throw new Error(
      "Your friend's safety code changed. Verify it with them before continuing.",
    );
  localStorage.setItem(pin, remote.fingerprint);
  return {
    key: await crypto.subtle.importKey(
      "jwk",
      remote.public_key,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    ),
    fingerprint: remote.fingerprint,
  };
}
async function messageKey(
  identity: Identity,
  peer: CryptoKey,
  salt: Uint8Array,
  sender: string,
  recipient: string,
) {
  const bits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peer },
    identity.privateKey,
    256,
  );
  const material = await crypto.subtle.importKey("raw", bits, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: buffer(salt),
      info: encoder.encode(`dawnstudy-dm-v1:${sender}:${recipient}`),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
function aad(sender: string, recipient: string, sk: string, rk: string) {
  return encoder.encode(`1:${sender}:${recipient}:${sk}:${rk}`);
}
export async function encryptMessage(
  identity: Identity,
  peer: { key: CryptoKey; fingerprint: string },
  sender: string,
  recipient: string,
  text: string,
): Promise<Envelope> {
  const salt = crypto.getRandomValues(new Uint8Array(32)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await messageKey(identity, peer.key, salt, sender, recipient);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: buffer(iv),
      additionalData: aad(
        sender,
        recipient,
        identity.fingerprint,
        peer.fingerprint,
      ),
    },
    key,
    encoder.encode(text),
  );
  return {
    version: 1,
    salt: b64(salt),
    iv: b64(iv),
    ciphertext: b64(ciphertext),
    sender_key: identity.fingerprint,
    recipient_key: peer.fingerprint,
  };
}
export async function decryptMessage(
  identity: Identity,
  peer: { key: CryptoKey; fingerprint: string },
  message: CipherMessage,
) {
  const e = message.envelope;
  const key = await messageKey(
    identity,
    peer.key,
    un64(e.salt),
    message.sender_id,
    message.recipient_id,
  );
  return decoder.decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: buffer(un64(e.iv)),
        additionalData: aad(
          message.sender_id,
          message.recipient_id,
          e.sender_key,
          e.recipient_key,
        ),
      },
      key,
      buffer(un64(e.ciphertext)),
    ),
  );
}
async function backupKey(password: string, salt: Uint8Array) {
  if (password.length < 12)
    throw new Error("Use a recovery passphrase of at least 12 characters.");
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: buffer(salt), iterations: 600000 },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function exportRecovery(
  token: string,
  uid: string,
  password: string,
) {
  const identity = await enableMessaging(token, uid);
  const salt = crypto.getRandomValues(new Uint8Array(32)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const contents = JSON.stringify({
    uid,
    privateKey: await crypto.subtle.exportKey("jwk", identity.privateKey),
    publicKey: await crypto.subtle.exportKey("jwk", identity.publicKey),
  });
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: buffer(iv),
      additionalData: encoder.encode("dawnstudy-key-backup-v1"),
    },
    await backupKey(password, salt),
    encoder.encode(contents),
  );
  return JSON.stringify({
    version: 1,
    salt: b64(salt),
    iv: b64(iv),
    ciphertext: b64(ciphertext),
  });
}
export async function importRecovery(
  token: string,
  uid: string,
  password: string,
  file: string,
) {
  const data = JSON.parse(file);
  if (data.version !== 1 || file.length > 20000)
    throw new Error("Choose a Dawnstudy encrypted recovery file.");
  let restored;
  try {
    restored = JSON.parse(
      decoder.decode(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: buffer(un64(data.iv)),
            additionalData: encoder.encode("dawnstudy-key-backup-v1"),
          },
          await backupKey(password, un64(data.salt)),
          buffer(un64(data.ciphertext)),
        ),
      ),
    );
  } catch {
    throw new Error("That passphrase couldn't open this recovery file.");
  }
  if (restored.uid !== uid)
    throw new Error("This recovery file belongs to a different account.");
  const remote = await communityApi<RemoteKey>(
    token,
    `/messaging-key/${encodeURIComponent(uid)}`,
  );
  const fp = await fingerprint(restored.publicKey);
  if (remote.fingerprint && remote.fingerprint !== fp)
    throw new Error("This file doesn't match your account's safety code.");
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    restored.privateKey,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    restored.publicKey,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
  // Verify the two restored keys belong together before saving them.
  const check = await crypto.subtle.exportKey("jwk", privateKey);
  if (check.x !== restored.publicKey.x || check.y !== restored.publicKey.y)
    throw new Error("Invalid recovery key pair.");
  await writeIdentity(uid, { privateKey, publicKey, fingerprint: fp });
  await enableMessaging(token, uid);
}
