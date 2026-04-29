// src/api/mockData.ts

export interface OrderRecord {
  id: number;
  trade_no: string;
  platform_id: number; // 1: 淘宝, 2: 抖音, 3: 京东, 4: 拼多多
  receivable: number; // 应收金额
  buyer_nick: string;
  trade_time: string;
}

export interface PlatformSales {
  platform_id: number;
  platform_name: string;
  total_sales: number;
  order_count: number;
}

export interface DashboardData {
  totalSales: number; // 总销售额
  totalOrders: number; // 总订单数
  platformData: PlatformSales[]; // 各平台构成
  recentOrders: OrderRecord[]; // 最新滚动订单
}

// 初始模拟状态
let currentTotalSales = 12560500.50; // 一千两百万起步
let currentTotalOrders = 35620;

const platforms = [
  { id: 1, name: '淘宝' },
  { id: 2, name: '抖音' },
  { id: 3, name: '京东' },
  { id: 4, name: '拼多多' }
];

let currentPlatformBaseSales = [
  6500000, // 淘宝
  3500000, // 抖音
  1500000, // 京东
  1060500  // 拼多多
];

let globalOrderId = 100000;

function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRandomOrder(): OrderRecord {
  globalOrderId++;
  const pIndex = getRandomInt(0, 3);
  return {
    id: globalOrderId,
    trade_no: `JY${new Date().getTime()}${getRandomInt(100, 999)}`,
    platform_id: platforms[pIndex].id,
    receivable: parseFloat((Math.random() * 500 + 50).toFixed(2)),
    buyer_nick: `用户${getRandomInt(1000, 9999)}***`,
    trade_time: new Date().toISOString().replace('T', ' ').substring(0, 19)
  };
}

let recentOrdersQueue: OrderRecord[] = Array.from({ length: 10 }).map(() => generateRandomOrder());

export const fetchSalesData = async (): Promise<DashboardData> => {
  // 模拟网络延迟
  await new Promise(resolve => setTimeout(resolve, 300));

  // 模拟增量：假设每次调度间隔，销售额新增 5000~20000
  const incrementOrdersCount = getRandomInt(20, 80);
  let incrementSales = 0;
  
  const newOrdersList: OrderRecord[] = [];

  for(let i=0; i<incrementOrdersCount; i++) {
    const order = generateRandomOrder();
    newOrdersList.unshift(order);
    incrementSales += order.receivable;
    
    // 更新平台销量
    const pIdx = platforms.findIndex(p => p.id === order.platform_id);
    if(pIdx !== -1) {
      currentPlatformBaseSales[pIdx] += order.receivable;
    }
  }

  currentTotalSales += incrementSales;
  currentTotalOrders += incrementOrdersCount;

  // 维护新单队列，保留最新50条
  recentOrdersQueue = [...newOrdersList, ...recentOrdersQueue].slice(0, 50);

  const platformData: PlatformSales[] = platforms.map((p, idx) => ({
    platform_id: p.id,
    platform_name: p.name,
    total_sales: currentPlatformBaseSales[idx],
    order_count: currentTotalOrders // 简化，暂用总数替代
  }));

  return {
    totalSales: parseFloat(currentTotalSales.toFixed(2)),
    totalOrders: currentTotalOrders,
    platformData: platformData,
    recentOrders: recentOrdersQueue
  };
};
