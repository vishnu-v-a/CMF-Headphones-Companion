import { responseDb } from './response.mjs';

// Pointer capture stays on the SVG root, which is not replaced during redraws.
// This editor has no native invoke: all changes are drafts until explicit Apply.
export function createEqGraph(svg, callbacks) {
  let geometry = null, handles = [], drag = null, frame = 0;
  const readout = document.querySelector('#graph-readout');
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const x = hz => 42 + Math.log(hz / 20) / Math.log(1000) * 858;
  const y = (db, g) => 12 + (g.hi - db) / (g.hi - g.lo) * (g.bottom - 12);
  const label = (index, band) => `${String(index + 1).padStart(2, '0')} · ${band.frequency} Hz · ${band.gain > 0 ? '+' : ''}${band.gain} dB`;

  function point(event) {
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const p = svg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    return p.matrixTransform(matrix.inverse());
  }

  function draw(profile) {
    const { rows, selectedBand } = callbacks.state();
    const focused = svg.contains(document.activeElement) ? document.activeElement.dataset.band : undefined;
    const height = drag?.geometry.height ?? (svg.clientWidth ? Math.max(160, svg.clientHeight * 920 / svg.clientWidth) : 240);
    const points = Array.from({length: 321}, (_, i) => {
      const hz = 20 * 1000 ** (i / 320);
      return { hz, db: responseDb(profile.filters, profile.preamp, hz) };
    });
    const centres = rows.map((band, index) => band.enabled ? { index, band, db: responseDb(profile.filters, profile.preamp, band.frequency) } : null).filter(Boolean);
    if ([...points, ...centres].some(p => !Number.isFinite(p.db))) throw Error('These filter values cannot be plotted.');
    const values = [...points, ...centres].map(p => p.db);
    geometry = drag?.geometry ?? {
      height, bottom: height - 32,
      lo: Math.floor(Math.min(-12, Math.min(...values) - 3) / 6) * 6,
      hi: Math.ceil(Math.max(6, Math.max(...values) + 3) / 6) * 6,
      width: svg.clientWidth, clientHeight: svg.clientHeight,
    };
    const g = geometry;
    svg.setAttribute('viewBox', `0 0 920 ${height}`);
    svg.replaceChildren();
    const add = (tag, attributes, text) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
      if (text !== undefined) el.textContent = text;
      svg.append(el); return el;
    };
    for (let i = 0; i <= 4; i++) {
      const db = g.lo + (g.hi - g.lo) * i / 4;
      add('line', {x1:42, x2:900, y1:y(db,g), y2:y(db,g), class:Math.abs(db)<.01?'zero-line':'grid-line'});
      add('text', {x:32, y:y(db,g)+3, 'text-anchor':'end', class:'axis-label'}, db.toFixed(0));
    }
    for (const hz of [20,50,100,200,500,1000,2000,5000,10000,20000]) {
      add('line', {x1:x(hz), x2:x(hz), y1:12, y2:g.bottom, class:'grid-line'});
      add('text', {x:x(hz), y:height-9, 'text-anchor':'middle', class:'axis-label'}, hz>=1000?`${hz/1000}k`:`${hz}`);
    }
    const path = points.map((p,i) => `${i?'L':'M'}${x(p.hz).toFixed(2)},${y(p.db,g).toFixed(2)}`).join(' ');
    add('path', {d:`${path} L900,${g.bottom} L42,${g.bottom} Z`, class:'curve-fill'});
    add('path', {d:path, class:'curve'});
    const matrix = svg.getScreenCTM();
    const unit = matrix ? 1 / Math.hypot(matrix.a, matrix.b) : 920 / (svg.clientWidth || 920);
    handles = centres.map(p => ({...p, x:x(p.band.frequency), y:y(p.db,g)}));
    // Selected point draws last; exact overlaps can also be selected in the band strip.
    for (const handle of [...handles].sort((a,b) => Number(a.index===selectedBand)-Number(b.index===selectedBand))) {
      const selected = handle.index === selectedBand;
      if (selected) add('line', {x1:handle.x,x2:handle.x,y1:12,y2:g.bottom,class:'band-guide'});
      const node = add('circle', {cx:handle.x,cy:handle.y,r:(selected?9:7)*unit,
        class:`graph-handle${selected?' selected':''}`, 'data-band':handle.index, role:'button',
        tabindex:selected?0:-1, 'aria-label':`Edit band ${handle.index+1}, ${handle.band.frequency} Hz, ${handle.band.gain} dB. Arrow keys adjust; Enter opens settings.`});
      const title = document.createElementNS(svg.namespaceURI,'title');
      title.textContent = `${label(handle.index,handle.band)} · Q ${handle.band.q}`; node.append(title);
      add('text', {x:handle.x,y:handle.y,'text-anchor':'middle','dominant-baseline':'central',
        'font-size':8*unit,class:'graph-handle-number'}, String(handle.index+1));
    }
    if (focused !== undefined) svg.querySelector(`[data-band="${focused}"]`)?.focus({preventScroll:true});
    const selected = rows[selectedBand];
    readout.textContent = drag || !document.querySelector('#band-editor').hidden ? label(selectedBand,selected) : 'Drag points · Draft';
  }

  function move() {
    frame = 0;
    if (!drag?.pending) return;
    const event = drag.pending; drag.pending = null;
    if (!drag.changed && Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)<3) return;
    const p = point(event); if (!p) return;
    const g = drag.geometry;
    const frequency = Math.round(20 * 1000 ** ((clamp(p.x-drag.offsetX,42,900)-42)/858));
    const db = g.hi - (clamp(p.y-drag.offsetY,12,g.bottom)-12)/(g.bottom-12)*(g.hi-g.lo);
    const { profile, rows } = callbacks.state(), band = rows[drag.index];
    const otherDb = responseDb(profile.filters.filter(f => f.id!==band.id),profile.preamp,frequency);
    // RBJ shelves have half their gain at the cutoff; peaks have their full gain.
    const rawGain = (db-otherDb) * (band.kind==='PK'?1:2);
    if (!Number.isFinite(rawGain)) return;
    const gain = Math.round(clamp(rawGain,Math.min(-24,drag.originalGain),Math.max(24,drag.originalGain))*10)/10;
    if (frequency===band.frequency && gain===band.gain) return;
    if (!drag.changed) { drag.rollback = callbacks.begin(drag.index); drag.changed = true; }
    callbacks.edit(drag.index,frequency,gain);
  }

  function finish(cancelled = false) {
    if (!drag) return;
    cancelAnimationFrame(frame); frame = 0;
    if (!cancelled) move();
    const previous = drag; drag = null; svg.classList.remove('dragging');
    if (svg.hasPointerCapture(previous.pointerId)) svg.releasePointerCapture(previous.pointerId);
    if (cancelled && previous.changed) previous.rollback();
    else if (!cancelled && !previous.changed) callbacks.open(previous.index);
    callbacks.refresh();
  }

  svg.addEventListener('pointerdown', event => {
    if (drag || !event.isPrimary || event.button!==0 || !geometry) return;
    const matrix = svg.getScreenCTM(); if (!matrix) return;
    const candidates = handles.map(handle => {
      const p = svg.createSVGPoint(); p.x=handle.x; p.y=handle.y;
      const screen = p.matrixTransform(matrix);
      return {...handle,distance:Math.hypot(screen.x-event.clientX,screen.y-event.clientY)};
    }).filter(h=>h.distance<=24).sort((a,b) => a.distance-b.distance || Number(b.index===callbacks.state().selectedBand)-Number(a.index===callbacks.state().selectedBand));
    if (!candidates.length) return;
    event.preventDefault();
    const hit = candidates[0]; callbacks.select(hit.index);
    const p = point(event); if (!p) return;
    drag = {pointerId:event.pointerId,index:hit.index,startX:event.clientX,startY:event.clientY,
      offsetX:p.x-hit.x,offsetY:p.y-hit.y,geometry:{...geometry},originalGain:hit.band.gain,changed:false};
    svg.setPointerCapture(event.pointerId); svg.classList.add('dragging');
  });
  svg.addEventListener('pointermove', event => {
    if (event.pointerId!==drag?.pointerId) return;
    event.preventDefault(); drag.pending={clientX:event.clientX,clientY:event.clientY};
    if (!frame) frame=requestAnimationFrame(move);
  });
  svg.addEventListener('pointerup', event => {
    if (event.pointerId!==drag?.pointerId) return;
    drag.pending={clientX:event.clientX,clientY:event.clientY}; finish();
  });
  svg.addEventListener('pointercancel', event => { if(event.pointerId===drag?.pointerId)finish(true); });
  svg.addEventListener('lostpointercapture', event => { if(event.pointerId===drag?.pointerId)finish(true); });
  window.addEventListener('blur',()=>finish(true));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)finish(true);});
  svg.addEventListener('keydown', event => {
    if(event.key==='Escape' && drag){event.preventDefault();finish(true);return;}
    const { rows, selectedBand } = callbacks.state();
    const index = event.target.dataset.band === undefined ? selectedBand : Number(event.target.dataset.band);
    const band = rows[index]; if(!band?.enabled)return;
    if(event.key==='Enter'||event.key===' '){event.preventDefault();callbacks.open(index);return;}
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault(); callbacks.select(index); if(!event.repeat)callbacks.begin(index);
    let {frequency,gain}=band;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight')frequency=Math.round(clamp(frequency*2**((event.key==='ArrowRight'?1:-1)*(event.shiftKey?1/120:1/12)),20,20000));
    else gain=Math.round(clamp(gain+(event.key==='ArrowUp'?1:-1)*(event.shiftKey ? 0.1 : 0.5),Math.min(-24,gain),Math.max(24,gain))*10)/10;
    callbacks.edit(index,frequency,gain);
  });
  return {
    draw, cancel:()=>finish(true), get dragging(){return Boolean(drag);},
    clear(){finish(true);geometry=null;handles=[];svg.replaceChildren();readout.textContent='Check band values';},
    resize(){if(drag && (svg.clientWidth!==drag.geometry.width || svg.clientHeight!==drag.geometry.clientHeight))finish(true);draw(callbacks.state().profile);},
  };
}
