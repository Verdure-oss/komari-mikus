/**
 * @module utils/ping
 * @description 延迟/Ping 相关辅助函数
 * @dependencies core/state.js
 * @exports getLatestPing, getPingTasks, getTaskLatestPing, getPingLevel, getRealtimePing, summarizePing, getPingTaskList
 */

import { state } from '../core/state.05f8be33.js';

/**
 * 取每个任务的最新延迟后再求平均
 * records 由 loadPingHistory 按时间升序排列，因此必须从尾部倒序取首个命中值，
 * 否则拿到的是该任务最早的一条记录。
 * @param {string} uuid - 节点 UUID
 * @returns {number|null} 平均延迟值
 */
export function getLatestPing(uuid) {
    const pingInfo = state.pingData[uuid];
    if (!pingInfo || !pingInfo.records || pingInfo.records.length === 0) {
        return null;
    }
    const taskValues = {};
    for (let i = pingInfo.records.length - 1; i >= 0; i--) {
        const r = pingInfo.records[i];
        const key = String(r.task_id);
        if (!Object.prototype.hasOwnProperty.call(taskValues, key) &&
            r.value !== null && r.value !== undefined && r.value >= 0) {
            taskValues[key] = r.value;
        }
    }
    const values = Object.values(taskValues);
    if (values.length === 0) return null;
    const sum = values.reduce(function (a, b) { return a + b; }, 0);
    return sum / values.length;
}

/**
 * 获取实时轮询中的延迟数据
 * @param {string} uuid - 节点 UUID
 * @returns {Object|null} taskId → { name, latest, avg, loss, min, max }
 */
export function getRealtimePing(uuid) {
    const rt = state.realtimeData[uuid];
    return rt && rt.ping ? rt.ping : null;
}

/**
 * 汇总延迟监测任务，得到卡片展示用的聚合值
 * komari 用 latest = -1 表示本轮探测失败，这类任务只计入丢包、不计入延迟均值。
 * @param {Object|null} pingMap - 实时轮询的 ping 映射
 * @returns {Object|null} { avgMs, worstMs, lossPct, taskCount, validCount }
 */
export function summarizePing(pingMap) {
    if (!pingMap) return null;

    const latencies = [];
    let lossSum = 0;
    let lossCount = 0;
    let taskCount = 0;

    Object.keys(pingMap).forEach(function (taskId) {
        const task = pingMap[taskId];
        if (!task) return;
        taskCount++;

        const latest = typeof task.latest === 'number' ? task.latest : null;
        if (latest !== null && latest >= 0) {
            latencies.push(latest);
        }
        if (typeof task.loss === 'number' && !isNaN(task.loss)) {
            lossSum += task.loss;
            lossCount++;
        }
    });

    if (taskCount === 0) return null;

    const avgMs = latencies.length > 0
        ? latencies.reduce(function (a, b) { return a + b; }, 0) / latencies.length
        : null;

    return {
        avgMs: avgMs,
        latestMs: latencies.length > 0 ? Math.max.apply(null, latencies) : null,
        worstMs: latencies.length > 0 ? Math.max.apply(null, latencies) : null,
        lossPct: lossCount > 0 ? lossSum / lossCount : null,
        taskCount: taskCount,
        validCount: latencies.length
    };
}

/** 卡片波动条采样数量（每格代表一次探测） */
const PING_BAR_COUNT = 20;

/**
 * 把当前实时值接到历史序列末尾，让波动条随时间滚动。
 * 历史只在启动时加载一次，实时轮询持续更新 latest；
 * 末格与实时值相同则不重复追加，避免相邻重复格。
 */
function appendLatest(bars, latest, barCount) {
    const src = bars ? bars.slice() : [];
    if (latest === null || latest === undefined || latest < 0) return src;
    if (src.length > 0 && src[src.length - 1] === latest) return src;
    src.push(latest);
    return src.length > barCount ? src.slice(src.length - barCount) : src;
}

/**
 * 把当前丢包率接到丢包序列末尾，与延迟条同步滚动
 */
function appendLatestLoss(bars, latestLoss, barCount) {
    const src = bars ? bars.slice() : [];
    if (latestLoss === null || latestLoss === undefined || isNaN(latestLoss)) return src;
    if (src.length > 0 && src[src.length - 1] === latestLoss) return src;
    src.push(latestLoss);
    return src.length > barCount ? src.slice(src.length - barCount) : src;
}

/**
 * 把某节点的历史采样按时间分桶，得到每路的「延迟序列」与「丢包序列」。
 * komari 用 value < 0 表示该次探测丢包：同桶内全为负则该格视为断线（延迟 -1），
 * 部分为负则记为该桶丢包百分比。两条彩条共用同一时间窗，逐格对齐。
 * @param {string} uuid - 节点 UUID
 * @param {number} barCount - 桶数量
 * @returns {Object} taskId(String) → { latency: Array<number|null>, loss: Array<number|null> }
 */
function collectPingBars(uuid, barCount) {
    const pingInfo = state.pingData[uuid];
    if (!pingInfo) return {};

    // 优先用保留负值的 samples；旧缓存可能没有该字段，回退到 records
    const src = (pingInfo.samples && pingInfo.samples.length > 0)
        ? pingInfo.samples
        : pingInfo.records;
    if (!src || src.length === 0) return {};

    const byTask = {};
    src.forEach(function (r) {
        const key = String(r.task_id);
        if (!byTask[key]) byTask[key] = [];
        byTask[key].push({ t: new Date(r.time).getTime(), v: r.value });
    });

    const out = {};
    Object.keys(byTask).forEach(function (key) {
        const rows = byTask[key];
        if (rows.length === 0) return;

        const first = rows[0].t;
        const last = rows[rows.length - 1].t;
        const span = Math.max(1, last - first);
        const bucketSize = Math.max(1, span / barCount);

        const latency = [];
        const loss = [];

        for (let i = 0; i < barCount; i++) {
            const lo = first + bucketSize * i;
            const hi = (i === barCount - 1) ? last + 1 : lo + bucketSize;
            const bucket = rows.filter(function (r) { return r.t >= lo && r.t < hi; });

            if (bucket.length === 0) {
                latency.push(null);
                loss.push(null);
                continue;
            }

            const valid = bucket.filter(function (r) { return r.v >= 0; });
            latency.push(valid.length === 0
                ? -1
                : valid.reduce(function (a, r) { return a + r.v; }, 0) / valid.length);
            loss.push(((bucket.length - valid.length) / bucket.length) * 100);
        }

        out[key] = { latency: latency, loss: loss };
    });

    return out;
}

/**
 * 丢包率分级，供数值着色使用
 * @param {number|null} lossPct - 丢包百分比
 * @returns {string} 等级名
 */
export function getLossLevel(lossPct) {
    if (lossPct === null || lossPct === undefined) return 'normal';
    if (lossPct <= 0) return 'excellent';
    if (lossPct < 3) return 'normal';
    if (lossPct < 8) return 'warning';
    if (lossPct < 20) return 'fair';
    return 'danger';
}

/**
 * 提取每个监测任务的明细（三网：电信/移动/联通等）
 * 保持 komari 返回的任务顺序，便于卡片稳定展示。
 * komari 用 latest = -1 表示本轮探测失败，此时保留该任务并标记 failed。
 * @param {Object|null} pingMap - 实时轮询的 ping 映射
 * @returns {Array} [{ id, name, ms, lossPct, level, failed }]
 */
export function getPingTaskList(pingMap, uuid, bars) {
    if (!pingMap) return [];

    const barCount = bars === undefined ? PING_BAR_COUNT : bars;
    const series = (uuid && barCount > 0) ? collectPingBars(uuid, barCount) : {};

    const list = [];
    Object.keys(pingMap).forEach(function (taskId) {
        const task = pingMap[taskId];
        if (!task) return;

        const latest = typeof task.latest === 'number' ? task.latest : null;
        const failed = latest === null || latest < 0;
        const ms = failed ? null : latest;
        const lossPct = typeof task.loss === 'number' && !isNaN(task.loss) ? task.loss : null;

        list.push({
            id: taskId,
            name: task.name || ('任务 ' + taskId),
            ms: ms,
            lossPct: lossPct,
            level: getPingLevel(ms),
            lossLevel: getLossLevel(lossPct),
            failed: failed,
            bars: appendLatest((series[String(taskId)] || {}).latency, ms, barCount),
            lossBars: appendLatestLoss((series[String(taskId)] || {}).loss, lossPct, barCount)
        });
    });

    return list;
}

/**
 * 获取 Ping 任务列表
 * @param {string} uuid - 节点 UUID
 * @returns {Array} 任务数组
 */
export function getPingTasks(uuid) {
    const pingInfo = state.pingData[uuid];
    if (!pingInfo || !pingInfo.tasks) return [];
    return pingInfo.tasks;
}

/**
 * 获取任务最新延迟
 * @param {string} uuid - 节点 UUID
 * @param {string} taskId - 任务 ID
 * @returns {number|null} 延迟值
 */
export function getTaskLatestPing(uuid, taskId) {
    const pingInfo = state.pingData[uuid];
    if (!pingInfo || !pingInfo.records) return null;
    const targetTaskId = String(taskId);
    for (let i = pingInfo.records.length - 1; i >= 0; i--) {
        if (String(pingInfo.records[i].task_id) === targetTaskId) {
            return pingInfo.records[i].value;
        }
    }
    return null;
}

/**
 * 获取延迟级别
 * @param {number} pingMs - 延迟值（毫秒）
 * @returns {string} 级别
 */
export function getPingLevel(pingMs) {
    if (pingMs === null || pingMs === undefined) return 'normal';
    if (pingMs < 50) return 'excellent';
    if (pingMs < 100) return 'normal';
    if (pingMs < 300) return 'warning';
    return 'danger';
}
