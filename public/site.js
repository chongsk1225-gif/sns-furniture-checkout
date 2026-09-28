const menu=document.querySelector('.menu'),mnav=document.querySelector('.mobile-nav');
if(menu&&mnav)menu.addEventListener('click',()=>mnav.classList.toggle('open'));

function money(n){return Number(n).toLocaleString('en-US',{style:'currency',currency:'USD'});}
function esc(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function card(p){
 const pricing=p.sale!=null?`<div class="was">WAS <span>${money(p.was)}</span></div><div class="sale-label">SALE PRICE</div><div class="sale">${money(p.sale)}</div>`:`<div class="check">CHECK PRICE / CHECK AVAILABILITY</div>`;
 const addBtn=p.sale!=null?`<button class="add-cart" type="button" data-sku="${esc(p.sku)}" data-name="${esc(p.name)}">ADD TO CART</button>`:'';
 return `<article class="card"><a class="card-image" href="product.html?sku=${encodeURIComponent(p.sku)}"><img src="${esc(p.image)}" alt="${esc(p.name)} ${esc(p.type)}" loading="lazy" onerror="this.closest('.card-image').classList.add('image-error');this.remove();"></a><div class="card-body"><div class="sku">${esc(p.sku)}</div><h3>${esc(p.name)}</h3><div class="ptype">${esc(p.type)}${p.collection?` · ${esc(p.collection)}`:''}</div>${pricing}<div class="availability">CHECK CURRENT AVAILABILITY</div>${addBtn}<a class="view" href="product.html?sku=${encodeURIComponent(p.sku)}">VIEW DETAILS</a></div></article>`;
}

const catalogState={items:null,category:null,page:1,pageSize:48,bound:false};
async function loadCatalog(){
 if(catalogState.items)return catalogState.items;
 const response=await fetch('data/catalog-index.json');
 if(!response.ok)throw new Error('Catalog data could not be loaded.');
 catalogState.items=await response.json();
 bindCatalogControls();
 const query=new URLSearchParams(location.search).get('q'),search=document.getElementById('search');
 if(query&&search&&!search.value)search.value=query;
 return catalogState.items;
}
function bindCatalogControls(){
 if(catalogState.bound)return;catalogState.bound=true;
 ['search','categoryFilter','brandFilter','sortFilter'].forEach(id=>{
  const el=document.getElementById(id);if(el)el.addEventListener(id==='search'?'input':'change',()=>{catalogState.page=1;paintCatalog();});
 });
}
function filteredCatalog(){
 const q=(document.getElementById('search')?.value||'').trim().toLowerCase();
 const selectedCategory=document.getElementById('categoryFilter')?.value||catalogState.category||'';
 const brand=document.getElementById('brandFilter')?.value||'';
 const sort=document.getElementById('sortFilter')?.value||'featured';
 let data=catalogState.items.filter(p=>(!selectedCategory||p.category===selectedCategory)&&(!brand||p.brand===brand)&&(!q||(p.name+' '+p.type+' '+p.sku+' '+p.category+' '+(p.collection||'')+' '+(p.finish||'')).toLowerCase().includes(q)));
 if(sort==='price-low')data.sort((a,b)=>(a.sale??Infinity)-(b.sale??Infinity));
 if(sort==='price-high')data.sort((a,b)=>(b.sale??-1)-(a.sale??-1));
 if(sort==='name')data.sort((a,b)=>a.name.localeCompare(b.name));
 return data;
}
function paintCatalog(){
 const grid=document.getElementById('grid');if(!grid||!catalogState.items)return;
 const data=filteredCatalog(),pages=Math.max(1,Math.ceil(data.length/catalogState.pageSize));
 catalogState.page=Math.min(catalogState.page,pages);
 const start=(catalogState.page-1)*catalogState.pageSize;
 grid.innerHTML=data.slice(start,start+catalogState.pageSize).map(card).join('')||'<div class="catalog-empty"><h2>No matching products</h2><p>Try a different SKU, name, room, or collection.</p></div>';
 const count=document.getElementById('resultCount');if(count)count.textContent=`${data.length.toLocaleString()} products`;
 let pager=document.getElementById('pager');
 if(!pager){pager=document.createElement('div');pager.id='pager';pager.className='pager';grid.after(pager);}
 pager.innerHTML=`<button ${catalogState.page===1?'disabled':''} data-page="${catalogState.page-1}">Previous</button><span>Page ${catalogState.page.toLocaleString()} of ${pages.toLocaleString()}</span><button ${catalogState.page===pages?'disabled':''} data-page="${catalogState.page+1}">Next</button>`;
 pager.querySelectorAll('button:not([disabled])').forEach(button=>button.onclick=()=>{catalogState.page=Number(button.dataset.page);paintCatalog();document.querySelector('.catalog-tools, .category-hero')?.scrollIntoView({behavior:'smooth'});});
}
async function renderCategory(category){
 catalogState.category=category;catalogState.page=1;
 try{await loadCatalog();paintCatalog();}catch(error){document.getElementById('grid').innerHTML=`<p class="catalog-error">${esc(error.message)}</p>`;}
}
async function renderAll(){
 catalogState.category=null;catalogState.page=1;
 try{await loadCatalog();paintCatalog();}catch(error){document.getElementById('grid').innerHTML=`<p class="catalog-error">${esc(error.message)}</p>`;}
}

/* ───────────────────────── Cart (merchandise + tax checkout) ─────────────────────────
   Persists ONLY [{sku,qty}] to localStorage. No customer or payment data is ever stored
   client-side. Server revalidates every SKU, price, quantity and total at checkout. */
const SnsCart=(function(){
 const KEY='sns_cart',MAX_QTY=25;
 function read(){
  try{
   const raw=JSON.parse(localStorage.getItem(KEY)||'[]');
   if(!Array.isArray(raw))return [];
   return raw.map(l=>({sku:String(l&&l.sku||'').trim(),qty:Math.max(1,Math.min(MAX_QTY,parseInt(l&&l.qty,10)||1))})).filter(l=>l.sku);
  }catch(e){return [];}
 }
 function write(lines){
  try{localStorage.setItem(KEY,JSON.stringify(lines));}catch(e){}
  document.dispatchEvent(new CustomEvent('cart:change',{detail:{count:count(lines)}}));
 }
 function count(lines){return (lines||read()).reduce((n,l)=>n+l.qty,0);}
 return {
  lines:read,
  count:()=>count(),
  add(sku,qty){sku=String(sku||'').trim();if(!sku)return;qty=Math.max(1,Math.min(MAX_QTY,parseInt(qty,10)||1));
   const lines=read(),hit=lines.find(l=>l.sku===sku);
   if(hit)hit.qty=Math.min(MAX_QTY,hit.qty+qty);else lines.push({sku,qty});
   write(lines);},
  setQty(sku,qty){const lines=read(),hit=lines.find(l=>l.sku===sku);if(!hit)return;
   qty=parseInt(qty,10)||0;if(qty<1){write(lines.filter(l=>l.sku!==sku));return;}
   hit.qty=Math.min(MAX_QTY,qty);write(lines);},
  remove(sku){write(read().filter(l=>l.sku!==sku));},
  clear(){write([]);}
 };
})();

function updateCartIndicator(){
 const n=SnsCart.count();
 document.querySelectorAll('[data-cart-count]').forEach(el=>{el.textContent=n;});
 document.querySelectorAll('.cart-indicator').forEach(el=>{el.classList.toggle('has-items',n>0);});
}

function mountCartIndicator(){
 const cta=document.querySelector('.head .cta');
 if(cta&&!document.querySelector('.head .cart-indicator')){
  const wrap=document.createElement('div');wrap.className='head-actions';
  const link=document.createElement('a');link.className='cart-indicator';link.href='cart.html';
  link.setAttribute('aria-label','View cart');
  link.innerHTML='CART <span data-cart-count>0</span>';
  cta.replaceWith(wrap);wrap.append(link,cta);
 }
 const mnav=document.querySelector('.mobile-nav');
 if(mnav&&!mnav.querySelector('.mobile-cart-link')){
  const a=document.createElement('a');a.className='mobile-cart-link';a.href='cart.html';
  a.innerHTML='Cart (<span data-cart-count>0</span>)';mnav.appendChild(a);
 }
 updateCartIndicator();
}

document.addEventListener('cart:change',updateCartIndicator);
window.addEventListener('storage',e=>{if(e.key==='sns_cart')updateCartIndicator();});
document.addEventListener('click',e=>{
 const btn=e.target.closest('.add-cart');if(!btn)return;
 e.preventDefault();
 SnsCart.add(btn.dataset.sku,1);
 const label=btn.textContent;btn.textContent='ADDED ✓';btn.classList.add('added');btn.disabled=true;
 setTimeout(()=>{btn.textContent=label;btn.classList.remove('added');btn.disabled=false;},1400);
});
mountCartIndicator();
