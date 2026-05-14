#!/usr/bin/env node
/**
 * Generate index.html listing all art therapy daily reports.
 * Matches the warm cream/copper theme of the project.
 */

import { readdirSync, writeFileSync } from "node:fs";

const WEEKDAYS = ["\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u65E5"];

function getTaipeiDate() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

let files;
try {
  files = readdirSync("docs")
    .filter((f) => f.startsWith("art-therapy-") && f.endsWith(".html"))
    .sort()
    .reverse();
} catch {
  files = [];
}

const links = files
  .slice(0, 30)
  .map((name) => {
    const date = name.replace("art-therapy-", "").replace(".html", "");
    let dateDisplay = date;
    let weekday = "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const d = new Date(date + "T00:00:00");
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const day = d.getDate();
      dateDisplay = `${y}\u5E74${m}\u6708${day}\u65E5`;
      weekday = WEEKDAYS[d.getDay()];
    }
    return `<li><a href="${name}">\u{1F4C5} ${dateDisplay}\uFF08\u9031${weekday}\uFF09</a></li>`;
  })
  .join("\n");

const total = files.length;
const today = (() => {
  const d = getTaipeiDate();
  return `${d.getFullYear()}\u5E74${d.getMonth() + 1}\u6708${d.getDate()}\u65E5`;
})();

const index = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Art Therapy Research \u00B7 \u85DD\u8853\u6CBB\u7642\u6587\u737B\u65E5\u5831</title>
<style>
  :root { --bg: #f6f1e8; --surface: #fffaf2; --line: #d8c5ab; --text: #2b2118; --muted: #766453; --accent: #8c4f2b; --accent-soft: #ead2bf; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: radial-gradient(circle at top, #fff6ea 0, var(--bg) 55%, #ead8c6 100%); color: var(--text); font-family: "Noto Sans TC", "PingFang TC", "Helvetica Neue", Arial, sans-serif; min-height: 100vh; }
  .container { position: relative; z-index: 1; max-width: 640px; margin: 0 auto; padding: 80px 24px; }
  .logo { font-size: 48px; text-align: center; margin-bottom: 16px; }
  h1 { text-align: center; font-size: 24px; color: var(--text); margin-bottom: 8px; }
  .subtitle { text-align: center; color: var(--accent); font-size: 14px; margin-bottom: 48px; }
  .count { text-align: center; color: var(--muted); font-size: 13px; margin-bottom: 32px; }
  ul { list-style: none; }
  li { margin-bottom: 8px; }
  a { color: var(--text); text-decoration: none; display: block; padding: 14px 20px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; transition: all 0.2s; font-size: 15px; }
  a:hover { background: var(--accent-soft); border-color: var(--accent); transform: translateX(4px); }
  .footer-links { margin-top: 40px; display: flex; flex-direction: column; gap: 10px; }
  .footer-link { display: flex; align-items: center; gap: 12px; padding: 14px 20px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; text-decoration: none; color: var(--text); transition: all 0.2s; font-size: 14px; }
  .footer-link:hover { background: var(--accent-soft); border-color: var(--accent); transform: translateX(4px); }
  .footer-link .icon { font-size: 22px; flex-shrink: 0; }
  .footer-link .label { font-weight: 600; }
  .footer-link .desc { font-size: 12px; color: var(--muted); }
  footer { margin-top: 40px; text-align: center; font-size: 12px; color: var(--muted); }
  footer a { display: inline; padding: 0; background: none; border: none; color: var(--muted); }
  footer a:hover { color: var(--accent); }
</style>
</head>
<body>
<div class="container">
  <div class="logo">\u{1F3A8}</div>
  <h1>Art Therapy Research</h1>
  <p class="subtitle">\u85DD\u8853\u6CBB\u7642\u6587\u737B\u65E5\u5831 \u00B7 \u6BCF\u65E5\u81EA\u52D5\u66F4\u65B0</p>
  <p class="count">\u5171 ${total} \u671F\u65E5\u5831\uFF08\u6700\u5F8C\u66F4\u65B0\uFF1A${today}\uFF09</p>
  <ul>${links}</ul>
  <div class="footer-links">
    <a href="https://www.leepsyclinic.com/" class="footer-link" target="_blank" rel="noopener">
      <span class="icon">\u{1F3E5}</span>
      <span><span class="label">\u674E\u653F\u6D0B\u8EAB\u5FC3\u8A3A\u6240</span><br/><span class="desc">\u5C08\u696D\u8EAB\u5FC3\u8A3A\u6240\u00B7\u5FC3\u7406\u6CBB\u7642\u00B7\u85DD\u8853\u6CBB\u7642</span></span>
    </a>
    <a href="https://blog.leepsyclinic.com/" class="footer-link" target="_blank" rel="noopener">
      <span class="icon">\u{1F4E8}</span>
      <span><span class="label">\u8A02\u95B1\u96FB\u5B50\u5831</span><br/><span class="desc">\u8A02\u95B1\u674E\u653F\u6D0B\u8EAB\u5FC3\u8A3A\u6240\u96FB\u5B50\u5831</span></span>
    </a>
    <a href="https://buymeacoffee.com/CYlee" class="footer-link" target="_blank" rel="noopener">
      <span class="icon">\u2615</span>
      <span><span class="label">Buy Me a Coffee</span><br/><span class="desc">\u652F\u6301\u672C\u8A08\u756B</span></span>
    </a>
  </div>
  <footer>
    <p>Powered by PubMed + Zhipu AI \u00B7 <a href="https://github.com/u8901006/art-therapy">GitHub</a></p>
  </footer>
</div>
</body>
</html>`;

writeFileSync("docs/index.html", index, "utf-8");
console.log(`Index page generated (${total} reports listed)`);
