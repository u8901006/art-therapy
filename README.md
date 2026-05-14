# Art Therapy Research - 藝術治療文獻日報

每日自動從 PubMed 抓取最新藝術治療相關文獻，由 AI 分析、分類後生成漂亮日報。

## 網站

https://u8901006.github.io/art-therapy/

## 運作流程

1. **每日 GMT+8 22:15** 自動觸發 GitHub Actions
2. 從 PubMed 抓取過去 7 天的新文獻（排除已總結過的）
3. 透過 Zhipu AI (GLM-5-Turbo) 進行分析、摘要、分類
4. 生成 HTML 日報並部署至 GitHub Pages

## 技術棧

- Node.js 24（純原生，零依賴）
- PubMed E-utilities API
- Zhipu AI API（GLM-5-Turbo → GLM-4.7 → GLM-4.7-Flash 備援）
- GitHub Actions + GitHub Pages

## 相關連結

- [李政洋身心診所](https://www.leepsyclinic.com/)
- [訂閱電子報](https://blog.leepsyclinic.com/)
- [Buy Me a Coffee](https://buymeacoffee.com/CYlee)
