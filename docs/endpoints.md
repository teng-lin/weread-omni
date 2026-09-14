# WeChat Read (微信读书) Eink 2.1.2 Full API Endpoints Catalog

> **Target Binary:** `weread-eink-2.1.2.apk` (13 DEX files, 315,090 functions, 287,321 unique strings)

> **Reference:** `weread-omni` SDK (40 high-level operations)

## 1. Executive Summary & Coverage Matrix

> [!NOTE]
> **Operations vs. Endpoints:** `README.md` documents **40 user-facing operations** across the CLI, SDK, and Agent Skill.
> Several operations share common underlying API endpoints (e.g., `shelf.markFinished` and `shelf.markReading` both hit `/book/markstatus`; `shelf.add` and `publicAccounts.subscribe` both hit `/shelf/add`).
> Across all 40 operations, `weread-omni` utilizes **35 unique HTTP endpoints**: **30** originate from the Eink 2.1.2 client cataloged below, and **5** originate from modern Web/Mobile features (`/ai/chatv2`, `/ai/chat/suggest`, `/readdata/detail`, `/shelf/top`, `/user/allNotes`).

| Functional Domain | Total Eink Endpoints | Endpoints Used by `weread-omni` |
| :--- | :---: | :---: |
| **Audio & TTS Engine** | 26 | 0 |
| **Booklists (书单)** | 12 | 0 |
| **Books & Reading Engine** | 42 | 14 |
| **Bookshelf (书架)** | 6 | 3 |
| **Cloud Storage (COS / Import)** | 3 | 2 |
| **Official Accounts (公众号 / MP)** | 8 | 3 |
| **Pay, MemberCard & Virtual Currency** | 13 | 0 |
| **Reviews, Comments & Interactions** | 18 | 5 |
| **Social, Friends & Messaging** | 15 | 0 |
| **Store, Market & Discovery** | 10 | 2 |
| **Story Feed (故事流)** | 5 | 0 |
| **Telemetry, Logging & Remote Config** | 12 | 0 |
| **User, Auth & Device** | 10 | 1 |
| **Utility, Dictionary & Activities** | 4 | 0 |
| **TOTAL** | **184** | **30** |

## 2. Operations vs. Endpoints Mapping (All 40 Operations)

Below is the complete reconciliation between the **40 high-level operations** documented in `README.md` and their underlying HTTP endpoints:

| # | Resource | Operation / Method in `README.md` | HTTP Verb | Endpoint Path | Origin / Binary |
| :---: | :--- | :--- | :---: | :--- | :--- |
| 1 | `search` | `search.books(keyword, options?)` | GET | `/store/search` | Eink 2.1.2 |
| 2 | `search` | `search.suggest(keyword, options?)` | GET | `/store/suggest` | Eink 2.1.2 |
| 3 | `book` | `book.info(bookId)` | GET | `/book/info` | Eink 2.1.2 |
| 4 | `book` | `book.detail(bookId, options?)` | GET | `/book/detailinfo` | Eink 2.1.2 |
| 5 | `book` | `book.chapters(bookId)` | POST | `/book/chapterInfos` | Eink 2.1.2 |
| 6 | `book` | `book.progress(bookId)` | GET | `/book/getProgress` | Eink 2.1.2 |
| 7 | `shelf` | `shelf.sync()` | GET | `/shelf/sync` | Eink 2.1.2 |
| 8 | `shelf` | `shelf.add(bookId)` | POST | `/shelf/add` | Eink 2.1.2 |
| 9 | `shelf` | `shelf.delete(bookId)` | POST | `/shelf/delete` | Eink 2.1.2 |
| 10 | `shelf` | `shelf.pin(bookId, top?)` | POST | `/shelf/top` | Web / Mobile |
| 11 | `shelf` | `shelf.setPrivate(bookId, secret?)` | POST | `/book/secret` | Eink 2.1.2 |
| 12 | `shelf` | `shelf.markFinished(bookId, finished?)` | POST | `/book/markstatus` | Eink 2.1.2 |
| 13 | `shelf` | `shelf.markReading(bookId, reading?)` | POST | `/book/markstatus` | Eink 2.1.2 |
| 14 | `publicAccounts` | `publicAccounts.subscriptions(options?)` | GET | `/shelf/sync` | Eink 2.1.2 |
| 15 | `publicAccounts` | `publicAccounts.articles(accountId, options?)` | GET | `/mp/chapters` | Eink 2.1.2 |
| 16 | `publicAccounts` | `publicAccounts.resolveArticle(docUrl, options?)` | POST | `/mp/getreviewid` | Eink 2.1.2 |
| 17 | `publicAccounts` | `publicAccounts.paidContent(docUrl, options?)` | POST | `/mp/getpaidinfo` | Eink 2.1.2 |
| 18 | `publicAccounts` | `publicAccounts.subscribe(accountId)` | POST | `/shelf/add` | Eink 2.1.2 |
| 19 | `publicAccounts` | `publicAccounts.unsubscribe(accountId)` | POST | `/shelf/delete` | Eink 2.1.2 |
| 20 | `notes` | `notes.notebooks(options?)` | GET | `/user/notebooks` | Eink 2.1.2 |
| 21 | `notes` | `notes.recent(options?)` | GET | `/user/allNotes` | Web / Mobile |
| 22 | `notes` | `notes.bookmarks(bookId, options?)` | GET | `/book/bookmarklist` | Eink 2.1.2 |
| 23 | `notes` | `notes.mine(bookId, options?)` | GET | `/review/list` | Eink 2.1.2 |
| 24 | `notes` | `notes.best(bookId, options?)` | GET | `/book/bestbookmarks` | Eink 2.1.2 |
| 25 | `notes` | `notes.readReviews(bookId, chapterUid, reviews, options?)` | POST | `/book/readreviews` | Eink 2.1.2 |
| 26 | `notes` | `notes.underlines(bookId, chapterUid, options?)` | GET | `/book/underlines` | Eink 2.1.2 |
| 27 | `notes` | `notes.addBookmark(input)` | POST | `/book/addBookmark` | Eink 2.1.2 |
| 28 | `notes` | `notes.updateBookmark(input)` | POST | `/book/updateBookmark` | Eink 2.1.2 |
| 29 | `notes` | `notes.removeBookmark(bookmarkId, options?)` | POST | `/book/removeBookmark` | Eink 2.1.2 |
| 30 | `review` | `review.list(bookId, options?)` | GET | `/review/list` | Eink 2.1.2 |
| 31 | `review` | `review.single(reviewId, options?)` | GET | `/review/single` | Eink 2.1.2 |
| 32 | `review` | `review.add(input)` | POST | `/review/add` | Eink 2.1.2 |
| 33 | `review` | `review.edit(reviewId, content, options?)` | POST | `/review/useredit` | Eink 2.1.2 |
| 34 | `review` | `review.delete(reviewId)` | POST | `/review/delete` | Eink 2.1.2 |
| 35 | `readData` | `readData.detail(options?)` | GET | `/readdata/detail` | Web / Mobile |
| 36 | `discover` | `discover.recommend(options?)` | GET | `/book/recommend` | Eink 2.1.2 |
| 37 | `discover` | `discover.similar(bookId, options?)` | GET | `/book/detailinfo` | Eink 2.1.2 |
| 38 | `ai` | `ai.askBook(input)` | POST | `/ai/chatv2` | Web / Mobile |
| 39 | `ai` | `ai.suggest(input)` | POST | `/ai/chat/suggest` | Web / Mobile |
| 40 | `import` | `import.book({ name, path/bytes })` | GET + POST | `/cos/getcredential` + `/cos/notify` | Eink 2.1.2 |

## 3. Infrastructure & Base Hosts

| Hostname | Protocol | Role / Target Scope |
| :--- | :--- | :--- |
| `i.weread.qq.com` | HTTPS | Primary API Gateway for all Retrofit and Coroutine endpoints |
| `oss.weread.qq.com` | HTTPS | WRBus event analytics and `/river/*` telemetry collectors |
| `res.weread.qq.com` | HTTPS | Protected media/book blobs (`/wrco/{pdfBookId}`, `/wrepub/`, `/publicfetch`) |
| `cdn.weread.qq.com` | HTTPS | Static assets: fonts, TTS offline engine models (`wxtts_offline_resource4.zip`), player alert skins |
| `download.weread.qq.com` | HTTPS | Standby screensavers (`lnkScreenCover.json`) and bundled fonts |
| `weread.qq.com` | HTTPS | Web views, H5 redirect bridges, and crash logging auth |
| `mp.weixin.qq.com` | HTTPS | WeChat Official Accounts article resolution and captcha triggers |

## 4. Complete Eink 2.1.2 Endpoints Catalog by Domain

### Audio & TTS Engine (26 Endpoints)

| `weread-omni` | Method | Endpoint Path | Calling Class / Service | Parameters / Payload Fields |
| :---: | :--- | :--- | :--- | :--- |
| — | GET | `/aetts` | `TTSRemoteService` | - |
| — | GET | `/album/info` | `AlbumRemoteService` | `albumId` |
| — | GET | `/album/list` | `AlbumRemoteService` | `albumId`, `synckey` |
| — | POST | `/album/listen` | `AlbumRemoteService` | `albumId`, `trackId` |
| — | POST | `/album/listenreport` | `AlbumRemoteService` | `albumId`, `duration`, `trackId` |
| — | GET | `/album/recentlisten` | `AlbumRemoteService` | `count` |
| — | GET | `/album/updatetime` | `AlbumRemoteService` | `albumIds` |
| — | POST | `/audio/apply` | `LiveStreamService` | `addrtype`, `datalen`, `filetype`, `md5`, `sha` |
| — | GET | `/audio/content` | `AudioResService` | `audioId`, `type` |
| — | GET | `/audio/geturl` | `LiveStreamService` | `audioId`, `quality`, `reviewId`, `type` |
| — | GET | `/book/album` | `AlbumRemoteService` | `bookId` |
| — | GET | `/book/listeningStat` | `BaseReadingStatService`, `ReadingStatService` | `bookId`, `dataType`, `listeningList` |
| — | GET | `/book/newlisteningStat` | `BaseReadingStatService`, `ReadingStatService` | `audioBookId`, `bookId`, `commentList`, `friendList`, `lectureVid`, `todayList` |
| — | GET | `/cos/ttscredential` | `TTSRemoteService` | - |
| — | GET | `/get/lastlisten` | `AudioRemoteService` | - |
| — | GET | `/getplayinfo` | `AudioRemoteService` | `trackId`, `trackProgress` |
| — | GET | `/track/extra` | `AlbumRemoteService` | `trackId` |
| — | GET | `/track/info` | `AlbumRemoteService` | `trackId` |
| — | GET | `/track/lastprogress` | `AlbumRemoteService` | `trackId` |
| — | GET | `/track/text` | `AlbumRemoteService` | `trackId` |
| — | GET | `/tts/playurl` | `TTSRemoteService` | - |
| — | GET | `/tts/pronounce` | `TTSRemoteService` | - |
| — | GET | `/tts/token` | `TTSRemoteService` | - |
| — | POST | `/wehear/watchad` | `AlbumRemoteService` | `albumId`, `trackId` |
| — | GET | `/wxtts/seginfo` | `TTSRemoteService` | - |
| — | GET | `/wxtts/voice` | `TTSRemoteService` | - |

### Booklists (书单) (12 Endpoints)

| `weread-omni` | Method | Endpoint Path | Calling Class / Service | Parameters / Payload Fields |
| :---: | :--- | :--- | :--- | :--- |
| — | POST | `/booklist/add` | `BaseBookInventoryService` | `bookItems`, `description`, `name` |
| — | POST | `/booklist/collect` | `BaseBookInventoryService` | `booklistId`, `isCancel` |
| — | POST | `/booklist/comment` | `BaseBookInventoryService` | `booklistId`, `content`, `toCommentId`, `toUserVid` |
| — | POST | `/booklist/commentlike` | `BaseBookInventoryService` | `commentId`, `isUnlike` |
| — | POST | `/booklist/delComment` | `BaseBookInventoryService` | `commentId` |
| — | POST | `/booklist/delete` | `BaseBookInventoryService` | `booklistId` |
| — | POST | `/booklist/like` | `BaseBookInventoryService` | `booklistId`, `isUnlike` |
| — | POST | `/booklist/read` | `BaseBookInventoryService` | `booklistId` |
| — | POST | `/booklist/shareToDiscover` | `BaseBookInventoryService` | `booklistId`, `isCancel` |
| — | GET | `/booklist/single` | `BaseBookInventoryService` | `booklistId`, `eink_new`, `synckey` |
| — | POST | `/booklist/update` | `BaseBookInventoryService` | `bookItems`, `booklistId`, `description`, `name` |
| — | GET | `/booklists` | `BaseBookInventoryService` | `count`, `synckey`, `type`, `userVid` |

### Books & Reading Engine (42 Endpoints)

| `weread-omni` | Method | Endpoint Path | Calling Class / Service | Parameters / Payload Fields |
| :---: | :--- | :--- | :--- | :--- |
| ✅ | POST | `/book/addBookmark` | `BaseNoteService`, `NoteService` | `bookId`, `bookVersion`, `chapterUid`, `markText`, `range`, `refMpInfo`, `style`, `translateMode`, `type` |
| — | GET | `/book/articles` | `ArticleService`, `BaseArticleService` | `bookId`, `count`, `createTime`, `maxIdx`, `offset`, `synckey`, `topshelf` |
| — | POST | `/book/batchUploadProgress` | `BaseReportService`, `ReportService` | `books`, `random`, `recordCreateTimeZone`, `signature`, `timestamp` |
| ✅ | GET | `/book/bestbookmarks` | `BaseBestMarkContentService`, `BestMarkContentService` | `bookId`, `chapterUid`, `count`, `maxIdx`, `synckey` |
| — | GET | `/book/bestbookmarksinfo` | `BaseBestMarkContentService`, `BestMarkContentService` | `bookId` |
| ✅ | GET | `/book/bookmarklist` | `BaseNoteService`, `NoteService` | `bookId`, `synckey` |
| ✅ | POST | `/book/chapterInfos` | `BaseChapterService`, `ChapterService` | `bookIds`, `paidCount`, `price`, `synckeys`, `updateTimes` |
| — | GET | `/book/chapterReview` | `BaseBookReviewListService`, `BookReviewListService` | `bookId`, `chapterUid`, `getShareCount`, `synckey` |
| — | GET | `/book/chapterdownload` | `BaseBookDownloadService`, `BookDownloadService` | `bookId`, `bookType`, `bookVersion`, `chapters`, `offline`, `pf`, `pfkey`, `preload`, `preview`, `quote`, `release`, `stopAutoPayWhenBNE`, `zoneId` |
| — | GET | `/book/chapterread` | `BaseBookService`, `BookService` | `bookId`, `reviewId` |
| ✅ | GET | `/book/detailinfo` | `BaseBookDetailService`, `BookDetailService` | `bookId`, `count`, `listTypes`, `maxIdx`, `synckey` |
| — | GET | `/book/download` | `BaseBookDownloadService`, `BookDownloadService` | `bookId` |
| — | GET | `/book/footer` | `BaseBookService`, `BookService` | `bookId` |
| ✅ | GET | `/book/getProgress` | `BaseReportService`, `ReportService` | `bookId` |
| ✅ | GET | `/book/info` | `BaseBookService`, `BookService` | `bookId`, `myzy`, `source` |
| — | POST | `/book/infos` | `BaseBookService`, `BookService` | `bookIds` |
| — | POST | `/book/lastchapteridx` | `BaseBookService`, `BookService` | `bookIds`, `lastChapterIdxs`, `synckeys` |
| ✅ | POST | `/book/markstatus` | `BaseReportService`, `ReportService` | `auto`, `bookId`, `finishInfo`, `isCancel`, `status` |
| — | POST | `/book/notfound` | `BaseBookService`, `BookService` | `author`, `globalId`, `title` |
| — | GET | `/book/paytime` | `BaseBookService`, `BookService` | `bookIds` |
| — | GET | `/book/podcasts` | `BaseBookDetailService`, `BookDetailService` | `bookId`, `count`, `listType`, `reviewListType`, `synckey` |
| — | POST | `/book/read` | `BaseReportService`, `ReportService` | `appId`, `autoTime`, `bookId`, `bookVersion`, `chapterIdx`, `chapterOffset`, `chapterProgress`, `chapterUid`, `curType`, `currentProgress`, `deviceId`, `finish`, `hours`, `installId`, `isLecture`, `isResendReadingInfo`, `isStoryFeed`, `lectureTextTime`, `lectureTime`, `novalTime`, `progress`, `random`, `readingTime`, `recordCreateTimeZone`, `reviewId`, `risk`, `signature`, `summary`, `timestamp`, `ttsTime`, `voiceType`, `wordCount` |
| — | GET | `/book/readinfo` | `BaseBookService`, `BookService` | `appid`, `bookId`, `finishedBookCount`, `finishedBookIndex`, `finishedDate`, `noteCount`, `page`, `qrCode`, `readingBookIndex`, `readingDetail`, `scene`, `width` |
| — | GET | `/book/readingStat` | `BaseReadingStatService`, `ReadingStatService` | `bookId`, `dataType`, `readingList`, `showUserNum` |
| ✅ | POST | `/book/readreviews` | `BaseBookReviewListService`, `BookReviewListService` | `bookId`, `chapterUid`, `cht2sMode`, `reviews` |
| ✅ | GET | `/book/recommend` | `BaseExchangeService`, `ExchangeService` | `balance` |
| ✅ | POST | `/book/removeBookmark` | `BaseNoteService`, `NoteService` | `bookmarkId` |
| — | GET/POST | `/book/search` | `BaseBookService`, `BookService` | `bookContentInfo`, `bookId`, `count`, `fragmentSize`, `isLocate`, `keyword`, `maxIdx`, `onlyCount` |
| ✅ | POST | `/book/secret` | `BaseBookService`, `BookService` | `albumIds`, `bookIds`, `private` |
| — | POST | `/book/setting` | `BaseBookService`, `BookService` | `bookIds`, `hideReview` |
| — | GET | `/book/similar` | `BaseBookService`, `BaseStoreSearchService`, `BookService`, `StoreSearchService` | `bookId`, `count`, `isPromote`, `maxIdx`, `recommendList`, `sessionId` |
| — | GET | `/book/tags` | `BaseBookService`, `BookService` | `bookId` |
| ✅ | GET | `/book/underlines` | `BaseBookService`, `BookService` | `bookId`, `chapterUid`, `synckey` |
| ✅ | POST | `/book/updateBookmark` | `BaseNoteService`, `NoteService` | `bookmarkId`, `style` |
| — | GET | `/discover/readingStat` | `BaseReadingStatService`, `ReadingStatService` | `bookIds`, `lectureBookIds` |
| — | POST | `/en/bookread` | `BaseBookService`, `BookService` | `bookId`, `freeTrial`, `read`, `reference` |
| — | GET | `/pdf2epub/notify` | `BaseBookService`, `BookService` | `cbid` |
| — | GET | `/predict/readtime` | `BaseBookService`, `BookService` | `bookId`, `chapterPercent`, `chapterUid`, `scene` |
| — | GET | `/reader/pagecount` | `BookRemoteService` | `bookId` |
| — | GET | `/reader/tips` | `BaseBookService`, `BookService` | `bookId`, `from` |
| — | GET | `/reading/remindWords` | `BaseBookService`, `BookService` | - |
| — | GET | `/trans/pdfepub` | `BaseBookService`, `BookRemoteService`, `BookService` | `bookId`, `cbid`, `offset`, `pollPdf2Epub`, `transFormat`, `transType`, `uid` |

### Bookshelf (书架) (6 Endpoints)

| `weread-omni` | Method | Endpoint Path | Calling Class / Service | Parameters / Payload Fields |
| :---: | :--- | :--- | :--- | :--- |
| ✅ | POST | `/shelf/add` | `BaseShelfService`, `ShelfService` | `albumIds`, `bookIds`, `follow`, `promoteId` |
| — | POST | `/shelf/archive` | `BaseShelfService`, `ShelfService` | `archiveId`, `bookIds`, `lectureBookIds`, `name` |
| ✅ | POST | `/shelf/delete` | `BaseShelfService`, `ShelfService` | `albumIds`, `archiveIds`, `bookIds` |
| — | POST | `/shelf/deleteArchive` | `BaseShelfService`, `ShelfService` | `archiveId`, `removeBooks` |
| ✅ | GET | `/shelf/sync` | `BaseShelfService`, `ShelfService` | `lectureSynckey`, `onlyBookid`, `synckey` |
| — | POST | `/shelf/syncbook` | `BaseShelfService`, `ShelfService` | `albumIds`, `bookIds` |

### Cloud Storage (COS / Import) (3 Endpoints)

| `weread-omni` | Method | Endpoint Path | Calling Class / Service | Parameters / Payload Fields |
| :---: | :--- | :--- | :--- | :--- |
| ✅ | GET | `/cos/getcredential` | `BaseCosService`, `CosService` | `cbid`, `mode`, `name`, `pictype`, `scene`, `suffix` |
| ✅ | POST | `/cos/notify` | `CosService` | `name` |
| — | POST | `/cos/receive` | `BaseCosService`, `CosService` | `bookId`, `md5`, `name`, `random`, `signature`, `timestamp` |

### Official Accounts (公众号 / MP) (8 Endpoints)

| `weread-omni` | Method | Endpoint Path | Calling Class / Service | Parameters / Payload Fields |
| :---: | :--- | :--- | :--- | :--- |
| ✅ | GET | `/mp/chapters` | `BaseMPListService`, `MPListService` | `bookId`, `count`, `offset`, `synckey` |
| — | GET | `/mp/cover` | `BaseOfficialArticleService`, `OfficialArticleService` | `bookId` |
| ✅ | POST | `/mp/getpaidinfo` | `BaseMPListService`, `MPListService` | `need_content`, `urls` |
| ✅ | POST | `/mp/getreviewid` | `BaseMPListService`, `MPListService` | `urls` |
| — | GET | `/mp/list` | `BaseOfficialArticleService`, `OfficialArticleService` | `count`, `listType`, `maxIdx`, `showWx`, `synckey` |
| — | GET | `/mp/notifications` | `BaseOfficialArticleService`, `OfficialArticleService` | `favourite`, `floating`, `todayNew` |
| — | POST | `/mp/read` | `BaseOfficialArticleService`, `OfficialArticleService` | `account`, `bookId`, `isDelete`, `reviewId`, `thumbUrl`, `title`, `url` |
| — | GET | `/video/cover` | `BaseOfficialArticleService`, `OfficialArticleService` | `bookId` |

### Pay, MemberCard & Virtual Currency (13 Endpoints)

| `weread-omni` | Method | Endpoint Path | Calling Class / Service | Parameters / Payload Fields |
| :---: | :--- | :--- | :--- | :--- |
| — | GET | `/coupon/buyChapter` | `BasePayService`, `PayService` | `bookId`, `chapterIds` |
| — | POST | `/exchange` | `BaseExchangeService`, `ExchangeService` | `pf`, `unread`, `weibi`, `zoneid` |
| — | GET | `/gift/detail` | `BaseGiftService`, `GiftService` | `giftId` |
| — | POST | `/gift/membercard` | `BasePayService`, `PayService` | `mac`, `source`, `type` |
| — | POST | `/gift/newuser` | `BasePayService`, `PayService` | `bookId`, `from` |
| — | POST | `/pay/balance` | `BasePayService`, `PayService` | `noSnapshot`, `onlyLimitFree`, `pf`, `release`, `zoneid` |
| — | POST | `/pay/buyBook` | `BasePayService`, `PayService` | `bookId`, `cpName`, `isMCard`, `payType`, `pf`, `price`, `release`, `zoneid` |
| — | POST | `/pay/buyChapters` | `BasePayService`, `PayService` | `bookId`, `chapterIds`, `isMCard`, `isautopay`, `payType`, `pf`, `release`, `totalprice`, `zoneid` |
| — | GET | `/pay/item` | `BasePayService`, `PayService` | `channel`, `synckey` |
| — | GET | `/pay/memberCardDetails` | `BaseMemberCardService`, `MemberCardService` | `getPredicted`, `pf` |
| — | GET | `/pay/memberCardItems` | `BaseMemberCardService`, `MemberCardService` | `pf` |
| — | GET | `/pay/memberCardSummary` | `BaseMemberCardService`, `MemberCardService` | `pf`, `snapshot`, `source` |
| — | GET | `/pay/membercardexitems` | `BasePayService`, `PayService` | `pf`, `source` |

### Reviews, Comments & Interactions (18 Endpoints)

| `weread-omni` | Method | Endpoint Path | Calling Class / Service | Parameters / Payload Fields |
| :---: | :--- | :--- | :--- | :--- |
| — | GET | `/like/add` | `BaseReadingStatService`, `ReadingStatService` | `bookId`, `isUnlike`, `type`, `userVid` |
| — | GET | `/like/get` | `BaseReadingStatService`, `ReadingStatService` | `bookId`, `type`, `userVid` |
| ✅ | POST | `/review/add` | `BaseMpService`, `BaseSingleReviewService`, `MpService` | `abstract`, `atUserVids`, `auInterval`, `audioArticleId`, `audioId`, `bookId`, `bookVersion`, `chapterUid`, `content`, `contextAbstract`, `friendship`, `htmlContent`, `isPrivate`, `notVisibleToFriends`, `originalReviewId`, `pencilNote`, `range`, `refMpInfo`, `refReviewId`, `star`, `title`, `topicRanges`, `translateMode`, `type` |
| — | GET | `/review/authorpublish` | `BaseKOLReviewService`, `KOLReviewService` | `bookId`, `chapterUid`, `count`, `listmode`, `maxIdx`, `synckey` |
| — | POST | `/review/comment` | `BaseSingleReviewService` | `content`, `isReward`, `reviewId`, `toCommentId`, `toUserVid` |
| — | POST | `/review/commentlike` | `BaseSingleReviewService` | `commentId`, `isUnlike` |
| — | GET | `/review/commentloadmore` | `BaseSingleReviewService` | `booklistId`, `commentId`, `count`, `isExpandAll`, `maxIdx`, `reviewId` |
| — | POST | `/review/delComment` | `BaseSingleReviewService` | `commentId` |
| ✅ | POST | `/review/delete` | `BaseSingleReviewService` | `reviewId` |
| — | POST | `/review/edit` | `BaseSingleReviewService` | `bookId`, `chapterUid`, `range`, `reviewId` |
| — | GET | `/review/feeds` | `BaseLightTimeLineService`, `LightTimeLineService` | `count`, `getrecmreviews`, `getrecmusers`, `listMode`, `maxIdx`, `synckey` |
| — | GET | `/review/getDocContent` | `BaseStoryFeedService`, `StoryFeedService` | `docUrl`, `reviewId` |
| — | POST | `/review/like` | `BaseSingleReviewService` | `isUnlike`, `reviewId` |
| ✅ | GET | `/review/list` | `BaseBookReviewListService`, `BaseMPListService`, `BaseNoteService`, `BaseUserReviewListService`, `BookReviewListService`, `MPListService`, `NoteService`, `UserReviewListService` | `bookId`, `chapterUid`, `count`, `listMode`, `listType`, `listmode`, `listtype`, `maxIdx`, `mine`, `private`, `refMpReviewId`, `synckey`, `type`, `userVid`, `uservid` |
| — | GET | `/review/relatedReviews` | `BaseSingleReviewService` | `count`, `reviewId` |
| — | POST | `/review/repost` | `BaseSingleReviewService` | `repost`, `reviewId` |
| ✅ | GET | `/review/single` | `BaseSingleReviewService` | `bookReviewCount`, `commentsCount`, `commentsDirection`, `commentsMaxIdx`, `likesCount`, `likesDirection`, `likesMaxIdx`, `reviewId`, `synckey` |
| ✅ | POST | `/review/useredit` | `BaseSingleReviewService` | `abstract`, `albumId`, `atUserVids`, `bookId`, `bookVersion`, `chapterName`, `chapterUid`, `colorStyle`, `content`, `contextAbstract`, `friendship`, `groupId`, `htmlContent`, `isPrivate`, `link`, `notShareToFriend`, `notVisibleToFriends`, `originalReviewId`, `pencilNote`, `pictures`, `range`, `refMpInfo`, `refReviewId`, `reviewId`, `shareToGroup`, `star`, `title`, `topicRanges`, `trackId`, `type` |

### Social, Friends & Messaging (15 Endpoints)

| `weread-omni` | Method | Endpoint Path | Calling Class / Service | Parameters / Payload Fields |
| :---: | :--- | :--- | :--- | :--- |
| — | POST | `/chat/delete` | `BaseChatService` | `sid` |
| — | POST | `/chat/read` | `BaseChatService` | `latestMsgId`, `sid` |
| — | POST | `/chat/send` | `BaseChatService` | `clientTime`, `content`, `sid`, `type` |
| — | GET | `/chat/sessionlist` | `BaseChatService` | `synckey` |
| — | POST | `/friend/agreeFollow` | `BaseFollowService` | `applyVid`, `cmd` |
| — | GET | `/friend/applylist` | `BaseFollowService` | `synckey` |
| — | GET | `/friend/blacklist` | `BaseBlackListService`, `BlackListService` | `type` |
| — | POST | `/friend/follow` | `BaseFollowService` | `isBlack`, `isUnfollow`, `vid`, `vids` |
| — | GET | `/friend/follower` | `BaseFollowService` | `synckey`, `syncver` |
| — | GET | `/friend/following` | `BaseFollowService` | `synckey`, `syncver` |
| — | POST | `/friend/hideMe` | `BaseFollowService` | `unhideMe`, `vid` |
| — | GET | `/friend/invite` | `BaseFriendService`, `FriendService` | `bookId`, `type` |
| — | POST | `/friend/removeFollowers` | `BaseBlackListService`, `BlackListService` | `vid` |
| — | POST | `/friend/subscribe` | `BaseFollowService` | `unsubscribe`, `vid` |
| — | GET | `/friend/wechat` | `BaseFollowService` | `detailInfo`, `force`, `synckey`, `syncver` |

### Store, Market & Discovery (10 Endpoints)

| `weread-omni` | Method | Endpoint Path | Calling Class / Service | Parameters / Payload Fields |
| :---: | :--- | :--- | :--- | :--- |
| — | GET | `/eink/hottopics` | `BaseHotTopicsService`, `HotTopicService` | `count`, `direction`, `netType`, `offset`, `pageSource`, `request_expand`, `searchid`, `topic_id` |
| — | GET | `/market/categories` | `BaseStoreService`, `StoreService` | `categoryId`, `rank`, `ranklist`, `recommend`, `subtype`, `synckey` |
| — | GET | `/market/category` | `BaseStoreService`, `StoreService` | `categoryId`, `count`, `maxIdx`, `rank`, `synckey` |
| — | GET | `/market/list` | `BaseStoreService`, `StoreService` | `count`, `eink_new`, `maxIdx`, `rn`, `subtype`, `synckey`, `type` |
| — | GET | `/promo/list` | `BaseStoreSearchService`, `BaseStoreService`, `StoreSearchService`, `StoreService` | `count`, `subtype`, `type` |
| — | GET | `/recommend/feedback` | `BaseStoreService`, `StoreService` | `bookId`, `feedbackVid`, `recommendType`, `section`, `source`, `type` |
| — | GET | `/searchtags` | `BaseStoreSearchService`, `StoreSearchService` | - |
| ✅ | GET | `/store/search` | `BaseStoreSearchService`, `StoreSearchService` | `author`, `authorVids`, `categoryId`, `count`, `filterField`, `filterType`, `fromBookId`, `keyword`, `maxIdx`, `outer`, `rnVersion`, `scene`, `scope`, `sid`, `type`, `v` |
| ✅ | GET | `/store/suggest` | `BaseStoreSearchService`, `StoreSearchService` | `count`, `keyword` |
| — | POST | `/store/titlesearch` | `BaseStoreSearchService`, `StoreSearchService` | `keywords` |

### Story Feed (故事流) (5 Endpoints)

| `weread-omni` | Method | Endpoint Path | Calling Class / Service | Parameters / Payload Fields |
| :---: | :--- | :--- | :--- | :--- |
| — | GET | `/storyfeed/getCardArticles` | `BaseStoryFeedService`, `StoryFeedService` | `channel`, `count`, `id`, `kkOffset`, `kkSearchId`, `type` |
| — | GET | `/storyfeed/getRecentBooks` | `BaseStoryFeedService`, `StoryFeedService` | - |
| — | POST | `/storyfeed/report` | `BaseStoryFeedService`, `StoryFeedService` | `metas`, `reviewIds`, `type` |
| — | POST | `/storyfeed/reportstatus` | `BaseStoryFeedService`, `StoryFeedService` | `doc`, `meta`, `netType`, `reviewId`, `type` |
| — | GET | `/storyfeed/tags` | `BaseStoryFeedService`, `StoryFeedService` | `type` |

### Telemetry, Logging & Remote Config (12 Endpoints)

| `weread-omni` | Method | Endpoint Path | Calling Class / Service | Parameters / Payload Fields |
| :---: | :--- | :--- | :--- | :--- |
| — | POST | `/app/onlinetime` | `AppService`, `BaseAppService` | `time` |
| — | POST | `/cgi-bin/log_upload` | `BaseFeedbackService` | `appid`, `appversion`, `authtype`, `channelid`, `clitime`, `device`, `deviceid`, `func`, `imei`, `inputc`, `logtype`, `os`, `platform`, `sid`, `vid` |
| — | POST | `/cgi-bin/oss_log` | `OssService` | `baseinfo`, `func`, `inputf`, `logcontent`, `logsize` |
| — | POST | `/cgi-bin/sync_msg` | `BaseFeedbackService` | `appid`, `appversion`, `authtype`, `baseinfo`, `channelid`, `clitime`, `datatype`, `device`, `deviceid`, `func`, `imei`, `inputf`, `localtime`, `msgdata`, `nickname`, `os`, `platform`, `screenresolution`, `screenscale`, `seqid`, `sid`, `vid` |
| — | POST | `/comm/record` | `BaseBookService`, `BookService` | `cmd`, `key`, `signature`, `timestamp`, `value` |
| — | GET | `/config` | `AccountService`, `BaseAccountService`, `BaseReportService`, `ReportService` | `synckey`, `token` |
| — | POST | `/logReport` | `AppService`, `BaseAppService`, `BaseReportService`, `LogReportService`, `ReportService` | `action`, `appver`, `bookId`, `bookType`, `data`, `deviceId`, `model`, `os`, `reportMethod`, `source`, `vid` |
| — | POST | `/river/batch` | `NetworkUtils` | - |
| — | GET | `/river/config` | `NetworkUtils` | - |
| — | POST | `/river/single` | `NetworkUtils` | - |
| — | GET | `https://res.weread.qq.com/wrco/{pdfBookId}` | `BaseBookDownloadService`, `BookDownloadService` | `pdfBookId` |
| — | POST | `https://weread.qq.com/i/applog/put/object/auth` | `BaseFeedbackService` | `bucket`, `content_length`, `jobid`, `uri` |

### User, Auth & Device (10 Endpoints)

| `weread-omni` | Method | Endpoint Path | Calling Class / Service | Parameters / Payload Fields |
| :---: | :--- | :--- | :--- | :--- |
| — | GET | `/feature` | `FeatureService$BaseFeatureService` | `synckey` |
| — | POST | `/login` | `WRLoginService` | `code`, `deviceId`, `deviceName`, `deviceType`, `inBackground`, `isAutoLogout`, `isFromQrcode`, `kickType`, `random`, `refCgi`, `refreshToken`, `signature`, `timestamp`, `trackId`, `wxToken` |
| — | POST | `/mobileSync` | `AppService`, `BaseAppService` | `applyList`, `balance`, `chat`, `config`, `eink_new`, `follower`, `following`, `inBackground`, `marketSyncver`, `payItem`, `rateSynckey`, `readingExchange`, `refluxSynckey`, `reviewRecommend`, `reviewTimeline`, `shelf`, `shelfLecture`, `storyfeed`, `wechatFriend` |
| — | POST | `/updateConfig` | `AccountService`, `AidlService`, `BaseAccountService`, `BaseAidlService` | `accountsets`, `deviceId`, `disHubToken`, `gapToken` |
| — | GET | `/user` | `BaseUserService`, `UserService` | `userVid` |
| ✅ | GET | `/user/notebooks` | `BaseNoteService`, `NoteService` | `synckey` |
| — | GET | `/user/profile` | `AccountService`, `BaseAccountService` | `currentReadingTime`, `gender`, `isBlackMe`, `isInBlackList`, `signature`, `totalReadingTime`, `userVid`, `vDesc` |
| — | POST | `/user/signature` | `AccountService`, `BaseAccountService` | `content`, `nick`, `vDesc` |
| — | GET | `/wx/scope` | `BaseFollowService` | `refresh`, `vid` |
| — | GET | `/wxticket` | `WRLoginService` | `nonceStr` |

### Utility, Dictionary & Activities (4 Endpoints)

| `weread-omni` | Method | Endpoint Path | Calling Class / Service | Parameters / Payload Fields |
| :---: | :--- | :--- | :--- | :--- |
| — | GET | `/act/recvinfinite` | `BasePayService`, `PayService` | `action`, `cmd`, `from` |
| — | GET | `/act/sendinfinite` | `BasePayService`, `PayService` | `bitmapId`, `cmd`, `source`, `type` |
| — | POST | `/dict/query` | `BaseDictionaryService`, `DictionaryService` | `word` |
| — | GET | `/dictionary` | `BaseDictionaryService`, `DictionaryService` | `synckey` |
