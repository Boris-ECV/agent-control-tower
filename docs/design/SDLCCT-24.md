# 設計文件 — SDLCCT-24 Unit-test client.py 的純邏輯函式與必填環境變數契約

## 對應需求規格
對應 G1 已核准的需求規格:為 `seed/client.py` 的三個純邏輯函式
(`iso()`、`uuid7_at()`、`load_prices()`)與 `base_url()` 的必填環境變數
契約補上單元測試覆蓋,涵蓋全部 6 條 Gherkin AC:
1. `iso()` 將帶時區的 datetime 轉為毫秒精度、`Z` 結尾的 UTC ISO8601 字串,
   且可用 `fromisoformat` 解析回等值 UTC datetime。
2. `uuid7_at()` 依傳入時間遞增產生可字典排序的字串(時間差 >= 1ms 時字典
   序遞增),需重複多組隨機時間配對驗證,不因隨機位元翻轉。
3. `load_prices()` 正確解析 `model_prices.snapshot.json`,回傳的區間型別
   為 `Decimal` 非 `float`。
4. `base_url()` 在 `OPIK_BASE_URL` 未設定時以 `SystemExit` 失敗,且不送出
   任何網路請求。
5. `base_url()` 在 `OPIK_BASE_URL` 為空字串或僅含空白時同樣以 `SystemExit`
   失敗。
6. `base_url()` 在設定有效值時原樣回傳(去除尾端斜線)。

範圍外(維持 G1 核准,不擴大):不修改 `seed/generate.py` 情境內容;不涉及
Portal/BFF/Agent 清冊資料庫;不涉及伺服器或部署;不測試 `api()`(薄組合,
測它等同重複測 `base_url()`);不處理 `save()`/`load()`/`project_ids()`。
coverage omit 清單異動屬本票產出的一部分,見下方「關鍵技術決策」。

## 介面/API 契約
無。本 Story 只新增測試檔案,不新增、不變更 `seed/client.py` 任何函式的
簽名或行為,也不新增對外 HTTP 介面。

## 資料模型
無新增資料模型。`seed/model_prices.snapshot.json` 內容維持現狀不變(依
spec 的依賴假設:該檔案內容保持穩定),測試直接讀取真實檔案,不另造 fixture
取代它。

## 關鍵技術決策

- **新增測試檔案 `seed/tests/test_client.py`**——沿用既有命名慣例
  (`test_anchor.py` 測 `anchor.py`、`test_registry.py` 測
  `registry.py`、`test_generate_guard.py` 測 `generate.py`);本檔案專測
  `client.py` 這四個函式,與間接經由 `test_registry.py`
  (`client.save`)、`test_generate_guard.py`(`client.OUT_DIR`)用到
  `client.py` 其他屬性的既有測試職責互不重疊。

- **`iso()`:用固定的帶時區 datetime 字面值斷言,再做 round-trip 驗證,
  不額外 mock `datetime.now()`**——沿用 spec 給的範例值
  `datetime(2024, 1, 15, 10, 30, 0, 123456, tzinfo=timezone(timedelta(hours=9)))`
  斷言 `iso(ts) == "2024-01-15T01:30:00.123Z"`。用
  `datetime.timezone(timedelta(hours=9))` 而不是 `zoneinfo.ZoneInfo`,
  因為 `client.py` 本身的 `iso()` 實作(`ts.astimezone(UTC).isoformat(...)`)
  只依賴 `tzinfo` 提供正確的 utcoffset,不依賴時區資料庫,用標準函式庫
  `timezone` 建構子即可重現範例,不必額外依賴系統 tzdata。Round-trip 驗
  證用 `datetime.fromisoformat(result)`(Python 3.12 的 `fromisoformat`
  原生支援 `Z` 尾碼,不需要先手動替換成 `+00:00`),斷言解析回來的值等於
  `ts.astimezone(UTC)` 截斷到毫秒後的值(`iso()` 本身會丟失微秒精度,
  round-trip 比較對象必須是「截斷後」的 UTC 值,否則會因為多出的
  `456` 微秒誤判失敗)。

- **`uuid7_at()` 的遞增驗證:用固定種子的 `random.Random` 產生多組隨機
  時間配對,時間差 >= 2ms(不是剛好 1ms),完全不 monkeypatch
  `os.urandom`**——讀過實作後確認:整數編碼是
  `(ms << 80) | (0x7 << 76) | (rand_a << 64) | (0b10 << 62) | rand_b`,
  其中 `ms` 佔據最高的 80 位以上(左移 80 位),而所有隨機位元
  (`rand_a`、`rand_b`,各自 <= 76 位)的總貢獻值必定小於 `1 << 80`。因此
  只要 `ms2 > ms1`(嚴格大於),則無論 `rand_a`/`rand_b` 任意翻轉,
  `int2 > int1` 必成立;`str(uuid.UUID(int=...))` 輸出固定 32 個十六進
  位字元(含前導零,寬度不隨數值大小變化),十六進位字串的逐字元比較與
  底層整數大小比較結果一致,因此字典序遞增等同整數遞增——這證實了 AC2
  「隨機位元翻轉不影響排序」的前提,不需要為了讓測試「看起來確定性」而
  去 monkeypatch `os.urandom`,保留真隨機反而更貼近 AC2「不因隨機位元翻
  轉」的驗證意圖。選擇 **>= 2ms** 而非 spec 範例的剛好 1ms 作為測試用時
  間差,是為了避開 `ms = int(ts.timestamp() * 1000)` 這一行潛在的浮點數
  截斷邊界問題(兩個理論上剛好差 1ms 的 datetime,因 `timestamp()` 回傳
  float 的精度限制,相減後可能落在截斷邊界兩側而使 `ms2 - ms1` 變成 0 或
  負值,造成測試間歇性失敗);2ms 的差距在 double 精度下有足夠安全餘裕,
  仍完整滿足 AC2「至少 1 毫秒」的更寬鬆情境,不是放寬驗證範圍。用固定種
  子(例如 `random.Random(20241024)`)產生 50 組 `(ts1, gap_ms)` 做
  `pytest.mark.parametrize`,讓失敗時的 case id 可重現、可定位,而不是
  每次執行结果不同的真隨機測試輸入。

- **`load_prices()`:直接讀真實的 `model_prices.snapshot.json`,用 spec
  給的範例值斷言,並明確斷言回傳型別是 `Decimal`**——不另造假價格表
  fixture,因為 spec 的依賴假設已明確該檔案內容穩定,且
  `test_preflight_pricing.py`(SDLCCT-26)已經建立「直接讀真實快照檔」
  的先例,風格一致。除了數值相等(`== Decimal("0.000003")` /
  `== Decimal("0.000015")`)之外,額外用 `isinstance(..., Decimal)` 斷
  言型別,直接對應 AC3「型別為 Decimal 非 float」這句話本身要防的回歸
  (例如未來不小心把 `parse_float=Decimal` 改掉或漏傳)。

- **`base_url()` 的環境變數隔離:一律用 `monkeypatch.setenv`/
  `monkeypatch.delenv(..., raising=False)`,不手動存回/還原**——
  pytest 的 `monkeypatch` fixture 在每個測試函式結束後自動還原环境變數,
  不會洩漏到下一個測試或汙染開發機/CI 上可能已經設定的真實
  `OPIK_BASE_URL`;沿用 `test_anchor.py` 對 `DEMO_ANCHOR_DATE` 的既有慣
  例(`monkeypatch.delenv(..., raising=False)` 處理「未設定」情境,
  `monkeypatch.setenv(...)` 處理「設定為某值」情境)。AC5 的「空字串或
  僅含空白」用 `@pytest.mark.parametrize("value", ["", "   ", "\t\n"])`
  覆蓋,對應實作裡 `.strip()` 的判斷邏輯。

- **AC4「不送出任何請求」除了結構性論證,額外加一道主動斷言,防止未來
  重構意外引入網路呼叫**——`base_url()` 本身完全沒有 I/O(只有環境變數
  讀取、字串處理與 `raise`),所以單純「只呼叫 `base_url()`,不呼叫
  `api()`」已經結構性保證不會送出請求。為了讓這個保證可被測試本身驗
  證、而不只是靠人工讀程式碼論證,額外在未設定/空字串兩個測試裡
  `monkeypatch.setattr(client.httpx, "Client", lambda *a, **kw: (_ for _ in ()).throw(AssertionError("must not construct httpx.Client")))`,
  確保就算未來有人不小心在 `base_url()` 裡加了一行提早呼叫 `api()`/
  建立 `httpx.Client` 的程式碼,測試會立刻用明確的 `AssertionError` 失
  敗,而不是沉默通過。

- **coverage omit 清單:把 `"client.py"` 從 `seed/pyproject.toml` 的
  `[tool.coverage.run] omit` 移除,`save()`/`load()`/`project_ids()`/
  `api()` 維持不另加 `# pragma: no cover`,不特別處理**——spec 本身把
  「若覆蓋率足夠就移除」當成本票明確要做的事,而不是留給開發者自行判
  斷的開放問題。決策是整檔移除(不是用行級 pragma 做部分豁免),理由:
  (1) `coverage.run.omit` 是檔案層級設定,client.py 裡新增測試覆蓋的四
  個函式之後,檔案本身已經有實質覆蓋率,沒有理由整檔排除;(2) 仍未測
  的 `save()`/`load()`/`project_ids()`/`api()` 合計不到 15 行可執行陳
  述,相對於這個 repo 已有高覆蓋率的 `anchor.py`/`registry.py`/
  `catalog.py`/`generate.py`,佔整體陳述數比例極小,不足以把 CI 既有
  `--cov-fail-under=60`(見 `.github/workflows/ci.yml`)拉破;(3) 不引
  入這個 repo 目前沒有先例的「行級 pragma: no cover」寫法,維持跟既有
  `omit` 清單(`verify.py`、`preflight.py`、`ingest.py`,理由同是「打真
  實後端、手動驗證」)一致的「整檔決定納入或排除」慣例——`client.py` 裡
  仍未測的 I/O 函式之後若要補測試覆蓋,是未來故事的範圍,不是本票要解
  決的。開發者實作完測試後,務必實跑一次
  `uv run pytest --cov --cov-report=term-missing --cov-fail-under=60 -q`
  確認門檻仍過;若實測結果不如預期(低於 60),那是機械式數字結果,不
  是本設計要事先猜測的產品決策,開發者可直接依 term-missing 報告調整
  (例如視情況再補一兩個簡單 smoke test),不需要回頭改這份設計文件。

## UI 原型
無,本 Story 不涉及前端 UI(純 `seed/` 底下 Python 單元測試,不涉及任何
畫面、元件或樣式;也不存在任何跨元素樣式耦合測試需要檢查,本 repo 目前
沒有前端畫面可比對)。

## 開放設計問題(定稿時必須為空)
(無)
