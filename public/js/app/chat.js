(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  const POLL_INTERVAL_MS = 4000;
  const NOTIFY_POLL_INTERVAL_MS = 5000;

  let pollTimer = null;
  let activeChatId = null;

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
    document.querySelectorAll("[data-chat-badge]").forEach((badge) => setBadge(badge, total));
    document.querySelectorAll("[data-chat-swapp]").forEach((button) => {
      const badge = button.querySelector("[data-chat-button-badge]");
      if (badge) setBadge(badge, app.getChatUnreadForSwapp(button.dataset.chatSwapp));
    });
  }

  // Polls the chat list for unread counts. Drives the red badges on
  // "My SWAPPs" and the Chat buttons, and the "New message from @x" popup.
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

  function setEndedState(ended) {
    document.getElementById("chatInputRow")?.classList.toggle("hidden", ended);
    document.getElementById("chatEndedNotice")?.classList.toggle("hidden", !ended);
    document.getElementById("chatEndBtn")?.classList.toggle("hidden", ended);
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

  app.openChat = async function openChat(chatId) {
    activeChatId = chatId;
    document.getElementById("chatPanel")?.classList.remove("hidden");
    root.lucide?.createIcons();
    await loadMessages(chatId);
    app.refreshChatNotifications();
    if (activeChatId === chatId && !document.getElementById("chatInputRow")?.classList.contains("hidden")) {
      startPolling(chatId);
      document.getElementById("chatMessageInput")?.focus();
    }
  };

  app.closeChat = function closeChat() {
    activeChatId = null;
    stopPolling();
    document.getElementById("chatPanel")?.classList.add("hidden");
    app.refreshChatNotifications();
  };

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

  app.sendChatMessage = async function sendChatMessage() {
    const input = document.getElementById("chatMessageInput");
    if (!input || !activeChatId) return;
    const body = input.value.trim();
    if (!body) return;

    input.value = "";
    try {
      await app.api.sendChatMessage(activeChatId, body);
      await loadMessages(activeChatId);
    } catch (err) {
      input.value = body;
      app.showToast(err.message || "Failed to send message");
      console.error(err);
    }
  };

  app.endChat = async function endChat() {
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
