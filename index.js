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
async function importDecryptedCard(originalMetadata, fileName, originalFile) {
  try {
    // 读取原始 PNG 文件
    const arrayBuffer = await originalFile.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // 将解密后的元数据转换为 base64
    const jsonString = JSON.stringify(originalMetadata);
    const utf8Bytes = new TextEncoder().encode(jsonString);
    const binaryString = Array.from(utf8Bytes)
      .map((byte) => String.fromCharCode(byte))
      .join("");
    const base64String = btoa(binaryString);

    // 创建新的 PNG，将解密后的元数据写入 tEXt chunk
    const newPngData = [];

    // 复制 PNG 签名
    for (let i = 0; i < 8; i++) {
      newPngData.push(uint8Array[i]);
    }

    // 添加解密后的 chara tEXt chunk
    const keyword = "chara";
    const keywordBytes = new TextEncoder().encode(keyword);
    const valueBytes = new TextEncoder().encode(base64String);
    const chunkData = new Uint8Array(
      keywordBytes.length + 1 + valueBytes.length,
    );
    chunkData.set(keywordBytes, 0);
    chunkData[keywordBytes.length] = 0; // null separator
    chunkData.set(valueBytes, keywordBytes.length + 1);

    const chunkLength = chunkData.length;
    const chunkType = new TextEncoder().encode("tEXt");

    // 写入 chunk length
    newPngData.push((chunkLength >> 24) & 0xff);
    newPngData.push((chunkLength >> 16) & 0xff);
    newPngData.push((chunkLength >> 8) & 0xff);
    newPngData.push(chunkLength & 0xff);

    // 写入 chunk type
    for (let i = 0; i < 4; i++) {
      newPngData.push(chunkType[i]);
    }

    // 写入 chunk data
    for (let i = 0; i < chunkData.length; i++) {
      newPngData.push(chunkData[i]);
    }

    // 计算 CRC
    const crcData = new Uint8Array(4 + chunkData.length);
    crcData.set(chunkType, 0);
    crcData.set(chunkData, 4);
    const crc = calculateCRC32(crcData);

    // 写入 CRC
    newPngData.push((crc >> 24) & 0xff);
    newPngData.push((crc >> 16) & 0xff);
    newPngData.push((crc >> 8) & 0xff);
    newPngData.push(crc & 0xff);

    // 复制原始 PNG 的其他 chunks（跳过旧的 chara tEXt chunk）
    let offset = 8;
    while (offset < uint8Array.length) {
      const length =
        (uint8Array[offset] << 24) |
        (uint8Array[offset + 1] << 16) |
        (uint8Array[offset + 2] << 8) |
        uint8Array[offset + 3];

      const type = String.fromCharCode(
        uint8Array[offset + 4],
        uint8Array[offset + 5],
        uint8Array[offset + 6],
        uint8Array[offset + 7],
      );

      // 跳过旧的 chara tEXt chunk
      if (type === "tEXt") {
        const data = uint8Array.slice(offset + 8, offset + 8 + length);
        let nullIndex = -1;
        for (let i = 0; i < data.length; i++) {
          if (data[i] === 0) {
            nullIndex = i;
            break;
          }
        }
        if (nullIndex !== -1) {
          const kw = new TextDecoder().decode(data.slice(0, nullIndex));
          if (kw === "chara") {
            // 跳过这个 chunk
            offset += 12 + length;
            continue;
          }
        }
      }

      // 复制其他 chunks
      for (let i = 0; i < 12 + length; i++) {
        newPngData.push(uint8Array[offset + i]);
      }

      offset += 12 + length;
      if (type === "IEND") break;
    }

    // 创建新的 PNG Blob
    const newPngBlob = new Blob([new Uint8Array(newPngData)], {
      type: "image/png",
    });

    // 导入 PNG 文件
    const formData = new FormData();
    formData.append("avatar", newPngBlob, `${fileName}.png`);

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
 * 计算 CRC32
 */
function calculateCRC32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
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
            file,
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
