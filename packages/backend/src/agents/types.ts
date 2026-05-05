/**
 * Agent system types for multi-agent writing pipeline
 */

export interface AgentDefinition {
  name: string;
  role: string;
  systemPrompt: string;
}

export interface AgentContext {
  topic: string;
  requirements?: string;
  previousOutputs: Record<string, string>;
  config: LLMConfig;
}

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AgentResult {
  agentName: string;
  output: string;
  metadata?: Record<string, unknown>;
  duration: number;
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface WritingTask {
  id: string;
  topic: string;
  requirements?: string;
  status: TaskStatus;
  result?: string;
  error?: string;
  agentResults: AgentResult[];
  createdAt: string;
  updatedAt: string;
}

export interface ProgressEvent {
  type: 'agent_start' | 'agent_progress' | 'agent_complete' | 'pipeline_complete' | 'pipeline_error';
  agentName?: string;
  agentIndex?: number;
  totalAgents?: number;
  output?: string;
  error?: string;
  timestamp: string;
}

export type ProgressCallback = (event: ProgressEvent) => void;

export interface PipelineExecutor {
  execute(systemPrompt: string, userMessage: string, config: LLMConfig): Promise<string>;
  executeStream?(systemPrompt: string, userMessage: string, config: LLMConfig, onChunk: (chunk: string) => void): Promise<string>;
}
