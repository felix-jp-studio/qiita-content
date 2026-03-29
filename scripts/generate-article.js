const https = require('https');
const fs = require('fs');
const path = require('path');

/** JST の暦日 { y, m, d } */
function jstYmdParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return {
    y: parseInt(parts.find((p) => p.type === 'year')?.value, 10),
    m: parseInt(parts.find((p) => p.type === 'month')?.value, 10),
    d: parseInt(parts.find((p) => p.type === 'day')?.value, 10),
  };
}

/** JST のカレンダー日付 YYYYMMDD（ファイル名用） */
function jstYmdCompact() {
  const { y, m, d } = jstYmdParts();
  const pad = (n) => String(n).padStart(2, '0');
  return `${y}${pad(m)}${pad(d)}`;
}

/** グレゴリオ暦 y-m-d の ISO 週番号（1–53） */
function isoWeekFromYmd(y, m, d) {
  const dObj = new Date(Date.UTC(y, m - 1, d));
  const dayNum = dObj.getUTCDay() || 7;
  dObj.setUTCDate(dObj.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dObj.getUTCFullYear(), 0, 1));
  return Math.ceil((((dObj - yearStart) / 86400000) + 1) / 7);
}

/** 日曜の「ツール比較」テーマ（順序固定・件数に応じて週でローテーション） */
const SUNDAY_COMPARISON_THEMES = [
  '【ツール比較】VercelとAWSのどちらを選ぶべきか（用途・料金・運用の観点で整理）',
  '【ツール比較】PrismaとTypeORMを比較する（型安全・マイグレーション・採用の観点）',
  '【ツール比較】FirebaseとSupabaseの違いを解説（BaaSとしての位置づけと選び方）',
  '【ツール比較】Next.jsとRemixのどちらが初心者向けか（学習コスト・ルーティング・小さな例）',
  '【ツール比較】DockerとVercelの使い分け方（ローカル開発・コンテナとホスティングの役割）',
];

/**
 * 日曜テーマのインデックス。ISO週番号をテーマ数で割った余りで決定するため、
 * 通常は隣接するISO週同士ではインデックスが一致しない（前週と同じテーマの回避）。
 */
function sundayComparisonThemeIndex() {
  const { y, m, d } = jstYmdParts();
  const w = isoWeekFromYmd(y, m, d);
  const n = SUNDAY_COMPARISON_THEMES.length;
  return { index: ((w - 1) % n + n) % n, isoWeek: w };
}

/** JST の曜日（英語フル名、THEMES のキーと一致） */
function jstWeekdayEnglishLong() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    weekday: 'long',
  }).format(new Date());
}

const THEMES = {
  Monday: 'Next.jsとClaude APIで作れる便利ツール3選',
  Tuesday: 'GitHubにpushするだけで自動デプロイを実現する方法',
  Wednesday: '初心者がつまずくTypeScriptのエラー5選と解決策',
  Thursday: 'Firebase×Next.jsで認証機能を30分で実装する手順',
  Friday: 'AWS初心者がまず覚えるべきサービス5選',
  Saturday: '個人開発者がVercelを無料で使い倒す方法',
};

const day = jstWeekdayEnglishLong();
let theme;
if (day === 'Sunday') {
  const { index, isoWeek } = sundayComparisonThemeIndex();
  theme = SUNDAY_COMPARISON_THEMES[index];
  console.log(
    `Sunday comparison: ISO week ${isoWeek}, slot ${index + 1}/${SUNDAY_COMPARISON_THEMES.length}`
  );
} else {
  theme = THEMES[day];
}
if (!theme) {
  console.error(`No theme for JST weekday: ${day}`);
  process.exit(1);
}

const sundayOnlyLine =
  day === 'Sunday'
    ? '- 日曜の比較記事：今回割り当てられた上記テーマ**だけ**を扱い、他の週用の比較トピックには触れないでください。\n'
    : '';

const prompt = `あなたはエンジニア向け技術メディアのライターです。
以下のテーマでQiita用の技術記事を書いてください。

【条件】
- 対象読者：プログラミング初心者
- 文字数：800〜1200字
- マークダウン記法を使う
- コードブロックを1つ以上含める
${sundayOnlyLine}- 末尾に以下を含める：詳しい手順はこちら → https://felixstudio0.gumroad.com

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
  // 目標は本文 800〜1200字程度なので、生成負荷を下げて上限を抑える
  max_tokens: 1500,
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

// 生成失敗（例: 529 Overloaded）時に一定時間リトライして成功率を上げる
// 目安: 約2〜5分程度を上限にするため、指数バックオフ + 上限待機時間を併用。
const MAX_ATTEMPTS = 9;
const RETRY_BASE_MS = 2000;
const MAX_RETRY_DELAY_MS = 30000; // 32s以上は待たない

function shouldRetryClaude({ statusCode, json, attempt }) {
  if (attempt >= MAX_ATTEMPTS) return false;
  const errorType = json?.error?.type;
  return (
    statusCode === 429 || // rate limit
    statusCode === 529 || // overloaded / busy
    statusCode === 502 ||
    statusCode === 503 ||
    errorType === 'overloaded_error' ||
    errorType === 'rate_limit_error'
  );
}

function retryDelayMs(attempt) {
  // attempt: 1 -> 1s, 2 -> 2s, 3 -> 4s ...
  const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

function sendRequest(attempt) {
  const req = https.request(options, res => {
    let data = '';
    res.on('data', chunk => (data += chunk));
    res.on('end', () => {
      const statusCode = res.statusCode || 0;

      let json = null;
      try {
        json = JSON.parse(data);
      } catch (e) {
        // 非JSONでも状況コードが再試行可能ならリトライする
        if (
          shouldRetryClaude({
            statusCode,
            json: null,
            attempt,
          })
        ) {
          const delayMs = retryDelayMs(attempt);
          console.error(
            `Claude API response parse failed. Retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`
          );
          setTimeout(() => sendRequest(attempt + 1), delayMs);
          return;
        }
        console.error('Claude API returned non-JSON response');
        console.error(`statusCode=${statusCode}`);
        console.error(`response_snippet=${data.slice(0, 500)}`);
        process.exit(1);
      }

      if (shouldRetryClaude({ statusCode, json, attempt })) {
        const delayMs = retryDelayMs(attempt);
        const errorType = json?.error?.type || '';
        console.error(
          `Claude API overloaded/limited. Retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`
        );
        console.error(`statusCode=${statusCode} errorType=${errorType}`.trim());
        console.error(`response_snippet=${data.slice(0, 200)}`);
        setTimeout(() => sendRequest(attempt + 1), delayMs);
        return;
      }

      // No retry: fail safely.
      if (statusCode >= 400) {
        console.error('Claude API request failed');
        console.error(`statusCode=${statusCode}`);
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
        console.error(`response_keys=${Object.keys(json).join(',')}`);
        console.error(`response_snippet=${data.slice(0, 500)}`);
        process.exit(1);
      }

      const date = jstYmdCompact();
      const filename = `article-${date}.md`;
      const filepath = path.join('public', filename);

      if (fs.existsSync(filepath) && process.env.FORCE_REGENERATE !== '1') {
        console.log(`Skip: ${filepath} already exists (set FORCE_REGENERATE=1 to overwrite)`);
        process.exit(0);
      }

      fs.mkdirSync('public', { recursive: true });
      fs.writeFileSync(filepath, text);
      console.log(`Generated: ${filepath}`);
    });
  });

  req.on('error', e => {
    if (attempt < MAX_ATTEMPTS) {
      const delayMs = retryDelayMs(attempt);
      console.error(
        `Claude API request error. Retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`
      );
      console.error(`message=${e && e.message ? e.message : String(e)}`);
      setTimeout(() => sendRequest(attempt + 1), delayMs);
      return;
    }
    console.error('Claude API request error (final).', e);
    process.exit(1);
  });

  req.write(body);
  req.end();
}

sendRequest(1);
