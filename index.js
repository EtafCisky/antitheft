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
  enabled: true,
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
          const parts = metadataString.split(":");
          logger.debug("分割后的部分数量:", parts.length);
          if (parts.length >= 5) {
            resolve({
              encrypted: true,
              card_id: parts[1],
              server_url: parts[2],
              password_version: parseInt(parts[3]),
              encrypted_data: parts.slice(4).join(":"),
            });
          } else {
            throw new Error("加密格式错误");
          }
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
async function importDecryptedCard(originalMetadata, fileName) {
  try {
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

    return data.file_name || null;
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

  $("#antitheft_enabled").prop(
    "checked",
    extension_settings[extensionName].enabled,
  );
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

    $("#antitheft_enabled").on("input", (e) => {
      extension_settings[extensionName].enabled = Boolean(
        $(e.target).prop("checked"),
      );
      saveSettingsDebounced();
    });

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
