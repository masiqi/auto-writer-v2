import { describe, it, expect, vi } from 'vitest';
import { Pipeline } from '../../src/agents/pipeline';
import { AGENTS } from '../../src/agents/definitions';
import type { PipelineExecutor, LLMConfig, ProgressEvent } from '../../src/agents/types';

function createMockExecutor(responses?: Record<string, string>): PipelineExecutor {
  return {
    async execute(systemPrompt: string, userMessage: string): Promise<string> {
      // Return a response based on which agent is running
      for (const agent of AGENTS) {
        if (systemPrompt.includes(agent.role)) {
          return responses?.[agent.name] ?? `Mock output from ${agent.name}`;
        }
      }
      return 'Mock output';
    },
  };
}

const mockConfig: LLMConfig = {
  baseUrl: 'http://localhost:3001/v1',
  apiKey: 'test-key',
  model: 'test-model',
};

describe('Agent Definitions', () => {
  it('should have 11 agents defined', () => {
    expect(AGENTS).toHaveLength(11);
  });

  it('each agent should have name, role, and systemPrompt', () => {
    for (const agent of AGENTS) {
      expect(agent.name).toBeTruthy();
      expect(agent.role).toBeTruthy();
      expect(agent.systemPrompt).toBeTruthy();
      expect(agent.systemPrompt.length).toBeGreaterThan(50);
    }
  });

  it('agents should be in correct order', () => {
    const expectedNames = [
      'analyze-topic',
      'determine-theme',
      'select-materials',
      'outline',
      'write-intro',
      'write-body',
      'write-conclusion',
      'polish',
      'review',
      'revise',
      'final-review',
    ];
    expect(AGENTS.map((a) => a.name)).toEqual(expectedNames);
  });
});

describe('Pipeline', () => {
  it('should run all agents sequentially', async () => {
    const executor = createMockExecutor();
    const pipeline = new Pipeline(executor);
    const results = await pipeline.run('以"坚持"为题写一篇议论文', '800字', mockConfig);

    expect(results).toHaveLength(11);
    for (let i = 0; i < 11; i++) {
      expect(results[i].agentName).toBe(AGENTS[i].name);
      expect(results[i].output).toBeTruthy();
      expect(results[i].duration).toBeGreaterThanOrEqual(0);
    }
  });

  it('should emit progress events', async () => {
    const executor = createMockExecutor();
    const events: ProgressEvent[] = [];
    const pipeline = new Pipeline(executor, (event) => events.push(event));

    await pipeline.run('测试题目', '', mockConfig);

    // Should have: 11 agent_start + 11 agent_complete + 1 pipeline_complete = 23
    expect(events.filter((e) => e.type === 'agent_start')).toHaveLength(11);
    expect(events.filter((e) => e.type === 'agent_complete')).toHaveLength(11);
    expect(events.filter((e) => e.type === 'pipeline_complete')).toHaveLength(1);
  });

  it('should pass previous outputs to subsequent agents', async () => {
    const calls: Array<{ system: string; user: string }> = [];
    const executor: PipelineExecutor = {
      async execute(systemPrompt: string, userMessage: string): Promise<string> {
        calls.push({ system: systemPrompt, user: userMessage });
        return 'test output';
      },
    };

    const pipeline = new Pipeline(executor);
    await pipeline.run('测试题目', '800字议论文', mockConfig);

    // First agent should not have previous outputs
    expect(calls[0].user).not.toContain('前序 Agent 输出');

    // Third agent should have previous outputs from first two
    expect(calls[2].user).toContain('前序 Agent 输出');
    expect(calls[2].user).toContain('topic-analyzer');
    expect(calls[2].user).toContain('theme-determiner');
  });

  it('should resume from a specific agent index with existing outputs and user modifications', async () => {
    const calls: Array<{ system: string; user: string }> = [];
    const existingResults = AGENTS.slice(0, 3).map((agent) => ({
      agentName: agent.name,
      output: `Existing output from ${agent.name}`,
      duration: 1,
    }));
    const executor: PipelineExecutor = {
      async execute(systemPrompt: string, userMessage: string): Promise<string> {
        calls.push({ system: systemPrompt, user: userMessage });
        return `resumed output ${calls.length}`;
      },
    };

    const pipeline = new Pipeline(executor);
    const results = await pipeline.run('测试题目', '800字议论文', mockConfig, {
      existingResults,
      resumeFromIndex: 3,
      userModifications: {
        'select-materials': '请改用袁隆平和航天素材。',
      },
    });

    expect(results).toHaveLength(AGENTS.length);
    expect(results.slice(0, 3)).toEqual(existingResults);
    expect(calls).toHaveLength(AGENTS.length - 3);
    expect(calls[0].system).toBe(AGENTS[3].systemPrompt);
    expect(calls[0].user).toContain('Existing output from analyze-topic');
    expect(calls[0].user).toContain('Existing output from select-materials');
    expect(calls[0].user).toContain('用户修改意见');
    expect(calls[0].user).toContain('[material-selector]: 请改用袁隆平和航天素材。');
  });

  it('should include topic and requirements in user message', async () => {
    const calls: Array<{ user: string }> = [];
    const executor: PipelineExecutor = {
      async execute(_s: string, userMessage: string): Promise<string> {
        calls.push({ user: userMessage });
        return 'test output';
      },
    };

    const pipeline = new Pipeline(executor);
    await pipeline.run('以"坚持"为题', '800字议论文', mockConfig);

    expect(calls[0].user).toContain('以"坚持"为题');
    expect(calls[0].user).toContain('800字议论文');
  });

  it('should handle executor errors', async () => {
    const executor: PipelineExecutor = {
      async execute(): Promise<string> {
        throw new Error('LLM API error');
      },
    };

    const events: ProgressEvent[] = [];
    const pipeline = new Pipeline(executor, (event) => events.push(event));

    await expect(pipeline.run('test', '', mockConfig)).rejects.toThrow('LLM API error');

    // Should have agent_start + pipeline_error
    expect(events.some((e) => e.type === 'agent_start')).toBe(true);
    expect(events.some((e) => e.type === 'pipeline_error')).toBe(true);
  });

  it('should report correct agent index in progress events', async () => {
    const executor = createMockExecutor();
    const startEvents: ProgressEvent[] = [];
    const pipeline = new Pipeline(executor, (event) => {
      if (event.type === 'agent_start') startEvents.push(event);
    });

    await pipeline.run('test', '', mockConfig);

    for (let i = 0; i < startEvents.length; i++) {
      expect(startEvents[i].agentIndex).toBe(i);
      expect(startEvents[i].totalAgents).toBe(11);
    }
  });

  it('getAgentNames should return all agent names', () => {
    const pipeline = new Pipeline(createMockExecutor());
    const names = pipeline.getAgentNames();
    expect(names).toHaveLength(11);
    expect(names[0]).toBe('analyze-topic');
    expect(names[names.length - 1]).toBe('final-review');
  });
});
