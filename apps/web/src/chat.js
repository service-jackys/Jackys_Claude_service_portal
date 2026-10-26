/* Chat (modification #140): direct messages, channels and threads attached to a job
 * card, appointment, schedule, complaint or task. Loaded before app.js; app.js calls
 * JdChat.create({...}) once, then renderPage(root) for the Chat screen, openRecord(type, id)
 * for the slide-over thread on a record, and startBadge() for the unread counter.
 * Phase 1 refreshes by polling (open thread every 4 s, list every 10 s, badge every 25 s).
 */
(function () {
  'use strict';

  const TZ = 'Asia/Dubai';
  const RECORD_LABELS = {
    job_card: 'Job card',
    appointment: 'Appointment',
    schedule: 'Schedule',
    complaint: 'Complaint',
    task: 'Task',
  };

  const ICONS = {
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    bellOff:
      '<path d="M8.7 3A6 6 0 0 1 18 8c0 2.7.4 4.6.9 6"/><path d="M17 17H3s3-2 3-9c0-.7.1-1.4.3-2"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/><path d="m2 2 20 20"/>',
    reply: '<path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    users:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    open: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
    flag: '<path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/>',
    clip: '<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7L10.2 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7.6"/>',
    camera:
      '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.5" r="3.5"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
    popout:
      '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.900 4.900l2.100 2.100M17 17l2.100 2.100M4.900 19.100 7 17M17 7l2.100-2.100"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 14h10l1-14"/>',
    pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3Z"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  };
  const icon = (name, size) =>
    '<svg class="ch-ico" width="' +
    (size || 18) +
    '" height="' +
    (size || 18) +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    ICONS[name] +
    '</svg>';

  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d)); // YYYY-MM-DD
  const dayFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const shortDayFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
  });

  function dayLabel(value) {
    const key = dayKey(value);
    const now = new Date();
    if (key === dayKey(now)) return 'Today';
    if (key === dayKey(new Date(now.getTime() - 86400000))) return 'Yesterday';
    return dayFmt.format(new Date(value));
  }
  function listTime(value) {
    if (!value) return '';
    return dayKey(value) === dayKey(new Date())
      ? timeFmt.format(new Date(value))
      : shortDayFmt.format(new Date(value));
  }
  function initials(name) {
    const parts = String(name || '?')
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .trim()
      .split(/\s+/);
    return (
      (parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')
    ).toUpperCase();
  }
  function hue(name) {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  }

  function toast(text) {
    const node = document.createElement('div');
    node.className = 'ch-toast';
    node.setAttribute('role', 'alert');
    node.textContent = text;
    document.body.appendChild(node);
    window.setTimeout(() => node.remove(), 4000);
  }

  function create(deps) {
    const esc = deps.escapeHtml;
    const api = deps.apiRequest;
    let badgeTimer = null;
    let page = null;

    const avatar = (name, kind, size, pid) => {
      if (kind === 'channel')
        return (
          '<span class="ch-av ch-av-ch' +
          (size ? ' ' + size : '') +
          '">' +
          icon('hash', 18) +
          '</span>'
        );
      if (kind === 'record')
        return (
          '<span class="ch-av ch-av-rec' +
          (size ? ' ' + size : '') +
          '">' +
          icon('link', 18) +
          '</span>'
        );
      return (
        '<span class="ch-av' +
        (size ? ' ' + size : '') +
        '"' +
        (pid ? ' data-pid="' + esc(String(pid)) + '"' : '') +
        ' style="--av:' +
        hue(name) +
        '" aria-hidden="true">' +
        esc(initials(name)) +
        '</span>'
      );
    };

    const convTitle = (c) =>
      c.kind === 'direct'
        ? c.otherName || 'Direct chat'
        : c.kind === 'channel'
          ? c.title
          : c.recordLabel || (RECORD_LABELS[c.recordType] || 'Record') + ' #' + c.recordId;

    function bodyHtml(message) {
      let html = esc(message.body);
      for (const person of message.mentions || []) {
        const token = esc('@' + person.name);
        html = html.split(token).join('<span class="ch-mention">' + token + '</span>');
      }
      html = html.replace(
        /(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
      );
      return html.replace(/\n/g, '<br>');
    }

    async function summary() {
      const data = await api('/api/chat/summary');
      if (deps.onUnread) deps.onUnread(data);
      paintBubble(data.unread);
      return data;
    }

    // ---- live events (Server-Sent Events over fetch, so the sign-in header is used).
    // Events are only nudges; screens refetch through the normal API. Without a stream
    // (older proxy, offline) every screen keeps polling, just more slowly when live.
    const bus = {
      handlers: {},
      on(type, fn) {
        (this.handlers[type] = this.handlers[type] || new Set()).add(fn);
        return () => this.handlers[type].delete(fn);
      },
      emit(type, data) {
        for (const fn of [...(this.handlers[type] || [])]) {
          try {
            fn(data);
          } catch {
            /* one broken listener must not stop the others */
          }
        }
      },
    };
    const live = { online: new Set(), connected: false, controller: null, retry: null, wait: 2000 };

    function paintPresence() {
      document.querySelectorAll('.ch-av[data-pid]').forEach((el) => {
        el.classList.toggle('ch-online', live.online.has(el.dataset.pid));
      });
    }

    async function connectStream() {
      if (!deps.apiFetch || live.controller) return;
      const controller = new AbortController();
      live.controller = controller;
      try {
        const response = await deps.apiFetch('/api/chat/stream', {
          signal: controller.signal,
          headers: { accept: 'text/event-stream' },
        });
        if (!response.ok || !response.body) throw new Error('stream unavailable');
        live.connected = true;
        live.wait = 2000;
        bus.emit('resync', {});
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let cut;
          while ((cut = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            let type = 'message';
            let data = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) type = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (!data) continue;
            let payload;
            try {
              payload = JSON.parse(data);
            } catch {
              continue;
            }
            if (type === 'hello') {
              live.online = new Set(payload.online);
              paintPresence();
              bus.emit('presence', {});
            } else if (type === 'presence') {
              if (payload.online) live.online.add(String(payload.profileId));
              else live.online.delete(String(payload.profileId));
              paintPresence();
              bus.emit('presence', payload);
            } else bus.emit(type, payload);
          }
        }
      } catch {
        /* reconnect below unless we were stopped */
      }
      live.connected = false;
      const stopped = controller.signal.aborted;
      live.controller = null;
      live.online = new Set();
      paintPresence();
      if (!stopped) {
        live.retry = window.setTimeout(connectStream, live.wait);
        live.wait = Math.min(live.wait * 2, 30000);
      }
    }
    function disconnectStream() {
      window.clearTimeout(live.retry);
      if (live.controller) live.controller.abort();
      live.controller = null;
      live.connected = false;
    }

    let summaryTimer = null;
    const refreshSummary = () => {
      window.clearTimeout(summaryTimer);
      summaryTimer = window.setTimeout(() => summary().catch(() => {}), 400);
    };
    let offs = [];

    function startBadge() {
      stopBadge();
      const tick = () => {
        if (document.visibilityState === 'hidden') return;
        if (live.connected && badgeTick++ % 3) return;
        summary().catch(() => {});
      };
      let badgeTick = 0;
      tick();
      badgeTimer = window.setInterval(tick, 25000);
      offs = ['message', 'change', 'read', 'resync'].map((type) => bus.on(type, refreshSummary));
      offs.push(bus.on('message', incoming));
      mountBubble();
      connectStream();
    }
    function stopBadge() {
      if (badgeTimer) window.clearInterval(badgeTimer);
      badgeTimer = null;
      offs.forEach((off) => off());
      offs = [];
      disconnectStream();
      unmountBubble();
      if (deps.onUnread) deps.onUnread({ unread: 0, mentions: 0, needsReply: 0 });
    }

    // ================================================================== alerts
    // Pop-ups on any page, desktop notifications when the window is in the background,
    // the floating chat bubble and its panel, and the notification settings.
    const threadsOpen = new Set();
    let floatUi = null;
    const chatPageVisible = () => {
      const workspace = document.getElementById('chatWorkspace');
      return Boolean(page && workspace && !workspace.hidden);
    };
    const threadVisible = (id) =>
      [...threadsOpen].some((h) => h.viewing() && String(h.id) === String(id));
    const popOutMode = () => document.body.classList.contains('chat-popout');

    function openAnywhere(id) {
      if (chatPageVisible()) return page.open(String(id));
      if (popOutMode() && page) return page.open(String(id));
      return openInPanel(String(id));
    }

    function paintBubble(count) {
      const badge = document.querySelector('.ch-bubble-badge');
      if (!badge) return;
      const n = Number(count || 0);
      badge.hidden = n < 1;
      badge.textContent = n > 99 ? '99+' : String(n);
      const button = document.querySelector('.ch-bubble-btn');
      if (button) button.setAttribute('aria-label', n ? 'Chat, ' + n + ' unread' : 'Chat');
    }

    function popup(data) {
      let stack = document.querySelector('.ch-pop-stack');
      if (!stack) {
        stack = document.createElement('div');
        stack.className = 'ch-pop-stack';
        stack.setAttribute('role', 'region');
        stack.setAttribute('aria-label', 'New messages');
        document.body.appendChild(stack);
      }
      const where =
        data.kind === 'direct'
          ? ''
          : '<span class="ch-pop-where">' + esc(data.title || 'Chat') + '</span>';
      const node = document.createElement('div');
      node.className = 'ch-pop' + (data.mention ? ' ch-pop-mention' : '');
      node.innerHTML =
        '<button type="button" class="ch-pop-main" data-pop-open>' +
        avatar(data.senderName, 'direct', 'ch-av-sm') +
        '<span class="ch-pop-text"><b>' +
        esc(data.senderName) +
        (data.mention ? ' mentioned you' : '') +
        '</b>' +
        where +
        '<span class="ch-pop-body">' +
        esc(data.preview) +
        '</span></span></button>' +
        '<button type="button" class="ch-iconbtn ch-pop-x" data-pop-close aria-label="Dismiss">' +
        icon('close', 14) +
        '</button>';
      const dismiss = () => node.remove();
      node.querySelector('[data-pop-open]').addEventListener('click', () => {
        dismiss();
        openAnywhere(data.conversationId);
      });
      node.querySelector('[data-pop-close]').addEventListener('click', dismiss);
      stack.appendChild(node);
      while (stack.children.length > 3) stack.firstElementChild.remove();
      window.setTimeout(dismiss, data.mention ? 12000 : 7000);
    }

    function desktopNotify(data) {
      if (!('Notification' in window) || Notification.permission !== 'granted') return false;
      try {
        const note = new Notification(
          data.mention ? data.senderName + ' mentioned you' : data.senderName,
          {
            body: (data.kind === 'direct' ? '' : (data.title || 'Chat') + ': ') + data.preview,
            tag: 'chat-' + data.conversationId,
            icon: '/portal/icon.svg',
          },
        );
        note.onclick = () => {
          window.focus();
          note.close();
          openAnywhere(data.conversationId);
        };
        return true;
      } catch {
        return false;
      }
    }

    function incoming(data) {
      if (data.muted && !data.mention) return;
      const away = document.visibilityState === 'hidden' || !document.hasFocus();
      if (!away && threadVisible(data.conversationId)) return;
      if (away && desktopNotify(data)) return;
      if (document.visibilityState === 'visible') popup(data);
    }

    // ---- floating bubble and panel
    function mountBubble() {
      if (document.querySelector('.ch-bubble-btn') || popOutMode()) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ch-bubble-btn';
      button.setAttribute('aria-label', 'Chat');
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML = icon('chat', 24) + '<span class="ch-bubble-badge" hidden></span>';
      button.addEventListener('click', () =>
        floatUi && floatUi.isOpen() ? closePanel() : openInPanel(),
      );
      document.body.appendChild(button);
    }
    function unmountBubble() {
      closePanel();
      document.querySelector('.ch-bubble-btn')?.remove();
      document.querySelector('.ch-pop-stack')?.remove();
    }
    function closePanel() {
      if (!floatUi) return;
      floatUi.thread.stop();
      floatUi.wrap.remove();
      floatUi = null;
      const button = document.querySelector('.ch-bubble-btn');
      if (button) button.setAttribute('aria-expanded', 'false');
    }

    async function openInPanel(conversationId) {
      if (!floatUi) {
        const wrap = document.createElement('section');
        wrap.className = 'ch-float';
        wrap.setAttribute('aria-label', 'Chat');
        wrap.innerHTML =
          '<header class="ch-float-head"><b data-f-title>Chat</b><span class="ch-float-actions">' +
          '<button type="button" class="ch-iconbtn" data-f-full aria-label="Open the full Chat page" title="Open the full Chat page">' +
          icon('open') +
          '</button>' +
          (deps.popOut
            ? '<button type="button" class="ch-iconbtn" data-f-pop aria-label="Pop out into its own window" title="Pop out into its own window">' +
              icon('popout') +
              '</button>'
            : '') +
          '<button type="button" class="ch-iconbtn" data-f-close aria-label="Close chat">' +
          icon('close') +
          '</button></span></header>' +
          '<div class="ch-float-list" data-f-list></div><div class="ch-float-thread" data-f-thread hidden></div>';
        document.body.appendChild(wrap);
        const state = { wrap, me: null, active: null, isOpen: () => true };
        const thread = createThread(wrap.querySelector('[data-f-thread]'), {
          back: () => showList(),
          onSent: () => summary().catch(() => {}),
          onRead: () => summary().catch(() => {}),
        });
        state.thread = thread;
        floatUi = state;
        wrap.addEventListener('click', (event) => {
          const button = event.target.closest('button');
          if (!button) return;
          if (button.matches('[data-f-close]')) return closePanel();
          if (button.matches('[data-f-full]')) {
            const id = floatUi.active;
            closePanel();
            if (deps.showChatPage) deps.showChatPage(id);
            return;
          }
          if (button.matches('[data-f-pop]')) {
            const id = floatUi.active;
            closePanel();
            deps.popOut(id);
            return;
          }
          if (button.dataset.fOpen) return showThread(button.dataset.fOpen);
        });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape' && floatUi && !document.querySelector('.ch-modal-host'))
            closePanel();
        });
        const bubbleButton = document.querySelector('.ch-bubble-btn');
        if (bubbleButton) bubbleButton.setAttribute('aria-expanded', 'true');
      }
      if (conversationId) await showThread(conversationId);
      else await showList();
    }

    async function showList() {
      if (!floatUi) return;
      floatUi.active = null;
      floatUi.thread.stop();
      floatUi.wrap.querySelector('[data-f-thread]').hidden = true;
      const list = floatUi.wrap.querySelector('[data-f-list]');
      list.hidden = false;
      floatUi.wrap.querySelector('[data-f-title]').textContent = 'Chat';
      list.innerHTML = '<p class="ch-list-empty">Loading&hellip;</p>';
      try {
        const data = await api('/api/chat/conversations');
        if (!floatUi) return;
        floatUi.me = data.me;
        floatUi.thread.setMe(data.me.id);
        const rows = [...data.conversations]
          .sort(
            (a, b) =>
              (b.unread > 0) - (a.unread > 0) ||
              new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0),
          )
          .slice(0, 15);
        list.innerHTML = rows.length
          ? rows
              .map((c) => {
                const title = convTitle(c);
                return (
                  '<button type="button" class="ch-item' +
                  (c.unread > 0 ? ' unread' : '') +
                  '" data-f-open="' +
                  c.id +
                  '">' +
                  avatar(title, c.kind, '', c.otherProfileId) +
                  '<span class="ch-item-main"><span class="ch-item-top"><b class="ch-item-title">' +
                  esc(title) +
                  '</b><time>' +
                  esc(listTime(c.lastMessageAt)) +
                  '</time></span><span class="ch-item-bottom"><span class="ch-preview">' +
                  esc(c.lastBody || 'No messages yet') +
                  '</span>' +
                  (c.unread > 0
                    ? '<span class="ch-badges"><span class="ch-count' +
                      (c.muted ? ' muted' : '') +
                      '">' +
                      c.unread +
                      '</span></span>'
                    : '') +
                  '</span></span></button>'
                );
              })
              .join('')
          : '<p class="ch-list-empty">No conversations yet. Open the Chat page to start one.</p>';
        paintPresence();
      } catch (error) {
        list.innerHTML =
          '<p class="ch-list-empty">' + esc(error.message || 'Could not load chats.') + '</p>';
      }
    }

    async function showThread(id) {
      if (!floatUi) return;
      if (!floatUi.me) {
        try {
          const data = await api('/api/chat/conversations');
          floatUi.me = data.me;
          floatUi.thread.setMe(data.me.id);
        } catch {
          return;
        }
      }
      floatUi.active = String(id);
      floatUi.wrap.querySelector('[data-f-list]').hidden = true;
      floatUi.wrap.querySelector('[data-f-thread]').hidden = false;
      floatUi.wrap.querySelector('[data-f-title]').textContent = 'Chat';
      await floatUi.thread.show(String(id));
    }

    // ---- notification settings
    const supportsPush = () =>
      'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const keyBytes = (text) => {
      const pad = '='.repeat((4 - (text.length % 4)) % 4);
      const raw = atob((text + pad).replace(/-/g, '+').replace(/_/g, '/'));
      return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
    };
    async function pushSubscription() {
      if (!supportsPush()) return null;
      const reg = await navigator.serviceWorker.getRegistration('/portal/');
      return reg ? reg.pushManager.getSubscription() : null;
    }
    async function enablePush(publicKey) {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted')
        throw new Error('Notifications are blocked for this site in the browser.');
      const reg = await navigator.serviceWorker.register('/portal/sw.js', { scope: '/portal/' });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      const json = sub.toJSON();
      await api('/api/chat/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
    }
    async function disablePush() {
      const sub = await pushSubscription();
      if (!sub) return;
      await api('/api/chat/push/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe();
    }

    async function settingsModal() {
      let settings;
      try {
        settings = await api('/api/chat/settings');
      } catch (error) {
        return toast(error.message || 'Could not load settings.');
      }
      const canDesktop = 'Notification' in window;
      const subscribed = Boolean(await pushSubscription().catch(() => null));
      const permission = canDesktop ? Notification.permission : 'denied';
      const row = (title, text, control) =>
        '<div class="ch-setting"><div><b>' +
        title +
        '</b><p>' +
        text +
        '</p></div>' +
        control +
        '</div>';
      modal(
        '<header><h4>Notifications</h4><button type="button" class="ch-iconbtn" data-m-close aria-label="Close">' +
          icon('close') +
          '</button></header><div class="ch-modal-body">' +
          row(
            'Pop-ups on every page',
            'A small card appears in the corner when a message arrives and you are not looking at that conversation. Always on.',
            '<span class="ch-chip ch-chip-ok">On</span>',
          ) +
          row(
            'Desktop alerts',
            canDesktop
              ? permission === 'denied'
                ? 'Blocked in this browser. Allow notifications for this site in the browser settings to turn them on.'
                : 'Shows a system notification when this window is in the background.'
              : 'This browser does not support notifications.',
            canDesktop && permission !== 'denied'
              ? '<button type="button" class="ch-btn" data-s-desktop ' +
                  (permission === 'granted' ? 'disabled' : '') +
                  '>' +
                  (permission === 'granted' ? 'On' : 'Turn on') +
                  '</button>'
              : '',
          ) +
          row(
            'Alerts when the browser is closed',
            !settings.pushAvailable
              ? 'Not set up on the server yet. Ask your administrator to add the notification keys (VAPID).'
              : !supportsPush()
                ? 'This browser cannot do background alerts. On an iPhone, add the portal to the Home Screen first.'
                : 'Works for this browser on this device, even with the portal closed.',
            settings.pushAvailable && supportsPush()
              ? '<button type="button" class="ch-btn" data-s-push>' +
                  (subscribed ? 'Turn off' : 'Turn on') +
                  '</button>'
              : '',
          ) +
          row(
            'Email when you are mentioned',
            settings.emailAvailable
              ? 'Sent only if you have not read the message after a few minutes.'
              : 'Email is not set up on the server yet.',
            '<label class="ch-switch"><input type="checkbox" data-s-email ' +
              (settings.emailOnMention ? 'checked' : '') +
              (settings.emailAvailable ? '' : ' disabled') +
              '><span class="ch-sr">Email when mentioned</span></label>',
          ) +
          '<p class="ch-error" data-s-error role="alert" hidden></p></div>',
        (wrap) => {
          const errorEl = wrap.querySelector('[data-s-error]');
          const fail = (error) => {
            errorEl.textContent = error.message || 'That did not work.';
            errorEl.hidden = false;
          };
          wrap.addEventListener('click', async (event) => {
            const button = event.target.closest('button');
            if (!button) return;
            errorEl.hidden = true;
            try {
              if (button.matches('[data-s-desktop]')) {
                const result = await Notification.requestPermission();
                button.textContent = result === 'granted' ? 'On' : 'Blocked';
                button.disabled = true;
              } else if (button.matches('[data-s-push]')) {
                button.disabled = true;
                if (button.textContent === 'Turn off') {
                  await disablePush();
                  button.textContent = 'Turn on';
                } else {
                  await enablePush(settings.vapidPublicKey);
                  button.textContent = 'Turn off';
                }
                button.disabled = false;
              }
            } catch (error) {
              button.disabled = false;
              fail(error);
            }
          });
          wrap.querySelector('[data-s-email]').addEventListener('change', async (event) => {
            try {
              await api('/api/chat/settings', {
                method: 'PATCH',
                body: JSON.stringify({ emailOnMention: event.target.checked }),
              });
            } catch (error) {
              event.target.checked = !event.target.checked;
              fail(error);
            }
          });
        },
      );
    }

    if ('serviceWorker' in navigator)
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'open-chat' && event.data.conversationId)
          openAnywhere(event.data.conversationId);
      });

    // ================================================================== thread
    // One conversation: header, messages, composer. The Chat screen keeps one and
    // switches it; the record slide-over builds its own.
    function createThread(host, options) {
      const opts = options || {};
      const t = {
        id: null,
        info: null,
        me: opts.me,
        messages: [],
        lastId: '0',
        rev: '0',
        editing: null,
        timer: null,
        reply: null,
        flag: false,
        mentions: new Map(),
        stick: true,
        busy: false,
        pending: [],
        reads: [],
        typingTimer: null,
        lastTypingSent: 0,
        offs: [],
      };
      host.innerHTML =
        '<div class="ch-thread-head" data-th-head></div>' +
        '<div class="ch-scroll" data-th-scroll role="log" aria-live="polite" aria-label="Messages" tabindex="0"></div>' +
        '<button type="button" class="ch-jump" data-th-jump hidden>New messages ' +
        icon('back', 14) +
        '</button>' +
        '<p class="ch-typing" data-th-typing aria-live="polite" hidden></p>' +
        '<form class="ch-composer" data-th-form autocomplete="off">' +
        '<div class="ch-replybar" data-th-replybar hidden></div>' +
        '<p class="ch-error" data-th-error role="alert" hidden></p>' +
        '<div class="ch-mention-pop" data-th-pop role="listbox" aria-label="Mention someone" hidden></div>' +
        '<div class="ch-files" data-th-files hidden></div>' +
        '<div class="ch-compose-row">' +
        '<button type="button" class="ch-iconbtn ch-attach" data-th-attach aria-label="Attach a file or photo" title="Attach a file or photo">' +
        icon('clip', 18) +
        '</button>' +
        '<button type="button" class="ch-iconbtn ch-attach ch-camera" data-th-camera aria-label="Take a photo" title="Take a photo">' +
        icon('camera', 18) +
        '</button>' +
        '<input type="file" data-th-file hidden multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf">' +
        '<input type="file" data-th-photo hidden accept="image/*" capture="environment">' +
        '<textarea rows="1" maxlength="4000" data-th-input placeholder="Write a message" aria-label="Message"></textarea>' +
        '<button type="button" class="ch-flagbtn" data-th-flag aria-pressed="false" title="Ask for a reply: it stays flagged until answered">' +
        icon('flag', 16) +
        '<span>Needs reply</span></button>' +
        '<button type="submit" class="ch-send" data-th-send aria-label="Send message">' +
        icon('send', 18) +
        '</button></div>' +
        '<p class="ch-hint">Enter to send &middot; Shift+Enter for a new line &middot; @ to mention</p>' +
        '</form>';
      host.classList.add('ch-thread');
      const q = (sel) => host.querySelector(sel);
      const scroll = q('[data-th-scroll]');
      const input = q('[data-th-input]');
      const pop = q('[data-th-pop]');
      const errorEl = q('[data-th-error]');

      const people = () => (t.info ? t.info.people : []);
      const showError = (text) => {
        errorEl.textContent = text || '';
        errorEl.hidden = !text;
      };

      function headHtml() {
        const c = t.info.conversation;
        const title = convTitle({
          kind: c.kind,
          title: c.title,
          otherName: (t.info.people[0] || {}).name,
          recordLabel: c.recordLabel,
          recordType: c.recordType,
          recordId: c.recordId,
        });
        const other = c.kind === 'direct' ? t.info.people[0] : null;
        const sub =
          c.kind === 'direct' && other && live.online.has(String(other.id))
            ? 'Online'
            : c.kind === 'record'
              ? (RECORD_LABELS[c.recordType] || 'Record') +
                ' thread, shared with anyone who can open it'
              : c.kind === 'channel'
                ? t.info.members.length + ' member' + (t.info.members.length === 1 ? '' : 's')
                : 'Direct message';
        const muted = Boolean(t.muted);
        return (
          (opts.back
            ? '<button type="button" class="ch-iconbtn ch-back" data-th-back aria-label="Back to conversations">' +
              icon('back') +
              '</button>'
            : '') +
          avatar(title, c.kind, '', other ? other.id : '') +
          '<div class="ch-head-text"><h3>' +
          esc(title) +
          '</h3><p>' +
          esc(sub) +
          '</p></div><div class="ch-head-actions">' +
          (c.kind === 'record' && deps.goToRecord
            ? '<button type="button" class="ch-iconbtn" data-th-record aria-label="Open the record" title="Open the record">' +
              icon('open') +
              '</button>'
            : '') +
          '<button type="button" class="ch-iconbtn" data-th-pins aria-label="Pinned messages" title="Pinned messages">' +
          icon('pin') +
          '</button>' +
          (c.kind === 'channel'
            ? '<button type="button" class="ch-iconbtn" data-th-members aria-label="Members" title="Members">' +
              icon('users') +
              '</button>'
            : '') +
          '<button type="button" class="ch-iconbtn" data-th-mute aria-pressed="' +
          muted +
          '" aria-label="' +
          (muted ? 'Unmute' : 'Mute') +
          ' notifications" title="' +
          (muted ? 'Unmute' : 'Mute') +
          ' notifications">' +
          icon(muted ? 'bellOff' : 'bell') +
          '</button>' +
          (opts.close
            ? '<button type="button" class="ch-iconbtn" data-th-close aria-label="Close">' +
              icon('close') +
              '</button>'
            : '') +
          '</div>'
        );
      }

      const sizeLabel = (bytes) =>
        bytes >= 1048576
          ? (bytes / 1048576).toFixed(1) + ' MB'
          : Math.max(1, Math.round(bytes / 1024)) + ' KB';
      function attachmentsHtml(m) {
        if (!m.attachments || !m.attachments.length) return '';
        return (
          '<div class="ch-files-grid">' +
          m.attachments
            .map((f) =>
              /^image\//.test(f.contentType) && f.contentType !== 'image/heic'
                ? '<a class="ch-photo" href="' +
                  esc(f.url) +
                  '" target="_blank" rel="noopener noreferrer" title="' +
                  esc(f.fileName) +
                  '"><img src="' +
                  esc(f.url) +
                  '" alt="' +
                  esc(f.fileName) +
                  '" loading="lazy"></a>'
                : '<a class="ch-filechip" href="' +
                  esc(f.url) +
                  '" target="_blank" rel="noopener noreferrer">' +
                  icon('file', 16) +
                  '<span>' +
                  esc(f.fileName) +
                  '</span><small>' +
                  sizeLabel(f.sizeBytes) +
                  '</small></a>',
            )
            .join('') +
          '</div>'
        );
      }

      function reactionsHtml(m) {
        if (!m.reactions || !m.reactions.length) return '';
        return (
          '<div class="ch-reactions">' +
          m.reactions
            .map((r) => {
              const mineR = r.profileIds.includes(String(t.me));
              return (
                '<button type="button" class="ch-react' +
                (mineR ? ' ch-react-mine' : '') +
                '" data-th-chip="' +
                m.id +
                '" data-emoji="' +
                esc(r.emoji) +
                '" title="' +
                esc(r.names.join(', ')) +
                '" aria-pressed="' +
                mineR +
                '"><span>' +
                esc(r.emoji) +
                '</span>' +
                r.profileIds.length +
                '</button>'
              );
            })
            .join('') +
          '</div>'
        );
      }

      function messageHtml(m, prev) {
        const mine = String(m.senderId) === String(t.me);
        const group =
          prev &&
          prev.senderId === m.senderId &&
          dayKey(prev.createdAt) === dayKey(m.createdAt) &&
          new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60000;
        const open = m.needsReply && !m.answeredAt;
        const showName = !mine && !group && t.info.conversation.kind !== 'direct';
        return (
          (!prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)
            ? '<div class="ch-day"><span>' + esc(dayLabel(m.createdAt)) + '</span></div>'
            : '') +
          '<article class="ch-msg' +
          (mine ? ' ch-mine' : '') +
          (group ? ' ch-grouped' : '') +
          (open ? ' ch-open-reply' : '') +
          '" data-mid="' +
          m.id +
          '">' +
          (!mine
            ? group
              ? '<span class="ch-av-gap"></span>'
              : avatar(m.senderName, 'direct', 'ch-av-sm', m.senderId)
            : '') +
          '<div class="ch-bubble">' +
          (showName ? '<b class="ch-sender">' + esc(m.senderName) + '</b>' : '') +
          (m.replyTo
            ? '<blockquote class="ch-quote"><b>' +
              esc(m.replyTo.senderName) +
              '</b><span>' +
              esc(m.replyTo.body) +
              '</span></blockquote>'
            : '') +
          (m.deleted
            ? '<div class="ch-text ch-deleted">' +
              icon('trash', 13) +
              'This message was deleted</div>'
            : '<div class="ch-text">' + bodyHtml(m) + '</div>') +
          attachmentsHtml(m) +
          reactionsHtml(m) +
          '<div class="ch-meta">' +
          (m.pinned
            ? '<span class="ch-chip ch-chip-pin">' + icon('pin', 12) + 'Pinned</span>'
            : '') +
          (m.needsReply
            ? m.answeredAt
              ? '<span class="ch-chip ch-chip-ok">' +
                icon('check', 12) +
                'Answered' +
                (m.answeredByName ? ' by ' + esc(m.answeredByName) : '') +
                '</span>'
              : '<span class="ch-chip ch-chip-warn">' + icon('flag', 12) + 'Needs reply</span>'
            : '') +
          '<span class="ch-msg-actions">' +
          (m.deleted
            ? ''
            : '<button type="button" class="ch-mini" data-th-reply="' +
              m.id +
              '" aria-label="Reply to this message">Reply</button>' +
              '<button type="button" class="ch-mini" data-th-react="' +
              m.id +
              '" aria-label="Add a reaction">React</button>' +
              '<button type="button" class="ch-mini" data-th-pin="' +
              m.id +
              '">' +
              (m.pinned ? 'Unpin' : 'Pin') +
              '</button>' +
              (mine
                ? '<button type="button" class="ch-mini" data-th-edit="' + m.id + '">Edit</button>'
                : '') +
              (mine || deps.can('chat.moderate')
                ? '<button type="button" class="ch-mini ch-mini-danger" data-th-delete="' +
                  m.id +
                  '">Delete</button>'
                : '')) +
          (open && !mine && !m.deleted
            ? '<button type="button" class="ch-mini" data-th-answer="' +
              m.id +
              '">Mark answered</button>'
            : '') +
          '</span>' +
          (m.editedAt && !m.deleted ? '<span class="ch-edited">edited</span>' : '') +
          (mine && !m.deleted ? '<span class="ch-tick" data-tick="' + m.id + '"></span>' : '') +
          '<time datetime="' +
          esc(new Date(m.createdAt).toISOString()) +
          '">' +
          esc(timeFmt.format(new Date(m.createdAt))) +
          '</time></div></div></article>'
        );
      }

      function paint(full) {
        if (!t.info) return;
        if (full) {
          scroll.innerHTML = t.messages.length
            ? t.messages.map((m, i) => messageHtml(m, t.messages[i - 1])).join('')
            : '<div class="ch-empty-thread">' +
              icon('chat', 28) +
              '<p>No messages yet. Say hello' +
              (t.info.conversation.kind === 'record' ? ' and keep the job details here.' : '.') +
              '</p></div>';
        }
        paintTicks();
        paintPresence();
      }
      function appendMessages(list) {
        if (!list.length) return;
        const empty = scroll.querySelector('.ch-empty-thread');
        if (empty) empty.remove();
        const before = t.messages.length;
        t.messages.push(...list);
        scroll.insertAdjacentHTML(
          'beforeend',
          list.map((m, i) => messageHtml(m, t.messages[before + i - 1])).join(''),
        );
      }
      function scrollBottom() {
        scroll.scrollTop = scroll.scrollHeight;
      }
      const nearBottom = () => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;

      async function markRead() {
        const last = t.messages[t.messages.length - 1];
        if (!last || document.visibilityState === 'hidden' || t.id === null) return;
        if (t.readUpTo === last.id) return;
        t.readUpTo = last.id;
        try {
          await api('/api/chat/conversations/' + t.id + '/read', {
            method: 'POST',
            body: JSON.stringify({ messageId: last.id }),
          });
          if (opts.onRead) opts.onRead();
        } catch {
          /* retried on the next poll */
        }
      }

      // Sent / seen ticks on my own messages, from each follower's read position.
      function paintTicks() {
        const others = t.reads.filter((r) => String(r.profileId) !== String(t.me));
        scroll.querySelectorAll('[data-tick]').forEach((el) => {
          const id = BigInt(el.dataset.tick);
          const seen = others.filter(
            (r) => r.lastReadMessageId && BigInt(r.lastReadMessageId) >= id,
          );
          el.className = 'ch-tick' + (seen.length ? ' seen' : '');
          el.title = seen.length ? 'Seen by ' + seen.map((r) => r.name).join(', ') : 'Sent';
          el.innerHTML = icon('check', 12) + (seen.length ? icon('check', 12) : '');
        });
      }
      async function loadReads() {
        try {
          t.reads = (await api('/api/chat/conversations/' + t.id + '/reads')).reads;
          paintTicks();
        } catch {
          /* ticks are optional */
        }
      }
      const typingEl = q('[data-th-typing]');
      const typers = new Map();
      function paintTyping() {
        const names = [...typers.values()].map((x) => x.name.split(' ')[0]);
        typingEl.hidden = !names.length;
        typingEl.textContent = names.length
          ? names.join(', ') + (names.length === 1 ? ' is typing\u2026' : ' are typing\u2026')
          : '';
      }
      function someoneTyping(data) {
        const id = String(data.profileId);
        const old = typers.get(id);
        if (old) window.clearTimeout(old.timer);
        typers.set(id, {
          name: data.name,
          timer: window.setTimeout(() => {
            typers.delete(id);
            paintTyping();
          }, 5000),
        });
        paintTyping();
      }
      const maxRev = (list) =>
        list.reduce((hi, m) => (BigInt(m.rev) > BigInt(hi) ? m.rev : hi), '0');
      // Replace (or append) one message in the view, keeping the scroll position.
      function applyMessage(m) {
        const i = t.messages.findIndex((x) => x.id === m.id);
        if (BigInt(m.rev) > BigInt(t.rev)) t.rev = m.rev;
        if (i === -1) {
          t.messages.push(m);
          t.messages.sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1));
          t.lastId = t.messages[t.messages.length - 1].id;
          const empty = scroll.querySelector('.ch-empty-thread');
          if (empty) empty.remove();
          const at = t.messages.indexOf(m);
          if (at === t.messages.length - 1)
            scroll.insertAdjacentHTML('beforeend', messageHtml(m, t.messages[at - 1]));
          else paint(true);
          paintTicks();
          paintPresence();
          return true;
        }
        t.messages[i] = m;
        const node = scroll.querySelector('[data-mid="' + m.id + '"]');
        if (node) {
          const tmp = document.createElement('div');
          tmp.innerHTML = messageHtml(m, t.messages[i - 1]);
          const article = tmp.querySelector('article');
          if (article) node.replaceWith(article);
        }
        paintTicks();
        return false;
      }

      // One cheap call returns new messages and changes (edits, deletes, reactions, pins,
      // answered flags) to ones already on screen.
      async function poll() {
        if (t.id === null || !host.isConnected || document.visibilityState === 'hidden') return;
        try {
          const data = await api(
            '/api/chat/conversations/' + t.id + '/messages?sinceRev=' + t.rev + '&limit=100',
          );
          if (!data.messages.length) return;
          const stick = nearBottom();
          let added = false;
          for (const m of data.messages) added = applyMessage(m) || added;
          if (added) {
            if (stick) scrollBottom();
            else q('[data-th-jump]').hidden = false;
            await markRead();
          }
        } catch (error) {
          if (error.status === 404) stop();
        }
      }
      const refreshStates = poll;
      function stop() {
        if (t.timer) window.clearInterval(t.timer);
        t.timer = null;
        t.offs.forEach((off) => off());
        t.offs = [];
        for (const x of typers.values()) window.clearTimeout(x.timer);
        typers.clear();
        paintTyping();
      }

      async function show(id, extra) {
        stop();
        t.id = id;
        t.info = null;
        t.messages = [];
        t.lastId = '0';
        t.rev = '0';
        t.editing = null;
        t.reads = [];
        t.readUpTo = null;
        t.reply = null;
        t.flag = false;
        t.pending = [];
        paintPending();
        t.mentions.clear();
        t.muted = Boolean(extra && extra.muted);
        input.value = '';
        input.style.height = '';
        showError('');
        q('[data-th-replybar]').hidden = true;
        q('[data-th-flag]').setAttribute('aria-pressed', 'false');
        q('[data-th-jump]').hidden = true;
        scroll.innerHTML = '<p class="ch-loading">Loading&hellip;</p>';
        try {
          const [info, data] = await Promise.all([
            api('/api/chat/conversations/' + id),
            api(
              '/api/chat/conversations/' +
                id +
                '/messages?limit=60' +
                (extra && extra.focus ? '&around=' + encodeURIComponent(extra.focus) : ''),
            ),
          ]);
          if (t.id !== id) return;
          t.info = info;
          t.messages = data.messages;
          t.lastId = t.messages.length ? t.messages[t.messages.length - 1].id : '0';
          t.rev = maxRev(t.messages);
          if (extra && extra.focus) {
            const latest = await api('/api/chat/conversations/' + id + '/messages?limit=1');
            t.rev = maxRev([...t.messages, ...latest.messages]);
          }
          q('[data-th-head]').innerHTML = headHtml();
          paint(true);
          const focused =
            extra && extra.focus && scroll.querySelector('[data-mid="' + extra.focus + '"]');
          if (focused) {
            focused.scrollIntoView({ block: 'center' });
            focused.classList.add('ch-flash');
          } else scrollBottom();
          await markRead();
          let beat = 0;
          t.timer = window.setInterval(() => {
            if (!live.connected || ++beat % 5 === 0) poll();
          }, 4000);
          const mine = (data) => String(data.conversationId) === String(t.id);
          t.offs = [
            bus.on('message', (d) => mine(d) && poll()),
            bus.on('change', (d) => mine(d) && poll()),
            bus.on('typing', (d) => mine(d) && someoneTyping(d)),
            bus.on('read', (d) => {
              if (!mine(d)) return;
              const row = t.reads.find((r) => String(r.profileId) === String(d.profileId));
              if (row) row.lastReadMessageId = d.messageId;
              else loadReads();
              paintTicks();
            }),
            bus.on('presence', () => {
              if (t.info && t.info.conversation.kind === 'direct')
                q('[data-th-head]').innerHTML = headHtml();
            }),
            bus.on('resync', () => {
              poll();
              loadReads();
            }),
          ];
          loadReads();
          if (!window.matchMedia('(pointer: coarse)').matches) input.focus();
        } catch (error) {
          scroll.innerHTML =
            '<p class="ch-loading">' +
            esc(error.message || 'Could not open this conversation.') +
            '</p>';
        }
      }

      // ---- attachments
      const filesEl = q('[data-th-files]');
      function paintPending() {
        filesEl.hidden = !t.pending.length;
        filesEl.innerHTML = t.pending
          .map(
            (f) =>
              '<span class="ch-pending' +
              (f.error ? ' ch-pending-error' : '') +
              '">' +
              icon(/^image\//.test(f.type) ? 'camera' : 'file', 14) +
              '<span class="ch-pending-name">' +
              esc(f.name) +
              '</span><small>' +
              (f.error ? esc(f.error) : f.att ? sizeLabel(f.size) : 'Uploading\u2026') +
              '</small><button type="button" class="ch-iconbtn" data-th-unfile="' +
              f.key +
              '" aria-label="Remove ' +
              esc(f.name) +
              '">' +
              icon('close', 12) +
              '</button></span>',
          )
          .join('');
      }
      // Phone photos are large; shrink big JPEG/PNG/WebP before sending to save mobile data.
      async function shrink(file) {
        if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1500000) return file;
        try {
          const bitmap = await createImageBitmap(file);
          const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(bitmap.width * scale);
          canvas.height = Math.round(bitmap.height * scale);
          canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
          if (!blob || blob.size >= file.size) return file;
          return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', {
            type: 'image/jpeg',
          });
        } catch {
          return file;
        }
      }
      let fileKey = 0;
      async function addFiles(list) {
        if (t.id === null || !t.info) return;
        for (const original of [...list].slice(0, 10 - t.pending.length)) {
          const entry = {
            key: ++fileKey,
            name: original.name || 'photo.jpg',
            type: original.type,
            size: original.size,
            att: null,
            error: '',
          };
          t.pending.push(entry);
          paintPending();
          (async () => {
            try {
              const file = await shrink(original);
              entry.size = file.size;
              entry.type = file.type;
              const form = new FormData();
              form.append('file', file, file.name || entry.name);
              const data = await (deps.apiUpload || api)(
                '/api/chat/conversations/' + t.id + '/attachments',
                form,
              );
              entry.att = data.attachment;
            } catch (error) {
              entry.error = error.message || 'Upload failed';
            }
            paintPending();
          })();
        }
      }

      async function toggleReaction(id, emoji) {
        try {
          const data = await api('/api/chat/messages/' + id + '/reactions', {
            method: 'POST',
            body: JSON.stringify({ emoji }),
          });
          applyMessage(data.message);
        } catch (error) {
          showError(error.message || 'Could not add the reaction.');
        }
      }

      async function showPins() {
        try {
          const data = await api('/api/chat/conversations/' + t.id + '/pins');
          modal(
            '<div class="ch-modal-head"><h3>Pinned messages</h3><button type="button" class="ch-iconbtn" data-m-close aria-label="Close">' +
              icon('close') +
              '</button></div><div class="ch-pinlist">' +
              (data.messages.length
                ? data.messages
                    .map(
                      (m) =>
                        '<button type="button" class="ch-pinitem" data-pin-go="' +
                        m.id +
                        '"><b>' +
                        esc(m.senderName) +
                        '</b><span>' +
                        esc(m.body.slice(0, 200)) +
                        '</span><time>' +
                        esc(listTime(m.createdAt)) +
                        '</time></button>',
                    )
                    .join('')
                : '<p class="ch-empty-note">Nothing pinned yet. Use Pin on a message to keep it handy.</p>') +
              '</div>',
            (wrap, close) => {
              wrap.addEventListener('click', (e) => {
                const go = e.target.closest('[data-pin-go]');
                if (!go) return;
                close();
                show(t.id, { muted: t.muted, focus: go.dataset.pinGo });
              });
            },
          );
        } catch (error) {
          showError(error.message || 'Could not load pinned messages.');
        }
      }

      // ---- composer
      function setEdit(message) {
        t.editing = message || null;
        if (message) {
          setReply(null);
          input.value = message.body;
          for (const person of message.mentions || []) t.mentions.set(person.name, person.id);
          const bar = q('[data-th-replybar]');
          bar.hidden = false;
          bar.innerHTML =
            icon('edit', 14) +
            '<span>Editing your message</span><button type="button" class="ch-iconbtn" data-th-unedit aria-label="Cancel editing">' +
            icon('close', 14) +
            '</button>';
          autosize();
          input.focus();
        } else {
          q('[data-th-replybar]').hidden = true;
        }
      }

      function setReply(message) {
        t.reply = message || null;
        if (message && t.editing) {
          t.editing = null;
          input.value = '';
        }
        const bar = q('[data-th-replybar]');
        bar.hidden = !message;
        bar.innerHTML = message
          ? icon('reply', 14) +
            '<span>Replying to <b>' +
            esc(message.senderName) +
            '</b>: ' +
            esc(message.body.slice(0, 90)) +
            '</span><button type="button" class="ch-iconbtn" data-th-unreply aria-label="Cancel reply">' +
            icon('close', 14) +
            '</button>'
          : '';
        if (message) input.focus();
      }
      function autosize() {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 140) + 'px';
      }
      function mentionQuery() {
        const upto = input.value.slice(0, input.selectionStart);
        const match = /(^|\s)@([^\s@]{0,30})$/.exec(upto);
        return match
          ? { query: match[2].toLowerCase(), start: upto.length - match[2].length - 1 }
          : null;
      }
      let popItems = [];
      let popIndex = 0;
      function closePop() {
        pop.hidden = true;
        popItems = [];
      }
      function renderPop() {
        pop.innerHTML = popItems
          .map(
            (p, i) =>
              '<button type="button" role="option" class="ch-pop-item' +
              (i === popIndex ? ' active' : '') +
              '" data-th-pick="' +
              i +
              '" aria-selected="' +
              (i === popIndex) +
              '">' +
              avatar(p.name, 'direct', 'ch-av-sm') +
              '<span>' +
              esc(p.name) +
              '</span></button>',
          )
          .join('');
        pop.hidden = !popItems.length;
      }
      function updatePop() {
        const m = mentionQuery();
        if (!m || t.info === null) return closePop();
        popItems = people()
          .filter((p) => p.name.toLowerCase().includes(m.query))
          .slice(0, 6);
        popIndex = 0;
        renderPop();
      }
      function pick(index) {
        const person = popItems[index];
        const m = mentionQuery();
        if (!person || !m) return;
        const after = input.value.slice(input.selectionStart);
        input.value = input.value.slice(0, m.start) + '@' + person.name + ' ' + after;
        const caret = m.start + person.name.length + 2;
        input.setSelectionRange(caret, caret);
        t.mentions.set(person.name, person.id);
        closePop();
        input.focus();
        autosize();
      }

      async function send() {
        if (t.busy || t.id === null || !t.info) return;
        const body = input.value.trim();
        const ready = t.pending.filter((f) => f.att);
        if (t.pending.some((f) => !f.att && !f.error))
          return showError('Wait for the upload to finish.');
        if (!body && !ready.length) return;
        if (t.editing && !body) return;
        t.busy = true;
        showError('');
        const sendBtn = q('[data-th-send]');
        sendBtn.disabled = true;
        const mentionIds = [...t.mentions.entries()]
          .filter(([name]) => body.includes('@' + name))
          .map(([, id]) => id);
        try {
          if (t.editing) {
            const edited = await api('/api/chat/messages/' + t.editing.id, {
              method: 'PATCH',
              body: JSON.stringify({ body, mentionIds }),
            });
            applyMessage(edited.message);
            setEdit(null);
            input.value = '';
            autosize();
            t.mentions.clear();
            return;
          }
          const data = await api('/api/chat/conversations/' + t.id + '/messages', {
            method: 'POST',
            body: JSON.stringify({
              body,
              replyToId: t.reply ? t.reply.id : null,
              needsReply: t.flag,
              mentionIds,
              attachmentIds: ready.map((f) => f.att.id),
            }),
          });
          input.value = '';
          autosize();
          t.mentions.clear();
          t.pending = [];
          paintPending();
          setReply(null);
          t.flag = false;
          q('[data-th-flag]').setAttribute('aria-pressed', 'false');
          if (!t.messages.some((m) => m.id === data.message.id)) applyMessage(data.message);
          scrollBottom();
          q('[data-th-jump]').hidden = true;
          t.readUpTo = data.message.id;
          if (opts.onSent) opts.onSent();
        } catch (error) {
          showError(error.message || 'The message was not sent.');
        } finally {
          t.busy = false;
          sendBtn.disabled = false;
          input.focus();
        }
      }

      input.addEventListener('input', () => {
        autosize();
        updatePop();
        if (input.value.trim() && t.id !== null && Date.now() - t.lastTypingSent > 3000) {
          t.lastTypingSent = Date.now();
          api('/api/chat/conversations/' + t.id + '/typing', { method: 'POST' }).catch(() => {});
        }
      });
      input.addEventListener('keydown', (event) => {
        if (!pop.hidden && popItems.length) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            popIndex =
              (popIndex + (event.key === 'ArrowDown' ? 1 : popItems.length - 1)) % popItems.length;
            return renderPop();
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            return pick(popIndex);
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            return closePop();
          }
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          send();
        }
      });
      host.addEventListener('submit', (event) => {
        event.preventDefault();
        send();
      });
      host.addEventListener('change', (event) => {
        const el = event.target;
        if (el.matches('[data-th-file], [data-th-photo]')) {
          addFiles(el.files);
          el.value = '';
        }
      });
      input.addEventListener('paste', (event) => {
        const files = [...(event.clipboardData ? event.clipboardData.files : [])];
        if (files.length) {
          event.preventDefault();
          addFiles(files);
        }
      });
      host.addEventListener('dragover', (event) => event.preventDefault());
      host.addEventListener('drop', (event) => {
        if (event.dataTransfer && event.dataTransfer.files.length) {
          event.preventDefault();
          addFiles(event.dataTransfer.files);
        }
      });
      scroll.addEventListener('scroll', () => {
        if (nearBottom()) q('[data-th-jump]').hidden = true;
      });
      host.addEventListener('click', async (event) => {
        const target = event.target.closest('button');
        if (!target) return;
        if (target.dataset.thPick !== undefined) return pick(Number(target.dataset.thPick));
        if (target.matches('[data-th-jump]')) {
          scrollBottom();
          target.hidden = true;
          return;
        }
        if (target.matches('[data-th-flag]')) {
          t.flag = !t.flag;
          target.setAttribute('aria-pressed', String(t.flag));
          return;
        }
        if (target.matches('[data-th-unreply]')) return setReply(null);
        if (target.matches('[data-th-attach]')) return q('[data-th-file]').click();
        if (target.matches('[data-th-camera]')) return q('[data-th-photo]').click();
        if (target.dataset.thUnfile) {
          t.pending = t.pending.filter((f) => String(f.key) !== target.dataset.thUnfile);
          return paintPending();
        }
        if (target.matches('[data-th-unedit]')) {
          input.value = '';
          autosize();
          return setEdit(null);
        }
        if (target.matches('[data-th-pins]')) return showPins();
        if (target.dataset.thEmoji) {
          const holder = target.closest('[data-mid]');
          const pop = target.closest('.ch-emoji-pop');
          if (pop) pop.remove();
          return toggleReaction(holder.dataset.mid, target.dataset.thEmoji);
        }
        if (target.dataset.thChip)
          return toggleReaction(target.dataset.thChip, target.dataset.emoji);
        if (target.dataset.thReact) {
          const holder = target.closest('.ch-bubble');
          const existing = holder.querySelector('.ch-emoji-pop');
          if (existing) return existing.remove();
          holder.insertAdjacentHTML(
            'beforeend',
            '<div class="ch-emoji-pop" role="menu" aria-label="Choose a reaction">' +
              ['👍', '✅', '👀', '❤️', '😂', '🙏']
                .map(
                  (e) =>
                    '<button type="button" role="menuitem" data-th-emoji="' +
                    e +
                    '">' +
                    e +
                    '</button>',
                )
                .join('') +
              '</div>',
          );
          return;
        }
        if (target.dataset.thEdit) {
          return setEdit(t.messages.find((m) => m.id === target.dataset.thEdit));
        }
        if (target.dataset.thPin) {
          const message = t.messages.find((m) => m.id === target.dataset.thPin);
          try {
            const data = await api('/api/chat/messages/' + message.id + '/pin', {
              method: 'POST',
              body: JSON.stringify({ pinned: !message.pinned }),
            });
            applyMessage(data.message);
          } catch (error) {
            showError(error.message || 'Could not pin the message.');
          }
          return;
        }
        if (target.dataset.thDelete) {
          if (
            !window.confirm(
              'Delete this message for everyone? The conversation will show that it was deleted.',
            )
          )
            return;
          try {
            const data = await api('/api/chat/messages/' + target.dataset.thDelete, {
              method: 'DELETE',
            });
            applyMessage(data.message);
            if (t.editing && t.editing.id === data.message.id) setEdit(null);
          } catch (error) {
            showError(error.message || 'Could not delete the message.');
          }
          return;
        }
        if (target.matches('[data-th-back]') && opts.back) return opts.back();
        if (target.matches('[data-th-close]') && opts.close) return opts.close();
        if (target.matches('[data-th-record]') && deps.goToRecord) {
          const c = t.info.conversation;
          return deps.goToRecord(c.recordType, c.recordId);
        }
        if (target.dataset.thReply) {
          const message = t.messages.find((m) => m.id === target.dataset.thReply);
          return setReply(message);
        }
        if (target.dataset.thAnswer) {
          try {
            await api('/api/chat/messages/' + target.dataset.thAnswer + '/answered', {
              method: 'POST',
            });
            await refreshStates();
            if (opts.onRead) opts.onRead();
          } catch (error) {
            showError(error.message || 'Could not update the message.');
          }
          return;
        }
        if (target.matches('[data-th-mute]')) {
          const next = !t.muted;
          try {
            await api('/api/chat/conversations/' + t.id, {
              method: 'PATCH',
              body: JSON.stringify({ muted: next }),
            });
            t.muted = next;
            q('[data-th-head]').innerHTML = headHtml();
            if (opts.onRead) opts.onRead();
          } catch (error) {
            showError(error.message || 'Could not change this setting.');
          }
          return;
        }
        if (target.matches('[data-th-members]') && opts.members) return opts.members(t.info);
      });

      const handle = {
        viewing: () => t.id !== null && host.isConnected && host.getClientRects().length > 0,
        show,
        stop,
        setMe: (id) => (t.me = id),
        get id() {
          return t.id;
        },
        focus: () => input.focus(),
      };
      threadsOpen.add(handle);
      return handle;
    }

    // ============================================================ chat screen
    function modal(html, onMount) {
      const wrap = document.createElement('div');
      wrap.className = 'ch-modal-host';
      wrap.innerHTML =
        '<div class="ch-backdrop" data-m-close></div><div class="ch-modal" role="dialog" aria-modal="true">' +
        html +
        '</div>';
      document.body.appendChild(wrap);
      const close = () => {
        wrap.remove();
        document.removeEventListener('keydown', onKey);
      };
      const onKey = (e) => e.key === 'Escape' && close();
      document.addEventListener('keydown', onKey);
      wrap.addEventListener('click', (e) => {
        if (e.target.closest('[data-m-close]')) close();
      });
      onMount(wrap, close);
      return close;
    }

    async function renderPage(root) {
      if (page && page.destroy) page.destroy();
      root.innerHTML = '<p class="form-note">Loading chat&hellip;</p>';
      const st = {
        me: null,
        convs: [],
        filter: 'all',
        search: '',
        hits: [],
        active: null,
        people: null,
        timer: null,
      };
      root.innerHTML =
        '<div class="ch-app" data-ch-app data-view="list">' +
        '<aside class="ch-side" aria-label="Conversations">' +
        '<div class="ch-side-head"><h3>Messages</h3><div class="ch-side-actions">' +
        '<button type="button" class="ch-btn ch-btn-primary" data-ch-new>' +
        icon('plus', 16) +
        'New chat</button>' +
        (deps.popOut && !document.body.classList.contains('chat-popout')
          ? '<button type="button" class="ch-iconbtn" data-ch-popout aria-label="Pop out into its own window" title="Pop out into its own window">' +
            icon('popout') +
            '</button>'
          : '') +
        '<button type="button" class="ch-iconbtn" data-ch-settings aria-label="Notification settings" title="Notification settings">' +
        icon('bell') +
        '</button>' +
        (deps.can('chat.create_channel')
          ? '<button type="button" class="ch-iconbtn" data-ch-channel aria-label="New channel" title="New channel">' +
            icon('hash') +
            '</button>'
          : '') +
        '</div></div>' +
        '<label class="ch-search">' +
        icon('search', 16) +
        '<span class="ch-sr">Search chats and messages</span><input type="search" data-ch-search placeholder="Search chats and messages" autocomplete="off"></label>' +
        '<div class="ch-filters" role="tablist" aria-label="Filter">' +
        [
          ['all', 'All'],
          ['unread', 'Unread'],
          ['mentions', 'Mentions'],
          ['reply', 'To reply'],
          ['record', 'Records'],
        ]
          .map(
            ([id, label]) =>
              '<button type="button" role="tab" data-ch-filter="' + id + '">' + label + '</button>',
          )
          .join('') +
        '</div><div class="ch-list" data-ch-list></div></aside>' +
        '<section class="ch-main" data-ch-main>' +
        '<div class="ch-placeholder" data-ch-placeholder>' +
        icon('chat', 36) +
        '<h4>Select a conversation</h4><p>Pick someone from the list, start a new chat, or open the Discuss button on a job card to talk about that job.</p></div>' +
        '<div class="ch-thread-host" data-ch-thread hidden></div></section></div>';
      const app = root.querySelector('[data-ch-app]');
      const listEl = root.querySelector('[data-ch-list]');
      const threadHost = root.querySelector('[data-ch-thread]');
      const placeholder = root.querySelector('[data-ch-placeholder]');

      const thread = createThread(threadHost, {
        me: null,
        back: () => {
          app.dataset.view = 'list';
        },
        onSent: () => loadList(),
        onRead: () => loadList(),
        members: (info) => membersModal(info),
      });

      function matches(c) {
        if (st.filter === 'unread' && !(c.unread > 0)) return false;
        if (st.filter === 'mentions' && !(c.mentionsUnread > 0)) return false;
        if (st.filter === 'reply' && !(c.needsReplyOpen > 0)) return false;
        if (st.filter === 'record' && c.kind !== 'record') return false;
        const needle = st.search.trim().toLowerCase();
        return (
          !needle ||
          convTitle(c).toLowerCase().includes(needle) ||
          (c.lastBody || '').toLowerCase().includes(needle)
        );
      }

      function paintList() {
        root.querySelectorAll('[data-ch-filter]').forEach((b) => {
          const on = b.dataset.chFilter === st.filter;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', String(on));
        });
        const rows = st.convs.filter(matches);
        const hitsHtml =
          st.search.trim().length >= 2 && st.hits.length
            ? '<h5 class="ch-list-heading">Messages</h5>' +
              st.hits
                .map(
                  (h) =>
                    '<button type="button" class="ch-hit" data-ch-hit="' +
                    h.conversationId +
                    '" data-ch-msg="' +
                    h.messageId +
                    '"><span class="ch-hit-top"><b>' +
                    esc(
                      convTitle({
                        kind: h.kind,
                        title: h.title,
                        otherName: h.otherName,
                        recordType: h.recordType,
                        recordId: h.recordId,
                      }),
                    ) +
                    '</b><time>' +
                    esc(listTime(h.createdAt)) +
                    '</time></span><span class="ch-hit-body">' +
                    esc(h.senderName.split(' ')[0]) +
                    ': ' +
                    esc(h.body.slice(0, 140)) +
                    '</span></button>',
                )
                .join('')
            : '';
        if (!rows.length) {
          listEl.innerHTML =
            (hitsHtml
              ? ''
              : '<div class="ch-list-empty">' +
                (st.convs.length
                  ? 'Nothing matches this filter.'
                  : 'No conversations yet. Start a new chat, or use Discuss on a job card.') +
                '</div>') + hitsHtml;
          return;
        }
        listEl.innerHTML =
          rows
            .map((c) => {
              const title = convTitle(c);
              const preview = c.lastBody
                ? (c.lastSenderName && c.kind !== 'direct'
                    ? c.lastSenderName.split(' ')[0] + ': '
                    : '') + c.lastBody
                : 'No messages yet';
              return (
                '<button type="button" class="ch-item' +
                (String(c.id) === String(st.active) ? ' active' : '') +
                (c.unread > 0 ? ' unread' : '') +
                '" data-ch-open="' +
                c.id +
                '">' +
                avatar(title, c.kind, '', c.otherProfileId) +
                '<span class="ch-item-main"><span class="ch-item-top"><b class="ch-item-title">' +
                esc(title) +
                '</b><time>' +
                esc(listTime(c.lastMessageAt)) +
                '</time></span><span class="ch-item-bottom"><span class="ch-preview">' +
                esc(preview) +
                '</span><span class="ch-badges">' +
                (c.needsReplyOpen > 0
                  ? '<span class="ch-dot" title="Needs your reply">' + icon('flag', 12) + '</span>'
                  : '') +
                (c.mentionsUnread > 0
                  ? '<span class="ch-at" title="You were mentioned">@</span>'
                  : '') +
                (c.unread > 0
                  ? '<span class="ch-count' +
                    (c.muted ? ' muted' : '') +
                    '">' +
                    (c.unread > 99 ? '99+' : c.unread) +
                    '</span>'
                  : '') +
                '</span></span></span></button>'
              );
            })
            .join('') + hitsHtml;
      }

      async function loadList() {
        if (!root.isConnected) return;
        try {
          const data = await api('/api/chat/conversations');
          st.me = data.me;
          thread.setMe(data.me.id);
          st.convs = data.conversations;
          paintList();
          paintPresence();
          if (deps.onUnread) deps.onUnread(data);
        } catch (error) {
          listEl.innerHTML =
            '<div class="ch-list-empty">' +
            esc(error.message || 'Could not load chats.') +
            '</div>';
        }
      }

      async function openConversation(id, focus) {
        st.active = id;
        app.dataset.view = 'thread';
        placeholder.hidden = true;
        threadHost.hidden = false;
        paintList();
        const conv = st.convs.find((c) => String(c.id) === String(id));
        await thread.show(String(id), { muted: conv && conv.muted, focus: focus || null });
        await loadList();
      }

      async function people() {
        if (!st.people) st.people = (await api('/api/chat/people')).people;
        return st.people;
      }

      async function startDirect(profileId) {
        const data = await api('/api/chat/conversations', {
          method: 'POST',
          body: JSON.stringify({ kind: 'direct', profileId }),
        });
        await loadList();
        openConversation(data.conversation.id);
      }

      function newChatModal() {
        modal(
          '<header><h4>New chat</h4><button type="button" class="ch-iconbtn" data-m-close aria-label="Close">' +
            icon('close') +
            '</button></header><div class="ch-modal-body"><label class="ch-search">' +
            icon('search', 16) +
            '<span class="ch-sr">Find a person</span><input type="search" data-m-find placeholder="Find a person" autocomplete="off"></label>' +
            '<div class="ch-people" data-m-people><p class="ch-list-empty">Loading&hellip;</p></div></div>',
          async (wrap, close) => {
            const box = wrap.querySelector('[data-m-people]');
            const find = wrap.querySelector('[data-m-find]');
            find.focus();
            let all = [];
            const draw = () => {
              const needle = find.value.trim().toLowerCase();
              const rows = all.filter((p) => p.name.toLowerCase().includes(needle));
              box.innerHTML = rows.length
                ? rows
                    .map(
                      (p) =>
                        '<button type="button" class="ch-person" data-m-person="' +
                        p.id +
                        '">' +
                        avatar(p.name, 'direct', 'ch-av-sm') +
                        '<span>' +
                        esc(p.name) +
                        '</span></button>',
                    )
                    .join('')
                : '<p class="ch-list-empty">No one found.</p>';
            };
            try {
              all = await people();
              draw();
            } catch (error) {
              box.innerHTML = '<p class="ch-list-empty">' + esc(error.message) + '</p>';
            }
            find.addEventListener('input', draw);
            box.addEventListener('click', (e) => {
              const b = e.target.closest('[data-m-person]');
              if (!b) return;
              close();
              startDirect(b.dataset.mPerson).catch(() => {});
            });
          },
        );
      }

      function channelModal() {
        modal(
          '<header><h4>New channel</h4><button type="button" class="ch-iconbtn" data-m-close aria-label="Close">' +
            icon('close') +
            '</button></header><form class="ch-modal-body" data-m-form>' +
            '<label class="ch-field"><span>Channel name</span><input type="text" maxlength="80" required data-m-title placeholder="For example, Dispatch"></label>' +
            '<div class="ch-field"><span>Members</span><div class="ch-people ch-people-check" data-m-people><p class="ch-list-empty">Loading&hellip;</p></div></div>' +
            '<p class="ch-error" data-m-error role="alert" hidden></p>' +
            '<div class="ch-modal-actions"><button type="button" class="ch-btn" data-m-close>Cancel</button><button type="submit" class="ch-btn ch-btn-primary">Create channel</button></div></form>',
          async (wrap, close) => {
            const box = wrap.querySelector('[data-m-people]');
            wrap.querySelector('[data-m-title]').focus();
            try {
              const list = await people();
              box.innerHTML = list
                .map(
                  (p) =>
                    '<label class="ch-person"><input type="checkbox" value="' +
                    p.id +
                    '">' +
                    avatar(p.name, 'direct', 'ch-av-sm') +
                    '<span>' +
                    esc(p.name) +
                    '</span></label>',
                )
                .join('');
            } catch (error) {
              box.innerHTML = '<p class="ch-list-empty">' + esc(error.message) + '</p>';
            }
            wrap.querySelector('[data-m-form]').addEventListener('submit', async (e) => {
              e.preventDefault();
              const err = wrap.querySelector('[data-m-error]');
              const submit = e.target.querySelector('[type=submit]');
              submit.disabled = true;
              try {
                const data = await api('/api/chat/conversations', {
                  method: 'POST',
                  body: JSON.stringify({
                    kind: 'channel',
                    title: wrap.querySelector('[data-m-title]').value.trim(),
                    memberIds: [...box.querySelectorAll('input:checked')].map((i) => i.value),
                  }),
                });
                close();
                await loadList();
                openConversation(data.conversation.id);
              } catch (error) {
                err.textContent = error.message || 'Could not create the channel.';
                err.hidden = false;
                submit.disabled = false;
              }
            });
          },
        );
      }

      function membersModal(info) {
        const c = info.conversation;
        const canAdd =
          deps.can('chat.moderate') || (st.me && String(c.createdBy) === String(st.me.id));
        modal(
          '<header><h4>Members of ' +
            esc(c.title || 'channel') +
            '</h4><button type="button" class="ch-iconbtn" data-m-close aria-label="Close">' +
            icon('close') +
            '</button></header><div class="ch-modal-body"><div class="ch-people" data-m-members>' +
            info.members
              .map(
                (m) =>
                  '<div class="ch-person">' +
                  avatar(m.name, 'direct', 'ch-av-sm') +
                  '<span>' +
                  esc(m.name) +
                  '</span></div>',
              )
              .join('') +
            '</div>' +
            (canAdd
              ? '<div class="ch-field"><span>Add people</span><div class="ch-people ch-people-check" data-m-add></div>' +
                '<div class="ch-modal-actions"><button type="button" class="ch-btn ch-btn-primary" data-m-save>Add selected</button></div></div>'
              : '') +
            '<div class="ch-modal-actions"><button type="button" class="ch-btn" data-m-leave>Leave channel</button></div></div>',
          async (wrap, close) => {
            const have = new Set(info.members.map((m) => String(m.profileId)));
            if (canAdd) {
              const box = wrap.querySelector('[data-m-add]');
              try {
                const list = (await people()).filter((p) => !have.has(String(p.id)));
                box.innerHTML = list.length
                  ? list
                      .map(
                        (p) =>
                          '<label class="ch-person"><input type="checkbox" value="' +
                          p.id +
                          '">' +
                          avatar(p.name, 'direct', 'ch-av-sm') +
                          '<span>' +
                          esc(p.name) +
                          '</span></label>',
                      )
                      .join('')
                  : '<p class="ch-list-empty">Everyone is already in this channel.</p>';
              } catch {
                box.innerHTML = '';
              }
              wrap.querySelector('[data-m-save]').addEventListener('click', async () => {
                const ids = [...box.querySelectorAll('input:checked')].map((i) => i.value);
                if (!ids.length) return close();
                try {
                  await api('/api/chat/conversations/' + c.id + '/members', {
                    method: 'POST',
                    body: JSON.stringify({ profileIds: ids }),
                  });
                } catch {
                  /* shown on reopen */
                }
                close();
                openConversation(c.id);
              });
            }
            wrap.querySelector('[data-m-leave]').addEventListener('click', async () => {
              try {
                await api('/api/chat/conversations/' + c.id + '/members/me', { method: 'DELETE' });
              } catch {
                /* ignore */
              }
              close();
              st.active = null;
              threadHost.hidden = true;
              placeholder.hidden = false;
              app.dataset.view = 'list';
              thread.stop();
              loadList();
            });
          },
        );
      }

      root.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        if (button.dataset.chHit)
          return openConversation(button.dataset.chHit, button.dataset.chMsg);
        if (button.dataset.chOpen) return openConversation(button.dataset.chOpen);
        if (button.dataset.chFilter) {
          st.filter = button.dataset.chFilter;
          return paintList();
        }
        if (button.matches('[data-ch-new]')) return newChatModal();
        if (button.matches('[data-ch-channel]')) return channelModal();
        if (button.matches('[data-ch-settings]')) return settingsModal();
        if (button.matches('[data-ch-popout]')) return deps.popOut(st.active);
      });
      root.querySelector('[data-ch-search]').addEventListener('input', (event) => {
        st.search = event.target.value;
        paintList();
        window.clearTimeout(st.searchTimer);
        const phrase = st.search.trim();
        if (phrase.length < 2) {
          st.hits = [];
          return;
        }
        st.searchTimer = window.setTimeout(async () => {
          try {
            const data = await api('/api/chat/search?q=' + encodeURIComponent(phrase));
            if (st.search.trim() !== phrase) return;
            st.hits = data.results;
            paintList();
          } catch {
            /* the conversation filter still works */
          }
        }, 300);
      });

      let reloadTimer = null;
      const reload = () => {
        window.clearTimeout(reloadTimer);
        reloadTimer = window.setTimeout(() => root.isConnected && loadList(), 300);
      };
      const offs = ['message', 'change', 'read', 'resync'].map((type) => bus.on(type, reload));
      offs.push(bus.on('presence', paintPresence));
      let beat = 0;
      st.timer = window.setInterval(() => {
        if (!root.isConnected) return page && page.destroy();
        if (document.visibilityState === 'hidden') return;
        if (!live.connected || ++beat % 3 === 0) loadList();
      }, 10000);
      page = {
        destroy() {
          window.clearInterval(st.timer);
          window.clearTimeout(reloadTimer);
          offs.forEach((off) => off());
          thread.stop();
          page = null;
        },
        open: openConversation,
        reload: loadList,
      };
      await loadList();
      if (deps.consumePendingOpen) {
        const pending = deps.consumePendingOpen();
        if (pending) openConversation(pending);
      }
    }

    // ===================================================== record slide-over
    async function openRecord(recordType, recordId) {
      let me = null;
      let conversation = null;
      try {
        const data = await api('/api/chat/conversations', {
          method: 'POST',
          body: JSON.stringify({ kind: 'record', recordType, recordId: String(recordId) }),
        });
        conversation = data.conversation;
        me = (await api('/api/chat/conversations')).me;
      } catch (error) {
        toast(error.message || 'Could not open the thread.');
        return;
      }
      const prior = document.querySelector('.ch-drawer-host');
      if (prior) prior.remove();
      const wrap = document.createElement('div');
      wrap.className = 'ch-drawer-host';
      wrap.innerHTML =
        '<div class="ch-backdrop" data-d-close></div><aside class="ch-drawer" role="dialog" aria-modal="true" aria-label="Discussion"><div data-d-thread></div></aside>';
      document.body.appendChild(wrap);
      const close = () => {
        thread.stop();
        wrap.remove();
        document.removeEventListener('keydown', onKey);
        summary().catch(() => {});
      };
      const onKey = (e) => e.key === 'Escape' && close();
      document.addEventListener('keydown', onKey);
      wrap.querySelector('[data-d-close]').addEventListener('click', close);
      const thread = createThread(wrap.querySelector('[data-d-thread]'), {
        me: me.id,
        close,
        onSent: () => summary().catch(() => {}),
        onRead: () => summary().catch(() => {}),
      });
      await thread.show(String(conversation.id));
    }

    return {
      renderPage,
      openRecord,
      startBadge,
      stopBadge,
      summary,
      openConversation: openAnywhere,
    };
  }

  window.JdChat = { create };
})();
