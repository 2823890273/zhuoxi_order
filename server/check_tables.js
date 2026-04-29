import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: 'rm-bp1by9f2x7043ic0yko.mysql.rds.aliyuncs.com',
  port: 3306,
  user: 'report_read',
  password: 'zhuoxi@1234',
  database: 'zhuoxi_order'
});

async function run() {
  try {
    const [rows] = await pool.query("SHOW TABLES LIKE 'wdt_order_%'");
    console.log(JSON.stringify(rows));
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

run();
