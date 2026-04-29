import React, { useEffect, useReducer, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import {
  Activity, Clock, BarChart2, TrendingUp,
  ArrowUpRight, Briefcase, Award, Globe, Play, Pause, X
} from 'lucide-react';
import { fetchSalesData, fetchIntradaySales, fetchProvinceTrend, fetchGoodsTrend } from './api/api';
import type { DashboardData } from './api/api';
import { OdometerNumber } from './components/OdometerNumber';
import './index.css';

const REFRESH_INTERVAL = 600;
const TICKERS_STEP_MS = 5000;
const CHINA_GEO_URL = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json';

// --- [Omega Architecture] 总线式状态定义 ---
interface State {
  data: DashboardData | null;
  currentTime: Date;
  selectedPlatformId?: number;
  trendDays: number;
  loading: boolean;
  mapLoaded: boolean;
  isAutoPlay: boolean;
  intradayModal: { visible: boolean; date: string; data: any[] | null; loading: boolean; };
  trendModal: { visible: boolean; title: string; type: 'province' | 'goods'; targetName: string; data: any[] | null; loading: boolean; };
}

type Action =
  | { type: 'SET_DATA'; payload: DashboardData }
  | { type: 'TICK'; payload: Date }
  | { type: 'SET_PLATFORM'; payload: number | undefined }
  | { type: 'SET_DAYS'; payload: number }
  | { type: 'SET_MAP_LOADED'; payload: boolean }
  | { type: 'SET_AUTO_PLAY'; payload: boolean }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'OPEN_MODAL'; payload: string }
  | { type: 'CLOSE_MODAL' }
  | { type: 'SET_MODAL_DATA'; payload: any[] | null }
  | { type: 'SET_MODAL_LOADING'; payload: boolean }
  | { type: 'OPEN_TREND_MODAL'; payload: { title: string; type: 'province' | 'goods'; targetName: string } }
  | { type: 'CLOSE_TREND_MODAL' }
  | { type: 'SET_TREND_MODAL_DATA'; payload: any[] | null }
  | { type: 'SET_TREND_MODAL_LOADING'; payload: boolean };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_DATA': return { ...state, data: action.payload, loading: false };
    case 'TICK': return { ...state, currentTime: action.payload };
    case 'SET_PLATFORM': return { ...state, selectedPlatformId: action.payload };
    case 'SET_DAYS': return { ...state, trendDays: action.payload };
    case 'SET_LOADING': return { ...state, loading: action.payload };
    case 'SET_MAP_LOADED': return { ...state, mapLoaded: action.payload };
    case 'SET_AUTO_PLAY': return { ...state, isAutoPlay: action.payload };
    case 'OPEN_MODAL': return { ...state, intradayModal: { ...state.intradayModal, visible: true, date: action.payload } };
    case 'CLOSE_MODAL': return { ...state, intradayModal: { ...state.intradayModal, visible: false } };
    case 'SET_MODAL_DATA': return { ...state, intradayModal: { ...state.intradayModal, data: action.payload, loading: false } };
    case 'SET_MODAL_LOADING': return { ...state, intradayModal: { ...state.intradayModal, loading: action.payload } };
    case 'OPEN_TREND_MODAL': return { ...state, trendModal: { ...state.trendModal, visible: true, ...action.payload, data: null, loading: true } };
    case 'CLOSE_TREND_MODAL': return { ...state, trendModal: { ...state.trendModal, visible: false } };
    case 'SET_TREND_MODAL_DATA': return { ...state, trendModal: { ...state.trendModal, data: action.payload, loading: false } };
    case 'SET_TREND_MODAL_LOADING': return { ...state, trendModal: { ...state.trendModal, loading: action.payload } };
    default: return state;
  }
}

const initialState: State = {
  data: null,
  currentTime: new Date(),
  trendDays: 30,
  loading: true,
  mapLoaded: false,
  isAutoPlay: false,
  isAutoPlay: false,
  intradayModal: { visible: false, date: '', data: null, loading: false },
  trendModal: { visible: false, title: '', type: 'province', targetName: '', data: null, loading: false }
};

/**
 * 销售大屏 3.0 大结局结项版
 * 核心：useReducer 物理锁死 Hook 栈，杜绝一切计数漂移。
 */
export default function App() {
  // --- [Hook 1] 总线状态机 (取代原本分散的 6 个 useState) ---
  const [state, dispatch] = useReducer(reducer, initialState);
  const { data, currentTime, selectedPlatformId, trendDays, loading, mapLoaded, isAutoPlay, intradayModal, trendModal } = state;

  // --- [Hook 2/3] 辅助引用 ---
  const lastRequested = useRef(0);
  const peakPredicted = useRef(0);

  // 修复：切换平台时重置预测峰值，确保预测作用域正确对齐
  useEffect(() => {
    peakPredicted.current = 0;
  }, [selectedPlatformId]);

  // --- [Hook 4] 驱动副作用 (时钟) ---
  useEffect(() => {
    const timer = setInterval(() => dispatch({ type: 'TICK', payload: new Date() }), TICKERS_STEP_MS);
    return () => clearInterval(timer);
  }, []);

  // --- [Hook 5] 数据副作用 (单向数据流) ---
  useEffect(() => {
    let active = true;
    let timerId: any;

    const fetchIt = async (isSilent = false) => {
      const rid = ++lastRequested.current;
      if (!isSilent) dispatch({ type: 'SET_LOADING', payload: true });
      try {
        const res = await fetchSalesData(selectedPlatformId, trendDays);
        if (active && rid === lastRequested.current) {
          dispatch({ type: 'SET_DATA', payload: res });
        }
      } catch (e) {
        if (active && rid === lastRequested.current) dispatch({ type: 'SET_LOADING', payload: false });
      }
    };

    const scheduleNext = () => {
      if (!active) return;
      const now = new Date();
      let nextFixMs = Math.floor(now.getTime() / 60000) * 60000;
      while (nextFixMs <= now.getTime() || Math.floor((nextFixMs / 60000) % 10) !== 5) {
        nextFixMs += 60000;
      }
      const delay = nextFixMs - now.getTime();

      timerId = setTimeout(() => {
        if (!active) return;
        // 定时刷新使用静默模式，不弹加载层以平滑衔接
        fetchIt(true);
        scheduleNext();
      }, delay);
    };

    fetchIt();
    scheduleNext();

    return () => { active = false; clearTimeout(timerId); };
  }, [selectedPlatformId, trendDays]);

  // --- [Hook 6] 地图副作用 (终极对齐模式) ---
  useEffect(() => {
    fetch(CHINA_GEO_URL)
      .then(res => res.json())
      .then(geo => {
        echarts.registerMap('china', geo);
        dispatch({ type: 'SET_MAP_LOADED', payload: true });
      })
      .catch(e => console.error('Map Engine Registration Fail:', e));
  }, []);

  // --- [Hook 7] 自动轮播引擎 ---
  useEffect(() => {
    if (!isAutoPlay || !data?.platformData) return;
    const timer = setInterval(() => {
      const platformsIdList = [undefined, ...data.platformData.map((p: any) => p.platform_id)];
      const currentIndex = platformsIdList.indexOf(selectedPlatformId);
      const nextIndex = (currentIndex + 1) % platformsIdList.length;
      dispatch({ type: 'SET_PLATFORM', payload: platformsIdList[nextIndex] });
    }, 20000); // 20秒一轮播
    return () => clearInterval(timer);
  }, [isAutoPlay, selectedPlatformId, data?.platformData]);

  // --- [Hook 8] 分时详情弹窗数据拉取 ---
  useEffect(() => {
    if (!intradayModal.visible || !intradayModal.date) return;
    let active = true;
    dispatch({ type: 'SET_MODAL_LOADING', payload: true });
    
    fetchIntradaySales(intradayModal.date, selectedPlatformId)
      .then(res => {
        if (active) dispatch({ type: 'SET_MODAL_DATA', payload: res.hourlyData });
      })
      .catch(e => {
        if (active) {
          console.error(e);
          dispatch({ type: 'SET_MODAL_DATA', payload: null });
        }
      });
      
    return () => { active = false; };
  }, [intradayModal.visible, intradayModal.date, selectedPlatformId]);

  // --- [Hook 9] 实体趋势弹窗数据拉取 ---
  useEffect(() => {
    if (!trendModal.visible || !trendModal.targetName) return;
    let active = true;
    dispatch({ type: 'SET_TREND_MODAL_LOADING', payload: true });
    
    const fetchFunc = trendModal.type === 'province' ? fetchProvinceTrend : fetchGoodsTrend;
    fetchFunc(trendModal.targetName, selectedPlatformId, trendDays)
      .then((res: any) => {
        if (active) dispatch({ type: 'SET_TREND_MODAL_DATA', payload: res.trend });
      })
      .catch(e => {
        if (active) {
          console.error(e);
          dispatch({ type: 'SET_TREND_MODAL_DATA', payload: null });
        }
      });
      
    return () => { active = false; };
  }, [trendModal.visible, trendModal.targetName, trendModal.type, selectedPlatformId, trendDays]);

  const analysis = useMemo(() => {
    if (!data) return null;
    const ghost = new Date(currentTime.getTime() - 15 * 60000);
    let sSales = 0, sOrders = 0;
    let crossPlatformDelta: { [key: number]: number } = {};

    (data.playbackStream || []).forEach(o => {
      if (new Date(o.trade_time).getTime() <= ghost.getTime()) {
        const amt = parseFloat(o.receivable as any) || 0;
        // 如果未选定平台，或是匹配当前所选平台，才累加到主数据计算中
        if (selectedPlatformId === undefined || o.platform_id === selectedPlatformId) {
          sSales += amt;
          sOrders += 1;
        }
        // 任何情况下都向大词典记录所有渠道的动态回放增量
        crossPlatformDelta[o.platform_id] = (crossPlatformDelta[o.platform_id] || 0) + amt;
      }
    });

    const totalDelta = Object.values(crossPlatformDelta).reduce((a, b) => a + b, 0);

    const dSales = ((data.today as any).pbBaseSales || 0) + sSales;
    const dOrders = ((data.today as any).pbBaseOrders || 0) + sOrders;

    // 问题3：修复预测算法
    // 今日预测总额 = （今日实时 / 昨日同时刻） * 昨日总额
    const yestSameTimeSales = (data.yesterday as any).sameTimeSales || 0;
    const yestTotalSales = data.yesterday.totalSales || 0;
    let pred = 0;
    if (yestSameTimeSales > 0 && yestTotalSales > 0) {
      pred = (dSales / yestSameTimeSales) * yestTotalSales;
    } else {
      // 兜底逻辑
      const ratio = Math.max((ghost.getHours() * 60 + ghost.getMinutes()) / 1440, 0.01);
      pred = dSales / ratio;
    }
    if (pred > peakPredicted.current) peakPredicted.current = pred;

    const calculateMA = (daysData: any[], window: number) => {
      return daysData.map((_, index) => {
        if (index < window - 1) return null;
        const slice = daysData.slice(index - window + 1, index + 1);
        return Math.round(slice.reduce((acc, curr) => acc + curr.sales, 0) / window);
      });
    };

    const dispTrend = data.dailyTrend.slice(-trendDays).map((item: any, idx: number, arr: any[]) => {
      // 如果是最后一个点（即今日），强制使用前端正在回放累加计算出的动态 dSales
      if (idx === arr.length - 1) {
        return { ...item, sales: dSales };
      }
      return item;
    });

    return {
      dSales, dOrders, predictedSales: peakPredicted.current,
      salesGrowth: ((data.today.totalSales - data.yesterday.totalSales) / (data.yesterday.totalSales || 1)) * 100,
      ordersGrowth: ((data.today.totalOrders - data.yesterday.totalOrders) / (data.yesterday.totalOrders || 1)) * 100,
      dispTrend: dispTrend,
      ma10: calculateMA(data.dailyTrend, 10).slice(-trendDays),
      ma20: calculateMA(data.dailyTrend, 20).slice(-trendDays),
      ma30: calculateMA(data.dailyTrend, 30).slice(-trendDays),
      crossPlatformDelta,
      totalDelta
    };
  }, [data, currentTime, trendDays, selectedPlatformId]);

  // --- 渲染逻辑 (无 Hooks 纯净区) ---

  const getStatusLabel = (s: number) => {
    const map: any = { 5: '已取消', 10: '待付款', 12: '待尾款', 13: '待选仓', 20: '前处理', 30: '待客审', 35: '待财审', 40: '待递交', 50: '已递交', 55: '已审核', 95: '已发货', 110: '已完成' };
    return map[s] || '处理中';
  };

  const modalChartOption = useMemo(() => {
    if (!intradayModal.data) return {};
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderColor: '#0EA5E9',
        textStyle: { color: '#0F172A' },
        valueFormatter: (value: any) => value != null ? `¥${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'
      },
      grid: { left: '4%', right: '4%', bottom: '5%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: intradayModal.data.map((d: any) => d.hour),
        axisLabel: { color: '#64748B' }
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#64748B', formatter: (v: any) => `¥${(v / 10000).toFixed(1)}w` },
        splitLine: { lineStyle: { color: 'rgba(14, 165, 233, 0.1)' } }
      },
      series: [
        {
          name: '分时销量',
          type: 'line',
          smooth: true,
          data: intradayModal.data.map((d: any) => d.sales),
          itemStyle: { color: '#0EA5E9' },
          lineStyle: { width: 3, shadowBlur: 10, shadowColor: 'rgba(14, 165, 233, 0.4)' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(14, 165, 233, 0.3)' },
              { offset: 1, color: 'rgba(14, 165, 233, 0.05)' }
            ])
          }
        }
      ]
    };
  }, [intradayModal.data]);

  const trendModalChartOption = useMemo(() => {
    if (!trendModal.data) return {};
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderColor: '#10B981',
        textStyle: { color: '#0F172A' },
        valueFormatter: (value: any) => value != null ? `¥${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'
      },
      grid: { left: '4%', right: '4%', bottom: '5%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: trendModal.data.map((d: any) => (d.date || '').substring(5)),
        axisLabel: { color: '#64748B' }
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#64748B', formatter: (v: any) => `¥${(v / 10000).toFixed(1)}w` },
        splitLine: { lineStyle: { color: 'rgba(16, 185, 129, 0.1)' } }
      },
      series: [
        {
          name: '销售趋势',
          type: 'line',
          smooth: true,
          data: trendModal.data.map((d: any) => d.sales),
          itemStyle: { color: '#10B981' },
          lineStyle: { width: 3, shadowBlur: 10, shadowColor: 'rgba(16, 185, 129, 0.4)' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(16, 185, 129, 0.3)' },
              { offset: 1, color: 'rgba(16, 185, 129, 0.05)' }
            ])
          }
        }
      ]
    };
  }, [trendModal.data]);

  const pChartOption = {
    tooltip: {
      trigger: 'item',
      formatter: '{b}: ¥{c} ({d}%)',
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderColor: '#0EA5E9',
      textStyle: { color: '#0F172A' }
    },
    legend: {
      bottom: '0',
      textStyle: { color: '#64748B', fontSize: 10 },
      itemWidth: 10,
      itemHeight: 10
    },
    color: ['#0EA5E9', '#F43F5E', '#10B981', '#F59E0B', '#8B5CF6', '#F97316', '#06B6D4', '#EC4899', '#14B8A6', '#EAB308'],
    series: [{
      type: 'pie', radius: ['40%', '60%'], center: ['50%', '40%'], itemStyle: { borderRadius: 8 },
      label: { show: false },
      labelLine: { show: false },
      data: (data?.platformData || []).map((p: any) => ({ value: p.total_sales, name: p.platform_name }))
    }]
  };

  const tChartOption = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderColor: '#0EA5E9',
      textStyle: { color: '#0F172A' },
      valueFormatter: (value: any) => value != null ? `¥${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'
    },
    legend: { top: 0, textStyle: { color: '#64748B' } },
    xAxis: { 
      type: 'category', 
      data: (analysis?.dispTrend || []).map((d: any) => (d?.date || '').substring(5)),
      axisLabel: { color: '#64748B' }
    },
    yAxis: { 
      type: 'value', 
      axisLabel: { color: '#64748B', formatter: (v: any) => `¥${(v / 10000).toFixed(0)}w` },
      splitLine: { lineStyle: { color: 'rgba(14, 165, 233, 0.1)' } }
    },
    series: [
      { name: '实际销售', type: 'line', data: (analysis?.dispTrend || []).map((d: any) => d?.sales || 0), smooth: true, itemStyle: { color: '#F43F5E' }, lineStyle: { width: 3, shadowBlur: 10, shadowColor: 'rgba(244, 63, 94, 0.3)' }, areaStyle: { color: 'rgba(244, 63, 94, 0.05)' } },
      { name: '模型预测', type: 'line', data: [...Array(Math.max((analysis?.dispTrend.length || 0) - 1, 0)).fill(null), analysis?.predictedSales || 0], symbol: 'circle', symbolSize: 10, itemStyle: { color: '#0EA5E9' }, label: { show: false } },
      { name: 'MA10', type: 'line', data: analysis?.ma10 || [], smooth: true, itemStyle: { color: '#F59E0B' }, symbol: 'none', lineStyle: { width: 2, opacity: 0.9 } },
      { name: 'MA20', type: 'line', data: analysis?.ma20 || [], smooth: true, itemStyle: { color: '#10B981' }, symbol: 'none', lineStyle: { width: 2, opacity: 0.8 } },
      { name: 'MA30', type: 'line', data: analysis?.ma30 || [], smooth: true, itemStyle: { color: '#8B5CF6' }, symbol: 'none', lineStyle: { width: 2, opacity: 0.7 } }
    ]
  };

  const mChartOption = {
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => {
        const val = p.value;
        return `${p.name}<br/>销售额: ¥${isNaN(val) ? 0 : Number(val).toLocaleString()}`;
      },
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderColor: '#0EA5E9',
      textStyle: { color: '#0F172A' }
    },
    visualMap: {
      min: 0, max: Math.max(...(data?.regionalData || []).map((d: any) => d.value), 1000),
      right: 15, bottom: 20, inRange: { color: ['#E0F2FE', '#38BDF8', '#0284C7'] }, textStyle: { color: '#64748B' }
    },
    geo: {
      map: 'china',
      roam: false,
      zoom: 1.25,
      top: '12%',
      boundingCoords: [
        [73.5, 58.5],
        [135, 15.0]    // 加强南向冗余，适配 500px 高度容器
      ],
      label: { show: false },
      itemStyle: {
        areaColor: 'rgba(14, 165, 233, 0.05)',
        borderColor: 'rgba(14, 165, 233, 0.3)',
        borderWidth: 1
      },
      emphasis: { itemStyle: { areaColor: '#38BDF8' } }
    },
    series: [{
      type: 'map', geoIndex: 0,
      data: data?.regionalData || []
    }]
  };

  return (
    <div className="dashboard-root" key="zenith-root">
      {/* 氛围灯与装饰层 */}
      <div className="zenith-scanline" />
      <div className="ambience-glow g1" />
      <div className="ambience-glow g2" />

      {!data && loading && (
        <div className="startup-overlay">
          <div className="loader-container">
            <div className="orbit o1" />
            <div className="orbit o2" />
            <div className="loader-logo">ZX</div>
          </div>
          <div className="startup-text">
            <span>卓希食品</span>
            System Initializing ...
          </div>
        </div>
      )}

      <header className="main-header">
        <h1>
          <span>全渠道实时销售大盘</span>
          <span className="title-v">PRO v3.0</span>
        </h1>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            onClick={() => dispatch({ type: 'SET_AUTO_PLAY', payload: !isAutoPlay })}
            style={{
              background: 'transparent', border: 'none', color: isAutoPlay ? '#10B981' : 'var(--text-dim)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
              fontSize: '0.85rem', padding: '0 12px', borderRight: '1px solid rgba(255,255,255,0.1)', marginRight: '12px'
            }}
          >
            {isAutoPlay ? <Pause size={14} /> : <Play size={14} />}
            {isAutoPlay ? '轮播中' : '开启轮播'}
          </button>
          <div className="timer"><Clock size={14} /> {currentTime.toLocaleString()}</div>
        </div>
      </header>

      <div className="dashboard-grid">
        <div className="metrics-row">
          <div className="metric">
            <label><Activity size={14} /> 当日有效成交</label>
            <div className="val">¥ <OdometerNumber value={analysis?.dSales || 0} decimals={2} /></div>
            <div className={`trend ${(analysis?.salesGrowth || 0) >= 0 ? 'up' : 'down'}`}>
              环比昨日 {Math.abs(analysis?.salesGrowth || 0).toFixed(1)}%
            </div>
          </div>
          <div className="metric">
            <label><TrendingUp size={14} /> 峰值预测核心</label>
            <div className="val">¥ <OdometerNumber value={analysis?.predictedSales || 0} decimals={2} /></div>
            <div className="hint"><ArrowUpRight size={14} /> 算法实时对齐</div>
          </div>
          <div className="metric">
            <label><Award size={14} /> 当日订单</label>
            <div className="val"><OdometerNumber value={analysis?.dOrders || 0} decimals={0} /></div>
            <div className={`trend ${(analysis?.ordersGrowth || 0) >= 0 ? 'up' : 'down'}`}>环比昨日 {Math.abs(analysis?.ordersGrowth || 0).toFixed(1)}%</div>
          </div>
        </div>

        <div className="content-layout">
          {/* 左侧 Aside (25%) */}
          <aside className="platforms-side">
            <div className="glass-card chart-box row-top">
              <label><BarChart2 size={16} /> 渠道成交占比</label>
              <ReactECharts key="pier" option={pChartOption} style={{ height: '100%' }} />
            </div>
            <div className="glass-card p-list row-bottom">
              <label><Briefcase size={16} /> 业务渠道切换</label>
              <div className="pill-container">
                <button className={selectedPlatformId === undefined ? 'active' : ''} onClick={() => dispatch({ type: 'SET_PLATFORM', payload: undefined })}>
                  <span>所有渠道</span>
                  <span className="amount">¥{(((data?.grandToday?.pbBaseSales || 0) + (analysis?.totalDelta || 0)) / 10000).toFixed(1)}w</span>
                </button>
                {(data?.platformData || []).map((p: any) => (
                  <button key={`btn-${p.platform_id}`} className={selectedPlatformId === p.platform_id ? 'active' : ''} onClick={() => dispatch({ type: 'SET_PLATFORM', payload: p.platform_id })}>
                    <span>{p.platform_name}</span>
                    <span className="amount">¥{(((p.pb_base_sales || p.total_sales || 0) + (analysis?.crossPlatformDelta?.[p.platform_id] || 0)) / 10000).toFixed(1)}w</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <main className="center-main">
            <div className="glass-card trend-box row-top">
              <div className="box-header">
                <label>
                  <TrendingUp size={16} />
                  销售趋势对比-{selectedPlatformId === undefined ? '所有渠道' : (data?.platformData?.find((p: any) => p.platform_id === selectedPlatformId)?.platform_name || '渠道')}
                </label>
                <div className="tabs">
                  {[10, 20, 30, 60].map(d => <button key={d} className={trendDays === d ? 'active' : ''} onClick={() => dispatch({ type: 'SET_DAYS', payload: d })}>{d}日</button>)}
                </div>
              </div>
              <ReactECharts 
                key={`trend-${trendDays}`} 
                option={tChartOption} 
                style={{ height: '100%', minHeight: 180 }} 
                onEvents={{
                  click: (params: any) => {
                    if (params.componentType === 'series') {
                      const dataIndex = params.dataIndex;
                      if (analysis?.dispTrend && analysis.dispTrend[dataIndex]) {
                        const fullDate = analysis.dispTrend[dataIndex].date;
                        dispatch({ type: 'OPEN_MODAL', payload: fullDate });
                      }
                    }
                  }
                }}
              />
            </div>

            <div className="glass-card map-box row-bottom">
              <label>
                <Globe size={16} />
                全国区域分布-{selectedPlatformId === undefined ? '所有渠道' : (data?.platformData?.find((p: any) => p.platform_id === selectedPlatformId)?.platform_name || '渠道')}
              </label>
              {mapLoaded ? <ReactECharts option={mChartOption} style={{ height: '100%' }} onEvents={{
                  click: (params: any) => {
                    if (params.name) {
                       dispatch({ type: 'OPEN_TREND_MODAL', payload: { title: `${params.name} 销售趋势`, type: 'province', targetName: params.name } });
                    }
                  }
              }} /> : <div className="loading-map">极光引擎初始化...</div>}
            </div>
          </main>

          {/* 右侧 Aside (22%) */}
          <aside className="rankings-side">
            <div className="glass-card row-top">
              <div className="ranking-row-inner" style={{ flex: 1, display: 'flex', gap: '1.5rem', overflow: 'hidden' }}>
                <div style={{ flex: 0.4, minWidth: 0 }}>
                  <RankingList key="rank-r" title="省份榜" data={data?.regionalData || []} type="amount" onItemClick={(item: any) => dispatch({ type: 'OPEN_TREND_MODAL', payload: { title: `${item.name} 销售趋势`, type: 'province', targetName: item.name } })} />
                </div>
                <div style={{ flex: 0.6, minWidth: 0 }}>
                  <RankingList key="rank-s" title="爆款榜" data={(data?.topGoods || []).map((g: any) => ({ name: g.name, value: g.quantity }))} onItemClick={(item: any) => dispatch({ type: 'OPEN_TREND_MODAL', payload: { title: `${item.name} 销售趋势`, type: 'goods', targetName: item.name } })} />
                </div>
              </div>
            </div>

            <div className="glass-card orders-box row-bottom">
              <label>
                <Activity size={16} />
                实时成交流水-{selectedPlatformId === undefined ? '所有渠道' : (data?.platformData?.find((p: any) => p.platform_id === selectedPlatformId)?.platform_name || '渠道')}
              </label>
              <div className="scroll-area-v">
                <table className="orders-table">
                  <thead>
                    <tr style={{ color: 'var(--text-dim)', fontSize: '0.85rem', textAlign: 'left' }}>
                      <th style={{ padding: '0.4rem', width: '16.6%' }}>单号</th>
                      <th style={{ width: '33.3%' }}>昵称</th>
                      <th style={{ width: '16.6%' }}>金额</th>
                      <th style={{ width: '16.6%' }}>时间</th>
                      <th style={{ width: '16.6%' }}>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.recentOrders || []).map((o: any, i: number) => (
                      <tr key={i}>
                        <td className="no-cell">{o.trade_no?.slice(-6)}</td>
                        <td className="nick-cell">{o.buyer_nick || '匿名'}</td>
                        <td className="amount-cell">¥{o.receivable}</td>
                        <td className="time-cell">{o.trade_time}</td>
                        <td>
                          <span style={{
                            fontSize: '0.6rem', padding: '1px 3px', borderRadius: '2px',
                            background: o.trade_status >= 95 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                            color: o.trade_status >= 95 ? '#10b981' : '#f59e0b',
                            border: `1px solid ${o.trade_status >= 95 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)'}`
                          }}>
                            {getStatusLabel(o.trade_status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {intradayModal.visible && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => dispatch({ type: 'CLOSE_MODAL' })}
          >
            <motion.div 
              className="modal-content"
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e: any) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2>
                  <Activity size={20} color="#0EA5E9" />
                  <span className="highlight-text">{intradayModal.date}</span> 分时销量分布
                  <span style={{ fontSize: '0.8rem', color: '#64748b', marginLeft: '10px', fontWeight: 'normal' }}>
                    {selectedPlatformId === undefined ? '所有渠道' : (data?.platformData?.find((p: any) => p.platform_id === selectedPlatformId)?.platform_name || '渠道')}
                  </span>
                </h2>
                <button className="modal-close-btn" onClick={() => dispatch({ type: 'CLOSE_MODAL' })}>
                  <X size={24} />
                </button>
              </div>
              <div className="modal-body">
                {intradayModal.loading ? (
                  <div className="modal-loading">极速聚合引擎加载中...</div>
                ) : (
                  <ReactECharts option={modalChartOption} style={{ height: '100%', width: '100%' }} />
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {trendModal.visible && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => dispatch({ type: 'CLOSE_TREND_MODAL' })}
          >
            <motion.div 
              className="modal-content"
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e: any) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2>
                  <TrendingUp size={20} color="#10B981" />
                  <span className="highlight-text">{trendModal.title}</span> ({trendDays}天)
                  <span style={{ fontSize: '0.8rem', color: '#64748b', marginLeft: '10px', fontWeight: 'normal' }}>
                    {selectedPlatformId === undefined ? '所有渠道' : (data?.platformData?.find((p: any) => p.platform_id === selectedPlatformId)?.platform_name || '渠道')}
                  </span>
                </h2>
                <button className="modal-close-btn" onClick={() => dispatch({ type: 'CLOSE_TREND_MODAL' })}>
                  <X size={24} />
                </button>
              </div>
              <div className="modal-body">
                {trendModal.loading ? (
                  <div className="modal-loading">极速聚合引擎加载中...</div>
                ) : (
                  <ReactECharts option={trendModalChartOption} style={{ height: '100%', width: '100%' }} />
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const RankingItem = ({ item, idx, type, onClick }: any) => {
  const prevIdxRef = useRef(idx);
  const [isHoveringUp, setIsHoveringUp] = useState(false);
  const [isSinkingDown, setIsSinkingDown] = useState(false);

  useEffect(() => {
    if (idx < prevIdxRef.current) {
      setIsHoveringUp(true);
      setIsSinkingDown(false);
    } else if (idx > prevIdxRef.current) {
      setIsHoveringUp(false);
      setIsSinkingDown(true);
    } else {
      setIsHoveringUp(false);
      setIsSinkingDown(false);
    }
    prevIdxRef.current = idx;

    const t = setTimeout(() => {
      setIsHoveringUp(false);
      setIsSinkingDown(false);
    }, 600); // 动效持续时间
    return () => clearTimeout(t);
  }, [idx]);

  const rankClass = idx < 3 ? `rank-${idx + 1}` : '';

  // 动态决定层级与缩放：排名上升时放大并悬浮（z-index高），下降时缩小并沉降（z-index低）
  let scale = 1;
  let zIndex = 1;
  if (isHoveringUp) { scale = 1.05; zIndex = 10; }
  else if (isSinkingDown) { scale = 0.95; zIndex = 0; }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0, scale, zIndex }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      onClick={() => onClick && onClick(item)}
      style={{ cursor: onClick ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', position: 'relative', background: isHoveringUp ? 'rgba(14, 165, 233, 0.05)' : 'transparent', borderRadius: '4px', padding: isHoveringUp ? '2px 4px' : '0' }}
    >
      <div className={`ranking-rank ${rankClass}`}>{idx + 1}</div>
      <div style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.85rem', color: 'var(--text-main)', fontWeight: 600 }}>{item.name}</div>
      <div style={{ color: idx < 3 ? '#FFCE56' : 'var(--highlight)', fontWeight: 700, fontSize: '0.85rem', fontFamily: 'Rajdhani, sans-serif' }}>
        {type === 'amount' ? `¥${(item.value / 10000).toFixed(1)}w` : `${item.value}件`}
      </div>
    </motion.div>
  );
};

const RankingList = ({ title, data, type = 'count', onItemClick }: any) => {
  return (
    <div className="compact-ranking" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--highlight)', marginBottom: '0.75rem', fontWeight: 800, borderLeft: '2px solid var(--highlight)', paddingLeft: '0.5rem' }}>{title}</div>
      <div className="ranking-list" style={{ flex: 1, overflowY: 'hidden', overflowX: 'hidden', position: 'relative' }}>
        <AnimatePresence>
          {data && data.length > 0 ? data.slice(0, 10).map((item: any, idx: number) => (
            <RankingItem key={item.name} item={item} idx={idx} type={type} onClick={onItemClick} />
          )) : <div className="no-data">正在聚合 3.0 数据流...</div>}
        </AnimatePresence>
      </div>
    </div>
  );
};
