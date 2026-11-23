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

## Differences from upstream

This repository includes every feature of [hectorqin/reader](https://github.com/hectorqin/reader), plus the following. The version is 1.0.15 (upstream is 0.1.0).

- **Site name and icon**: an administrator sets the name and icon under Service settings → System (服务配置 → 系统配置). The icon is limited to 5MB. When unset, the name is `reader`. The login page waits for the instance info, then shows the saved name and icon directly.
- **Keep awake**: available in the reading settings and under Preferences → Appearance and theme (偏好设置 → 外观与主题). The screen stays awake only on the reading page, and the system lock returns when you leave. An installed app uses the window; iOS and Huawei or Xiaomi mobile browsers use the system wake lock, or a silent in-page video when the browser does not provide one.
- **Account profile**: the display name and avatar can be changed. A display name is at most 10 units, and one Han character counts as two. The field shows how many units are used, so the home greeting stays on one line. Home shows the avatar. The login page uses the saved app theme.
- **Updates**: the server pushes a new release to open pages. After a container replaces the process, a page hears the current release as soon as it connects, and notifies immediately when its build id differs. A rebuilt web bundle or a changed server version notifies the same way. The reader still taps Update now (立即更新), and reading progress is saved first. Check for updates (检查更新) on Me uses the same comparison, started by the reader. About (关于) lists the name, server version, client version, web build id, and, on one line, the GitHub links for this repository and the fork. A published Docker image also lists the 12-digit image digest for that version on the current CPU. When the image tag is `latest`, About (关于) shows `latest` instead of the software version, and it can recognize that tag even when `READER_IMAGE` is unset.
- **Where preferences are stored**: reading and preference settings can stay on this device, or be written to the current account so they follow a login on another device.
- **Home shelf**: the number of books and their order can be set. Recent reading is ordered by the last time each book was read, the same order as Recently read (最近阅读) on the shelf. Home and the shelf can be pulled to sync. Continue-reading and the shelf scroll together, so passing the My shelf (我的书架) title no longer hands off between two scrollers.
- **Resume and subscriptions**: Resume reading on open (打开应用继续阅读), in preferences, opens the last novel when the app opens. Updates (有更新) on Home lists subscribed books with chapters you have not opened, and shows how many chapters were added.
- **Shelf and covers**: books can be multi-selected, files can be deleted from the library, and a cover can be a local file, a URL, or a choice from a source. Title, author, and summary can be edited.
- **Discover**: the local library lists books in the current folder and its subfolders, and subfolders can still be opened. Pull to refresh scans the local library first. Several books can be selected and added to the shelf at once. The detail view edits title, author, and summary, and sets the cover; the publication date is a year-month-day picker. In list mode, tapping the cover sets the cover. A book that is not on the shelf can still be edited, and the change applies to the whole library. Tapping the title in the reader opens Book info (书籍信息), where the summary can also be edited.
- **Return to the opening page**: leaving a library or source in Discover returns to the page that opened it. File management returns to the local library in Discover.
- **Search**: opening the local library browses 10 books per page. On a computer, load more is a click; on a phone, scrolling the results loads more, and the real total is shown. Local books use their library covers.
- **Reading progress**: progress is weighted by the length of every chapter, so turning across a window no longer jumps. A book that is a single page is marked read when opened. PDF page numbers are counted across the whole book.
- **Page curl**: optional in the reading settings. A finger near the top or bottom peels that corner; a finger near the middle rolls the whole edge. On a wide screen the curl covers only the text column, not the dark gutters. With curl selected, the speed can be set from 0.1s to 1.2s. The default is 0.4s.
- **Surface**: Appearance and theme (外观与主题) offers Standard (标准) or Liquid glass (液态玻璃). Standard (标准) stays opaque. With Liquid glass (液态玻璃), the phone tab bar becomes a floating capsule and the selection capsule slides to the tab just tapped; a wide screen stays a sidebar. The reader's top bar, bottom bar, and round buttons on the right, the reading mark at the top-left of a cover, the multi-select bar on a phone, and the media channel switch and its menu become frosted.
- **Backup while running**: the admin page can snapshot the data directory while the service is running, and restore that snapshot on the same page. Restore replaces the current data and restarts the service. Book and media files are not in the snapshot.
- **Chinese search**: a search does not start while a character is still being composed.

## Contributing

Bug reports, documentation improvements, and code contributions are welcome. Include reproduction steps, your environment, and redacted logs. See the [development guide](docs/development.en.md).

## License

[GNU Affero General Public License v3.0](LICENSE).
