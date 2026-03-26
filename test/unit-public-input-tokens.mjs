/**
 * test/unit-public-input-tokens.mjs
 *
 * 回归测试：
 * 1. 对外暴露的 input_tokens 应基于实际发往 Cursor 的请求
 * 2. /v1/messages/count_tokens 也应使用相同口径
 *
 * 运行方式：
 *   npm run build && node test/unit-public-input-tokens.mjs
 */

import {
    countTokens,
    estimateInputTokens,
    estimatePublicInputTokensFromBody,
} from '../dist/handler.js';

let passed = 0;
let failed = 0;
const pending = [];

function test(name, fn) {
    pending.push(Promise.resolve()
        .then(fn)
        .then(() => {
            console.log(`  ✅  ${name}`);
            passed++;
        })
        .catch((err) => {
            console.error(`  ❌  ${name}`);
            console.error(`      ${err.message}`);
            failed++;
        }));
}

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
        this.body = null;
    }
    json(payload) {
        this.body = payload;
    }
}

const BODY = {
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 256,
    tools: [{
        name: 'Read',
        description: 'Read a file',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string' },
            },
            required: ['path'],
        },
    }],
    messages: [
        {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'toolu_test', name: 'Read', input: { path: 'big.txt' } }],
        },
        {
            role: 'user',
            content: [
                { type: 'tool_result', tool_use_id: 'toolu_test', content: 'A'.repeat(8000) },
                { type: 'text', text: '继续' },
            ],
        },
    ],
};

console.log('\n📦 [usage] public input tokens 回归\n');

test('estimatePublicInputTokensFromBody 使用真实 Cursor 请求口径', async () => {
    const raw = estimateInputTokens(JSON.parse(JSON.stringify(BODY)));
    const publicTokens = await estimatePublicInputTokensFromBody(JSON.parse(JSON.stringify(BODY)));
    assert(publicTokens < raw, `publicTokens 应小于 raw，got public=${publicTokens}, raw=${raw}`);
});

test('/v1/messages/count_tokens 使用真实 Cursor 请求口径', async () => {
    const expected = await estimatePublicInputTokensFromBody(JSON.parse(JSON.stringify(BODY)));
    const req = { body: JSON.parse(JSON.stringify(BODY)) };
    const res = new MockResponse();
    await countTokens(req, res);
    assert(res.body && typeof res.body.input_tokens === 'number', 'countTokens 应返回 input_tokens');
    assertEqual(res.body.input_tokens, expected, 'countTokens 应与 public token estimate 一致');
});

await Promise.all(pending);

console.log('\n' + '═'.repeat(58));
console.log(`  结果: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`);
console.log('═'.repeat(58) + '\n');

if (failed > 0) process.exit(1);
