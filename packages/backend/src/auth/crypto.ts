import type { AuthUser } from "../types";

const JWT_SECRET_KEY = "config:jwt-secret";
const JWT_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
const PASSWORD_ITERATIONS = 100_000;

type StoredUser = AuthUser & {
  passwordHash: string;
  salt: string;
  createdAt: string;
};

type JwtPayload = AuthUser & {
  userId: string;
  iat: number;
  exp: number;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const base64UrlEncode = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const base64UrlDecode = (value: string): Uint8Array => {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const importHmacKey = async (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    base64UrlDecode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

const getJwtSecret = async (kv: KVNamespace): Promise<string> => {
  const stored = await kv.get(JWT_SECRET_KEY);
  if (stored) {
    return stored;
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = base64UrlEncode(bytes);
  await kv.put(JWT_SECRET_KEY, secret);
  return secret;
};

const passwordKey = async (password: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

export const hashPassword = async (
  password: string,
): Promise<{ passwordHash: string; salt: string }> => {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const key = await passwordKey(password);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: PASSWORD_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    256,
  );

  return {
    passwordHash: base64UrlEncode(new Uint8Array(bits)),
    salt: base64UrlEncode(saltBytes),
  };
};

export const verifyPassword = async (
  password: string,
  stored: Pick<StoredUser, "passwordHash" | "salt">,
): Promise<boolean> => {
  const key = await passwordKey(password);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: base64UrlDecode(stored.salt),
      iterations: PASSWORD_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return base64UrlEncode(new Uint8Array(bits)) === stored.passwordHash;
};

export const signJwt = async (
  kv: KVNamespace,
  user: AuthUser,
): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(
    textEncoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  );
  const payload = base64UrlEncode(
    textEncoder.encode(
      JSON.stringify({
        userId: user.id,
        id: user.id,
        email: user.email,
        iat: now,
        exp: now + JWT_EXPIRY_SECONDS,
      } satisfies JwtPayload),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const key = await importHmacKey(await getJwtSecret(kv));
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
};

export const verifyJwt = async (
  kv: KVNamespace,
  token: string,
): Promise<AuthUser | null> => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [header, payload, signature] = parts;
  const key = await importHmacKey(await getJwtSecret(kv));
  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecode(signature),
    textEncoder.encode(`${header}.${payload}`),
  );
  if (!isValid) {
    return null;
  }

  let parsed: Partial<JwtPayload>;
  try {
    parsed = JSON.parse(
      textDecoder.decode(base64UrlDecode(payload)),
    ) as Partial<JwtPayload>;
  } catch {
    return null;
  }

  if (
    typeof parsed.userId !== "string" ||
    typeof parsed.email !== "string" ||
    typeof parsed.exp !== "number" ||
    parsed.exp <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  return { id: parsed.userId, email: parsed.email };
};

export type { StoredUser };
