/**
 * test/unit-input-token-limit.mjs
 *
 * 回归测试：对外统计的 input token 超过上限时应封顶，但不能拒绝请求。
 *
 * 运行方式：
 *   npm run build && node test/unit-input-token-limit.mjs
 */

import { handleMessages, estimatePublicInputTokensFromBody } from '../dist/handler.js';
import { handleOpenAIChatCompletions, handleOpenAIResponses } from '../dist/openai-handler.js';
import { getConfig } from '../dist/config.js';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
    const as = JSON.stringify(a);
    const bs = JSON.stringify(b);
    if (as !== bs) throw new Error(msg || `Expected ${bs}, got ${as}`);
}

class MockResponse {
    constructor() {
        this.statusCode = 200;
        this.headers = {};
        this.body = '';
        this.ended = false;
    }

    status(code) {
        this.statusCode = code;
        return this;
    }

    setHeader(name, value) {
        this.headers[name] = value;
    }

    writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = { ...this.headers, ...headers };
    }

    write(chunk) {
        this.body += String(chunk);
        return true;
    }

    json(payload) {
        this.body = JSON.stringify(payload);
        this.ended = true;
    }

    end(chunk = '') {
        this.body += String(chunk);
        this.ended = true;
    }
}

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✅  ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ❌  ${name}`);
        console.error(`      ${err.message}`);
        failed++;
    }
}

function makeLargeText() {
    return Array.from({ length: 300 }, (_, i) => `token_${i}_value`).join(' ');
}

function createCursorSseResponse(deltas) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            for (const delta of deltas) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text-delta', delta })}\n\n`));
            }
            controller.close();
        },
    });

    return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}

async function withTokenLimit(limit, fn) {
    const cfg = getConfig();
    const oldLimit = cfg.maxInputTokens;
    try {
        cfg.maxInputTokens = limit;
        return await fn();
    } finally {
        cfg.maxInputTokens = oldLimit;
    }
}

async function getUncappedTokens(body) {
    return withTokenLimit(-1, () => estimatePublicInputTokensFromBody(JSON.parse(JSON.stringify(body))));
}

console.log('\n📦 [limit] 输入 token 统计封顶回归\n');

await test('Anthropic /v1/messages 超限时仍正常回答，但 usage.input_tokens 封顶', async () => {
    await withTokenLimit(50, async () => {
        const originalFetch = global.fetch;
        const body = {
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 256,
            stream: false,
            messages: [{ role: 'user', content: makeLargeText() }],
        };

        const uncapped = await getUncappedTokens(body);
        assert(uncapped > 50, `测试请求应超过上限，实际=${uncapped}`);
        global.fetch = async () => createCursorSseResponse(['ok']);

        const req = { method: 'POST', path: '/v1/messages', body };
        const res = new MockResponse();
        try {
            await handleMessages(req, res);
        } finally {
            global.fetch = originalFetch;
        }

        const payload = JSON.parse(res.body);
        assertEqual(res.statusCode, 200, '应继续正常回答');
        assertEqual(payload.usage.input_tokens, 50, 'usage.input_tokens 应封顶为 50');
    });
});

await test('OpenAI /v1/chat/completions 超限时仍正常回答，但 prompt_tokens 封顶', async () => {
    await withTokenLimit(50, async () => {
        const originalFetch = global.fetch;
        const body = {
            model: 'gpt-4.1',
            stream: false,
            messages: [{ role: 'user', content: makeLargeText() }],
        };
        const uncapped = await getUncappedTokens({
            model: body.model,
            max_tokens: 8192,
            messages: [{ role: 'user', content: makeLargeText() }],
        });
        assert(uncapped > 50, `测试请求应超过上限，实际=${uncapped}`);
        global.fetch = async () => createCursorSseResponse(['ok']);

        const req = { method: 'POST', path: '/v1/chat/completions', body };
        const res = new MockResponse();
        try {
            await handleOpenAIChatCompletions(req, res);
        } finally {
            global.fetch = originalFetch;
        }

        const payload = JSON.parse(res.body);
        assertEqual(res.statusCode, 200, '应继续正常回答');
        assertEqual(payload.usage.prompt_tokens, 50, 'prompt_tokens 应封顶为 50');
    });
});

await test('OpenAI /v1/responses 超限时仍正常回答，但 usage.input_tokens 封顶', async () => {
    await withTokenLimit(50, async () => {
        const originalFetch = global.fetch;
        const body = {
            model: 'gpt-5',
            stream: false,
            input: makeLargeText(),
        };
        const uncapped = await getUncappedTokens({
            model: body.model,
            max_tokens: 8192,
            messages: [{ role: 'user', content: makeLargeText() }],
        });
        assert(uncapped > 50, `测试请求应超过上限，实际=${uncapped}`);
        global.fetch = async () => createCursorSseResponse(['ok']);

        const req = { method: 'POST', path: '/v1/responses', body };
        const res = new MockResponse();
        try {
            await handleOpenAIResponses(req, res);
        } finally {
            global.fetch = originalFetch;
        }

        const payload = JSON.parse(res.body);
        assertEqual(res.statusCode, 200, '应继续正常回答');
        assertEqual(payload.usage.input_tokens, 50, 'Responses usage.input_tokens 应封顶为 50');
    });
});

console.log('\n' + '═'.repeat(58));
console.log(`  结果: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`);
console.log('═'.repeat(58) + '\n');

if (failed > 0) process.exit(1);
