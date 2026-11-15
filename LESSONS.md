# 开发经验

与 [英文版](LESSONS.en.md) 同步；发布行为见[发布说明](docs/releases.md)。

## RELEASE-001：自动发布启用边界不能冒充已发布源码

- 范围：从旧 tag 发布迁移到逐提交自动发布，基线 `80979bd6f604ab915ddf64a285164e7bfa0124ec`。
- 规则：已有 tag 后的历史代码不应因启用新工作流被全部补发；显式配置启用边界，实际发布成功后才更新 `releaseSource`。后续运行优先使用真实发布进度。
- 证据：移除边界回退的隔离副本在 `activation baseline` 测试中因额外历史包失败，日志 `/tmp/songloft-bili-auto-release-negative.log`；实际实现的完整 49 项测试通过，日志 `/tmp/songloft-bili-auto-release-full-tests.log`。
- 正确示例：先使用 `RELEASE_BASE_SHA` 排除启用前历史，成功后用 `plugin.json.releaseSource` 续跑；不为了跳过历史而伪造发布记录。
- Seen 1× (2026-11-15)。本条是迁移机制回归证据，不代表线上发生过误发。

## UI-001：迁移后的可交互验证不能替代布局验收

- 范围：HTML 到 ReactLynx 的 bili 前端迁移；基线 `b1324026a69673b3e086d20e4a74b662fa238cdb`。
- 证据：旧包 `v2026.11.15.0` 在同一真实浏览器回归中，320px 下第五个导航项落到第二行（y=56，其余 y=10）；日志 `/tmp/songloft-bili-layout-negative-browser.log`。旧迁移虽然保存设置成功，仍丢失原有表单分组和选中态。
- 规则：保留信息层次和窄屏导航；输入框用显式类名，不依赖跨端不一致的标签选择器。Web 的 x-input 为 `display: contents`，尺寸与输入交互要检查其 shadow root 内真实 input，不能把宿主的零尺寸误判为不可见。
- 正确示例：`tests/layout.browser.cjs` 在 320/390/1100px、明暗两种主题遍历五页，断言导航不换行、控件不横向溢出、输入高度和短视口保存；同一脚本替换为旧包后必须因导航换行失败。截图人工检查分组、间距与文字颜色。
- Seen 1× (2026-11-15)。本条记录同次迁移遗漏，重复复验不增加次数。
- 同次原生补验：深色提示文字需 `-x-placeholder-color`；从设置页底部切回搜索会继承旧滚动位置，应按 tab 重建滚动容器。原生截图与后端保存证据见[验证记录](VERIFICATION.md)。
