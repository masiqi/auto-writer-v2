import { Hono } from "hono";
import type { Bindings, ErrorResponse } from "../types";

type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  updatedAt: string;
};

const CONFIG_KEY = "config:llm";

const app = new Hono<{ Bindings: Bindings }>();

const error = (
  code: ErrorResponse["error"]["code"],
  message: string,
): ErrorResponse => ({
  error: { code, message },
});

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

app.post("/", async (c) => {
  const kv = c.env.AUTO_WRITER_KV;
  if (!kv) {
    return c.json(error("CONFIGURATION_ERROR", "KV binding is not configured"), 500);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(error("BAD_REQUEST", "Request body must be valid JSON"), 400);
  }

  const input = body as Partial<Record<"baseUrl" | "apiKey" | "model", unknown>>;
  if (!isNonEmptyString(input.baseUrl)) {
    return c.json(error("VALIDATION_ERROR", "baseUrl is required"), 400);
  }
  if (!isNonEmptyString(input.apiKey)) {
    return c.json(error("VALIDATION_ERROR", "apiKey is required"), 400);
  }
  if (!isNonEmptyString(input.model)) {
    return c.json(error("VALIDATION_ERROR", "model is required"), 400);
  }

  const config: LlmConfig = {
    baseUrl: input.baseUrl.trim(),
    apiKey: input.apiKey.trim(),
    model: input.model.trim(),
    updatedAt: new Date().toISOString(),
  };

  await kv.put(CONFIG_KEY, JSON.stringify(config));

  return c.json({ config });
});

app.get("/", async (c) => {
  const kv = c.env.AUTO_WRITER_KV;
  if (!kv) {
    return c.json(error("CONFIGURATION_ERROR", "KV binding is not configured"), 500);
  }

  const stored = await kv.get(CONFIG_KEY);
  if (!stored) {
    return c.json(error("NOT_FOUND", "LLM config not found"), 404);
  }

  return c.json({ config: JSON.parse(stored) as LlmConfig });
});

export default app;
