// Two OpenAI-compatible mock endpoints used by the managed-provider coexistence gate.
// Each endpoint writes every request it receives to its own JSONL file, so the gate
// can show that the user-configured route and the managed route reach different baseURLs.
import { createServer } from 'node:http'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const logDir = resolve(process.argv[2] ?? 'logs')
const userPort = Number(process.argv[3] ?? 18181)
const managedPort = Number(process.argv[4] ?? 18182)
mkdirSync(logDir, { recursive: true })

const endpoints = [
  { port: userPort, tag: 'user-self', text: '来自用户自建提供方（mock 18181）' },
  { port: managedPort, tag: 'sanyun-buddy', text: '来自三云 Buddy 托管提供方（mock 18182）' },
]

for (const endpoint of endpoints) start(endpoint)

function start({ port, tag, text }) {
  const logFile = join(logDir, `${tag}-requests.jsonl`)
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    let body
    try { body = raw ? JSON.parse(raw) : undefined } catch { body = raw }
    appendFileSync(logFile, JSON.stringify({
      at: new Date().toISOString(),
      tag,
      port,
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization ?? null,
      body,
    }) + '\n')

    if (request.method === 'GET' && /\/models$/u.test(request.url ?? '')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        object: 'list',
        data: [{ id: tag === 'user-self' ? 'user-model' : 'sanyun-buddy-chat', object: 'model', created: 0, owned_by: tag }],
      }))
      return
    }

    if (request.method === 'POST' && /\/chat\/completions$/u.test(request.url ?? '')) {
      const model = body?.model ?? 'unknown'
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const chunk = (delta, finish = null) => ({
        id: 'chatcmpl-gate',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })
      response.write(`data: ${JSON.stringify(chunk({ role: 'assistant', content: '' }))}\n\n`)
      response.write(`data: ${JSON.stringify(chunk({ content: text }))}\n\n`)
      response.write(`data: ${JSON.stringify({
        ...chunk({}, 'stop'),
        usage: { prompt_tokens: 21, completion_tokens: 12, total_tokens: 33 },
      })}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }

    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
  })
  server.listen(port, '127.0.0.1', () => console.log(`mock ${tag} listening on http://127.0.0.1:${port}`))
}
