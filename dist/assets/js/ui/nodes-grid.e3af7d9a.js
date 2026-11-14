/**
 * @module ui/nodes-grid
 * @description 网格视图渲染（节点卡片 + 指标进度条 + 卡片头部/底部）
 * @dependencies core/state.js, i18n/index.js, utils/format.js, utils/helpers.js, ui/modal.js, ui/nodes.js
 * @exports renderGrid
 */

import { state } from '../core/state.05f8be33.js';
import { t } from '../i18n/index.57cc9d99.js';
import { formatBytes, formatSpeed, formatPercent, formatUptime, formatExpiry, formatPrice, formatPing } from '../utils/format.3f66f67a.js';
import { escapeHtml, parseTagInfo, getPingLevel } from '../utils/helpers.7db83e02.js';
import { openNodeModal } from './modal.07f72b93.js';
import { getFilteredNodes, calculateNodeMetrics } from './nodes.aba78385.js';

/**
 * 渲染指标进度条
 * @param {string} label - 标签
 * @param {number} value - 数值
 * @param {string} level - 等级（normal/warning/danger）
 * @returns {string} HTML
 */
function renderMetricBar(label, value, level) {
    const displayValue = value !== null ? formatPercent(value) : '-';
    const width = value !== null ? Math.min(value, 100) : 0;

    return '<div class="metric">' +
           '<div class="metric-label">' + escapeHtml(label) + '</div>' +
           '<div class="metric-bar"><div class="metric-bar-fill level-' + level + '" style="width:' + width + '%"></div></div>' +
           '<div class="metric-value level-' + level + '">' + displayValue + '</div>' +
           '</div>';
}

/**
 * 渲染三网延迟明细（每个监测任务一行：名称 + 延迟 + 丢包率）
 * 无监测任务时不输出该区域。
 * @param {Object} metrics - 指标数据
 * @param {boolean} showPing - 是否显示延迟
 * @returns {string} HTML
 */
export function renderPingTasks(metrics, showPing) {
    if (!showPing) return '';

    const tasks = metrics.pingTasks || [];
    if (tasks.length === 0) return '';

    let html = '<div class="node-ping-tasks">';

    tasks.forEach(function (task) {
        const msText = task.failed ? t('ping_failed') : formatPing(task.ms);
        const hasLoss = task.lossPct !== null && task.lossPct !== undefined;
        const lossText = hasLoss ? task.lossPct.toFixed(1) + '%' : '-';

        let title = task.name + ' · ' + t('ping') + ' ' + msText;
        if (hasLoss) {
            title += ' · ' + t('packet_loss') + ' ' + task.lossPct.toFixed(1) + '%';
        }

        // 每路：名称独占一行，下面左右两列；每列内「数值在上、彩条在下」，
        // 数值与彩条同处一列才能保证右边缘严格对齐
        html += '<div class="ping-task-group' + (task.failed ? ' is-failed' : '') + '" title="' + escapeHtml(title) + '">';
        html += '<div class="ping-task-name">' + escapeHtml(task.name) + '</div>';
        html += '<div class="ping-task-tracks">';
        html += renderTrack(msText, task.level, task.bars, 'latency');
        html += renderTrack(lossText, task.lossLevel, task.lossBars, 'loss');
        html += '</div>';
        html += '</div>';
    });

    html += '</div>';

    return html;
}

/**
 * 渲染一列「数值 + 彩条」。数值与彩条同列，右边缘自然对齐。
 * @param {string} valueText - 数值文本
 * @param {string} level - 等级
 * @param {Array<number|null>} bars - 序列
 * @param {string} metric - 'latency' | 'loss'
 * @returns {string} HTML
 */
function renderTrack(valueText, level, bars, metric) {
    let html = '<div class="ping-track">';
    html += '<span class="ping-track-value level-' + level + '">' + valueText + '</span>';
    html += renderBars(bars, metric);
    html += '</div>';
    return html;
}

/**
 * 延迟分级：与 getPingLevel 一致；负值代表该格全部探测失败
 */
function latencyBarLevel(value) {
    if (value === null || value === undefined) return 'empty';
    if (value < 0) return 'danger';
    return getPingLevel(value);
}

/**
 * 丢包分级：0 绿、<3% 正常、<8% 黄、<20% 橙、其余红
 */
function lossBarLevel(value) {
    if (value === null || value === undefined) return 'empty';
    if (value <= 0) return 'excellent';
    if (value < 3) return 'normal';
    if (value < 8) return 'warning';
    if (value < 20) return 'fair';
    return 'danger';
}

/**
 * 渲染一条彩条
 * @param {Array<number|null>} bars - 序列
 * @param {string} metric - 'latency' | 'loss'
 * @returns {string} HTML
 */
function renderBars(bars, metric) {
    const list = bars || [];
    if (list.length === 0) return '<span class="ping-bars ping-bars-empty"></span>';

    const levelOf = metric === 'loss' ? lossBarLevel : latencyBarLevel;
    let html = '<span class="ping-bars">';
    list.forEach(function (v) {
        html += '<i class="ping-bar-cell level-' + levelOf(v) + '"></i>';
    });
    html += '</span>';
    return html;
}

/**
 * 渲染节点卡片头部（国旗 + 名称 + OS + 标签）
 * @param {Object} node - 节点对象
 * @param {Object} metrics - 指标数据
 * @returns {string} HTML
 */
function renderNodeCardHeader(node, metrics) {
    let html = '<div class="node-card-header">';

    if (metrics.flagUrl) {
        html += '<span class="node-card-flag" style="background-image: url(\'' + metrics.flagUrl + '\')" title="' + escapeHtml(node.region || '') + '"></span>';
    } else {
        html += '<span class="node-card-flag node-card-flag-placeholder"><span>?</span></span>';
    }

    html += '<div class="node-card-info">';
    html += '<div class="node-card-name">';
    html += '<span class="node-status-dot' + (metrics.isOnline ? '' : ' offline') + '"></span>';
    html += '<span class="node-name-text">' + escapeHtml(node.name) + '</span>';
    html += '</div>';
    html += '<div class="node-card-subtitle">';
    html += '<span class="node-card-os"><span class="os-icon os-icon-' + metrics.osInfo.icon + '"></span>' + escapeHtml(metrics.osInfo.name) + '</span>';

    if (node.tags) {
        const tags = node.tags.split(';').filter(function(t) { return t.trim(); });
        const maxTags = 2;
        tags.slice(0, maxTags).forEach(function(tag) {
            const tagInfo = parseTagInfo(tag);
            html += '<span class="node-api-tag' + tagInfo.className + '">' + escapeHtml(tagInfo.text) + '</span>';
        });
    }

    html += '</div>';
    html += '</div>';

    html += '</div>';

    return html;
}

/**
 * 渲染节点卡片指标区域
 * @param {Object} metrics - 指标数据
 * @returns {string} HTML
 */
function renderNodeMetrics(metrics) {
    let html = '';

    html += renderMetricBar('CPU', metrics.cpuUsage, metrics.cpuLevel);
    html += renderMetricBar('RAM', metrics.ramPercent, metrics.ramLevel);
    html += renderMetricBar('Disk', metrics.diskPercent, metrics.diskLevel);

    if (metrics.swapTotal > 0) {
        html += renderMetricBar('Swap', metrics.swapPercent, metrics.swapLevel);
    } else {
        html += '<div class="metric">';
        html += '<div class="metric-label">Load</div>';
        html += '<div class="metric-value">' + (metrics.load1 !== null ? metrics.load1.toFixed(2) : '-') + '</div>';
        html += '</div>';
    }

    return html;
}

/**
 * 渲染节点卡片底部（价格 + 运行时间 + 到期 + 流量标签 + 网速）
 * 遵循硬约束：第一行价格+uptime+到期（nowrap）；第二行流量标签+网速
 * 剩余流量标签始终显示（若 traffic_limit > 0），不受 show_traffic_tags 开关控制
 * @param {Object} node - 节点对象
 * @param {Object} metrics - 指标数据
 * @param {boolean} showUptime - 是否显示运行时间
 * @param {boolean} showNetwork - 是否显示网速
 * @param {boolean} showTrafficTags - 是否显示流量标签
 * @returns {string} HTML
 */
function renderNodeCardFooter(node, metrics, showUptime, showNetwork, showTrafficTags) {
    return '<div class="node-card-footer">' +
        renderNodeCardFooterContent(node, metrics, showUptime, showNetwork, showTrafficTags) +
        '</div>';
}

/**
 * 渲染节点卡片底部内容（不包含外层 footer）
 * @param {Object} node - 节点对象
 * @param {Object} metrics - 指标数据
 * @param {boolean} showUptime - 是否显示运行时间
 * @param {boolean} showNetwork - 是否显示网速
 * @param {boolean} showTrafficTags - 是否显示流量标签
 * @returns {string} HTML
 */
function renderNodeCardFooterContent(node, metrics, showUptime, showNetwork, showTrafficTags) {
    let html = '';

    const priceText = formatPrice(node.price, node.currency, node.billing_cycle);
    const uptimeText = formatUptime(metrics.uptime);
    const expiry = formatExpiry(node.expired_at);

    html += '<span class="node-info-row">';

    if (priceText) {
        html += '<span class="node-price">' + priceText + '</span>';
    }

    if (uptimeText !== '-') {
        html += '<span class="node-uptime">' + t('uptime_prefix') + ':' + uptimeText + '</span>';
    }

    if (expiry) {
        html += '<span class="node-expiry level-' + expiry.level + '">' + t('remaining') + ':' + expiry.text + '</span>';
    }

    html += '</span>';

    if (showNetwork || showTrafficTags) {
        html += '<span class="node-network-row">';

        if (showTrafficTags) {
            html += '<span class="node-traffic-tag traffic-tag-up" title="' + t('total_upload') + '">↑ ' + formatBytes(metrics.netTotalUp) + '</span>';
            html += '<span class="node-traffic-tag traffic-tag-down" title="' + t('total_download') + '">↓ ' + formatBytes(metrics.netTotalDown) + '</span>';

            if (metrics.trafficLimit > 0) {
                html += '<span class="node-traffic-tag traffic-tag-remaining" title="' + t('traffic_limit') + ': ' + formatBytes(metrics.trafficLimit) + '">' + t('remaining') + ':' + formatBytes(metrics.remainingTraffic) + '</span>';
            }
        }

        if (showNetwork) {
            html += '<span class="node-network-speed">';
            html += '<span class="network-dir"><span class="arrow-up">&#9650;</span>' + formatSpeed(metrics.netUp) + '</span>';
            html += '<span class="network-dir"><span class="arrow-down">&#9660;</span>' + formatSpeed(metrics.netDown) + '</span>';
            html += '</span>';
        }

        html += '</span>';
    }

    return html;
}

/**
 * 渲染单个节点卡片（网格视图）
 * @param {Object} node - 节点对象
 * @param {Object} metrics - 指标数据
 * @param {boolean} showUptime - 是否显示运行时间
 * @param {boolean} showNetwork - 是否显示网速
 * @param {boolean} showTrafficTags - 是否显示流量标签
 * @param {boolean} showPing - 是否显示延迟
 * @returns {string} HTML
 */
function renderNodeCard(node, metrics, showUptime, showNetwork, showTrafficTags, showPing) {
    let html = '';

    html += '<div class="node-card' + (metrics.isOnline ? '' : ' offline') + (state.initialRender ? ' animate-in' : '') + '" data-uuid="' + node.uuid + '">';
    html += renderNodeCardHeader(node, metrics);
    html += '<div class="node-card-metrics">';
    html += renderNodeMetrics(metrics);
    html += '</div>';
    html += renderPingTasks(metrics, showPing);
    html += renderNodeCardFooter(node, metrics, showUptime, showNetwork, showTrafficTags);
    html += '</div>';

    return html;
}

/**
 * 为节点卡片绑定点击事件
 * @param {HTMLElement} container - 容器元素
 */
function bindNodeCardEvents(container) {
    container.querySelectorAll('.node-card').forEach(function (card) {
        card.addEventListener('click', function () {
            const uuid = this.getAttribute('data-uuid');
            openNodeModal(uuid);
        });
    });
}

/**
 * 更新已存在的网格卡片中的实时数据，避免替换卡片根节点
 */
export function updateGridRealtime() {
    const container = document.getElementById('nodesGrid');
    if (!container) return;

    const showUptime = state.themeSettings.show_uptime !== false;
    const showNetwork = state.themeSettings.show_network_speed !== false;
    const showTrafficTags = state.themeSettings.show_traffic_tags !== false;
    const showPing = state.themeSettings.show_ping !== false;
    const nodesByUuid = new Map(state.nodes.map(function(node) {
        return [node.uuid, node];
    }));

    container.querySelectorAll('.node-card[data-uuid]').forEach(function(card) {
        const uuid = card.getAttribute('data-uuid');
        const node = uuid ? nodesByUuid.get(uuid) : null;
        if (!node) return;

        const metrics = calculateNodeMetrics(node);
        const metricsEl = card.querySelector('.node-card-metrics');
        const footerEl = card.querySelector('.node-card-footer');
        const statusDot = card.querySelector('.node-status-dot');

        if (metricsEl) metricsEl.innerHTML = renderNodeMetrics(metrics);
        if (footerEl) footerEl.innerHTML = renderNodeCardFooterContent(node, metrics, showUptime, showNetwork, showTrafficTags);

        // 三网延迟明细随实时数据刷新（整体替换，任务增删也能同步）
        const oldPingEl = card.querySelector('.node-ping-tasks');
        const pingHtml = renderPingTasks(metrics, showPing);
        if (oldPingEl) {
            if (pingHtml) {
                oldPingEl.outerHTML = pingHtml;
            } else {
                oldPingEl.remove();
            }
        } else if (pingHtml) {
            const anchor = footerEl || null;
            if (anchor) {
                anchor.insertAdjacentHTML('beforebegin', pingHtml);
            } else {
                card.insertAdjacentHTML('beforeend', pingHtml);
            }
        }

        card.classList.toggle('offline', !metrics.isOnline);
        if (statusDot) statusDot.classList.toggle('offline', !metrics.isOnline);
    });
}

/**
 * 渲染网格视图
 */
export function renderGrid() {
    const container = document.getElementById('nodesGrid');
    if (!container) return;

    const nodes = getFilteredNodes();

    if (nodes.length === 0) {
        container.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 15h8M9 9h.01M15 9h.01"/></svg><p>' + t('no_nodes') + '</p></div>';
        return;
    }

    const showUptime = state.themeSettings.show_uptime !== false;
    const showNetwork = state.themeSettings.show_network_speed !== false;
    const showTrafficTags = state.themeSettings.show_traffic_tags !== false;
    const showPing = state.themeSettings.show_ping !== false;

    let html = '';
    nodes.forEach(function (node) {
        const metrics = calculateNodeMetrics(node);
        html += renderNodeCard(node, metrics, showUptime, showNetwork, showTrafficTags, showPing);
    });

    container.innerHTML = html;
    bindNodeCardEvents(container);
}
