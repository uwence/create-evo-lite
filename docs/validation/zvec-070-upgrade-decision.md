# @zvec/zvec 0.6 → 0.7 升级决策记录(UDR)

- 议题:`[zvec-win-unicode-containment]` 测量阶段结束之后的**裁决**阶段
- 日期:2026-09-02
- baseline:`main@99c6f87`(测量阶段收口后)
- 前序证据:Step 1 `zvec-070-win-unicode-recheck.md` · 2A `zvec-070-install-matrix.md`
  · 2B `zvec-070-adapter-contract.md` · 2C `zvec-070-nonascii-bridge.md`

```text
STAGE 1 — DECISION SUBJECT CONTRACT
本次提交冻结的是「到底在裁什么」,不是「按什么条件裁」。
所有 verdict = UNSET;GREEN / RED / required authority /
missing-authority disposition 一律 NOT WRITTEN;不读取任何证据。
```

## 0. 三阶段顺序(冻结)

```text
Stage 1   decision subjects · X → Y · subject_status · typed dependency graph
          · deliberately absent edges · verdict = UNSET · GREEN/RED = NOT WRITTEN
              ↓ COMMIT + REVIEW
Stage 2   GREEN iff · RED iff · required authority · missing-authority disposition
          · 仍然不填 verdict
              ↓ COMMIT + REVIEW
Stage 3   consume frozen evidence · fill dispositions / verdicts
```

拆成三段的理由是本轮的实际发现,不是仪式:六项的历史标签里有三项的**主语**站不住。
先冻结主语再写判据,可以保证以后即使某条 GREEN/RED 很难写,也**不能**为了迎合现有证据
回头重新定义 D3 / D5 / D6 在裁什么。

### 0.1 主语为什么必须先冻结

历史标签(`pin` / `RUNTIME_DEPENDENCIES` / `optional → mandatory` / `default flip` /
`containment` / `release`)来自已合入的 Step 2C §9。它们是**登记**,不是定义。
核对代码后,其中三项的标签所指与树里的实际状态不符或不唯一:

```text
default flip   DEFAULT_ENGINE_CHOICE 早在 2026-07-07 就已是 'zvec'
release        release-preflight 实测 VERDICT=CLEAR,blockers=0
optional→...   「optional」在本仓有三个互不相同的面(published manifest /
               scaffold runtime manifest / 加载失败回落语义)
```

对未定义的主语做 YES/NO,产生的是没有稳定语义的裁定。历史标签保留,
但**只作为历史标签**,不再充当裁定对象。

### 0.2 本轮裁决(2026-09-02,独立复审)

```text
SUBJECT_INSTANTIATION 边类型   APPROVED —— 作用于 subject_status,不得传播 verdict
D3 主语                        FROZEN —— published package manifest 的 dependency class
D4 subject_status              NOT_INSTANTIATED
D6 subject_status              NOT_INSTANTIATED,直到存在具体的 candidate change set
Stage 1 commit                 AUTHORIZED(subject contract freeze,非 criteria freeze)
Stage 2 GREEN/RED              尚未授权
verdicts                       ALL UNSET
implementation planning        FORBIDDEN
```

## 1. 六个 decision node

### 1.0 两条状态轴(冻结)

`subject_status` 与 `verdict` 是**两条独立的轴**,任何一条都不得写进另一条:

```text
subject_status:   INSTANTIATED | UNRESOLVED | NOT_INSTANTIATED
verdict:          UNSET  (Stage 3 之前不允许出现任何最终 disposition)
```

因此**不得**出现 `D4 verdict = NOT_INSTANTIATED` 这样的写法 —— 那会让 Stage 1
偷偷变成一次裁定。主语不存在时,`subject_status` 说明它,`verdict` 仍然是 `UNSET`。

字段中的 `NOT WRITTEN (Stage 2)` 是**故意留空**,不是遗漏。

---

### Decision D1

```text
historical label:    pin
decision subject:    create-evo-lite 自身 published package manifest 里声明的
                     @zvec/zvec 版本常量:该 manifest **请求 / 钉定**哪个版本。
                     **是否必须成功安装由 D3 决定** —— 当前该条目在
                     optionalDependencies 下,因此 D1 本身不保证依赖最终存在。
                     也不决定被脚手架出的子项目装什么(D2)。
subject_status:      INSTANTIATED

current state X:     package.json:13-15
                       "optionalDependencies": { "@zvec/zvec": "0.6.0" }
                     精确钉,非范围。package-lock.json 中对应条目锁在 0.6.0。

candidate state Y:   "@zvec/zvec": "0.7.0",同样精确钉。
                     Y 取精确版本而非 ^0.7.0,与本仓既有约定一致
                     (index.js:28-30「Exact-pinned … Bump these deliberately」)。
                     改为范围声明是另一个 decision subject,不在本节点内。

observable
tree/runtime delta:  package.json 一行 + package-lock.json 的 @zvec/zvec 条目
                     (version / resolved / integrity)。
                     运行时可观测面:本仓 node_modules/@zvec/zvec/package.json 的 version。

required authority:  NOT WRITTEN (Stage 2)
GREEN iff:           NOT WRITTEN (Stage 2)
RED iff:             NOT WRITTEN (Stage 2)
missing authority
disposition:         NOT WRITTEN (Stage 2)

depends on:          E4 · E6 (IMPLEMENTATION_COUPLING)
                     evidence edge:Stage 1 不实例化(§2.2)

does NOT authorize:  不改变 dependency class(D3)· 不把 zvec 送进子项目 runtime(D2)
                     · 不改 containment 的任何不变量(D5)· 不构成发布决定(D6)

verdict:             UNSET
```

---

### Decision D2

```text
historical label:    RUNTIME_DEPENDENCIES
decision subject:    被 create-evo-lite 脚手架出的**子项目** .evo-lite/package.json
                     的依赖集合。它与 D1 / D3 是不同的安装面:D1 决定版本,
                     D3 决定 published package 的 npm 依赖语义,
                     D2 决定每个被创建的项目装什么。
subject_status:      INSTANTIATED

current state X:     index.js:31-36
                       { better-sqlite3 12.11.1, tar 7.5.16,
                         commander 15.0.0, @modelcontextprotocol/sdk 1.29.0 }
                     @zvec/zvec **不在其中**。
                     该常量由治理测试 T18e(templates/cli/test/governance.js:834-848)
                     断言与 templates/runtime/package.json 的 dependencies 逐字相等。

candidate state Y:   上述集合 ∪ { "@zvec/zvec": "<version>" }。
                     <version> 的取值与 D1 是协同项(E4),不是同一个决定。

observable
tree/runtime delta:  三处必须同步,否则 T18e 变红:
                       index.js 的 RUNTIME_DEPENDENCIES
                       templates/runtime/package.json
                       templates/runtime/package-lock.json
                     运行时可观测面:新建项目的 .evo-lite/package.json 与其 node_modules。

required authority:  NOT WRITTEN (Stage 2)
GREEN iff:           NOT WRITTEN (Stage 2)
RED iff:             NOT WRITTEN (Stage 2)
missing authority
disposition:         NOT WRITTEN (Stage 2)

depends on:          E4 (IMPLEMENTATION_COUPLING)
                     evidence edge:Stage 1 不实例化(§2.2)

does NOT authorize:  不改母体自身的版本(D1)· 不改 published package 的依赖语义(D3)
                     · 不改 containment(D5)

verdict:             UNSET
```

---

### Decision D3

```text
historical label:    optional → mandatory
decision subject:    **Published-package dependency classification** ——
                     create-evo-lite 发布出去的 package manifest 对 @zvec/zvec
                     采用 optional 还是 required 的 npm 依赖语义。
                     主语于 2026-09-02 由独立复审冻结(§0.2)。
subject_status:      INSTANTIATED

current state X:     package.json:13   "optionalDependencies": { "@zvec/zvec": … }
                     npm 语义:安装失败不阻断 create-evo-lite 的安装。

candidate state Y:   同一条目移入 "dependencies",版本取值沿用该 manifest 另行选定的值
                     (即 D1 的结果;D3 自身不选版本)。

observable
tree/runtime delta:  package.json 中该条目所属的键名,以及 package-lock.json 中
                     该包的 optional/dev 标记。
                     运行时可观测面:在 zvec 安装失败的环境里
                     `npm i create-evo-lite` 本身是否失败。

**明确不属于 D3**(冻结):
                     · 把 zvec 加进 templates/runtime/package.json —— 那是 D2
                     · 把 zvec 加进 RUNTIME_DEPENDENCIES —— 那是 D2
                     · 删除 SqliteFtsIndex
                     · 删除 defaultLoadZvecIndex 的加载失败回落
                       (memory-index.js:194-198 在 require 失败时返回 null,
                        缺包不是不可恢复的 fatal condition;该语义不在本节点内)
                     · 改变 containment —— 那是 D5
                     · 改变 DEFAULT_ENGINE_CHOICE —— 见 D4

                     把上述任一项并进 D3,等于把三个不同问题
                     (dependency packaging / runtime availability / engine fallback
                     semantics)粘在一起,并会与 D5 直接相撞。冻结后的 D3 与 D5 正交。

required authority:  NOT WRITTEN (Stage 2)
GREEN iff:           NOT WRITTEN (Stage 2)
RED iff:             NOT WRITTEN (Stage 2)
missing authority
disposition:         NOT WRITTEN (Stage 2)

depends on:          E6 (IMPLEMENTATION_COUPLING)

does NOT authorize:  不决定版本(D1)· 不决定子项目装什么(D2)· 不放松 containment(D5)

verdict:             UNSET
```

---

### Decision D4

```text
historical label:    default flip
decision subject:    ——
subject_status:      NOT_INSTANTIATED

理由(事实陈述,非裁定):
  该标签指向的决策已于 2026-07-07 由 spec `memory-engine-default-flip` §A3
  执行并 shipped。树里的当前状态就是它的终态:

      memory-index.js:177      const DEFAULT_ENGINE_CHOICE = 'zvec';
      memory-index.js:183-189  仅当 .evo-lite/memory-engine.json 显式声明时才覆盖

  在 0.6 → 0.7 语境下为该标签寻找残余主语,得到三个候选,全部不成立:

    (a)「让 zvec 在 Windows 非 ASCII 路径上成为实际默认」
        —— 与 D5 是同一个主语;重复登记会让同一件事被裁两次。
    (b)「子项目的默认引擎」
        —— 子项目消费同一份 cli 镜像与同一个 DEFAULT_ENGINE_CHOICE,无独立主语。
    (c)「移除 memory-engine.json 覆盖通道」
        —— 与 0.6 → 0.7 无关,属独立议题。

  即:历史标签 `default flip` 所描述的 X → Y 已经不再存在。

current state X:     'zvec'(自 2026-07-07 起)
candidate state Y:   ——(写不出与 D5 相区分的 Y)
observable
tree/runtime delta:  ——

required authority:  N/A —— subject_status = NOT_INSTANTIATED
GREEN iff:           N/A
RED iff:             N/A
missing authority
disposition:         N/A

depends on:          ——

does NOT authorize:  ——

verdict:             UNSET
```

---

### Decision D5

```text
historical label:    containment
decision subject:    containment 决策是否由**版本无关**变为**版本相关** ——
                     即它是否被允许区分「已证明的 0.7.0」与「0.6.0 / 未知版本」。
                     要裁的是这一条不变量,不是「containment 是否还要」。
subject_status:      INSTANTIATED

current state X:     containment decision is **version-blind**。
                     输入只有路径、平台与文件系统探测:

                       zvec-path-containment.js:50
                         SUPPORTED_CHARS = /^[A-Za-z0-9_\-.\\/: ]+$/
                       zvec-path-containment.js:277-294  classifyCollectionPath(collectionPath, options)
                         → SAFE(platform)      非 win32
                         → UNKNOWN(lexical)    含非 ASCII 字符等
                         → UNKNOWN(profile)    探测未通过
                         → SAFE(both)          supported-ascii-profile

                     非 ASCII collection path 在 win32 上得到 UNKNOWN,
                     memory-index.js:575-580 以 reason='containment' 回落 SqliteFtsIndex,
                     并明确不打开、不修改既有 collection。
                     上层 decision snapshot 采集 choice / platform / classifier / fs /
                     path / marker 等输入,**其中没有 binding version**。
                     **containment decision chain 上没有任何 installed-zvec-version 输入。**
                     `zvec-path-containment.js` 自身唯一的版本引用是第 8 行的注释
                     (「@zvec/zvec 0.6.0 terminates the process with 0xC0000409」),
                     它不参与判定。(版本值在树里当然还有很多处 —— package.json、
                     lockfile、validation 文档 —— 但它们都不是这条决策链的输入。)

candidate state Y:   containment decision becomes **version-aware**,
                     并可据此区分已证明的 0.7.0 与 0.6.0 / 未知版本。

                     结构事实(属 X/Y 定义,不属判据):
                       决策链上当前没有任何一处读取已安装的 zvec 版本。因此
                       **新增 version identity input 是 Y 的组成部分**,
                       不是将来实施时偶然冒出来的细节。

                     实现形态不改变主语:该输入既可进入 classifyCollectionPath 的签名,
                     也可留在上层由消费方按版本决定是否消费 containment 结论。
                     两者是同一个 Y 的两种落法。

**明确不属于 D5**(冻结):
                     直接放宽 SUPPORTED_CHARS 使非 ASCII 落入 SAFE。
                     它放宽的是**路径字符集而不是版本**,后果是
                     **0.6.0 与 0.7.0 同时被放行** —— 那是另一个 decision subject,
                     与「0.7 containment relaxation」不能混写在同一个节点里。

observable
tree/runtime delta:  containment decision 的输入集合(是否含 version);
                     classifyCollectionPath 的签名与返回 verdict;
                     memory-index.js 的 reason 取值分布;
                     `mem verify` 的 containment 段落输出。

required authority:  NOT WRITTEN (Stage 2)
GREEN iff:           NOT WRITTEN (Stage 2)
RED iff:             NOT WRITTEN (Stage 2)
missing authority
disposition:         NOT WRITTEN (Stage 2)

depends on:          evidence edge:Stage 1 不实例化(§2.2)

does NOT authorize:  不改版本(D1)· 不改依赖分类(D2 / D3)· 不构成发布决定(D6)

verdict:             UNSET
```

---

### Decision D6

```text
historical label:    release
decision subject:    ——(条件性;见 E7)
subject_status:      NOT_INSTANTIATED

current state X:     实测(read-only,`node .evo-lite/cli/release-preflight.js`):

                       [release-preflight] create-evo-lite: no release blockers
                       [release-preflight] specs discovered=45 parsed=45, errors=0, blockers=0
                       [release-preflight] VERDICT=CLEAR

                     containment spec 的 `releaseBlocking: true` **仍在**
                     (docs/specs/zvec-win-unicode-containment.md frontmatter),
                     从未删除也未改 false;Task 9D 只把 lifecycle 推到 `status: done`,
                     于是它落在 §8.2.2 的 `done/shipped → ALLOW` 行。
                     **门没有被删除,只是这个 shipped spec 当前已经不欠它。**

candidate state Y:   三个候选:

    (a)「解除某个 zvec 相关 release blocker」
        —— 无 referent:blockers=0。
    (b)「授权一个具体的、携带升级的 candidate change set 发布」
        —— 只有当这样一个 change set 实际存在时,该对象才存在。
    (c)「把 containment spec 的 releaseBlocking 改为 false」
        —— 与 0.6 → 0.7 无关,且 AC7 已明确门要保留。

                     D6 的主语由 E7 在**具体 candidate change set 存在时**实例化为 (b)。
                     在此之前不得为它编写判据。

observable
tree/runtime delta:  release-preflight 的 VERDICT 行;spec frontmatter 的
                     releaseBlocking / status;发布产物的 package.json。

required authority:  N/A —— subject_status = NOT_INSTANTIATED
GREEN iff:           N/A
RED iff:             N/A
missing authority
disposition:         N/A

depends on:          E7 (SUBJECT_INSTANTIATION)

does NOT authorize:  ——

verdict:             UNSET
```

## 2. Typed dependency graph

**图只约束裁定,不替裁定。** 每个节点仍然独立出自己的 verdict;边不合并任何两个节点,
也不允许从一个节点的 verdict 推出另一个节点的 verdict。

### 2.1 四种边类型(冻结)

```text
LOGICAL
    A=YES 与 B=NO 在语义上无法同时成立。

EVIDENCE_PREREQUISITE
    B 要得到 YES,必须先存在 authority E。
    E 不存在时**不是** B=NO,而是 NAMED_NOT_INSTANTIATED / DEFERRED。
    该边只声明「E 是必要条件」,**不声明 E 是充分条件** —— 充分性属于 GREEN,Stage 2 才写。

IMPLEMENTATION_COUPLING
    A 与 B 同时为 YES 会要求协同实施,但并不决定任一项本身的 verdict。

SUBJECT_INSTANTIATION                                    (2026-09-02 APPROVED)
    它只回答一个问题:「下游的 decision subject 是否已经存在?」
    缺失时:  subject_status = NOT_INSTANTIATED
    它作用于 **subject_status 这条轴**,绝不传播 verdict ——
    不得由它推出 YES / NO / DEFER,也不得在下游主语未实例化时为其编写判据。
```

### 2.2 边

**Stage 1 不实例化任何 `EVIDENCE_PREREQUISITE` 边。** 类型定义(§2.1)保留,
但具体的 evidence edge —— 连同它所命名的 authority、以及该 authority 是否存在 ——
属于 Stage 2。在 Stage 1 写出「edge E 的 authority 是 X」「X 当前不存在」,
等于把 `required authority` 与 `missing-authority` 这两个 Stage 2 字段从节点
搬进图里,换个位置提前完成 Stage 2。

```text
已撤回的边 id(Stage 1 不成立,且 id 不再复用):

  E1  D1 ← EVIDENCE_PREREQUISITE   撤回 —— 具体 authority 属 Stage 2
  E2  D2 ← EVIDENCE_PREREQUISITE   撤回 —— 同上
  E3  D5 ← EVIDENCE_PREREQUISITE   撤回 —— 同上;原文还写了「该 authority 当前不存在」,
                                   那是 missing-authority fact,更不属于 Stage 1
  E5  D2 ↔ D3 IMPLEMENTATION_COUPLING
                                   删除 —— 理由见 §2.3

Stage 2 若创建 evidence edge,使用新的 id;E1 / E2 / E3 / E5 不复用,
以免两轮复审之间同一个 id 指向不同的边。
```

```text
E4  D1 ↔ D2  IMPLEMENTATION_COUPLING
        两者同时为 YES 时版本取值需协同。
        无逻辑冲突:母体与子项目是两个独立安装,版本不同不构成矛盾。

E6  D1 ↔ D3  IMPLEMENTATION_COUPLING
        两者操作 published manifest 中**同一个条目**:
            D1 改 value   0.6.0 → 0.7.0
            D3 改 bucket  optionalDependencies → dependencies
        若二者同时实施,最终的 manifest / lockfile edit 必须组合这两项独立 delta。
        **允许顺序提交,不要求原子 commit,也不要求同一批次发布。**
        该边仅记录 shared-entry composition,不表达任一 verdict 对另一项的约束 ——
        §2.3 中「D1 → D3 LOGICAL 不成立」仍然完全有效。

E7  D6 ← SUBJECT_INSTANTIATION
        instantiator 是「一个具体的、携带升级的 candidate change set 存在」,
        **而不是任何上游节点的 verdict 本身**:

            D1 / D2 / D3 / D5 decisions
                      ↓
            concrete upgrade-bearing candidate change set exists
                      ↓ SUBJECT_INSTANTIATION
            D6 becomes INSTANTIATED

        D5 也被列入来源,因为 containment 代码变化同样可能产生发布差异。
        该边只推进 subject_status,不推进 verdict。
```

### 2.3 图里**没有**的边

以下几条容易被顺手画上,此处明确记为**不成立**,以免把作者偏好编码进图结构:

```text
D6 ← D1 / D2 / D3 / D5   LOGICAL
        不成立。D6 的主语前提是「实际待发布对象存在」,而不是某个上游 verdict。
        上游 YES 本身不是 release verdict 的逻辑前提 —— 这正是 E7 用
        SUBJECT_INSTANTIATION 而不用 LOGICAL 表达的原因。

D5 ← D1   任意类型
        不成立。当前 classifier 不读版本;而即便 D5 为 YES 从而引入版本输入,
        一个版本门在仍装着 0.6.0 的环境里只是**不开启** —— 那是正确行为,
        既不是语义冲突(非 LOGICAL),也不要求两者协同实施(非 IMPLEMENTATION_COUPLING)。

D1 → D3   LOGICAL
        不成立。版本与依赖语义正交:即便 D1 最终为 NO,
        「0.6.0 是否从 optional 改为 mandatory」仍然是一个可讨论的独立问题。
        版本裁定不得结构性吞掉 dependency-class 裁定。

D3 ↔ D2   任意类型
        LOGICAL 不成立:D3=YES / D2=NO 可能是一个奇怪甚至不可取的组合,
        但它不是逻辑矛盾。该组合该由 Stage 2 的 criteria 判红,
        **不得在 Stage 1 的图里提前禁止** —— 图不替裁定。

        IMPLEMENTATION_COUPLING 同样不成立(原 E5,已删除)。它当时的理由是
        「否则会出现 published package 要求必装、而脚手架项目拿不到的中间状态,
        所以必须同批发布」—— 那是对**该组合是否可接受**的评价,属 Stage 2,
        不是结构约束。而且这个中间状态并不破坏任何现存不变量:
        defaultLoadZvecIndex()(memory-index.js:194-198)在 require 失败时返回 null,
        运行点本来就允许 zvec 不可用并回落 SqliteFtsIndex。
        把一句评价包装成 IMPLEMENTATION_COUPLING,等于在 Stage 1 提前施压。

D3 ↔ D5   任意类型
        不成立(**冻结后**)。D3 曾有一个候选主语「完全必装 / 移除 SqliteFtsIndex
        回落面」,它与 D5 确实构成 LOGICAL 冲突(containment 的降级目标正是该回落路径)。
        2026-09-02 的裁决把 D3 冻结为 manifest dependency class,该候选被排除,
        因此这条边随之消失。此处保留记录,以免将来有人重新把 fallback 语义并进 D3
        而不知道它会重新引入一条 LOGICAL 边。
```

## 3. Candidate source inventory

**这只是文件清单。** 它不把任何一份文档绑定为任何一种 authority,也不声明任何一份
文档证明了什么 —— 「这份文件是哪一类 authority」是 Stage 2 的工作。
列在此处只是为了指明 Stage 2 将从哪里取材。

```text
Step 1  docs/validation/zvec-070-win-unicode-recheck.md
2A      docs/validation/zvec-070-install-matrix.md
2B      docs/validation/zvec-070-adapter-contract.md
2C      docs/validation/zvec-070-nonascii-bridge.md
```

**禁止的推理形状**(明确写下,因为它正是本工作线一路在防的那个跳跃):

```text
measurement phase SATISFIED  →  upgrade YES          ✗
Step 1/2A/2B/2C 全绿          →  某节点 GREEN         ✗
```

「全绿」不是任何节点的总括 GREEN 条件。每个节点在 Stage 2 必须写明:
**它从上述哪一份文件里,消费哪一个具体事实**。

## 4. Stage 2 之前不得做的事

```text
不写 GREEN / RED                     不写 required authority
不写 missing authority disposition    不读取证据
不裁定任何一项                        不写实施计划
不修改 D1-D6 涉及的任何生产文件
不为 subject_status = NOT_INSTANTIATED 的节点(D4 / D6)编写判据
不实例化任何 EVIDENCE_PREREQUISITE 边   不把任何文件绑定为某一类 authority
不声明某个 authority「存在」或「不存在」
```

最后三条是 2026-09-02 第一次 Stage 1 复审的裁决:原 §2.2 曾实例化 E1 / E2 / E3
并写明 E3 的 authority「当前不存在」。那是 `required authority` 与
`missing-authority` 两个 Stage 2 字段被从节点搬进了图里 —— 位置换了,越界没变。
