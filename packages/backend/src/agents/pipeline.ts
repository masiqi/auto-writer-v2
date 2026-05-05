import type {
  AgentDefinition,
  AgentContext,
  AgentResult,
  ProgressCallback,
  PipelineExecutor,
  LLMConfig,
} from './types';
import { AGENTS } from './definitions';

export class Pipeline {
  private agents: AgentDefinition[];
  private executor: PipelineExecutor;
  private onProgress?: ProgressCallback;

  constructor(executor: PipelineExecutor, onProgress?: ProgressCallback) {
    this.agents = AGENTS;
    this.executor = executor;
    this.onProgress = onProgress;
  }

  async run(topic: string, requirements: string, config: LLMConfig): Promise<AgentResult[]> {
    const results: AgentResult[] = [];
    const previousOutputs: Record<string, string> = {};
    const totalAgents = this.agents.length;

    for (let i = 0; i < this.agents.length; i++) {
      const agent = this.agents[i];

      this.emit({
        type: 'agent_start',
        agentName: agent.name,
        agentIndex: i,
        totalAgents,
        timestamp: new Date().toISOString(),
      });

      const context: AgentContext = {
        topic,
        requirements,
        previousOutputs: { ...previousOutputs },
        config,
      };

      const userMessage = this.buildUserMessage(agent, context);
      const start = Date.now();

      try {
        const output = await this.executor.execute(
          agent.systemPrompt,
          userMessage,
          config
        );
        const duration = Date.now() - start;

        const result: AgentResult = {
          agentName: agent.name,
          output,
          duration,
        };

        results.push(result);
        previousOutputs[agent.name] = output;

        this.emit({
          type: 'agent_complete',
          agentName: agent.name,
          agentIndex: i,
          totalAgents,
          output,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        const duration = Date.now() - start;
        const errorMessage = error instanceof Error ? error.message : String(error);

        results.push({
          agentName: agent.name,
          output: '',
          metadata: { error: errorMessage },
          duration,
        });

        this.emit({
          type: 'pipeline_error',
          agentName: agent.name,
          agentIndex: i,
          totalAgents,
          error: errorMessage,
          timestamp: new Date().toISOString(),
        });

        throw error;
      }
    }

    this.emit({
      type: 'pipeline_complete',
      totalAgents,
      timestamp: new Date().toISOString(),
    });

    return results;
  }

  private buildUserMessage(agent: AgentDefinition, context: AgentContext): string {
    const parts: string[] = [];

    parts.push(`题目：${context.topic}`);

    if (context.requirements) {
      parts.push(`要求：${context.requirements}`);
    }

    // Include relevant previous outputs
    const prevKeys = Object.keys(context.previousOutputs);
    if (prevKeys.length > 0) {
      parts.push('\n--- 前序 Agent 输出 ---');
      for (const key of prevKeys) {
        const prevAgent = this.agents.find((a) => a.name === key);
        if (prevAgent) {
          parts.push(`[${prevAgent.role}]: ${context.previousOutputs[key]}`);
        }
      }
    }

    return parts.join('\n');
  }

  private emit(event: Parameters<ProgressCallback>[0]): void {
    if (this.onProgress) {
      this.onProgress(event);
    }
  }

  getAgentNames(): string[] {
    return this.agents.map((a) => a.name);
  }
}
