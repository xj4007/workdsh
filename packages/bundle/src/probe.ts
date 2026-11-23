import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-attachment';
import type {} from '@deepseek-ai/dsh-system-prompt';
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-llm';
import { registerBrowserView } from './browser-view.js';

/** Product diagnostics only. Feature packages are installed as separate Profile layers. */
export const name = 'workdsh-installation-probe';
export const inject = ['connection', 'tools', 'agents', 'attachments', 'systemPrompt'];

type ManagedModel = { id: string, name: string, contextWindow?: number };

function configuredModels(): ManagedModel[] | undefined {
  const raw = process.env.WORKDSH_MANAGED_PROVIDER_MODELS;
  const url = process.env.WORKDSH_MANAGED_PROVIDER_URL;
  const key = process.env.WORKDSH_MANAGED_PROVIDER_KEY;
  if (!raw || !url || !key) return undefined;
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return undefined;
  const models = parsed.filter((row): row is ManagedModel => !!row && typeof row === 'object'
    && typeof (row as ManagedModel).id === 'string' && typeof (row as ManagedModel).name === 'string')
  return models.length > 0 ? models : undefined;
}

function textOf(content: readonly { type: string, text?: string }[]): string {
  return content.map(block => block.type === 'text' ? block.text ?? ''
    : block.type === 'image' ? '[图片]'
      : block.type === 'file' ? '[文件]' : '').join('');
}

function openAiMessages(messages: GenerateOptions['messages']): Array<Record<string, unknown>> {
  return messages.flatMap((message): Array<Record<string, unknown>> => {
    if (message.role === 'system') return [{ role: 'system', content: textOf(message.content) }];
    if (message.role === 'user') return [{ role: 'user', content: textOf(message.content) }];
    if (message.role === 'developer') return [];
    if (message.role === 'tool') return [{ role: 'tool', tool_call_id: message.toolCallId, content: textOf(message.content) }];
    const toolCalls = message.content.filter((block): block is Extract<typeof block, { type: 'tool-call' }> => block.type === 'tool-call')
    return [{
      role: 'assistant',
      content: textOf(message.content.filter(block => block.type !== 'tool-call')),
      ...(toolCalls.length === 0 ? {} : {
        tool_calls: toolCalls.map(call => ({
          id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments },
        })),
      }),
    }];
  });
}

class ManagedAdapter extends LlmAdapter {
  private readonly models: readonly ManagedModel[];

  constructor(private readonly baseURL: string, private readonly key: string, models: readonly ManagedModel[]) {
    super();
    this.models = models;
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: '三云 Buddy' };
  }

  override providerRetryPolicy(): undefined { return undefined; }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return this.models.map(model => ({ provider, id: model.id, name: model.name }));
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const known = this.models.find(row => row.id === model);
    return {
      provider, id: model, name: known?.name ?? model,
      ...(known?.contextWindow === undefined ? {} : { context: { contextWindow: known.contextWindow } }),
    };
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    return { model: await this.resolveModel(provider, model), stream: options => this.stream(options) };
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: openAiMessages(options.messages),
      stream: true,
      ...(options.system === undefined ? {} : { system: options.system }),
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
      ...(options.stop === undefined ? {} : { stop: options.stop }),
      ...(options.tools === undefined || options.tools.length === 0 ? {} : {
        tools: options.tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
      }),
    };
    const response = await fetch(`${this.baseURL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`三云 Buddy 模型请求失败（${response.status}）：${detail}`);
    }
    if (!response.body) throw new Error('三云 Buddy 模型响应没有正文');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let textStarted = false;
    let finishReason = 'stop';
    let usage: { prompt_tokens?: number, completion_tokens?: number, total_tokens?: number } | undefined;
    const toolBlocks = new Map<number, { id: ToolCallId, name: string, arguments: string }>();
    const toolIndexes = new Map<number, number>();
    const handle = function* (event: Record<string, unknown>): Generator<StreamChunk> {
      if (event.usage && typeof event.usage === 'object') usage = event.usage as typeof usage;
      const choices = event.choices;
      if (!Array.isArray(choices) || choices.length === 0) return;
      const choice = choices[0] as { delta?: Record<string, unknown>, finish_reason?: unknown };
      const delta = choice.delta ?? {};
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        if (!textStarted) { textStarted = true; yield { type: 'block-start', index: 0, blockType: 'text' }; }
        text += delta.content;
        yield { type: 'text-delta', index: 0, text: delta.content };
      }
      const calls = delta.tool_calls;
      if (Array.isArray(calls)) {
        for (const raw of calls) {
          const call = raw as { index?: number, id?: string, function?: { name?: string, arguments?: string } };
          if (typeof call.index !== 'number') continue;
          let block = toolBlocks.get(call.index);
          if (!block) {
            block = { id: ToolCallId(call.id ?? `call_${call.index}`), name: call.function?.name ?? '', arguments: '' };
            toolBlocks.set(call.index, block);
            const index = 1 + toolIndexes.size;
            toolIndexes.set(call.index, index);
            yield { type: 'block-start', index, blockType: 'tool-call' };
            yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: '' };
          }
          if (call.function?.name && !block.name) block.name = call.function.name;
          if (typeof call.function?.arguments === 'string' && call.function.arguments.length > 0) {
            block.arguments += call.function.arguments;
            yield { type: 'tool-call-delta', index: toolIndexes.get(call.index)!, id: block.id, name: block.name, argumentsDelta: call.function.arguments };
          }
        }
      }
      if (typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0) finishReason = choice.finish_reason;
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data === '[DONE]') { newline = -1; buffer = ''; break; }
            if (data.length > 0) {
              try { yield* handle(JSON.parse(data) as Record<string, unknown>); }
              catch { /* one malformed SSE event is ignored; the terminal finish still reports the outcome */ }
            }
          }
          newline = buffer.indexOf('\n');
        }
      }
      if (textStarted) yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      for (const [toolIndex, block] of toolBlocks) {
        yield { type: 'block-end', index: toolIndexes.get(toolIndex)!, block: { type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments } };
      }
      if (usage) {
        yield { type: 'usage', usage: {
          inputTokens: usage.prompt_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0,
          ...(usage.total_tokens === undefined ? {} : { totalTokens: usage.total_tokens }),
        } };
      }
      yield { type: 'finish', reason: finishReason === 'tool_calls' ? { kind: 'tool-calls' } : finishReason === 'length' ? { kind: 'max-tokens' } : { kind: 'stop' } };
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
}

export function apply(ctx: Context): void {
  registerBrowserView(ctx);
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'workdsh:browser-in-sidebar',
    order: ctx.systemPrompt.getSectionOrder('TOOL_REPORT'),
    text: 'For website browsing and page interaction in 三云Buddy, use the available Playwright MCP browser tools. They keep the live Agent Session page visible and operable in the right sidebar. Use native computer control for other desktop apps, or when the user explicitly asks to operate an existing external browser. Do not launch a separate visible system browser for an ordinary website task.',
  }), 'workdsh.browser-view.prompt');
  const models = configuredModels();
  const url = process.env.WORKDSH_MANAGED_PROVIDER_URL;
  const key = process.env.WORKDSH_MANAGED_PROVIDER_KEY;
  if (models && url && key) {
    ctx.inject(['llm'], scope => {
      scope.llm.registerAdapter(['sanyun-buddy'], new ManagedAdapter(url, key, models));
    });
  }
  ctx.effect(() => {
    process.stdout.write('[workdsh:probe] activated\n');
    return () => process.stdout.write('[workdsh:probe] disposed\n');
  });
}
