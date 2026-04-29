import React, { useState, useEffect, useRef } from 'react';

interface OdometerNumberProps {
  value: number; // 当前真实需要显示的数值
  duration?: number; // 兼容性接口，已弃用
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}

interface FloatingDelta {
  id: number;
  diff: number;
  type: 'up' | 'down';
}

/**
 * 带有数字跳变动效的展示组件
 */
export const OdometerNumber: React.FC<OdometerNumberProps> = ({
  value,
  prefix = '',
  suffix = '',
  decimals = 0,
  className = ''
}) => {
  const prevValueRef = useRef(value);
  const [deltas, setDeltas] = useState<FloatingDelta[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    if (value !== prevValueRef.current) {
      const diff = Math.abs(value - prevValueRef.current);
      const type = value > prevValueRef.current ? 'up' : 'down';
      const id = nextId.current++;
      setDeltas(prev => [...prev, { id, diff, type }]);

      // 1000ms 后自动移除动效元素
      setTimeout(() => {
        setDeltas(prev => prev.filter(d => d.id !== id));
      }, 1000);
    }
    prevValueRef.current = value;
  }, [value]);

  // 千分位格式化
  const formatNumber = (num: number) => {
    return num.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  };

  return (
    <span className={`odometer ${className}`} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      {prefix}
      {formatNumber(value)}
      {suffix}
      {deltas.map(d => (
        <span key={d.id} className={`floating-delta ${d.type}`}>
          {d.type === 'up' ? '+' : '-'}{formatNumber(d.diff)}
        </span>
      ))}
    </span>
  );
};

