const fs = require('fs');
const content = fs.readFileSync('/Users/netanelmaimon/אתרים/stocks/frontend/src/components/StockDashboard.js', 'utf8');
const lines = content.split('\n');
let divCount = 0;
for (let i = 0; i < lines.length; i++) {
  const openMatches = (lines[i].match(/<div(>|\s[^>]*>)/g) || []).length;
  // Account for self-closing but we assume none.
  const closeMatches = (lines[i].match(/<\/div>/g) || []).length;
  divCount += openMatches - closeMatches;
  if(i >= 415 && i <= 475) {
     console.log(`${i+1}: ${divCount} ${lines[i].trim()}`);
  }
}
console.log("Final balance: ", divCount);
