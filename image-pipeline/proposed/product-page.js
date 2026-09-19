(async()=>{
 const sku=(new URLSearchParams(location.search).get('sku')||'').trim();
 const el=document.getElementById('detail');
 let product;
 if(sku){
  const shard=sku[0].toLowerCase();
  try{
   const response=await fetch(`data/details/${encodeURIComponent(shard)}.json`);
   if(response.ok)product=(await response.json()).find(item=>item.sku===sku);
  }catch(error){console.error(error);}
 }
 if(!product){
  el.innerHTML='<div class="product-missing"><h1>Product not found</h1><p>This item may no longer be available.</p><a class="btn dark" href="catalog.html">RETURN TO THE CATALOG</a></div>';
  return;
 }
 renderProduct(product);

 function addProductSchema(p){
  const schema={"@context":"https://schema.org","@type":"Product","@id":"https://snsfurniture.com/product.html?sku="+encodeURIComponent(p.sku)+"#product","name":p.name,"sku":p.sku,"category":p.category,"description":p.description,"image":p.gallery||[p.image],"brand":{"@type":"Brand","name":p.brand||"Furniture of America"},"seller":{"@id":"https://snsfurniture.com/#business"}};
  if(p.material)schema.material=p.material;if(p.finish)schema.color=p.finish;
  if(p.sale!=null)schema.offers={"@type":"Offer","url":"https://snsfurniture.com/product.html?sku="+encodeURIComponent(p.sku),"priceCurrency":"USD","price":p.sale,"availability":"https://schema.org/LimitedAvailability","seller":{"@id":"https://snsfurniture.com/#business"}};
  const script=document.createElement('script');script.type='application/ld+json';script.textContent=JSON.stringify(schema);document.head.appendChild(script);
 }
 function spec(label,value){return value?`<div class="spec"><small>${esc(label)}</small><b>${esc(value)}</b></div>`:'';}
 function fmtWeight(v){const n=Number(v);return isFinite(n)&&n>0?`${Math.round(n*100)/100} lbs`:'';}
 // The gallery caption used to always say "N VERIFIED IMAGE(S)" regardless of
 // whether the image actually passed exact-SKU verification — misleading for
 // an unresolved/hidden/needs-review product whose photo is unconfirmed.
 function galleryLabel(p,gallery){
  const n=gallery.length,plural=n===1?'':'S';
  if(p.hidden||p.needs_review)return 'NEEDS REVIEW — IMAGE UNVERIFIED';
  const status=p.image_verification?.status;
  if(status==='official_multi'||status==='verified_single_image')return `${n} VERIFIED IMAGE${plural}`;
  return `${n} IMAGE${plural} — NOT YET VERIFIED`;
 }
 function renderProduct(p){
  document.title=`${p.name} | Sash and Shade`;
  document.querySelector('meta[name="description"]').content=(p.description||`${p.name} from ${p.brand}.`).slice(0,155);
  document.getElementById('crumb').textContent=p.name;
  addProductSchema(p);
  const gallery=(p.gallery?.length?p.gallery:[p.image]).filter(Boolean);
  let active=0;
  const pricing=p.sale!=null?`<div class="was">WAS <span>${money(p.was)}</span></div><div class="sale-label">SALE PRICE</div><div class="price">${money(p.sale)}</div>`:'<div class="check">CHECK PRICE / CHECK AVAILABILITY</div>';
  const thumbs=gallery.map((url,index)=>`<button class="${index===0?'active':''}" data-index="${index}" aria-label="Show image ${index+1}"><img src="${esc(url)}" alt="${esc(p.name)} view ${index+1}" loading="lazy" onerror="this.closest('button').style.display='none'"></button>`).join('');
  const features=(p.features||[]).filter(Boolean);
  el.innerHTML=`<div class="product-gallery"><div class="main-image" id="mainImageWrap"><img id="main" src="${esc(gallery[0])}" alt="${esc(p.name)} ${esc(p.type)}"><span class="zoom-note">CLICK TO ENLARGE</span></div><div class="gallery-meta"><span>${galleryLabel(p,gallery)}</span><span>Exact SKU: ${esc(p.sku)}</span></div><div class="thumbs">${thumbs}</div><div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="Enlarged product images"><button class="lightbox-close" aria-label="Close image">×</button>${gallery.length>1?'<button class="lightbox-prev" aria-label="Previous image">‹</button><button class="lightbox-next" aria-label="Next image">›</button>':''}<img id="lightboxImg" src="${esc(gallery[0])}" alt="${esc(p.name)} enlarged view"></div></div><div class="product-copy"><div class="sku">${esc(p.sku)}</div><h1>${esc(p.name)}</h1><div class="type">${esc(p.type)}${p.collection?` · ${esc(p.collection)}`:''}</div><p>${esc(p.description)}</p><div class="pricing">${pricing}<div class="availability">CHECK CURRENT AVAILABILITY</div></div><div class="actions">${p.sale!=null?`<button class="btn dark add-cart" type="button" data-sku="${esc(p.sku)}" data-name="${esc(p.name)}">ADD TO CART</button><a class="btn" href="cart.html">VIEW CART</a>`:''}<a class="btn" href="contact.html?product=${encodeURIComponent(p.sku)}">ASK ABOUT THIS ITEM</a><a class="btn" href="tel:+14243106199">CALL (424) 310-6199</a></div>${p.sale!=null?'<p class="checkout-note">Online payment covers merchandise and applicable sales tax only. Delivery charges are quoted separately after your order is received. Online checkout is available for California delivery addresses only.</p>':''}<h3>Product details</h3><div class="spec-grid">${spec('SKU / Model',p.sku)}${spec('Category',p.category)}${spec('Product type',p.type)}${spec('Collection',p.collection)}${spec('Style',p.style)}${spec('Color / Finish',p.finish)}${spec('Material',p.material)}${spec('Dimensions',p.dimensions)}${spec('Net weight',fmtWeight(p.netWeight))}${spec('Pack',p.pack)}${spec('Shipping type',p.shipType)}</div>${features.length?`<h3>Features</h3><ul class="features">${features.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:''}<h3>Delivery</h3><p>Ask about delivery options for this item. California is our primary service area; qualifying nationwide delivery may be available depending on the product and destination.</p></div>`;
  const main=document.getElementById('main'),lightbox=document.getElementById('lightbox'),lightboxImg=document.getElementById('lightboxImg');
  const show=index=>{active=(index+gallery.length)%gallery.length;main.src=gallery[active];lightboxImg.src=gallery[active];document.querySelectorAll('.thumbs button').forEach((button,i)=>button.classList.toggle('active',i===active));};
  document.querySelectorAll('.thumbs button').forEach(button=>button.onclick=()=>show(Number(button.dataset.index)));
  document.getElementById('mainImageWrap').onclick=()=>{lightbox.classList.add('open');lightbox.querySelector('.lightbox-close').focus();};
  lightbox.querySelector('.lightbox-close').onclick=()=>lightbox.classList.remove('open');
  lightbox.querySelector('.lightbox-prev')?.addEventListener('click',event=>{event.stopPropagation();show(active-1);});
  lightbox.querySelector('.lightbox-next')?.addEventListener('click',event=>{event.stopPropagation();show(active+1);});
  lightbox.onclick=event=>{if(event.target===lightbox)lightbox.classList.remove('open');};
  document.addEventListener('keydown',event=>{if(!lightbox.classList.contains('open'))return;if(event.key==='Escape')lightbox.classList.remove('open');if(event.key==='ArrowLeft')show(active-1);if(event.key==='ArrowRight')show(active+1);});
  let touchStart=0;lightbox.addEventListener('touchstart',event=>touchStart=event.changedTouches[0].clientX,{passive:true});lightbox.addEventListener('touchend',event=>{const delta=event.changedTouches[0].clientX-touchStart;if(Math.abs(delta)>45)show(active+(delta<0?1:-1));},{passive:true});
 }
})();
