const mysql = require('mysql2/promise');

async function testTime() {
  const config = {
    host: 'rm-bp19l0r7x1h50p307.mysql.rds.aliyuncs.com',
    user: 'report_read',
    password: 'zhuoxi@1234',
    database: 'zhuoxi_order',
    timezone: '+08:00',
    dateStrings: true
  };

  try {
    const connection = await mysql.createConnection(config);
    const [rows] = await connection.query(`
      SELECT 
        trade_time as raw_time,
        CONVERT_TZ(trade_time, '+00:00', '+08:00') as converted_8h,
        NOW() as mysql_now
      FROM wdt_order_202604
      WHERE deleted = 0 
      ORDER BY trade_time DESC 
      LIMIT 1
    `);
    
    console.log('Database Time Test Results:');
    console.table(rows);
    console.log('Current JS Time (Local):', new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
    await connection.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testTime();
