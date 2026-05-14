#!/usr/bin/env node
/**
 * Generate art therapy daily report HTML using Zhipu AI.
 * Reads papers JSON, analyzes with AI (GLM-5-Turbo with fallbacks),
 * generates styled HTML matching the warm cream/copper theme.
 */

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const API_BASE = process.env.ZHIPU_API_BASE || "https://open.bigmodel.cn/api/coding/paas/v4";
const MODELS = ["glm-5-turbo", "glm-4.7", "glm-4.7-flash"];
const MAX_TOKENS = 50000;
const TIMEOUT_MS = 480_000;
const MAX_RETRIES = 3;

const SYSTEM_PROMPT = `你是藝術治療領域的資深研究員與科學傳播者。你的任務是：
1. 從提供的醫學/心理學文獻中，篩選出最具臨床意義與研究價值的藝術治療相關論文
2. 對每篇論文進行繁體中文摘要、分類、PICO 分析
3. 評估其臨床實用性（高/中/低）
4. 生成適合醫療專業人員、藝術治療師閱讀的日報

輸出格式要求：
- 語言：繁體中文（台灣用語）
- 專業但易懂
- 每篇論文需包含：中文標題、一句話總結、PICO分析、臨床實用性、分類標籤
- 最後提供今日精選 TOP 3（最重要/最影響臨床實踐的論文）
回傳格式必須是純 JSON，不要用 markdown code block 包裹。`;

function getTaipeiDate() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadPapers(inputPath) {
  const raw = readFileSync(inputPath, "utf-8");
  return JSON.parse(raw);
}

function safeJsonParse(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    const firstNewline = cleaned.indexOf("\n");
    if (firstNewline !== -1) {
      cleaned = cleaned.slice(firstNewline + 1);
    } else {
      cleaned = cleaned.slice(3);
    }
    cleaned = cleaned.replace(/```+$/g, "").trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        const fixed = jsonMatch[0]
          .replace(/,\s*([}\]])/g, "$1")
          .replace(/\\n/g, " ")
          .replace(/[\x00-\x1f]/g, (c) => (c === "\n" || c === "\r" || c === "\t" ? " " : ""));
        try {
          return JSON.parse(fixed);
        } catch {
          const braceStart = fixed.indexOf("{");
          const braceEnd = fixed.lastIndexOf("}");
          if (braceStart !== -1 && braceEnd > braceStart) {
            return JSON.parse(fixed.slice(braceStart, braceEnd + 1));
          }
        }
      }
    }
    throw new Error("JSON parse failed after all recovery attempts");
  }
}

async function analyzePapers(apiKey, papersData) {
  const dateStr = papersData.date || formatDate(getTaipeiDate());
  const paperCount = papersData.count || 0;
  const papersText = JSON.stringify(papersData.papers || [], null, 2);

  const prompt = `以下是 ${dateStr} 從 PubMed 抓取的最新藝術治療相關文獻（共 ${paperCount} 篇）。

請進行以下分析，並以 JSON 格式回傳（不要用 markdown code block）：

{
  "date": "${dateStr}",
  "market_summary": "1-2句話總結今天文獻的整體趨勢與亮點（聚焦藝術治療領域）",
  "top_picks": [
    {
      "rank": 1,
      "title_zh": "中文標題",
      "title_en": "English Title",
      "journal": "期刊名",
      "summary": "一句話總結（繁體中文，點出核心發現與臨床意義）",
      "pico": {
        "population": "研究對象",
        "intervention": "介入措施",
        "comparison": "對照組",
        "outcome": "主要結果"
      },
      "clinical_utility": "高/中/低",
      "utility_reason": "為什麼實用的一句話說明",
      "tags": ["標籤1", "標籤2"],
      "url": "原文連結",
      "emoji": "相關emoji"
    }
  ],
  "all_papers": [
    {
      "title_zh": "中文標題",
      "title_en": "English Title",
      "journal": "期刊名",
      "summary": "一句話總結",
      "clinical_utility": "高/中/低",
      "tags": ["標籤1"],
      "url": "連結",
      "emoji": "emoji"
    }
  ],
  "keywords": ["關鍵字1", "關鍵字2"],
  "topic_distribution": {
    "藝術治療與創傷": 3,
    "藝術治療與失智症": 2
  }
}

原始文獻資料：
${papersText}

請篩選出最重要的 TOP 5-8 篇論文放入 top_picks（按重要性排序），其餘放入 all_papers。
每篇 paper 的 tags 請從以下選擇：藝術治療與創傷、藝術治療與憂鬱症、藝術治療與焦慮、藝術治療與兒少、藝術治療與失智症、藝術治療與癌症、藝術治療與復健、藝術治療與自閉症、藝術治療與精神分裂症、視覺藝術治療、表達性藝術治療、創意藝術治療、藝術與健康、社區藝術治療、博物館介入、神經科學機制、隨機對照試驗、系統性回顧、质性研究、實施科學、社會處方、安寧療護。
記住：回傳純 JSON，不要用 \`\`\`json\`\`\` 包裹。`;

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  for (const model of MODELS) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.error(`[INFO] Trying ${model} (attempt ${attempt + 1})...`);
        const payload = {
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          top_p: 0.9,
          max_tokens: MAX_TOKENS,
        };

        const resp = await fetch(`${API_BASE}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (resp.status === 429) {
          const wait = 60000 * (attempt + 1);
          console.error(`[WARN] Rate limited, waiting ${wait / 1000}s...`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }

        if (!resp.ok) {
          const body = await resp.text();
          console.error(`[ERROR] HTTP ${resp.status}: ${body.slice(0, 200)}`);
          if (resp.status >= 500) continue;
          break;
        }

        const data = await resp.json();
        const text = data.choices?.[0]?.message?.content || "";
        const result = safeJsonParse(text);
        console.error(
          `[INFO] Analysis complete: ${result.top_picks?.length || 0} top picks, ${result.all_papers?.length || 0} total`
        );
        result._model = model;
        return result;
      } catch (e) {
        if (e.name === "JSONParseError" || e.message?.includes("JSON")) {
          console.error(`[WARN] JSON parse failed on attempt ${attempt + 1}: ${e.message}`);
          if (attempt < MAX_RETRIES - 1) await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        console.error(`[ERROR] ${model} failed: ${e.message}`);
        break;
      }
    }
  }

  console.error("[ERROR] All models and attempts failed");
  return null;
}

function generateHtml(analysis) {
  const dateStr = analysis.date || formatDate(getTaipeiDate());
  const parts = dateStr.split("-");
  const dateDisplay = parts.length === 3 ? `${parts[0]}年${parseInt(parts[1])}月${parseInt(parts[2])}日` : dateStr;

  const summary = analysis.market_summary || "";
  const topPicks = analysis.top_picks || [];
  const allPapers = analysis.all_papers || [];
  const keywords = analysis.keywords || [];
  const topicDist = analysis.topic_distribution || {};
  const usedModel = analysis._model || MODELS[0];

  const topPicksHtml = topPicks
    .map((pick) => {
      const tagsHtml = (pick.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
      const util = pick.clinical_utility || "中";
      const utilityClass = util === "高" ? "utility-high" : util === "中" ? "utility-mid" : "utility-low";
      const pico = pick.pico || {};
      const picoHtml = Object.keys(pico).length
        ? `<div class="pico-grid">
              <div class="pico-item"><span class="pico-label">P</span><span class="pico-text">${esc(pico.population || "-")}</span></div>
              <div class="pico-item"><span class="pico-label">I</span><span class="pico-text">${esc(pico.intervention || "-")}</span></div>
              <div class="pico-item"><span class="pico-label">C</span><span class="pico-text">${esc(pico.comparison || "-")}</span></div>
              <div class="pico-item"><span class="pico-label">O</span><span class="pico-text">${esc(pico.outcome || "-")}</span></div>
            </div>`
        : "";
      return `<div class="news-card featured">
          <div class="card-header">
            <span class="rank-badge">#${esc(String(pick.rank || ""))}</span>
            <span class="emoji-icon">${esc(pick.emoji || "\u{1F3A8}")}</span>
            <span class="${utilityClass}">${esc(util)}實用性</span>
          </div>
          <h3>${esc(pick.title_zh || pick.title_en || "")}</h3>
          <p class="journal-source">${esc(pick.journal || "")} &middot; ${esc(pick.title_en || "")}</p>
          <p>${esc(pick.summary || "")}</p>
          ${picoHtml}
          <div class="card-footer">
            ${tagsHtml}
            <a href="${escAttr(pick.url || "#")}" target="_blank" rel="noopener">\u95B1\u8B80\u539F\u6587 \u2192</a>
          </div>
        </div>`;
    })
    .join("");

  const allPapersHtml = allPapers
    .map((paper) => {
      const tagsHtml = (paper.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
      const util = paper.clinical_utility || "中";
      const utilityClass = util === "高" ? "utility-high" : util === "中" ? "utility-mid" : "utility-low";
      return `<div class="news-card">
          <div class="card-header-row">
            <span class="emoji-sm">${esc(paper.emoji || "\u{1F3A8}")}</span>
            <span class="${utilityClass} utility-sm">${esc(util)}</span>
          </div>
          <h3>${esc(paper.title_zh || paper.title_en || "")}</h3>
          <p class="journal-source">${esc(paper.journal || "")}</p>
          <p>${esc(paper.summary || "")}</p>
          <div class="card-footer">
            ${tagsHtml}
            <a href="${escAttr(paper.url || "#")}" target="_blank" rel="noopener">PubMed \u2192</a>
          </div>
        </div>`;
    })
    .join("");

  const keywordsHtml = keywords.map((k) => `<span class="keyword">${esc(k)}</span>`).join("");

  const maxCount = Math.max(...Object.values(topicDist), 1);
  const topicBarsHtml = Object.entries(topicDist)
    .map(([topic, count]) => {
      const widthPct = Math.round((count / maxCount) * 100);
      return `<div class="topic-row">
              <span class="topic-name">${esc(topic)}</span>
              <div class="topic-bar-bg"><div class="topic-bar" style="width:${widthPct}%"></div></div>
              <span class="topic-count">${count}</span>
            </div>`;
    })
    .join("");

  const totalCount = topPicks.length + allPapers.length;

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Art Therapy Research \u00B7 \u85DD\u8853\u6CBB\u7642\u6587\u737B\u65E5\u5831 \u00B7 ${dateDisplay}</title>
<meta name="description" content="${dateDisplay} \u85DD\u8853\u6CBB\u7642\u6587\u737B\u65E5\u5831\uFF0C\u7531 AI \u81EA\u52D5\u5F59\u6574 PubMed \u6700\u65B0\u8AD6\u6587"/>
<style>
  :root { --bg: #f6f1e8; --surface: #fffaf2; --line: #d8c5ab; --text: #2b2118; --muted: #766453; --accent: #8c4f2b; --accent-soft: #ead2bf; --card-bg: color-mix(in srgb, var(--surface) 92%, white); }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: radial-gradient(circle at top, #fff6ea 0, var(--bg) 55%, #ead8c6 100%); color: var(--text); font-family: "Noto Sans TC", "PingFang TC", "Helvetica Neue", Arial, sans-serif; min-height: 100vh; overflow-x: hidden; }
  .container { position: relative; z-index: 1; max-width: 880px; margin: 0 auto; padding: 60px 32px 80px; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 52px; animation: fadeDown 0.6s ease both; }
  .logo { width: 48px; height: 48px; border-radius: 14px; background: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0; box-shadow: 0 4px 20px rgba(140,79,43,0.25); }
  .header-text h1 { font-size: 22px; font-weight: 700; color: var(--text); letter-spacing: -0.3px; }
  .header-meta { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; align-items: center; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; letter-spacing: 0.3px; }
  .badge-date { background: var(--accent-soft); border: 1px solid var(--line); color: var(--accent); }
  .badge-count { background: rgba(140,79,43,0.06); border: 1px solid var(--line); color: var(--muted); }
  .badge-source { background: transparent; color: var(--muted); font-size: 11px; padding: 0 4px; }
  .summary-card { background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; padding: 28px 32px; margin-bottom: 32px; box-shadow: 0 20px 60px rgba(61,36,15,0.06); animation: fadeUp 0.5s ease 0.1s both; }
  .summary-card h2 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.6px; color: var(--accent); margin-bottom: 16px; }
  .summary-text { font-size: 15px; line-height: 1.8; color: var(--text); }
  .section { margin-bottom: 36px; animation: fadeUp 0.5s ease both; }
  .section-title { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 700; color: var(--text); margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
  .section-icon { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; background: var(--accent-soft); }
  .news-card { background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; padding: 22px 26px; margin-bottom: 12px; box-shadow: 0 8px 30px rgba(61,36,15,0.04); transition: background 0.2s, border-color 0.2s, transform 0.2s; }
  .news-card:hover { transform: translateY(-2px); box-shadow: 0 12px 40px rgba(61,36,15,0.08); }
  .news-card.featured { border-left: 3px solid var(--accent); }
  .news-card.featured:hover { border-color: var(--accent); }
  .card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .rank-badge { background: var(--accent); color: #fff7f0; font-weight: 700; font-size: 12px; padding: 2px 8px; border-radius: 6px; }
  .emoji-icon { font-size: 18px; }
  .card-header-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .emoji-sm { font-size: 14px; }
  .news-card h3 { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 8px; line-height: 1.5; }
  .journal-source { font-size: 12px; color: var(--accent); margin-bottom: 8px; opacity: 0.8; }
  .news-card p { font-size: 13.5px; line-height: 1.75; color: var(--muted); }
  .card-footer { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .tag { padding: 2px 9px; background: var(--accent-soft); border-radius: 999px; font-size: 11px; color: var(--accent); }
  .news-card a { font-size: 12px; color: var(--accent); text-decoration: none; opacity: 0.7; margin-left: auto; }
  .news-card a:hover { opacity: 1; }
  .utility-high { color: #5a7a3a; font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(90,122,58,0.1); border-radius: 4px; }
  .utility-mid { color: #9f7a2e; font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(159,122,46,0.1); border-radius: 4px; }
  .utility-low { color: var(--muted); font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(118,100,83,0.08); border-radius: 4px; }
  .utility-sm { font-size: 10px; }
  .pico-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; padding: 12px; background: rgba(255,253,249,0.8); border-radius: 14px; border: 1px solid var(--line); }
  .pico-item { display: flex; gap: 8px; align-items: baseline; }
  .pico-label { font-size: 10px; font-weight: 700; color: #fff7f0; background: var(--accent); padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
  .pico-text { font-size: 12px; color: var(--muted); line-height: 1.4; }
  .keywords-section { margin-bottom: 36px; }
  .keywords { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .keyword { padding: 5px 14px; background: var(--accent-soft); border: 1px solid var(--line); border-radius: 20px; font-size: 12px; color: var(--accent); cursor: default; transition: background 0.2s; }
  .keyword:hover { background: rgba(140,79,43,0.18); }
  .topic-section { margin-bottom: 36px; }
  .topic-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .topic-name { font-size: 13px; color: var(--muted); width: 120px; flex-shrink: 0; text-align: right; }
  .topic-bar-bg { flex: 1; height: 8px; background: var(--line); border-radius: 4px; overflow: hidden; }
  .topic-bar { height: 100%; background: linear-gradient(90deg, var(--accent), #c47a4a); border-radius: 4px; transition: width 0.6s ease; }
  .topic-count { font-size: 12px; color: var(--accent); width: 24px; }
  .footer-links { margin-top: 48px; display: flex; flex-direction: column; gap: 12px; animation: fadeUp 0.5s ease 0.3s both; }
  .footer-link { display: flex; align-items: center; gap: 14px; padding: 18px 24px; background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; text-decoration: none; color: var(--text); transition: all 0.2s; box-shadow: 0 8px 30px rgba(61,36,15,0.04); }
  .footer-link:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 12px 40px rgba(61,36,15,0.08); }
  .footer-icon { font-size: 28px; flex-shrink: 0; }
  .footer-name { font-size: 15px; font-weight: 700; color: var(--text); flex: 1; }
  .footer-desc { font-size: 12px; color: var(--muted); margin-top: 2px; font-weight: 400; }
  .footer-arrow { font-size: 18px; color: var(--accent); font-weight: 700; }
  footer { margin-top: 32px; padding-top: 22px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--muted); display: flex; justify-content: space-between; animation: fadeUp 0.5s ease 0.5s both; }
  footer a { color: var(--muted); text-decoration: none; }
  footer a:hover { color: var(--accent); }
  @keyframes fadeDown { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 600px) { .container { padding: 36px 18px 60px; } .summary-card, .news-card { padding: 20px 18px; } .pico-grid { grid-template-columns: 1fr; } footer { flex-direction: column; gap: 6px; text-align: center; } .topic-name { width: 80px; font-size: 11px; } }
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="logo">\u{1F3A8}</div>
    <div class="header-text">
      <h1>Art Therapy Research \u00B7 \u85DD\u8853\u6CBB\u7642\u6587\u737B\u65E5\u5831</h1>
      <div class="header-meta">
        <span class="badge badge-date">\u{1F4C5} ${dateDisplay}</span>
        <span class="badge badge-count">\u{1F4CA} ${totalCount} \u7BC7\u6587\u737B</span>
        <span class="badge badge-source">Powered by PubMed + Zhipu AI</span>
      </div>
    </div>
  </header>

  <div class="summary-card">
    <h2>\u{1F4CB} \u4ECA\u65E5\u6587\u737B\u8DA8\u52E2</h2>
    <p class="summary-text">${esc(summary)}</p>
  </div>

  ${topPicksHtml ? `<div class="section"><div class="section-title"><span class="section-icon">\u2B50</span>\u4ECA\u65E5\u7CBE\u9078 TOP Picks</div>${topPicksHtml}</div>` : ""}

  ${allPapersHtml ? `<div class="section"><div class="section-title"><span class="section-icon">\u{1F4DA}</span>\u5176\u4ED6\u503C\u5F97\u95DC\u6CE8\u7684\u6587\u737B</div>${allPapersHtml}</div>` : ""}

  ${topicBarsHtml ? `<div class="topic-section section"><div class="section-title"><span class="section-icon">\u{1F4CA}</span>\u4E3B\u984C\u5206\u4F48</div>${topicBarsHtml}</div>` : ""}

  ${keywordsHtml ? `<div class="keywords-section section"><div class="section-title"><span class="section-icon">\u{1F3F7}\uFE0F</span>\u95DC\u9375\u5B57</div><div class="keywords">${keywordsHtml}</div></div>` : ""}

  <div class="footer-links">
    <a href="https://www.leepsyclinic.com/" class="footer-link" target="_blank" rel="noopener">
      <span class="footer-icon">\u{1F3E5}</span>
      <span><span class="footer-name">\u674E\u653F\u6D0B\u8EAB\u5FC3\u8A3A\u6240\u9996\u9801</span><br/><span class="footer-desc">\u5C08\u696D\u8EAB\u5FC3\u8A3A\u6240\u00B7\u5FC3\u7406\u6CBB\u7642\u00B7\u85DD\u8853\u6CBB\u7642</span></span>
      <span class="footer-arrow">\u2192</span>
    </a>
    <a href="https://blog.leepsyclinic.com/" class="footer-link" target="_blank" rel="noopener">
      <span class="footer-icon">\u{1F4E8}</span>
      <span><span class="footer-name">\u8A02\u95B1\u96FB\u5B50\u5831</span><br/><span class="footer-desc">\u8A02\u95B1\u674E\u653F\u6D0B\u8EAB\u5FC3\u8A3A\u6240\u96FB\u5B50\u5831\uFF0C\u7372\u53D6\u6700\u65B0\u8CC7\u8A0A</span></span>
      <span class="footer-arrow">\u2192</span>
    </a>
    <a href="https://buymeacoffee.com/CYlee" class="footer-link" target="_blank" rel="noopener">
      <span class="footer-icon">\u2615</span>
      <span><span class="footer-name">Buy Me a Coffee</span><br/><span class="footer-desc">\u652F\u6301\u672C\u8A08\u756B\u00B7\u8B93\u6211\u5011\u7E7C\u7E8C\u70BA\u60A8\u63D0\u4F9B\u6700\u65B0\u6587\u737B\u65E5\u5831</span></span>
      <span class="footer-arrow">\u2192</span>
    </a>
  </div>

  <footer>
    <span>\u8CC7\u6599\u4F86\u6E90\uFF1APubMed \u00B7 \u5206\u6790\u6A21\u578B\uFF1A${usedModel}</span>
    <span><a href="https://github.com/u8901006/art-therapy">GitHub</a></span>
  </footer>
</div>
</body>
</html>`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function main() {
  const args = process.argv.slice(2);
  const getInput = () => args.find((a) => a.startsWith("--input="))?.split("=")[1];
  const getOutput = () => args.find((a) => a.startsWith("--output="))?.split("=")[1];

  const inputPath = getInput() || "papers.json";
  const outputPath = getOutput() || "docs/art-therapy-report.html";
  const apiKey = process.env.ZHIPU_API_KEY || "";

  if (!apiKey) {
    console.error("[ERROR] ZHIPU_API_KEY environment variable is required");
    process.exit(1);
  }

  const papersData = loadPapers(inputPath);

  if (!papersData || !papersData.papers?.length) {
    console.error("[WARN] No papers found, generating empty report");
    const analysis = {
      date: formatDate(getTaipeiDate()),
      market_summary: "\u4ECA\u65E5 PubMed \u66AB\u7121\u65B0\u7684\u85DD\u8853\u6CBB\u7642\u76F8\u95DC\u6587\u737B\u66F4\u65B0\u3002\u8ACB\u660E\u5929\u518D\u67E5\u770B\u3002",
      top_picks: [],
      all_papers: [],
      keywords: [],
      topic_distribution: {},
      _model: MODELS[0],
    };
    const html = generateHtml(analysis);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, html, "utf-8");
    console.error(`[INFO] Empty report saved to ${outputPath}`);
    return;
  }

  const analysis = await analyzePapers(apiKey, papersData);
  if (!analysis) {
    console.error("[ERROR] Analysis failed, cannot generate report");
    process.exit(1);
  }

  const html = generateHtml(analysis);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, "utf-8");
  console.error(`[INFO] Report saved to ${outputPath}`);
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});
