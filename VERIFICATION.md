# Lynx 迁移验证（2026-11-15）

## 全页按钮间距（2026-11-16）

2026-11-16：用户已授权本批提交推送；与 `/tmp/bili-spacing/worktree.json` 核对后代码完全一致，本轮只补充授权记录。下文保留提交前验证快照，实际提交、CI 及既有自动发布结果以 Git/Actions 为准。

对象：bili `23e137f67150963945444b1544b628c24e6e93d6` 加本批工作树。仅修改插件，主仓库及客户端的其他并行改动未纳入。Linux amd64、Node 22.17.1、Docker Chromium 121；测试复用隔离宿主二进制及已修复的 Web 运行时，独立数据库、插件目录及包位于 `/tmp/bili-spacing/`，端口 30606。

- 根因：基础按钮仅有上/右外边距，没有统一底部留白；页面级 `.content > .button-primary` 还会被条件渲染包装节点隔开。改为显式 `Actions` 操作区统一管理组内 8px、区块间 12–16px，页面操作下留 16px，卡片末尾复用容器内边距。下载分页去掉重复上边距；选择项与当前歌单采用独立容器，弹层头尾、导航、搜索行及分 P 行保持各自布局。
- 逐一覆盖加载更多、导入及高级选项、收藏夹/预览/整夹导入、下载控制与分页、账号登录/退出/二维码、监控操作、基线确认、保存设置、音源测试、歌单弹层。未改变 API、权限和按钮业务行为。
- 前端类型检查、62 项测试、原生/Web 双包构建、validate、格式与 diff 检查通过：`/tmp/bili-spacing-{types,tests,build,validate,format-check}.log`。Android 3.6 的 `gap` 与 margin 采用本地 Lynx CSS 兼容数据核对；原生包构建不能代替原生界面验收。
- `tests/spacing.browser.cjs` 默认分 6 个独立页面执行 320/390/1100px、明暗主题，其中 320px 使用 480px 短视口，共 65 个场景通过。检查所有普通按钮有明确操作区、横向无溢出、组内及换行间距至少 8px、卡片/弹层边距至少 16px（确认子面板为 12px，透明搜索区使用外层页面留白）。加载更多及保存下方至少 16px，下载控制到首张任务卡至少 12px。包含任务运行/暂停/完成失败/清空、登录/游客、二维码和确认态；真实指针点击暂停、恢复、再次暂停及清除发出预期 4 次请求。业务数据为夹具，不是真实下载验收。
- 使用已发布 `v2026.11.16.1` 的 Web bundle 对照，新专项在「加载更多」下方实际间距 0px 处失败，修复后为 16px。日志 `/tmp/bili-spacing-negative.log`。专项分组结果位于 `/tmp/bili-spacing/browser-<width>-<theme>.log`、`matrix.json`；默认总入口日志 `/tmp/bili-spacing-browser.log`。截图位于 Chrome 容器 `/tmp/bili-spacing-{more,downloads,settings}.png`。
- 原有 30 组布局、短视口保存并后端读回、轮询位移 0px 与 240px 滚动保留、匿名收藏夹请求 0 次、长标题/分 P/千歌单弹层和紧凑导航/登录回归均通过：`/tmp/bili-spacing-{layout,stability,details,compact}.log`。

验证边界与保留问题：早期脚本误把透明搜索区当作有 16px 内边距的卡片，已按实际容器层级修正；组合 `pierce` 选择器曾漏掉实际存在的控件，最终直接查询插件 shadow root。单个 worker 连续切换全部尺寸/主题再经历二维码等流程时，出现过首击未切页及一次进程退出 143，未计为通过，根因未确认。稳定按钮处理器的尝试未消除首击现象，已撤回；最终只保留间距改动，分组测量布局、独立验证二维码，不宣称修复长流程点击问题。

Not run：本批 Android/iOS/HarmonyOS 原生交互、Flutter、真实 B 站账号与下载。既有 Android 模拟器宿主启动退出 139，本轮未重启该环境；浏览器结果不是 Android 验收。未提交、推送或发布。最终文件指纹 `/tmp/bili-spacing/worktree.json`。

## 紧凑导航与真实分 P 状态（2026-11-16）

2026-11-16：用户已授权本批提交推送；代码与 `/tmp/bili-compact/worktree.json` 完全一致，本轮仅补充授权记录。下文保留提交前验证快照，实际提交及推送触发的自动发布结果以 Git/Actions 为准。

对象：bili `f46167e89198e1edd383a2c65adab80feff2abfe` 加本批未提交工作树。只修改插件；客户端及主仓库未改。Linux amd64、Node 22.17.1、Docker Chromium 121；隔离二进制、SQLite、插件包及已修复的 Web 运行时位于 `/tmp/bili-compact/`，端口 30604。

- 取消顶部 40px 状态槽，导航下直接承接内容。账号检查完成后游客显示「未登录」，登录后显示 16px 头像及「账号」，图片复用已有失败回退。读取反馈放在对应标题/字段的固定横向槽中，后台轮询错误不弹浮层；操作反馈采用可关闭浮层，成功 2.5 秒自动消失。
- 缺少 cid 不等于多 P：已知单曲不显示入口，未知数量显示「详情」并按需读取；确认多 P 才展开、收起。提取结果携带实际 `part_count`；单曲不重复展开 P1，缓存复用、选中状态及各 P 独立选择保留。搜索不逐条预取详情。
- `npm test` 62 项、前端 typecheck、后端 `tsc --noEmit`、原生/Web 双包构建和 validate 通过。日志 `/tmp/bili-compact-{tests,types,backend-types,build,validate,format}.log`。最后新增后端数量回归及测试格式调整后重跑完整 62 项通过，运行时代码未变。
- `tests/compact.browser.cjs` 使用真实指针/键盘和受控业务数据：账号慢读、登录/退出、头像在 320/390/1100px 的尺寸和加载、设置失败后就地重试、操作错误浮层关闭；导航高度始终 49px，内容与导航间隙 0px。单曲/多 P/未知数量、无额外预取、缓存折叠和单 P 选择均通过，三条显式详情读取各一次。日志 `/tmp/bili-compact-browser.log`；截图 `/tmp/bili-compact-{initial,account,search}.png`（Chrome 容器）。首轮脚本点击被短暂操作浮层遮挡，改为真实点击关闭后继续；后续增加账号页往返时暴露测试夹具固定返回游客，改为随登录/退出同步状态，未修改产品登录行为。
- 原有 30 组尺寸/主题/页面检查、短视口保存读回、42px 长标题、千歌单分页、慢请求切页及真实 CDN/失败/空封面均通过。设置轮询含延迟和失败时，标题/导航/滚动区位移仍为 0px，保留原节点和 240px 滚动偏移，匿名收藏夹请求 0 次。日志 `/tmp/bili-compact-{layout,details,stability,interaction}.log`。
- 使用已发布 `v2026.11.16.0` 的旧 Web bundle，同一新浏览器回归因仍有顶部状态槽失败；隔离副本恢复旧提取器后，新增数量回归因缺少 `part_count` 失败。日志 `/tmp/bili-compact-{negative,parts-negative}.log`。

Not run：本批 Android/iOS/HarmonyOS 原生交互及 Flutter，先前 Android 模拟器启动宿主退出 139，未把浏览器当作原生验收。未测试真实 B 站 Cookie/扫码、导入及下载；浏览器账号和视频为夹具。无提交、推送或发布。最终文件指纹 `/tmp/bili-compact/worktree.json`。

## 主导航状态、长标题、分 P 与歌单选择（2026-11-15）

2026-11-16：用户授权提交推送，下文保留提交前验证快照；代码与 `/tmp/bili-followup/worktrees.json` 完全一致，仅补授权记录。实际提交、CI 和推送触发的既有自动发布结果以 Git/Actions 为准。

对象 bili `2317a4a8a3d0964571a52725b7bcd2fb3e2124d2` + 本批工作树，配合 Lynx 客户端 `2447fade1affad9dda94f0bd68aff932680d91d8` + 工作树的原生 frame 保留。主导航缓存属于客户端 Shell，不用插件服务端存储跨设备共享界面状态；旧客户端只更新插件不能修复原生 frame 销毁。

Linux / Node 22.17.1 / Docker Chromium 121，隔离数据库端口 30602：59 项测试、前后端类型检查、原生/Web 构建和 validate 通过。`tests/details.browser.cjs` 验证 320px 两行混合长标题高 42px、按钮不重叠、分 P 展开/收起/再展开仅一次请求，以及 1000 歌单仅渲染 20 行、实际输入搜索“999”、选择与取消。旧包对照因找不到“收起”入口失败。日志 `/tmp/bili-followup-{tests,types,backend-types,build,validate,browser,browser-negative}.log`。原有稳定性与 30 组布局/短视口保存读回通过，日志 `/tmp/bili-followup-{stability,layout}.log`。原生界面输入值改为固定默认值，仅外部更新反写，避免每次输入的回显竞态。

客户端 3820 项测试、89 项发布检查、类型、双包及 Web 构建通过；原生分支组件测试保留同一 frame/搜索状态、暂停隐藏页和升级/停用清理。隔离破坏保留行为后回归失败；见客户端 `docs/project/bili-plugin-interaction.md` 及 `/tmp/bili-followup-host-negative.log`。首轮客户端测试的查询隔离 mock 与冗余玻璃表面错误已修复，未放宽表面闸门。

真实键盘回归还发现 Web 宿主在自定义元素升级前丢失事件绑定；已同时补齐固定 web-core 的开发/生产实现。生产方法的 3 项回归通过，旧包对照 2 项失败。HTML 回退依赖更新后的服务端 `web-core/`；本轮核对 HTTP 资源哈希后，以无事件注入/补绑的正常键盘和指针操作再次通过上述场景。日志 `/tmp/bili-followup-{events,event-negative,browser}.log`；运行时资源身份详见客户端记录。

Not run：本批 Android 原生真机、Flutter、iOS/HarmonyOS、真实 B 站导入下载。Web 截图不当作 Android 验收；先前模拟器启动宿主时退出 139。本批未提交、推送或发布。最终双仓库文件指纹 `/tmp/bili-followup/worktrees.json`。

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

## 布局与交互优化验证（2026-11-15）

对象：bili `1a22f3133e2dac7ebe085a28c1c33d1820fc3912` 加本批未提交工作树；宿主使用先前构建的隔离测试二进制 `/tmp/songloft-bili-verification/server-final2`，本批没有修改宿主。环境为 Linux amd64、Node 22.17.1、Docker Chromium 121，独立后端端口 30602，数据库与插件包位于 `/tmp/bili-redesign/`，未使用现有服务数据。

- 默认搜索、次要链接入口、系统蓝明暗主题、封面列表、折叠歌单选择与更多导入选项；页签不再受操作锁阻塞，独立读请求合并，错误按资源重试。搜索选择、设置草稿和滚动位置保存在页签外。
- 前后端 TypeScript 检查、55 项插件测试、原生/Web 双包构建及插件 validate 通过。日志 `/tmp/bili-redesign-{backend-types,tests,build,validate}.log`。新增测试最初误用未声明的 esbuild 依赖失败，改用已有 TypeScript 转译器后全通过。
- `tests/interaction.browser.cjs` 在真实 HTML 回退页延迟设置和收藏夹请求 1600ms，验证请求结束前已切至下载、重复请求合并、默认搜索、选歌保留、刷新不覆盖设置草稿。用真实 CDN 图片及失败/空地址验证图片与占位，并检查 320/390/1100px 明暗结果列表。日志 `/tmp/bili-redesign-interaction.log`，截图 `/tmp/bili-redesign-<width>-<theme>.png`（Chrome 容器内）。这些搜索和收藏夹数据由请求夹具提供，不代表真实 B 站搜索业务验收。
- 首轮真实图片验证失败：CDN 对本地页面 Referer 返回 403。新增限定 B 站封面的 JSON 取图回退，经宿主代理取得图片，回退图片显示及缓存跨页复用通过；未扩大宿主代理权限，令牌不返回前端。专用路由限制地址、类型及大小，并有仓储无关的处理器回归。
- 从上述基线的隔离副本构建旧 Web bundle，同一快速切页回归得到 `收藏夹 != 下载`，按预期失败；日志 `/tmp/bili-redesign-negative.log`，基线构建日志 `/tmp/bili-redesign-baseline-build.log`。修复后同脚本通过。
- 既有 `tests/layout.browser.cjs` 验证 30 组导航/布局/输入高度、320×480 下真实保存并后端读回 medium、无 pageerror；日志 `/tmp/bili-redesign-layout.log`。`git diff --check` 通过。最终文件 SHA-256 表在 `/tmp/bili-redesign/worktree.json`。

Not run：ReactLynx 原生真机/模拟器（当前 adb 无连接设备）、Flutter 真机、iOS/HarmonyOS；真实 B 站账号扫码、收藏夹导入和音频下载。原生 bundle 构建通过不替代这些验证。没有提交、推送或发布。

## 设置页抖动及游客错误修复（2026-11-15）

基线 bili `168d83c1e651be1ac3132583bdf3cdbd5600ef7e` 加本批工作树；Linux amd64、Node 22.17.1、Docker Chromium 121，隔离后端 `/tmp/bili-stability/test.db`，端口 30602。宿主沿用之前构建的 server-final2，本批只修改插件。

根因与改动：同步状态每两秒轮询时，资源提示反复插入/删除表单顶部；切页还会重建 scroll-view。改为固定导航、固定高度状态区域、单个页面容器及按需创建后保留的独立滚动页，页面显隐由普通 view 控制，滚动页使用 100% 高度，避免 Web scroll-view 强制 display:flex 及隐藏恢复后的 flex 权重丢失。请求刷新不再改变表单布局。匿名状态不读取受保护的收藏夹；收藏夹 401 转为登录引导并清理失效列表，登录后恢复读取；其他设置不要求登录。只有 buvid 指纹、没有 SESSDATA 时，登录状态接口直接返回游客状态，不再访问 nav。

- 原包回归捕获首个设置标题位移 82px、收藏夹请求 3 次及原始错误文字；日志 `/tmp/bili-stability-negative.log`。新匿名 Cookie 回归在基线隔离副本中因返回 `risk_control: B站 HTTP 412` 失败，日志 `/tmp/bili-stability-auth-negative.log`。
- `tests/stability.browser.cjs` 对同步状态注入 500ms 延迟及每三次一次的 500 错误，连续采样约 9 秒；新实现标题、滚动区域与导航尺寸位移均 0px。匿名收藏夹请求 0 次；登录失效场景只请求 1 次，之后不重试受保护列表。原页面节点与 240px 滚动位置保留，只有当前页占用显示空间，无 pageerror。日志 `/tmp/bili-stability-{browser,expired}.log`。
- `tests/layout.browser.cjs` 的 30 组尺寸/主题/五页检查、短视口真实保存及后端读回通过；持久页面使隐藏控件仍存在，测试已限定到 active 页并确认实际选中页签。慢请求切页、草稿保留与真实图片的 interaction 回归通过。日志 `/tmp/bili-stability-{layout,interaction}.log`。
- 56 项测试、前后端类型检查、原生/Web 双包构建、validate、格式检查及 diff 检查通过，日志 `/tmp/bili-stability-{tests,backend-types,build,validate,format}.log`。初次结构试验发现 Web 隐藏后滚动容器高度为零，新增显示空间断言捕获；最终以独立页面容器和百分比滚动高度修复后通过，未把中间布局测试失败改写为成功。

Android 复验尝试失败：宿主用户无 KVM 权限；随后在隔离 Docker 内挂载 KVM，模拟器 37.2/API34、35.6/API34 的 SwiftShader 与 GPU off 尝试均能启动系统，但在既有 Debug 宿主加载时以 139 退出，未进入插件页。日志 `/tmp/bili-stability-emulator.log`、`/tmp/bili-stability-android*.log`。Not run：本批插件在 Android 原生界面的交互/截图验收、Flutter/iOS/HarmonyOS、真实 B 站账号导入下载。原生 bundle 编译通过不替代这些检查。未提交或推送。

最终文件指纹表：`/tmp/bili-stability/worktree.json`；截图保存在测试 Chrome 容器 `/tmp/bili-stability-settings.png`。
