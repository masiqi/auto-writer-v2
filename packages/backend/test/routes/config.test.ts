import { describe, expect, it } from "vitest";
import app from "../../src/index";

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

const createMemoryKV = (): KVNamespace => {
  const store = new Map<string, string>();

  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    put: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
  } as unknown as KVNamespace;
};

const env = () => ({
  AUTO_WRITER_KV: createMemoryKV(),
});

describe("Config routes", () => {
  it("saves LLM config in KV", async () => {
    const config = {
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "writer-model",
    };

    const res = await app.request(
      "/api/config",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      },
      env(),
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
  });

  it("returns stored LLM config with masked apiKey", async () => {
    const bindings = env();
    const config = {
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-long-key-12345",
      model: "writer-model",
    };
    await app.request(
      "/api/config",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      },
      bindings,
    );

    const res = await app.request("/api/config", {}, bindings);

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
    const res = await app.request("/api/config", {}, env());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      config: null,
    });
  });

  it("rejects incomplete LLM config", async () => {
    const res = await app.request(
      "/api/config",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
        }),
      },
      env(),
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
