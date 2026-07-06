# 问道台公网发布

## 1. 创建私人云数据库

1. 在 Supabase 创建项目。
2. 在 SQL Editor 执行 `supabase-setup.sql`。
3. 从 Project Settings → API 复制 Project URL 和 anon/publishable key。
4. 将它们填入 `cloud-config.js`。不要把 `service_role` key 放进前端。
5. 在 Authentication 中启用 Email 登录，并按需要决定是否要求邮箱确认。

`user_states` 已启用 RLS：登录用户只能读写自己的记录。

## 2. 发布静态网站

整个目录可以直接部署到任何 HTTPS 静态托管服务。仓库内的 `.github/workflows/pages.yml` 可发布到 GitHub Pages；也可拖入 Cloudflare Pages、Netlify 或 Vercel。

发布后检查：

- `manifest.webmanifest` 返回 200。
- `service-worker.js` 位于网站根路径。
- 手机浏览器可以“添加到主屏幕”。
- 注册账号后，另一台设备登录可拉取相同档案。

## 3. 图表识别

OCR 在浏览器本地运行。`vendor/` 内包含 Tesseract 主程序与 Worker；识别核心和中英文模型会在首次使用时从官方 CDN 下载，之后由浏览器缓存。
