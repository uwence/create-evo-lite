# Zvec Opt-In 决策指南（子巢版）

evo-lite 的记忆引擎默认**选择** `zvec`（jieba 中文分词 FTS），但引擎能否真正运行取决于本项目是否安装了 `@zvec/zvec`。未安装时自动回落 `sqlite-fts5-trigram`（trigram 分词），verify/rebuild 会打印 `⚠️ [引擎降级]` — 回落是安全的，不丢数据，只是检索质量走 trigram 而非 jieba。

装不装依赖是**子巢 owner 的决定**，母巢 nurture 永远不会替你安装依赖或改写引擎状态。

## 何时应该 opt-in zvec

满足越多越值得：

- 记忆档案以**中文散文**为主（jieba 分词对中文 recall 明显优于 trigram）
- `raw_memory/` 记录数已上量（几十条以上），检索排序质量开始影响 takeover 效率
- 项目环境允许新增一个 npm 依赖（zvec 带原生组件与磁盘占用）

## 何时留在 sqlite

- 档案很小（个位数记录），trigram 足够
- 环境不便安装原生依赖（CI 沙箱、离线机器）
- 曾因引擎迁移出过状态事故、希望显式锁定（用 pin，见下）

## Opt-in 三步

```bash
cd .evo-lite && npm i @zvec/zvec        # ① 装依赖（装在 .evo-lite/ 内）
# ② 如存在 .evo-lite/memory-engine.json 的 sqlite pin，删除该文件（或改 engine 字段为 zvec）
node ./cli/memory.js rebuild            # ③ 从 raw_memory 重建索引（或 mem rebuild）
```

## Opt-in 后的验证（必做）

1. `mem verify` — 引擎行应显示 `zvec-jieba-fts`，且**不再出现** `⚠️ [引擎降级]`
2. 记录数不变 — verify 的 [记忆空间分布] records 数应与 rebuild 前一致（N 条档案 → N 条记录，绝不能翻倍）
3. `mem memory-ab` — 离线 A/B 对比 SQLite 与 Zvec 在本项目档案上的 recall 表现；zvec 不占优就没必要留

## 回滚

```bash
# 写 pin 并重建，回到 trigram：
echo '{"engine":"sqlite-fts5-trigram"}' > .evo-lite/memory-engine.json
node ./.evo-lite/cli/memory.js rebuild
```

## Pin 语义

`.evo-lite/memory-engine.json` 是**子巢自有状态**（不是基因，nurture 不会碰它）：

- 无 pin → 跟随默认选择（zvec），依赖缺失时可见降级回落
- pin sqlite → 显式锁定 trigram，不再打降级 WARN，rebuild 幂等
- pin 属于"每子巢一份"的策展决定，换引擎永远要跟一次 `rebuild`

有本指南没覆盖的引擎摩擦？按 [hive-feedback.md](hive-feedback.md) 协议写进 `.evo-lite/hive/feedback.md` 上报母巢。
