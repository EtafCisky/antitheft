/**
 * SillyTavern 角色卡防盗插件 v2.0
 * Character Card Anti-Theft Plugin for SillyTavern
 *
 * 新功能：
 * - 通过专用按钮导入加密角色卡
 * - 显示密码验证弹窗
 * - 解密后自动导入角色卡
 *
 * @version 2.0.0
 * @author EtafCisky
 * @license CC BY-ND 4.0
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
const PLUGIN_VERSION = "2.0.0";

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
 * 读取 PNG 元数据
 */
async function readPngMetadata(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const arrayBuffer = e.target.result;
        const uint8Array = new Uint8Array(arrayBuffer);

        // 验证 PNG 签名
        const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
        for (let i = 0; i < 8; i++) {
          if (uint8Array[i] !== pngSignature[i]) {
            throw new Error("不是有效的 PNG 文件");
          }
        }

        let offset = 8;
        let metadata = null;

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
                const jsonString = new TextDecoder("utf-8").decode(bytes);
                metadata = JSON.parse(jsonString);
                break;
              }
            }
          }

          offset += length + 4;

          if (type === "IEND") break;
        }

        if (!metadata) {
          throw new Error("PNG 文件中未找到角色卡元数据");
        }

        resolve(metadata);
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
  logger.debug("verifyPassword", { cardId, serverUrl });

  if (!cardId || !password || !serverUrl) {
    return { success: false, message: "参数错误" };
  }

  try {
    const response = await fetch(`${serverUrl}/api/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_id: cardId, password: password }),
    });

    if (response.status === 429) {
      return { success: false, message: "请求过于频繁，请稍后再试" };
    }

    if (!response.ok) {
      return { success: false, message: `服务器错误 (${response.status})` };
    }

    const data = await response.json();
    return data;
  } catch (error) {
    logger.error("验证失败", error);
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
        <h3 style="margin: 16px 0 8px;">🔒 角色卡已加密</h3>
        <p style="margin: 0; color: #666;">请输入密码以解锁此角色卡</p>
      </div>
      
      <div style="margin-bottom: 16px; padding: 12px; background: #f5f5f5; border-radius: 6px; font-size: 13px;">
        <div><strong>角色卡:</strong> ${cardInfo.name}</div>
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

  // 验证密码
  const result = await verifyPassword(
    cardInfo.card_id,
    password,
    cardInfo.server_url,
  );

  if (result.success) {
    return password;
  } else {
    toastr.error(result.message || "密码错误", "验证失败");
    // 递归重试
    return await showPasswordDialog(cardInfo);
  }
}

/**
 * 导入解密后的角色卡
 */
async function importDecryptedCard(originalMetadata, fileName) {
  try {
    logger.info("导入解密后的角色卡", fileName);

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
      cache: "no-cache",
    });

    if (!result.ok) {
      throw new Error(`导入失败: ${result.statusText}`);
    }

    const data = await result.json();

    if (data.error) {
      throw new Error(`服务器错误: ${data.error}`);
    }

    if (data.file_name) {
      logger.info("导入成功", data.file_name);
      return data.file_name;
    }

    return null;
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

  $("#antitheft_enabled")
    .prop("checked", extension_settings[extensionName].enabled)
    .trigger("input");
  $("#antitheft_debug")
    .prop("checked", extension_settings[extensionName].debug)
    .trigger("input");
  $("#antitheft_server_url")
    .val(extension_settings[extensionName].serverUrl)
    .trigger("input");

  logger.debug("设置已加载", extension_settings[extensionName]);
}

/**
 * 设置变更处理
 */
function onEnabledChange(event) {
  extension_settings[extensionName].enabled = Boolean(
    $(event.target).prop("checked"),
  );
  saveSettingsDebounced();
}

function onDebugChange(event) {
  extension_settings[extensionName].debug = Boolean(
    $(event.target).prop("checked"),
  );
  saveSettingsDebounced();
}

function onServerUrlChange(event) {
  extension_settings[extensionName].serverUrl = String($(event.target).val());
  saveSettingsDebounced();
}

/**
 * 插件初始化
 */
jQuery(async () => {
  try {
    logger.info(`插件初始化 v${PLUGIN_VERSION}`);

    // 加载设置面板
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
    $("#extensions_settings").append(settingsHtml);

    // 绑定设置事件
    $("#antitheft_enabled").on("input", onEnabledChange);
    $("#antitheft_debug").on("input", onDebugChange);
    $("#antitheft_server_url").on("input", onServerUrlChange);

    // 绑定标签页切换
    $(".antitheft-tab").on("click", function () {
      const tabName = $(this).data("tab");
      $(".antitheft-tab").removeClass("active");
      $(this).addClass("active");
      $(".antitheft-tab-content").removeClass("active");
      $(`#antitheft-${tabName}-tab`).addClass("active");
    });

    // 加载设置
    await loadSettings();

    // 绑定导入按钮
    $("#antitheft_import_button").on("click", function () {
      $("#antitheft_import_file").trigger("click");
    });

    $("#antitheft_import_file").on("change", async function (e) {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const file = files[0];
      logger.info("选择文件", file.name);

      try {
        const metadata = await readPngMetadata(file);

        if (
          metadata.spec === "chara_card_v2_encrypted" &&
          metadata.anti_theft_encrypted
        ) {
          logger.info("检测到加密角色卡");

          const cardInfo = {
            name: metadata.name,
            card_id: metadata.anti_theft_encrypted.card_id,
            server_url: metadata.anti_theft_encrypted.server_url,
            encrypted_data: metadata.anti_theft_encrypted.encrypted_data,
          };

          const password = await showPasswordDialog(cardInfo);

          if (!password) {
            toastr.info("已取消导入", "提示");
            $(this).val("");
            return;
          }

          const originalMetadata = decryptCardData(cardInfo.encrypted_data);

          if (!originalMetadata) {
            toastr.error("解密失败，数据可能已损坏", "错误");
            $(this).val("");
            return;
          }

          const fileName = await importDecryptedCard(
            originalMetadata,
            file.name.replace(".png", ""),
          );

          if (fileName) {
            toastr.success(`角色卡已导入: ${fileName}`, "成功");
            if (typeof getCharacters === "function") {
              await getCharacters();
            }
          }
        } else {
          toastr.warning("此文件不是加密角色卡", "提示");
        }
      } catch (error) {
        logger.error("导入失败", error);
        toastr.error(error.message || "导入失败", "错误");
      } finally {
        $(this).val("");
      }
    });

    // 注册全局 API
    window.AntiTheftPlugin = {
      verifyPassword,
      decryptCardData,
      importDecryptedCard,
      readPngMetadata,
      version: PLUGIN_VERSION,
      name: extensionName,
    };

    logger.info("插件初始化完成");
  } catch (error) {
    logger.error("插件初始化失败", error);
  }
});
