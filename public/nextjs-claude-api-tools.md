---
title: Next.jsとClaude APIで作れる便利ツール3選【初心者でも1日で完成】
tags:
  - Next.js
  - TypeScript
  - Claude
  - AI
  - 初心者
private: false
updated_at: ''
id: null
organization_url_name: null
slide: false
ignorePublish: false
---

## はじめに

「AIアプリを作ってみたいけど、何を作ればいいかわからない」

今回はNext.jsとClaude APIを組み合わせて、初心者でも1日で作れる便利ツールを3つ紹介します。

## 共通の実装構成

どのツールも以下の構成で作れます。
```typescript
// app/api/chat/route.ts
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

export async function POST(request: NextRequest) {
  const { message } = await request.json();
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{ role: "user", content: message }],
  });
  const text = response.content[0].type === "text"
    ? response.content[0].text : "";
  return NextResponse.json({ reply: text });
}
```

## ツール1：文章校正ツール

テキストエリアに文章を入力すると、Claudeが誤字脱字や不自然な表現を自動チェックします。
```typescript
const prompt = `以下の文章を校正して、修正案を返してください。\n\n${inputText}`;
```

## ツール2：アイデア出しツール

テーマを入力するだけで関連アイデアを10個生成します。
```typescript
const prompt = `「${theme}」に関するアイデアを10個、箇条書きで出してください。`;
```

## ツール3：多言語翻訳ツール

セレクトボックスで翻訳先言語を選んで翻訳します。
```typescript
const prompt = `以下の文章を${targetLang}に翻訳してください。\n\n${inputText}`;
```

## まとめ

この3つはどれもプロンプトを変えるだけで別のツールになります。まず文章校正ツールから作り始めて、慣れたら自分だけのオリジナルツールに発展させてみてください。

詳しい手順はこちら → https://felixstudio0.gumroad.com