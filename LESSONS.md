# 开发经验

与 [英文版](LESSONS.en.md) 同步；发布行为见[发布说明](docs/releases.md)。

## RELEASE-001：自动发布启用边界不能冒充已发布源码

- 范围：从旧 tag 发布迁移到逐提交自动发布，基线 `80979bd6f604ab915ddf64a285164e7bfa0124ec`。
- 规则：已有 tag 后的历史代码不应因启用新工作流被全部补发；显式配置启用边界，实际发布成功后才更新 `releaseSource`。后续运行优先使用真实发布进度。
- 证据：移除边界回退的隔离副本在 `activation baseline` 测试中因额外历史包失败，日志 `/tmp/songloft-bili-auto-release-negative.log`；实际实现的完整 49 项测试通过，日志 `/tmp/songloft-bili-auto-release-full-tests.log`。
- 正确示例：先使用 `RELEASE_BASE_SHA` 排除启用前历史，成功后用 `plugin.json.releaseSource` 续跑；不为了跳过历史而伪造发布记录。
- Seen 1× (2026-11-15)。本条是迁移机制回归证据，不代表线上发生过误发。
