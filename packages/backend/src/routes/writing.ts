import { Hono } from "hono";
import type { Bindings, ErrorResponse } from "../types";

type WritingTaskStatus = "pending" | "processing" | "completed" | "failed";

type WritingTask = {
  id: string;
  title?: string;
  prompt: string;
  grade?: string;
  status: WritingTaskStatus;
  createdAt: string;
  updatedAt: string;
};

const app = new Hono<{ Bindings: Bindings }>();

const error = (
  code: ErrorResponse["error"]["code"],
  message: string,
): ErrorResponse => ({
  error: { code, message },
});

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const getTask = async (
  kv: KVNamespace,
  id: string,
): Promise<WritingTask | null> => {
  const stored = await kv.get(`writing:${id}`);
  return stored ? (JSON.parse(stored) as WritingTask) : null;
};

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

  const input = body as Partial<Record<"title" | "prompt" | "grade", unknown>>;
  if (!isNonEmptyString(input.prompt)) {
    return c.json(error("VALIDATION_ERROR", "prompt is required"), 400);
  }

  const now = new Date().toISOString();
  const task: WritingTask = {
    id: crypto.randomUUID(),
    prompt: input.prompt.trim(),
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  if (isNonEmptyString(input.title)) {
    task.title = input.title.trim();
  }
  if (isNonEmptyString(input.grade)) {
    task.grade = input.grade.trim();
  }

  await kv.put(`writing:${task.id}`, JSON.stringify(task));

  return c.json({ task }, 201);
});

app.get("/:id", async (c) => {
  const kv = c.env.AUTO_WRITER_KV;
  if (!kv) {
    return c.json(error("CONFIGURATION_ERROR", "KV binding is not configured"), 500);
  }

  const task = await getTask(kv, c.req.param("id"));
  if (!task) {
    return c.json(error("NOT_FOUND", "Writing task not found"), 404);
  }

  return c.json({ task });
});

app.get("/:id/stream", async (c) => {
  const kv = c.env.AUTO_WRITER_KV;
  if (!kv) {
    return c.json(error("CONFIGURATION_ERROR", "KV binding is not configured"), 500);
  }

  const task = await getTask(kv, c.req.param("id"));
  if (!task) {
    return c.json(error("NOT_FOUND", "Writing task not found"), 404);
  }

  return new Response(`event: task\ndata: ${JSON.stringify(task)}\n\n`, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

export default app;
