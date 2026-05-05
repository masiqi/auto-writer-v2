/**
 * Auto Writer V2 — Skill SDK
 *
 * Lightweight client for other agents to call the writing service.
 * Zero external dependencies — only uses fetch.
 */

export interface WritingTask {
  id: string;
  topic: string;
  requirements?: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
  agentResults: Array<{
    agentName: string;
    output: string;
    duration: number;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface ProgressEvent {
  type:
    | "agent_start"
    | "agent_progress"
    | "agent_complete"
    | "pipeline_complete"
    | "pipeline_error";
  agentName?: string;
  agentIndex?: number;
  totalAgents?: number;
  output?: string;
  error?: string;
  timestamp: string;
}

export interface WriteOptions {
  /** Optional title */
  title?: string;
  /** Grade level */
  grade?: string;
  /** Additional requirements */
  requirements?: string;
  /** Progress callback for SSE events */
  onProgress?: (event: ProgressEvent) => void;
}

export class AutoWriterClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /**
   * Submit a writing task and wait for completion.
   * Returns the final WritingTask with the essay result.
   */
  async writeEssay(
    topic: string,
    options?: WriteOptions
  ): Promise<WritingTask> {
    // Create task
    const createRes = await fetch(`${this.baseUrl}/api/writing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: topic,
        title: options?.title,
        grade: options?.grade,
        requirements: options?.requirements,
      }),
    });

    if (!createRes.ok) {
      throw new Error(`Failed to create writing task: ${createRes.status}`);
    }

    const { task } = (await createRes.json()) as { task: WritingTask };

    // If progress callback, stream SSE
    if (options?.onProgress) {
      await this.streamTask(task.id, options.onProgress);
    }

    // Poll until complete
    return this.waitForCompletion(task.id);
  }

  /**
   * Get task status by ID.
   */
  async getTaskStatus(taskId: string): Promise<WritingTask> {
    const res = await fetch(`${this.baseUrl}/api/writing/${taskId}`);
    if (!res.ok) {
      throw new Error(`Task not found: ${res.status}`);
    }
    const { task } = (await res.json()) as { task: WritingTask };
    return task;
  }

  /**
   * Stream task progress via SSE.
   * Returns a promise that resolves when the stream ends.
   */
  async streamTask(
    taskId: string,
    callback: (event: ProgressEvent) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const source = new EventSource(
        `${this.baseUrl}/api/writing/${taskId}/stream`
      );

      source.addEventListener("task", (msg) => {
        const task = JSON.parse(msg.data) as WritingTask;
        if (task.status === "completed" || task.status === "failed") {
          source.close();
          resolve();
        }
      });

      source.addEventListener("progress", (msg) => {
        callback(JSON.parse(msg.data) as ProgressEvent);
      });

      source.onerror = () => {
        source.close();
        resolve();
      };

      // Timeout after 10 minutes
      setTimeout(() => {
        source.close();
        reject(new Error("Stream timeout after 10 minutes"));
      }, 600000);
    });
  }

  /**
   * Wait for a task to complete, polling every 2 seconds.
   */
  private async waitForCompletion(taskId: string): Promise<WritingTask> {
    const maxAttempts = 300; // 10 minutes
    for (let i = 0; i < maxAttempts; i++) {
      const task = await this.getTaskStatus(taskId);
      if (task.status === "completed" || task.status === "failed") {
        return task;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("Task timed out after 10 minutes");
  }
}

// Convenience function for quick usage
export async function writeEssay(
  baseUrl: string,
  topic: string,
  options?: Omit<WriteOptions, "onProgress">
): Promise<string> {
  const client = new AutoWriterClient(baseUrl);
  const task = await client.writeEssay(topic, options);
  if (task.status === "failed") {
    throw new Error(task.error ?? "Writing task failed");
  }
  return task.result ?? task.agentResults.at(-1)?.output ?? "";
}
