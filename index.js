/**
 * SillyTavern 角色卡防盗插件
 * Character Card Anti-Theft Plugin for SillyTavern
 *
 * @version 1.0.0
 * @author EtafCisky
 * @license CC BY-ND 4.0
 * @copyright Copyright © 2024 EtafCisky. All rights reserved.
 */

/* global jQuery, window, $ */

import {
    eventSource,
    event_types,
    saveSettingsDebounced,
} from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';

// 插件名称（必须与文件夹名称匹配）
const extensionName = 'antitheft';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const PLUGIN_VERSION = '1.0.0';

// 默认设置
const defaultSettings = {
    enabled: true,
    debug: false,
    serverUrl: '', // 可选：默认服务器地址
};

/**
 * 日志工具
 */
const logger = {
    info: (message, ...args) => {
        console.log(`[AntiTheft] ${message}`, ...args);
    },
    warn: (message, ...args) => {
        console.warn(`[AntiTheft] ${message}`, ...args);
    },
    error: (message, ...args) => {
        console.error(`[AntiTheft] ${message}`, ...args);
    },
    debug: (message, ...args) => {
        if (extension_settings[extensionName]?.debug) {
            console.debug(`[AntiTheft] ${message}`, ...args);
        }
    },
};

/**
 * 验证密码
 * 供嵌入脚本调用的核心 API
 */
async function verifyPassword(cardId, password, serverUrl) {
    logger.debug('verifyPassword called', { cardId, serverUrl });

    // 输入验证
    if (!cardId || !password || !serverUrl) {
        logger.error('verifyPassword: 缺少必需参数');
        return {
            success: false,
            message: '参数错误：缺少必需参数',
        };
    }

    // 验证 cardId 格式（6-8位数字）
    if (!/^\d{6,8}$/.test(cardId)) {
        logger.error('verifyPassword: cardId 格式无效', cardId);
        return {
            success: false,
            message: '参数错误：cardId 格式无效',
        };
    }

    // 验证 serverUrl 格式
    try {
        new URL(serverUrl);
    } catch (e) {
        logger.error('verifyPassword: serverUrl 格式无效', serverUrl);
        return {
            success: false,
            message: '参数错误：服务器地址格式无效',
        };
    }

    try {
    // 发送验证请求到服务器
        const response = await fetch(`${serverUrl}/api/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                card_id: cardId,
                password: password,
            }),
        });

        // 处理速率限制
        if (response.status === 429) {
            logger.warn('verifyPassword: 速率限制');
            return {
                success: false,
                message: '请求过于频繁，请稍后再试',
            };
        }

        // 处理其他 HTTP 错误
        if (!response.ok) {
            logger.error('verifyPassword: HTTP 错误', response.status);
            return {
                success: false,
                message: `服务器错误 (${response.status})`,
            };
        }

        const data = await response.json();
        logger.debug('verifyPassword: 服务器响应', data);

        // 如果验证成功，更新角色卡的锁定状态
        if (data.success && data.password_version) {
            await unlockCurrentCard(data.password_version);
        }

        return data;
    } catch (error) {
        logger.error('verifyPassword: 网络错误', error);
        return {
            success: false,
            message: `网络错误：${error.message}`,
        };
    }
}

/**
 * 检查密码版本
 */
async function checkPasswordVersion(cardId, serverUrl) {
    logger.debug('checkPasswordVersion called', { cardId, serverUrl });

    if (!cardId || !serverUrl) {
        logger.error('checkPasswordVersion: 缺少必需参数');
        return -1;
    }

    try {
        const response = await fetch(`${serverUrl}/api/cards/${cardId}/version`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            logger.error('checkPasswordVersion: HTTP 错误', response.status);
            return -1;
        }

        const data = await response.json();
        logger.debug('checkPasswordVersion: 服务器响应', data);

        return data.password_version || -1;
    } catch (error) {
        logger.error('checkPasswordVersion: 网络错误', error);
        return -1;
    }
}

/**
 * 解锁当前角色卡
 */
async function unlockCurrentCard(passwordVersion) {
    try {
    // 获取当前角色卡上下文
        const context = getContext();
        if (!context || !context.characters || context.characterId === undefined) {
            logger.error('unlockCurrentCard: 无法获取角色卡上下文');
            return;
        }

        const character = context.characters[context.characterId];
        if (!character || !character.data) {
            logger.error('unlockCurrentCard: 角色卡数据无效');
            return;
        }

        // 确保 extensions 对象存在
        if (!character.data.extensions) {
            character.data.extensions = {};
        }

        // 确保 anti_theft 配置存在
        if (!character.data.extensions.anti_theft) {
            character.data.extensions.anti_theft = {};
        }

        // 更新锁定状态
        character.data.extensions.anti_theft.locked = false;
        character.data.extensions.anti_theft.password_version = passwordVersion;
        character.data.extensions.anti_theft.last_unlock_time = Date.now();

        logger.info('unlockCurrentCard: 角色卡已解锁', {
            characterId: context.characterId,
            passwordVersion,
        });

        // 保存角色卡数据
        await saveSettingsDebounced();
    } catch (error) {
        logger.error('unlockCurrentCard: 解锁失败', error);
    }
}

/**
 * 重新锁定角色卡
 */
async function lockCard(character) {
    try {
        if (!character || !character.data) {
            logger.error('lockCard: 角色卡数据无效');
            return;
        }

        // 确保 extensions 对象存在
        if (!character.data.extensions) {
            character.data.extensions = {};
        }

        // 确保 anti_theft 配置存在
        if (!character.data.extensions.anti_theft) {
            character.data.extensions.anti_theft = {};
        }

        // 更新锁定状态
        character.data.extensions.anti_theft.locked = true;

        logger.info('lockCard: 角色卡已重新锁定');

        // 保存角色卡数据
        await saveSettingsDebounced();
    } catch (error) {
        logger.error('lockCard: 锁定失败', error);
    }
}

/**
 * 检查并自动重新锁定角色卡（如果密码版本不匹配）
 */
async function checkAndRelockIfNeeded(character) {
    try {
        if (!character || !character.data) {
            return false;
        }

        const antiTheft = character.data.extensions?.anti_theft;
        if (!antiTheft || !antiTheft.enabled) {
            return false;
        }

        // 如果已经锁定，无需检查
        if (antiTheft.locked) {
            return false;
        }

        // 检查服务器上的密码版本
        const serverVersion = await checkPasswordVersion(
            antiTheft.card_id,
            antiTheft.server_url,
        );

        // 如果无法获取服务器版本，不重新锁定
        if (serverVersion === -1) {
            logger.warn('checkAndRelockIfNeeded: 无法获取服务器密码版本');
            return false;
        }

        // 如果版本不匹配，重新锁定
        const localVersion = antiTheft.password_version || 0;
        if (serverVersion !== localVersion) {
            logger.info('checkAndRelockIfNeeded: 密码版本不匹配，重新锁定', {
                localVersion,
                serverVersion,
            });
            await lockCard(character);
            return true;
        }

        return false;
    } catch (error) {
        logger.error('checkAndRelockIfNeeded: 检查失败', error);
        return false;
    }
}

/**
 * 获取插件版本
 */
function getVersion() {
    return PLUGIN_VERSION;
}

/**
 * 检查插件版本
 * 供嵌入脚本检测插件是否已安装
 */
function checkVersion() {
    return {
        name: extensionName,
        version: PLUGIN_VERSION,
        installed: true,
    };
}

/**
 * 加载插件设置
 */
async function loadSettings() {
    // 创建设置对象（如果不存在）
    extension_settings[extensionName] = extension_settings[extensionName] || {};

    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }

    // 更新 UI
    $('#antitheft_enabled')
        .prop('checked', extension_settings[extensionName].enabled)
        .trigger('input');
    $('#antitheft_debug')
        .prop('checked', extension_settings[extensionName].debug)
        .trigger('input');
    $('#antitheft_server_url')
        .val(extension_settings[extensionName].serverUrl)
        .trigger('input');

    logger.debug('插件设置已加载', extension_settings[extensionName]);
}

/**
 * 设置变更处理
 */
function onEnabledChange(event) {
    const value = Boolean($(event.target).prop('checked'));
    extension_settings[extensionName].enabled = value;
    saveSettingsDebounced();
    logger.info('插件已' + (value ? '启用' : '禁用'));
}

function onDebugChange(event) {
    const value = Boolean($(event.target).prop('checked'));
    extension_settings[extensionName].debug = value;
    saveSettingsDebounced();
    logger.info('调试模式已' + (value ? '启用' : '禁用'));
}

function onServerUrlChange(event) {
    const value = String($(event.target).val());
    extension_settings[extensionName].serverUrl = value;
    saveSettingsDebounced();
    logger.debug('默认服务器地址已更新', value);
}

/**
 * 插件初始化函数
 */
jQuery(async () => {
    try {
        logger.info(`插件初始化 v${PLUGIN_VERSION}`);

        // 加载设置面板 HTML
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $('#extensions_settings').append(settingsHtml);

        // 绑定事件监听器
        $('#antitheft_enabled').on('input', onEnabledChange);
        $('#antitheft_debug').on('input', onDebugChange);
        $('#antitheft_server_url').on('input', onServerUrlChange);

        // 绑定标签页切换事件
        $('.antitheft-tab').on('click', function () {
            const tabName = $(this).data('tab');

            // 切换标签页激活状态
            $('.antitheft-tab').removeClass('active');
            $(this).addClass('active');

            // 切换内容显示
            $('.antitheft-tab-content').removeClass('active');
            $(`#antitheft-${tabName}-tab`).addClass('active');

            logger.debug('切换到标签页:', tabName);
        });

        // 加载设置
        await loadSettings();

        // 注册全局 API，供嵌入脚本调用
        window.AntiTheftPlugin = {
            // 核心 API
            verifyPassword: verifyPassword,
            checkPasswordVersion: checkPasswordVersion,
            unlockCard: unlockCurrentCard,
            lockCard: lockCard,
            checkAndRelockIfNeeded: checkAndRelockIfNeeded,

            // 工具函数
            getVersion: getVersion,
            checkVersion: checkVersion,

            // 版本信息
            version: PLUGIN_VERSION,
            name: extensionName,
        };

        logger.info('全局 API 已注册: window.AntiTheftPlugin');

        // 注册角色卡加载事件监听器，用于自动重新锁定检查
        eventSource.on(event_types.CHARACTER_SELECTED, async (characterId) => {
            logger.debug('角色卡加载事件触发', { characterId });

            try {
                // 获取角色卡上下文
                const context = getContext();
                if (!context || !context.characters || characterId === undefined) {
                    return;
                }

                const character = context.characters[characterId];
                if (!character || !character.data) {
                    return;
                }

                // 检查是否需要重新锁定
                const relocked = await checkAndRelockIfNeeded(character);
                if (relocked) {
                    logger.info('角色卡已自动重新锁定，需要重新验证密码');

                    // 触发自定义事件，通知嵌入脚本需要重新验证
                    if (typeof window.dispatchEvent === 'function') {
                        window.dispatchEvent(
                            new CustomEvent('antiTheftCardRelocked', {
                                detail: { characterId, character },
                            }),
                        );
                    }
                }
            } catch (error) {
                logger.error('自动重新锁定检查失败', error);
            }
        });

        logger.info('已注册角色卡加载事件监听器');
        logger.info('插件初始化完成');
    } catch (error) {
        logger.error('插件初始化失败', error);
    }
});
