# x.com（推特） 原图直接加载 + 原生右键菜单

一个 Tampermonkey 用户脚本：在 X（Twitter）上让图片**直接以 `?name=orig` 原图加载**，并把被 X 接管的右键菜单**还原成浏览器原生菜单**。右键「在新标签页中打开图片 / 图片另存为 / 复制图片地址」拿到的就是原图地址，不需要二次跳转。

对应文件：[`x-orig-image.user.js`](./x-orig-image.user.js)

## 安装

1. 给浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)（Chrome / Edge / Firefox 都可以）。
2. 点 Tampermonkey 图标 →「添加新脚本」。
3. 清空编辑器，把 [`x-orig-image.user.js`](./x-orig-image.user.js) 的全部内容粘贴进去，按 `Ctrl+S` 保存。
   - 也可以直接把 `.user.js` 文件拖进浏览器窗口，按提示安装。
4. 打开或刷新 [x.com](https://x.com) 即可。

## 功能

- **原图直载（无中转）**：时间线、推文详情、点开的大图里，图片 `src` 在浏览器发起请求之前就被换成 `?name=orig`，只下载一次原图，不会再出现「先加载缩略图、再跳原图」的重复请求与闪烁。
- **恢复原生右键**：在 `window` 捕获阶段截住 `contextmenu` 事件（只停止传播，**不**调用 `preventDefault`），X 的自定义菜单（复制图片地址 / 保存图片 / 在新标签页打开 等按钮）不再弹出，浏览器原生菜单照常出现。
- **非 orig 链接自动跳转**：直接打开 `pbs.twimg.com` 上非 orig 的图片地址时，自动替换成 orig 再加载；已经是 orig 的地址原样保留，不做多余跳转。
- **失败回退**：个别图片的 orig 不可用时自动退回原缩略图，避免脚本把图片弄成裂图。
- **头像可选**：头像原图通常很大，默认不升；需要时把脚本里的 `UPGRADE_AVATARS` 改成 `true`。

## 地址处理规则

| 原始地址 | 处理后 |
| --- | --- |
| `pbs.twimg.com/media/xxx?format=jpg&name=small` | `...?format=jpg&name=orig` |
| `pbs.twimg.com/media/xxx?format=jpg&name=900x900` | `...?format=jpg&name=orig` |
| `pbs.twimg.com/media/xxx.jpg?name=small` | `...xxx.jpg?name=orig` |
| `pbs.twimg.com/media/xxx.jpg?name=large` | `...xxx.jpg?name=orig` |
| `pbs.twimg.com/media/xxx?format=jpg`（没有 `name`） | `...?format=jpg&name=orig` |
| `pbs.twimg.com/media/xxx`（没有参数） | `...?name=orig` |
| 已经是 `name=orig` | 完全保持原样，不重新赋值、不跳转 |
| `pbs.twimg.com/media/xxx.jpg`（带扩展名、没有 `name`） | 不改（本身即原文件） |
| `pbs.twimg.com/card_img/...`（链接预览图） | 加 / 改 `name=orig` |
| `pbs.twimg.com/profile_images/..._normal.jpg` | 默认不改（`UPGRADE_AVATARS = true` 时去掉尺寸后缀） |
| 视频封面、个人横幅、其他域名 | 不改 |

`srcset` 里的每个候选地址也会按同样规则改写，`1x / 2x / 640w` 等描述符保持不动。

示例推文 [mirorokisa/status/2117544813226492102](https://x.com/mirorokisa/status/2117544813226492102) 的图片地址形如 `https://pbs.twimg.com/media/HWLwoSCaIAAWnrN.jpg?name=orig`，对应的 `...jpg?name=small` / `...jpg?name=large` 形式都已写进测试用例。

## 注意事项

- 原图体积明显大于缩略图，流量和内存占用会增加，移动网络下尤其明显。
- 视频和 GIF 在 X 上是用 `<video>` 播放的，封面不是 `<img>`，不在本脚本处理范围内；需要下载视频请用其他工具。
- 外站嵌入的推文运行在 `platform.twitter.com` 的 iframe 里，默认不匹配；如需处理，在脚本头部加一行 `// @match https://platform.twitter.com/*`。
- 「直接打开 pbs 图片地址自动跳转」是否生效，取决于浏览器/脚本管理器是否向图片文档注入用户脚本；即使不生效也不影响右键打开原图，因为页面内的 `src` 已经被改写。
- X 改版后若失效，先看图片 `src` 是否仍是 `pbs.twimg.com/media/&lt;id&gt;?...&amp;name=...` 的形式，再对应调整 `toOrigUrl()`。

## 开发与测试

```powershell
# 语法检查
node --check .\x-orig-image.user.js

# URL 转换单元测试（26 个断言）
node .\tests\url-transform.test.mjs

# 最小 DOM 桩冒烟测试：初始化、src 改写、右键拦截、pbs 跳转（9 个断言）
node .\tests\userscript-smoke.test.mjs
```

`tests/contextmenu.test.html` 用来验证右键机制：站点在 document / React 根容器上注册 `contextmenu` 并 `preventDefault` 时，脚本在 window 捕获阶段的 `stopImmediatePropagation()` 能挡住站点处理器，同时事件默认行为（原生右键菜单）不被取消。用带界面的浏览器直接打开即可看到 `data-result` 对比，或用 headless Chrome：

```powershell
chrome --headless=new --dump-dom "file:///D:/dsh/推特加载原图插件/tests/contextmenu.test.html"
# 查看输出里的 <body data-result="...">
```

## 卸载

在 Tampermonkey 中禁用或删除脚本即可。脚本不写入任何持久化存储，也不发送任何网络请求。
