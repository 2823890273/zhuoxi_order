import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';

// 捕获未处理的异常
process.on('uncaughtException', (err) => {
  console.error('未捕获的异常:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('未处理的 Promise rejection:', reason);
});

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// 【修正】生产环境数据库账号
const pool = mysql.createPool({
  host: 'rm-bp1by9f2x7043ic0yko.mysql.rds.aliyuncs.com',
  port: 3306,
  user: 'report_read',
  password: 'zhuoxi@1234',
  database: 'zhuoxi_order',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function safeQuery(sql, params) {
  try {
    const [rows] = await pool.query(sql, params);
    return [rows];
  } catch (err) {
    console.error('Database Query Error:', err.message);
    throw err;
  }
}

function formatDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 【修正】分表逻辑：业务表为 wdt_order_YYYYMM
function getTableName(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `wdt_order_${y}${m}`;
}

// 内存缓存系统 2.0 (全量分片架构)
const dataCache = new Map();

/**
 * 平台映射表 (动态同步机制)
 */
let platformMap = { 99: '其它渠道' };
let provinceMap = {}; 
let reverseProvinceMap = {};
const trendCache = new Map();
const normalizePid = (pid) => (pid === undefined || pid === null || pid === 'undefined') ? '__TOTAL__' : pid.toString();

function formatDateBj(date) {
  // 强制北京时间格式化
  const bjDate = new Date(date.getTime() + (8 * 3600000));
  const y = bjDate.getUTCFullYear();
  const m = String(bjDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(bjDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTimeBj(date) {
  const bjDate = new Date(date.getTime() + (8 * 3600000));
  const h = String(bjDate.getUTCHours()).padStart(2, '0');
  const min = String(bjDate.getUTCMinutes()).padStart(2, '0');
  const s = String(bjDate.getUTCSeconds()).padStart(2, '0');
  return `${h}:${min}:${s}`;
}

function getDateParams(now = new Date()) {
  const bjNow = new Date(now.getTime() + (8 * 3600000));
  const todayStr = formatDateBj(now);
  const todayStart = `${todayStr} 00:00:00`;
  const tomorrowStart = `${formatDateBj(new Date(now.getTime() + 86400000))} 00:00:00`;
  const ms = now.getTime();
  
  const baseMs = ms - 15 * 60000;
  let nextFixMs = Math.floor(ms / 60000) * 60000;
  while (nextFixMs <= ms || Math.floor((nextFixMs / 60000) % 10) !== 5) {
      nextFixMs += 60000;
  }
  const streamEndMs = nextFixMs - 15 * 60000;
  
  const baseTime = new Date(baseMs);
  const streamEndTime = new Date(streamEndMs);
  
  const baseBound = `${formatDateBj(baseTime)} ${formatTimeBj(baseTime)}`;
  const streamEndBound = `${formatDateBj(streamEndTime)} ${formatTimeBj(streamEndTime)}`;
  
  const hours = bjNow.getUTCHours();
  const minutes = bjNow.getUTCMinutes();
  const seconds = bjNow.getUTCSeconds();
  const baseProgress = Math.max((hours * 3600 + minutes * 60 + seconds - 900) / 86400, 0.001);
  
  const yesterdayDate = new Date(now.getTime() - 86400000);
  const yesterdayStart = `${formatDateBj(yesterdayDate)} 00:00:00`;
  const yesterdaySameTimeBound = `${formatDateBj(yesterdayDate)} ${formatTimeBj(baseTime)}`;
  
  return { bjNow, todayStr, todayStart, tomorrowStart, yesterdayStart, yesterdayDate, baseBound, streamEndBound, baseProgress, yesterdaySameTimeBound };
}

async function fetchDashboardDataFromDB(platform_id, trendDaysInput) {
    const now = new Date();
    const tableName = getTableName(now);
    const paramsMap = getDateParams(now);
    const { bjNow, todayStr, todayStart, tomorrowStart, yesterdayStart, yesterdayDate, baseBound, streamEndBound, baseProgress, yesterdaySameTimeBound } = paramsMap;
    
    // 聚合月分表集合 (仅月表 UNION，极大提升效率)
    const trendDays = Math.min(parseInt(trendDaysInput) || 30, 60);
    // 【关键修复】为了让前端 MA30 均线完整，我们需要多取 31 天的数据作为计算 Buffer
    const bufferDays = trendDays + 31;
    const historyStartNow = new Date(now.getTime() - bufferDays * 86400000);
    const trendHistoryStart = `${formatDate(historyStartNow)} 00:00:00`;
    
    const relevantMonths = new Set();
    let y = historyStartNow.getUTCFullYear();
    let m = historyStartNow.getUTCMonth();
    const endY = now.getUTCFullYear();
    const endM = now.getUTCMonth();

    while (y < endY || (y === endY && m <= endM)) {
        relevantMonths.add(`wdt_order_${y}${String(m + 1).padStart(2, '0')}`);
        m++;
        if (m > 11) {
            y++;
            m = 0;
        }
    }

    const normId = normalizePid(platform_id);
    const isTotalView = normId === '__TOTAL__';
    const platformFilter = isTotalView ? null : parseInt(normId);

    // 终极修复：硬核位次对齐
    const [
        todayRows, 
        yesterdayRows, 
        regionRows, 
        goodsRows, 
        trendRows, 
        pbRows
    ] = await Promise.all([
        (async () => {
            // 0. 今日指标
            const sql = `
                SELECT platform_id, 
                       SUM(CASE WHEN trade_time <= ? THEN receivable ELSE 0 END) as baseSales,
                       COUNT(CASE WHEN trade_time <= ? THEN 1 ELSE NULL END) as baseOrders
                FROM ${tableName} 
                WHERE deleted = 0 AND trade_time >= ? AND trade_time < ? AND trade_status NOT IN (5, 10)
                GROUP BY platform_id
            `;
            const params = [baseBound, baseBound, todayStart, tomorrowStart];
            const [rows] = await safeQuery(sql, params);
            return rows || [];
        })(),
        (async () => {
            // 1. 昨日指标
            const sql = `
                SELECT platform_id, SUM(receivable) as totalSales, COUNT(id) as totalOrders,
                       SUM(CASE WHEN trade_time <= ? THEN receivable ELSE 0 END) as sameTimeSales
                FROM ${getTableName(yesterdayDate)} 
                WHERE deleted = 0 AND trade_time >= ? AND trade_time < ? AND trade_status NOT IN (5, 10)
                GROUP BY platform_id
            `;
            const [rows] = await safeQuery(sql, [yesterdaySameTimeBound, yesterdayStart, todayStart]);
            return rows || [];
        })(),
        (async () => {
             // 2. 地域分布 (按省份)
             const sql = `
                SELECT receiver_province as code, SUM(receivable) as value
                FROM ${tableName}
                WHERE deleted = 0 AND trade_time >= ? AND trade_time < ? AND trade_status NOT IN (5, 10)
                ${platformFilter !== null ? 'AND platform_id = ?' : ''}
                GROUP BY receiver_province
                ORDER BY value DESC
             `;
             const params = platformFilter !== null ? [todayStart, baseBound, platformFilter] : [todayStart, baseBound];
             const [rows] = await safeQuery(sql, params);
             return rows || [];
        })(),
        (async () => {
             // 3. 爆款排行
             const t = getTableName(now);
             const goodsTable = `wdt_order_goods_${t.split('_').pop()}`;
             const sql = `
                SELECT goods_name as name, SUM(num) as quantity, SUM(share_amount) as amount
                FROM ${goodsTable}
                WHERE trade_time >= ? AND trade_time < ?
                ${platformFilter !== null ? 'AND platform_id = ?' : ''}
                GROUP BY goods_name
                ORDER BY quantity DESC
                LIMIT 15
             `;
             const params = platformFilter !== null ? [todayStart, baseBound, platformFilter] : [todayStart, baseBound];
             const [rows] = await safeQuery(sql, params);
             return rows || [];
        })(),
        (async () => {
            // 4. 趋势
            const queries = Array.from(relevantMonths).map(t => `
                SELECT DATE_FORMAT(trade_time, '%Y-%m-%d') as date, SUM(receivable) as sales
                FROM ${t} WHERE deleted = 0 AND trade_status NOT IN (5, 10) AND trade_time >= ?
                ${platformFilter !== null ? 'AND platform_id = ?' : ''} GROUP BY date
            `);
            const trendParams = [];
            Array.from(relevantMonths).forEach(() => {
                trendParams.push(trendHistoryStart);
                if (platformFilter !== null) trendParams.push(platformFilter);
            });
            const [rows] = await safeQuery(`${queries.join(' UNION ALL ')} ORDER BY date ASC`, trendParams);
            return rows || [];
        })(),
        (async () => {
             // 5. 回放流 (必须全局提取，以便左下角其他渠道也能计算动态累加)
             const playbackSql = `
                 SELECT platform_id, receivable, trade_time FROM ${tableName} 
                 WHERE deleted = 0 AND trade_time > ? AND trade_time <= ? AND trade_status NOT IN (5, 10)
                 ORDER BY trade_time ASC
             `;
             const pbParams = [baseBound, streamEndBound];
            const [rows] = await safeQuery(playbackSql, pbParams);
            return rows || [];
        })()
    ]);

    const pbStream = pbRows.map(r => ({ platform_id: parseInt(r.platform_id), receivable: parseFloat(r.receivable) || 0, trade_time: r.trade_time }));
    // trendRows 已由上级解构提供

    const platformData = todayRows.map(p => {
        const pid = (p.platform_id === null || p.platform_id === undefined) ? 99 : parseInt(p.platform_id);
        const bSales = parseFloat(p.baseSales) || 0;
        const bOrders = parseInt(p.baseOrders) || 0;
        return {
            platform_id: pid, platform_name: platformMap[pid] || '其它渠道',
            total_sales: bSales, order_count: bOrders,
            target_sales: bSales, target_orders: bOrders,
            base_sales: bSales, base_orders: bOrders,
            pb_base_sales: bSales, pb_base_orders: bOrders
        };
    });

    let aggregatedTotalSales = 0, aggregatedTotalOrders = 0, aggregatedTargetSales = 0, aggregatedTargetOrders = 0, aggregatedBaseSales = 0, aggregatedBaseOrders = 0, aggregatedPbBaseSales = 0, aggregatedPbBaseOrders = 0;
    platformData.forEach(p => {
        aggregatedTotalSales += p.total_sales; aggregatedTotalOrders += p.order_count;
        aggregatedTargetSales += p.target_sales; aggregatedTargetOrders += p.target_orders;
        aggregatedBaseSales += p.base_sales; aggregatedBaseOrders += p.base_orders;
        aggregatedPbBaseSales += p.pb_base_sales || 0; aggregatedPbBaseOrders += p.pb_base_orders || 0;
    });

    let currentSales = 0, currentOrders = 0, currentTargetSales = 0, currentTargetOrders = 0, currentBaseSales = 0, currentBaseOrders = 0, currentPbBaseSales = 0, currentPbBaseOrders = 0;
    if (platformFilter === null) {
        currentSales = aggregatedTotalSales; currentOrders = aggregatedTotalOrders;
        currentTargetSales = aggregatedTargetSales; currentTargetOrders = aggregatedTargetOrders;
        currentBaseSales = aggregatedBaseSales; currentBaseOrders = aggregatedBaseOrders;
        currentPbBaseSales = aggregatedPbBaseSales; currentPbBaseOrders = aggregatedPbBaseOrders;
    } else {
        const target = todayRows.find(p => parseInt(p.platform_id) === parseInt(platformFilter));
        if (target) {
            currentSales = parseFloat(target.baseSales) || 0; currentOrders = parseInt(target.baseOrders) || 0;
            currentTargetSales = parseFloat(target.baseSales) || 0; currentTargetOrders = parseInt(target.baseOrders) || 0;
            currentBaseSales = parseFloat(target.baseSales) || 0; currentBaseOrders = parseInt(target.baseOrders) || 0;
            currentPbBaseSales = parseFloat(target.baseSales) || 0; currentPbBaseOrders = parseInt(target.baseOrders) || 0;
        }
    }

    let yestSales = 0, yestOrders = 0, yestTargetSales = 0, yestSameTimeSales = 0;
    yesterdayRows.forEach(p => {
        const pid = parseInt(p.platform_id);
        if (platformFilter === null || pid === platformFilter) {
            yestSales += parseFloat(p.totalSales) || 0;
            yestOrders += parseInt(p.totalOrders) || 0;
            yestTargetSales += parseFloat(p.targetSales) || 0;
            yestSameTimeSales += parseFloat(p.sameTimeSales) || 0;
        }
    });

    let ordersSql = `SELECT id, trade_no, platform_id, receivable, buyer_nick, trade_status, DATE_FORMAT(trade_time, '%H:%i:%s') as trade_time FROM ${tableName} WHERE deleted = 0 AND trade_time >= ? AND trade_time <= ? AND trade_status NOT IN (5, 10)`;
    const paramsOrder = [todayStart, bjNow];
    if (platformFilter !== null) { ordersSql += ` AND platform_id = ?`; paramsOrder.push(platformFilter); }
    ordersSql += ` ORDER BY trade_time DESC LIMIT 50`;
    const [recentOrdersRows] = await safeQuery(ordersSql, paramsOrder);

    let dailyTrendMap = new Map();
    trendRows.forEach(r => {
        dailyTrendMap.set(r.date, (dailyTrendMap.get(r.date) || 0) + (parseFloat(r.sales) || 0));
    });
    let dailyTrend = Array.from(dailyTrendMap.entries()).map(([date, sales]) => ({ date, sales })).sort((a,b) => a.date.localeCompare(b.date));
    
    const lastPoint = dailyTrend[dailyTrend.length - 1];
    if (!lastPoint || lastPoint.date !== todayStr) { dailyTrend.push({ date: todayStr, sales: currentSales }); } 
    else { lastPoint.sales = currentSales; }

    // “神圣交付”级修复：采用全称匹配模式，对齐阿里云 V3 GeoJSON (e.g. 广东省)
    const regionalData = regionRows.map(r => {
        const rawCode = r.code ? r.code.toString().trim() : '';
        // 智能匹配：如果 code 包含中文，说明已经是省份名
        let name = /[\u4e00-\u9fa5]/.test(rawCode) ? rawCode : (provinceMap[rawCode] || `未知(${rawCode})`);
        
        // 确保名称带有基本后缀（如果原本缺失）以匹配 GeoJSON，或者保持数据库原始全称
        // 大多数情况下省份表 wdt_district 已经包含“省/市”后缀
        name = name.trim();
        
        return {
            name: name,
            value: parseFloat(r.value) || 0
        };
    }).filter(r => r.name && r.name !== '0' && !r.name.startsWith('未知(') && r.name !== '未知');

    const topGoods = goodsRows.map(r => ({
        name: r.name,
        quantity: Math.floor(parseFloat(r.quantity)) || 0,
        amount: parseFloat(r.amount) || 0
    }));

    return {
        requestedPlatformId: normId,
        grandToday: { totalSales: aggregatedBaseSales, totalOrders: aggregatedBaseOrders, targetSales: aggregatedBaseSales, targetOrders: aggregatedBaseOrders, baseSales: aggregatedBaseSales, baseOrders: aggregatedBaseOrders, pbBaseSales: aggregatedBaseSales, pbBaseOrders: aggregatedBaseOrders },
        today: { totalSales: currentBaseSales, totalOrders: currentBaseOrders, targetSales: currentBaseSales, targetOrders: currentBaseOrders, baseSales: currentBaseSales, baseOrders: currentBaseOrders, pbBaseSales: currentBaseSales, pbBaseOrders: currentBaseOrders, basePredictedSales: currentBaseSales / baseProgress, targetPredictedSales: currentBaseSales / baseProgress },
        playbackStream: pbStream, 
        yesterday: { totalSales: yestSales, totalOrders: yestOrders, targetSales: yestTargetSales, sameTimeSales: yestSameTimeSales },
        dailyTrend: dailyTrend,
        platformData: platformData.sort((a, b) => b.total_sales - a.total_sales),
        regionalData,
        topGoods,
        recentOrders: recentOrdersRows.map(order => ({ ...order, receivable: parseFloat(order.receivable) || 0, trade_time: order.trade_time || '' }))
    };
}

async function fetchProvinceTrendInternal(province, platform_id, days) {
    const normId = normalizePid(platform_id);
    const trendDays = Math.min(parseInt(days) || 30, 60);
    const cacheKey = `prov_${province}_${normId}_${trendDays}`;
    
    // 查找省份代码
    let provCode = reverseProvinceMap[province];
    if (!provCode) {
        const short = province.replace(/省|市|自治区|特别行政区|壮族|回族|维吾尔/g, '');
        provCode = reverseProvinceMap[short];
    }

    const now = new Date();
    const historyStartNow = new Date(now.getTime() - trendDays * 86400000);
    const historyStartDateOnly = formatDate(historyStartNow);
    
    const relevantMonths = new Set();
    let y = historyStartNow.getUTCFullYear();
    let m = historyStartNow.getUTCMonth();
    const endY = now.getUTCFullYear();
    const endM = now.getUTCMonth();

    while (y < endY || (y === endY && m <= endM)) {
        relevantMonths.add(`wdt_order_${y}${String(m + 1).padStart(2, '0')}`);
        m++;
        if (m > 11) { y++; m = 0; }
    }

    const platformFilter = normId === '__TOTAL__' ? null : parseInt(normId);
    const provinceFilter = provCode ? 'receiver_province = ?' : 'receiver_province LIKE ?';
    const provinceVal = provCode || `%${province.replace(/省|市|自治区|特别行政区|壮族|回族|维吾尔/g, '')}%`;

    const queries = Array.from(relevantMonths).map(t => `
        SELECT DATE_FORMAT(trade_time, '%Y-%m-%d') as date, SUM(receivable) as sales
        FROM ${t} 
        WHERE deleted = 0 AND trade_status NOT IN (5, 10) AND trade_date >= ? AND ${provinceFilter}
        ${platformFilter !== null ? 'AND platform_id = ?' : ''} 
        GROUP BY date
    `);
    
    const params = [];
    Array.from(relevantMonths).forEach(() => {
        params.push(historyStartDateOnly);
        params.push(provinceVal);
        if (platformFilter !== null) params.push(platformFilter);
    });

    const [rows] = await safeQuery(`${queries.join(' UNION ALL ')} ORDER BY date ASC`, params);
    
    const result = [];
    for (let i = trendDays - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        const dStr = formatDateBj(new Date(d.getTime() - 8 * 3600000));
        const found = (rows || []).find(r => r.date === dStr);
        result.push({ date: dStr, sales: found ? parseFloat(found.sales) || 0 : 0 });
    }
    const finalData = { province, platform_id: normId, trend: result };
    trendCache.set(cacheKey, { time: Date.now(), data: finalData });
    return finalData;
}

async function fetchGoodsTrendInternal(goods_name, platform_id, days) {
    const normId = normalizePid(platform_id);
    const trendDays = Math.min(parseInt(days) || 30, 60);
    const cacheKey = `goods_${goods_name}_${normId}_${trendDays}`;

    const now = new Date();
    const historyStartNow = new Date(now.getTime() - trendDays * 86400000);
    const historyStartDateOnly = formatDate(historyStartNow);
    
    const relevantMonths = new Set();
    let y = historyStartNow.getUTCFullYear();
    let m = historyStartNow.getUTCMonth();
    const endY = now.getUTCFullYear();
    const endM = now.getUTCMonth();

    while (y < endY || (y === endY && m <= endM)) {
        relevantMonths.add(`wdt_order_goods_${y}${String(m + 1).padStart(2, '0')}`);
        m++;
        if (m > 11) { y++; m = 0; }
    }

    const platformFilter = normId === '__TOTAL__' ? null : parseInt(normId);

    const queries = Array.from(relevantMonths).map(t => `
        SELECT DATE_FORMAT(trade_time, '%Y-%m-%d') as date, SUM(share_amount) as sales
        FROM ${t} 
        WHERE trade_date >= ? AND goods_name = ?
        ${platformFilter !== null ? 'AND platform_id = ?' : ''} 
        GROUP BY date
    `);
    
    const params = [];
    Array.from(relevantMonths).forEach(() => {
        params.push(historyStartDateOnly);
        params.push(goods_name);
        if (platformFilter !== null) params.push(platformFilter);
    });

    const [rows] = await safeQuery(`${queries.join(' UNION ALL ')} ORDER BY date ASC`, params);
    
    const result = [];
    for (let i = trendDays - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        const dStr = formatDateBj(new Date(d.getTime() - 8 * 3600000));
        const found = (rows || []).find(r => r.date === dStr);
        result.push({ date: dStr, sales: found ? parseFloat(found.sales) || 0 : 0 });
    }
    const finalData = { goods_name, platform_id: normId, trend: result };
    trendCache.set(cacheKey, { time: Date.now(), data: finalData });
    return finalData;
}

const prewarmCache = async () => {
    console.log('--- [Cache] 启动预热 ---');
    
    // 1. 同步平台映射表 (动态拉取)
    try {
        const [rows] = await pool.query('SELECT id, name FROM wdt_platform WHERE deleted = 0');
        const newMap = { 99: '其它渠道' };
        rows.forEach(r => {
            newMap[r.id] = r.name;
        });
        platformMap = newMap;
        console.log(`[Cache] 平台映射同步成功 (共 ${rows.length} 条记录)`);

        // 2. 【新增】同步省份映射 (动态拉取)
        const [provRows] = await pool.query('SELECT code, name FROM wdt_district UNION SELECT code, name FROM wdt_province');
        const newReverseMap = {};
        provRows.forEach(r => {
            const name = r.name.trim();
            provinceMap[r.code] = name; 
            newReverseMap[name] = r.code;
            // 同时存一个去掉后缀的版本
            const shortName = name.replace(/省|市|自治区|特别行政区|壮族|回族|维吾尔/g, '');
            if (shortName && !newReverseMap[shortName]) newReverseMap[shortName] = r.code;
        });
        reverseProvinceMap = newReverseMap;
        console.log(`[Cache] 省份映射同步成功 (共 ${provRows.length} 条记录)`);
    } catch (e) {
        console.warn('[Cache] 预热同步失败，将启用兜底模式:', e.message);
    }

    const platforms = [undefined, 18, 56, 39, 99];
    for (const pid of platforms) {
        try {
            const data = await fetchDashboardDataFromDB(pid, 30);
            dataCache.set(`${normalizePid(pid)}_30`, data);
            
            // 如果是所有平台视图，顺便把前 10 的省份和爆款趋势也缓存了
            if (pid === undefined) {
                console.log('[Cache] 正在预热热门实体趋势...');
                // 缓存前 10 省份
                const topProvinces = (data.regionalData || []).slice(0, 10);
                for (const prov of topProvinces) {
                    await fetchProvinceTrendInternal(prov.name, undefined, 30).catch(() => {});
                }
                // 缓存前 10 爆款
                const topGoods = (data.topGoods || []).slice(0, 10);
                for (const goods of topGoods) {
                    await fetchGoodsTrendInternal(goods.name, undefined, 30).catch(() => {});
                }
                console.log(`[Cache] 热门实体趋势预热完成 (省份:${topProvinces.length}, 商品:${topGoods.length})`);
            }
        } catch (e) {
            console.warn(`[Cache] 预热失败 (pid:${pid}):`, e.message);
        }
    }
};

app.get('/api/sales-data', async (req, res) => {
    try {
        const { platform_id, days } = req.query;
        const normId = normalizePid(platform_id);
        const cacheKey = `${normId}_${days || 30}`;
        // 彻底禁用长期缓存，确保切换平台时能实时穿透到数据库，解决数据缩水问题
        let data = await fetchDashboardDataFromDB(platform_id, days);
        dataCache.set(cacheKey, data); 
        res.json(data);
    } catch (err) { res.status(500).json({ error: 'Data retrieval failed', detail: err.message }); }
});

app.get('/api/sales-intraday', async (req, res) => {
    try {
        const { date, platform_id } = req.query; // date e.g. 2026-04-20
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        const parts = date.split('-');
        const tableName = `wdt_order_${parts[0]}${parts[1]}`;
        const startDate = `${date} 00:00:00`;
        const endDate = `${date} 23:59:59`;
        const normId = normalizePid(platform_id);
        const isTotalView = normId === '__TOTAL__';
        const platformFilter = isTotalView ? null : parseInt(normId);

        let sql = `
            SELECT DATE_FORMAT(trade_time, '%H') as hourStr, SUM(receivable) as sales, COUNT(id) as orders
            FROM ${tableName}
            WHERE deleted = 0 AND trade_time >= ? AND trade_time <= ? AND trade_status NOT IN (5, 10)
        `;
        const params = [startDate, endDate];
        if (platformFilter !== null) {
            sql += ' AND platform_id = ?';
            params.push(platformFilter);
        }
        sql += ' GROUP BY hourStr ORDER BY hourStr ASC';

        const [rows] = await safeQuery(sql, params);
        
        // Build 24 hours
        const hourlyData = Array.from({ length: 24 }, (_, i) => ({
            hour: String(i).padStart(2, '0') + ':00',
            sales: 0,
            orders: 0
        }));
        
        if (rows) {
            rows.forEach(r => {
                const hourIndex = parseInt(r.hourStr);
                if (hourIndex >= 0 && hourIndex < 24) {
                    hourlyData[hourIndex].sales = parseFloat(r.sales) || 0;
                    hourlyData[hourIndex].orders = parseInt(r.orders) || 0;
                }
            });
        }
        
        res.json({ date, platform_id: normId, hourlyData });
    } catch (err) {
        // Table might not exist for future dates or very old dates, just return empty gracefully
        if (err.message && err.message.includes("doesn't exist")) {
            const hourlyData = Array.from({ length: 24 }, (_, i) => ({
                hour: String(i).padStart(2, '0') + ':00',
                sales: 0,
                orders: 0
            }));
            return res.json({ date, platform_id, hourlyData });
        }
        res.status(500).json({ error: 'Data retrieval failed', detail: err.message });
    }
});

app.get('/api/sales-province-trend', async (req, res) => {
    try {
        const { province, platform_id, days } = req.query;
        if (!province) return res.status(400).json({ error: 'Missing province' });
        
        const normId = normalizePid(platform_id);
        const trendDays = Math.min(parseInt(days) || 30, 60);
        const cacheKey = `prov_${province}_${normId}_${trendDays}`;
        const cached = trendCache.get(cacheKey);
        if (cached && (Date.now() - cached.time < 600000)) return res.json(cached.data);

        const result = await fetchProvinceTrendInternal(province, platform_id, days);
        res.json(result);
    } catch (err) {
        if (err.message && err.message.includes("doesn't exist")) {
             return res.json({ province, platform_id: normalizePid(platform_id), trend: [] });
        }
        res.status(500).json({ error: 'Data retrieval failed', detail: err.message });
    }
});

app.get('/api/sales-goods-trend', async (req, res) => {
    try {
        const { goods_name, platform_id, days } = req.query;
        if (!goods_name) return res.status(400).json({ error: 'Missing goods_name' });
        
        const normId = normalizePid(platform_id);
        const trendDays = Math.min(parseInt(days) || 30, 60);
        const cacheKey = `goods_${goods_name}_${normId}_${trendDays}`;
        const cached = trendCache.get(cacheKey);
        if (cached && (Date.now() - cached.time < 600000)) return res.json(cached.data);

        const result = await fetchGoodsTrendInternal(goods_name, platform_id, days);
        res.json(result);
    } catch (err) {
        if (err.message && err.message.includes("doesn't exist")) {
             return res.json({ goods_name, platform_id: normalizePid(platform_id), trend: [] });
        }
        res.status(500).json({ error: 'Data retrieval failed', detail: err.message });
    }
});

app.listen(port, () => {
    console.log(`Backend Server API is running on http://localhost:${port}`);
    prewarmCache();
    setInterval(prewarmCache, 600000); 
});
