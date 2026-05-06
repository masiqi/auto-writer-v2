import { LLMPipelineExecutor, Pipeline } from "./agents";
import type {
  AgentResult,
  LLMConfig,
  ProgressEvent,
  WritingTask,
} from "./agents";
import type { Bindings } from "./types";

export type WritingPipelineMessage = {
  taskId: string;
  userId: string;
};

export const configKey = (userId: string) => `user:${userId}:config:llm`;
export const taskOwnerKey = (id: string) => `writing:${id}:owner`;
export const taskKey = (userId: string, id: string) =>
  `user:${userId}:writing:${id}`;
export const progressKey = (userId: string, id: string) =>
  `user:${userId}:writing:${id}:progress`;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const getTask = async (
  kv: KVNamespace,
  userId: string,
  id: string,
): Promise<WritingTask | null> => {
  const stored = await kv.get(taskKey(userId, id));
  return stored ? (JSON.parse(stored) as WritingTask) : null;
};

export const putTask = async (
  kv: KVNamespace,
  task: WritingTask,
): Promise<void> => {
  await kv.put(taskOwnerKey(task.id), task.userId);
  await kv.put(taskKey(task.userId, task.id), JSON.stringify(task));
};

export const getProgressEvents = async (
  kv: KVNamespace,
  userId: string,
  id: string,
): Promise<ProgressEvent[]> => {
  const stored = await kv.get(progressKey(userId, id));
  return stored ? (JSON.parse(stored) as ProgressEvent[]) : [];
};

export const getLLMConfig = async (
  kv: KVNamespace,
  userId: string,
): Promise<LLMConfig | null> => {
  const stored = await kv.get(configKey(userId));
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

const finalOutput = (results: AgentResult[]): string | undefined =>
  results.at(-1)?.output;

export const runPipeline = async (
  kv: KVNamespace,
  task: WritingTask,
  config: LLMConfig,
): Promise<void> => {
  const progressEvents: ProgressEvent[] = [];
  let progressWrite = Promise.resolve();
  const pipeline = new Pipeline(new LLMPipelineExecutor(), (event) => {
    progressEvents.push(event);
    progressWrite = progressWrite.then(() => {
      return kv.put(
        progressKey(task.userId, task.id),
        JSON.stringify(progressEvents),
      );
    });
  });

  try {
    const results = await pipeline.run(
      task.topic,
      task.requirements ?? "",
      config,
    );
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
    const currentTask = (await getTask(kv, task.userId, task.id)) ?? task;
    await failTask(
      kv,
      currentTask,
      caught instanceof Error ? caught.message : String(caught),
    );
  }
};

const failTask = async (
  kv: KVNamespace,
  task: WritingTask,
  errorMessage: string,
): Promise<void> => {
  const failedTask: WritingTask = {
    ...task,
    status: "failed",
    error: errorMessage,
    updatedAt: new Date().toISOString(),
  };

  await putTask(kv, failedTask);
};

const isWritingPipelineMessage = (
  body: unknown,
): body is WritingPipelineMessage => {
  if (!body || typeof body !== "object") {
    return false;
  }

  return (
    isNonEmptyString((body as Partial<WritingPipelineMessage>).taskId) &&
    isNonEmptyString((body as Partial<WritingPipelineMessage>).userId)
  );
};

const processMessage = async (body: unknown, env: Bindings): Promise<void> => {
  const kv = env.AUTO_WRITER_KV;
  if (!kv) {
    console.error("Writing queue cannot run without AUTO_WRITER_KV binding");
    return;
  }

  if (!isWritingPipelineMessage(body)) {
    console.error("Writing queue received an invalid message", body);
    return;
  }

  const task = await getTask(kv, body.userId, body.taskId);
  if (!task) {
    console.error(`Writing queue task not found: ${body.taskId}`);
    return;
  }

  const config = await getLLMConfig(kv, body.userId);
  if (!config) {
    console.error(`Writing queue missing LLM config for task: ${body.taskId}`);
    await failTask(kv, task, "LLM config is not configured");
    return;
  }

  await runPipeline(kv, task, config);
};

export const queue = async (
  batch: MessageBatch<unknown>,
  env: Bindings,
): Promise<void> => {
  for (const message of batch.messages) {
    try {
      await processMessage(message.body, env);
      message.ack();
    } catch (caught) {
      console.error("Writing queue message failed", caught);
      message.retry();
    }
  }
};
