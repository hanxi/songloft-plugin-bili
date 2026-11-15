# Lynx 迁移验证（2026-11-15）

基线：bili `290b9767f4e7416c0a7a2c077c68924f2de4db1a`；toolchain `bc58da63333521f2cb7192c44fcfffcf61656616`；Lynx `025ed82319233c8b64e734cb4c6cdbca84da9833`；主仓库 `4df1e97b3a7874d08d1d74ce799baa9295b512b4`。均为该基线加本批未提交工作树，最终差异摘要见 `/tmp/songloft-bili-verification/worktrees.json`。

环境：Linux amd64、Node 22.17.1、Docker Chromium 121、Android API 34 x86_64 模拟器。测试后端使用独立 SQLite 和插件目录（端口 30600），未修改现有服务实例。

- SDK：`npm test` 6 项通过；`npm run build` 通过。
- bili：`npm test` 38 项通过，保留下载/风控回归；`npm --prefix frontend run typecheck`、`npm run build`、`npm run validate` 通过，ZIP 包含原生/Web bundle、回退入口及图标。
- Lynx：生产 `npm run build`、`npm run build:web`、`tsc -b` 通过。全量 Vitest 3812 通过、1 项发布产物检查失败：当时 dist 为模拟器使用的 TestBridge 构建。生产重建后重新执行发布检查及请求/宿主定向测试，12 项通过。没有把第一次全量结果改写为全通过。
- 主仓库：HTML 资源版本、普通 WebView COEP 与 Lynx 回退例外的 Go 定向测试通过；`node --test scripts/tests/lynx-plugin-fallback.test.mjs` 通过。各仓库 `git diff --check` 通过。
- 浏览器真实页面：主宿主 Web frame 切换账号/下载/设置，保存音质并通过后端读取核实；1100px 与 390px 截图、无 pageerror。独立 HTML 回退另外验证实际渲染、业务请求与主题；HTML 回退另验证 390px 暗色主题、实际文字颜色和保存设置，`fallback-acceptance.log` 显示 passed=true；具体结果及脚本在下述目录。
- Android：在隔离 API 34 模拟器运行真实 APK 与本次 JS bundle，登录隔离后端、打开原生 bili frame、切换设置、滚动并选择音质“中”、点击保存；后端实读 `audio_quality=medium`。截图、ANR 排查与 `native-saved.json` 均保留。测试 APK 使用既有 Debug 原生壳替换本次 bundle 后重新签名；没有修改原生源码。初次 API 35 / 16 KB 镜像壳启动失败；API 34 冷启动期间发生系统及应用 ANR，重新启动后完成上述验证，不隐藏首轮失败。

证据目录：`/tmp/songloft-bili-verification/`；测试日志位于 `/tmp/songloft-bili-*.log`。截图包含 `android-final-search.png`、`android-final-settings.png`、`android-bottom2.png`、`android-saved.png` 和浏览器截图。测试脚本仅使用隔离后端默认测试账号。

Not run：真实 B 站账号扫码确认、登录后的收藏夹导入/真实音频下载、Flutter 真机、iOS/HarmonyOS。扫码界面与队列代码已迁移，但不将无账号页面验证称为这些业务验收。`assembleDebug` 的 Gradle 8.7 下载过慢，未取得完整源码 APK 构建通过结果；模拟器证据只证明上述 Debug 壳与新 bundle 的行为。

Web 回退依赖服务端 `web-core/` 目录；本次从 Lynx 构建产物复制。Lynx HTML 回退不设置 COEP 以兼容 Chromium 121；隔离宿主页跨源嵌入此 HTML 不受支持。原生/Web Lynx frame 不经过此入口。SDK/构建器现固定为 npm 正式依赖 `2.20.0`。首次发布遇到 npm 认证及待确认发布，完成后通过 [v2.20.0 恢复发布工作流](https://github.com/songloft-org/plugin-toolchain/actions/runs/43695190471) 补齐其余包；[GitHub Release](https://github.com/songloft-org/plugin-toolchain/releases/tag/v2.20.0) 已创建。bili 的发布工作流仍需单独触发，本批仅提交推送插件源码。

## 正式 npm 依赖复验

工具链 v2.20.0 的恢复发布已成功，插件依赖锁定 `@songloft/plugin-builder@2.20.0` 与 `@songloft/lynx-plugin-sdk@2.20.0`，两份锁文件均无本地路径依赖。主仓库依赖安装通过；前端清洁安装因 npm 官方大体积二进制下载过慢，最终使用镜像下载并按保留的 npm 官方锁文件完整性校验通过。

正式依赖下：后端及前端类型检查、38 项回归、原生/Web bundle 构建及 ZIP 校验通过，zipHash 仍为 `ef854906e246ae1ef811f28884016275b3699137736b7068c120e06f5d3650a3`。浏览器再次验证设置持久化、390px 暗色主题及文字颜色，pageerror 为 0。新增 CI 从独立 checkout 执行冻结安装、类型检查、回归和双包构建。日志 `/tmp/songloft-bili-official-*.log`；正式依赖复验中的浏览器首轮点击早于初始化完成而超时，等待页面初始化完成后通过。

本轮 Android 复验中，模拟器宿主在启动及打开插件后以 segmentation fault（退出码 139）退出，未取得新的交互截图。未将本轮记为通过；保留前轮真实模拟器保存设置的证据，以及相同 zipHash 的产物关联。

独立 CI 首轮因工作流显式 pnpm 9 与 packageManager 的 9.15.0 重复声明而失败；已统一由项目 packageManager 决定版本，保留 `/tmp/songloft-bili-first-ci-failure.log`，最终 CI 结果以提交对应运行记录为准。
