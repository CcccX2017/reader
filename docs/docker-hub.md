# reader

把书籍、电影、剧集、音乐和有声书，放进自己的阅读与影音空间。支持浏览器与 Android 的自部署书库和媒体库，提供 EPUB 与 Kindle（MOBI/AZW3）排版、漫画阅读、影音播放和多用户进度同步。

本项目：[CcccX2017/reader](https://github.com/CcccX2017/reader)。镜像 `ccccx2022/reader`，当前版本 **1.0.14**，提供 amd64 与 arm64。

Fork 项目：[hectorqin/reader](https://github.com/hectorqin/reader)。Fork 的镜像是 `hectorqin/reader-pro`。本仓库包含 Fork 的全部功能，版本号为 1.0.14（上游为 0.1.0）。

首个注册账号成为管理员。打开 `http://<主机>:5888`。

## 功能

- **自己的书库与媒体库**：挂载现有目录，或连接 OPDS 书库、OpenList 媒体目录。书籍与影音分别管理，索引、封面和用户状态保存在数据目录。
- **专注阅读**：EPUB 和无 DRM 的 Kindle 书（MOBI/AZW3）保留出版方样式，TXT 支持编码识别与章节切分；支持漫画、分页、滚动、主题、字体和朗读。
- **完整的影音浏览**：电影与剧集、歌手与专辑、有声书与演播者分别组织，支持媒体库筛选、搜索、收藏、历史记录和播放队列。
- **资料与刮削**：读取本地标签、NFO、封面、歌词和字幕；可配置 TMDB 与 MusicBrainz 补全资料，确认匹配后保存，也可手工整理作品与版本。
- **跨设备继续**：账号独立保存书架、阅读进度、笔记及播放进度。Web 视频使用 DPlayer；音频支持歌词、倍速和睡眠定时，Android 支持原生后台播放。
- **适合自部署**：一个 Docker 容器提供服务端与 Web 界面；影音源文件只读扫描，阅读与影音使用独立数据库及服务线程。

| 类型                 | 支持情况                                                 |
| -------------------- | -------------------------------------------------------- |
| EPUB / TXT           | 出版方排版、目录、脚注；TXT 编码识别和章节推断           |
| MOBI / AZW3          | 无 DRM 的 Kindle 书，样式、图片、目录与 EPUB 一致        |
| CBZ / ZIP / 图片目录 | 自然页序、漫画分页和卷目录                               |
| PDF                  | 浏览器或设备基础查看，不重排                             |
| OPDS                 | 浏览、搜索和获取书籍；也可向外部阅读器提供只读目录       |
| 电影 / 剧集          | 海报与资料、季和单集、版本选择、字幕与播放进度           |
| 音乐                 | 歌手、专辑、曲目、歌词、队列与连续播放                   |
| 有声书               | 演播者、内容简介、章节、倍速与睡眠定时                   |
| OpenList             | 接入远端媒体目录，扫描外置资料，通过 Reader 授权接口播放 |

视频与音频不转码，播放能力取决于浏览器或设备支持的容器和编码。PDF 为基础查看。提供 Web 和 Android，电脑端使用浏览器。

相对 Fork，本项目还包含：系统名称与图标、阅读页屏幕常亮、显示名与头像、版本推送和关于页、偏好可保存在本机或账号、首页书架本数与排序、书架多选与自定义封面、编辑书名作者和简介、发现页刷新与返回来源页、搜书分页，以及按章节长度计算的阅读进度。

## Docker

把下面两处路径换成自己的目录。`/books` 是书库，`/data` 必须可写，且不要放在书库里面。

```sh
mkdir -p ./data
docker run -d --name reader --restart unless-stopped \
  -p 5888:5888 \
  -e READER_IMAGE=ccccx2022/reader:latest \
  -v /path/to/your/books:/books:ro \
  -v "$(pwd)/data:/data" \
  ccccx2022/reader:latest
```

只要浏览和阅读，书库保持 `:ro`。需要在网页里上传、改名或删除文件时，把书库改为 `:rw`。

## Docker Compose

保存为 `docker-compose.yml` 后执行 `docker compose up -d`。

```yaml
services:
  reader:
    image: ccccx2022/reader:latest
    container_name: reader
    restart: unless-stopped
    ports:
      - '5888:5888'
    environment:
      LOG_LEVEL: 'info'
      # 与上面的 image 用同一个标签：latest、1.0.14 或 sha-短提交号。
      READER_IMAGE: ccccx2022/reader:latest
    volumes:
      - /path/to/your/books:/books:ro
      # - /path/to/your/videos:/media/video:ro
      # - /path/to/your/music:/media/music:ro
      # - /path/to/your/audiobooks:/media/audiobook:ro
      - ./data:/data
```

影音目录按需取消注释。创建容器后，在「我的 → 媒体库」里填写容器内路径（如 `/media/video`），创建后会自动扫描。

升级时把镜像标签改为新版本，再执行：

```sh
docker compose pull
docker compose up -d
```

健康检查：`http://<主机>:5888/api/v1/health`。
