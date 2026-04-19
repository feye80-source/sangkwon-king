(function () {
  'use strict';

  var STATUS_KEYS = ['interest', 'review', 'field', 'bid', 'won', 'sell', 'pass'];
  var COL_STATUS = ['interest', 'review', 'field', 'bid', 'won', 'sell'];

  function normalizeStatus(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (!s) return 'interest';
    if (s.indexOf('ph_') === 0) s = s.slice(3);
    var map = {
      interest: 'interest', review: 'review', field: 'field', bid: 'bid', won: 'won', sell: 'sell', pass: 'pass',
      '\uad00\uc2ec': 'interest', '\uac80\ud1a0': 'review', '\uac80\ud1a0\uc911': 'review',
      '\ud604\uc7a5': 'field', '\uc784\uc7a5': 'field', '\ud604\uc7a5\uc608\uc815': 'field',
      '\uc785\ucc30': 'bid', '\uc785\ucc30\uc900\ube44': 'bid', '\ub099\ucc30': 'won', '\uc644\ub8cc': 'won',
      '\ub9e4\ub3c4': 'sell', '\ud328\uc2a4': 'pass'
    };
    return map[s] || (STATUS_KEYS.indexOf(s) >= 0 ? s : 'interest');
  }

  function ymdKey(dt) {
    if (!(dt instanceof Date) || isNaN(dt.getTime())) return '';
    return dt.getFullYear() + '.' + String(dt.getMonth() + 1).padStart(2, '0') + '.' + String(dt.getDate()).padStart(2, '0');
  }

  function fmtSum(v) {
    var n = Number(v || 0);
    if (!isFinite(n) || n <= 0) return '-';
    if (n >= 100000000) return (n / 100000000).toFixed(1) + '\uc5b5';
    return Math.round(n / 10000).toLocaleString('ko-KR') + '\ub9cc';
  }

  function injectStyle() {
    if (document.getElementById('sk-pipeline-patch-style')) return;
    var st = document.createElement('style');
    st.id = 'sk-pipeline-patch-style';
    st.textContent = '' +
      '.sk-drop-over{outline:1px dashed rgba(79,142,255,.7);outline-offset:-2px;background:rgba(79,142,255,.06)!important;}' +
      '.sk-dragging{opacity:.45;}' +
      '.sk-more-btn{margin-top:6px;padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.04);color:var(--di);font-size:10px;cursor:pointer;}' +
      '.sk-more-btn:hover{border-color:rgba(79,142,255,.45);color:#8ab8ff;}' +
      '.sk-col-sum{display:inline-flex;align-items:center;margin-left:5px;padding:1px 6px;border-radius:7px;font-size:10px;color:var(--di);background:rgba(255,255,255,.08);}' +
      '.sk-sched-modal{position:fixed;inset:0;z-index:12000;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;}' +
      '.sk-sched-panel{width:min(700px,92vw);max-height:76vh;overflow:auto;background:#121826;border:1px solid #2b3550;border-radius:12px;padding:14px;box-shadow:0 18px 50px rgba(0,0,0,.55);}' +
      '.sk-sched-title{font-size:13px;font-weight:700;color:#e8edf5;margin-bottom:10px;}' +
      '.sk-sched-close{margin-left:auto;padding:4px 10px;border-radius:7px;border:1px solid #2d3b5a;background:#1a2335;color:#9fb2da;cursor:pointer;font-size:11px;}' +
      '.sk-sched-close:hover{border-color:#4f8eff;color:#cbe0ff;}' +
      '.sk-reveal-all{margin-left:8px;padding:3px 7px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.04);color:var(--di);font-size:10px;cursor:pointer;}';
    document.head.appendChild(st);
  }

  function ensureStatusMigrate() {
    if (!window._STATUS_MIGRATE || typeof window._STATUS_MIGRATE !== 'object') {
      window._STATUS_MIGRATE = {};
    }
    Object.assign(window._STATUS_MIGRATE, {
      ph_interest: 'interest',
      ph_review: 'review',
      ph_field: 'field',
      ph_bid: 'bid',
      ph_won: 'won',
      ph_sell: 'sell',
      '\uad00\uc2ec': 'interest',
      '\uac80\ud1a0\uc911': 'review',
      '\ud604\uc7a5\uc608\uc815': 'field',
      '\uc785\ucc30\uc900\ube44': 'bid',
      '\uc644\ub8cc': 'won',
      '\ud328\uc2a4': 'pass'
    });
    var prev = window._migrateStatus;
    if (typeof prev === 'function' && !prev.__skPatched) {
      window._migrateStatus = function (s) {
        var migrated = prev.call(this, s);
        return normalizeStatus(migrated);
      };
      window._migrateStatus.__skPatched = true;
    } else if (typeof prev !== 'function') {
      window._migrateStatus = function (s) { return normalizeStatus(s); };
      window._migrateStatus.__skPatched = true;
    }
  }

  function findLinkedRoomId(itemId) {
    if (!itemId || typeof window.wrGetRooms !== 'function') return null;
    try {
      var target = String(itemId);
      var rooms = window.wrGetRooms() || [];
      var room = rooms.find(function (r) {
        return (r && (
          (r.linkedSavedId && String(r.linkedSavedId) === target) ||
          (r.auctionId && String(r.auctionId) === target) ||
          (r.listingId && String(r.listingId) === target) ||
          (Array.isArray(r.linkedItems) && r.linkedItems.map(String).indexOf(target) >= 0)
        ));
      });
      return room ? room.id : null;
    } catch (e) {
      return null;
    }
  }

  function goFieldTab(roomId) {
    try {
      if (roomId && typeof window.pmOpenWorkroom === 'function') {
        window.pmOpenWorkroom(roomId);
      }
      var selectors = [
        '#ipage8 .wr2-phase-tab[data-phase="field"]',
        '#ipage8 [data-phase-id="ph_field"]',
        '#ipage8 button[data-phase="field"]'
      ];
      for (var i = 0; i < selectors.length; i += 1) {
        var el = document.querySelector(selectors[i]);
        if (el) { el.click(); return; }
      }
      var fallback = Array.prototype.slice.call(document.querySelectorAll('#ipage8 button,#ipage8 .wr2-phase-tab'))
        .find(function (el) { return /\ud604\uc7a5|\uc784\uc7a5/.test(String(el.textContent || '')); });
      if (fallback) fallback.click();
    } catch (e) {}
  }

  function patchPhaseSwitch() {
    if (typeof window._wrPhaseSwitch !== 'function' || window._wrPhaseSwitch.__skPatched) return;
    var orig = window._wrPhaseSwitch;
    window._wrPhaseSwitch = function (roomId, phId) {
      var norm = normalizeStatus(phId);
      var nextPhId = String(phId || '');
      if (nextPhId.indexOf('ph_') === 0) nextPhId = 'ph_' + norm;
      else if (STATUS_KEYS.indexOf(norm) >= 0) nextPhId = 'ph_' + norm;

      var ret = orig.call(this, roomId, nextPhId);

      try {
        if (roomId && typeof window.wrGetRooms === 'function' && typeof window.wrSetRooms === 'function') {
          var rooms = window.wrGetRooms() || [];
          var room = rooms.find(function (r) { return String(r.id) === String(roomId); });
          if (room) {
            room.status = norm;
            room.phase = norm;
            if (typeof room.activePhase === 'string' && room.activePhase.indexOf('ph_') === 0) {
              room.activePhase = 'ph_' + norm;
            }
            room.updatedAt = Date.now();
            window.wrSetRooms(rooms);
          }
        }
      } catch (e) {}

      if (norm === 'field') {
        setTimeout(function () { goFieldTab(roomId); }, 30);
      }
      if (typeof window.renderWatchBoard === 'function') {
        setTimeout(function () { try { window.renderWatchBoard(); } catch (e) {} }, 50);
      }
      return ret;
    };
    window._wrPhaseSwitch.__skPatched = true;
  }

  function patchWatchSetter() {
    if (typeof window._wbSetStatus !== 'function' || window._wbSetStatus.__skPatched) return;
    var orig = window._wbSetStatus;
    window._wbSetStatus = function (itemId, status) {
      var norm = normalizeStatus(status);
      var ret = orig.call(this, itemId, norm);
      if (norm === 'field') {
        var roomId = findLinkedRoomId(itemId);
        if (roomId) setTimeout(function () { goFieldTab(roomId); }, 30);
      }
      return ret;
    };
    window._wbSetStatus.__skPatched = true;
  }

  function extractItemIdFromCard(card) {
    if (!card) return '';
    if (card.dataset && card.dataset.itemId) return String(card.dataset.itemId);
    var text = '';
    try {
      text = (card.getAttribute('onclick') || '') + '\n' + card.innerHTML;
    } catch (e) {}
    var m = text.match(/openPopup\('([^']+)'\)/) || text.match(/_wbSetStatus\('([^']+)'\s*,/) || text.match(/_wbCycleStatus\('([^']+)'\)/);
    var id = m && m[1] ? String(m[1]) : '';
    if (id && card.dataset) card.dataset.itemId = id;
    return id;
  }

  function setItemStatus(itemId, status) {
    if (!itemId) return false;
    var norm = normalizeStatus(status);
    try {
      if (typeof window._wbSetStatus === 'function') {
        window._wbSetStatus(itemId, norm);
        return true;
      }
    } catch (e) {}
    try {
      if (typeof window.getSv === 'function' && typeof window.setSv === 'function') {
        var sv = window.getSv() || [];
        var item = sv.find(function (s) { return String(s.id) === String(itemId); });
        if (!item) return false;
        if (!norm || norm === 'pass') delete item.watchStatus;
        else item.watchStatus = norm;
        window.setSv(sv);
        if (typeof window.renderSaved === 'function') window.renderSaved();
        if (typeof window.renderWatchBoard === 'function') window.renderWatchBoard();
        return true;
      }
    } catch (e2) {}
    return false;
  }

  function enhanceKanbanDnD() {
    injectStyle();
    COL_STATUS.forEach(function (status, idx) {
      var col = document.getElementById('wCol' + idx);
      if (!col) return;
      col.dataset.skStatus = status;

      if (!col.dataset.skDropBound) {
        col.addEventListener('dragover', function (e) {
          e.preventDefault();
          col.classList.add('sk-drop-over');
        });
        col.addEventListener('dragleave', function () { col.classList.remove('sk-drop-over'); });
        col.addEventListener('drop', function (e) {
          e.preventDefault();
          col.classList.remove('sk-drop-over');
          var itemId = (e.dataTransfer && e.dataTransfer.getData('text/sk-item-id')) || '';
          if (!itemId) return;
          var ok = setItemStatus(itemId, status);
          if (ok && typeof window.showToast === 'function') {
            var labels = { interest:'\uad00\uc2ec', review:'\uac80\ud1a0\uc911', field:'\ud604\uc7a5', bid:'\uc785\ucc30', won:'\ub099\ucc30', sell:'\ub9e4\ub3c4', pass:'\ud328\uc2a4' };
            window.showToast((labels[status] || status) + '\uc73c\ub85c \uc774\ub3d9\ub410\uc2b5\ub2c8\ub2e4', 'ok', 1200);
          }
        });
        col.dataset.skDropBound = '1';
      }

      Array.prototype.slice.call(col.children || []).forEach(function (card) {
        if (!card || (card.id && card.id.indexOf('wEmpty') === 0)) return;
        if (card.dataset && card.dataset.skDragBound === '1') return;
        var itemId = extractItemIdFromCard(card);
        if (!itemId) return;
        card.draggable = true;
        card.addEventListener('dragstart', function (e) {
          if (!e.dataTransfer) return;
          e.dataTransfer.setData('text/sk-item-id', itemId);
          e.dataTransfer.effectAllowed = 'move';
          card.classList.add('sk-dragging');
        });
        card.addEventListener('dragend', function () {
          card.classList.remove('sk-dragging');
          document.querySelectorAll('.sk-drop-over').forEach(function (el) { el.classList.remove('sk-drop-over'); });
        });
        if (card.dataset) card.dataset.skDragBound = '1';
      });
    });
  }

  function ensureScheduleModal() {
    var modal = document.getElementById('skSchedModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'skSchedModal';
    modal.className = 'sk-sched-modal';
    modal.style.display = 'none';
    modal.innerHTML = '' +
      '<div class="sk-sched-panel">' +
      '  <div style="display:flex;align-items:center;gap:8px;">' +
      '    <div id="skSchedTitle" class="sk-sched-title"></div>' +
      '    <button id="skSchedClose" class="sk-sched-close">\ub2eb\uae30</button>' +
      '  </div>' +
      '  <div id="skSchedBody" style="display:flex;flex-direction:column;gap:6px;"></div>' +
      '</div>';
    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.style.display = 'none';
    });
    document.body.appendChild(modal);
    modal.querySelector('#skSchedClose').addEventListener('click', function () {
      modal.style.display = 'none';
    });
    return modal;
  }

  function openScheduleModal(title, card) {
    injectStyle();
    var modal = ensureScheduleModal();
    var body = modal.querySelector('#skSchedBody');
    var titleEl = modal.querySelector('#skSchedTitle');
    titleEl.textContent = title || '\ud574\ub2f9 \ub0a0\uc9dc \uc804\uccb4 \ubb3c\uac74';
    body.innerHTML = '';

    var buttons = Array.prototype.slice.call(card.querySelectorAll('button'))
      .filter(function (btn) { return /openPopup\('/.test(btn.getAttribute('onclick') || ''); });

    buttons.forEach(function (srcBtn) {
      var copy = document.createElement('button');
      copy.type = 'button';
      copy.style.cssText = 'width:100%;text-align:left;padding:8px 10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;color:var(--tx);cursor:pointer;font-size:11px;';
      copy.textContent = (srcBtn.textContent || '').trim() || '\ubb3c\uac74 \uc0c1\uc138 \ubcf4\uae30';
      copy.addEventListener('click', function () {
        var itemId = extractItemIdFromCard(srcBtn.closest('[data-sched-key]')) || (srcBtn.getAttribute('onclick') || '').replace(/.*openPopup\('([^']+)'\).*/, '$1');
        if (typeof window.openPopup === 'function' && itemId) window.openPopup(itemId);
        modal.style.display = 'none';
      });
      body.appendChild(copy);
    });

    if (!buttons.length) {
      var empty = document.createElement('div');
      empty.style.cssText = 'padding:10px;color:var(--di);font-size:11px;';
      empty.textContent = '\ud45c\uc2dc\ud560 \ubb3c\uac74\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.';
      body.appendChild(empty);
    }

    modal.style.display = 'flex';
  }

  function enhanceScheduleBoard() {
    injectStyle();
    var board = document.getElementById('watchScheduleBoard');
    if (!board || board.style.display === 'none') return;

    var cards = Array.prototype.slice.call(board.querySelectorAll('[data-sched-key]'));
    if (!cards.length) return;

    cards.forEach(function (card) {
      var list = card.querySelector('.sk-sched-items') || card.querySelector('div[style*="overflow-y:auto"]');
      if (list && !list.classList.contains('sk-sched-items')) list.classList.add('sk-sched-items');

      var headerDate = card.querySelector('div > div > div') || card.querySelector('div');
      if (headerDate && !headerDate.dataset.skModalBound) {
        headerDate.style.cursor = 'pointer';
        headerDate.title = '\ud574\ub2f9 \ub0a0\uc9dc \uc804\ccb4 \ubb3c\uac74 \ubcf4\uae30';
        headerDate.addEventListener('click', function (e) {
          e.stopPropagation();
          openScheduleModal((headerDate.textContent || '').trim(), card);
        });
        headerDate.dataset.skModalBound = '1';
      }

      if (!list) return;
      var itemButtons = Array.prototype.slice.call(list.querySelectorAll('button'));
      if (itemButtons.length <= 4) return;

      itemButtons.forEach(function (btn, idx) {
        btn.style.display = idx < 4 ? '' : 'none';
      });

      if (!card.querySelector('.sk-more-btn')) {
        var moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'sk-more-btn';
        moreBtn.textContent = '+' + (itemButtons.length - 4) + '\uac74 \ub354\ubcf4\uae30';
        moreBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openScheduleModal((headerDate && headerDate.textContent || '').trim(), card);
        });
        list.parentNode.appendChild(moreBtn);
      }
    });

    var futureScroll = board.querySelector('#schedFutureScroll') || board.querySelector('div[style*="overflow-x:auto"]');
    if (futureScroll) {
      var today = ymdKey(new Date());
      var futureCards = Array.prototype.slice.call(futureScroll.querySelectorAll('[data-sched-key]'));
      var target = futureCards.find(function (c) { return String(c.dataset.schedKey || '') >= today; }) || futureCards[0] || null;
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
      }

      if (futureCards.length > 140 && !board.querySelector('#skRevealAllDays')) {
        var noteWrap = document.createElement('div');
        noteWrap.style.cssText = 'font-size:10px;color:var(--di);margin:6px 0 8px;';
        noteWrap.innerHTML = '\ub0a0\uc9dc \uce7c\ub7fc\uc774 ' + futureCards.length + '\uac1c\ub85c \ub9ce\uc544\uc11c \uc624\ub298 \uae30\uc900 \uad6c\uac04\ub9cc \uba3c\uc800 \ubcf4\uc5ec\uc8fc\uace0 \uc788\uc2b5\ub2c8\ub2e4.';
        var btn = document.createElement('button');
        btn.id = 'skRevealAllDays';
        btn.className = 'sk-reveal-all';
        btn.textContent = '\uc804\uccb4 \ub0a0\uc9dc \ubcf4\uae30';
        btn.addEventListener('click', function () {
          futureCards.forEach(function (c) { c.style.display = ''; });
          btn.remove();
        });
        noteWrap.appendChild(btn);
        board.insertBefore(noteWrap, board.firstChild.nextSibling || board.firstChild);

        var todayIdx = futureCards.findIndex(function (c) { return String(c.dataset.schedKey || '') >= today; });
        if (todayIdx < 0) todayIdx = 0;
        futureCards.forEach(function (c, idx) {
          if (Math.abs(idx - todayIdx) > 55) c.style.display = 'none';
        });
      }
    }
  }

  function updateColumnTotals() {
    COL_STATUS.forEach(function (status, idx) {
      var host = document.getElementById('wCnt' + idx);
      if (!host || !host.parentElement) return;
      var parent = host.parentElement;
      var sumEl = parent.querySelector('.sk-col-sum');
      if (!sumEl) {
        sumEl = document.createElement('span');
        sumEl.className = 'sk-col-sum';
        parent.appendChild(sumEl);
      }

      var total = 0;
      try {
        if (typeof window.getSv === 'function') {
          var sv = window.getSv() || [];
          sv.filter(function (it) { return it && String(it.watchStatus || '') === status; }).forEach(function (it) {
            var d = (it && it.data) || {};
            var raw = d['\ucd5c\uc800\uac00'] || d['\uac10\uc815\uac00'] || d['\ub9e4\ub9e4\uac00'] || 0;
            var n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10) || 0;
            total += n;
          });
        }
      } catch (e) {}
      sumEl.textContent = '\u2211 ' + fmtSum(total);
    });
  }

  function patchRenderWatchBoard() {
    if (typeof window.renderWatchBoard !== 'function') return;
    if (window.renderWatchBoard.__skPatched) return;
    var orig = window.renderWatchBoard;
    window.renderWatchBoard = function () {
      var ret = orig.apply(this, arguments);
      setTimeout(function () {
        enhanceScheduleBoard();
        enhanceKanbanDnD();
        updateColumnTotals();
      }, 0);
      return ret;
    };
    window.renderWatchBoard.__skPatched = true;
    setTimeout(function () {
      try { window.renderWatchBoard(); } catch (e) {}
    }, 60);
  }

  function applyAllPatches() {
    ensureStatusMigrate();
    patchPhaseSwitch();
    patchWatchSetter();
    patchRenderWatchBoard();
    enhanceKanbanDnD();
    updateColumnTotals();
  }

  function boot() {
    injectStyle();
    applyAllPatches();

    var tries = 0;
    var t = setInterval(function () {
      tries += 1;
      applyAllPatches();
      if (tries > 80) clearInterval(t);
    }, 400);

    document.addEventListener('click', function (e) {
      var tab = e.target && e.target.closest && e.target.closest('#pm-tab-pipeline, #plViewKanbanBtn, #plViewListBtn, #plViewCalBtn');
      if (tab) {
        setTimeout(function () {
          try { if (typeof window.renderWatchBoard === 'function') window.renderWatchBoard(); } catch (err) {}
        }, 80);
      }
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
