# GitHub windows-latest 镜像上,控制组不复现

run `33612887037` @ `75a68aa`,node 22 / 24,两格 `NOT_SATISFIED`。

与 `../results-out-of-regime/` 那次不同,**这一次长度已被精确控制**:

```
colPathLen 149        两格一致,等于已登记的 FAIL_FAST 长度
prefixPadLength 72    由构造推导,非手算
lengthOnTarget true 的前置条件已满足(control 与 subject 同长)
```

在这个长度上,本机 3/3 必死的同一个 binding、同一个 segment,在 GitHub 镜像上
**正常完成** phase A(2/2 checks,exit 0)。

```
                      osRelease     ACP    0.6.0 @ colPathLen 149
本机 Windows 11       10.0.26200    936    process-death 3221226505
GitHub windows-latest 10.0.26100    未测   completed exit 0
```

两侧 Node major 相同且 patch 接近(22.23.2 / 24.19.0 对 22.22.2 / 24.18.0),
因此**没有证据把差异归因于 Node major**;当前证据**不足以排除** Node patch、
runner 镜像、OS build、locale / ACP、CRT / native runtime 或其他尚未隔离的环境维度。
ACP 936 是本机的**观察**,CI 侧未测;**本轮不主张任何因果**,原因见
`../../zvec-070-nonascii-bridge.md` §6:隔离这些维度属于 native mechanism,
本轮授权明确排除。

本目录的 record 产生于共享分类器(`fixtures/shared/fail-fast-classifier.js`)之前,
`control.outcome` 用的是桥自己的旧词 `completed`,不是 `COMPLETED_NO_FAILFAST`。

因此这两份工件的地位是:**该镜像不是触发平台**,不能承载这个实验。
它们**不是**「0.6.0 已经没问题了」的证据。
