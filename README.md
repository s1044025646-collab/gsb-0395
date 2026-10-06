# Kendall 逆序距离与相邻交换见证后端

纯后端服务（HTTP API + CLI），输入**同一组唯一字符串编号**组成的两个有序列表，计算把第一份顺序变成第二份所需的**最少相邻交换次数**，即两份全排列之间的 **Kendall 逆序距离**（Kendall tau distance）。

- 运行时：Node.js（≥ 22.5，使用内置实验模块 `node:sqlite`，无需原生编译）
- 语言：TypeScript（ESM，`strict`）
- 存储：项目内 SQLite 文件（`data/kendall.db`），WAL 模式
- 不依赖 Docker、WSL、付费服务或任何在线 API

## 这是什么 / 不是什么

- 编号只作为**身份标识**，不按字符串字典序代表名次；“甲/乙”“uuid-1”都可以。
- 先把第一份列表的每个元素映射为它在第二份列表中的位置（一个 `0..n-1` 的排列），再计算该排列的**逆序对数量**。一个元素对在两份顺序中先后相反才计一次。
- 自行实现的**自底向上归并排序计数**（`src/distance.ts`），复杂度 O(n log n)；计数使用 `BigInt`，API/CLI 以**十进制字符串**返回。
- **不是**每个元素位移绝对值之和（那是错的：`[A,B,C]→[B,C,A]` 位移绝对值和为 4，正确距离为 2）。
- **不是**任意位置交换次数（任意交换 ≤ 逆序距离，二者不同）。
- **不处理**并列排名、不同集合之间的编辑距离、缺失元素自动补齐或推荐模型训练。
- 重复编号、缺项、额外项、两份长度不同一律拒绝（错误码 `DUPLICATE_ID` / `SET_MISMATCH`），失败不会写入或覆盖任何已有分析。
- 空列表与单元素距离为 0；`n < 2` 时归一化距离按公开约定返回 `"0"`。

### 与 Kendall 相关系数（Kendall's tau）的区别

- 本服务返回的是 **tau 距离（逆序对绝对个数）**：取值范围 `0 .. C(n,2) = n(n-1)/2`，越大表示两份顺序差异越大。
- 常见的 **Kendall tau 相关系数**是归一化的有符号统计量，取值 `[-1, 1]`（无并列时为 `(同序对数 - 逆序对数)/C(n,2) = 1 - 2×归一化距离`），衡量的是相关性方向与强度。
- 本服务同时给出**归一化距离** `逆序数 / C(n,2)`（范围 `[0,1]`，仅展示，固定 10 位小数截断），但**原始整数计数始终完整保留**为十进制字符串。不要把归一化展示值当作正式结果回传后再换算。

## 大输入限制

| 限制项 | 默认值 | 说明 |
| --- | --- | --- |
| 元素个数上限 | 100 000 | 超出报 `VALIDATION_ERROR` |
| 编号长度上限 | 200 字符 | 空编号拒绝 |
| 逆序证据预算 | 默认 20，最大 1000 | 只影响展示的例子数量，不影响总计数 |
| 见证生成阈值 | n ≤ 50 | 超过 50 个元素**只报告距离，明确不展开见证** |
| 请求体大小 | 5 MB | HTTP API |

逆序对例子（证据）附两份列表中的 1 基位置；证据可能因预算截断（`evidenceTruncated: true`），但总距离绝不少算。大输入不会返回截短前缀却声称已变成目标排列：见证字段带 `omitted: true` 和原因，`steps` 为空。

## 最短相邻交换见证

对 `n ≤ 50` 生成一条**确定**的最短见证：按目标顺序从左到右，把当前所需元素通过相邻交换冒泡到当前位置（selection-by-adjacent-swaps）。每一步记录：

- `index`：发生交换的左侧下标（0 基，即交换 `index` 与 `index+1`）
- `idLeft` / `idRight`：交换完成后左、右位置上的编号
- `fixedPrefix`：交换后已经固定的前缀

交换步数**恰好等于逆序距离**。独立核验接口逐步重放，遇到越界下标、非相邻交换（跳位）、编号与当前排列不符、终态不等于目标都会拒绝（`INVALID_WITNESS`）。

例：`[A,B,C] → [B,C,A]`，距离 2：第 1 步交换 A 与 B（`[A,B,C]→[B,A,C]`），第 2 步交换 A 与 C（`[B,A,C]→[B,C,A]`）。
反序 `n` 个元素距离恒为 `n(n-1)/2`。

## 快速开始（Windows / PowerShell）

```powershell
node --version          # 需要 v22.5.0 或更新（开发环境为 v25.5.0）
npm install
npm run build           # tsc 编译到 dist/
npm test                # 编译 + node:test 全部测试
npm run demo            # 内置演示（含中文编号、错误拒绝、n=100000 大输入）
npm start               # 启动 HTTP API；默认端口 0 = 自动选择空闲端口，启动日志打印实际端口
```

可配置端口与数据目录：

```powershell
$env:PORT="8080"        # 固定端口；不设置或 0 表示选择空闲端口
$env:DATA_DIR="data"    # SQLite 存放目录（默认项目内 ./data）
npm start
```

## CLI

```powershell
node dist/cli.js serve --port 8080
node dist/cli.js snapshot '名单甲=["A","B","C"]'
node dist/cli.js distance '["A","B","C"]' '["B","C","A"]' --evidence 10
node dist/cli.js distance 'A,B,C' 'B,C,A'                      # 逗号分隔也可以
node dist/cli.js list
node dist/cli.js get <reportId>
node dist/cli.js mapping <reportId>
node dist/cli.js evidence <reportId>
node dist/cli.js witness <reportId>
node dist/cli.js compare <reportIdA> <reportIdB>
node dist/cli.js verify '["A","B","C"]' '["B","C","A"]' witness.json
node dist/cli.js export <reportId> --out report.json
node dist/cli.js demo
```

## HTTP API

所有响应为 JSON；错误统一形如 `{"error":{"code","message","details"}}`。

| 方法与路径 | 说明 |
| --- | --- |
| `GET /health` | 健康检查与当前限制 |
| `POST /snapshots` | 创建顺序快照 `{name, items}` |
| `GET /snapshots/:id` | 查看快照 |
| `POST /reports` | 计算并持久化报告 `{from:{name,items}, to:{name,items}, evidenceBudget?}` |
| `GET /reports` | 报告版本列表 |
| `GET /reports/:id` | 完整报告（含映射、证据、见证） |
| `GET /reports/:id/mapping` | 仅目标位置映射 |
| `GET /reports/:id/evidence` | 仅逆序例子 + 总计数 |
| `GET /reports/:id/witness` | 仅相邻交换见证 |
| `GET /reports/:id/export` | 导出完整报告 JSON（附件下载） |
| `POST /reports/compare` | 比较两个版本 `{reportIdA, reportIdB}` |
| `POST /witness/verify` | 独立重放核验 `{from:{items}, to:{items}, steps}` |

### 示例

```powershell
$body = '{"from":{"name":"原始","items":["A","B","C"]},"to":{"name":"目标","items":["B","C","A"]}}'
Invoke-RestMethod -Uri http://localhost:8080/reports -Method Post -ContentType 'application/json' -Body $body
```

响应关键字段：

```json
{
  "reportId": "uuid",
  "algoVersion": "kendall-inversions-mergecount/v1",
  "n": 3,
  "mapping": [
    {"id": "A", "fromPosition": 1, "toPosition": 3},
    {"id": "B", "fromPosition": 2, "toPosition": 1},
    {"id": "C", "fromPosition": 3, "toPosition": 2}
  ],
  "totalPairs": "3",
  "inversions": "2",
  "normalized": "0.6666666666",
  "evidence": [
    {"idA": "A", "idB": "B", "fromPositionA": 1, "fromPositionB": 2, "toPositionA": 3, "toPositionB": 1}
  ],
  "evidenceTruncated": false,
  "witness": { "generated": true, "omitted": false, "steps": [ {"step": 1, "index": 0, "idLeft": "B", "idRight": "A", "fixedPrefix": []} ] }
}
```

## 错误码

| code | HTTP | 含义 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | 非数组、非字符串、空编号、超长、超数量、预算非法 |
| `DUPLICATE_ID` | 400 | 任一列表内编号重复，`details` 指出重复值 |
| `SET_MISMATCH` | 400 | 长度不同或集合不同，`details.missingInFrom/extraInFrom` 指出缺项与额外项 |
| `NOT_FOUND` | 404 | 快照或报告不存在 |
| `BAD_REQUEST` | 400 | JSON 非法、参数缺失、请求体过大 |
| `INVALID_WITNESS` | 200（业务字段 `ok:false`） | 见证越界 / 非相邻 / 编号不符 / 终态不等于目标 |

## 持久化与版本语义

- `snapshots` 保存列表；`reports` 保存两份列表快照、编号口径（原样字符串）、算法版本、总对数、逆序数（文本大整数）、归一化值、证据与见证 JSON、创建时间。
- 修改任一顺序会产生**新的 reportId**；旧报告与旧见证始终绑定其原始输入，不会被改写。
- 重启后可完整读回大整数计数与小样本见证（有跨“重启”测试覆盖）。

## 测试覆盖

`npm test`（`src/tests/`）包含：完全相同、仅一对相邻元素交换、反序、空集、中文编号、重复项、缺项、长度不一致；固定种子小排列枚举**所有元素对**与归并计数交叉核对；见证逐步重放合法且终态等于目标；距离对称；整体重命名不变；相邻交换只改变距离 1；大整数（n=100 000 反序）与见证省略边界（n=50/51）；SQLite 持久化、HTTP 全链路与结构化错误码。

## 项目结构

```
src/
  types.ts       # 类型、算法版本、限制常量、AppError
  validate.ts    # 编号/集合校验、错误码
  distance.ts    # 归并逆序计数(BigInt)、映射、见证生成/重放、归一化、O(n²)独立核对
  db.ts          # node:sqlite 初始化与建表
  service.ts     # 快照、计算、持久化、报告读取、版本比较
  server.ts      # HTTP API
  cli.ts         # CLI 与内置演示
  tests/         # node:test
```
