import { Hono } from "hono";
import { hashPassword, signJwt, verifyPassword } from "../auth/crypto";
import type { StoredUser } from "../auth/crypto";
import type { AuthUser, Bindings, ErrorResponse, Variables } from "../types";

type EmailLookup = {
  userId: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const error = (
  code: ErrorResponse["error"]["code"],
  message: string,
): ErrorResponse => ({
  error: { code, message },
});

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const userResponse = async (kv: KVNamespace, user: AuthUser) => ({
  user,
  token: await signJwt(kv, user),
});

app.post("/register", async (c) => {
  const kv = c.env.AUTO_WRITER_KV;
  if (!kv) {
    return c.json(
      error("CONFIGURATION_ERROR", "KV binding is not configured"),
      500,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(error("BAD_REQUEST", "Request body must be valid JSON"), 400);
  }

  const input = body as Partial<Record<"email" | "password", unknown>>;
  if (!isNonEmptyString(input.email)) {
    return c.json(error("VALIDATION_ERROR", "email is required"), 400);
  }
  if (!isNonEmptyString(input.password)) {
    return c.json(error("VALIDATION_ERROR", "password is required"), 400);
  }

  const email = normalizeEmail(input.email);
  const existing = await kv.get(`email:${email}`);
  if (existing) {
    return c.json(
      error("VALIDATION_ERROR", "email is already registered"),
      400,
    );
  }

  const userId = crypto.randomUUID();
  const passwordMaterial = await hashPassword(input.password);
  const storedUser: StoredUser = {
    id: userId,
    email,
    passwordHash: passwordMaterial.passwordHash,
    salt: passwordMaterial.salt,
    createdAt: new Date().toISOString(),
  };

  await kv.put(`user:${userId}`, JSON.stringify(storedUser));
  await kv.put(
    `email:${email}`,
    JSON.stringify({ userId } satisfies EmailLookup),
  );

  return c.json(await userResponse(kv, { id: userId, email }), 201);
});

app.post("/login", async (c) => {
  const kv = c.env.AUTO_WRITER_KV;
  if (!kv) {
    return c.json(
      error("CONFIGURATION_ERROR", "KV binding is not configured"),
      500,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(error("BAD_REQUEST", "Request body must be valid JSON"), 400);
  }

  const input = body as Partial<Record<"email" | "password", unknown>>;
  if (!isNonEmptyString(input.email) || !isNonEmptyString(input.password)) {
    return c.json(error("UNAUTHORIZED", "Invalid email or password"), 401);
  }

  const email = normalizeEmail(input.email);
  const lookup = await kv.get(`email:${email}`);
  if (!lookup) {
    return c.json(error("UNAUTHORIZED", "Invalid email or password"), 401);
  }

  const { userId } = JSON.parse(lookup) as EmailLookup;
  const stored = await kv.get(`user:${userId}`);
  if (!stored) {
    return c.json(error("UNAUTHORIZED", "Invalid email or password"), 401);
  }

  const user = JSON.parse(stored) as StoredUser;
  const passwordMatches = await verifyPassword(input.password, user);
  if (!passwordMatches) {
    return c.json(error("UNAUTHORIZED", "Invalid email or password"), 401);
  }

  return c.json(await userResponse(kv, { id: user.id, email: user.email }));
});

export default app;
