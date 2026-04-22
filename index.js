/**
 * SillyTavern 角色卡防盗插件 v3.0
 * 使用字符串加密格式，完全阻止直接导入
 */

/* global jQuery, window, $, toastr, getCharacters */

import {
  getRequestHeaders,
  saveSettingsDebounced,
} from "../../../../script.js";
import { extension_settings } from "../../../extensions.js";
import { callGenericPopup, POPUP_TYPE } from "../../../popup.js";

const extensionName = "antitheft";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const PLUGIN_VERSION = "3.0.0";

const defaultSettings = {
  debug: false,
  serverUrl: "",
};

const logger = {
  info: (message, ...args) => console.log(`[AntiTheft] ${message}`, ...args),
  warn: (message, ...args) => console.warn(`[AntiTheft] ${message}`, ...args),
  error: (message, ...args) => console.error(`[AntiTheft] ${message}`, ...args),
  debug: (message, ...args) => {
    if (extension_settings[extensionName]?.debug) {
      console.debug(`[AntiTheft] ${message}`, ...args);
    }
  },
};

/**
 * 读取 PNG 元数据 - 支持加密格式
 */
async function readPngMetadata(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const arrayBuffer = e.target.result;
        const uint8Array = new Uint8Array(arrayBuffer);

        const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
        for (let i = 0; i < 8; i++) {
          if (uint8Array[i] !== pngSignature[i]) {
            throw new Error("不是有效的 PNG 文件");
          }
        }

        let offset = 8;
        let metadataString = null;

        while (offset < uint8Array.length) {
          const length =
            (uint8Array[offset] << 24) |
            (uint8Array[offset + 1] << 16) |
            (uint8Array[offset + 2] << 8) |
            uint8Array[offset + 3];
          offset += 4;

          const type = String.fromCharCode(
            uint8Array[offset],
            uint8Array[offset + 1],
            uint8Array[offset + 2],
            uint8Array[offset + 3],
          );
          offset += 4;

          if (type === "tEXt") {
            const data = uint8Array.slice(offset, offset + length);
            let nullIndex = -1;
            for (let i = 0; i < data.length; i++) {
              if (data[i] === 0) {
                nullIndex = i;
                break;
              }
            }

            if (nullIndex !== -1) {
              const keyword = new TextDecoder().decode(
                data.slice(0, nullIndex),
              );

              if (keyword === "chara") {
                const valueBytes = data.slice(nullIndex + 1);
                const base64String = new TextDecoder().decode(valueBytes);
                const binaryString = atob(base64String);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                metadataString = new TextDecoder("utf-8").decode(bytes);
                break;
              }
            }
          }

          offset += length + 4;
          if (type === "IEND") break;
        }

        if (!metadataString) {
          throw new Error("PNG 文件中未找到角色卡元数据");
        }

        // 调试：输出元数据前100个字符
        logger.debug("元数据内容:", metadataString.substring(0, 100));

        // 检查是否为加密格式: ENCRYPTED:cardId:serverUrl:version:base64data
        if (metadataString.startsWith("ENCRYPTED:")) {
          logger.debug("检测到加密格式");

          // 使用正则表达式解析，避免 serverUrl 中的冒号导致解析错误
          // 格式: ENCRYPTED:cardId:serverUrl:version:base64data
          const encryptedPrefix = "ENCRYPTED:";
          let remaining = metadataString.substring(encryptedPrefix.length);

          // 提取 cardId (6-8位数字)
          const cardIdMatch = remaining.match(/^(\d{6,8}):/);
          if (!cardIdMatch) {
            throw new Error("加密格式错误：无法解析 cardId");
          }
          const card_id = cardIdMatch[1];
          remaining = remaining.substring(card_id.length + 1);

          // 提取 serverUrl (http:// 或 https:// 开头，到下一个 :数字: 为止)
          const serverUrlMatch = remaining.match(
            /^(https?:\/\/[^:]+(?::\d+)?):(\d+):/,
          );
          if (!serverUrlMatch) {
            throw new Error("加密格式错误：无法解析 serverUrl");
          }
          const server_url = serverUrlMatch[1];
          const password_version = parseInt(serverUrlMatch[2]);
          remaining = remaining.substring(serverUrlMatch[0].length);

          // 剩余部分是 encrypted_data
          const encrypted_data = remaining;

          logger.debug("解析结果:", {
            card_id,
            server_url,
            password_version,
            encrypted_data_length: encrypted_data.length,
          });

          resolve({
            encrypted: true,
            card_id,
            server_url,
            password_version,
            encrypted_data,
          });
        } else {
          logger.warn(
            "不是加密格式，元数据开头:",
            metadataString.substring(0, 20),
          );
          resolve({ encrypted: false });
        }
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 解密角色卡数据
 */
function decryptCardData(encryptedBase64) {
  try {
    const jsonString = decodeURIComponent(
      atob(encryptedBase64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );
    return JSON.parse(jsonString);
  } catch (error) {
    logger.error("解密失败", error);
    return null;
  }
}

/**
 * 验证密码
 */
async function verifyPassword(cardId, password, serverUrl) {
  try {
    logger.debug("验证密码请求:", { cardId, serverUrl });
    const response = await fetch(`${serverUrl}/api/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_id: cardId, password: password }),
    });

    if (response.status === 429) {
      return { success: false, message: "请求过于频繁" };
    }

    if (!response.ok) {
      return { success: false, message: `服务器错误 (${response.status})` };
    }

    return await response.json();
  } catch (error) {
    return { success: false, message: `网络错误：${error.message}` };
  }
}

/**
 * 显示密码验证弹窗
 */
async function showPasswordDialog(cardInfo) {
  const dialogHtml = `
    <div style="padding: 20px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h3>🔒 角色卡已加密</h3>
        <p style="color: #666;">请输入密码解锁</p>
      </div>
      <div style="margin-bottom: 16px; padding: 12px; background: #f5f5f5; border-radius: 6px; font-size: 13px;">
        <div><strong>文件:</strong> ${cardInfo.name}</div>
        <div><strong>Card ID:</strong> ${cardInfo.card_id}</div>
        <div><strong>服务器:</strong> ${cardInfo.server_url}</div>
      </div>
    </div>
  `;

  const password = await callGenericPopup(dialogHtml, POPUP_TYPE.INPUT, "", {
    okButton: "验证",
    cancelButton: "取消",
  });

  if (!password) return null;

  const result = await verifyPassword(
    cardInfo.card_id,
    password,
    cardInfo.server_url,
  );

  if (result.success) {
    return password;
  } else {
    toastr.error(result.message || "密码错误", "验证失败");
    return await showPasswordDialog(cardInfo);
  }
}

/**
 * 导入解密后的角色卡
 */
async function importDecryptedCard(originalMetadata, fileName, pngFile) {
  try {
    // 第一步：导入 JSON 数据（会生成带默认头像的 PNG 文件）
    logger.debug("开始导入角色卡 JSON 数据");
    const jsonBlob = new Blob([JSON.stringify(originalMetadata)], {
      type: "application/json",
    });

    const formData = new FormData();
    formData.append("avatar", jsonBlob, `${fileName}.json`);
    formData.append("file_type", "json");

    const result = await fetch("/api/characters/import", {
      method: "POST",
      body: formData,
      headers: getRequestHeaders({ omitContentType: true }),
    });

    if (!result.ok) {
      throw new Error(`导入失败: ${result.statusText}`);
    }

    const data = await result.json();
    if (data.error) {
      throw new Error(`服务器错误: ${data.error}`);
    }

    const importedFileName = data.file_name;
    if (!importedFileName) {
      throw new Error("导入成功但未返回文件名");
    }

    logger.info("角色卡 JSON 导入成功:", importedFileName);

    // 第二步：替换 PNG 文件的头像（模仿 SillyTavern 的更换头像流程）
    if (pngFile) {
      logger.debug("开始替换角色头像");

      try {
        // 等待一小段时间，确保文件系统已完成写入
        await new Promise((resolve) => setTimeout(resolve, 100));

        const getResult = await fetch("/api/characters/get", {
          method: "POST",
          headers: getRequestHeaders(),
          body: JSON.stringify({ avatar_url: `${importedFileName}.png` }),
        });

        if (!getResult.ok) {
          logger.warn("无法读取角色数据，跳过头像替换");
          // 即使失败也要刷新列表
          if (typeof getCharacters === "function") {
            await getCharacters();
          }
          return importedFileName;
        }

        const charData = await getResult.json();
        logger.debug("成功读取角色数据，准备替换头像");
        logger.debug("角色数据字段:", Object.keys(charData));

        // 构建 FormData，模仿 SillyTavern 的表单提交
        const editFormData = new FormData();

        // 关键：添加新的头像文件
        editFormData.append("avatar", pngFile);

        // 必需字段
        editFormData.append("avatar_url", `${importedFileName}.png`);
        editFormData.append("ch_name", charData.name || "");
        editFormData.append("description", charData.description || "");
        editFormData.append("personality", charData.personality || "");
        editFormData.append("scenario", charData.scenario || "");
        editFormData.append("first_mes", charData.first_mes || "");
        editFormData.append("mes_example", charData.mes_example || "");

        // 可选字段（只在有值时添加）
        if (charData.creator_notes)
          editFormData.append("creator_notes", charData.creator_notes);
        if (charData.system_prompt)
          editFormData.append("system_prompt", charData.system_prompt);
        if (charData.post_history_instructions)
          editFormData.append(
            "post_history_instructions",
            charData.post_history_instructions,
          );
        if (charData.tags) editFormData.append("tags", charData.tags);
        if (charData.creator) editFormData.append("creator", charData.creator);
        if (charData.character_version)
          editFormData.append("character_version", charData.character_version);

        editFormData.append("fav", String(charData.fav || false));

        // alternate_greetings
        if (Array.isArray(charData.data?.alternate_greetings)) {
          for (const greeting of charData.data.alternate_greetings) {
            editFormData.append("alternate_greetings", greeting);
          }
        }

        // extensions（包含世界书等重要数据）
        if (charData.data?.extensions) {
          editFormData.append(
            "extensions",
            JSON.stringify(charData.data.extensions),
          );
        }

        logger.debug("准备调用 /api/characters/edit");

        // 调用 edit API 替换头像
        const editResult = await fetch("/api/characters/edit", {
          method: "POST",
          body: editFormData,
          headers: getRequestHeaders({ omitContentType: true }),
        });

        if (editResult.ok) {
          logger.info("头像替换成功");

          // 刷新缩略图缓存（模仿 SillyTavern 的行为）
          try {
            await fetch(
              `/api/avatar?file=${encodeURIComponent(importedFileName)}.png`,
              {
                method: "GET",
                cache: "reload",
              },
            );
            logger.debug("缩略图缓存已刷新");
          } catch (e) {
            logger.debug("缩略图刷新失败（可忽略）:", e.message);
          }
        } else {
          const errorText = await editResult.text();
          logger.error("头像替换失败:", errorText);
          logger.error("HTTP 状态码:", editResult.status);
        }
      } catch (err) {
        logger.error("头像替换过程出错:", err);
      }
    }

    // 第三步：刷新角色列表（重要！）
    logger.debug("刷新角色列表");
    if (typeof getCharacters === "function") {
      await getCharacters();
      logger.info("角色列表已刷新");
    } else {
      logger.warn("getCharacters 函数不可用");
    }

    return importedFileName;
  } catch (error) {
    logger.error("导入失败", error);
    throw error;
  }
}

/**
 * 加载设置
 */
async function loadSettings() {
  extension_settings[extensionName] = extension_settings[extensionName] || {};
  if (Object.keys(extension_settings[extensionName]).length === 0) {
    Object.assign(extension_settings[extensionName], defaultSettings);
  }

  $("#antitheft_debug").prop(
    "checked",
    extension_settings[extensionName].debug,
  );
  $("#antitheft_server_url").val(extension_settings[extensionName].serverUrl);
}

/**
 * 插件初始化
 */
jQuery(async () => {
  try {
    logger.info(`插件初始化 v${PLUGIN_VERSION}`);

    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
    $("#extensions_settings").append(settingsHtml);

    $("#antitheft_debug").on("input", (e) => {
      extension_settings[extensionName].debug = Boolean(
        $(e.target).prop("checked"),
      );
      saveSettingsDebounced();
    });

    $("#antitheft_server_url").on("input", (e) => {
      extension_settings[extensionName].serverUrl = String($(e.target).val());
      saveSettingsDebounced();
    });

    // 标签页切换
    $(".antitheft-tab").on("click", function () {
      const tabName = $(this).data("tab");
      $(".antitheft-tab").removeClass("active");
      $(this).addClass("active");
      $(".antitheft-tab-content").removeClass("active");
      $(`#antitheft-${tabName}-tab`).addClass("active");
    });

    await loadSettings();

    $("#antitheft_import_button").on("click", () =>
      $("#antitheft_import_file").trigger("click"),
    );

    $("#antitheft_import_file").on("change", async function (e) {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const file = files[0];
      logger.info("选择文件", file.name);

      try {
        const result = await readPngMetadata(file);

        if (result.encrypted) {
          logger.info("检测到加密角色卡");

          const cardInfo = {
            name: file.name.replace(".png", ""),
            card_id: result.card_id,
            server_url: result.server_url,
            encrypted_data: result.encrypted_data,
          };

          const password = await showPasswordDialog(cardInfo);
          if (!password) {
            toastr.info("已取消导入");
            $(this).val("");
            return;
          }

          const originalMetadata = decryptCardData(cardInfo.encrypted_data);
          if (!originalMetadata) {
            toastr.error("解密失败");
            $(this).val("");
            return;
          }

          const fileName = await importDecryptedCard(
            originalMetadata,
            file.name.replace(".png", ""),
            file, // 传入原始 PNG 文件用于上传头像
          );
          if (fileName) {
            toastr.success(`角色卡已导入: ${fileName}`);
            if (typeof getCharacters === "function") {
              await getCharacters();
            }
          }
        } else {
          toastr.warning("此文件不是加密角色卡");
        }
      } catch (error) {
        logger.error("导入失败", error);
        toastr.error(error.message || "导入失败");
      } finally {
        $(this).val("");
      }
    });

    window.AntiTheftPlugin = {
      verifyPassword,
      decryptCardData,
      importDecryptedCard,
      readPngMetadata,
      version: PLUGIN_VERSION,
    };

    logger.info("插件初始化完成");
  } catch (error) {
    logger.error("插件初始化失败", error);
  }
});
