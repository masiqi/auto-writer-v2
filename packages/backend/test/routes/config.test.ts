import { describe, expect, it } from "vitest";
import { app } from "../../src/index";
import { authHeaders, createMemoryKV, registerUser } from "../helpers";

type ConfigResponse = {
  config: {
    baseUrl: string;
    apiKey: string;
    model: string;
    updatedAt: string;
  };
};

type MaskedConfigResponse = {
  config: {
    baseUrl: string;
    apiKeyMasked: string;
    model: string;
    updatedAt: string;
  } | null;
};

describe("Config routes", () => {
  it("saves LLM config in user-scoped KV", async () => {
    const kv = createMemoryKV();
    const { token, user } = await registerUser(kv);
    const config = {
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "writer-model",
    };

    const res = await app.request(
      "/api/config",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify(config),
      },
      { AUTO_WRITER_KV: kv },
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as ConfigResponse;
    expect(data).toMatchObject({
      config: {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
      },
    });
    expect(data.config.updatedAt).toEqual(expect.any(String));
    await expect(kv.get("config:llm")).resolves.toBeNull();
    await expect(kv.get(`user:${user.id}:config:llm`)).resolves.toEqual(
      expect.any(String),
    );
  });

  it("returns stored LLM config with masked apiKey", async () => {
    const kv = createMemoryKV();
    const { token } = await registerUser(kv);
    const bindings = { AUTO_WRITER_KV: kv };
    const config = {
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-long-key-12345",
      model: "writer-model",
    };
    await app.request(
      "/api/config",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify(config),
      },
      bindings,
    );

    const res = await app.request(
      "/api/config",
      { headers: authHeaders(token) },
      bindings,
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as MaskedConfigResponse;
    expect(data.config).not.toBeNull();
    expect(data.config!.baseUrl).toBe(config.baseUrl);
    expect(data.config!.model).toBe(config.model);
    expect(data.config!.apiKeyMasked).toContain("sk-t");
    expect(data.config!.apiKeyMasked).toContain("2345");
    // Must NOT contain the full key
    expect(data.config!.apiKeyMasked).not.toBe(config.apiKey);
  });

  it("returns null config when LLM config has not been saved", async () => {
    const kv = createMemoryKV();
    const { token } = await registerUser(kv);
    const res = await app.request(
      "/api/config",
      { headers: authHeaders(token) },
      { AUTO_WRITER_KV: kv },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      config: null,
    });
  });

  it("isolates LLM config by user", async () => {
    const kv = createMemoryKV();
    const userA = await registerUser(kv, "a@example.com");
    const userB = await registerUser(kv, "b@example.com");

    await app.request(
      "/api/config",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(userA.token),
        },
        body: JSON.stringify({
          baseUrl: "https://a.example.com",
          apiKey: "sk-user-a",
          model: "model-a",
        }),
      },
      { AUTO_WRITER_KV: kv },
    );

    const res = await app.request(
      "/api/config",
      { headers: authHeaders(userB.token) },
      { AUTO_WRITER_KV: kv },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ config: null });
  });

  it("rejects incomplete LLM config", async () => {
    const kv = createMemoryKV();
    const { token } = await registerUser(kv);
    const res = await app.request(
      "/api/config",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
        }),
      },
      { AUTO_WRITER_KV: kv },
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "model is required",
      },
    });
  });
});
