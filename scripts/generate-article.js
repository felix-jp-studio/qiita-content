const https = require('https');
const fs = require('fs');
const path = require('path');

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const THEMES = {
  Monday: 'Next.jsとClaude APIで作れる便利ツール3選',
  Tuesday: 'GitHubにpushするだけで自動デプロイを実現する方法',
  Wednesday: '初心者がつまずくTypeScriptのエラー5選と解決策',
  Thursday: 'Firebase×Next.jsで認証機能を30分で実装する手順',
  Friday: 'AWS初心者がまず覚えるべきサービス5選',
  Saturday: '個人開発者がVercelを無料で使い倒す方法',
  Sunday: '今週のまとめ：AIツール開発で学んだこと',
};

const day = DAYS[new Date().getDay()];
const theme = THEMES[day];

const prompt = `あなたはエンジニア向け技術メディアのライターです。
以下のテーマでQiita用の技術記事を書いてください。

【条件】
- 対象読者：プログラミング初心者
- 文字数：800〜1200字
- マークダウン記法を使う
- コードブロックを1つ以上含める
- 末尾に以下を含める：詳しい手順はこちら → https://felixstudio0.gumroad.com

テーマ：${theme}

出力はfrontmatterから始めて記事本文のみを出力してください。
前置き・説明文は不要です。

出力形式：
---
title: "（タイトルをここに）"
tags:
  - Next.js
  - TypeScript
  - 初心者
private: false
updated_at: ''
id: null
organization_url_name: null
slide: false
ignorePublish: false
---

（本文をここに）`;

const body = JSON.stringify({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 4000,
  messages: [{ role: 'user', content: prompt }],
});

function extractAnthropicText(json) {
  // Typical response shape:
  // { content: [ { type: 'text', text: '...' }, ... ] }
  if (!json) return '';
  if (Array.isArray(json.content)) {
    const texts = json.content
      .filter(
        (block) =>
          block &&
          block.type === 'text' &&
          typeof block.text === 'string'
      )
      .map((block) => block.text.trim())
      .filter(Boolean);
    return texts.join('\n\n');
  }

  // Fallback for unexpected shapes
  if (typeof json.content === 'string') return json.content.trim();
  return '';
}

const options = {
  hostname: 'api.anthropic.com',
  path: '/v1/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.CLAUDE_API_KEY,
    'anthropic-version': '2023-06-01',
  },
};

const req = https.request(options, res => {
  let data = '';
  res.on('data', chunk => (data += chunk));
  res.on('end', () => {
    let json;
    try {
      json = JSON.parse(data);
    } catch (e) {
      console.error('Claude API returned non-JSON response');
      console.error(`response_snippet=${data.slice(0, 500)}`);
      process.exit(1);
    }

    // Claude API errors or non-2xx responses may not include `content`.
    if (res.statusCode && res.statusCode >= 400) {
      console.error('Claude API request failed');
      console.error(`statusCode=${res.statusCode}`);
      if (json && json.error) {
        console.error(
          `error=${json.error.type || ''} ${json.error.message || ''}`.trim()
        );
      }
      console.error(`response_snippet=${data.slice(0, 500)}`);
      process.exit(1);
    }

    if (json && json.error) {
      console.error('Claude API returned error payload');
      console.error(
        `error=${json.error.type || ''} ${json.error.message || ''}`.trim()
      );
      console.error(`response_snippet=${data.slice(0, 500)}`);
      process.exit(1);
    }

    const text = extractAnthropicText(json);
    if (!text) {
      console.error('Claude API response did not contain text content');
      console.error(
        `response_keys=${json ? Object.keys(json).join(',') : ''}`
      );
      console.error(`response_snippet=${data.slice(0, 500)}`);
      process.exit(1);
    }

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `article-${date}.md`;
    const filepath = path.join('public', filename);

    fs.mkdirSync('public', { recursive: true });
    fs.writeFileSync(filepath, text);
    console.log(`Generated: ${filepath}`);
  });
});

req.on('error', e => {
  console.error('Error:', e);
  process.exit(1);
});

req.write(body);
req.end();
