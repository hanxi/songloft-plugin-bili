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

Web 回退依赖服务端 `web-core/` 目录；本次从 Lynx 构建产物复制。Lynx HTML 回退不设置 COEP 以兼容 Chromium 121；隔离宿主页跨源嵌入此 HTML 不受支持。原生/Web Lynx frame 不经过此入口。SDK/构建器现固定为 npm 正式依赖 `2.20.0`。首次发布遇到 npm 认证及待确认发布，完成后通过 [v2.20.0 恢复发布工作流](https://github.com/songloft-org/plugin-toolchain/actions/runs/43695190471) 补齐其余包；[GitHub Release](https://github.com/songloft-org/plugin-toolchain/releases/tag/v2.20.0) 已创建。当时 bili 的发布工作流仍需单独触发，该批仅提交推送插件源码。后续已改为推送自动发布，见[发布说明](docs/releases.md)。

## 正式 npm 依赖复验

工具链 v2.20.0 的恢复发布已成功，插件依赖锁定 `@songloft/plugin-builder@2.20.0` 与 `@songloft/lynx-plugin-sdk@2.20.0`，两份锁文件均无本地路径依赖。主仓库依赖安装通过；前端清洁安装因 npm 官方大体积二进制下载过慢，最终使用镜像下载并按保留的 npm 官方锁文件完整性校验通过。

正式依赖下：后端及前端类型检查、38 项回归、原生/Web bundle 构建及 ZIP 校验通过，zipHash 仍为 `ef854906e246ae1ef811f28884016275b3699137736b7068c120e06f5d3650a3`。浏览器再次验证设置持久化、390px 暗色主题及文字颜色，pageerror 为 0。新增 CI 从独立 checkout 执行冻结安装、类型检查、回归和双包构建。日志 `/tmp/songloft-bili-official-*.log`；正式依赖复验中的浏览器首轮点击早于初始化完成而超时，等待页面初始化完成后通过。

本轮 Android 复验中，模拟器宿主在启动及打开插件后以 segmentation fault（退出码 139）退出，未取得新的交互截图。未将本轮记为通过；保留前轮真实模拟器保存设置的证据，以及相同 zipHash 的产物关联。

独立 CI 首轮因工作流显式 pnpm 9 与 packageManager 的 9.15.0 重复声明而失败；已统一由项目 packageManager 决定版本，保留 `/tmp/songloft-bili-first-ci-failure.log`，最终 CI 结果以提交对应运行记录为准。

独立 CI 第二轮在 Node 20 编译 WebAssembly 工具时失败（Unknown heap type -14），原生 bundle 已编译。开发及两条工作流统一为 Node.js ≥22.14；保留 `/tmp/songloft-bili-ci-second-failure.log`，由后续同一源码的 Node 22 CI 验证。

## 自动发布流程验证（2026-11-15）

对象：基线 `80979bd6f604ab915ddf64a285164e7bfa0124ec` 加本批发布工作流、脚本与测试改动；运行时插件代码未改。环境：Linux amd64、Node 22.17.1、pnpm 9.15.0。`pnpm test` 49 项通过，其中发布测试 11 项；隔离副本移除启用边界后，历史提交误发回归按预期失败。日志为 `/tmp/songloft-bili-auto-release-{full-tests,negative}.log`。

`git diff --check` 通过。actionlint v1.7.12 尚不识别 GitHub 已支持的 `concurrency.queue`，初次检查因此失败；按[官方文档](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)核对 `queue: max` 与 `cancel-in-progress: false`，仅忽略此项旧版 schema 报错后，两份工作流其余检查通过。日志 `/tmp/songloft-bili-auto-release-lint.log`。推送后的同 SHA CI、自动 Release 和下载资产另行验收。

Not run：本轮未重复浏览器/Android UI 操作，仅改发布流程，之前运行时验证记录保留。

实际推送验收：提交 `7670f08e1f9391d896066ea7fd54f8bd6dd1259e` 的 [CI](https://github.com/hanxi/songloft-plugin-bili/actions/runs/43698667904) 与 [Release Plugin](https://github.com/hanxi/songloft-plugin-bili/actions/runs/43698667865) 全部成功。普通 push 自动创建 [v2026.11.15.0](https://github.com/hanxi/songloft-plugin-bili/releases/tag/v2026.11.15.0)，机器人提交 `692be3e` 回写主线元数据。本地已快进同步。

下载 `/tmp/songloft-bili-auto-release-assets/bili.jsplugin.zip` 后，核对原生/Web bundle、HTML 回退入口与 `main.jsc`，并重算 entryHash、canonical zipHash；包内清单、tag 和主线的版本、来源、地址与哈希一致。tag 父提交正是 `7670f08`；ZIP SHA-256 为 `a984bf629271c4129d22c5f570b80cd0ac76fce5495f0df88eb427d2bb3efdf5`。本地旧 tag `v2026.10.7` 与远端冲突导致全 tag fetch 拒绝该旧引用，未强制覆盖；新 tag 已获取，主线快进成功，不影响本轮发布。

## 样式修复验证（2026-11-15）

对象：`b1324026a69673b3e086d20e4a74b662fa238cdb` 加本批工作树。前端与浏览器测试文件的指纹为 `3e0cc345819e1092c3217b5a757f9d58d3cb8de16ae3154e3e5d4e74928346b8`（文件哈希表 `/tmp/songloft-bili-layout/worktree.json`）。插件后端未改，SDK/Builder 仍为正式 npm `2.20.0`。

修复：导航窄屏单行、卡片分组、独立选中态和布尔开关；链接/搜索模式切换；选歌后显示导入表单；去掉重复选项。输入框改为显式类名，并设置原生 `-x-placeholder-color` 和 Web 提示色变量。切页重建滚动容器，避免从设置页底部返回时卷走搜索页标题。

Linux amd64 / Node 22.17.1 / pnpm 9.15.0：前端 typecheck、完整 49 项测试、双端构建与 validate 均通过；`git diff --check` 通过。日志 `/tmp/songloft-bili-layout-{types,tests,build,validate}.log`。

Docker Chromium 121：`tests/layout.browser.cjs` 遍历 320/390/1100px、明暗主题和五页，共 30 组。断言五项导航同一行、横向无溢出、真实输入元素高度至少 40px、选中态唯一；320×480 下点击保存，后端读回音质 medium；切页回到顶部；无 pageerror。日志 `/tmp/songloft-bili-layout-browser.log`。将同一脚本的 Web bundle 替换为已发布 `v2026.11.15.0`，因 320px 导航第五项换到 y=56 而失败；日志 `/tmp/songloft-bili-layout-negative-browser.log`。浏览器主宿主中的原生 Lynx frame 也完成账号/下载/设置切换、保存后端实读、390px 截图，无页面错误，日志 `/tmp/songloft-bili-layout/host-browser.log`。

真实 Android API 34 x86_64 模拟器：320×640，真实 APK 加同一份前端源码构建的 native bundle。逐一点击五个导航项并检查截图；深色输入提示可读；设置中选择“最低”，真实滑动至保存按钮并点击，后端读取 `audio_quality=low`；从底部切回搜索后标题及输入框完整显示。证据 `/tmp/songloft-bili-layout/android-final-*.png`、`native-saved.json`。APK 为之前的 Debug/TestBridge 壳，SHA-256 `1e8daecfc8a856f4fac2260b83a44d8d803e76ce4bfaf0351236b7cd174c9b1b`，本轮未改原生壳。

模拟器失败如实保留：37.2.12 的 swiftshader/off 和 35.6.11 的 swiftshader 运行出现宿主 SIGSEGV；gdb 捕获 RenderThread 与 SwiftShader libGLESv2 线程堆栈，见 `/tmp/songloft-bili-layout/emulator-fault-backtrace.log`。最终 37.2.12 使用 `-gpu swangle` 稳定完成上述交互，日志 `/tmp/songloft-bili-layout/emulator-swangle.log`。并非把失败轮次改写为成功。

复跑浏览器脚本（仅针对隔离测试实例，脚本会修改音质）：在 Docker Chromium 内设置 `BROWSER_PUPPETEER=/usr/src/app/node_modules/puppeteer` 和 `BILI_TEST_BASE_URL` 后运行 `node tests/layout.browser.cjs`。负向对照另设 `BILI_TEST_OLD_BUNDLE` 为旧 Web bundle 文件路径。

Not run：本轮未重新构建 Android 原生壳，未操作真实 B 站账号/下载；iOS/HarmonyOS、Flutter 真机及原生浅色主题未补验。浏览器明暗主题和原生深色主题的证据范围如上。
