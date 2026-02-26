#!/bin/bash
sed -i '' 's/<img/<img onError={(e) => { e.target.onerror = null; e.target.style.display="none"; e.target.nextSibling && (e.target.nextSibling.style.display="flex"); }}/g' /Users/netanelmaimon/אתרים/stocks/frontend/src/components/HomeDashboard.js
