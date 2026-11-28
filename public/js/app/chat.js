(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  const POLL_INTERVAL_MS = 4000;
  const NOTIFY_POLL_INTERVAL_MS = 5000;

  let pollTimer = null;
  let activeChatId = null;
  const drafts = new Map();
  const failedMessages = new Map();
  // The Open chat button that opened the panel, and its SWAPP id in case
  // the button is re-rendered while the chat is open.
  let chatOpener = null;
  let chatOpenerSwapp = null;

  let notifyTimer = null;
  let lastSeenIncoming = null; // chat id -> newest incoming message id; null until first check
  let unreadByUser = {};
  // Each SWAPP has its own chat, so a notebook's Chat button counts only the
  // chat of the SWAPP that unlocked it.
  let unreadBySwapp = {};

  app.getChatUnreadForSwapp = function getChatUnreadForSwapp(swappId) {
    return unreadBySwapp[swappId] || 0;
  };

  function setBadge(badge, count) {
    badge.textContent = count > 9 ? "9+" : String(count);
    badge.classList.toggle("hidden", count === 0);
  }

  function updateChatBadges() {
    const total = Object.values(unreadByUser).reduce((sum, n) => sum + n, 0);
    document.querySelectorAll("[data-chat-badge]").forEach((badge) => {
      setBadge(badge, total);
      badge.setAttribute("aria-label", `${total} unread messages`);
      badge.title = "Unread messages";
    });
    document.querySelectorAll("[data-chat-swapp]").forEach((button) => {
      const badge = button.querySelector("[data-chat-button-badge]");
      if (!badge) return;
      const unread = app.getChatUnreadForSwapp(button.dataset.chatSwapp);
      setBadge(badge, unread);
      badge.setAttribute("aria-label", `${unread} unread`);
    });
  }

  // Polls the chat list for unread counts. Drives the red badges on
  // the Swaps navigation and chat buttons, and the "New message from @x" popup.
  app.refreshChatNotifications = async function refreshChatNotifications() {
    if (!app.state.currentUser) return;
    try {
      const data = await app.api.getChats();
      const firstCheck = lastSeenIncoming === null;
      const seen = lastSeenIncoming || new Map();
      const newFrom = [];

      unreadByUser = {};
      unreadBySwapp = {};
      (data.chats || []).forEach((chat) => {
        // The open chat is marked read by its own polling, so it never counts.
        const unread = chat.id === activeChatId ? 0 : chat.unreadCount || 0;
        unreadByUser[chat.otherUsername] = (unreadByUser[chat.otherUsername] || 0) + unread;
        unreadBySwapp[chat.swapp_id] = unread;

        const newest = chat.lastIncomingId || 0;
        if (!firstCheck && unread > 0 && newest > (seen.get(chat.id) || 0)) {
          newFrom.push(chat.otherUsername);
        }
        seen.set(chat.id, newest);
      });
      lastSeenIncoming = seen;
      updateChatBadges();

      const total = Object.values(unreadByUser).reduce((sum, n) => sum + n, 0);
      if (firstCheck && total > 0) {
        app.showToast(`You have ${total} unread message${total === 1 ? "" : "s"}`);
      } else if (newFrom.length === 1) {
        app.showToast(`New message from @${newFrom[0]}`);
      } else if (newFrom.length > 1) {
        app.showToast(`New messages from @${newFrom[0]} and ${newFrom.length - 1} more`);
      }
    } catch (err) {
      console.error("[CHAT] notifications", err);
    }
  };

  app.startChatNotifications = function startChatNotifications() {
    if (notifyTimer) clearInterval(notifyTimer);
    app.refreshChatNotifications();
    notifyTimer = setInterval(app.refreshChatNotifications, NOTIFY_POLL_INTERVAL_MS);
  };

  // Bubbles are built with textContent, never innerHTML, so a message can't
  // inject markup into the other student's page.
  function renderMessages(messages) {
    const list = document.getElementById("chatMessageList");
    if (!list) return;

    const currentUser = app.state.currentUser;
    list.replaceChildren();

    if (messages.length === 0) {
      const empty = document.createElement("p");
      empty.className = "chat-panel-empty";
      empty.textContent = "No messages yet. Say hi!";
      list.appendChild(empty);
      return;
    }

    messages.forEach((msg) => {
      const mine = msg.senderUsername === currentUser?.username;

      const row = document.createElement("div");
      row.className = mine ? "chat-bubble-row chat-bubble-row-mine" : "chat-bubble-row";

      const bubble = document.createElement("div");
      bubble.className = mine ? "chat-bubble chat-bubble-mine" : "chat-bubble chat-bubble-theirs";
      bubble.textContent = msg.body;

      row.appendChild(bubble);
      list.appendChild(row);
    });

    list.scrollTop = list.scrollHeight;
  }

  function isMoreMenuOpen() {
    const menu = document.getElementById("chatMoreMenu");
    return Boolean(menu && !menu.classList.contains("hidden"));
  }

  function closeMoreMenu({ returnFocus = false } = {}) {
    const btn = document.getElementById("chatMoreBtn");
    const menu = document.getElementById("chatMoreMenu");
    if (menu) menu.classList.add("hidden");
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (returnFocus) btn?.focus();
  }

  function toggleMoreMenu() {
    const btn = document.getElementById("chatMoreBtn");
    const menu = document.getElementById("chatMoreMenu");
    if (!btn || !menu) return;
    const willOpen = menu.classList.contains("hidden");
    menu.classList.toggle("hidden", !willOpen);
    btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
    if (willOpen) document.getElementById("chatEndBtn")?.focus();
  }

  function setEndedState(ended) {
    document.getElementById("chatInputRow")?.classList.toggle("hidden", ended);
    document.getElementById("chatFailedMessages")?.classList.toggle("hidden", ended);
    document.getElementById("chatEndedNotice")?.classList.toggle("hidden", !ended);
    document.getElementById("chatMoreWrap")?.classList.toggle("hidden", ended);
    document.getElementById("chatEndBtn")?.classList.toggle("hidden", ended);
    if (ended) closeMoreMenu();
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function loadMessages(chatId) {
    try {
      const data = await app.api.getChatMessages(chatId);
      if (chatId !== activeChatId) return;

      renderMessages(data.messages || []);

      const header = document.getElementById("chatPanelHeader");
      if (header && data.chat) {
        header.textContent = data.chat.otherUsername
          ? `@${data.chat.otherUsername}`
          : "SWAPPR Chat";
        document
          .getElementById("chatPanel")
          ?.setAttribute(
            "aria-label",
            data.chat.otherUsername ? `Chat with @${data.chat.otherUsername}` : "SWAPPR Chat",
          );
      }

      // FUNC-013 REQT-003 / REQT-005: when the workspace opened and closes.
      const dates = document.getElementById("chatDates");
      if (dates && data.chat) {
        const format = root.SWAPPRDates.formatLongDate;
        dates.textContent =
          data.chat.status === "active"
            ? `Started ${format(data.chat.created_at)} · Closes ${format(data.chat.expires_at)}`
            : `Ended ${format(data.chat.archived_at)}`;
      }

      const ended = data.chat?.status !== "active";
      setEndedState(ended);
      if (ended) stopPolling();
    } catch (err) {
      console.error("[CHAT]", err);
    }
  }

  function startPolling(chatId) {
    stopPolling();
    pollTimer = setInterval(() => loadMessages(chatId), POLL_INTERVAL_MS);
  }

  function switchComposer(chatId) {
    if (activeChatId === chatId) return;
    const input = document.getElementById("chatMessageInput");
    if (input && activeChatId !== null) {
      if (input.value) drafts.set(activeChatId, input.value);
      else drafts.delete(activeChatId);
    }
    activeChatId = chatId;
    if (input) input.value = drafts.get(chatId) || "";
    renderFailedMessages();
  }

  app.openChat = async function openChat(chatId) {
    switchComposer(chatId);
    // Don't show the previous chat's dates while this one loads.
    const dates = document.getElementById("chatDates");
    if (dates) dates.textContent = "";
    const panel = document.getElementById("chatPanel");
    if (panel?.classList.contains("hidden")) {
      const active = document.activeElement;
      chatOpener = active && active !== document.body && !panel.contains(active) ? active : null;
      chatOpenerSwapp = chatOpener?.closest("[data-chat-swapp]")?.dataset.chatSwapp || null;
    }
    panel?.classList.remove("hidden");
    root.lucide?.createIcons();
    await loadMessages(chatId);
    app.refreshChatNotifications();
    if (activeChatId === chatId && !document.getElementById("chatInputRow")?.classList.contains("hidden")) {
      startPolling(chatId);
      document.getElementById("chatMessageInput")?.focus();
    }
  };

  app.closeChat = function closeChat() {
    switchComposer(null);
    stopPolling();
    closeMoreMenu();
    const panel = document.getElementById("chatPanel");
    const hadFocus = panel?.contains(document.activeElement);
    panel?.classList.add("hidden");
    app.refreshChatNotifications();
    // Focus goes back to the Open chat button (or its re-rendered copy).
    if (hadFocus) {
      const rerendered =
        chatOpenerSwapp &&
        document.querySelector(`[data-chat-swapp="${CSS.escape(chatOpenerSwapp)}"]`);
      [chatOpener, rerendered].find((node) => app.canFocus?.(node))?.focus();
    }
    chatOpener = null;
    chatOpenerSwapp = null;
  };

  // The panel is a non-modal dialog named after the other student, so the
  // page behind it stays usable. Escape closes the More menu first if it is
  // open, otherwise closes the chat wherever focus is, unless a popup above
  // it was open when Escape was pressed: that popup gets the Escape.
  document.addEventListener("DOMContentLoaded", () => {
    const panel = document.getElementById("chatPanel");
    if (!panel) return;
    panel.setAttribute("role", "dialog");
    if (!panel.hasAttribute("aria-label")) panel.setAttribute("aria-label", "SWAPPR Chat");

    document.getElementById("chatMoreBtn")?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleMoreMenu();
    });

    document.addEventListener("click", (event) => {
      if (!isMoreMenuOpen()) return;
      const wrap = document.getElementById("chatMoreWrap");
      if (wrap && !wrap.contains(event.target)) closeMoreMenu();
    });

    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape" || panel.classList.contains("hidden")) return;
        if (app.isLayerOpen?.() || app.keyStartedOverLayer?.(event)) return;
        if (isMoreMenuOpen()) {
          event.preventDefault();
          closeMoreMenu({ returnFocus: true });
          return;
        }
        app.closeChat();
      },
      true,
    );
  });

  // Opens the chat workspace of one SWAPP (FUNC-013 REQT-002).
  app.openChatForSwapp = async function openChatForSwapp(swappId) {
    try {
      const data = await app.api.getChats();
      const chat = (data.chats || []).find((c) => c.swapp_id === Number(swappId));
      if (!chat) {
        app.showToast("Chat not available yet");
        return;
      }
      app.openChat(chat.id);
    } catch (err) {
      app.showToast("Failed to open chat");
      console.error(err);
    }
  };

  function renderFailedMessages() {
    const list = document.getElementById("chatFailedMessages");
    if (!list) return;
    list.replaceChildren();
    const chatId = activeChatId;
    const failures = failedMessages.get(chatId) || [];
    for (const [index, body] of failures.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn-outline";
      button.textContent = `Retry sending: ${body}`;
      button.addEventListener("click", () => {
        failures.splice(index, 1);
        if (!failures.length) failedMessages.delete(chatId);
        renderFailedMessages();
        sendMessage(chatId, body);
      });
      list.appendChild(button);
    }
  }

  async function sendMessage(chatId, body) {
    try {
      await app.api.sendChatMessage(chatId, body);
      if (chatId === activeChatId) await loadMessages(chatId);
    } catch (err) {
      const input = document.getElementById("chatMessageInput");
      if (chatId === activeChatId && input && !input.value) {
        input.value = body;
      } else {
        const failures = failedMessages.get(chatId) || [];
        failures.push(body);
        failedMessages.set(chatId, failures);
        if (chatId === activeChatId) renderFailedMessages();
      }
      app.showToast(err.message || "Failed to send message");
      console.error(err);
    }
  }

  app.sendChatMessage = async function sendChatMessage() {
    const input = document.getElementById("chatMessageInput");
    if (!input || !activeChatId) return;
    const body = input.value.trim();
    if (!body) return;
    input.value = "";
    await sendMessage(activeChatId, body);
  };

  app.endChat = async function endChat() {
    closeMoreMenu();
    if (!activeChatId) return;
    if (!confirm("End this chat? You can still read it, but no more messages can be sent.")) {
      return;
    }
    try {
      await app.api.archiveChat(activeChatId);
      app.showToast("Chat ended.");
      await loadMessages(activeChatId);
    } catch (err) {
      app.showToast("Failed to end chat");
      console.error(err);
    }
  };
})(window);
