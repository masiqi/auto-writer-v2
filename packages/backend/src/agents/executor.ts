import { LLMClient } from "../llm/client";
import type { LLMConfig, PipelineExecutor } from "./types";

export class LLMPipelineExecutor implements PipelineExecutor {
  async execute(
    systemPrompt: string,
    userMessage: string,
    config: LLMConfig,
  ): Promise<string> {
    const client = new LLMClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });

    return client.chat(systemPrompt, userMessage, {
      model: config.model,
    });
  }
}
