# weread-omni

简体中文 | [English](README.en.md)

[更新日志](CHANGELOG.md) | [安全政策](SECURITY.md)

weread-omni 是微信读书的全能智能体技能和非官方 SDK。微信扫码即可用，支持 40 项读写操作，远超官方支持的 6 项只读技能。

40 项操作只有一套实现，三个入口共用：`weread-omni` 命令行，每条命令都能输出 JSON；一套类型完整的 TypeScript SDK；还有仓库自带的 agent skill。

这是一个非官方项目，与腾讯及微信读书没有隶属关系，也未获得其认可或支持。

## 和官方 Skill 的比较

微信读书官方在 2026 年 5 月开放了 Agent Skill，用 API Key 提供六项能力：查阅书架、搜索书籍、阅读统计、书籍详情、笔记划线、推荐好书。这些 weread-omni 都有，另外还多做了几件官方没开放的事。

| | 官方 Skill | weread-omni |
| --- | :---: | :---: |
| 书架、搜索、阅读统计、书籍详情、笔记划线、推荐 | ✅ | ✅ |
| 新增、修改、删除自己的划线和点评 | ❌ | ✅ |
| 导入 EPUB、PDF、MOBI、TXT、AZW3 | ❌ | ✅ |
| 公众号与文章 | ❌ | ✅ |
| 微信读书 AI | ❌ | ✅ |

## 快速开始

需要 Node.js `>=22.13.0`，以及一个已开通微信读书的微信账号。

```bash
npm install --global weread-omni
weread-omni login --json
weread-omni doctor --json
weread-omni search books "三体" --json
```

`weread-omni login` 显示一个二维码，用微信读书账号扫一次即可。

登录成功后的 JSON 只包含账号别名、客户端 ID、`vid` 和设备 ID，不包含任何令牌。`weread-omni doctor` 会核对当前安装和登录状态，并发起一次只读请求确认连接正常。


### 账号与登录信息

第一次不带 `--account` 登录时，账号别名为 `default`。要添加其他账号，可以自己指定别名：

```bash
weread-omni --account work login --json
weread-omni accounts --json
weread-omni accounts use work --json
weread-omni --account default shelf sync --json
```

账号别名的首字符必须是小写字母或数字，后面可以使用小写字母、数字、`-` 和 `_`，总长不超过 64 个字符。命令没有指定 `--account` 时，只有一个账号就直接使用它；有多个账号时，先读取 `WEREAD_ACCOUNT`，再读取 `weread-omni accounts use <alias>` 保存的默认账号。两者都没有设置时，命令会要求你明确选择。

登录信息默认保存在 `~/.config/weread/accounts/<alias>/`。目录权限为 `0700`，文件权限为 `0600`。设置 `WEREAD_CONFIG_DIR` 可以更改配置目录。项目读取的 `WEREAD_*` 变量都列在 [`.env.example`](https://github.com/teng-lin/weread-omni/blob/v0.1.0/.env.example) 中。

### 安装 agent skill

仓库附带的 `weread-omni` skill 会告诉 agent 怎样检查登录状态、调用 JSON CLI、正确翻页，并在写操作前向你确认。它不会安装 `weread-omni` 命令，因此要先完成上面的安装和登录。

使用 [skills CLI](https://github.com/vercel-labs/skills) 安装：

```bash
npx skills add teng-lin/weread-omni --skill weread
```

也可以直接全局安装到 Codex 和 Claude Code：

```bash
npx skills add teng-lin/weread-omni --skill weread --global --agent codex --agent claude-code --yes
```

查看或更新项目内安装的 skill：

```bash
npx skills list
npx skills update weread
```

全局安装时，这两条命令也要加 `--global`。

## 常用命令

所有命令都支持 `--json`。给 agent 调用时建议始终使用 JSON 输出。完整参数以 `weread-omni <命令> --help` 为准。

### 搜索与阅读

```bash
weread-omni search books "三体" --json
weread-omni book info BOOK_ID --json
weread-omni book chapters BOOK_ID --json
weread-omni notes bookmarks BOOK_ID --json
weread-omni read-data detail --mode annually --json
weread-omni discover similar BOOK_ID --json
weread-omni ai ask-book BOOK_ID "这本书的核心论点是什么？" --json
```

`book chapters` 返回后续命令需要的 `chapterUid`。

### 书架、划线与点评

```bash
weread-omni shelf sync --count 50 --json
weread-omni shelf add BOOK_ID --json
weread-omni shelf mark-reading BOOK_ID --json

weread-omni notes add-bookmark BOOK_ID CHAPTER_UID "1-20" "要划线的原文" --json
weread-omni review add BOOK_ID "读完后的想法" --star 80 --json
```

`shelf pin`、`set-private`、`mark-finished` 和 `mark-reading` 默认会置顶、设为私密、标记读完或标记在读。分别加 `--no-top`、`--no-secret`、`--no-finished` 或 `--no-reading` 可以取消对应状态。点评星级只能填 `20`、`40`、`60`、`80`、`100`，对应一到五星。

### 公众号 Feed 与导出

订阅前先搜索并核对准确的 `MP_WXS_<数字>` ID：

```bash
weread-omni search books "公众号名称" --scope 2 --json
weread-omni public-accounts subscribe MP_WXS_1234567890 --json
weread-omni public-accounts articles MP_WXS_1234567890 --count 20 --json

weread-omni public-accounts feed MP_WXS_1234567890 --format json --out ./account.feed.json --limit 50 --json
weread-omni public-accounts feed subscriptions --format rss --out ./subscriptions.xml --limit 50 --json
weread-omni public-accounts export MP_WXS_1234567890 --out ./account-archive --limit 100 --json
```

Feed 和导出默认处理 20 篇文章，`--limit` 最大为 100。命令不会覆盖已有文件或目录。文章正文只会从经过校验的 HTTPS `mp.weixin.qq.com/s` 地址下载；遇到 JavaScript 验证或验证码时会把情况记进诊断信息，不会尝试绕过。

### 导入个人书籍

```bash
weread-omni import book ./my-book.epub --json
```

支持 EPUB、PDF、MOBI、TXT 和 AZW3。单个文件默认不超过 200 MiB，可以用 `WEREAD_MAX_UPLOAD_BYTES` 调整。

## 本地内容库

CLI 默认把图书信息、目录和已经下载的公众号文章保存到本地。再次读取相同内容时会直接使用本地副本。

```bash
weread-omni library path --json
weread-omni library status --json
weread-omni library verify --json
```

| 选项 | 作用 |
| --- | --- |
| `--refresh` | 重新下载并更新本地内容 |
| `--no-library` | 本次命令不读写本地内容库 |

内容库默认位于 `$XDG_DATA_HOME/weread/library`；没有设置 `XDG_DATA_HOME` 时，使用 `~/.local/share/weread/library`。`WEREAD_LIBRARY_DIR` 可以更改位置。内容按账号建立索引，相同文件只保存一份，不会自动清理旧内容。

本地内容库里的阅读内容是明文存的，不含登录信息，但同样要按敏感数据对待。内容库依赖 SQLite WAL；文件系统不支持时，CLI 会给出警告并继续执行，但不再使用本地内容库。确认只有一个进程写入时，可以用 `WEREAD_LIBRARY_ALLOW_UNSAFE=1` 跳过这项检查。

## CLI 参考

这是命令索引。所有命令都接受全局选项；每个子命令的参数、默认值和取值范围以 `--help` 输出为准。

| 全局选项 | 作用 |
| --- | --- |
| `-V, --version` | 显示当前版本 |
| `--json` | 输出原始 JSON |
| `--account <name>` | 选择账号 |
| `--no-library` | 本次命令不使用本地内容库 |
| `--refresh` | 忽略已有副本，重新下载内容 |

### 账号与本地管理

| 命令 | 用途 |
| --- | --- |
| `weread-omni login` | 登录或重新登录所选账号 |
| `weread-omni accounts` | 列出账号及客户端 ID |
| `weread-omni accounts use <alias>` | 设置省略 `--account` 时默认用哪个账号 |
| `weread-omni whoami` | 显示所选账号的身份信息：`vid`、设备 ID 和凭据来源，不含令牌 |
| `weread-omni doctor` | 检查安装、登录和连接状态 |
| `weread-omni library path` | 显示本地内容库路径 |
| `weread-omni library status` | 统计本地内容库中的内容 |
| `weread-omni library verify` | 检查数据库和已保存文件 |

### 图书与书架

| 命令 | 用途 |
| --- | --- |
| `weread-omni search books <keyword> [--scope <n>] [--count <n>] [--max-idx <n>]` | 搜索书城，默认范围为电子书 |
| `weread-omni search suggest <keyword> [--count <n>]` | 获取搜索自动补全词 |
| `weread-omni book info <bookId>` | 查看图书信息 |
| `weread-omni book detail <bookId> [--count <n>]` | 查看书籍配图，以及同作者、同出版社、同版权方、同分类的书单 |
| `weread-omni book chapters <bookId>` | 查看目录 |
| `weread-omni book progress <bookId>` | 查看阅读进度 |
| `weread-omni shelf sync [--count <n>] [--offset <n>] [--full]` | 分页查看精简书架；`--full` 返回原始响应 |
| `weread-omni shelf add <bookId>` | 加入书架 |
| `weread-omni shelf delete <bookId> [-y, --yes]` | 从书架删除 |
| `weread-omni shelf pin <bookId> [--no-top]` | 置顶或取消置顶 |
| `weread-omni shelf set-private <bookId> [--no-secret]` | 设为私密或公开 |
| `weread-omni shelf mark-finished <bookId> [--no-finished]` | 标记读完或撤销 |
| `weread-omni shelf mark-reading <bookId> [--no-reading]` | 标记在读或撤销 |

### 公众号

| 命令 | 用途 |
| --- | --- |
| `weread-omni public-accounts subscriptions [--count <n>] [--offset <n>]` | 分页查看已订阅公众号 |
| `weread-omni public-accounts articles <accountId> [--count <n>] [--synckey <n>] [--offset <n>]` | 分页查看文章；增量刷新可传 `--synckey`，但不能和 `--offset` 同时使用 |
| `weread-omni public-accounts resolve-article <docUrl>` | 从文章链接解析微信读书点评 ID |
| `weread-omni public-accounts paid-content <docUrl>` | 尝试读取有权限的付费文章正文 |
| `weread-omni public-accounts subscribe <accountId>` | 订阅公众号 |
| `weread-omni public-accounts unsubscribe <accountId> [-y, --yes]` | 取消订阅 |
| `weread-omni public-accounts feed <accountId\|subscriptions> --format <rss\|atom\|json> --out <file> [--limit <n>]` | 新建 Feed 文件 |
| `weread-omni public-accounts export <accountId> --out <directory> [--limit <n>]` | 新建文章导出目录 |

### 笔记与点评

| 命令 | 用途 |
| --- | --- |
| `weread-omni notes notebooks [--count <n>] [--last-sort <n>]` | 查看有笔记的书 |
| `weread-omni notes recent [--count <n>]` | 查看最近的笔记和划线 |
| `weread-omni notes bookmarks <bookId> [--synckey <n>]` | 查看自己的划线及原文 |
| `weread-omni notes mine <bookId> [--synckey <n>] [--count <n>]` | 查看自己的笔记 |
| `weread-omni notes best <bookId> [--synckey <n>] [--count <n>] [--max-idx <n>] [--chapter-uid <n>]` | 查看热门划线 |
| `weread-omni notes read-reviews <bookId> <chapterUid> --reviews <json>` | 查看热门划线范围下的想法 |
| `weread-omni notes underlines <bookId> <chapterUid> [--synckey <n>]` | 查看章节划线热度，不含原文 |
| `weread-omni notes add-bookmark <bookId> <chapterUid> <range> <markText> [--type <n>] [--style <n>] [--color-style <n>] [--book-version <n>] [--chapter-name <name>] [--context-abstract <text>]` | 添加划线 |
| `weread-omni notes update-bookmark <bookmarkId> --style <n> [--color-style <n>]` | 修改划线样式 |
| `weread-omni notes remove-bookmark <bookmarkId> [-y, --yes]` | 删除自己的划线 |
| `weread-omni review list <bookId> [--list-type <n>] [--list-mode <n>] [--mine <n>] [--synckey <n>] [--count <n>] [--max-idx <n>]` | 查看点评 |
| `weread-omni review single <reviewId> [--comments-count <n>] [--comments-direction <n>] [--likes-count <n>] [--likes-direction <n>] [--synckey <n>]` | 查看一条想法或点评 |
| `weread-omni review add <bookId> <content> [--star <n>] [--type <n>] [--range <range>] [--abstract <text>] [--chapter-uid <n>]` | 发表点评或想法 |
| `weread-omni review edit <reviewId> <content>` | 修改自己的点评或想法 |
| `weread-omni review delete <reviewId> [-y, --yes]` | 删除点评 |

### 统计、推荐、AI 与导入

| 命令 | 用途 |
| --- | --- |
| `weread-omni read-data detail [--mode <mode>] [--base-time <n>]` | 查看阅读统计 |
| `weread-omni discover recommend [--count <n>] [--max-idx <n>]` | 查看推荐图书 |
| `weread-omni discover similar <bookId> [--count <n>] [--max-idx <n>] [--session-id <id>]` | 查找相似图书 |
| `weread-omni ai ask-book <bookId> <query> [--intent <intent>] [--max-polls <n>] [--delay-cap-ms <ms>]` | 向微信读书 AI 提问 |
| `weread-omni ai suggest <bookId> [--chapter-uid <n>] [--toolbar] [--range <range>] [--mp-review-id <id>]` | 获取建议问题 |
| `weread-omni import book <path>` | 导入个人书籍 |

### 搜索范围与翻页

`search books --scope` 可选：`0` 全部、`10` 电子书（默认）、`16` 网文、`14` 听书、`6` 作者、`12` 全文、`13` 书单、`2` 公众号、`4` 文章。

| 命令 | 下一页怎么取 |
| --- | --- |
| `search books` | `hasMore=1` 时，把最后一项的 `searchIdx` 传给 `--max-idx` |
| `shelf sync`、`public-accounts subscriptions` | 把返回的 `nextOffset` 传给 `--offset` |
| `public-accounts articles` | 首次读取不传 `--offset`；增量刷新时可把上次的 `synckey` 传给 `--synckey`，后续分页使用返回的 `nextOffset` |
| `notes notebooks` | 把最后一项的 `sort` 传给 `--last-sort` |
| `notes best`、`review list` | 按本页返回条数增加 `--max-idx` |

`synckey` 是增量刷新游标，不是页码。`book detail --count` 默认是 6，可取 1–12。

## TypeScript SDK

先用 CLI 登录，再通过 `AccountManager` 打开账号：

```ts
import { AccountManager } from "weread-omni";

const account = await new AccountManager().open("default");
const weread = account.canonical;

const search = await weread.search.books("三体");
const notes = await weread.notes.mine("BOOK_ID", { count: 20 });
```

下表只列操作入口，省略了各方法通用的请求选项。准确类型以包内的 TypeScript 声明为准。

| 资源 | 方法 |
| --- | --- |
| `search` | `books(keyword, options?)`、`suggest(keyword, options?)` |
| `book` | `info(bookId)`、`detail(bookId, options?)`、`chapters(bookId)`、`progress(bookId)` |
| `shelf` | `sync()`、`add(bookId)`、`delete(bookId)`、`pin(bookId, top?)`、`setPrivate(bookId, secret?)`、`markFinished(bookId, finished?)`、`markReading(bookId, reading?)` |
| `publicAccounts` | `subscriptions(options?)`、`articles(accountId, options?)`、`resolveArticle(docUrl, options?)`、`paidContent(docUrl, options?)`、`subscribe(accountId)`、`unsubscribe(accountId)` |
| `notes` | `notebooks(options?)`、`recent(options?)`、`bookmarks(bookId, options?)`、`mine(bookId, options?)`、`best(bookId, options?)`、`readReviews(bookId, chapterUid, reviews, options?)`、`underlines(bookId, chapterUid, options?)`、`addBookmark(input)`、`updateBookmark(input)`、`removeBookmark(bookmarkId, options?)` |
| `review` | `list(bookId, options?)`、`single(reviewId, options?)`、`add(input)`、`edit(reviewId, content, options?)`、`delete(reviewId)` |
| `readData` | `detail(options?)` |
| `discover` | `recommend(options?)`、`similar(bookId, options?)` |
| `ai` | `askBook(input)`、`suggest(input)` |
| `import` | `book({ name, path })` 或 `book({ name, bytes })` |

SDK 默认不输出日志。需要诊断信息时，可以给客户端传入 `logger: console`。令牌过期后，只读请求和明确标记为幂等的请求最多自动重试一次；写请求不会自动重放，因为上游可能已经执行成功。


## 使用限制

- 微信读书的非公开接口可能随时变化。风控、账号权限和内容授权也会影响结果。
- `-2041` 表示需要人工验证，无界面客户端无法完成这一步；不要把它当作令牌过期。
- 本项目不会执行 JavaScript 验证、绕过验证码或伪装浏览器指纹。
- 登录信息和本地内容都属于敏感数据。具体处理方式及漏洞报告渠道见[安全政策](SECURITY.md)。

## 开发

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm test
npm run test:cov
npm run test:e2e
```

单元测试和集成测试不会访问微信读书。`test:e2e` 会打包产物，再模拟用户安装后的使用方式做冒烟测试。

## 法律声明

本项目仅供个人研究和自动化使用。请只操作你自己的账号和有权访问的内容，并遵守微信读书的服务条款及所在地法律。

项目采用 [MIT License](LICENSE)。
