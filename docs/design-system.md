# UI / 設計規範（Design System）— Agent Control Tower

<!--
本文件是視覺規範的權威來源。CONSTITUTION.md 的「視覺設計」段落只放一句
指標指向這裡，不重複內容——細節規格改這裡，CONSTITUTION.md 不用跟著動。
architect / developer / reviewer 在涉及畫面的 Story 中應讀取本文件。

這是骨架範本，不是可直接套用的規範——章節結構沿用一次實際 pilot 驗證過
的分類方式，但內容全部要換成你的專案自己的視覺語言。沒有視覺畫面需求的
專案（純 API 服務等）可以直接刪除這份檔案，並把 CONSTITUTION.md 的
「視覺設計」段落一併移除。
-->

## 0. 風格定位

企業感（B2B SaaS 成本監控工具）、資訊密度優先、以 zh-TW 文字為主要內容——
不走活潑/消費性風格，不用插圖或大面積留白堆砌「輕盈感」；色彩對比與排版
以「長時間盯著數字儀表板」的使用情境為準，不是行銷頁。理由：規格明確定位
為「B2B cost-monitoring tool」，且範圍外排除品牌色/Logo，代表本文件只需定義
中性、可長期沿用的基礎視覺語言，不是客製品牌識別。

## 1. 色彩系統

色彩 token（CSS 自訂屬性），並註明對比度要求（WCAG AA 4.5:1）：

| Token | 值 | 用途 |
|---|---|---|
| `--color-bg` | `#FFFFFF` | 頁面/卡片背景 |
| `--color-text-primary` | `#1F2937` | 標題、內文主要文字 |
| `--color-text-secondary` | `#4B5563` | 輔助文字（meta）、次要說明 |
| `--color-border` | `#E5E7EB` | 分隔線、卡片/表單邊框 |
| `--color-accent` | `#2563EB` | 連結、主要按鈕、focus 樣式、強調元素 |

對比度驗證（WCAG 相對亮度公式：線性化後 `L = 0.2126R + 0.7152G + 0.0722B`，
對比度 `= (L_light + 0.05) / (L_dark + 0.05)`，白色背景 `L_bg = 1.0`）：

- `--color-text-primary` (#1F2937) vs `--color-bg` (#FFFFFF)：L ≈ 0.02157 →
  對比度 ≈ **14.7:1**（遠超 AA 4.5:1，亦超過 AAA 7:1）。
- `--color-text-secondary` (#4B5563) vs `--color-bg`：L ≈ 0.08896 → 對比度
  ≈ **7.56:1**（超過 AA 4.5:1，亦超過 AAA 7:1，可安心用於 meta 文字）。
- `--color-accent` (#2563EB) 作為文字色（連結）或作為按鈕背景配白色文字
  時，與 `--color-bg`/白色文字的對比度：L ≈ 0.15330 → 對比度 ≈ **5.17:1**
  （超過 AA 4.5:1，可用於一般大小文字，不僅限大字）。
- `--color-border` 不是文字色，不套用文字對比門檻；僅作為分隔線/外框，
  與背景之間達到可視覺分辨的程度即可（非強制 WCAG 條款，不在本 Story
  的可驗收範圍內）。

**如何驗證**：上述比例在設計階段以相對亮度公式手算並記錄於此（即此設計文
件），作為定案依據；後續任何新增文字顏色若要沿用既有 token 組合，不需要
重算（已驗證過的四組 token 配對本身永久有效，因為 token 值本身不可隨意更
改——改色需重開一張 Story 並重跑本驗證）。若未來新增 token 或改變既有色
值，必須用同一公式（或等效的線上 WCAG contrast checker）重新計算並記錄比
例於該次改動的設計文件/PR 描述中，不得只靠肉眼判斷。

**決策理由**：不自創一組強調色，直接採用業界常見、在 Tailwind 生態中已驗
證過可讀性的 `blue-600` (#2563EB) 作為 accent，降低「自創色值卻忘記驗證對
比度」的風險；文字主色/次色選用中性灰階（`gray-800`/`gray-600`）而非純
黑/純灰，是因為純黑 (#000000) 在大面積文字儀表板上視覺對比過硬、長時間閱
讀疲勞感較高，業界慣例（含 shadcn/ui 預設主題）普遍用偏灰黑取代純黑。

## 2. 字體

標題與內文**共用同一套系統字體堆疊**，不額外載入 web font：

```
font-family: -apple-system, "Segoe UI", "PingFang TC", "Microsoft JhengHei",
  Roboto, "Helvetica Neue", Arial, "Noto Sans TC", sans-serif;
```

**結論：不載入 web font。** 理由：(1) 主要內容是 zh-TW 文字，macOS 的
PingFang TC、Windows 的 Microsoft JhengHei 等系統字體對繁體中文的字重/字距
處理已經成熟，額外載入 Noto Sans TC 等 web font 對可讀性提升有限，卻會引入
顯著的中文字體檔案大小（CJK 字型通常數 MB 起）与 FOUT/FOIT 閃爍問題；(2)
這是企業內部工具性質的儀表板，不是強調品牌識別的行銷頁，系統字體的「地
域原生感」反而比統一品牌字更適合；(3) 不載入 web font 也不需要額外的建置
流程（字型子集化、`next/font` 設定等），降低本 Story 的技術落地複雜度，與
範圍外「不做品牌識別」的定位一致。標題與內文不分開字體家族，以字重
（font-weight）與字級（font-size）區分層級即可，避免維護兩套字體堆疊。

## 3. 字級與字重階層

| 層級 | 用途 | font-size | line-height | font-weight |
|---|---|---|---|---|
| 主標題 (H1) | 頁面/區塊主標題 | 24px | 32px | 700 |
| 次標題 (H2) | 卡片/區段標題 | 18px | 26px | 600 |
| 內文 (Body) | 一般內容文字、表格內容 | 14px | 22px | 400 |
| 輔助文字 (Meta) | 時間戳、說明文字、單位標註 | 12px | 18px | 400 |

決策理由：內文採 14px 而非常見網頁的 16px，是因為 B2B 數據儀表板的內容密
度需求優先於單頁易讀性（業界慣例，如 shadcn/ui 預設元件庫文字尺度即以
14px 為 base）；Meta 層級統一套用 `--color-text-secondary`（見色彩章節），
不額外定義獨立顏色 token，避免 token 數量膨脹。

## 4. 間距 Scale

以 **4px 為基準**的固定倍數 token，所有 `padding`/`margin`/`gap` 只能取用
下列值，**禁止魔術數字**（任何不在此列表中的間距值視為違反規範，Code
Review 應攔下）：

`4px, 8px, 12px, 16px, 24px, 32px, 48px, 64px`

（對應 Tailwind 既有的 spacing scale `1, 2, 3, 4, 6, 8, 12, 16`，不需要
自訂 Tailwind spacing 設定，直接使用 Tailwind 內建類別即可——見技術落地
方式章節。）

## 5. RWD 斷點

採用業界標準、且與 Tailwind CSS 預設值完全一致的斷點（原創定案，本 repo
目前無任何既有前端頁面可供沿用，故不適用「先查現有斷點沿用」的情境）：

| 名稱 | 寬度下限 | 對應裝置 |
|---|---|---|
| `sm` | 640px | 手機（橫向）/小型平板 |
| `md` | 768px | 平板 |
| `lg` | 1024px | 桌機（小） |
| `xl` | 1280px | 桌機（大）/寬螢幕 |

決策理由：直接採用 Tailwind CSS 的預設斷點值，而非自創一組數字——這樣可
以完全使用 Tailwind 內建的 `sm:`/`md:`/`lg:`/`xl:` 前綴，不需要修改
`tailwind.config` 的 `screens`，降低設定檔與本規範不同步的風險。

## 6. 對齊規則

- 標題（H1/H2）：**靠左對齊**。不置中——企業儀表板慣例是內容由左至右依
  視覺層級閱讀，置中標題在資料密集頁面上會打斷掃視節奏。
- Meta（輔助文字）：**靠左對齊**，緊接在對應標題或內容下方/旁側，不獨立
  置中或靠右（除非是表格中的數值欄位，數值欄位靠右對齊以利比較大小——
  這是數值欄位的慣例，不是本節「meta 文字」規則的例外）。
- 內文：**靠左對齊，不使用左右對齊（justify）**。中文排版下 justify 會在
  詞與詞之間插入不均勻空白，可讀性反而下降，zh-TW 內容一律靠左。

## 7. 元件規則

- **連結**：顏色 `--color-accent`，預設不加底線；`:hover` 時加底線；
  `:focus-visible` 套用章節 8 的 focus 樣式。
- **按鈕**：
  - Primary：背景 `--color-accent`、文字白色、`:hover` 背景加深
    （可用 `color-mix` 或固定的深一階 accent 色，實作階段自行決定具體
     hover 色值，不在本規範強制單一色號）、圓角與 padding 取自間距
     scale（例如水平 16px、垂直 8px）。
  - Secondary：背景 `--color-bg`、文字 `--color-text-primary`、邊框
    `--color-border`，`:hover` 背景改為極淺灰（不新增 token，可用
    Tailwind `gray-50` 等既有色階，因為這是互動狀態微調而非規範定義的
    語意色）。
  - Disabled：`opacity: 0.5` 且 `cursor: not-allowed`，不可僅用顏色變化
    表示停用（必須同時不可點擊/游標樣式改變），避免色弱使用者誤判。
- **表單欄位**：邊框 `--color-border`、圓角、padding 取自間距 scale；
  `:focus` 套用章節 8 的 focus 樣式；每個欄位必須有對應 `<label>`（見章節
  8，無障礙要求）。
- **卡片/列表項**：邊框 `--color-border`、圓角、內距至少 16px（間距
  scale 中的一檔），卡片之間間隔 16px 或 24px。
- **導覽列**：背景 `--color-bg`、底部邊框 `--color-border`、固定於頁面
  頂部（sticky），不使用陰影取代邊框（避免與卡片陰影風格混淆，整份規範
  只用邊框表達分隔，不混用陰影語言）。

## 8. 無障礙基本要求

至少涵蓋色彩對比、表單 label、可見的 focus 樣式、必填欄位不能只靠顏色標
示這幾項——這幾項本身可機器檢查，適合直接當驗收條件：

1. **色彩對比下限**：所有文字與其背景的對比度須 ≥ **4.5:1**（WCAG AA，
   一般文字）；本規範定義的四組色彩 token 配對已於章節 1 驗證全數達標。
2. **表單 label 規則**：每個表單輸入元件（input/select/textarea）必須有
   語意上關聯的 `<label>`（`for`/`id` 對應，或 `<label>` 包裹），**不可**
   僅用 `placeholder` 取代 label。
3. **可見 focus 樣式**：所有可互動元素（連結、按鈕、表單欄位、可點擊卡
   片）的 `:focus-visible` 必須顯示明確可見樣式——統一規則：
   `outline: 2px solid var(--color-accent); outline-offset: 2px;`，**不得**
   用 `outline: none` 移除瀏覽器預設 focus 樣式而不提供替代樣式。
4. **必填欄位不可僅靠顏色標示**：必填欄位除了（可選的）顏色標示外，必須
   同時有明確文字/符號標示（例如欄位標籤後加 `*` 並在表單說明區標注
   「`*` 為必填」，或直接在 label 文字中寫「（必填）」），不可只靠紅色邊
   框或紅色星號顏色單獨表示必填。

## 9. 技術落地方式

**機制**：單一共用的 CSS 自訂屬性檔案 **`frontend/app/globals.css`**，在
`:root` 中定義章節 1 的五個色彩 token、以及字級/間距若需要以 CSS 變數暴露
的部分（間距與斷點優先直接使用 Tailwind 內建 scale，不需要額外包裝成
CSS 變數——見下方理由）。

```css
:root {
  --color-bg: #FFFFFF;
  --color-text-primary: #1F2937;
  --color-text-secondary: #4B5563;
  --color-border: #E5E7EB;
  --color-accent: #2563EB;
}
```

**Next.js + Tailwind + shadcn/ui 如何消費**：

- `tailwind.config.ts` 的 `theme.extend.colors` 把本規範的 token 對應成
  Tailwind 色彩工具類別，例如：
  ```ts
  colors: {
    bg: "var(--color-bg)",
    "text-primary": "var(--color-text-primary)",
    "text-secondary": "var(--color-text-secondary)",
    border: "var(--color-border)",
    accent: "var(--color-accent)",
  }
  ```
  使開發者可以直接寫 `bg-bg`、`text-text-primary`、`border-border`、
  `text-accent` 等 Tailwind 類別，而不必在元件裡手寫 `style={{ color:
  "var(--color-text-primary)" }}`。
- **shadcn/ui 慣例對齊**：shadcn/ui 產生的元件本身預設消費一組它自己命
  名的語意 CSS 變數（`--background`/`--foreground`/`--muted-foreground`/
  `--border`/`--primary` 等）。決策：**`globals.css` 中的五個
  `--color-*` token 是唯一的色彩真實來源（single source of truth）**，
  shadcn 的語意變數在同一個 `:root` 區塊內以別名方式指向它們，不另外手
  填一組獨立色值：
  ```css
  :root {
    --background: var(--color-bg);
    --foreground: var(--color-text-primary);
    --muted-foreground: var(--color-text-secondary);
    --border: var(--color-border);
    --primary: var(--color-accent);
    --primary-foreground: #FFFFFF;
  }
  ```
  這樣 shadcn 產生的元件（不需修改其原始碼）與本規範手寫的 Tailwind 類別
  永遠同步，只有一處需要改色值。
- 間距與斷點**不**包裝成 CSS 變數，直接使用 Tailwind 內建的 spacing/
  screens scale（章節 4、5 已說明兩者與 Tailwind 預設值一致或可直接對
  應），減少一層不必要的間接。

**決策理由**：CSS 自訂屬性 + Tailwind theme 對應，是 shadcn/ui 官方文件
本身推薦、且該函式庫產生的元件已經預設依賴的機制（`npx shadcn-ui init`
產生的 `globals.css` 就是這個形狀）——選擇與 shadcn 既有慣例對齊、而不是
另外發明一套互相獨立的 token 系統，可以避免兩套色彩系統互相漂移的風險，
也讓未來任何一張 Story 若用到 shadcn 元件都不需要額外改色。

**檔案路徑決策**：`frontend/` 作為新 Next.js 專案的頂層目錄名稱（與既有
`seed/`、`bff/` 並列的第三個頂層套件），理由是本 repo 目前尚未建立任何
前端程式碼或 Next.js 專案骨架（`project-profile.yaml` 的 stack 僅宣告
Python），本 Story 範圍外不建立該骨架，此路徑僅為**未來建立骨架時的命名
約定**，供第一個真正建立 Next.js 專案的 Story 直接採用，避免該 Story 需
要重新決定目錄命名。若該 Story 執行時發現命名另有限制（例如部署腳本已假
設其他名稱），可在該 Story 自己的設計文件中覆寫並說明理由，不需要回頭修
改本文件。

## 10. 套用範圍策略

**只套用在新開的 UI Story，或既有頁面被某張 Story 觸碰到時才套用，不回溯
套用到未被觸碰的既有頁面。** 理由：(1) 規格本身已把「既有頁面的回溯套用」
列為範圍外，這是規格給定的邊界，不是本設計自行放寬；(2) 本 repo 目前沒有
任何既有前端頁面（純 Python 專案），所以在本 Story 的時間點，這個策略實
際上沒有任何既有頁面需要排除——此處明文定案是為了讓**未來**出現既有頁面
後，後續 UI Story 不需要各自重新決定「要不要先去改舊頁面」，而是直接依此
策略：若該 Story 本來就會修改到某個既有頁面的程式碼，才在那次修改中一併
套用新規範；否則不主動為了套規範而開一張「重構全站 UI」的獨立 Story，避
免範圍不受控的大改動。

## 11. 資料視覺化

多序列圖表（例如折線圖、長條圖）使用的分類色票（categorical palette），
定義如下表：

| 順位 | 色相 | Hex |
|---|---|---|
| 1 | 藍 | `#2a78d6` |
| 2 | 橘 | `#eb6834` |
| 3 | 青綠 | `#1baf7a` |
| 4 | 黃 | `#eda100` |
| 5 | 洋紅 | `#e87ba4` |
| 6 | 綠 | `#008300` |
| 7 | 紫 | `#6250d6` |
| 8 | 紅 | `#e34948` |

**固定順位，不可循環使用／不可重新排序**：上表順位一經定案即固定，新增
圖表不可為了「比較好看」調換色票的順位組合。**任何圖表的第 N 個資料序
列固定對應色票第 N 個順位**（第 1 個序列用順位 1、第 2 個序列用順位
2，依此類推）。**新增圖表前必須先查本章節，不可自行選色**——任何需要
分類色票的新圖表元件，必須從本表依順位取色，不可另外發明色值。

**使用限制**：前 3 色（順位 1～3）在任意組合下皆通過色盲安全驗證
（deuteranopia 模擬 + OKLab 色差，相鄰 ΔE ≥ 8）；超過 3 色時，必須同時
搭配圖例文字或資料標籤輔助辨識，不可純靠顏色分辨不同序列。

**色盲安全驗證**（deuteranopia／紅綠色盲模擬，OKLab 色差公式，sRGB →
linear RGB → deuteranopia 模擬矩陣 → OKLab → 歐幾里得距離 ΔE）：相鄰順
位兩兩 ΔE 皆 ≥ 8（含順位 1-2、2-3、3-4、4-5、5-6、6-7、7-8 共 7 組），
其中順位 1、2、3 任意兩兩組合（1-2、1-3、2-3）亦皆 ≥ 8，驗證已於本 Story
定稿前完成並確認全數達標。

### 11.1 圖表軸線與格線

**X 軸標籤密度規則**：X 軸日期標籤只在固定日期陣列的頭（index 0）與尾
（最後一個 index）顯示，兩者永遠顯示；當日期數量達 3 筆以上時，額外最
多再加 1 個中間點標籤（例如 7 天日期軸取 `[0, 3, 6]`），不可再增加更多
中間標籤，避免標籤彼此重疊、難以閱讀。

**格線顏色規則**：圖表格線一律使用 `--color-border`，且此顏色必須與
本章節第 11 節定義的 8 色分類色票（categorical palette）在視覺上保持
明顯區隔——格線是座標參考線，不是資料序列，不可讓使用者誤認格線為某
條資料線。

**疊圖順序規則**：格線必須在 SVG 中先於資料折線（`<polyline>` 等）渲染，
使其在視覺堆疊順序上位於資料線之後方（底層），確保格線不會蓋住或干擾
任何資料線的辨識。

### 11.2 直接標籤

**直接標籤 vs 圖例的選用門檻**：資料序列數 ≤ 4 時優先使用線條終點直接
標籤（版本/序列名稱＋對應數值），並移除另一排圖例色點＋文字；序列數
> 4 時直接標籤互相重疊風險高，退回純圖例顯示。兩者是互斥的二選一，不
嘗試同時顯示直接標籤與圖例。

**標籤顏色規則**：直接標籤文字顏色採該序列本身的色票顏色（本章節第
11 節定義的分類色票，與該序列的 `<polyline>` 同一色值），而非中性說明
文字色（如 `--color-text-secondary`）——延續「顏色 ↔ 序列」的視覺對應，
取代圖例原本靠色點＋文字建立的同一對應關係，不需要使用者另外查色票。

**標籤定位規則**：直接標籤的文字錨點方向依該標籤所在位置與繪圖區水平
中點（`CHART_PADDING + innerWidth / 2`）的左右關係決定——落在中點左半
用 `start`、右半用 `end`，並往有空間的一側位移（遠離繪圖區邊界），避
免被 viewBox 邊緣裁切；判斷依據是標籤的實際座標位置，不是固定的陣列
索引（因為選擇性直接標籤只標該序列最後一個有值的資料點，未必是陣列
最後一個索引）。
