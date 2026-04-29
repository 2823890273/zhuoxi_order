import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: 'rm-bp1by9f2x7043ic0yko.mysql.rds.aliyuncs.com',
  port: 3306,
  user: 'report_read',
  password: 'zhuoxi@1234',
  database: 'zhuoxi_order',
  charset: 'utf8',
});

async function test() {
  try {
    const tableName = 'wdt_order_202604';
    
    // 1. 测试查询今日每小时的数据（用于更细致的曲线图，或者按日）
    // 用户说“每天的销售数据”，那应该是展示本月每天的趋势
    console.log("--- 本月每日趋势 ---");
    const [dailyTrend] = await pool.query(`
      SELECT 
        DATE(trade_time) as date,
        SUM(receivable) as sales
      FROM ${tableName}
      WHERE deleted = 0 AND trade_status NOT IN (5, 10)
      GROUP BY DATE(trade_time)
      ORDER BY date ASC
    `);
    console.log(dailyTrend);

    // 2. 测试查询昨日数据
    console.log("--- 昨日总计 ---");
    const [yesterdayData] = await pool.query(`
      SELECT 
        SUM(receivable) as totalSales,
        COUNT(id) as totalOrders
      FROM ${tableName}
      WHERE deleted = 0 AND DATE(trade_time) = DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND trade_status NOT IN (5, 10)
    `);
    console.log(yesterdayData);

    // 3. 测试查询特定平台的订单
    console.log("--- 平台 1 的最新订单 ---");
    const [platformOrders] = await pool.query(`
      SELECT trade_no, receivable, buyer_nick, trade_time
      FROM ${tableName}
      WHERE deleted = 0 AND platform_id = 1 AND trade_status NOT IN (5, 10)
      ORDER BY trade_time DESC
      LIMIT 10
    `);
    console.log(platformOrders);

  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

test();
