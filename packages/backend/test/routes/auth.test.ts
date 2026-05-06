import { describe, expect, it } from "vitest";
import { app } from "../../src/index";
import { authHeaders, createMemoryKV, registerUser } from "../helpers";

describe("Auth routes", () => {
  it("registers a user, stores password material without plaintext, and returns a JWT", async () => {
    const kv = createMemoryKV();
    const res = await app.request(
      "/api/auth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "Student@Example.com",
          password: "correct-horse-battery-staple",
        }),
      },
      { AUTO_WRITER_KV: kv },
    );

    expect(res.status).toBe(201);
    const data = (await res.json()) as {
      token: string;
      user: { id: string; email: string };
    };
    expect(data.token.split(".")).toHaveLength(3);
    expect(data.user.email).toBe("student@example.com");

    const lookup = JSON.parse(
      (await kv.get("email:student@example.com")) ?? "{}",
    ) as {
      userId: string;
    };
    expect(lookup.userId).toBe(data.user.id);

    const stored = (await kv.get(`user:${data.user.id}`)) ?? "";
    expect(stored).not.toContain("correct-horse-battery-staple");
    expect(JSON.parse(stored)).toMatchObject({
      id: data.user.id,
      email: "student@example.com",
      passwordHash: expect.any(String),
      salt: expect.any(String),
      createdAt: expect.any(String),
    });
    await expect(kv.get("config:jwt-secret")).resolves.toEqual(
      expect.any(String),
    );
  });

  it("logs in with a registered email and password", async () => {
    const kv = createMemoryKV();
    const registered = await registerUser(
      kv,
      "student@example.com",
      "secret-passphrase",
    );

    const res = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "student@example.com",
          password: "secret-passphrase",
        }),
      },
      { AUTO_WRITER_KV: kv },
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      token: string;
      user: { id: string; email: string };
    };
    expect(data.token.split(".")).toHaveLength(3);
    expect(data.user).toEqual(registered.user);
  });

  it("rejects invalid login credentials", async () => {
    const kv = createMemoryKV();
    await registerUser(kv, "student@example.com", "secret-passphrase");

    const res = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "student@example.com",
          password: "wrong-password",
        }),
      },
      { AUTO_WRITER_KV: kv },
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid email or password",
      },
    });
  });

  it("requires a valid bearer token on protected APIs", async () => {
    const kv = createMemoryKV();
    const res = await app.request("/api/config", {}, { AUTO_WRITER_KV: kv });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid bearer token",
      },
    });

    const { token } = await registerUser(kv);
    const authorized = await app.request(
      "/api/config",
      { headers: authHeaders(token) },
      { AUTO_WRITER_KV: kv },
    );
    expect(authorized.status).toBe(200);
  });

  it("requires a valid bearer token on writing APIs", async () => {
    const kv = createMemoryKV();
    const res = await app.request(
      "/api/writing",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "写一篇作文。" }),
      },
      { AUTO_WRITER_KV: kv },
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid bearer token",
      },
    });
  });
});
