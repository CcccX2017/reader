# reader

**One home for your books, movies, series, music, and audiobooks.**

A self-hosted reading and media library for browsers and Android, with EPUB and Kindle (MOBI/AZW3) typography, comic reading, media playback, and per-user progress sync.

**English** · [简体中文](README.zh-CN.md)

[Get started](docs/getting-started.en.md) · [Reading guide (中文)](docs/user-guide.zh-CN.md) · [Media guide (中文)](docs/media-user-guide.zh-CN.md) · [Configuration](docs/configuration.en.md) · [Documentation](docs/README.md)

## Why reader

- **Your own libraries**: mount existing directories, connect OPDS book catalogs, or add OpenList media directories. Books and media are organized separately; indexes, covers, and user state live in the data directory.
- **Built for reading**: preserve publisher styles in EPUB and DRM-free Kindle books (MOBI/AZW3), detect TXT encodings and chapters, and enjoy comics, paged or scrolling reading, themes, fonts, and text-to-speech.
- **Media browsing**: browse movies and series, artists and albums, or audiobooks and narrators. Filter by library, search, save favorites, and manage playback history and queues.
- **Metadata and organization**: read local tags, NFO, artwork, lyrics, and subtitles. Configure TMDB and MusicBrainz for online matching, review candidates, or edit metadata and editions manually.
- **Continue across devices**: accounts have independent shelves, notes, reading and playback progress. Web video uses Artplayer; audio includes lyrics, speed controls, and a sleep timer. Android supports native background playback.
- **Simple hosting**: one Docker container serves the backend and Web UI. Media scanning only reads source files, with separate databases and service threads for reading and media.

## Supported content

| Type | Support |
| --- | --- |
| EPUB / TXT | Publisher typography, contents, footnotes; TXT encoding detection and inferred chapters |
| MOBI / AZW3 | DRM-free Kindle books, with the same styles, images, and contents as EPUB |
| CBZ / ZIP / image directories | Natural page ordering, comic paging, and volumes |
| PDF | Original pages (PDF.js, bookmarks, page search) or 增强解析: text reflowed into chapters by bookmarks, read like EPUB |
| OPDS | Browse, search, and acquire books; publish a read-only catalog to external readers |
| Movies / series | Artwork, metadata, seasons, episodes, editions, subtitles, and progress |
| Music | Artists, albums, tracks, lyrics, queues, and continuous playback |
| Audiobooks | Narrators, descriptions, chapters, playback speed, and sleep timers |
| OpenList | Scan remote media and sidecar metadata, then play through Reader's authorized streaming API |

## Get started

Prepare Docker, Docker Compose, a book directory, and a separate data directory. Open `http://<your-host>:5888` after starting the service. The first registered account becomes the administrator. Release images are published on Docker Hub as `ccccx2022/reader` (amd64 / arm64), with tags such as `1.0.15`, `latest`, and `sha-<short>`. Follow the [getting started guide](docs/getting-started.en.md).

Reader opens on Home (首页), where you can resume reading and playback. The bottom navigation (a sidebar on wide screens) has four tabs: Home, Shelf (书架), Media (影音), and Me (我的). On phones, swipe sideways to move between shelf states and media categories; the wide-screen sidebar has a search box covering both books and media. Me gathers every setting: appearance and theme (one theme shared by reading and media, with a separate reading paper colour), shelf display, media browsing, playback, and account.

As an administrator, open Me → Media libraries (我的 → 媒体库), or More actions → Media library management (更多操作 → 媒体库管理) on the video page, to add a server directory or OpenList library. Mount local media into Docker first and enter its container path. Library creation starts a scan. System settings and Scan and scrape (扫描与刮削) are also under Me → Admin (管理). See the [media guide (中文)](docs/media-user-guide.zh-CN.md) and [OpenList setup (中文)](docs/media-openlist.md).

## Documentation

| I want to… | Start here |
| --- | --- |
| Deploy reader and add books or media | [Getting started](docs/getting-started.en.md) |
| Use shelves, reading, OPDS, and text-to-speech | [Reading guide (中文)](docs/user-guide.zh-CN.md) |
| Manage media, match metadata, and play content | [Media guide (中文)](docs/media-user-guide.zh-CN.md) |
| Turn media off site-wide or per user for a reading-only setup | [Feature switches (中文)](docs/media-features.md) |
| Connect OpenList / NAS / cloud storage mounts | [OpenList setup (中文)](docs/media-openlist.md) |
| Configure HTTPS, metadata tools, or TTS | [Configuration](docs/configuration.en.md) |
| Back up accounts, reading, and media state | [Backup and restore (中文)](docs/backup.zh-CN.md) |
| Develop, test, or build Android | [Development](docs/development.en.md), [media validation (中文)](docs/media-validation.md) |

## Current limits

- No audio/video transcoding. Playback depends on the browser or device's container and codec support.
- OpenList supports sidecar NFO, artwork, lyrics, and subtitles; remote embedded tags, artwork, and chapters are not read. Some drivers require OpenList Web proxy and correct Range support.
- No TVBox/JAR, media offline downloads, or direct cloud account login. OpenList manages cloud storage mounts.
- `.rar/.cbr` and general book conversion are unsupported. Offline reading depends on content cached on the current device.
- Web and Android clients are available. There are no standalone iOS or desktop clients; use a browser on desktop.

## 与上游的功能差别

本仓库包含 [hectorqin/reader](https://github.com/hectorqin/reader) 的全部功能，并在此之上多出下面这些。版本号为 1.0.15（上游为 0.1.0）。

- **系统名称与图标**：管理员在「服务配置 → 系统配置」设置名称和图标，图标上限 5MB。未设置时名称为 `reader`。登录页等实例信息返回后再显示，并直接使用已保存的名称和图标。
- **屏幕常亮**：阅读设置和「偏好设置 → 外观与主题」都可以打开。只在阅读页保持常亮，离开后恢复系统自动锁屏。安装本应用时由窗口保持常亮；iOS，以及华为、小米手机的浏览器，使用系统的屏幕唤醒锁，浏览器不提供时改为页内播放无声画面。
- **账号资料**：可以修改显示名、上传头像。显示名最多 10 个字符，一个汉字算两个，输入框旁显示已输入字数，这样首页欢迎语保持一行。首页欢迎区显示头像。登录页使用已保存的应用主题。
- **版本更新**：服务端用发布订阅把新版本推给已打开的页面。容器换进程后，页面连上就会收到当前版本；页面上的构建号和它不一致时马上通知。网页重新构建或服务版本变化也同样通知。仍由读者点「立即更新」，并先保存阅读进度。我的页的「检查更新」用同一次比较，由读者自己发起；「关于」列出名称、服务端版本、客户端版本、网页构建号，以及同一行里的开发仓库和 fork 仓库 GitHub 链接。用已发布的 Docker 镜像部署时，再列出该版本在当前 CPU 上的镜像摘要（12 位）。镜像标签是 `latest` 时，关于页显示 `latest`，不把它写成软件版本号；未配置 `READER_IMAGE` 时也能认出。
- **偏好保存位置**：阅读和偏好设置可以选择只留在这台设备，或写入当前账号，换一台登录后仍然有效。
- **首页书架**：可以设置显示本数和排序。最近阅读按上次阅读时间排列，和书架的「最近阅读」是同一种顺序。首页和书架可以下拉同步。
- **继续与追更**：偏好设置里可以打开「打开应用继续阅读」，进入后直接打开上次阅读的小说。首页「有更新」列出追更里还没看的新章节，并显示新增章数。
- **书架与封面**：支持多选、从书库删除文件、自定义封面（本地文件、网络链接或从书源选择），以及编辑书名、作者和简介。
- **发现**：本地书库列出当前文件夹及其子目录中的书，子目录仍可进入。可以下拉刷新，本地书库会先扫描，也可以勾选多本一次加入书架。详情可以编辑书名、作者和简介，并设置封面；出版日期用年月日选择。列表模式下点封面直接设置封面。还没加入书架的书也能改，改动对整个书库生效。阅读器里点书名打开「书籍信息」，也可以编辑简介。
- **返回来源页**：从发现里的书库或书源返回时，回到打开它的那个页面。文件管理返回发现中的本地书库。
- **搜书**：打开本地书库就按每页 10 本浏览。电脑点击加载更多，手机在结果里向下滚动继续加载，并显示真实总数。本地书带书库封面。
- **阅读进度**：按全书章节长度计算，跨窗口翻页不再跳动。只有一页的内容打开后记为已读。PDF 页码按整本书计算。
- **仿真翻页**：阅读设置里可选。手指靠上、下角揭页，靠中间则整边卷起。宽屏只盖住中间的文字栏，不铺到两侧深色空白。
- **运行中备份**：管理页可以在服务运行时把数据目录做成快照，并在同一页恢复。恢复会替换当前数据并重新启动服务。原书和媒体文件不在快照里。
- **中文搜索**：组字还没结束时不发起搜索。

## Contributing

Bug reports, documentation improvements, and code contributions are welcome. Include reproduction steps, your environment, and redacted logs. See the [development guide](docs/development.en.md).

## License

[GNU Affero General Public License v3.0](LICENSE).
