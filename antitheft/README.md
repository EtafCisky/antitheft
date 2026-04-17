# 角色卡防盗插件 (AntiTheft Plugin)

SillyTavern 角色卡防盗插件，用于验证加密角色卡的密码并管理角色卡的锁定状态。

## 功能特性

- 🔒 自动检测加密角色卡的锁定状态
- 🔑 密码验证功能，支持云服务器验证
- 🔄 密码版本控制，自动重新锁定过期密码
- 🌐 支持自定义服务器地址
- 🛡️ 防止未经授权的角色卡使用
- ⚙️ 友好的设置面板

## 安装方法

### 方式 1：使用 SillyTavern 内置安装器（推荐）

1. 打开 SillyTavern
2. 点击顶部的"扩展"图标（拼图图标）
3. 点击"安装扩展"
4. 输入本插件的 GitHub 仓库地址：
   ```
   https://github.com/your-repo/antitheft
   ```
5. 点击"安装"
6. 等待安装完成，刷新页面

### 方式 2：手动安装

1. 下载本插件的所有文件
2. 将整个 `antitheft` 文件夹复制到 SillyTavern 的以下目录：
   ```
   SillyTavern/public/scripts/extensions/third-party/
   ```
3. 重启 SillyTavern
4. 插件将自动加载

### 方式 3：Git 克隆

```bash
cd SillyTavern/public/scripts/extensions/third-party/
git clone https://github.com/your-repo/antitheft.git
```

## 目录结构

安装后的完整路径应该是：
```
SillyTavern/
└── public/
    └── scripts/
        └── extensions/
            └── third-party/
                └── antitheft/
                    ├── manifest.json
                    ├── index.js
                    ├── style.css
                    ├── settings.html
                    └── README.md
```

**重要提示：** 文件夹名称必须是 `antitheft`（与 `manifest.json` 中的 `extensionName` 一致）。

## 使用说明

### 对于角色卡使用者

1. **安装插件**
   - 确保已按照上述方法安装本插件
   - 在 SillyTavern 的扩展列表中应该能看到"角色卡防盗"插件

2. **配置插件**
   - 点击扩展面板中的"角色卡防盗"
   - 确保"启用防盗插件"已勾选
   - 可选：设置默认服务器地址

3. **导入加密角色卡**
   - 像导入普通角色卡一样导入加密的角色卡 PNG 文件

4. **输入密码解锁**
   - 如果角色卡被锁定，会自动弹出密码输入对话框
   - 输入作者提供的密码
   - 验证成功后即可正常使用角色卡

5. **密码更新**
   - 如果作者更新了密码，下次加载角色卡时会自动重新锁定
   - 需要输入新密码才能继续使用

### 对于角色卡作者

1. **注册账号**
   - 访问 Web 管理界面
   - 注册一个账号

2. **加密角色卡**
   - 登录管理界面
   - 上传角色卡 PNG 文件
   - 设置密码
   - 下载加密后的角色卡

3. **分发角色卡**
   - 将加密后的角色卡分发给用户
   - 告知用户密码（可通过私信、群组等方式）

4. **管理密码**
   - 可以随时在管理界面更新密码
   - 更新后，所有已解锁的实例会自动重新锁定
   - 用户需要输入新密码才能继续使用

## 工作原理

### 1. 角色卡加密

作者在 Web 管理界面上传角色卡时，系统会：
- 生成唯一的 Card ID（6-8位数字）
- 将密码加密存储到服务器
- 在角色卡的 `extensions.anti_theft` 中嵌入防盗配置
- 在角色卡的 `extensions.anti_theft_script` 中嵌入验证脚本

### 2. 密码验证

用户导入加密角色卡后：
- 嵌入脚本检测到角色卡被锁定
- 检查插件是否已安装（`window.AntiTheftPlugin`）
- 如果插件已安装，显示密码输入对话框
- 用户输入密码后，调用插件的 `verifyPassword()` API
- 插件向服务器发送验证请求
- 验证成功后，更新角色卡的锁定状态

### 3. 密码版本控制

- 每次作者更新密码时，服务器的密码版本号会递增
- 用户加载角色卡时，插件会检查本地版本号和服务器版本号
- 如果版本号不匹配，自动重新锁定角色卡
- 用户需要输入新密码才能解锁

## API 文档

插件提供以下全局 API（通过 `window.AntiTheftPlugin` 访问）：

### `verifyPassword(cardId, password, serverUrl)`

验证密码。

**参数：**
- `cardId` (string): 角色卡 ID（6-8位数字）
- `password` (string): 用户输入的密码
- `serverUrl` (string): 验证服务器地址

**返回值：** `Promise<{success: boolean, password_version?: number, message?: string}>`

**示例：**
```javascript
const result = await window.AntiTheftPlugin.verifyPassword(
  "123456",
  "myPassword123",
  "https://api.example.com"
);

if (result.success) {
  console.log("密码验证成功！版本号:", result.password_version);
} else {
  console.error("密码验证失败:", result.message);
}
```

### `checkPasswordVersion(cardId, serverUrl)`

检查服务器上的密码版本号。

**参数：**
- `cardId` (string): 角色卡 ID
- `serverUrl` (string): 验证服务器地址

**返回值：** `Promise<number>` - 密码版本号，失败时返回 -1

**示例：**
```javascript
const version = await window.AntiTheftPlugin.checkPasswordVersion(
  "123456",
  "https://api.example.com"
);

console.log("服务器密码版本:", version);
```

### `checkVersion()`

检查插件是否已安装。

**返回值：** `{name: string, version: string, installed: boolean}`

**示例：**
```javascript
if (window.AntiTheftPlugin) {
  const info = window.AntiTheftPlugin.checkVersion();
  console.log("插件已安装:", info.version);
} else {
  console.error("插件未安装！");
}
```

## 配置说明

插件会自动读取角色卡中的防盗配置：

```json
{
  "data": {
    "extensions": {
      "anti_theft": {
        "enabled": true,
        "card_id": "123456",
        "server_url": "https://api.example.com",
        "locked": true,
        "password_version": 1,
        "last_unlock_time": 1234567890
      }
    }
  }
}
```

### 配置字段说明

- `enabled` (boolean): 是否启用防盗功能
- `card_id` (string): 角色卡唯一标识符（6-8位数字）
- `server_url` (string): 验证服务器地址
- `locked` (boolean): 当前锁定状态
- `password_version` (number): 密码版本号
- `last_unlock_time` (number): 上次解锁时间戳

## 常见问题

### Q: 插件无法加载？

**A:** 请检查：
1. 插件文件夹位于正确的路径：`SillyTavern/public/scripts/extensions/third-party/antitheft/`
2. 文件夹名称是 `antitheft`（不是其他名称）
3. `manifest.json` 文件存在且格式正确
4. 重启 SillyTavern

### Q: 提示"请安装防盗插件"？

**A:** 说明插件未正确安装或未加载：
1. 按照安装方法重新安装
2. 确保文件夹名称正确
3. 在浏览器控制台检查是否有错误信息
4. 检查 `window.AntiTheftPlugin` 是否存在

### Q: 密码验证失败？

**A:** 请检查：
1. 网络连接是否正常
2. 服务器地址是否正确
3. 密码是否正确（区分大小写）
4. 联系角色卡作者确认密码
5. 在浏览器控制台查看详细错误信息

### Q: 密码正确但仍然无法解锁？

**A:** 可能的原因：
1. 作者更新了密码，请联系作者获取最新密码
2. 服务器暂时不可用，请稍后再试
3. 网络问题，请检查网络连接

### Q: 如何查看插件日志？

**A:** 
1. 打开浏览器开发者工具（F12）
2. 切换到"控制台"标签
3. 查找以 `[AntiTheft]` 开头的日志信息
4. 如需更详细的日志，可以在插件设置中启用调试模式

### Q: 如何自定义服务器地址？

**A:** 服务器地址由角色卡作者在加密时设置，用户无需修改。如果需要使用自己的服务器：
1. 部署自己的验证服务器（参考部署文档）
2. 在加密角色卡时指定自己的服务器地址

### Q: 插件会影响普通角色卡吗？

**A:** 不会。插件只处理包含 `anti_theft` 配置的角色卡，普通角色卡不受影响。

## 安全说明

- 密码在传输过程中使用 HTTPS 加密
- 密码在服务器上使用 bcrypt 加密存储
- 插件不会存储明文密码
- 验证请求有速率限制，防止暴力破解

## 技术支持

- **GitHub Issues**: https://github.com/your-repo/antitheft/issues
- **文档**: https://github.com/your-repo/antitheft/wiki
- **邮箱**: support@example.com

## 许可证

MIT License

## 更新日志

### v1.0.0 (2024-01-20)
- 初始版本发布
- 支持密码验证功能
- 支持密码版本控制
- 支持自定义服务器地址
- 自动重新锁定过期密码
- 友好的设置面板

## 贡献

欢迎提交 Pull Request 或报告 Issue！

## 相关项目

- [防盗服务器后端](https://github.com/your-repo/anti-theft-server)
- [Web 管理界面](https://github.com/your-repo/anti-theft-web)
- [部署文档](https://github.com/your-repo/character-card-anti-theft-system)

## 致谢

感谢 SillyTavern 团队提供优秀的扩展系统！
