# mxc-new 临时音频服务

Recast网页、文章和会话仍运行于Cloudflare；上传音轨使用独立音频服务，供火山ASR直接下载。

- 地址：`https://recast-media.inventory.mimimiai.com`
- 代码：`/opt/recast-media/server.mjs`，运行用户：`recast-media`
- 数据：`/var/lib/recast-media`（0700），文件0600
- 配置：`/etc/recast-media.env`（0600，禁止提交）
- 服务：`recast-media.service`，仅监听`127.0.0.1:8789`
- Nginx：`/etc/nginx/sites-available/recast-media`；独立证书`recast-media`
- TLS自动续期，独立续期钩子检查本证书后重载Nginx。

单文件24 MiB，临时文件总容量上限512 MiB，一次只接收一个上传。文件1小时到期，签名立即失效；定时器每分钟回收过期文件。服务重启时也会回收。文件不进入长期备份。systemd限制96 MiB内存和25%单核CPU。

PUT/DELETE要求独立服务密钥；GET/HEAD要求HMAC签名和有效期。目录不提供列表。下载支持Range回听；删除对象保留短期删除标记，防止并发的旧上传重新发布文件。Nginx访问日志关闭，避免保存下载签名；错误与启动信息可通过systemd查看。

Cloudflare Secrets需要：

```text
MEDIA_GATEWAY_URL=https://recast-media.inventory.mimimiai.com
MEDIA_GATEWAY_SECRET=<与服务器一致的随机密钥，至少32字符>
```

服务端环境变量：

```text
MEDIA_GATEWAY_PUBLIC_URL=https://recast-media.inventory.mimimiai.com
MEDIA_GATEWAY_SECRET=<同一个随机密钥>
MEDIA_GATEWAY_DIR=/var/lib/recast-media
PORT=8789
```

更新时将仓库服务代码安装到`/opt/recast-media/server.mjs`，仅重启`recast-media`。修改Nginx必须先`nginx -t`再reload。健康检查必须验证返回JSON `{"ok":true}`，不能只检查HTTP200。

```sh
ssh mxc-new 'systemctl status recast-media --no-pager'
ssh mxc-new 'journalctl -u recast-media -n 50 --no-pager'
curl --fail https://recast-media.inventory.mimimiai.com/healthz
```

部署使用已有泛域名DNS；没有更改现有DNS记录、其他网站代码或其服务配置。证书、应用与目录均单独创建。回滚时先移除Cloudflare的两个媒体配置，再停止本服务；旧会话中尚未过期的音频依赖此服务，应等1小时后再停止。
