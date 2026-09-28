(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  const POLL_INTERVAL_MS = 4000;

  let pollTimer = null;
  let activeChatId = null;

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
    if (activeChatId === chatId && !document.getElementById("chatInputRow")?.classList.contains("hidden")) {
      startPolling(chatId);
      document.getElementById("chatMessageInput")?.focus();
    }
  };

  app.closeChat = function closeChat() {
    activeChatId = null;
    stopPolling();
    document.getElementById("chatPanel")?.classList.add("hidden");
  };

  app.openChatForNotebook = async function openChatForNotebook(otherUsername) {
    try {
      const data = await app.api.getChats();
      const chat = (data.chats || []).find((c) => c.otherUsername === otherUsername);
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
