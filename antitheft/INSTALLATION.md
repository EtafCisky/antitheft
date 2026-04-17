# 安装指南

## 快速安装（推荐）

### 使用 SillyTavern 内置安装器

1. 打开 SillyTavern
2. 点击顶部的"扩展"图标（拼图图标）
3. 点击"安装扩展"
4. 输入仓库地址：`https://github.com/your-repo/antitheft`
5. 点击"安装"
6. 刷新页面

## 手动安装

### Windows

1. 打开文件资源管理器
2. 导航到 SillyTavern 安装目录
3. 进入 `public\scripts\extensions\third-party\` 文件夹
4. 将 `antitheft` 文件夹复制到这里
5. 重启 SillyTavern

完整路径示例：
```
C:\SillyTavern\public\scripts\extensions\third-party\antitheft\
```

### Linux / macOS

1. 打开终端
2. 导航到 SillyTavern 安装目录
3. 运行以下命令：

```bash
cd public/scripts/extensions/third-party/
git clone https://github.com/your-repo/antitheft.git
```

4. 重启 SillyTavern

## 验证安装

### 方法 1：检查扩展列表

1. 打开 SillyTavern
2. 点击顶部的"扩展"图标
3. 在扩展列表中应该能看到"角色卡防盗"

### 方法 2：检查浏览器控制台

1. 打开 SillyTavern
2. 按 F12 打开开发者工具
3. 切换到"控制台"标签
4. 查找以下日志：
   ```
   [AntiTheft] 插件初始化 v1.0.0
   [AntiTheft] 全局 API 已注册: window.AntiTheftPlugin
   [AntiTheft] 插件初始化完成
   ```

### 方法 3：检查全局 API

1. 打开浏览器控制台（F12）
2. 输入以下命令：
   ```javascript
   window.AntiTheftPlugin.checkVersion()
   ```
3. 如果返回版本信息，说明安装成功：
   ```javascript
   {name: "antitheft", version: "1.0.0", installed: true}
   ```

## 常见安装问题

### 问题 1：插件未出现在扩展列表中

**原因：** 文件夹位置或名称不正确

**解决方法：**
1. 确保文件夹位于 `public/scripts/extensions/third-party/` 目录下
2. 确保文件夹名称是 `antitheft`（不是其他名称）
3. 确保文件夹内包含 `manifest.json`、`index.js`、`style.css`、`settings.html` 文件

### 问题 2：控制台显示错误

**原因：** 文件损坏或不完整

**解决方法：**
1. 重新下载插件文件
2. 确保所有文件都已正确复制
3. 检查文件权限（Linux/macOS）

### 问题 3：`window.AntiTheftPlugin` 未定义

**原因：** 插件未正确加载

**解决方法：**
1. 检查浏览器控制台是否有错误信息
2. 确保 SillyTavern 版本兼容（需要支持扩展系统）
3. 尝试清除浏览器缓存后重新加载

### 问题 4：权限错误（Linux/macOS）

**原因：** 文件权限不正确

**解决方法：**
```bash
cd SillyTavern/public/scripts/extensions/third-party/
chmod -R 755 antitheft/
```

## 卸载插件

### 方法 1：使用 SillyTavern 界面

1. 打开 SillyTavern
2. 点击"扩展"图标
3. 找到"角色卡防盗"插件
4. 点击"卸载"按钮

### 方法 2：手动删除

1. 导航到 `public/scripts/extensions/third-party/` 目录
2. 删除 `antitheft` 文件夹
3. 重启 SillyTavern

## 更新插件

### 使用 Git（推荐）

```bash
cd SillyTavern/public/scripts/extensions/third-party/antitheft/
git pull origin main
```

### 手动更新

1. 下载最新版本的插件文件
2. 删除旧的 `antitheft` 文件夹
3. 复制新的文件夹到相同位置
4. 重启 SillyTavern

## 需要帮助？

如果安装过程中遇到问题：

1. 查看 [常见问题](README.md#常见问题)
2. 在 [GitHub Issues](https://github.com/your-repo/antitheft/issues) 搜索类似问题
3. 提交新的 Issue（附带错误信息和截图）
4. 联系技术支持：support@example.com
