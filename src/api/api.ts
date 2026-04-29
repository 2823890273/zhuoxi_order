export interface OrderRecord {
  id: number;
  trade_no: string;
  platform_id: number;
  receivable: number;
  buyer_nick: string;
  trade_time: string;
}

export interface PlatformSales {
  platform_id: number;
  platform_name: string;
  total_sales: number;
  order_count: number;
}

export interface TrendRecord {
  date: string;
  sales: number;
}

export interface DashboardData {
  grandToday?: {
    totalSales: number;
    totalOrders: number;
  };
  today: {
    totalSales: number;
    totalOrders: number;
    predictedSales: number;
  };
  yesterday: {
    totalSales: number;
    totalOrders: number;
    targetSales: number;
    sameTimeSales: number;
  };
  dailyTrend: TrendRecord[];
  regionalData: { name: string, value: number }[];
  topGoods: { name: string, quantity: number, amount: number }[];
  recentOrders: OrderRecord[];
}

export const fetchSalesData = async (platformId?: number, days: number = 30): Promise<DashboardData & { requestedPlatformId?: any }> => {
  try {
    let url = 'http://localhost:3000/api/sales-data';
    const params = new URLSearchParams();
    if (platformId !== undefined) {
      params.append('platform_id', platformId.toString());
    }
    params.append('days', days.toString());
    
    const response = await fetch(`${url}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch sales data from Node Server:', error);
    
    // 返回空值结构
    return {
      grandToday: { totalSales: 0, totalOrders: 0 },
      today: { totalSales: 0, totalOrders: 0, predictedSales: 0 },
      yesterday: { totalSales: 0, totalOrders: 0 },
      dailyTrend: [],
      platformData: [],
      recentOrders: []
    };
  }
};

export interface IntradayRecord {
  hour: string;
  sales: number;
  orders: number;
}

export interface IntradayData {
  date: string;
  platform_id: string;
  hourlyData: IntradayRecord[];
}

export const fetchIntradaySales = async (date: string, platformId?: number): Promise<IntradayData> => {
  try {
    let url = 'http://localhost:3000/api/sales-intraday';
    const params = new URLSearchParams();
    params.append('date', date);
    if (platformId !== undefined) {
      params.append('platform_id', platformId.toString());
    }
    
    const response = await fetch(`${url}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch intraday sales data:', error);
    return {
      date,
      platform_id: platformId?.toString() || '__TOTAL__',
      hourlyData: Array.from({ length: 24 }, (_, i) => ({
        hour: String(i).padStart(2, '0') + ':00',
        sales: 0,
        orders: 0
      }))
    };
  }
};

export const fetchProvinceTrend = async (province: string, platformId?: number, days: number = 30): Promise<{ province: string, trend: TrendRecord[] }> => {
  try {
    let url = 'http://localhost:3000/api/sales-province-trend';
    const params = new URLSearchParams();
    params.append('province', province);
    if (platformId !== undefined) {
      params.append('platform_id', platformId.toString());
    }
    params.append('days', days.toString());
    
    const response = await fetch(`${url}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch province trend data:', error);
    return { province, trend: [] };
  }
};

export const fetchGoodsTrend = async (goodsName: string, platformId?: number, days: number = 30): Promise<{ goods_name: string, trend: TrendRecord[] }> => {
  try {
    let url = 'http://localhost:3000/api/sales-goods-trend';
    const params = new URLSearchParams();
    params.append('goods_name', goodsName);
    if (platformId !== undefined) {
      params.append('platform_id', platformId.toString());
    }
    params.append('days', days.toString());
    
    const response = await fetch(`${url}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch goods trend data:', error);
    return { goods_name: goodsName, trend: [] };
  }
};
