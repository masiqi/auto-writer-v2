import { Hono } from "hono";
import { getTopicSummaries } from "../queue";
import type { Bindings, ErrorResponse, Variables } from "../types";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const error = (
  code: ErrorResponse["error"]["code"],
  message: string,
): ErrorResponse => ({
  error: { code, message },
});

app.get("/", async (c) => {
  const kv = c.env.AUTO_WRITER_KV;
  if (!kv) {
    return c.json(
      error("CONFIGURATION_ERROR", "KV binding is not configured"),
      500,
    );
  }

  const topics = await getTopicSummaries(kv, c.get("userId"));
  return c.json({ topics });
});

export default app;
