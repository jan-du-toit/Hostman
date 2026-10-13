const enabled=()=>!process.env.NO_COLOR && (Boolean(process.env.FORCE_COLOR)||process.stdout.isTTY);
export function paint(code,text){return enabled()?`\x1b[${code}m${text}\x1b[0m`:String(text);}
export const success=text=>console.log(paint(32,'✓ '+text));
export const info=text=>console.log(paint(36,'ℹ '+text));
export const warning=text=>console.log(paint(33,'! '+text));
export function banner(version){return '\n'+paint(36,'╭────────────────────────────────────────╮')+'\n'+paint(97,'  HOSTMAN')+paint(36,'  /  ByDT Softwares')+paint(90,'  v'+version)+'\n'+paint(36,'╰────────────────────────────────────────╯');}

export function hostTable(rows){
  const keys=['host','ip','group','state','id'],labels=['HOSTNAME','ADDRESS','GROUP','STATE','ID'];
  const widths=keys.map((key,i)=>Math.max(labels[i].length,...rows.map(row=>String(row[key]).length)));
  const line=(left,middle,right)=>paint(90,left+widths.map(n=>'─'.repeat(n+2)).join(middle)+right);
  console.log(line('╭','┬','╮'));
  console.log(paint(90,'│ ')+labels.map((label,i)=>paint(36,label.padEnd(widths[i]))).join(paint(90,' │ '))+paint(90,' │'));
  console.log(line('├','┼','┤'));
  for(const row of rows){const cells=keys.map((key,i)=>{const text=String(row[key]).padEnd(widths[i]);return key==='state'?paint(row.state==='on'?32:90,text):key==='id'?paint(90,text):text;});console.log(paint(90,'│ ')+cells.join(paint(90,' │ '))+paint(90,' │'));}
  console.log(line('╰','┴','╯'));
}
