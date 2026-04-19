        if (!saleItems.length) {
          scheduleEl.style.display = 'none';
          scheduleEl.innerHTML = '';
        } else {
          const grouped = [];
          saleItems.forEach(entry => {
            let last = grouped[grouped.length - 1];
            if (!last || last.key !== entry.key) {
              last = { key: entry.key, date: entry.date, items: [] };
              grouped.push(last);
            }
            last.items.push(entry);
          });
          scheduleEl.style.display = '';
          const pastGroups   = grouped.filter(g => _calcDday(g.date) < 0);
          const futureGroups = grouped.filter(g => _calcDday(g.date) >= 0);
          const _renderSchedGroup = function(group) {
            const dday = _calcDday(group.date);
            const isToday = dday === 0;
            const isPast  = dday < 0;
            const color = isPast ? '#8b93a7' : isToday ? '#ff6370' : dday <= 3 ? '#ff8c42' : dday <= 7 ? '#fbbf24' : '#4ade80';
            const ddayLabel = isPast ? '\uc885\ub8cc' : (isToday ? 'D-Day' : 'D-' + dday);
            const todayHighlight = isToday ? 'border-color:rgba(255,99,112,.45);box-shadow:0 0 0 2px rgba(255,99,112,.18);' : '';
            const itemsHtml = group.items.map(function(entry) {
              const it = entry.item;
              const room = rooms.find(function(r) {
                return (r.linkedSavedId && String(r.linkedSavedId) === String(it.id)) ||
                  (r.auctionId && String(r.auctionId) === String(it.id)) ||
                  (r.listingId && String(r.listingId) === String(it.id)) ||
                  ((r.linkedItems||[]).map(String).includes(String(it.id)));
              });
              const roomTag = room ? '<span style="font-size:9px;color:#119ded;margin-left:2px;">\ud83d\uddc2\ufe0f</span>' : '';
              const d2 = it.data || {};
              const pv = parseInt(String(d2['\uac10\uc815\uac00']||d2['\ucd5c\uc800\uac00']||d2['\ub9e4\ub9e4\uac00']||0).replace(/[^0-9]/g,''))||0;
              const priceStr = pv ? (pv>=100000000?(pv/100000000).toFixed(1)+'\uc5b5':Math.round(pv/10000)+'\ub9cc') : '';
              return '<button onclick="openPopup(\'' + it.id + '\')" style="width:100%;text-align:left;padding:6px 8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:7px;color:var(--tx);cursor:pointer;transition:background .1s;" onmouseenter="this.style.background=\'rgba(255,255,255,.09)\'" onmouseleave="this.style.background=\'rgba(255,255,255,.04)\'">'
                + '<div style="display:flex;align-items:center;gap:6px;">'
                + '<span style="font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">' + esc(it.title||(it.data&&it.data['\uc18c\uc7ac\uc9c0'])||it.id) + '</span>'
                + (priceStr ? '<span style="font-size:10px;color:var(--or);font-weight:700;flex-shrink:0;">' + priceStr + '</span>' : '')
                + roomTag
                + '</div></button>';
            }).join('');
            return '<div data-sched-key="' + group.key + '" style="min-width:200px;max-width:200px;background:rgba(14,17,24,.92);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px;' + (isPast?'opacity:.5;':'') + todayHighlight + 'flex-shrink:0;scroll-snap-align:start;">'
              + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:7px;">'
              + '<div><div style="font-size:12px;font-weight:700;color:#e8edf5;">' + _fmtSaleShort(group.date) + '</div><div style="font-size:9px;color:var(--mu);margin-top:1px;">' + group.key + ' \xb7 ' + group.items.length + '\uac74</div></div>'
              + '<span style="flex-shrink:0;font-size:9px;font-weight:700;color:' + color + ';background:' + color + '18;border:1px solid ' + color + '44;padding:1px 6px;border-radius:999px;">' + ddayLabel + '</span>'
              + '</div>'
              + '<div style="display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto;">' + itemsHtml + '</div>'
              + '</div>';
          };
          let html = '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap;">'
            + '<div><div style="font-size:12px;font-weight:700;color:var(--tx);">\ud83d\udcc5 \ub9e4\uac01\uae30\uc77c \ubcf4\ub4dc</div>'
            + '<div style="font-size:9px;color:var(--mu);margin-top:2px;">\uc624\ub298 \uc790\ub3d9\uc2a4\ud06c\ub864 \xb7 \uc88c\uc6b0\ub85c \uc774\ub3d9</div></div>'
            + '<div style="font-size:10px;color:var(--di);">\uc804\uccb4 ' + saleItems.length + '\uac74 \xb7 \uc608\uc815 ' + futureGroups.length + '\uc77c</div>'
            + '</div>';
          if (pastGroups.length) {
            html += '<details style="margin-bottom:6px;">'
              + '<summary style="font-size:10px;color:var(--mu);cursor:pointer;padding:3px 0;list-style:none;display:flex;align-items:center;gap:4px;">'
              + '\u25b8 \uc885\ub8cc\ub41c \ub0a0\uc9dc ' + pastGroups.length + '\uac1c'
              + '</summary>'
              + '<div style="display:flex;gap:8px;overflow-x:auto;padding:6px 0 2px;scroll-snap-type:x mandatory;">'
              + pastGroups.map(_renderSchedGroup).join('')
              + '</div></details>';
          }
          html += '<div id="schedFutureScroll" style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;scroll-snap-type:x mandatory;">'
            + (futureGroups.length
              ? futureGroups.map(_renderSchedGroup).join('')
              : '<div style="font-size:11px;color:var(--mu);padding:16px 8px;">\uc608\uc815\ub41c \ub9e4\uac01\uae30\uc77c \uc5c6\uc74c</div>')
            + '</div>';
          scheduleEl.innerHTML = html;
          setTimeout(function() {
            const scroll = scheduleEl.querySelector('#schedFutureScroll');
            if (!scroll) return;
            const today = new Date();
            const todayKey = today.getFullYear() + '.' + String(today.getMonth()+1).padStart(2,'0') + '.' + String(today.getDate()).padStart(2,'0');
            const cards = Array.from(scroll.querySelectorAll('[data-sched-key]'));
            let target = cards.find(c => c.dataset.schedKey >= todayKey);
            if (target) target.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'start' });
          }, 80);
        }