'use strict';
const $=id=>document.getElementById(id);
let csrf='',state=null,settingsLoaded=false,loading=false;
async function api(path,fields){
  const response=await fetch('/api/'+path,{method:fields?'POST':'GET',headers:fields?{'Content-Type':'application/json','X-Hostman-CSRF':csrf}:{},body:fields?JSON.stringify(fields):undefined});
  const data=await response.json();if(!response.ok){if(response.status===401&&path!=='login')showLogin();throw new Error(data.error||'Request failed');}return data;
}
function showLogin(){$('login-view').hidden=false;$('dashboard-view').hidden=true;$('logout').hidden=true;$('user-name').textContent='';csrf='';settingsLoaded=false;}
function showDashboard(user){$('login-view').hidden=true;$('dashboard-view').hidden=false;$('logout').hidden=false;$('user-name').textContent=user;}
function toast(message,error=false){const box=$('toast');box.textContent=message;box.className=error?'error-toast':'';box.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>box.hidden=true,6000);}
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function actionButton(text,callback,cls=''){const button=node('button',text,'action '+cls);button.type='button';button.addEventListener('click',()=>run(callback));return button;}
async function run(callback){try{await callback();await loadState();}catch(error){toast(error.message,true);}}
async function mutate(op,fields){await api('action',{op,fields});toast('Changes saved. DNS reloads within one second.');}
function renderRecords(){
  const body=$('records-body');body.replaceChildren();const query=$('record-search').value.toLowerCase();
  const entries=state.data.entries.filter(e=>[e.host,e.ip,e.group,e.comment||''].join(' ').toLowerCase().includes(query));
  $('records-empty').hidden=entries.length>0;
  for(const entry of entries){
    const tr=node('tr'),name=node('td');name.append(node('span',entry.host,'host'),node('small',entry.group));
    const enabled=entry.enabled&&state.data.groups[entry.group];const status=node('td');status.append(node('span',enabled?'Active':'Disabled','badge '+(enabled?'':'off')));
    const actions=node('td');actions.append(actionButton('Edit',()=>{
      const form=$('record-form');for(const key of ['host','ip','group','comment'])form.elements[key].value=entry[key]||'';form.elements.key.value=entry.id;$('record-title').textContent='Edit DNS record';form.scrollIntoView({behavior:'smooth',block:'center'});
    }),actionButton(entry.enabled?'Disable':'Enable',()=>mutate(entry.enabled?'disable':'enable',{key:entry.id})),actionButton('Delete',async()=>{if(confirm('Remove '+entry.host+'? An automatic backup will be saved.'))await mutate('remove',{key:entry.id});},'delete'));
    tr.append(name,node('td',entry.ip),status,actions);body.append(tr);
  }
}
function resetRecord(){$('record-form').reset();$('record-form').elements.key.value='';$('record-title').textContent='Add a DNS record';}
function renderGroups(){
  const previous=$('record-group').value;const select=$('record-group');select.replaceChildren();const list=$('groups-list');list.replaceChildren();
  for(const [name,enabled] of Object.entries(state.data.groups)){
    const option=node('option',name);option.value=name;select.append(option);
    const box=node('div',undefined,'group-item');box.append(node('strong',name),node('span',enabled?'On':'Off','badge '+(enabled?'':'off')),actionButton(enabled?'Disable':'Enable',()=>mutate('group',{action:enabled?'disable':'enable',name})));
    if(name!=='default')box.append(actionButton('Delete',async()=>{if(confirm('Delete group '+name+' and its managed entries?'))await mutate('group',{action:'delete',name});},'delete'));
    list.append(box);
  }
  if(state.data.groups[previous]!==undefined)select.value=previous;
}
function renderBlocking(){
  const list=$('blocks-list');list.replaceChildren();const blocks=state.data.dns.blocks||[];$('blocks-empty').hidden=blocks.length>0;
  for(const rule of blocks){const row=node('div',undefined,'block-row');row.append(node('span',rule),actionButton('Remove',()=>mutate('dns-unblock',{domain:rule}),'delete'));list.append(row);}
}
function renderQueries(){
  const body=$('queries-body');body.replaceChildren();const queries=(state.stats?.queries||[]).slice().reverse();$('queries-empty').hidden=queries.length>0;
  for(const q of queries){const row=node('tr'),source=node('td');source.append(node('span',q.source,'badge '+q.source));row.append(node('td',new Date(q.time).toLocaleTimeString()),node('td',q.name),node('td',q.type),source,node('td',q.ms+' ms'));body.append(row);}
}
async function loadState(forceSettings=false){
  if(loading||!csrf)return;loading=true;
  try{
    state=await api('state');const counts=state.stats?.counts||{},recent=state.stats&&Date.now()-Date.parse(state.stats.updated)<10000;
    $('resolver-status').textContent=recent?'Running':'Stopped';$('resolver-status').style.color=recent?'#299b83':'#79858c';
    $('resolver-detail').textContent=state.priority?'System DNS priority enabled':'System DNS priority disabled';
    $('record-count').textContent=state.data.entries.filter(e=>e.enabled&&state.data.groups[e.group]).length;
    $('query-count').textContent=counts.total||0;$('local-count').textContent='Local answers: '+(counts.local||0);$('blocked-count').textContent=counts.blocked||0;$('rule-count').textContent=(state.data.dns.blocks||[]).length+' blocking rules';
    $('dashboard-port').textContent=state.data.dashboard?.port||8090;
    renderGroups();renderRecords();renderBlocking();renderQueries();
    if(!settingsLoaded||forceSettings){const form=$('resolver-form');form.elements.upstreams.value=state.data.dns.upstreams.join('\n');form.elements.ttl.value=state.data.dns.ttl;form.elements.timeoutMs.value=state.data.dns.timeoutMs;form.elements.logging.checked=state.data.dns.logging!==false;settingsLoaded=true;}
  }finally{loading=false;}
}
$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;$('login-error').textContent='';
  try{const data=await api('login',{username:form.elements.username.value.trim(),password:form.elements.password.value});csrf=data.csrf;form.elements.password.value='';showDashboard(data.user);await loadState();}
  catch(error){$('login-error').textContent=error.message;form.elements.password.value='';}finally{button.disabled=false;}
});
$('logout').addEventListener('click',()=>run(async()=>{await api('logout',{});showLogin();}));
$('refresh').addEventListener('click',()=>run(()=>loadState(true)));
$('record-search').addEventListener('input',()=>{if(state)renderRecords();});$('cancel-edit').addEventListener('click',resetRecord);
$('record-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{const form=event.currentTarget,fields={host:form.elements.host.value.trim(),ip:form.elements.ip.value.trim(),group:form.elements.group.value,comment:form.elements.comment.value};const key=form.elements.key.value;if(key)fields.key=key;await mutate(key?'set':'add',fields);resetRecord();});});
$('group-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;run(async()=>{await mutate('group',{action:'create',name:form.elements.name.value.trim()});form.reset();});});
$('block-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;run(async()=>{await mutate('dns-block',{domain:form.elements.domain.value.trim()});form.reset();});});
$('resolver-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{const f=event.currentTarget.elements;await mutate('dns-config',{upstreams:f.upstreams.value.split(/[\s,]+/).filter(Boolean),ttl:Number(f.ttl.value),timeoutMs:Number(f.timeoutMs.value),logging:f.logging.checked});});});
for(const button of document.querySelectorAll('[data-service]'))button.addEventListener('click',()=>run(async()=>{button.disabled=true;try{await api('service',{action:button.dataset.service});toast('DNS service action completed.');}finally{button.disabled=false;}}));
for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>{for(const b of document.querySelectorAll('[data-tab]'))b.classList.toggle('active',b===button);for(const section of document.querySelectorAll('.tab-content'))section.hidden=section.id!=='tab-'+button.dataset.tab;});
api('session').then(async identity=>{csrf=identity.csrf;showDashboard(identity.user);await loadState();}).catch(showLogin);
setInterval(()=>{if(csrf)loadState().catch(error=>toast(error.message,true));},5000);
