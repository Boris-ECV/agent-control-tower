# 設計文件 — SDLCCT-41 cost-overview-api.ts: 移除 NEXT_PUBLIC_BFF_URL 的隱性預設值

## 對應需求規格
對應 G1 已核准的需求規格:`frontend/lib/cost-overview-api.ts` 目前
`export const BFF_BASE_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:8000";`
在環境變數未設定時靜默回退到 `localhost:8000`,違反 `CONSTITUTION.md`
「Failure handling」段「Never fall back to a default value for a required
environment variable」,也與既有慣例(`seed/client.py::base_url()` 在
`OPIK_BASE_URL` 未設定時 `raise SystemExit`)不一致。repo 全域 grep 已確認
這是唯一一個「必要但有隱性預設值」的環境變數,其餘 `os.environ.get(...,
default)` / `process.env.NEXT_PUBLIC_*` 皆為刻意可選,不在本票範圍內。
範圍:僅修正此一行為同一檔案內因此行為而需要的最小配套(fail-fast 檢查 +
錯誤呈現路徑),不涉及其他環境變數、其他檔案的預設值審查,也不追加本故事
未要求的功能。Story 尺寸:very small。

## 介面/API 契約
無新增/變更的對外 API 端點或 request/response 格式。本票只改變
`BFF_BASE_URL` 這個常數在「環境變數缺失」情況下的行為,`fetchCostOverviewSummary`
/`fetchPeriodComparison` 的回傳型別與現有呼叫端介面不變。

## 資料模型
無新增資料模型。

## 關鍵技術決策

1. **檢查時機:只做 runtime 檢查,不新增 build-time 驗證步驟。**
   `NEXT_PUBLIC_*` 變數是在 build 時被內嵌進 client bundle,Next.js 並沒有
   原生的「build 失敗」掛鉤可以讓一個一般的 TS 模組在 build 階段擋下遺漏的
   環境變數(除非額外寫一支獨立的 pre-build 驗證 script 並修改
   `project-profile.yaml` 的 build 指令)。所有呼叫點
   (`summary-section.tsx`、`period-comparison-section.tsx`,經由
   `error-card.tsx` 呈現)都是 `"use client"` 元件,所以在
   `cost-overview-api.ts` 模組最外層加一個同步檢查
   (`if (!process.env.NEXT_PUBLIC_BFF_URL) { throw ... }`)會在瀏覽器每次
   載入頁面、模組初次被 import 時就必定執行一次——雖然不是嚴格意義的
   build-time 失敗,但實際效果是「只要變數沒設,頁面一開就會失敗」,不存在
   漏網的執行路徑。新增一支獨立 pre-build 驗證 script 並改動
   `project-profile.yaml` 的建置指令,對這張 very small 票而言是過度設計:
   它只會把同一個錯誤提早到 CI 的 build 步驟,但不會改變「開發者必須設定
   這個變數」這個事實,也不會讓錯誤訊息更清楚。依 `CONSTITUTION.md`「Design
   docs stay in proportion to the story: a small change gets a short
   design」與「Prefer three similar lines over a premature abstraction」,
   選擇 runtime-only 檢查,不觸碰 `project-profile.yaml`。

2. **錯誤呈現:拋出未攔截的 Error,交給 Next.js 預設的 error boundary,
   不重用 `ErrorCard`。** 理由:
   - `ErrorCard` 的設計(`error-card.tsx`、SDLCCT-32 設計文件)是為「單一
     endpoint 的 fetch 失敗、其他卡片不受影響」而建——它接受一個
     `ApiError { endpoint, status, message }` 物件與一個 `onRetry` callback,
     語意是「這張卡片的資料暫時拿不到,換個時間或換個方式可能會成功」。
   - 環境變數缺失是組態錯誤,不是某一次 fetch 的暫時性失敗:它在 import
     階段就會發生(比任何元件的 fetch 呼叫更早),按「重試」不會有任何效果
     (變數仍然沒設,bundle 需要重新 build 才能修好),把它包裝成可重試的
     `ApiError` 形狀反而誤導使用者「重試可能有救」。
   - 要讓它變成某張卡片的 `ApiError` 狀態,需要每個呼叫端各自 `try/catch`
     這個 module-level throw 並轉換成 `ApiError` 物件,這是在為一個組態
     錯誤重新發明一套「每卡片隔離」的錯誤處理路徑,而 SDLCCT-32 那套路徑是
     設計給「後端查詢失敗」這個完全不同的失敗模式使用的,混用會讓
     `ErrorCard` 的語意變得模糊。
   - 與既有慣例一致:`seed/client.py::base_url()` 對缺失的 `OPIK_BASE_URL`
     直接 `raise SystemExit`,是一個「硬性、不可恢復」的失敗,不會被包裝
     成可重試的業務錯誤卡片。本票的 Error throw 是前端對等的做法。
   - 結論:在 `cost-overview-api.ts` 模組最外層同步丟出一個一般的
     `Error`(訊息需明確指出缺少 `NEXT_PUBLIC_BFF_URL`),不建立新的錯誤
     呈現元件,讓 Next.js 既有的（全站共用的）error boundary 接手顯示。

## UI 原型
不需要新的原型檔案。本票沒有新增或調整任何視覺元件——`ErrorCard` 完全
不變(見「關鍵技術決策」第 2 點,決定不使用它),新的行為只是在
`BFF_BASE_URL` 初始化時多一個同步的 `throw`,呈現畫面用的是 Next.js 專案
既有、所有頁面共用的預設 error boundary,不是本故事新增的畫面。因此沒有
「這個故事帶來的新畫面」需要在 G1b 給人類看。

## 開放設計問題(定稿時必須為空)
無——需求分析師明確交付本設計決定的兩個 HOW 問題(檢查時機、錯誤呈現方式)
已於「關鍵技術決策」段落定案,無殘留的產品層級未決項。
