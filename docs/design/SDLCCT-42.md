# 設計文件 — SDLCCT-42 新增前端 lint/build CI job

## 對應需求規格
對應 G1 已核准的需求規格:`.github/workflows/ci.yml` 目前只有 `quality`
(seed/)、`bff` 兩個 job,前端 (`frontend/`) 的 lint/build 回歸完全不在 CI
覆蓋範圍內,必須靠人工重跑才能確認綠燈。本票新增一個與現有兩個 job 結構
對稱的 `frontend` job,在每個 PR 自動執行 `npm run lint` 與
`npm run build`。範圍:僅新增這一個 job;不修改 `quality`/`bff` 既有行為,
不引入任何單元測試/e2e 測試步驟(SDLCCT-40 範疇),不回溯處理
SDLCCT-32/34/35/41 已合併的 PR。Story 尺寸:very small。

## 介面/API 契約
不適用。本票不新增/變更任何對外 API 端點或 request/response 格式,只新增
一個 CI job 定義。

## 資料模型
不適用。本票不涉及任何資料表、欄位或索引變更。

## 關鍵技術決策

1. **Node 版本固定為 `20`(對應 Node 20.x LTS),不用 22/24。**
   `frontend/package.json` 沒有 `.nvmrc`、也沒有 `engines` 欄位明確宣告
   Node 版本,但 `devDependencies` 已釘選 `@types/node: "^20"`,代表目前
   前端程式碼是針對 Node 20 的型別撰寫與驗證的。選擇與既有釘選版本一致的
   Node 20 LTS,而非更新的 22/24,避免 CI 環境的實際 Node 版本與開發時
   假設的型別版本不一致,是風險最低、唯一有現有依據支持的選擇。

2. **使用 `actions/setup-node@v4`,搭配 `cache: 'npm'` +
   `cache-dependency-path: frontend/package-lock.json`。**
   `quality`/`bff` 兩個既有 job 用的是 Python 生態的
   `astral-sh/setup-uv@v5` + `uv sync --frozen`,沒有 Node 對應的既有慣例
   可直接複製;因此改採 GitHub 官方 `actions/setup-node@v4` 搭配其原生
   `cache: 'npm'` 選項,這是 Node 專案在 GitHub Actions 的標準做法,效果上
   對等於既有兩個 job 用 `uv sync --frozen` 達成的「鎖定依賴 + 加速安裝」
   目標。`cache-dependency-path` 需明確指向
   `frontend/package-lock.json`,因為 repo 是 monorepo 結構,`setup-node`
   預設只會在 repo 根目錄找 lockfile。

3. **安裝步驟使用 `npm ci`,不用 `npm install`。**
   `frontend/package-lock.json` 已存在且被版本控管,`npm ci` 會嚴格依照
   lockfile 安裝、且在 lockfile 與 `package.json` 不一致時直接失敗,這與
   `quality`/`bff` 兩個既有 job 使用 `uv sync --frozen`(`--frozen` 同樣是
   「鎖定、不重新解析、不一致就失敗」語意)的慣例一致,對 CI 而言可重現性
   與失敗即早發現兩者都優於 `npm install`。

4. **新 job 的實際 YAML(開發者實作的明確目標)：**

```yaml
  frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Build
        run: npm run build
        env:
          NEXT_PUBLIC_BFF_URL: 'http://localhost:8000'
```

   此 job 定義直接插入既有 `jobs:` 區塊下,與 `quality`、`bff` 平行(縮排
   層級相同),不更動 `on:`/`permissions:` 區塊——現有 `pull_request`/`push`
   對 `main` 的觸發條件已經是「所有 job 都排程執行」,新增一個同層級的 job
   不需要額外改動觸發設定即可自動被排入同一次 workflow run。

5. **不加 `if: hashFiles(...)` 條件式跳過(與 `quality`/`bff` 的 test 步驟
   不同)。** 既有兩個 job 的 `Test + coverage gate` 步驟有
   `if: hashFiles('.../tests/**/*.py') != ''`,是為了讓「尚未有測試檔案的
   全新 repo」保持綠燈。`frontend/` 的 `lint`、`build` 腳本已存在於
   `package.json` 且原始碼目錄已存在,不屬於「檔案尚不存在」的情境,因此
   不需要、也不應該加這種條件式跳過——加了反而會讓本該攔截的 lint/build
   回歸被靜默略過,違反本票「自動攔截回歸」的目的。

6. **CI 環境下 `NEXT_PUBLIC_BFF_URL` 的設定:只在 `Build` 步驟的 `env:`
   設定一個佔位字串 `http://localhost:8000`,不設在 job 層級的 `env:`,也
   不透過 GitHub repo secret。**
   `frontend/lib/cost-overview-api.ts`(SDLCCT-41,已合併到 `main`)在模組
   最外層同步檢查 `if (!process.env.NEXT_PUBLIC_BFF_URL) { throw ... }`。
   `/cost-dashboard` 頁面會在 `next build` 的靜態預渲染階段 import 到這個
   模組,因此只要這個環境變數在 `npm run build` 執行時未設定,`build` 步驟
   會在每一個 PR 上無條件失敗,與程式碼本身是否正確無關——這是本設計文件
   先前版本未考慮到的既有行為,實作時被開發者發現並回報。
   - **只放在 `Build` 步驟,不放 job 層級**:這個變數只有
     `npm run build`(把 `NEXT_PUBLIC_*` 內嵌進 client bundle 的階段)才會
     用到;`Install dependencies`、`Lint` 兩步驟都不會觸發
     `cost-overview-api.ts` 的模組求值,放在 job 層級會讓這個 CI 專用的
     設定值不必要地對其他步驟的環境也可見,放在單一步驟的 `env:` 範圍最小。
   - **值選擇佔位字串,不是真實後端網址**:此 job 只執行 `npm run lint`
     與 `npm run build`,兩者都是靜態分析/編譯期檢查,不會啟動伺服器、不會
     對這個網址發出任何實際 HTTP 請求(參照本文件決策 1 的範圍:本票不含
     任何測試步驟)。`cost-overview-api.ts` 只在模組載入時檢查這個變數
     「是否為空字串」,從不在 build 期間讀取其內容去連線,因此任何非空字串
     都能滿足檢查、讓 build 通過;沿用 `frontend/.env.example`(若存在)或
     本機開發慣用的 `http://localhost:8000` 最直觀,不需要是一個真的可連線
     的服務。
   - **不需要 GitHub repo secret**:因為值本身不是機密(是一個本機佔位
     URL、build 期間也從未真正連線),用 workflow YAML 內的字面常數即可,
     用 secret 反而是過度設計,也會讓之後要調整這個佔位值的人多一層不必要
     的 repo 設定依賴。
   - （本決策的本機驗證由 orchestrator 於 G1b 核實階段執行，詳見 Jira
     G1b gate report，非本文件作者本人執行——架構設計階段無 shell 存取權限。）

## UI 原型
不適用,不需要新增原型檔案。本票是純 CI 設定變更(`.github/workflows/`
下的 YAML),不產生、也不修改任何使用者可見的畫面或元件,因此沒有「這個
故事帶來的新畫面」需要在 G1b 給人類看。

## 開放設計問題(定稿時必須為空)
無——驗收條件已完整定義新 job 的結構(runs-on、working-directory、
checkout 步驟、Node 環境設定、lint/build 兩步驟、觸發時機、不含測試步驟、
不回溯既有 PR),本設計文件「關鍵技術決策」段落已將所有 HOW 層級的實作
選擇(Node 版本、cache 策略、npm ci vs install、是否加條件式跳過)定案,
無殘留的產品層級未決項。
