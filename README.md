# Codex Status Service

English | [中文](#codex-状态服务)

A lightweight local Node.js service for reading OpenAI Codex CLI usage status.

It starts the Codex CLI in a pseudo terminal, automatically runs `/status`, parses the 5-hour and weekly usage limits, exposes a small HTTP API, writes the latest status to a JSON file, and refreshes automatically after the daily reset time.

> **Disclaimer:** This is an unofficial, community-built tool. It is not affiliated with, endorsed by, or sponsored by OpenAI. "OpenAI" and "Codex" are trademarks of OpenAI, Inc. This project does not modify, redistribute, or reverse-engineer any OpenAI proprietary code. It automates terminal interactions that the user would otherwise perform manually. Use at your own risk.

## Features

* Starts Codex CLI automatically
* Sends `/status` automatically
* Parses:
  * 5-hour usage percentage
  * Weekly usage percentage
  * Daily reset time
  * Weekly reset time
  * Last update time
* **Built-in error detection and diagnostics:**
  * Codex not logged in (`not_logged_in`)
  * Codex UI changed / parser cannot find status panel (`ui_changed`)
  * Codex command failed to start (`command_failed`)
  * Refresh timed out (`refresh_timeout`)
  * Terminal blocked by an unexpected prompt (`terminal_blocked`)
* Prints every execution step in the terminal (English)
* Provides a simple HTTP API
* Supports manual refresh
* Automatically refreshes every 15 minutes
* Automatically refreshes after the daily reset time
* Writes status to `codex-usage.json`
* Does not write raw Codex debug output
* Keeps API response small and stable
* Designed to continue running even if refresh fails

## API Response

All status APIs return the same JSON structure:

```json
{
  "five_hour_left_percent": 99,
  "weekly_left_percent": 73,
  "reset_today": "19:36",
  "reset_weekly": "08:40 on 25 Jun",
  "updated_at": "2026-06-22T06:40:30.342Z",
  "error": null,
  "error_detail": null
}
```

Field description:

| Field                    |          Type | Description                                      |
| ------------------------ | ------------: | ------------------------------------------------ |
| `five_hour_left_percent` | number | null | Remaining percentage of the 5-hour Codex limit   |
| `weekly_left_percent`    | number | null | Remaining percentage of the weekly Codex limit   |
| `reset_today`            | string | null | Daily reset time, for example `19:36`            |
| `reset_weekly`           | string | null | Weekly reset time, for example `08:40 on 25 Jun` |
| `updated_at`             | string | null | Last successful update time in ISO format        |
| `error`                  | string | null | Error type code (see Error Types below)          |
| `error_detail`           | string | null | Human-readable error description                 |

## Error Types

When something goes wrong, the `error` field will contain one of the following codes:

| Error Code        | Description                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `not_logged_in`   | Codex is not authenticated. Run `codex auth login` in your terminal to log in.                        |
| `ui_changed`      | The `/status` command was sent but the parser could not find the expected panel. Codex UI may have changed. |
| `command_failed`  | The Codex command failed to start. Make sure Codex CLI is installed and available in PATH.             |
| `refresh_timeout` | The refresh exceeded the 90-second hard timeout. This may indicate network issues or CLI problems.     |
| `terminal_blocked`| The terminal is blocked by an unexpected prompt that the service cannot auto-dismiss.                  |

When the error is resolved and the next refresh succeeds, the `error` and `error_detail` fields will automatically return to `null`.

## Requirements

* Node.js 18 or later
* Codex CLI installed and available in your terminal
* A logged-in Codex account
* `node-pty`
* `strip-ansi`

## Installation

Clone the repository:

```bash
git clone https://github.com/your-name/codex-status.git
cd codex-status
```

Install dependencies:

```bash
npm install
```

Install required packages manually if needed:

```bash
npm install node-pty strip-ansi
```

## package.json

Add the following script to your `package.json`:

```json
{
  "scripts": {
    "codex": "node main.js"
  },
  "dependencies": {
    "node-pty": "^1.0.0",
    "strip-ansi": "^7.1.0"
  }
}
```

## Usage

Start the service:

```bash
npm run codex
```

After startup, the terminal will print each step:

```text
[2026-06-22T06:40:12.000Z] Codex status service started {"port":3000,"periodic_refresh_min":15}
[2026-06-22T06:40:12.100Z] Starting Codex status refresh {"trigger":"startup"}
[2026-06-22T06:40:12.101Z] Spawning codex command {"command":"codex"}
[2026-06-22T06:40:15.120Z] Codex main UI detected
[2026-06-22T06:40:17.621Z] Preparing to send /status command
[2026-06-22T06:40:18.430Z] Submitting slash command {"command":"/status"}
[2026-06-22T06:40:20.331Z] Status panel detected in output
[2026-06-22T06:40:30.338Z] Parsing 5h limit
[2026-06-22T06:40:30.340Z] Parsing weekly limit
[2026-06-22T06:40:30.342Z] Status updated
[2026-06-22T06:40:30.343Z] Auto-refresh scheduled after reset
[2026-06-22T06:40:30.344Z] Starting periodic refresh timer {"interval_ms":900000,"interval_min":15}
```

If an error is detected, you will see diagnostic messages like:

```text
[2026-06-22T06:40:15.000Z] Login issue detected: Codex is not logged in (matched: "not logged in"). Please run 'codex auth login' in your terminal first.
[2026-06-22T06:40:15.001Z] Terminal may be blocked by an unexpected prompt (matched: "Are you sure"). Check the terminal output.
```

The service keeps running. Do not close the terminal if you want automatic refresh to work.

## HTTP API

The service runs on port `3000` by default.

### Get current status

```bash
curl http://localhost:3000/status
```

Browser:

```text
http://localhost:3000/status
```

Example response:

```json
{
  "five_hour_left_percent": 99,
  "weekly_left_percent": 73,
  "reset_today": "19:36",
  "reset_weekly": "08:40 on 25 Jun",
  "updated_at": "2026-06-22T06:40:30.342Z",
  "error": null,
  "error_detail": null
}
```

Example response with error:

```json
{
  "five_hour_left_percent": null,
  "weekly_left_percent": null,
  "reset_today": null,
  "reset_weekly": null,
  "updated_at": "2026-06-22T06:40:30.342Z",
  "error": "not_logged_in",
  "error_detail": "Codex requires authentication. Detected login prompt: \"not logged in\". Run 'codex auth login' to fix this."
}
```

### Refresh manually

You can refresh manually from the browser:

```text
http://localhost:3000/refresh
```

Or with `curl`:

```bash
curl http://localhost:3000/refresh
```

You can also use `POST`:

```bash
curl -X POST http://localhost:3000/refresh
```

The `/refresh` endpoint starts a new Codex `/status` read, updates the local JSON file, and returns the latest parsed status.

### Health check

```bash
curl http://localhost:3000/health
```

Example response:

```json
{
  "ok": true,
  "status": {
    "five_hour_left_percent": 99,
    "weekly_left_percent": 73,
    "reset_today": "19:36",
    "reset_weekly": "08:40 on 25 Jun",
    "updated_at": "2026-06-22T06:40:30.342Z",
    "error": null,
    "error_detail": null
  }
}
```

## Output File

The latest status is written to:

```text
codex-usage.json
```

Example:

```json
{
  "five_hour_left_percent": 99,
  "weekly_left_percent": 73,
  "reset_today": "19:36",
  "reset_weekly": "08:40 on 25 Jun",
  "updated_at": "2026-06-22T06:40:30.342Z",
  "error": null,
  "error_detail": null
}
```

This file can be used by other local scripts, dashboards, widgets, or monitoring tools.

## Environment Variables

### PORT

Change the HTTP server port:

```bash
PORT=4000 npm run codex
```

On Windows PowerShell:

```powershell
$env:PORT=4000
npm run codex
```

Then visit:

```text
http://localhost:4000/status
```

## Auto Refresh Behavior

The service has two automatic refresh mechanisms:

### Periodic refresh (every 15 minutes)

The service automatically refreshes the status every 15 minutes. This keeps the usage data up to date without any manual intervention.

If a refresh is already in progress when the periodic timer fires, it will be skipped (the existing refresh takes priority).

### Reset-time refresh

The service also parses the `reset_today` value from Codex `/status`.

For example:

```text
5h limit: 99% left (resets 19:36)
```

If `reset_today` is `19:36`, the service schedules an automatic refresh at:

```text
19:36 + 30 seconds
```

The extra delay helps avoid refreshing too early before Codex has updated the usage data.

## Important Notes

### The service must stay running

Automatic refresh only works while the Node.js process is alive.

If you close the terminal, the service stops and automatic refresh will not happen.

### `/refresh` may take time

The `/refresh` endpoint starts Codex, waits for the UI, sends `/status`, parses the result, and then returns the data.

This may take several seconds.

### Stable response structure

Even if Codex fails to start, times out, or parsing fails, the API will still return the same JSON structure.

If no valid data has been parsed yet, fields may be `null`.

Example:

```json
{
  "five_hour_left_percent": null,
  "weekly_left_percent": null,
  "reset_today": null,
  "reset_weekly": null,
  "updated_at": null,
  "error": null,
  "error_detail": null
}
```

### Error auto-recovery

When an error is detected (e.g., `not_logged_in`), the `error` field is set immediately. Once the issue is resolved and the next refresh succeeds, the `error` and `error_detail` fields will automatically clear.

## Troubleshooting

### `codex` command not found

Make sure Codex CLI is installed and available in your terminal.

Check:

```bash
codex --version
```

If this command fails, install or configure Codex CLI first.

### Port already in use

If port `3000` is already used, start the service on another port:

```bash
PORT=4000 npm run codex
```

### `/refresh` returns null values

Check the `error` field in the response for a specific error code. Possible values:

| Error Code        | What to Do                                                     |
| ----------------- | -------------------------------------------------------------- |
| `not_logged_in`   | Run `codex auth login` in your terminal, then restart the service. |
| `ui_changed`      | The Codex UI layout may have changed. Check the Codex CLI version and consider updating this tool. |
| `command_failed`  | Make sure `codex` (or `codex.cmd` on Windows) is installed and in your PATH. |
| `refresh_timeout` | Check your network connection, Codex CLI status, and login state. |
| `terminal_blocked`| An unexpected prompt is blocking the terminal. Check the terminal output and dismiss it manually. |

You can also check the terminal log for detailed diagnostic messages.

### node-pty installation fails

`node-pty` is a native package and may require build tools.

On Windows, install the required build tools for Node.js native modules.

Try:

```bash
npm install --global windows-build-tools
```

Or use a Node.js version supported by your current `node-pty` version.

## Recommended .gitignore

```gitignore
node_modules/
codex-usage.json
.env
.DS_Store
```

## Example Project Structure

```text
codex-status/
├── main.js
├── package.json
├── README.md
└── .gitignore
```

## License

MIT

## Legal Disclaimer

This project is an **unofficial, independent tool** created for personal use. It is:

* **Not affiliated with** OpenAI
* **Not endorsed by** OpenAI
* **Not sponsored by** OpenAI

"OpenAI" and "Codex" are trademarks of OpenAI, Inc. All rights to these trademarks belong to their respective owners.

This tool does **not**:

* Modify or redistribute OpenAI's proprietary code
* Reverse-engineer or decompile any OpenAI software
* Bypass authentication or security measures
* Access OpenAI servers directly (it only interacts with the locally installed Codex CLI)
* Collect, store, or transmit user data to any third party

This tool **does**:

* Automate terminal interactions that the user would otherwise perform manually
* Read the user's own local terminal output from the Codex CLI
* Parse and expose the user's own usage status for personal monitoring

By using this tool, you acknowledge that you are responsible for complying with OpenAI's Terms of Service and any applicable laws in your jurisdiction.

---

# Codex 状态服务

[English](#codex-status-service) | 中文

这是一个轻量级本地 Node.js 服务，用于读取 OpenAI Codex CLI 的用量状态。

它会在伪终端中启动 Codex CLI，自动执行 `/status`，解析 5 小时额度和每周额度，提供 HTTP 接口，将最新状态写入 JSON 文件，并在当天重置时间后自动刷新。

> **免责声明：** 这是一个非官方的社区工具，与 OpenAI 无关，也未获得 OpenAI 的认可或赞助。"OpenAI" 和 "Codex" 是 OpenAI, Inc. 的商标。本项目不修改、重新分发或逆向工程任何 OpenAI 专有代码，仅自动化用户原本需要手动执行的终端操作。使用风险自负。

## 功能特性

* 自动启动 Codex CLI
* 自动发送 `/status`
* 自动解析：
  * 5 小时额度剩余百分比
  * 每周额度剩余百分比
  * 当天重置时间
  * 每周重置时间
  * 更新时间
* **内置错误检测和诊断：**
  * Codex 未登录（`not_logged_in`）
  * Codex UI 改版 / 解析器找不到 status 面板（`ui_changed`）
  * Codex 命令启动失败（`command_failed`）
  * 刷新超时（`refresh_timeout`）
  * 终端被未知提示阻塞（`terminal_blocked`）
* 终端打印每一步执行状态（英文日志）
* 提供简单的 HTTP API
* 支持手动刷新
* 每 15 分钟自动刷新一次
* 到当天重置时间后自动刷新
* 自动写入 `codex-usage.json`
* 不输出原始 Codex debug 文件
* API 返回结构简洁稳定
* 刷新失败时服务也会尽量保持运行

## API 返回格式

所有状态接口都会返回相同的 JSON 结构：

```json
{
  "five_hour_left_percent": 99,
  "weekly_left_percent": 73,
  "reset_today": "19:36",
  "reset_weekly": "08:40 on 25 Jun",
  "updated_at": "2026-06-22T06:40:30.342Z",
  "error": null,
  "error_detail": null
}
```

字段说明：

| 字段                       |            类型 | 说明                          |
| ------------------------ | ------------: | --------------------------- |
| `five_hour_left_percent` | number | null | 5 小时 Codex 额度剩余百分比          |
| `weekly_left_percent`    | number | null | 每周 Codex 额度剩余百分比            |
| `reset_today`            | string | null | 当天重置时间，例如 `19:36`           |
| `reset_weekly`           | string | null | 每周重置时间，例如 `08:40 on 25 Jun` |
| `updated_at`             | string | null | 最近一次更新时间，ISO 格式             |
| `error`                  | string | null | 错误类型代码（见下方错误类型说明）         |
| `error_detail`           | string | null | 可读的错误描述                      |

## 错误类型

当出现问题时，`error` 字段会包含以下代码之一：

| 错误代码              | 说明                                                              |
| ----------------- | --------------------------------------------------------------- |
| `not_logged_in`   | Codex 未登录。请在终端中运行 `codex auth login` 登录。                        |
| `ui_changed`      | `/status` 命令已发送但解析器找不到预期的面板。Codex UI 可能已改版。                  |
| `command_failed`  | Codex 命令启动失败。请确认 Codex CLI 已安装并可在 PATH 中找到。                  |
| `refresh_timeout` | 刷新超过了 90 秒硬超时。可能是网络问题或 CLI 异常。                               |
| `terminal_blocked`| 终端被未知的提示阻塞，服务无法自动处理。                                      |

当问题解决后，下次成功刷新时 `error` 和 `error_detail` 会自动恢复为 `null`。

## 环境要求

* Node.js 18 或更高版本
* 已安装 Codex CLI，并且可以在终端中直接使用
* Codex 已登录账号
* `node-pty`
* `strip-ansi`

## 安装

克隆仓库：

```bash
git clone https://github.com/your-name/codex-status.git
cd codex-status
```

安装依赖：

```bash
npm install
```

如果需要，也可以手动安装依赖：

```bash
npm install node-pty strip-ansi
```

## package.json

在 `package.json` 中添加：

```json
{
  "scripts": {
    "codex": "node main.js"
  },
  "dependencies": {
    "node-pty": "^1.0.0",
    "strip-ansi": "^7.1.0"
  }
}
```

## 使用方法

启动服务：

```bash
npm run codex
```

启动后，终端会打印每一步执行状态：

```text
[2026-06-22T06:40:12.000Z] Codex status service started {"port":3000,"periodic_refresh_min":15}
[2026-06-22T06:40:12.100Z] Starting Codex status refresh {"trigger":"startup"}
[2026-06-22T06:40:12.101Z] Spawning codex command {"command":"codex"}
[2026-06-22T06:40:15.120Z] Codex main UI detected
[2026-06-22T06:40:17.621Z] Preparing to send /status command
[2026-06-22T06:40:18.430Z] Submitting slash command {"command":"/status"}
[2026-06-22T06:40:20.331Z] Status panel detected in output
[2026-06-22T06:40:30.338Z] Parsing 5h limit
[2026-06-22T06:40:30.340Z] Parsing weekly limit
[2026-06-22T06:40:30.342Z] Status updated
[2026-06-22T06:40:30.343Z] Auto-refresh scheduled after reset
[2026-06-22T06:40:30.344Z] Starting periodic refresh timer {"interval_ms":900000,"interval_min":15}
```

如果检测到错误，你会看到类似这样的诊断信息：

```text
[2026-06-22T06:40:15.000Z] Login issue detected: Codex is not logged in (matched: "not logged in"). Please run 'codex auth login' in your terminal first.
[2026-06-22T06:40:15.001Z] Terminal may be blocked by an unexpected prompt (matched: "Are you sure"). Check the terminal output.
```

服务会一直运行。如果你希望自动刷新生效，请不要关闭终端。

## HTTP API

服务默认运行在 `3000` 端口。

### 获取当前状态

```bash
curl http://localhost:3000/status
```

浏览器访问：

```text
http://localhost:3000/status
```

返回示例：

```json
{
  "five_hour_left_percent": 99,
  "weekly_left_percent": 73,
  "reset_today": "19:36",
  "reset_weekly": "08:40 on 25 Jun",
  "updated_at": "2026-06-22T06:40:30.342Z",
  "error": null,
  "error_detail": null
}
```

带错误的返回示例：

```json
{
  "five_hour_left_percent": null,
  "weekly_left_percent": null,
  "reset_today": null,
  "reset_weekly": null,
  "updated_at": "2026-06-22T06:40:30.342Z",
  "error": "not_logged_in",
  "error_detail": "Codex requires authentication. Detected login prompt: \"not logged in\". Run 'codex auth login' to fix this."
}
```

### 手动刷新

可以直接用浏览器访问：

```text
http://localhost:3000/refresh
```

也可以使用 `curl`：

```bash
curl http://localhost:3000/refresh
```

也支持 `POST` 请求：

```bash
curl -X POST http://localhost:3000/refresh
```

`/refresh` 会重新读取一次 Codex `/status`，更新本地 JSON 文件，并返回最新解析后的状态。

### 健康检查

```bash
curl http://localhost:3000/health
```

返回示例：

```json
{
  "ok": true,
  "status": {
    "five_hour_left_percent": 99,
    "weekly_left_percent": 73,
    "reset_today": "19:36",
    "reset_weekly": "08:40 on 25 Jun",
    "updated_at": "2026-06-22T06:40:30.342Z",
    "error": null,
    "error_detail": null
  }
}
```

## 输出文件

最新状态会写入：

```text
codex-usage.json
```

示例：

```json
{
  "five_hour_left_percent": 99,
  "weekly_left_percent": 73,
  "reset_today": "19:36",
  "reset_weekly": "08:40 on 25 Jun",
  "updated_at": "2026-06-22T06:40:30.342Z",
  "error": null,
  "error_detail": null
}
```

这个文件可以给其他本地脚本、仪表盘、小组件或监控工具使用。

## 环境变量

### PORT

修改 HTTP 服务端口：

```bash
PORT=4000 npm run codex
```

Windows PowerShell：

```powershell
$env:PORT=4000
npm run codex
```

然后访问：

```text
http://localhost:4000/status
```

## 自动刷新逻辑

服务有两种自动刷新机制：

### 定时刷新（每 15 分钟）

服务会每 15 分钟自动刷新一次用量数据，无需手动干预。

如果定时器触发时上一次刷新还在进行中，本轮会被跳过（已有的刷新任务优先执行）。

### 重置时间刷新

服务也会从 Codex `/status` 中解析 `reset_today`。

例如：

```text
5h limit: 99% left (resets 19:36)
```

如果 `reset_today` 是 `19:36`，服务会自动在下面这个时间刷新：

```text
19:36 + 30 秒
```

额外等待 30 秒是为了避免刚到重置时间，Codex 后端数据还没有及时更新。

## 注意事项

### 服务必须保持运行

自动刷新只有在 Node.js 进程存活时才会执行。

如果关闭终端，服务会停止，自动刷新也不会发生。

### `/refresh` 可能需要等待几秒

`/refresh` 会启动 Codex，等待 UI 就绪，发送 `/status`，解析结果，然后返回数据。

这个过程可能需要几秒钟。

### 返回结构固定

即使 Codex 启动失败、超时或解析失败，API 仍会尽量返回相同的 JSON 结构。

如果还没有解析到有效数据，字段可能是 `null`。

### 错误自动恢复

当检测到错误（如 `not_logged_in`）时，`error` 字段会立即设置。问题解决后，下次成功刷新时 `error` 和 `error_detail` 会自动清除。

## 常见问题

### `codex` 命令不存在

请确认 Codex CLI 已安装，并且可以在终端中直接使用。

检查命令：

```bash
codex --version
```

如果这个命令失败，请先安装或配置 Codex CLI。

### 端口被占用

如果 `3000` 端口已被占用，可以换一个端口启动：

```bash
PORT=4000 npm run codex
```

### `/refresh` 返回 null

查看返回 JSON 中的 `error` 字段获取具体的错误代码：

| 错误代码              | 解决方法                                              |
| ----------------- | ------------------------------------------------- |
| `not_logged_in`   | 在终端中运行 `codex auth login`，然后重启服务。                  |
| `ui_changed`      | Codex UI 可能已改版。检查 Codex CLI 版本，考虑更新本工具。         |
| `command_failed`  | 确认 `codex`（Windows 上是 `codex.cmd`）已安装并在 PATH 中。 |
| `refresh_timeout` | 检查网络连接、Codex CLI 状态和登录情况。                      |
| `terminal_blocked`| 终端被未知提示阻塞。查看终端输出并手动关闭提示。                        |

也可以查看终端中的日志输出，获取详细的诊断信息。

### node-pty 安装失败

`node-pty` 是原生模块，可能需要本地编译环境。

Windows 上可能需要安装 Node.js 原生模块构建工具。

可以尝试：

```bash
npm install --global windows-build-tools
```

或者切换到当前 `node-pty` 支持的 Node.js 版本。

## 推荐 .gitignore

```gitignore
node_modules/
codex-usage.json
.env
.DS_Store
```

## 推荐项目结构

```text
codex-status/
├── main.js
├── package.json
├── README.md
└── .gitignore
```

## 许可证

MIT

## 法律免责声明

本项目是一个**非官方的独立工具**，仅供个人使用。它：

* **与 OpenAI 无关**
* **未获得 OpenAI 认可**
* **未获得 OpenAI 赞助**

"OpenAI" 和 "Codex" 是 OpenAI, Inc. 的商标。这些商标的所有权利归其各自所有者所有。

本工具**不会**：

* 修改或重新分发 OpenAI 的专有代码
* 逆向工程或反编译任何 OpenAI 软件
* 绕过认证或安全措施
* 直接访问 OpenAI 服务器（仅与本地安装的 Codex CLI 交互）
* 收集、存储或向任何第三方传输用户数据

本工具**会**：

* 自动化用户原本需要手动执行的终端操作
* 读取用户本地 Codex CLI 的终端输出
* 解析并展示用户自己的用量状态，用于个人监控

使用本工具即表示你有责任遵守 OpenAI 的服务条款以及你所在司法管辖区的适用法律。
