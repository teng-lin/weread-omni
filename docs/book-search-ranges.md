# 书内搜索与标注范围

`book search` 把“原文是什么”和“应该标注在哪里”连接起来。命令只定位，不写入划线或想法。

```bash
weread-omni --account default doctor --json
weread-omni --account default book chapters BOOK_ID --json
weread-omni --account default book search BOOK_ID "exact quote" --chapter-uid CHAPTER_UID --json
```

SDK：`client.book.search(bookId, quote, { chapterUid, signal })`。必须使用目录中的 UID，不是书上印的章号。结果的 `matches` 包含 `range`、`start`、`end`、`markText` 和 `context`；`complete` 表示指定章节的查找是否完整。未命中返回空数组，重复文字返回多个候选。只有上下文能明确选定范围时才继续写入。`source` 和自传书的 `chapterSha256` 可保存为定位依据。

## 两条定位路径

1. 普通书城书籍：`GET /web/book/search_v2` 使用 `bookId`、`chapterUid`、`posBegin`、`posEnd`、`keyword`、`mode=scrollDown` 和 `count=50`。范围来自每个 `matchWords` 的 `posBegin/posEnd`；外层 `posBegin/posEnd` 是摘要范围，不能直接拿去划线。分页使用最后一项的游标；到下一章或服务端明确结束时完成。最多读取 20 页，超过时返回 `complete: false`，不能声称候选唯一。
2. 自传 `CB_` EPUB：实测旧版 `/book/search`、网页版 `/web/book/search_v2` 以及网页搜索 UI 都对目标书返回空结果，因此不能将空结果视为书中没有原文。使用正常阅读接口取当前章节的转换后 HTML，再查找原文并保留源位置。不会使用原始 EPUB 下标，也不借用书城版的位置。

搜索保留大小写。自传书的布局空白合并为一个空格，HTML 实体解码；每个显示字符仍映射到源 HTML 的 UTF-16 范围。范围可以跨内联标签，因此 `end - start` 不一定等于引用文本长度。段落之间不会拼接出一个不存在的短语。脚本、样式、head、显式隐藏内容不参与搜索。

## 自传书协议与容易踩的坑

- 复用所选 E-Ink 账户的现有令牌，通过 `/web/login/session/init` 建立本次调用专用的网页会话。Cookie 仅在内存中使用，只发送到 `https://weread.qq.com`；不从浏览器取凭证，不写入新凭证文件，也不启动浏览器。
- 读取 `/web/reader/{encodedBookId}k{encodedChapterUid}`，取页面给出的 `psvts`。客户端时间 `pc` 必须按网页 ID 算法编码当前 Unix 秒数；直接传 `0` 实测会令正文接口返回 `{}`。这是请求参数错误，不能据此声称账号失效或书籍没有内容。
- `POST /web/book/chapter/e_0`、`e_1`、`e_3` 返回正文片段。`st=0`、`sc=0`；不请求自动付费。请求包含与官方网页一致的参数校验值。每个片段必须先通过 MD5 校验，再按网页协议拼合、还原，并验证有效 UTF-8 和 EPUB body。
- `e_2` 是样式；定位源字符范围无需请求。公开网页脚本中的正文索引也是在转换后 HTML 上建立的。
- 每个响应最多 8 MiB，整个操作受超时和取消信号约束。跳转、认证失败、异常响应、校验失败、游标停滞都明确失败，不返回推测的范围，不自动重试写操作。
- EPUB 被重新上传或替换后必须重新定位。自传 TXT/PDF、未知格式，以及服务端改变协议后的结果，不在已验证范围内。

这些是微信读书当前网页的非公开接口，可能变化。腾讯公开 Agent 文档的 `search books --scope 12` 对应书城全文搜索，并未提供这条指定章节的定位流程。

## 2026-10-15 实测

在同一账户的 R07 自传 EPUB、第一册第十章（UID 15）测试。新 CLI 通过阅读接口独立得到五处范围：`1968-1981`、`4485-4517`、`5138-5149`、`5172-5186`、`5228-5243`，与此前在网页选区、划线回读、私密想法面板中确认的范围全部相同。这里比较的是服务端返回的范围，未把已有范围输入定位算法。

另一个未标注的位置 `in private` 返回 `14960-14970`，中文“私下”返回 `15588-15590`。书城版同一短语也通过 `reader-search` 路径返回了对应版本的范围。以上都是只读验证，没有额外创建笔记。个人正文、完整响应和历史截图只保存在使用方的 Git 忽略缓存中，不进入此仓库。

单元和集成测试覆盖中文、非 BMP 字符、HTML 实体、跨标签、空白、重复/无匹配、分页、错误响应、取消、只读模式，以及 CLI 到 SDK 的参数传递。写入仍复用 `notes add-bookmark` 与 `review add --private`，按 skill 要求回读核对私密状态、完整正文和范围。

## 依据

- [腾讯 Agent 搜索接口文档](https://github.com/tencent/wechatreading/blob/main/skills/search.md)：书城搜索的 scope 和分页语义。
- [腾讯 Agent 笔记文档](https://github.com/tencent/wechatreading/blob/main/skills/notes.md)：既有划线的章节和范围字段。
- [微信读书网页脚本](https://cdn.weread.qq.com/web/wrwebnjlogic/js/9.f252b488.js)：书内搜索 v2、章节请求参数和客户端时间编码调用。
- [weread-omni E-Ink 接口目录](https://github.com/teng-lin/weread-omni/blob/main/docs/endpoints.md)：旧版 `/book/search` 与章节下载入口。章节下载实际返回 ZIP，不能按 JSON 解析。
- [coweread 技术文档](https://github.com/IrisNyx/coweread/blob/main/docs/TECHNICAL.md)：社区通过网页处理后的 `data-wr-co` 定位，说明必须保留服务端坐标。本实现改为直接调用阅读接口，未运行或复制其浏览器抓取流程。
- [htmlparser2](https://github.com/fb55/htmlparser2)：静态解析的 `ontext`、`startIndex`、`endIndex` 用于保留实体解码前的源范围，不执行书籍中的脚本。
