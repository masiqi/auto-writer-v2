import { Hono } from "hono";
import type { WritingTask } from "../agents";
import {
  getLLMConfig,
  getProgressEvents,
  getTask,
  progressKey,
  putTask,
  runPipeline,
  taskOwnerKey,
} from "../queue";
import type { WritingPipelineMessage } from "../queue";
import type { Bindings, ErrorResponse, Variables } from "../types";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

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

const SSE_POLL_INTERVAL_MS = 2_000;

const isTerminalTask = (task: WritingTask): boolean =>
  task.status === "completed" || task.status === "failed";

const sseEvent = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

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

  const input = body as Partial<
    Record<"title" | "prompt" | "requirements" | "grade", unknown>
  >;
  if (!isNonEmptyString(input.prompt)) {
    return c.json(error("VALIDATION_ERROR", "prompt is required"), 400);
  }

  const userId = c.get("userId");
  const config = await getLLMConfig(kv, userId);
  if (!config) {
    return c.json(
      error("CONFIGURATION_ERROR", "LLM config is not configured"),
      500,
    );
  }

  const now = new Date().toISOString();
  const requirements = buildRequirements(
    input.title,
    input.requirements,
    input.grade,
  );
  const task: WritingTask = {
    id: crypto.randomUUID(),
    userId,
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
  await kv.put(progressKey(userId, task.id), JSON.stringify([]));

  let executionCtx: ExecutionContext | undefined;
  try {
    executionCtx = c.executionCtx;
  } catch {
    executionCtx = undefined;
  }

  if (c.env.WRITING_QUEUE) {
    await sendQueueMessage(c.env.WRITING_QUEUE, { taskId: task.id, userId });
  } else {
    waitUntil(executionCtx, runPipeline(kv, task, config));
  }

  return c.json({ task }, 201);
});

app.get("/:id", async (c) => {
  const kv = c.env.AUTO_WRITER_KV;
  if (!kv) {
    return c.json(
      error("CONFIGURATION_ERROR", "KV binding is not configured"),
      500,
    );
  }

  const id = c.req.param("id");
  const userId = c.get("userId");
  const ownerId = await kv.get(taskOwnerKey(id));
  if (ownerId && ownerId !== userId) {
    return c.json(
      error("FORBIDDEN", "Writing task belongs to another user"),
      403,
    );
  }

  const task = await getTask(kv, userId, id);
  if (!task) {
    return c.json(error("NOT_FOUND", "Writing task not found"), 404);
  }

  return c.json({ task });
});

app.get("/:id/stream", async (c) => {
  const kv = c.env.AUTO_WRITER_KV;
  if (!kv) {
    return c.json(
      error("CONFIGURATION_ERROR", "KV binding is not configured"),
      500,
    );
  }

  const id = c.req.param("id");
  const userId = c.get("userId");
  const ownerId = await kv.get(taskOwnerKey(id));
  if (ownerId && ownerId !== userId) {
    return c.json(
      error("FORBIDDEN", "Writing task belongs to another user"),
      403,
    );
  }
  const task = await getTask(kv, userId, id);
  if (!task) {
    return c.json(error("NOT_FOUND", "Writing task not found"), 404);
  }

  const events = await getProgressEvents(kv, userId, id);
  const encoder = new TextEncoder();
  let isCancelled = false;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sentProgressCount = 0;

      const send = (event: string, data: unknown): void => {
        if (!isCancelled) {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        }
      };

      send("task", task);
      for (const event of events) {
        send("progress", event);
        sentProgressCount += 1;
      }

      if (isTerminalTask(task)) {
        controller.close();
        return;
      }

      try {
        while (!isCancelled) {
          await delay(SSE_POLL_INTERVAL_MS);
          if (isCancelled) {
            return;
          }

          const [nextEvents, nextTask] = await Promise.all([
            getProgressEvents(kv, userId, id),
            getTask(kv, userId, id),
          ]);

          if (nextEvents.length > sentProgressCount) {
            for (const event of nextEvents.slice(sentProgressCount)) {
              send("progress", event);
            }
            sentProgressCount = nextEvents.length;
          }

          if (!nextTask) {
            controller.close();
            return;
          }

          if (isTerminalTask(nextTask)) {
            send("task", nextTask);
            controller.close();
            return;
          }
        }
      } catch (caught) {
        controller.error(caught);
      }
    },
    cancel() {
      isCancelled = true;
      return undefined;
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

export default app;
