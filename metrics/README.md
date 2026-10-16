# metrics/

- `events.jsonl` — append-only 指標事件流（schema: docs/07 §1）。永不修改歷史行。
- `retro-<date>.md` — 週回顧報告輸出。

實例化時此目錄隨框架複製進專案 repo，事件檔隨專案 commit（它同時是稽核軌跡）。
