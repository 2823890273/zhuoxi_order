import mysql from 'mysql2/promise';

async function test() {
  const pool = mysql.createPool({
    host: 'rm-bp1by9f2x7043ic0yko.mysql.rds.aliyuncs.com',
    port: 3306,
    user: 'report_read',
    password: 'zhuoxi@1234',
    database: 'zhuoxi_order',
  });

  try {
    // 检查数据库服务器时间
    const [timeRows] = await pool.query('SELECT NOW() as db_time, CURDATE() as db_date');
    console.log("数据库服务器时间:", timeRows[0]);
    
    // 本机时间
    console.log("Node.js 本机时间:", new Date().toISOString());

    // 最近5条数据的 trade_time
    const [latest] = await pool.query(
      'SELECT trade_time FROM wdt_order_202604 ORDER BY trade_time DESC LIMIT 3'
    );
    console.log("数据库最新记录:", latest);

    // 用数据库自己的 CURDATE()
    const [r1] = await pool.query(
      `SELECT COUNT(*) as cnt, SUM(receivable) as total FROM wdt_order_202604 WHERE DATE(trade_time) = CURDATE()`
    );
    console.log("CURDATE()查到的记录:", r1[0]);

    // 用昨天的日期
    const [r2] = await pool.query(
      `SELECT COUNT(*) as cnt, SUM(receivable) as total FROM wdt_order_202604 WHERE DATE(trade_time) = CURDATE() - INTERVAL 1 DAY`
    );
    console.log("昨天的记录:", r2[0]);

  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    pool.end();
  }
}
test();
