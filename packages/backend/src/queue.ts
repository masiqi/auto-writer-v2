import { LLMPipelineExecutor, Pipeline } from "./agents";
import { AGENTS } from "./agents/definitions";
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
  resumeFromIndex?: number;
  userModifications?: Record<string, string>;
};

export type WritingTaskSummary = Pick<
  WritingTask,
  "id" | "topic" | "requirements" | "status" | "createdAt" | "updatedAt"
> & {
  result?: string;
  error?: string;
};

export type RunPipelineOptions = {
  resumeFromIndex?: number;
  userModifications?: Record<string, string>;
};

export const configKey = (userId: string) => `user:${userId}:config:llm`;
export const taskOwnerKey = (id: string) => `writing:${id}:owner`;
export const taskKey = (userId: string, id: string) =>
  `user:${userId}:writing:${id}`;
export const progressKey = (userId: string, id: string) =>
  `user:${userId}:writing:${id}:progress`;
export const taskIndexKey = (userId: string) => `user:${userId}:tasks`;

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

const taskSummary = (task: WritingTask): WritingTaskSummary => {
  const summary: WritingTaskSummary = {
    id: task.id,
    topic: task.topic,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };

  if (task.requirements) {
    summary.requirements = task.requirements;
  }
  if (task.result) {
    summary.result = task.result;
  }
  if (task.error) {
    summary.error = task.error;
  }

  return summary;
};

export const getTaskIndex = async (
  kv: KVNamespace,
  userId: string,
): Promise<WritingTaskSummary[]> => {
  const stored = await kv.get(taskIndexKey(userId));
  const summaries = stored
    ? (JSON.parse(stored) as WritingTask[]).map(taskSummary)
    : [];

  return [...summaries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const putTaskIndexEntry = async (
  kv: KVNamespace,
  task: WritingTask,
): Promise<void> => {
  const summaries = await getTaskIndex(kv, task.userId);
  const nextSummary = taskSummary(task);
  const nextSummaries = [
    nextSummary,
    ...summaries.filter((summary) => summary.id !== task.id),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  await kv.put(taskIndexKey(task.userId), JSON.stringify(nextSummaries));
};

export const removeTaskIndexEntry = async (
  kv: KVNamespace,
  userId: string,
  id: string,
): Promise<void> => {
  const summaries = await getTaskIndex(kv, userId);
  const nextSummaries = summaries.filter((summary) => summary.id !== id);
  await kv.put(taskIndexKey(userId), JSON.stringify(nextSummaries));
};

export const putTask = async (
  kv: KVNamespace,
  task: WritingTask,
): Promise<void> => {
  await Promise.all([
    kv.put(taskOwnerKey(task.id), task.userId),
    kv.put(taskKey(task.userId, task.id), JSON.stringify(task)),
    putTaskIndexEntry(kv, task),
  ]);
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

const pauseReasons: Record<number, string> = {
  2: "review_materials",
  3: "review_outline",
  8: "review_draft",
};

const pausePoints = Object.keys(pauseReasons).map(Number);

const nextPausePoint = (fromIndex: number): number | undefined =>
  pausePoints.find((pausePoint) => pausePoint >= fromIndex);

export const runPipeline = async (
  kv: KVNamespace,
  task: WritingTask,
  config: LLMConfig,
  options: RunPipelineOptions = {},
): Promise<void> => {
  const resumeFromIndex = options.resumeFromIndex ?? 0;
  const userModifications =
    options.userModifications ?? task.userModifications ?? {};
  const progressEvents: ProgressEvent[] = await getProgressEvents(
    kv,
    task.userId,
    task.id,
  );
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
    const stopAfterIndex = task.interactive
      ? nextPausePoint(resumeFromIndex)
      : undefined;
    const results = await pipeline.run(
      task.topic,
      task.requirements ?? "",
      config,
      {
        existingResults: task.agentResults,
        resumeFromIndex,
        stopAfterIndex,
        userModifications,
      },
    );

    if (
      task.interactive &&
      stopAfterIndex !== undefined &&
      results.length - 1 === stopAfterIndex
    ) {
      const pauseAgent = AGENTS[stopAfterIndex];
      const pauseEvent: ProgressEvent = {
        type: "pipeline_paused",
        agentName: pauseAgent.name,
        agentIndex: stopAfterIndex,
        totalAgents: AGENTS.length,
        output: results.at(-1)?.output,
        timestamp: new Date().toISOString(),
      };
      progressEvents.push(pauseEvent);
      progressWrite = progressWrite.then(() =>
        kv.put(
          progressKey(task.userId, task.id),
          JSON.stringify(progressEvents),
        ),
      );
      await progressWrite;

      const pausedTask: WritingTask = {
        ...task,
        status: "paused",
        agentResults: results,
        pausedAtAgent: stopAfterIndex,
        pauseReason: pauseReasons[stopAfterIndex],
        userModifications,
        updatedAt: new Date().toISOString(),
      };

      await putTask(kv, pausedTask);
      return;
    }

    await progressWrite;
    const completedTask: WritingTask = {
      ...task,
      status: "completed",
      result: finalOutput(results),
      agentResults: results,
      pausedAtAgent: null,
      pauseReason: undefined,
      userModifications,
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

  const message = body as Partial<WritingPipelineMessage>;

  if (
    !isNonEmptyString(message.taskId) ||
    !isNonEmptyString(message.userId)
  ) {
    return false;
  }

  if (
    message.resumeFromIndex !== undefined &&
    (!Number.isInteger(message.resumeFromIndex) ||
      message.resumeFromIndex < 0 ||
      message.resumeFromIndex >= AGENTS.length)
  ) {
    return false;
  }

  if (
    message.userModifications !== undefined &&
    (typeof message.userModifications !== "object" ||
      message.userModifications === null)
  ) {
    return false;
  }

  return true;
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

  await runPipeline(kv, task, config, {
    resumeFromIndex: body.resumeFromIndex,
    userModifications: body.userModifications,
  });
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
