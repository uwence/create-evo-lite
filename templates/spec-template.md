# <Feature>

> 复制本文件到 `docs/specs/<slug>.md`，删掉这段引用，然后从 Goal 开始写。
> **硬上限 120 行。** 超了不是告警，是「这个 spec 需要拆」的判据。

## Goal

一句话说清要解决什么问题，再加一句可验收的判据。

不要写背景综述。下一个 agent 需要的是「做完之后世界有什么不同」，不是这个问题的来历。

## Non-goals

明确不做什么。写下来是为了防止下一个 agent 顺手扩张范围——这是 spec 里最省事的一段，也是最容易被省略的一段。

## Design

怎么做。

没有证据的前提用 `Assumed` 显式记录并缩小范围，**不要升级成 `Blocked`**：

```text
ASSUMPTION  <没有证据支持的前提>
ACTION      <因此本版本把范围缩小到什么程度>
STATUS      Not blocked.
```

四个状态互不等价：`Known`（有证据）/ `Assumed`（无证据，缩小范围后继续）/ `Unknown`（未知，不阻塞）/ `Blocked`。

只有不可逆操作、安全、数据破坏、兼容性才写 `Blocked`。「还没想清楚」不是 Blocked，是 Unknown。

## Acceptance Criteria

可勾选的事实，不是感受。能被另一个人在不读本 spec 的情况下独立判定真假：

- [ ] fresh install works
- [ ] existing project isn't overwritten
- [ ] Windows works
- [ ] 本 spec 自身 <= 120 行

## Open Questions

还没定的事。留在这里比假装已定更安全——被写下来的未知不会变成 blocker，被藏起来的会。
