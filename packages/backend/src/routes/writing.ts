import { Hono } from "hono";
import type { WritingTask } from "../agents";
import {
  getLLMConfig,
  getProgressEvents,
  getTask,
  progressKey,
  putTask,
  runPipeline,
} from "../queue";
import type { WritingPipelineMessage } from "../queue";
import type { Bindings, ErrorResponse } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

const error = (
  code: ErrorResponse["error"]["code"],
  message: string,
): ErrorResponse => ({
  error: { code, message },
});

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const buildRequirements = (
  title: unknown,
  requirements: unknown,
  grade: unknown,
): string => {
  const parts: string[] = [];

  if (isNonEmptyString(title)) {
    parts.push(`标题：${title.trim()}`);
  }
  if (isNonEmptyString(grade)) {
    parts.push(`年级：${grade.trim()}`);
  }
  if (isNonEmptyString(requirements)) {
    parts.push(requirements.trim());
  }

  return parts.join("\n");
};

const waitUntil = (
  executionCtx: ExecutionContext | undefined,
  promise: Promise<unknown>,
): void => {
  if (executionCtx) {
    executionCtx.waitUntil(promise);
    return;
  }

  void promise;
};

type QueueWithSendMessage = Queue<WritingPipelineMessage> & {
  sendMessage?: (message: WritingPipelineMessage) => Promise<unknown>;
};

const sendQueueMessage = async (
  queue: QueueWithSendMessage,
  message: WritingPipelineMessage,
): Promise<void> => {
  if (queue.sendMessage) {
    await queue.sendMessage(message);
    return;
  }

  await queue.send(message);
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

  const input = body as Partial<
    Record<"title" | "prompt" | "requirements" | "grade", unknown>
  >;
  if (!isNonEmptyString(input.prompt)) {
    return c.json(error("VALIDATION_ERROR", "prompt is required"), 400);
  }

  const config = await getLLMConfig(kv);
  if (!config) {
    return c.json(error("CONFIGURATION_ERROR", "LLM config is not configured"), 500);
  }

  const now = new Date().toISOString();
  const requirements = buildRequirements(
    input.title,
    input.requirements,
    input.grade,
  );
  const task: WritingTask = {
    id: crypto.randomUUID(),
    topic: input.prompt.trim(),
    status: "running",
    agentResults: [],
    createdAt: now,
    updatedAt: now,
  };

  if (requirements) {
    task.requirements = requirements;
  }

  await putTask(kv, task);
  await kv.put(progressKey(task.id), JSON.stringify([]));

  let executionCtx: ExecutionContext | undefined;
  try {
    executionCtx = c.executionCtx;
  } catch {
    executionCtx = undefined;
  }

  if (c.env.WRITING_QUEUE) {
    await sendQueueMessage(c.env.WRITING_QUEUE, { taskId: task.id });
  } else {
    waitUntil(executionCtx, runPipeline(kv, task, config));
  }

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

  const id = c.req.param("id");
  const task = await getTask(kv, id);
  if (!task) {
    return c.json(error("NOT_FOUND", "Writing task not found"), 404);
  }

  const events = await getProgressEvents(kv, id);
  const body = [
    `event: task\ndata: ${JSON.stringify(task)}\n\n`,
    ...events.map((event) => {
      return `event: progress\ndata: ${JSON.stringify(event)}\n\n`;
    }),
  ].join("");

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

export default app;
