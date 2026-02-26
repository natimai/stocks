import React, { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts';

export default function InteractiveChart({ data, type = 'candlestick', showSMA = false }) {
    const chartContainerRef = useRef();
    const chartRef = useRef(null);

    useEffect(() => {
        if (!chartContainerRef.current || !data || data.length === 0) return;

        // Destroy existing chart if it exists
        if (chartRef.current) {
            chartRef.current.remove();
        }

        // Format data for lightweight-charts
        const chartData = data.map(d => {
            // If data comes from the initial payload (has .date as "MM/DD")
            if (d.date) {
                const year = new Date().getFullYear();
                const [month, day] = d.date.split('/');
                const paddedMonth = month.padStart(2, '0');
                const paddedDay = day.padStart(2, '0');
                return {
                    time: `${year}-${paddedMonth}-${paddedDay}`,
                    open: d.open,
                    high: d.high,
                    low: d.low,
                    close: d.close,
                    value: d.close
                };
            }
            // In case Python returned a UNIX timestamp (for intraday like 1D/1W)
            if (typeof d.time === 'number') {
                return {
                    time: d.time, // Unix Timestamp
                    open: d.open,
                    high: d.high,
                    low: d.low,
                    close: d.close,
                    value: d.close || d.value
                };
            }

            // Otherwise it's a date string like 'YYYY-MM-DD' from Daily ranges
            return {
                time: d.time,
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
                value: d.close || d.value,
                volume: d.volume || 0
            };
        });

        // Format volume data specifically
        const volumeData = chartData.map(d => ({
            time: d.time,
            value: d.volume,
            color: d.close >= d.open ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)' // emerald or red with opacity
        }));


        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { color: 'transparent' },
                textColor: '#334155', // slate-700
            },
            grid: {
                vertLines: { color: '#f1f5f9' }, // slate-100
                horzLines: { color: '#f1f5f9' },
            },
            timeScale: {
                borderColor: '#e2e8f0', // slate-200
                timeVisible: true, // Enable viewing by hours/minutes
                secondsVisible: false,
            },
            rightPriceScale: {
                borderColor: '#e2e8f0',
            },
            crosshair: {
                mode: 1, // Magnet mode brings crosshair directly to candles
            }
        });

        let series;
        if (type === 'candlestick') {
            series = chart.addSeries(CandlestickSeries, {
                upColor: '#10b981', // emerald-500
                downColor: '#ef4444', // red-500
                borderVisible: false,
                wickUpColor: '#10b981',
                wickDownColor: '#ef4444',
            });
        } else {
            series = chart.addSeries(LineSeries, {
                color: '#3B82F6', // blue-500
                lineWidth: 3,
                crosshairMarkerVisible: true,
                lastPriceAnimation: 1,
            });
        }

        const volumeSeries = chart.addSeries(HistogramSeries, {
            color: '#26a69a',
            priceFormat: {
                type: 'volume',
            },
            priceScaleId: '', // Set as an overlay
        });

        // Scale the volume down to bottom 20% of the chart
        chart.priceScale('').applyOptions({
            scaleMargins: {
                top: 0.8,    // highest point of histogram is 80% down the chart
                bottom: 0,
            },
        });

        series.setData(chartData);
        volumeSeries.setData(volumeData);

        // Calculate and add SMAs if requested
        let sma50Series = null;
        let sma200Series = null;
        if (showSMA) {
            const calculateSMA = (count) => {
                const arr = [];
                let sum = 0;
                for (let i = 0; i < chartData.length; i++) {
                    sum += chartData[i].close;
                    if (i >= count) {
                        sum -= chartData[i - count].close;
                        arr.push({ time: chartData[i].time, value: sum / count });
                    } else if (i === count - 1) {
                        arr.push({ time: chartData[i].time, value: sum / count });
                    }
                }
                return arr;
            };

            const sma50Data = calculateSMA(50);
            if (sma50Data.length > 0) {
                sma50Series = chart.addSeries(LineSeries, {
                    color: '#f59e0b', // amber-500
                    lineWidth: 2,
                    crosshairMarkerVisible: false,
                });
                sma50Series.setData(sma50Data);
            }

            const sma200Data = calculateSMA(200);
            if (sma200Data.length > 0) {
                sma200Series = chart.addSeries(LineSeries, {
                    color: '#8b5cf6', // violet-500
                    lineWidth: 2,
                    crosshairMarkerVisible: false,
                });
                sma200Series.setData(sma200Data);
            }
        }

        chart.timeScale().fitContent();

        // ----------------------------------------------------
        // Floating Tooltip Implementation
        // ----------------------------------------------------
        const toolTip = document.createElement('div');
        toolTip.style = `
            position: absolute;
            display: none;
            padding: 8px 12px;
            box-sizing: border-box;
            font-size: 13px;
            text-align: left;
            z-index: 1000;
            top: 12px;
            left: 12px;
            pointer-events: none;
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.95);
            border: 1px solid #e2e8f0;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            color: #1e293b;
            font-weight: 500;
            min-width: 120px;
        `;
        chartContainerRef.current.appendChild(toolTip);

        chart.subscribeCrosshairMove((param) => {
            if (
                param.point === undefined ||
                !param.time ||
                param.point.x < 0 ||
                param.point.x > chartContainerRef.current.clientWidth ||
                param.point.y < 0 ||
                param.point.y > chartContainerRef.current.clientHeight
            ) {
                toolTip.style.display = 'none';
            } else {
                const dateStr = typeof param.time === 'string' ? param.time : new Date(param.time * 1000).toLocaleString();
                const dataObj = param.seriesData.get(series);

                if (dataObj) {
                    let htmlData = `<div style="font-size: 11px; color: #64748b; margin-bottom: 4px;">${dateStr}</div>`;

                    if (type === 'candlestick' && dataObj.open !== undefined) {
                        const changeColor = dataObj.close >= dataObj.open ? '#10b981' : '#ef4444';
                        htmlData += `
                            <div style="display: flex; justify-content: space-between"><span>O:</span> <span>$${dataObj.open.toFixed(2)}</span></div>
                            <div style="display: flex; justify-content: space-between"><span>H:</span> <span>$${dataObj.high.toFixed(2)}</span></div>
                            <div style="display: flex; justify-content: space-between"><span>L:</span> <span>$${dataObj.low.toFixed(2)}</span></div>
                            <div style="display: flex; justify-content: space-between; font-weight: bold; color: ${changeColor};"><span>C:</span> <span>$${dataObj.close.toFixed(2)}</span></div>
                        `;
                    } else if (dataObj.value !== undefined) {
                        htmlData += `<div style="font-weight: bold;">Price: $${dataObj.value.toFixed(2)}</div>`;
                    }

                    // Look for volume data precisely matching this time
                    const volObj = param.seriesData.get(volumeSeries);
                    if (volObj && volObj.value !== undefined) {
                        htmlData += `<div style="display: flex; justify-content: space-between; margin-top: 4px; border-top: 1px solid #f1f5f9; padding-top: 4px;"><span>Vol:</span> <span>${(volObj.value / 1000).toFixed(1)}K</span></div>`;
                    }

                    if (showSMA) {
                        const sma50Obj = sma50Series ? param.seriesData.get(sma50Series) : null;
                        const sma200Obj = sma200Series ? param.seriesData.get(sma200Series) : null;

                        if (sma50Obj || sma200Obj) {
                            htmlData += `<div style="margin-top: 4px; border-top: 1px solid #f1f5f9; padding-top: 4px;">`;
                            if (sma50Obj) htmlData += `<div style="display: flex; justify-content: space-between; color: #f59e0b;"><span>SMA50:</span> <span>$${sma50Obj.value.toFixed(2)}</span></div>`;
                            if (sma200Obj) htmlData += `<div style="display: flex; justify-content: space-between; color: #8b5cf6;"><span>SMA200:</span> <span>$${sma200Obj.value.toFixed(2)}</span></div>`;
                            htmlData += `</div>`;
                        }
                    }

                    toolTip.innerHTML = htmlData;
                    toolTip.style.display = 'block';

                    // Adjust position slightly to not fall off screen
                    const toolTipWidth = 140;
                    let left = param.point.x + 15;
                    if (left > chartContainerRef.current.clientWidth - toolTipWidth) {
                        left = param.point.x - toolTipWidth - 15;
                    }
                    toolTip.style.left = left + 'px';
                    toolTip.style.top = param.point.y + 15 + 'px';
                }
            }
        });

        chartRef.current = chart;

        const handleResize = () => {
            chart.applyOptions({ width: chartContainerRef.current.clientWidth });
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            if (chartRef.current) {
                chartRef.current.remove();
                chartRef.current = null;
            }
        };
    }, [data, type, showSMA]);

    return (
        <div ref={chartContainerRef} style={{ width: '100%', height: '100%', minHeight: '300px' }} />
    );
}
