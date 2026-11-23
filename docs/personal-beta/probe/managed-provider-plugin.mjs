// Probe-only managed provider bridge. This uses the public dsh-llm adapter
// registration contract so it can coexist with the built-in llm-pi-ai row and
// the user's own provider profiles instead of replacing llm-pi-ai configuration.
export const name = 'gate-managed-provider'
export const inject = ['llm']

export function apply(ctx, config) {
  const baseURL = config?.baseURL ?? 'http://127.0.0.1:18182/v1'
  const models = config?.models ?? [
    { id: 'sanyun-buddy-chat', name: '模型 A · ×1.5', contextWindow: 128000 },
  ]
  ctx.llm.registerAdapter(['sanyun-buddy'], new ManagedAdapter(baseURL, models))
}

class ManagedAdapter {
  #baseURL
  #models

  constructor(baseURL, models) {
    this.#baseURL = String(baseURL).replace(/\/$/u, '')
    this.#models = models
  }

  providerInfo(provider) {
    return { id: provider, name: '三云 Buddy' }
  }

  providerRetryPolicy() {}

  async listModels(provider) {
    return this.#models.map(model => ({ provider, ...model }))
  }

  async prepareCall(provider, model, signal) {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: options => this.stream(options),
    }
  }

  async resolveModel(provider, model) {
    const known = this.#models.find(item => item.id === model)
    return {
      provider,
      id: model,
      name: known?.name ?? model,
      context: known?.contextWindow === undefined ? undefined : { contextWindow: known.contextWindow },
      defaultMaxTokens: known?.defaultMaxTokens,
    }
  }

  async *stream(options) {
    const response = await fetch(`${this.#baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer gate-managed-placeholder',
        'x-workdsh-probe': 'managed',
      },
      body: JSON.stringify({
        model: options.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: toWireMessages(options),
      }),
      signal: options.signal,
    })
    if (!response.ok) throw new Error(`managed mock returned HTTP ${response.status}`)

    let index = 0
    let text = ''
    let usage
    let started = false
    const decoder = new TextDecoder()
    let buffer = ''

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        for (const line of event.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') continue
          let parsed
          try { parsed = JSON.parse(data) } catch { continue }
          const delta = parsed.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
            if (!started) {
              started = true
              yield { type: 'block-start', index, blockType: 'text' }
            }
            text += delta
            yield { type: 'text-delta', index, text: delta }
          }
          if (parsed.usage) {
            usage = {
              inputTokens: parsed.usage.prompt_tokens ?? 0,
              outputTokens: parsed.usage.completion_tokens ?? 0,
              totalTokens: parsed.usage.total_tokens,
            }
          }
        }
      }
    }

    if (!started) {
      started = true
      yield { type: 'block-start', index, blockType: 'text' }
    }
    yield { type: 'block-end', index, block: { type: 'text', text } }
    yield { type: 'usage', usage: usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function toWireMessages(options) {
  const messages = []
  if (typeof options.system === 'string' && options.system.length > 0) {
    messages.push({ role: 'system', content: options.system })
  }
  for (const message of options.messages ?? []) {
    const role = message.role === 'developer' ? 'system' : message.role
    if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') continue
    messages.push({ role, content: textOf(message.content) })
  }
  return messages
}

function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(block => block?.text ?? '').join('')
}
