import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: 'rm-bp1by9f2x7043ic0yko.mysql.rds.aliyuncs.com',
  port: 3306,
  user: 'report_read',
  password: 'zhuoxi@1234',
  database: 'zhuoxi_order'
});

async function testCrossMonth(days = 30) {
  try {
    const now = new Date();
    const tables = new Set();
    for (let i = 0; i < days; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      tables.add(`wdt_order_${year}${month}`);
    }

    console.log("Tables to query:", Array.from(tables));

    // 构建 UNION 语句
    const queries = Array.from(tables).map(t => `
      SELECT DATE(trade_time) as date, SUM(receivable) as sales
      FROM ${t}
      WHERE deleted = 0 AND trade_status NOT IN (5, 10)
      AND trade_time >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)
      GROUP BY DATE(trade_time)
    `);

    const finalSql = `${queries.join(' UNION ALL ')} ORDER BY date ASC`;
    console.log("SQL Preview:", finalSql.substring(0, 200) + "...");

    const [rows] = await pool.query(finalSql);
    console.log("Total days fetched:", rows.length);
    console.log("Sample:", rows.slice(-3));

  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

testCrossMonth(30);
