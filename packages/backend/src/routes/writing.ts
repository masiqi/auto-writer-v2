import { Hono } from "hono";
import { LLMPipelineExecutor, Pipeline } from "../agents";
import type {
  AgentResult,
  LLMConfig,
  ProgressEvent,
  WritingTask,
} from "../agents";
import type { Bindings, ErrorResponse } from "../types";

const CONFIG_KEY = "config:llm";
const taskKey = (id: string) => `writing:${id}`;
const progressKey = (id: string) => `writing:${id}:progress`;

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
  const stored = await kv.get(taskKey(id));
  return stored ? (JSON.parse(stored) as WritingTask) : null;
};

const putTask = async (kv: KVNamespace, task: WritingTask): Promise<void> => {
  await kv.put(taskKey(task.id), JSON.stringify(task));
};

const getProgressEvents = async (
  kv: KVNamespace,
  id: string,
): Promise<ProgressEvent[]> => {
  const stored = await kv.get(progressKey(id));
  return stored ? (JSON.parse(stored) as ProgressEvent[]) : [];
};

const getLLMConfig = async (kv: KVNamespace): Promise<LLMConfig | null> => {
  const stored = await kv.get(CONFIG_KEY);
  if (!stored) {
    return null;
  }

  const parsed = JSON.parse(stored) as Partial<LLMConfig>;
  if (
    !isNonEmptyString(parsed.baseUrl) ||
    !isNonEmptyString(parsed.apiKey) ||
    !isNonEmptyString(parsed.model)
  ) {
    return null;
  }

  return {
    baseUrl: parsed.baseUrl,
    apiKey: parsed.apiKey,
    model: parsed.model,
  };
};

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

const finalOutput = (results: AgentResult[]): string | undefined =>
  results.at(-1)?.output;

const runPipeline = async (
  kv: KVNamespace,
  task: WritingTask,
  config: LLMConfig,
): Promise<void> => {
  const progressEvents: ProgressEvent[] = [];
  let progressWrite = Promise.resolve();
  const pipeline = new Pipeline(new LLMPipelineExecutor(), (event) => {
    progressEvents.push(event);
    progressWrite = progressWrite.then(() => {
      return kv.put(progressKey(task.id), JSON.stringify(progressEvents));
    });
  });

  try {
    const results = await pipeline.run(task.topic, task.requirements ?? "", config);
    await progressWrite;
    const completedTask: WritingTask = {
      ...task,
      status: "completed",
      result: finalOutput(results),
      agentResults: results,
      updatedAt: new Date().toISOString(),
    };

    await putTask(kv, completedTask);
  } catch (caught) {
    await progressWrite;
    const currentTask = (await getTask(kv, task.id)) ?? task;
    const errorMessage = caught instanceof Error ? caught.message : String(caught);
    const failedTask: WritingTask = {
      ...currentTask,
      status: "failed",
      error: errorMessage,
      updatedAt: new Date().toISOString(),
    };

    await putTask(kv, failedTask);
  }
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

  waitUntil(executionCtx, runPipeline(kv, task, config));

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
