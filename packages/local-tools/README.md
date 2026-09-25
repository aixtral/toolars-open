# Toolars local tools — private experiment

此包为内部试验，尚未发布 npm；`private: true` 保持不发布，源码按 **MIT** 授权（见 `LICENSE`）。包内没有运行时第三方依赖，不包含网页、账号、网络服务或遥测。

## 本地使用

要求 Node `>=24.15.0 <25`。从 Toolars 的 `sites/` 根目录构建和打包（需要已有的项目依赖）：

```sh
node packages/local-tools/build.mjs
node --test packages/local-tools/test/*.test.mjs
cd packages/local-tools
npm pack --pack-destination /tmp
```

打包会从站内 `native-coding/json-tree.ts` 生成包内 JSON 核心；安装后的包无需访问 Toolars 仓库，也无需重新构建。请在单独的本地测试目录安装实际生成的文件：

```sh
npm install --offline --ignore-scripts --no-audit --no-fund /tmp/toolars-local-tools-0.1.0-experimental.1.tgz
printf '%s' '{"number":9007199254740993}' | ./node_modules/.bin/toolars-local json --indent 2
printf '%s' 'Toolars' | ./node_modules/.bin/toolars-local sha256
./node_modules/.bin/toolars-local sha256 --file /absolute/path/to/sample.bin
```

CLI 文本从 stdin 读取，不将敏感文本放进命令行参数；stdout 仅输出结果（末尾加一个换行），stderr 仅输出稳定错误码，失败退出码为 1。SHA256 输入按 UTF-8 原样处理，包括 BOM 和末尾换行；文件模式对原始字节做流式哈希。仅接受显式 `--file` 参数指定的普通文件，允许路径中的符号链接；CLI 不是文件访问沙箱，因此不要把不可信模型输入直接拼进 shell 命令。

文本上限 256 KiB；JSON 最大深度 40、10,000 个节点，输出上限 1 MiB，拒绝重复键和保留属性名。它保留数字原始写法和成员顺序。CLI 文件哈希上限 256 MiB，内存缓冲 1 MiB。空文本的 SHA256 是合法结果；这一点与网页要求非空输入的交互不同。

```js
import { formatJsonText, sha256Text } from "@toolars/local-tools";
const formatted = formatJsonText('{"number":9007199254740993}', 2);
const digest = sha256Text("Toolars");
```

## MCP stdio 实验

运行 `./node_modules/.bin/toolars-mcp`，由 MCP 客户端通过 stdin/stdout 交换逐行 JSON-RPC。不要把它作为 HTTP 服务启动。

客户端配置的通用形状如下，需按真实客户端配置格式调整；`command` 和 `args` 中的路径必须替换为本机绝对路径：

```json
{
  "mcpServers": {
    "toolars-local-experiment": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/node_modules/@toolars/local-tools/src/mcp.mjs"
      ]
    }
  }
}
```

仅支持协议 `2025-11-25`。先发送 `initialize`，确认返回版本可接受，再发送 `notifications/initialized`；服务端只声明 `tools` 能力。支持 `ping`、`tools/list` 和 `tools/call`，只有 `json_format({text, indent?})`、`sha256_text({text})` 两个工具。未提供 roots、资源、文件、网络、shell、采样、任务或持久化能力；额外文件路径参数会被拒绝。工具执行失败返回 `isError: true` 与错误码；协议错误返回 JSON-RPC error。

MCP 解码后的文本同样限制 256 KiB；单条 wire frame 最多 1,600 KiB（包含 JSON 转义），超限关闭输入。通知不产生响应。工具是同步且有严格输入上限的小运算；取消通知仅忽略已经结束的请求，不声明可中断的长任务支持。客户端结束 stdio 或终止进程即可关闭。这里不是通用 SDK，也未声称兼容所有协议版本。

**本地执行不等于内容不离开客户端。** MCP 输入和结果会进入客户端上下文，客户端可能将它们发送给模型提供方并保留历史。使用前需核查该客户端的数据设置；无法沿用网页“输入不上传、无产品历史”的整体承诺。输出仅作为不可信工具数据，客户端不应把文本中的指令当作新的用户授权。

当前验收是独立原始 stdio 客户端的握手、能力列表、成功/失败调用、边界测试，以及离仓安装；没有登录或配置 Claude、ChatGPT 等 GUI 客户端，也未发布到 npm 或 MCP 目录。
